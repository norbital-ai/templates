<script lang="ts">
	import { attach, fork } from '@norbital-ai/ui/effect';
	import { t } from '../i18n/t.js';
	import { Clock, Duration, Effect, Schedule, Schema } from 'effect';
	import type Human from '@vladmandic/human';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { fileRef } from '@norbital-ai/bolt/page';
	import { Instant } from '@norbital-ai/std/date';
	import { bolt } from '$bolt';
	import { Button, Icon, Spinner, useKinds } from '@norbital-ai/ui';
	import { Cluster, Columns, Frame, Grid, Imposter, Inline, Stack } from '@norbital-ai/ui/layout';
	import { KIOSK_LOOP_MS } from '../../../kiosk/attendance/config.js';
	import { meanEmbedding } from '../../../kiosk/attendance/embed.js';
	import {
		createAnalyseCanvas,
		drawVideoFrame,
		largestFace,
		missingFaceModels,
		sampleFromFace,
		showStream,
		openCamera,
		closeCamera,
		warmFaceEngine
	} from '../../../kiosk/attendance/face.js';
	import {
		GUIDED_POSES,
		guidedCaptureComplete,
		initialGuidedCapture,
		observePose,
		poseProgress,
		targetPose,
		type GuidedPose
	} from './guided_capture.js';
	import { kioskVoiceLanguage, type KioskPhraseKey } from '../../../kiosk/attendance/phrases.js';
	import type { KioskSample } from '../../../kiosk/attendance/sample.js';
	import { readKioskSettings } from '../../../kiosk/attendance/settings.js';
	import { browserNarratorPlatform, createKioskNarrator } from '../../../kiosk/attendance/voice.js';
	import { getErrorMessage } from '../../payroll_engine/foundation.js';
	/**
	 * Guided face enrollment for one known person, opened from their profile.
	 *
	 * The identity is already answered by the record this mounts for, so the flow is three steps:
	 * capture, review, done. Capture is automatic, the way a phone enrolls a face: the flow asks for
	 * a pose, reads the face's rotation every frame, and takes the frame itself once the pose has
	 * been held inside its window with a readable descriptor. Five poses, one averaged descriptor.
	 *
	 * The write is one `employment_profile.update`: the averaged descriptor, the straight-on photo
	 * (uploaded first, only its file reference rides the write), the consent instant and the approved
	 * status. A pending or suspended enrollment is HR's to review and blocks a re-enrollment here.
	 */
	let {
		record,
		onsaved,
		onclose
	}: {
		record: {
			readonly id: Id<'employment_profile'>;
			readonly face_enrollment_status?: unknown;
		};
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
	const GUIDE_KEYS = {
		straight: 'face.guide_straight',
		left: 'face.guide_left',
		right: 'face.guide_right',
		up: 'face.guide_up',
		down: 'face.guide_down'
	} as const;
	const POSE_KEYS = {
		straight: 'face.pose_straight',
		left: 'face.pose_left',
		right: 'face.pose_right',
		up: 'face.pose_up',
		down: 'face.pose_down'
	} as const;
	/** No face for this long during capture is said once, then again after the next face. */
	const NO_FACE_AFTER_MS = 3000;
	const RING_RADIUS = 16;
	const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
	const settings = readKioskSettings();
	const narrator = createKioskNarrator(browserNarratorPlatform(), {
		language: kioskVoiceLanguage(bolt.locale),
		enabled: settings.voiceEnabled
	});
	const kinds = useKinds();
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
	let pendingApproval = $state(false);
	/** A pending or suspended enrollment is HR's to review; the command would refuse it. */
	let blocked = $derived(
		record.face_enrollment_status === 'PENDING' || record.face_enrollment_status === 'SUSPENDED'
	);
	/** Imperative handles and bookkeeping nothing renders from: plain fields, not state. */
	const handles: {
		videoNode: HTMLVideoElement | null;
		stream: MediaStream | null;
		engine: Human | null;
		canvas: HTMLCanvasElement | null;
		inFlight: boolean;
		absentSince: number;
		absentSpoken: boolean;
		spokenPose: GuidedPose | null;
		disposed: boolean;
	} = {
		videoNode: null,
		stream: null,
		engine: null,
		canvas: null,
		inFlight: false,
		absentSince: 0,
		absentSpoken: false,
		spokenPose: null,
		disposed: false
	};
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
							: t(GUIDE_KEYS[target])
	);
	const poseLabel = (pose: GuidedPose): string => t(POSE_KEYS[pose]);
	const stopCamera = () => {
		closeCamera(handles.stream);
		handles.stream = null;
	};
	$effect(() => {
		narrator.setLanguage(kioskVoiceLanguage(bolt.locale));
	});
	const restartCapture = () => {
		guided = initialGuidedCapture();
		samples = {};
		handles.spokenPose = null;
		handles.absentSince = 0;
		handles.absentSpoken = false;
		consent = false;
		error = null;
		step = 'capture';
	};
	class EnrollmentFailed extends Schema.TaggedError<EnrollmentFailed>()('EnrollmentFailed', {
		message: Schema.String
	}) {}
	const enrollmentFailed = (cause: unknown) =>
		new EnrollmentFailed({ message: getErrorMessage(cause) });
	const startCapture = Effect.fnUntraced(function* (node: HTMLVideoElement) {
		handles.videoNode = node;
		handles.disposed = false;
		warming = true;
		fatal = null;
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				handles.disposed = true;
				handles.videoNode = null;
				narrator.stop();
			})
		);
		const stream = yield* Effect.acquireRelease(openCamera('user'), (stream) =>
			Effect.sync(() => {
				closeCamera(stream);
				handles.stream = null;
			})
		);
		handles.stream = stream;
		showStream(node, stream);
		const engine = yield* Effect.acquireRelease(warmFaceEngine(), (engine) =>
			Effect.sync(() => {
				engine.reset();
				handles.engine = null;
			})
		);
		handles.engine = engine;
		const prepared = yield* Effect.try({
			try: () => ({ canvas: createAnalyseCanvas(), missing: missingFaceModels(engine) }),
			catch: enrollmentFailed
		});
		handles.canvas = prepared.canvas;
		engineMissing = prepared.missing;
		ready = engineMissing.length === 0;
		warming = false;
	});
	/**
	 * One frame: the largest face's rotation goes to the pose machine, and the frame that completes
	 * a pose's hold becomes that pose's sample. Guidance is spoken when the target changes.
	 */
	const tick = Effect.fnUntraced(function* () {
		if (
			step !== 'capture' ||
			!ready ||
			handles.engine === null ||
			handles.canvas === null ||
			handles.videoNode === null ||
			handles.inFlight ||
			!drawVideoFrame(handles.videoNode, handles.canvas)
		)
			return;
		const engine = handles.engine,
			canvas = handles.canvas;
		handles.inFlight = true;
		return yield* Effect.gen(function* () {
			const started = yield* Clock.monotonicTimeNanos;
			const result = yield* Effect.tryPromise({
				try: () => engine.detect(canvas),
				catch: enrollmentFailed
			});
			if (handles.disposed) return;
			const face = largestFace(result.face ?? []);
			const nowMs = yield* Clock.currentTimeMillis;
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
				if (handles.absentSince === 0) handles.absentSince = nowMs;
				else if (!handles.absentSpoken && nowMs - handles.absentSince >= NO_FACE_AFTER_MS) {
					handles.absentSpoken = true;
					narrator.say('enroll_no_face');
				}
			} else {
				handles.absentSince = 0;
				handles.absentSpoken = false;
			}
			if (observed.capture !== null && face !== undefined) {
				const sample = sampleFromFace(
					face,
					canvas,
					Duration.toMillis(Duration.nanos((yield* Clock.monotonicTimeNanos) - started))
				);
				if (sample !== null) samples = { ...samples, [observed.capture]: sample };
			}
			const next = targetPose(guided);
			if (next === null) {
				narrator.say('enroll_done');
				step = 'review';
			} else if (next !== handles.spokenPose && face !== undefined) {
				handles.spokenPose = next;
				const phrase = POSE_PHRASES[next];
				if (phrase !== undefined) narrator.say(phrase);
			}
		}).pipe(
			Effect.catch((failure) =>
				Effect.sync(() => {
					if (!handles.disposed) error = getErrorMessage(failure);
				})
			),
			Effect.ensuring(
				Effect.sync(() => {
					handles.inFlight = false;
				})
			)
		);
	});
	const attachVideo = attach<HTMLVideoElement>((node) =>
		Effect.gen(function* () {
			yield* startCapture(node);
			yield* tick().pipe(Effect.repeat(Schedule.spaced(KIOSK_LOOP_MS)));
		}).pipe(
			Effect.catch((failure) =>
				Effect.sync(() => {
					fatal = getErrorMessage(failure);
				})
			),
			Effect.ensuring(
				Effect.sync(() => {
					warming = false;
					ready = false;
				})
			)
		)
	);
	const canvasToFile = (source: HTMLCanvasElement) =>
		Effect.callback<File, EnrollmentFailed>((resume) => {
			source.toBlob(
				(blob) =>
					resume(
						blob === null
							? Effect.fail(enrollmentFailed('Snapshot encoding failed.'))
							: Effect.succeed(new File([blob], 'face.jpg', { type: 'image/jpeg' }))
					),
				'image/jpeg',
				0.8
			);
		});
	const finish = (previewUrl: string) => {
		stopCamera();
		pendingApproval = false;
		step = 'done';
		onsaved(previewUrl);
	};
	/** Upload the straight-on snapshot, then enrol the averaged descriptor with it. */
	const enroll = () => {
		if (!consent || !complete || submitting) return;
		const photo = samples.straight ?? orderedSamples[0];
		if (photo === undefined) return;
		submitting = true;
		error = null;
		const target = record.id;
		const vectors = orderedSamples.map((sample: KioskSample) => sample.vector);
		const enrollFace = Effect.fnUntraced(function* () {
			const embedding = yield* Effect.try({
				try: () => meanEmbedding(vectors),
				catch: enrollmentFailed
			});
			const upload = kinds.upload;
			if (upload === undefined)
				return yield* Effect.fail(enrollmentFailed(t('face.upload_unavailable')));
			const file = yield* canvasToFile(photo.canvas);
			const facePhoto = yield* upload(file, 'employment_profile.face_photo');
			const now = Instant(new Date(yield* Clock.currentTimeMillis));
			const payload: ActInput<'employment_profile.update'> = {
				target,
				set: {
					face_embedding: embedding,
					face_photo: fileRef(facePhoto),
					face_consent_at: now,
					face_enrolled_at: now,
					face_enrollment_status: 'APPROVED'
				}
			};
			const outcome = yield* bolt.act('employment_profile.update', payload);
			if (handles.disposed) return;
			if (outcome.kind === 'pendingApproval') {
				stopCamera();
				pendingApproval = true;
				step = 'done';
			} else if (outcome.kind === 'committed') finish(photo.dataUrl);
		});
		fork(
			enrollFace().pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						if (!handles.disposed) error = getErrorMessage(failure);
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						submitting = false;
					})
				)
			)
		);
	};
</script>

<Stack gap="md" data-face-enroll-step={step}>
	<Columns as="ol" count={3} gap="sm" collapse="none" aria-label={t('face.progress')}>
		{#each STEPS as name, index (name)}
			<li
				class="border-t-2 pt-2 text-meta {index <= STEPS.indexOf(step)
					? 'border-primary text-foreground'
					: 'border-border'}"
			>
				{t(`face.step_${name}`)}
			</li>
		{/each}
	</Columns>
	<!-- Steps hide with the `hidden` attribute rather than an `{#if}`, so the camera loop and
		the captures survive step changes. -->
	<Stack hidden={step !== 'capture'} gap="md">
		<Frame ratio="widescreen" class="relative w-full rounded-xl bg-foreground">
			<video {@attach attachVideo} playsinline autoplay muted class="-scale-x-100"></video>
			{#if warming}
				<Imposter placement="fill" class="bg-black/40">
					<Inline justify="center" fill>
						<Spinner class="size-8 text-white" label={t('face.preparing')} />
					</Inline>
				</Imposter>
			{/if}
			<Imposter placement="bottom" class="p-3">
				<p
					class="rounded-lg bg-black/65 px-4 py-2 text-center text-sm font-medium text-white"
					role="status"
					aria-live="polite"
					data-pose-target={target ?? ''}
				>
					{guidance}
				</p>
			</Imposter>
		</Frame>
		<Grid as="ol" tracks="repeat(5, minmax(0, 1fr))" gap="sm" aria-label={t('face.poses')}>
			{#each GUIDED_POSES as pose (pose)}
				{@const progress = poseProgress(guided, pose, now)}
				{@const done = guided.captured.includes(pose)}
				<Stack
					as="li"
					gap="xs"
					align="center"
					class="text-meta {pose === target ? 'text-foreground' : ''}"
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
				</Stack>
			{/each}
		</Grid>
		{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		<Inline justify="end" class="border-t pt-4">
			<Button variant="ghost" onclick={onclose}>{t('face.cancel')}</Button>
		</Inline>
	</Stack>

	<Stack hidden={step !== 'review'} gap="md">
		<p class="text-sm text-muted-foreground">{t('face.review_description')}</p>
		<Grid as="ul" tracks="repeat(5, minmax(0, 1fr))" gap="sm" aria-label={t('face.captures')}>
			{#each GUIDED_POSES as pose (pose)}
				{@const sample = samples[pose]}
				<li class="rounded-lg border bg-background">
					{#if sample !== undefined}
						<Frame ratio="widescreen" class="rounded-t-lg">
							<img class="-scale-x-100" src={sample.dataUrl} alt={poseLabel(pose)} />
						</Frame>
					{/if}
					<p class="px-2 py-1 text-center text-meta">{poseLabel(pose)}</p>
				</li>
			{/each}
		</Grid>
		<label class="rounded-lg border bg-background p-4 text-sm font-medium">
			<Inline as="span" gap="sm">
				<input class="size-4" type="checkbox" bind:checked={consent} />
				{t('face.consent')}
			</Inline>
		</label>
		{#if blocked}
			<p role="note" class="text-sm text-warning-foreground">
				{record.face_enrollment_status === 'PENDING'
					? t('face.status_pending')
					: t('face.status_suspended')}
			</p>
		{/if}
		{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		<Cluster justify="between" gap="sm" class="border-t pt-4">
			<Button variant="ghost" onclick={restartCapture} disabled={submitting}>
				<Icon name="lucide:rotate-ccw" class="size-4" />
				{t('face.recapture')}
			</Button>
			<Button
				type="button"
				disabled={submitting || !consent || !complete || blocked}
				onclick={() => void enroll()}
			>
				{#if submitting}
					<Icon name="lucide:loader-circle" class="size-4 animate-spin" />
				{/if}
				{submitting ? t('face.enrolling') : t('face.enroll')}
			</Button>
		</Cluster>
	</Stack>

	<Stack hidden={step !== 'done'} gap="md">
		<Inline
			align="start"
			gap="sm"
			class={pendingApproval
				? 'rounded-lg bg-muted p-4 text-muted-foreground'
				: 'rounded-lg bg-success/10 p-4 text-success'}
			role="status"
		>
			<Icon
				name={pendingApproval ? 'lucide:clock' : 'lucide:circle-check'}
				class="mt-0.5 size-5 shrink-0"
			/>
			<p class="text-sm font-medium">{t(pendingApproval ? 'offboarding.pending' : 'face.saved')}</p>
		</Inline>
		<Inline justify="end" class="border-t pt-4">
			<Button onclick={onclose}>{t('face.close')}</Button>
		</Inline>
	</Stack>
</Stack>
