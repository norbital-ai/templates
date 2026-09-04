<script lang="ts">
	import Human from '@vladmandic/human';
	import { client } from '../../lib/workspace-client.js';
	import { Cover, Stack } from '@norbital-ai/ui/layout';
	import ManualTab from './kiosk-manual.svelte';
	import EnrollTab from './kiosk-enroll.svelte';
	import type { KioskSample } from '../../lib/kiosk/sample.js';
	import {
		KIOSK_ANALYSE_HEIGHT,
		KIOSK_ANALYSE_WIDTH,
		KIOSK_BLINK_WINDOW_S,
		KIOSK_CAPTURE_HEIGHT,
		KIOSK_CAPTURE_WIDTH,
		KIOSK_ENROLL_SAMPLES,
		KIOSK_LOOP_MS,
		KIOSK_MATCH_THRESHOLD,
		KIOSK_MIN_FACE_PX,
		KIOSK_MODEL_BASE,
		KIOSK_REAL_MIN
	} from '../../lib/kiosk/config.js';

	type Tab = 'scan' | 'manual' | 'enroll';
	type Phase = 'boot' | 'scan' | 'challenge' | 'working' | 'done' | 'blocked' | 'unknown' | 'error';

	type Candidate = Readonly<{
		employeeId: string;
		employeeName: string;
		employmentId: string;
		employeeNumber: string;
		distance: number;
		real: number;
	}>;

	type PunchResult = Readonly<{
		status: string;
		intervalIndex?: number;
		time?: string;
		reason?: string;
		retryAfterMs?: number;
	}>;

	let tab = $state<Tab>('scan');
	let phase = $state<Phase>('boot');
	let booting = $state('Starting camera…');
	let fatal = $state<string | null>(null);
	let candidate = $state<Candidate | null>(null);
	let punch = $state<PunchResult | null>(null);
	let notice = $state<string | null>(null);
	let challengeLeft = $state(0);

	let videoEl: HTMLVideoElement | null = $state(null);
	let stream: MediaStream | null = $state(null);
	let human: Human | null = null;
	let loopTimer: ReturnType<typeof setInterval> | null = null;
	let inFlight = false;
	let challengeDeadline = 0;
	let doneTimer: ReturnType<typeof setTimeout> | null = null;

	const analyseCanvas = document.createElement('canvas');
	analyseCanvas.width = KIOSK_ANALYSE_WIDTH;
	analyseCanvas.height = KIOSK_ANALYSE_HEIGHT;

	const humanConfig = (backend: 'webgl' | 'wasm') => ({
		backend,
		modelBasePath: KIOSK_MODEL_BASE,
		debug: false,
		warmup: 'none' as const,
		cacheModels: true,
		async: false,
		face: {
			enabled: true,
			detector: {
				modelPath: 'blazeface.json',
				rotation: false,
				maxDetected: 3,
				minConfidence: 0.2,
				minSize: KIOSK_MIN_FACE_PX,
				scale: 1.4,
				skipFrames: 0,
				skipTime: 0
			},
			description: {
				enabled: true,
				modelPath: 'faceres.json',
				minConfidence: 0.2,
				skipFrames: 0,
				skipTime: 0
			},
			antispoof: { enabled: true, modelPath: 'antispoof.json', skipFrames: 0, skipTime: 0 },
			iris: { enabled: true, modelPath: 'iris.json' },
			mesh: { enabled: true, modelPath: 'facemesh.json' },
			emotion: { enabled: false },
			attention: { enabled: false },
			liveness: { enabled: false },
			gear: { enabled: false }
		},
		hand: { enabled: false },
		body: { enabled: false },
		object: { enabled: false },
		gesture: { enabled: true }
	});

	const drawFrame = (): boolean => {
		const video = videoEl;
		if (video === null || video.readyState < 2) return false;
		const ctx = analyseCanvas.getContext('2d', { willReadFrequently: true });
		if (ctx === null) return false;
		const shrink = Math.min(
			KIOSK_ANALYSE_WIDTH / video.videoWidth,
			KIOSK_ANALYSE_HEIGHT / video.videoHeight,
			1
		);
		const dw = video.videoWidth * shrink;
		const dh = video.videoHeight * shrink;
		ctx.drawImage(video, (KIOSK_ANALYSE_WIDTH - dw) / 2, (KIOSK_ANALYSE_HEIGHT - dh) / 2, dw, dh);
		return true;
	};

	const largestFace = (
		faces: ReadonlyArray<{
			readonly box?: readonly [number, number, number, number];
			readonly embedding?: number[];
			readonly score: number;
			readonly real?: number;
		}>
	) => {
		let best: (typeof faces)[number] | undefined;
		let bestSize = 0;
		for (const face of faces) {
			const size = (face.box?.[2] ?? 0) * (face.box?.[3] ?? 0);
			if (size > bestSize) {
				bestSize = size;
				best = face;
			}
		}
		return best;
	};

	const startCamera = async () => {
		if (stream !== null) return;
		stream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: { ideal: 'environment' },
				width: { ideal: KIOSK_CAPTURE_WIDTH },
				height: { ideal: KIOSK_CAPTURE_HEIGHT }
			},
			audio: false
		});
		if (videoEl !== null) {
			videoEl.srcObject = stream;
			await videoEl.play();
		}
	};

	const stopCamera = () => {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	};

	const stopLoop = () => {
		if (loopTimer !== null) {
			clearInterval(loopTimer);
			loopTimer = null;
		}
	};

	const resumeScan = () => {
		if (doneTimer !== null) {
			clearTimeout(doneTimer);
			doneTimer = null;
		}
		candidate = null;
		punch = null;
		notice = null;
		inFlight = false;
		phase = 'scan';
	};

	const toScan = () => {
		tab = 'scan';
		resumeScan();
	};

	const boot = async () => {
		phase = 'boot';
		try {
			booting = 'Starting camera…';
			await startCamera();
			booting = 'Loading recognition models…';
			try {
				human = new Human(humanConfig('webgl'));
				await human.warmup({ face: { enabled: true } });
			} catch {
				human = new Human(humanConfig('wasm'));
				await human.warmup({ face: { enabled: true } });
			}
			phase = 'scan';
			loopTimer = setInterval(() => void tick(), KIOSK_LOOP_MS);
		} catch (error) {
			phase = 'error';
			fatal = error instanceof Error ? error.message : String(error);
		}
	};

	const tick = async () => {
		if (tab !== 'scan' || human === null || inFlight) return;
		if (phase !== 'scan' && phase !== 'challenge') return;
		if (!drawFrame()) return;
		let result: Awaited<ReturnType<Human['detect']>>;
		try {
			result = await human.detect(analyseCanvas);
		} catch {
			return;
		}
		const face = largestFace(result.face ?? []);
		if (phase === 'challenge') {
			challengeLeft = Math.max(0, Math.ceil((challengeDeadline - Date.now()) / 1000));
			const blinked = (result.gesture ?? []).some(
				(gesture) =>
					'face' in gesture &&
					gesture.face === 0 &&
					(gesture.gesture === 'blink left eye' || gesture.gesture === 'blink right eye')
			);
			if (blinked && candidate !== null) {
				await doPunch(candidate.employmentId, 'FACE');
				return;
			}
			if (Date.now() > challengeDeadline) {
				notice = 'No blink seen — punch cancelled.';
				phase = 'scan';
				candidate = null;
			}
			return;
		}
		if (face === undefined || face.embedding === undefined) return;
		inFlight = true;
		try {
			const matched = await client.invoke.kiosk_match({
				probe: face.embedding,
				threshold: KIOSK_MATCH_THRESHOLD
			});
			if (matched.status === 'unenrolled') {
				notice = `${matched.employee.name} is recognized but has no active employment.`;
				phase = 'scan';
				return;
			}
			if (matched.status !== 'match') {
				phase = 'unknown';
				return;
			}
			const real = face.real ?? 0;
			candidate = {
				employeeId: matched.employee.id,
				employeeName: matched.employee.name,
				employmentId: matched.employment.id,
				employeeNumber: matched.employment.employee_number,
				distance: matched.distance,
				real
			};
			if (real < KIOSK_REAL_MIN) {
				notice = 'This looks like a photo or screen — punch refused. Show a live face.';
				phase = 'scan';
				candidate = null;
				return;
			}
			phase = 'challenge';
			challengeDeadline = Date.now() + KIOSK_BLINK_WINDOW_S * 1000;
			challengeLeft = KIOSK_BLINK_WINDOW_S;
		} catch (error) {
			notice = error instanceof Error ? error.message : String(error);
		} finally {
			inFlight = false;
		}
	};

	const doPunch = async (
		employmentId: string,
		kind: 'FACE' | 'MANUAL',
		direction?: 'in' | 'out'
	) => {
		phase = 'working';
		try {
			const result = await client.invoke.kiosk_punch({
				employment_id: employmentId,
				kind,
				...(direction === undefined ? {} : { direction })
			});
			punch = {
				status: result.status,
				intervalIndex: 'intervalIndex' in result ? result.intervalIndex : undefined,
				time: 'time' in result ? result.time : undefined,
				reason: 'reason' in result ? String(result.reason) : undefined,
				retryAfterMs: 'retryAfterMs' in result ? Number(result.retryAfterMs) : undefined
			};
			phase = result.status === 'blocked' ? 'blocked' : 'done';
			if (phase !== 'blocked') {
				doneTimer = setTimeout(resumeScan, 3500);
			}
		} catch (error) {
			notice = error instanceof Error ? error.message : String(error);
			phase = 'scan';
			candidate = null;
		}
	};

	const clockTime = (iso: string | undefined) =>
		iso === undefined
			? '—'
			: new Date(iso).toLocaleTimeString([], {
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit'
				});

	/** One analysed frame for enrollment: largest face wins, same pipeline as the loop. */
	const analyzeSample = async (): Promise<KioskSample | null> => {
		if (human === null || !drawFrame()) return null;
		const start = performance.now();
		const result = await human.detect(analyseCanvas);
		const face = largestFace(result.face ?? []);
		if (face === undefined || face.embedding === undefined) return null;
		const snapshot = document.createElement('canvas');
		snapshot.width = analyseCanvas.width;
		snapshot.height = analyseCanvas.height;
		snapshot.getContext('2d')?.drawImage(analyseCanvas, 0, 0);
		return {
			canvas: snapshot,
			dataUrl: snapshot.toDataURL('image/jpeg', 0.7),
			vector: [...face.embedding],
			score: Math.round(face.score * 100) / 100,
			box: `${Math.round(face.box?.[2] ?? 0)}x${Math.round(face.box?.[3] ?? 0)}`,
			ms: Math.round((performance.now() - start) * 10) / 10
		};
	};

	$effect(() => {
		void boot();
		return () => {
			stopLoop();
			stopCamera();
			human?.reset();
			if (doneTimer !== null) clearTimeout(doneTimer);
		};
	});
</script>

<svelte:head>
	<title>Attendance Kiosk</title>
	<meta name="description" content="Face-recognition time clock for the shop floor." />
	<meta name="bolt:icon" content="lucide:scan-face" />
	<meta name="bolt:kiosk" content="true" />
</svelte:head>

<Cover as="main">
	{#if phase === 'boot'}
		<Stack align="center" justify="center" fill gap="sm">
			<p role="status">{booting}</p>
		</Stack>
	{:else if phase === 'error'}
		<Stack align="center" justify="center" fill gap="sm">
			<p role="alert">Kiosk unavailable: {fatal}</p>
			<button
				onclick={() => {
					fatal = null;
					void boot();
				}}>Retry</button
			>
			<p>Camera needs HTTPS and a granted permission; models load from this workspace.</p>
		</Stack>
	{:else}
		<div class="flex gap-2 p-3" role="tablist">
			<button role="tab" aria-selected={tab === 'scan'} onclick={toScan}>Clock in / out</button>
			<button role="tab" aria-selected={tab === 'manual'} onclick={() => (tab = 'manual')}
				>Manual entry</button
			>
			<button role="tab" aria-selected={tab === 'enroll'} onclick={() => (tab = 'enroll')}
				>Enroll face</button
			>
		</div>
		{#if tab === 'scan'}
			<div class="flex min-h-0 flex-col items-center gap-3 p-3">
				<video bind:this={videoEl} playsinline autoplay muted class="w-[min(480px,90vw)] rounded-lg"
				></video>
				{#if phase === 'scan' && notice !== null}
					<p role="status" class="text-sm text-destructive">{notice}</p>
				{/if}
				{#if phase === 'challenge' && candidate !== null}
					<div class="flex flex-col items-center gap-1 text-lg">
						<strong>{candidate.employeeName}</strong>
						<span>{candidate.employeeNumber}</span>
						<p role="status" class="text-2xl font-bold">Blink to confirm — {challengeLeft}s</p>
					</div>
				{/if}
				{#if phase === 'working'}
					<p role="status">Recording…</p>
				{/if}
				{#if phase === 'done' && punch !== null}
					<div class="flex flex-col items-center gap-1 text-lg font-bold">
						<strong>{punch.status === 'in' ? 'Clocked in' : 'Clocked out'}</strong>
						<span>{candidate?.employeeName}</span>
						<span>{clockTime(punch.time)} · entry #{(punch.intervalIndex ?? 0) + 1}</span>
					</div>
				{/if}
				{#if phase === 'blocked'}
					<div class="flex flex-col items-center gap-1 text-lg">
						<strong>Punch refused</strong>
						<span
							>{punch?.reason === 'cooldown'
								? `Too soon — wait ${Math.ceil((punch?.retryAfterMs ?? 0) / 1000)}s.`
								: 'Duplicate punch.'}</span
						>
						<button onclick={resumeScan}>Back to clock</button>
					</div>
				{/if}
				{#if phase === 'unknown'}
					<div class="flex flex-col items-center gap-1 text-lg">
						<strong>Face not recognized</strong>
						<button
							onclick={() => {
								tab = 'enroll';
							}}>Enroll this person</button
						>
						<button onclick={resumeScan}>Keep scanning</button>
					</div>
				{/if}
			</div>
		{:else if tab === 'manual'}
			<ManualTab ondone={toScan} />
		{:else}
			<EnrollTab ondone={toScan} ensureCamera={startCamera} {analyzeSample} />
		{/if}
	{/if}
</Cover>
