<script lang="ts">
	import { client } from '$bolt/client';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Button } from '@norbital-ai/ui/button';
	import { Label } from '@norbital-ai/ui/label';
	import { Effect } from 'effect';
	import { onDestroy } from 'svelte';
	import { watch } from 'runed';
	import { formatDuration } from '../lib/transcriber-format';

	type Language = 'english' | 'chinese' | 'malay' | 'japanese' | 'indonesian';
	type TranscribeStatus = 'idle' | 'running' | 'done' | 'no-speech' | 'error' | 'cancelled';

	const { t } = useI18n<TenantI18nKeys>();

	// Captured once during initialization: both calls read context and must not be deferred into
	// an event handler or effect.
	const runtime = getDataRendererRuntimeContext();
	const uploadClient = runtime?.createFileUploadClient ? runtime.createFileUploadClient() : null;

	const projectsClient = getCollectionClientForSurface(client, 'projects');
	const activitiesClient = getCollectionClientForSurface(client, 'activities');

	const MAX_DURATION_SECONDS = 600;
	const TARGET_SAMPLE_RATE = 16000;

	function slugify(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');
	}

	const projectsQuery = projectsClient.db.projects.findMany({
		orderBy: { name: 'asc' },
		limit: 500
	});
	let projects = $derived(projectsQuery.current ?? []);
	let projectOptions = $derived(
		projects.map((project) => ({
			value: project.id,
			label: String(project.name),
			search_term: String(project.name)
		}))
	);

	let selectedProject = $state<string | null>(null);
	let projectName = $derived(
		String(projects.find((project) => project.id === selectedProject)?.name ?? '')
	);

	let language = $state<Language>('english');
	let subject = $state('');

	// --- Audio source: microphone recording or an imported file --------------------------------

	let recordingState = $state<'idle' | 'recording'>('idle');
	let recordingElapsedSeconds = $state(0);
	let micError = $state<string | null>(null);
	let requestingMic = $state(false);

	let mediaStream: MediaStream | null = null;
	let mediaRecorder: MediaRecorder | null = null;
	let recordedChunks: BlobPart[] = [];
	let recordingTimer: ReturnType<typeof setInterval> | null = null;
	let disposed = false;

	let audioBlob = $state<Blob | null>(null);
	let audioObjectUrl = $state<string | null>(null);
	let decoding = $state(false);
	let decodeError = $state<string | null>(null);
	let decodedAudio = $state<Float32Array | null>(null);
	let audioDurationSeconds = $state<number | null>(null);

	// --- Transcription (runs in the worker) -----------------------------------------------------

	let worker: Worker | null = null;
	let transcribeStatus = $state<TranscribeStatus>('idle');
	let progressMessage = $state<string | null>(null);
	let transcribeError = $state<string | null>(null);
	let transcriptMarkdown = $state('');

	// --- Saving ------------------------------------------------------------------------------

	// Audio upload is an explicit opt-in; saving a transcript never uploads the clip by default.
	let saveWithRecording = $state(false);
	let saving = $state(false);
	let saveStatus = $state<'saved' | 'pending' | null>(null);
	let saveError = $state<string | null>(null);

	let canTranscribe = $derived(
		!!decodedAudio &&
			!decoding &&
			!saving &&
			transcribeStatus !== 'running' &&
			recordingState === 'idle' &&
			!requestingMic
	);
	let canSave = $derived(transcribeStatus === 'done' && transcriptMarkdown.trim().length > 0);

	// Reset local save bookkeeping when the project changes; this never touches audio or
	// transcript state, only the previous save's result.
	watch(
		() => selectedProject,
		() => {
			saveStatus = null;
			saveError = null;
		},
		{ lazy: true }
	);

	function clearRecordingTimer() {
		if (recordingTimer !== null) {
			clearInterval(recordingTimer);
			recordingTimer = null;
		}
	}

	function stopMicrophoneTracks() {
		mediaStream?.getTracks().forEach((track) => track.stop());
		mediaStream = null;
	}

	function terminateWorker() {
		worker?.terminate();
		worker = null;
	}

	function resetTranscript() {
		transcribeStatus = 'idle';
		transcribeError = null;
		transcriptMarkdown = '';
		progressMessage = null;
		saveStatus = null;
		saveError = null;
	}

	async function handleAudioSource(blob: Blob) {
		if (disposed) return;
		micError = null;
		decodeError = null;
		resetTranscript();
		if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
		audioBlob = blob;
		audioObjectUrl = URL.createObjectURL(blob);
		decodedAudio = null;
		audioDurationSeconds = null;
		decoding = true;
		try {
			if (blob.size === 0) throw new Error('empty');
			const arrayBuffer = await blob.arrayBuffer();
			if (disposed) return;
			const audioContext = new AudioContext();
			let decodedBuffer: AudioBuffer;
			try {
				decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
			} finally {
				void audioContext.close();
			}
			if (disposed) return;
			const duration = decodedBuffer.duration;
			if (!Number.isFinite(duration) || duration <= 0) throw new Error('empty');
			if (duration > MAX_DURATION_SECONDS) {
				decodeError = t('transcriber.too_long');
				return;
			}
			const targetLength = Math.max(1, Math.ceil(duration * TARGET_SAMPLE_RATE));
			const offlineContext = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
			const source = offlineContext.createBufferSource();
			source.buffer = decodedBuffer;
			source.connect(offlineContext.destination);
			source.start(0);
			const rendered = await offlineContext.startRendering();
			if (disposed) return;
			decodedAudio = rendered.getChannelData(0).slice();
			audioDurationSeconds = duration;
		} catch {
			if (!disposed) decodeError = t('transcriber.decode_failed');
		} finally {
			if (!disposed) decoding = false;
		}
	}

	async function startRecording() {
		// Guard against a double-click firing a second concurrent permission request before the
		// first one has resolved.
		if (requestingMic || recordingState === 'recording') return;
		micError = null;
		requestingMic = true;
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			requestingMic = false;
			micError = t('transcriber.mic_denied');
			return;
		}
		requestingMic = false;
		if (disposed) {
			// The component was torn down while permission was pending; release the stream
			// immediately instead of starting a recording nobody can see.
			stream.getTracks().forEach((track) => track.stop());
			return;
		}
		mediaStream = stream;
		recordedChunks = [];
		try {
			const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
			mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
		} catch {
			stopMicrophoneTracks();
			micError = t('transcriber.mic_denied');
			return;
		}
		mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) recordedChunks.push(event.data);
		};
		mediaRecorder.onstop = () => {
			const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
			stopMicrophoneTracks();
			if (disposed) return;
			void handleAudioSource(blob);
		};
		try {
			mediaRecorder.start();
		} catch {
			stopMicrophoneTracks();
			micError = t('transcriber.mic_denied');
			return;
		}
		recordingElapsedSeconds = 0;
		recordingState = 'recording';
		recordingTimer = setInterval(() => {
			recordingElapsedSeconds += 1;
			if (recordingElapsedSeconds >= MAX_DURATION_SECONDS) stopRecording();
		}, 1000);
	}

	function stopRecording() {
		clearRecordingTimer();
		if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
		recordingState = 'idle';
	}

	// Used by cancel and by disposal: clears the recorder's callbacks first so stopping it here
	// can never turn into an asynchronous decode of a clip nobody asked to keep.
	function forceStopRecording() {
		clearRecordingTimer();
		if (mediaRecorder) {
			mediaRecorder.ondataavailable = null;
			mediaRecorder.onstop = null;
			if (mediaRecorder.state !== 'inactive') {
				try {
					mediaRecorder.stop();
				} catch {
					// already stopped
				}
			}
			mediaRecorder = null;
		}
		stopMicrophoneTracks();
		recordingState = 'idle';
	}

	function onFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const selected = input.files?.[0] ?? null;
		input.value = '';
		if (!selected) return;
		void handleAudioSource(selected);
	}

	function ensureWorker(): Worker {
		if (!worker) {
			worker = new Worker(new URL('../lib/transcriber.worker.js', import.meta.url), {
				type: 'module'
			});
			worker.onmessage = handleWorkerMessage;
			worker.onerror = () => {
				transcribeStatus = 'error';
				transcribeError = t('transcriber.worker_error');
				progressMessage = null;
				// Terminate rather than reuse: a worker that threw during module or model load may
				// hold a permanently rejected cache. A retry gets a fresh worker instead.
				terminateWorker();
			};
		}
		return worker;
	}

	function handleWorkerMessage(event: MessageEvent) {
		const data = event.data as { type?: string; message?: string; markdown?: string } | undefined;
		if (!data) return;
		if (data.type === 'progress') {
			progressMessage = typeof data.message === 'string' ? data.message : null;
		} else if (data.type === 'complete') {
			const markdown = typeof data.markdown === 'string' ? data.markdown : '';
			progressMessage = null;
			if (!markdown.trim()) {
				// An empty transcript is never treated as a successful save candidate.
				transcribeStatus = 'no-speech';
			} else {
				transcriptMarkdown = markdown;
				transcribeStatus = 'done';
			}
		} else if (data.type === 'error') {
			progressMessage = null;
			transcribeStatus = 'error';
			transcribeError =
				typeof data.message === 'string' ? data.message : t('transcriber.transcribe_failed');
			terminateWorker();
		}
	}

	function startTranscription() {
		if (!decodedAudio) return;
		transcribeError = null;
		transcriptMarkdown = '';
		saveStatus = null;
		saveError = null;
		progressMessage = t('transcriber.status_starting');
		transcribeStatus = 'running';
		const activeWorker = ensureWorker();
		const audioCopy = decodedAudio.slice();
		activeWorker.postMessage({ type: 'transcribe', audio: audioCopy, language }, [
			audioCopy.buffer
		]);
	}

	function cancelTranscription() {
		// A running WASM inference call cannot be aborted in place; terminating the worker is the
		// only way to actually stop the work, and a fresh worker is created for the next attempt.
		// Also stop any recorder/timer/tracks defensively, so cancel always leaves every media
		// resource this app touched fully released.
		forceStopRecording();
		terminateWorker();
		transcribeStatus = 'cancelled';
		progressMessage = null;
	}

	function downloadTranscript() {
		const filename = `${slugify(projectName) || 'transcript'}.md`;
		const blob = new Blob([transcriptMarkdown], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function saveTranscript() {
		if (!selectedProject) {
			saveError = t('transcriber.select_project_required');
			return;
		}
		if (!transcriptMarkdown.trim()) {
			saveError = t('transcriber.empty_transcript');
			return;
		}
		if (saveWithRecording && !audioBlob) {
			saveError = t('transcriber.no_audio');
			return;
		}
		if (saveWithRecording && !uploadClient) {
			saveError = t('transcriber.save_no_upload');
			return;
		}

		saving = true;
		saveError = null;
		saveStatus = null;
		try {
			let recording:
				| { storage_key: string; file_name: string; file_size: number; mime_type: string }
				| undefined;
			// Audio is uploaded only when the person explicitly asked to save it alongside the
			// transcript; otherwise nothing about the recording ever leaves this browser.
			if (saveWithRecording && audioBlob && uploadClient) {
				// An imported file keeps its own real name and MIME type; only a microphone
				// recording (a plain, unnamed Blob) gets a generated name and an extension guess.
				let file: File;
				if (audioBlob instanceof File) {
					file = audioBlob;
				} else {
					const extension = audioBlob.type.includes('wav')
						? 'wav'
						: audioBlob.type.includes('mpeg')
							? 'mp3'
							: 'webm';
					const filename = `${slugify(projectName) || 'recording'}-${Date.now()}.${extension}`;
					file = new File([audioBlob], filename, { type: audioBlob.type || 'audio/webm' });
				}
				const uploaded = await Effect.runPromise(uploadClient.upload(file));
				recording = {
					storage_key: uploaded.storageKey,
					file_name: uploaded.name,
					file_size: uploaded.size,
					mime_type: uploaded.type
				};
			}

			// A transcript is always a new activity; the collection allocates its id.
			const values = {
				project_id: selectedProject,
				kind: 'transcript',
				subject: subject.trim() || `${t('transcriber.default_subject_prefix')} ${projectName}`,
				detail: transcriptMarkdown,
				...(recording ? { recording } : {})
			};

			const outcome = await Effect.runPromise(
				submitCollectionMutation(() => activitiesClient.collection.activities.create(values))
			);

			if (outcome.kind === 'committed') {
				saveStatus = 'saved';
			} else {
				saveStatus = 'pending';
			}
		} catch (e) {
			saveError = `${t('transcriber.save_failed')}: ${e}`;
		} finally {
			saving = false;
		}
	}

	// Lifecycle cleanup, not a tracked effect: stop the microphone, clear the recording timer,
	// clear the recorder's callbacks and terminate the worker if the person navigates away
	// mid-recording or mid-transcription. `disposed` guards any async work already in flight
	// (getUserMedia, decode, offline rendering) so it cannot touch state after this runs.
	onDestroy(() => {
		disposed = true;
		forceStopRecording();
		terminateWorker();
		if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
	});
</script>

<AppHeaderActions>
	<Combobox
		ariaLabel={t('transcriber.project_label')}
		options={projectOptions}
		bind:value={selectedProject}
		emptyPlaceholder={t('transcriber.select_project')}
		clientConfig={{
			isLoading: projectsQuery.loading,
			error: projectsQuery.error?.message ?? null
		}}
		disabled={saving}
		class="min-w-64"
	/>
</AppHeaderActions>

<AppShell
	icon="lucide:mic"
	title="Transcriber"
	description="Record or import audio and transcribe it on-device, then save it to a project."
	variant="full"
>
	<Scroll name={t('app.transcriber.header_title')} inset>
		<Stack gap="md">
			<p class="transcriber-notice">{t('transcriber.first_use_notice')}</p>

			<Stack gap="xs" align="start">
				<Label for="transcriber-language-select">{t('transcriber.language_label')}</Label>
				<select
					id="transcriber-language-select"
					bind:value={language}
					aria-label={t('transcriber.language_label')}
					disabled={transcribeStatus === 'running' || saving}
				>
					<option value="english">{t('transcriber.language_option_english')}</option>
					<option value="chinese">{t('transcriber.language_option_chinese')}</option>
					<option value="malay">{t('transcriber.language_option_malay')}</option>
					<option value="japanese">{t('transcriber.language_option_japanese')}</option>
					<option value="indonesian">{t('transcriber.language_option_indonesian')}</option>
				</select>
			</Stack>

			<Stack as="section" gap="sm">
				<h2>{t('transcriber.source_heading')}</h2>
				<Stack gap="sm" align="start">
					{#if recordingState === 'recording'}
						<Button variant="destructive" onclick={stopRecording}>
							{t('transcriber.record_stop')}
						</Button>
						<span>
							{t('transcriber.recording_indicator')}
							{formatDuration(recordingElapsedSeconds)}
						</span>
					{:else}
						<Button
							variant="outline"
							onclick={startRecording}
							disabled={decoding || saving || requestingMic || transcribeStatus === 'running'}
						>
							{t('transcriber.record_start')}
						</Button>
					{/if}
					{#if micError}
						<p class="transcriber-error">{micError}</p>
					{/if}

					<Label for="transcriber-file-input">{t('transcriber.import_label')}</Label>
					<input
						id="transcriber-file-input"
						type="file"
						accept="audio/*"
						onchange={onFileSelected}
						disabled={recordingState === 'recording' ||
							decoding ||
							saving ||
							requestingMic ||
							transcribeStatus === 'running'}
					/>

					{#if decoding}
						<p>{t('transcriber.decoding')}</p>
					{:else if decodeError}
						<p class="transcriber-error">{decodeError}</p>
					{:else if audioObjectUrl}
						<audio controls src={audioObjectUrl}></audio>
						<p>
							{t('transcriber.audio_ready')}
							{#if audioDurationSeconds !== null}
								— {t('transcriber.duration_label')}: {formatDuration(audioDurationSeconds)}
							{/if}
						</p>
					{/if}
				</Stack>
			</Stack>

			<Stack as="section" gap="sm">
				<h2>{t('transcriber.transcribe_heading')}</h2>
				<Stack gap="sm" align="start">
					{#if transcribeStatus === 'running'}
						<Button variant="destructive" onclick={cancelTranscription}>
							{t('transcriber.cancel_button')}
						</Button>
						<progress></progress>
						{#if progressMessage}
							<p role="status">{progressMessage}</p>
						{/if}
					{:else}
						<Button variant="default" disabled={!canTranscribe} onclick={startTranscription}>
							{transcribeStatus === 'error' || transcribeStatus === 'cancelled'
								? t('transcriber.retry_button')
								: t('transcriber.transcribe_button')}
						</Button>
					{/if}
					{#if transcribeStatus === 'no-speech'}
						<p>{t('transcriber.status_no_speech')}</p>
					{:else if transcribeStatus === 'error'}
						<p class="transcriber-error">{transcribeError ?? t('transcriber.status_error')}</p>
					{:else if transcribeStatus === 'cancelled'}
						<p>{t('transcriber.status_cancelled')}</p>
					{:else if transcribeStatus === 'done'}
						<p>{t('transcriber.status_done')}</p>
					{/if}
					<p class="transcriber-notice">{t('transcriber.speaker_notice')}</p>
				</Stack>
			</Stack>

			{#if transcribeStatus === 'done'}
				<Stack as="section" gap="sm">
					<h2>{t('transcriber.transcript_heading')}</h2>
					<Stack gap="sm" align="start">
						<Label for="transcriber-transcript">{t('transcriber.transcript_label')}</Label>
						<textarea
							id="transcriber-transcript"
							bind:value={transcriptMarkdown}
							rows={16}
							cols={80}
							aria-label={t('transcriber.transcript_label')}
							disabled={saving}
							spellcheck
							style="width: 100%; font-family: monospace;"></textarea>

						<Label for="transcriber-subject">{t('transcriber.subject_label')}</Label>
						<input
							id="transcriber-subject"
							type="text"
							bind:value={subject}
							placeholder={`${t('transcriber.default_subject_prefix')} ${projectName}`}
							disabled={saving}
						/>

						<Inline as="label" gap="sm">
							<input type="checkbox" bind:checked={saveWithRecording} disabled={saving} />
							{t('transcriber.save_with_recording_label')}
						</Inline>

						<Inline gap="sm">
							<Button variant="default" disabled={saving || !canSave} onclick={saveTranscript}>
								{saving ? t('transcriber.saving') : t('transcriber.save_button')}
							</Button>
							<Button variant="outline" onclick={downloadTranscript}>
								{t('transcriber.download_button')}
							</Button>
						</Inline>
						{#if saveError}
							<p class="transcriber-error">{saveError}</p>
						{:else if saveStatus === 'saved'}
							<p class="transcriber-status">{t('transcriber.save_saved')}</p>
						{:else if saveStatus === 'pending'}
							<p class="transcriber-status">{t('transcriber.save_pending')}</p>
						{/if}
					</Stack>
				</Stack>
			{/if}
		</Stack>
	</Scroll>
</AppShell>

<style>
	.transcriber-error {
		color: var(--color-destructive, #b91c1c);
	}

	.transcriber-notice {
		opacity: 0.75;
		font-size: 0.875rem;
	}
</style>
