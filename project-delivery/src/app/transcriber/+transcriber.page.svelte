<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Picker } from '@norbital-ai/ui';
	import { Button, Combobox, Label, Textarea } from '@norbital-ai/ui';
	import { onDestroy } from 'svelte';
	import { downloadMarkdown, slugify } from '../../lib/markdown-file.js';
	import { formatDuration } from '../../lib/transcriber-format.js';
	import { getErrorMessage } from '../../lib/transcriber-format.js';
	import * as Predicate from '../../lib/guards.js';

	type Language = 'english' | 'chinese' | 'malay' | 'japanese' | 'indonesian';
	type TranscribeStatus = 'idle' | 'running' | 'done' | 'no-speech' | 'error' | 'cancelled';

	const t = bolt.t;

	const MAX_DURATION_SECONDS = 600;
	const TARGET_SAMPLE_RATE = 16000;

	let selectedProject = $state<Id<'projects'> | null>(null);
	let projectName = $state('');

	let language = $state<Language>('english');
	let subject = $state('');

	// --- Audio source: microphone recording or an imported file --------------------------------

	let recordingState = $state<'idle' | 'recording'>('idle');
	let recordingElapsedSeconds = $state(0);
	let micError = $state<string | null>(null);
	let requestingMic = $state(false);

	/** Imperative handles and bookkeeping nothing renders from: plain fields, not state. */
	const handles: {
		mediaStream: MediaStream | null;
		mediaRecorder: MediaRecorder | null;
		recordedChunks: BlobPart[];
		recordingTimer: ReturnType<typeof setInterval> | null;
		disposed: boolean;
		worker: Worker | null;
	} = {
		mediaStream: null,
		mediaRecorder: null,
		recordedChunks: [],
		recordingTimer: null,
		disposed: false,
		worker: null
	};

	let audioBlob = $state<Blob | null>(null);
	let audioObjectUrl = $state<string | null>(null);
	let decoding = $state(false);
	let decodeError = $state<string | null>(null);
	let decodedAudio = $state<Float32Array | null>(null);
	let audioDurationSeconds = $state<number | null>(null);

	// --- Transcription (runs in the worker) -----------------------------------------------------

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

	// A project change resets only the previous save's result, never the audio or the transcript.
	function pickProject(next: Id<'projects'> | null) {
		selectedProject = next;
		projectName = '';
		if (next !== null)
			void bolt.get('projects', next, { name: true }).then((row) => {
				if (selectedProject === next) projectName = row?.name ?? '';
			});
		saveStatus = null;
		saveError = null;
	}

	function clearRecordingTimer() {
		if (handles.recordingTimer !== null) {
			clearInterval(handles.recordingTimer);
			handles.recordingTimer = null;
		}
	}

	function stopMicrophoneTracks() {
		handles.mediaStream?.getTracks().forEach((track) => track.stop());
		handles.mediaStream = null;
	}

	function terminateWorker() {
		handles.worker?.terminate();
		handles.worker = null;
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
		if (handles.disposed) return;
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
			if (handles.disposed) return;
			const audioContext = new AudioContext();
			let decodedBuffer: AudioBuffer;
			try {
				decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
			} finally {
				void audioContext.close();
			}
			if (handles.disposed) return;
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
			if (handles.disposed) return;
			decodedAudio = rendered.getChannelData(0).slice();
			audioDurationSeconds = duration;
		} catch {
			if (!handles.disposed) decodeError = t('transcriber.decode_failed');
		} finally {
			if (!handles.disposed) decoding = false;
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
		if (handles.disposed) {
			// The component was torn down while permission was pending; release the stream
			// immediately instead of starting a recording nobody can see.
			stream.getTracks().forEach((track) => track.stop());
			return;
		}
		handles.mediaStream = stream;
		handles.recordedChunks = [];
		try {
			const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
			handles.mediaRecorder = new MediaRecorder(
				handles.mediaStream,
				mimeType ? { mimeType } : undefined
			);
		} catch {
			stopMicrophoneTracks();
			micError = t('transcriber.mic_denied');
			return;
		}
		handles.mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) handles.recordedChunks.push(event.data);
		};
		handles.mediaRecorder.onstop = () => {
			const blob = new Blob(handles.recordedChunks, {
				type: handles.mediaRecorder?.mimeType || 'audio/webm'
			});
			stopMicrophoneTracks();
			if (handles.disposed) return;
			void handleAudioSource(blob);
		};
		try {
			handles.mediaRecorder.start();
		} catch {
			stopMicrophoneTracks();
			micError = t('transcriber.mic_denied');
			return;
		}
		recordingElapsedSeconds = 0;
		recordingState = 'recording';
		handles.recordingTimer = setInterval(() => {
			recordingElapsedSeconds += 1;
			if (recordingElapsedSeconds >= MAX_DURATION_SECONDS) stopRecording();
		}, 1000);
	}

	function stopRecording() {
		clearRecordingTimer();
		if (handles.mediaRecorder && handles.mediaRecorder.state !== 'inactive')
			handles.mediaRecorder.stop();
		recordingState = 'idle';
	}

	// Used by cancel and by disposal: clears the recorder's callbacks first so stopping it here
	// can never turn into an asynchronous decode of a clip nobody asked to keep.
	function forceStopRecording() {
		clearRecordingTimer();
		if (handles.mediaRecorder) {
			handles.mediaRecorder.ondataavailable = null;
			handles.mediaRecorder.onstop = null;
			if (handles.mediaRecorder.state !== 'inactive') {
				try {
					handles.mediaRecorder.stop();
				} catch {
					// already stopped
				}
			}
			handles.mediaRecorder = null;
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
		if (!handles.worker) {
			handles.worker = new Worker(new URL('../../lib/transcriber.worker.js', import.meta.url), {
				type: 'module'
			});
			handles.worker.onmessage = handleWorkerMessage;
			handles.worker.onerror = () => {
				transcribeStatus = 'error';
				transcribeError = t('transcriber.worker_error');
				progressMessage = null;
				// Terminate rather than reuse: a worker that threw during module or model load may
				// hold a permanently rejected cache. A retry gets a fresh worker instead.
				terminateWorker();
			};
		}
		return handles.worker;
	}

	function handleWorkerMessage(event: MessageEvent) {
		const data = event.data as { type?: string; message?: string; markdown?: string } | undefined;
		if (!data) return;
		if (data.type === 'progress') {
			progressMessage = Predicate.isString(data.message) ? data.message : null;
		} else if (data.type === 'complete') {
			const markdown = Predicate.isString(data.markdown) ? data.markdown : '';
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
			transcribeError = Predicate.isString(data.message)
				? data.message
				: t('transcriber.transcribe_failed');
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
		downloadMarkdown(transcriptMarkdown, `${slugify(projectName) || 'transcript'}.md`);
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

		saving = true;
		saveError = null;
		saveStatus = null;
		try {
			let recording: Awaited<ReturnType<typeof bolt.upload>> | undefined;
			// Audio is uploaded only when the person explicitly asked to save it alongside the
			// transcript; otherwise nothing about the recording ever leaves this browser.
			if (saveWithRecording && audioBlob) {
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
				recording = await bolt.upload(file, 'activities.recording');
			}

			// A transcript is always a new activity; the collection allocates its id.
			const values = {
				project_id: selectedProject,
				kind: 'transcript' as const,
				subject: subject.trim() || `${t('transcriber.default_subject_prefix')} ${projectName}`,
				detail: transcriptMarkdown,
				...(recording ? { recording } : {})
			};

			const outcome = await bolt.act('activities.create', values);
			if (outcome.kind === 'committed') saveStatus = 'saved';
			else if (outcome.kind === 'pendingApproval') saveStatus = 'pending';
			else
				saveError = `${t('transcriber.save_failed')}: ${'message' in outcome ? outcome.message : outcome.kind}`;
		} catch (e) {
			saveError = `${t('transcriber.save_failed')}: ${getErrorMessage(e)}`;
		} finally {
			saving = false;
		}
	}

	// Lifecycle cleanup, not a tracked effect: stop the microphone, clear the recording timer,
	// clear the recorder's callbacks and terminate the worker if the person navigates away
	// mid-recording or mid-transcription. `disposed` guards any async work already in flight
	// (getUserMedia, decode, offline rendering) so it cannot touch state after this runs.
	onDestroy(() => {
		handles.disposed = true;
		forceStopRecording();
		terminateWorker();
		if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
	});
</script>

{#snippet actions()}
	<Inline gap="sm" align="center">
		<Label for="transcriber-project">{t('transcriber.project_label')}</Label>
		<div class="min-w-64">
			<Picker
				id="transcriber-project"
				of="projects"
				value={selectedProject}
				onChange={pickProject}
				orderBy={{ name: 'asc' }}
				limit={500}
				disabled={saving}
			/>
		</div>
	</Inline>
{/snippet}

<AppShell
	icon="lucide:mic"
	title={t('app.transcriber.title')}
	description={t('app.transcriber.header_description')}
	variant="full"
	{actions}
>
	<Scroll name={t('app.transcriber.header_title')} inset>
		<Stack gap="md">
			<p class="transcriber-notice">{t('transcriber.first_use_notice')}</p>

			<Stack gap="xs" align="start">
				<Label for="transcriber-language-select">{t('transcriber.language_label')}</Label>
				<Combobox
					id="transcriber-language-select"
					class="w-56"
					aria-label={t('transcriber.language_label')}
					disabled={transcribeStatus === 'running' || saving}
					options={(['english', 'chinese', 'malay', 'japanese', 'indonesian'] as const).map(
						(l) => ({ value: l, label: t(`transcriber.language_option_${l}`) })
					)}
					value={language}
					onChange={(l) => {
						if (l !== null) language = l;
					}}
				/>
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
						<Textarea
							id="transcriber-transcript"
							bind:value={transcriptMarkdown}
							rows={16}
							aria-label={t('transcriber.transcript_label')}
							disabled={saving}
							spellcheck
							class="font-mono"
							style="field-sizing: fixed"
						/>

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
