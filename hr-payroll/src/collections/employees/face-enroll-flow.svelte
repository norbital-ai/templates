<script lang="ts">
	import { onMount } from 'svelte';
	import { Effect } from 'effect';
	import Icon from '@iconify/svelte';
	import type Human from '@vladmandic/human';
	import { Button } from '@norbital-ai/ui/button';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { Row } from './$types.js';
	import { client } from '../../lib/workspace-client.js';
	import {
		KIOSK_CAPTURE_HEIGHT,
		KIOSK_CAPTURE_WIDTH,
		KIOSK_LOOP_MS
	} from '../../lib/kiosk/config.js';
	import { meanEmbedding } from '../../lib/kiosk/embed.js';
	import {
		createAnalyseCanvas,
		drawVideoFrame,
		largestFace,
		missingFaceModels,
		sampleFromFace,
		showStream,
		warmFaceEngine
	} from '../../lib/kiosk/face.js';
	import {
		GUIDED_POSES,
		guidedCaptureComplete,
		initialGuidedCapture,
		observePose,
		poseProgress,
		targetPose,
		type GuidedPose
	} from '../../lib/kiosk/guided-capture.js';
	import { kioskVoiceLanguage, type KioskPhraseKey } from '../../lib/kiosk/phrases.js';
	import type { KioskSample } from '../../lib/kiosk/sample.js';
	import { readKioskSettings } from '../../lib/kiosk/settings.js';
	import { browserNarratorPlatform, createKioskNarrator } from '../../lib/kiosk/voice.js';

	/**
	 * Guided face enrollment for one known person, opened from their profile.
	 *
	 * The identity is already answered by the record this mounts for, so the flow is three steps:
	 * capture, review, done. Capture is automatic, the way a phone enrolls a face: the flow asks for
	 * a pose, reads the face's rotation every frame, and takes the frame itself once the pose has
	 * been held inside its window with a readable descriptor. Five poses, one averaged descriptor.
	 *
	 * The write is one: the `kiosk_enroll` command, which attaches the descriptor to this known
	 * person (approved at once) and refuses a pending or suspended enrollment HR has not reviewed.
	 * The button cannot be `type="submit"`: the photo upload must finish before the command params
	 * exist, and invoke params are JSON, so the photo blob uploads through the file client first
	 * and only its storage reference rides the command.
	 */
	let {
		record,
		onsaved,
		onclose
	}: {
		record: Row;
		onsaved: (previewUrl: string) => void;
		onclose: () => void;
	} = $props();

	type Step = 'capture' | 'review' | 'done';
	const STEPS: readonly Step[] = ['capture', 'review', 'done'];
	const POSE_PHRASES: Readonly<Record<GuidedPose, KioskPhraseKey>> = {
		straight: 'enroll_straight',
		left: 'enroll_left',
		right: 'enroll_right',
		up: 'enroll_up',
		down: 'enroll_down'
	};
	/** No face for this long during capture is said once, then again after the next face. */
	const NO_FACE_AFTER_MS = 3000;
	const RING_RADIUS = 16;
	const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

	// Everything that reaches component context is read here, at init. The enroll handler below
	// runs from a click, long after init, and a `getContext` from there is Svelte's
	// `lifecycle_outside_component` error, which is what the old flow threw on pressing Enroll.
	const i18n = useI18n<TenantI18nKeys>();
	const { t } = i18n;
	const fileRuntime = getDataRendererRuntimeContext();
	const settings = readKioskSettings();
	const narrator = createKioskNarrator(browserNarratorPlatform(), {
		language: kioskVoiceLanguage(i18n.intlLocale),
		enabled: settings.voiceEnabled
	});

	let step = $state<Step>('capture');
	let warming = $state(true);
	let ready = $state(false);
	let fatal = $state<string | null>(null);
	let engineMissing = $state<string[]>([]);
	let guided = $state(initialGuidedCapture());
	let samples = $state<Partial<Record<GuidedPose, KioskSample>>>({});
	/** The loop's clock, so the progress rings animate between frames. */
	let now = $state(0);
	let consent = $state(false);
	/** In-flight and failure of the upload and the command, which no form owns. */
	let submitting = $state(false);
	let error = $state<string | null>(null);
	/** A pending or suspended enrollment is HR's to review; the command would refuse it. */
	let blocked = $derived(
		record.face_enrollment_status === 'PENDING' || record.face_enrollment_status === 'SUSPENDED'
	);

	let videoNode: HTMLVideoElement | null = null;
	let stream: MediaStream | null = null;
	let engine: Human | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let loopTimer: ReturnType<typeof setInterval> | null = null;
	let inFlight = false;
	let absentSince = 0;
	let absentSpoken = false;
	let spokenPose: GuidedPose | null = null;

	const target = $derived(targetPose(guided));
	const complete = $derived(guidedCaptureComplete(guided));
	const capturedCount = $derived(guided.captured.length);
	const orderedSamples = $derived(
		GUIDED_POSES.flatMap((pose) => {
			const sample = samples[pose];
			return sample === undefined ? [] : [sample];
		})
	);
	const guidance = $derived(
		fatal !== null
			? fatal
			: engineMissing.length > 0
				? t('face.engine_unavailable', { models: engineMissing.join(', ') })
				: warming
					? t('face.preparing')
					: target === null
						? t('face.captured', { count: capturedCount, total: GUIDED_POSES.length })
						: !guided.facePresent
							? t('face.guide_no_face')
							: t(`face.guide_${target}`)
	);

	const poseLabel = (pose: GuidedPose): string => t(`face.pose_${pose}`);

	const stopCamera = () => {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	};

	/** Same two-direction attach as the kiosk: the node and the stream arrive in either order. */
	const attachVideo = (node: HTMLVideoElement) => {
		videoNode = node;
		if (stream !== null) showStream(node, stream);
		return () => {
			if (videoNode === node) videoNode = null;
		};
	};

	$effect(() => {
		narrator.setLanguage(kioskVoiceLanguage(i18n.intlLocale));
	});

	const restartCapture = () => {
		guided = initialGuidedCapture();
		samples = {};
		spokenPose = null;
		absentSince = 0;
		absentSpoken = false;
		consent = false;
		error = null;
		step = 'capture';
	};

	const start = async () => {
		warming = true;
		fatal = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: 'user',
					width: { ideal: KIOSK_CAPTURE_WIDTH },
					height: { ideal: KIOSK_CAPTURE_HEIGHT }
				},
				audio: false
			});
			if (videoNode !== null) showStream(videoNode, stream);
			engine = await warmFaceEngine();
			canvas = createAnalyseCanvas();
			engineMissing = missingFaceModels(engine);
			ready = engineMissing.length === 0;
		} catch (failure) {
			fatal = failure instanceof Error ? failure.message : String(failure);
		} finally {
			warming = false;
		}
	};

	/**
	 * One frame: the largest face's rotation goes to the pose machine, and the frame that completes
	 * a pose's hold becomes that pose's sample. Guidance is spoken when the target changes.
	 */
	const tick = async () => {
		if (
			step !== 'capture' ||
			!ready ||
			engine === null ||
			canvas === null ||
			videoNode === null ||
			inFlight ||
			!drawVideoFrame(videoNode, canvas)
		)
			return;
		inFlight = true;
		try {
			const started = performance.now();
			const result = await engine.detect(canvas);
			const face = largestFace(result.face ?? []);
			const nowMs = Date.now();
			const observed = observePose(
				guided,
				face === undefined
					? null
					: { angle: face.rotation?.angle ?? null, embedding: face.embedding !== undefined },
				nowMs
			);
			guided = observed.state;
			now = nowMs;
			if (face === undefined) {
				if (absentSince === 0) absentSince = nowMs;
				else if (!absentSpoken && nowMs - absentSince >= NO_FACE_AFTER_MS) {
					absentSpoken = true;
					narrator.say('enroll_no_face');
				}
			} else {
				absentSince = 0;
				absentSpoken = false;
			}
			if (observed.capture !== null && face !== undefined) {
				const sample = sampleFromFace(face, canvas, performance.now() - started);
				if (sample !== null) samples = { ...samples, [observed.capture]: sample };
			}
			const next = targetPose(guided);
			if (next === null) {
				narrator.say('enroll_done');
				step = 'review';
			} else if (next !== spokenPose && face !== undefined) {
				spokenPose = next;
				narrator.say(POSE_PHRASES[next]);
			}
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			inFlight = false;
		}
	};

	onMount(() => {
		void start();
		loopTimer = setInterval(() => void tick(), KIOSK_LOOP_MS);
		return () => {
			if (loopTimer !== null) clearInterval(loopTimer);
			stopCamera();
			engine?.reset();
			narrator.stop();
		};
	});

	const canvasToFile = (source: HTMLCanvasElement): Promise<File> =>
		new Promise((resolve, reject) => {
			source.toBlob(
				(blob) => {
					if (blob === null) reject(new Error('Snapshot encoding failed.'));
					else resolve(new File([blob], 'face.jpg', { type: 'image/jpeg' }));
				},
				'image/jpeg',
				0.8
			);
		});

	const finish = (previewUrl: string) => {
		stopCamera();
		step = 'done';
		onsaved(previewUrl);
	};

	/**
	 * The upload and the averaged descriptor, without the write. The write itself stays an inline
	 * command arrow in the markup below: authored client writes must use CollectionForm or an
	 * inline handler, and a named helper wrapping `client.invoke` fails the workspace build.
	 */
	const prepareEnrollPayload = async () => {
		if (!consent || !complete || submitting) return null;
		const photo = samples.straight ?? orderedSamples[0];
		if (photo === undefined) return null;
		submitting = true;
		error = null;
		try {
			const vector = meanEmbedding(orderedSamples.map((sample) => sample.vector));
			const uploadClient = fileRuntime?.createFileUploadClient();
			if (uploadClient === undefined) throw new Error(t('face.upload_unavailable'));
			const uploaded = await Effect.runPromise(
				uploadClient.upload(await canvasToFile(photo.canvas))
			);
			return {
				photo,
				vector,
				facePhoto: {
					storage_key: uploaded.storageKey,
					file_name: uploaded.name,
					file_size: uploaded.size,
					mime_type: uploaded.type
				},
				consentAt: new Date().toISOString()
			};
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
			submitting = false;
			return null;
		}
	};
</script>

<div class="flex flex-col gap-5" data-face-enroll-step={step}>
	<ol class="grid grid-cols-3 gap-2" aria-label={t('face.progress')}>
		{#each STEPS as name, index (name)}
			<li
				class="border-t-2 pt-2 text-meta {index <= STEPS.indexOf(step)
					? 'border-primary text-foreground'
					: 'border-border'}"
			>
				{t(`face.step_${name}`)}
			</li>
		{/each}
	</ol>
	<!-- Steps hide with the `hidden` attribute rather than an `{#if}`, so the camera loop and
		the captures survive step changes. -->
	<div hidden={step !== 'capture'} class="flex flex-col gap-4">
		<div class="relative aspect-video w-full overflow-hidden rounded-xl bg-foreground">
			<video
				{@attach attachVideo}
				playsinline
				autoplay
				muted
				class="absolute inset-0 size-full -scale-x-100 object-cover"
			></video>
			{#if warming}
				<div class="absolute inset-0 flex items-center justify-center bg-black/40">
					<Spinner class="size-8 text-white" label={t('face.preparing')} />
				</div>
			{/if}
			<p
				class="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-4 py-2 text-center text-sm font-medium text-white"
				role="status"
				aria-live="polite"
				data-pose-target={target ?? ''}
			>
				{guidance}
			</p>
		</div>
		<ol class="grid grid-cols-5 gap-2" aria-label={t('face.poses')}>
			{#each GUIDED_POSES as pose (pose)}
				{@const progress = poseProgress(guided, pose, now)}
				{@const done = guided.captured.includes(pose)}
				<li
					class="flex flex-col items-center gap-1 text-meta {pose === target
						? 'text-foreground'
						: ''}"
					data-pose={pose}
					data-pose-progress={done ? 1 : Math.round(progress * 100) / 100}
				>
					<svg viewBox="0 0 40 40" class="size-10" aria-hidden="true">
						<circle
							cx="20"
							cy="20"
							r={RING_RADIUS}
							fill="none"
							stroke="currentColor"
							stroke-opacity="0.2"
							stroke-width="3"
						/>
						<circle
							cx="20"
							cy="20"
							r={RING_RADIUS}
							fill="none"
							class={done ? 'text-success' : 'text-primary'}
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							stroke-dasharray={RING_LENGTH}
							stroke-dashoffset={RING_LENGTH * (1 - progress)}
							transform="rotate(-90 20 20)"
						/>
						{#if done}
							<path
								d="M13 20.5l4.5 4.5L27 15.5"
								fill="none"
								class="text-success"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						{/if}
					</svg>
					<span>{poseLabel(pose)}</span>
				</li>
			{/each}
		</ol>
		{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		<div class="flex justify-end border-t pt-4">
			<Button variant="ghost" onclick={onclose}>{t('face.cancel')}</Button>
		</div>
	</div>

	<div hidden={step !== 'review'} class="flex flex-col gap-4">
		<p class="text-sm text-muted-foreground">{t('face.review_description')}</p>
		<ul class="grid grid-cols-5 gap-2" aria-label={t('face.captures')}>
			{#each GUIDED_POSES as pose (pose)}
				{@const sample = samples[pose]}
				<li class="overflow-hidden rounded-lg border bg-background">
					{#if sample !== undefined}
						<img
							class="aspect-video w-full -scale-x-100 object-cover"
							src={sample.dataUrl}
							alt={poseLabel(pose)}
						/>
					{/if}
					<p class="px-2 py-1 text-center text-meta">{poseLabel(pose)}</p>
				</li>
			{/each}
		</ul>
		<label class="flex items-center gap-3 rounded-lg border bg-background p-4 text-sm font-medium">
			<input class="size-4" type="checkbox" bind:checked={consent} />
			{t('face.consent')}
		</label>
		{#if blocked}
			<p role="note" class="text-sm text-warning-foreground">
				{record.face_enrollment_status === 'PENDING'
					? t('face.status_pending')
					: t('face.status_suspended')}
			</p>
		{/if}
		{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		<div class="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
			<Button variant="ghost" onclick={restartCapture} disabled={submitting}>
				<Icon icon="lucide:rotate-ccw" class="size-4" />
				{t('face.recapture')}
			</Button>
			<Button
				type="button"
				disabled={submitting || !consent || !complete || blocked}
				onclick={() => {
					void (async () => {
						const prepared = await prepareEnrollPayload();
						if (prepared === null) return;
						try {
							await client.invoke.kiosk_enroll({
								employee_id: record.id,
								face_embedding: prepared.vector,
								face_photo: prepared.facePhoto,
								consent_at: prepared.consentAt
							});
							finish(prepared.photo.dataUrl);
						} catch (failure) {
							error = failure instanceof Error ? failure.message : String(failure);
						} finally {
							submitting = false;
						}
					})();
				}}
			>
				{#if submitting}
					<Icon icon="lucide:loader-circle" class="size-4 animate-spin" aria-hidden="true" />
				{/if}
				{submitting ? t('face.enrolling') : t('face.enroll')}
			</Button>
		</div>
	</div>

	<div hidden={step !== 'done'} class="flex flex-col gap-4">
		<div class="flex items-start gap-3 rounded-lg bg-success/10 p-4 text-success" role="status">
			<Icon icon="lucide:circle-check" class="mt-0.5 size-5 shrink-0" />
			<p class="text-sm font-medium">{t('face.saved')}</p>
		</div>
		<div class="flex justify-end border-t pt-4">
			<Button onclick={onclose}>{t('face.close')}</Button>
		</div>
	</div>
</div>
