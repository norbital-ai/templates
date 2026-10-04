<script lang="ts">
	/**
	 * The attendance kiosk: a full-screen time clock for one legal entity. A live face held in the outline for two
	 * seconds is matched on the device's descriptor (`employees.kiosk_match`) and punched (`work_days.kiosk_punch`);
	 * the manual tab keys a punch by name. The engine, anti-spoof, voice and silhouette are this page's own modules.
	 */
	import { t } from '../../lib/ui/i18n/t.js';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import type Human from '@vladmandic/human';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Button, Picker, Spinner } from '@norbital-ai/ui';
	import {
		Bound,
		Center,
		Cluster,
		Cover,
		Frame,
		Imposter,
		Inline,
		Scroll,
		Stack
	} from '@norbital-ai/ui/layout';
	import { liveRows } from '../../lib/ui/state/live.svelte.js';
	import ManualTab from './manual.svelte';
	import { punchWork, type PunchResult as PunchCommandResult } from './punch.js';
	import {
		createAnalyseCanvas,
		drawVideoFrame,
		missingFaceModels,
		showStream,
		openCamera,
		closeCamera,
		unpaddedFaceBox,
		warmFaceEngine
	} from './face.ts';
	import {
		KIOSK_CAPTURE_HEIGHT,
		KIOSK_CAPTURE_WIDTH,
		KIOSK_LOOP_MS
	} from './config.ts';
	import { KIOSK_MATCH_THRESHOLD } from './embed.ts';
	import { readKioskSettings, writeKioskSettings } from './settings.ts';
	import { browserNarratorPlatform, createKioskNarrator } from './voice.ts';
	import { kioskVoiceLanguage, type KioskPhraseKey } from './phrases.ts';
	import { blockedPhraseKey } from './punch.ts';
	import {
		faceInsideSilhouette,
		fitFrame,
		silhouetteGeometry,
		type FrameSize
	} from './silhouette.ts';
	import { loadAntiSpoof, scoreAntiSpoof } from './anti-spoof.ts';
	import {
		observeKioskHold,
		kioskSecondsLeft,
		sameKioskPerson,
		type KioskHold
	} from './hold.ts';
	import { getErrorMessage } from '../../lib/payroll_engine/foundation/primitives.js';

	type Tab = 'scan' | 'manual';
	type Direction = 'in' | 'out';
	type Phase =
		| 'boot'
		| 'scan'
		| 'challenge'
		| 'working'
		| 'done'
		| 'blocked'
		| 'unknown'
		| 'rejected'
		| 'unavailable'
		| 'error';
	type StatusTone = 'neutral' | 'success' | 'warning' | 'error';
	/** What the loop tells a person it can see but cannot read, or cannot see at all. */
	type Hint = 'move_closer' | 'no_face' | 'live_face_required';

	type Candidate = Readonly<{
		employeeName: string;
		employmentId: Id<'employments'>;
		employeeNumber: string;
		companyId: Id<'companies'>;
	}>;

	type PunchResult = Readonly<{
		status: string;
		intervalIndex?: number;
		time?: string;
		reason?: string;
		retryAfterMs?: number;
		/** The roster code the day is planned as, when that is why the punch was blocked. */
		plannedCode?: string;
	}>;
	/** What `employees.kiosk_match` answers. */
	type MatchResult =
		| { readonly status: 'unknown' }
		| {
				readonly status: 'unenrolled';
				readonly employee: { readonly id: Id<'employees'>; readonly name: string };
		  }
		| {
				readonly status: 'match';
				readonly employee: { readonly id: Id<'employees'>; readonly name: string };
				readonly employment: {
					readonly id: Id<'employments'>;
					readonly employee_number: string;
					readonly company_id: Id<'companies'>;
				};
		  };

	type KioskStatus = Readonly<{
		tone: StatusTone;
		icon: string;
		title: string;
		detail: string;
	}>;

	const settings = readKioskSettings();

	let tab = $state<Tab>('scan');
	let selectedCompanyId = $state<Id<'companies'> | null>(null);
	let manualWorking = $state(false);
	let phase = $state<Phase>('boot');
	let fatal = $state<string | null>(null);
	/** The enabled face models the engine failed to load; non-empty is the `unavailable` phase. */
	let engineMissing = $state<string[]>([]);
	let candidate = $state<Candidate | null>(null);
	let punch = $state<PunchResult | null>(null);
	let notice = $state<KioskStatus | null>(null);
	let hint = $state<Hint | null>(null);
	let hold = $state.raw<KioskHold | null>(null);
	const challengeLeft = $derived(hold === null ? 0 : kioskSecondsLeft(hold));
	let voiceEnabled = $state(settings.voiceEnabled);
	let now = $state(new Date());
	// Bolt gap: a page reads no organization identity, so the header shows the fallback name and initials.
	const organizationName = '';
	const organizationLogoUrl: string | null = null;
	/** The cell the camera frame is given, measured; the frame is the video's ratio fitted inside it. */
	let cell = $state<FrameSize>({ width: KIOSK_CAPTURE_WIDTH, height: KIOSK_CAPTURE_HEIGHT });
	/** What the camera actually delivers: iOS rotates it with the tablet, so it is read off the video. */
	let videoSize = $state<FrameSize>({ width: KIOSK_CAPTURE_WIDTH, height: KIOSK_CAPTURE_HEIGHT });
	const frame = $derived(fitFrame(cell, videoSize));
	const silhouette = $derived(silhouetteGeometry(frame));

	/** Imperative handles and bookkeeping nothing renders from: plain fields, not state. */
	const handles: {
		videoNode: HTMLVideoElement | null;
		stream: MediaStream | null;
		human: Human | null;
		antiSpoof: Awaited<ReturnType<typeof loadAntiSpoof>> | null;
		cropCanvas: HTMLCanvasElement | null;
		analyseCanvas: HTMLCanvasElement | null;
		loopTimer: ReturnType<typeof setInterval> | null;
		clockTimer: ReturnType<typeof setInterval> | null;
		resetTimer: ReturnType<typeof setTimeout> | null;
		inFlight: boolean;
		/** One recognition request at a time; the next frame of the hold asks again if it came back empty. */
		matchInFlight: boolean;
		lastFrameTime: number;
		scanSession: object;
		completedProbe: readonly number[] | null;
		disposed: boolean;
		unreadableSince: number;
		absentSince: number;
	} = {
		videoNode: null,
		stream: null,
		human: null,
		antiSpoof: null,
		cropCanvas: null,
		analyseCanvas: null,
		loopTimer: null,
		clockTimer: null,
		resetTimer: null,
		inFlight: false,
		matchInFlight: false,
		lastFrameTime: -1,
		scanSession: {},
		completedProbe: null,
		disposed: false,
		unreadableSince: 0,
		absentSince: 0
	};
	/**
	 * Everything the kiosk says goes through here: pre-generated clips, one phrase at a time, never
	 * two at once. Created at init so the voice toggle and the locale effect below can reach it.
	 */
	const narrator = createKioskNarrator(browserNarratorPlatform(), {
		language: kioskVoiceLanguage(bolt.locale),
		enabled: settings.voiceEnabled
	});
	const spokenHints = new Set<Hint>();

	/** A face that stays in frame without an embedding this long is too small or unclear to read. */
	const MOVE_CLOSER_AFTER_MS = 2000;
	/** No face at all for this long. */
	const NO_FACE_AFTER_MS = 5000;
	const STATUS_TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
		neutral: 'border-border bg-card text-foreground',
		success: 'border-success/30 bg-success/10 text-success',
		warning:
			'border-warning/40 bg-warning/10 text-warning-foreground dark:border-warning/30 dark:text-warning',
		error: 'border-destructive/30 bg-destructive/10 text-destructive'
	};

	const companies = liveRows(() =>
		bolt.read('companies', {
			where: { approval_id: { isNull: true } },
			select: { name: true },
			orderBy: 'name',
			limit: 200
		})
	);
	const companyById = $derived(
		new Map((companies.current ?? []).map((company) => [company.id, company.name]))
	);
	const companyId = $derived(
		selectedCompanyId != null && companyById.has(selectedCompanyId) ? selectedCompanyId : null
	);
	const candidateCompany = $derived(
		candidate === null
			? t('kiosk.entity_unknown')
			: (companyById.get(candidate.companyId) ?? t('kiosk.entity_unknown'))
	);
	const organizationDisplayName = $derived(
		organizationName.trim() || t('kiosk.organization_fallback')
	);
	const organizationInitials = $derived(
		organizationDisplayName
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0] ?? '')
			.join('')
			.toUpperCase()
	);
	const currentTime = $derived(
		new Intl.DateTimeFormat(bolt.locale, {
			hour: '2-digit',
			minute: '2-digit'
		}).format(now)
	);
	const currentDate = $derived(
		new Intl.DateTimeFormat(bolt.locale, {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(now)
	);
	/**
	 * Which half of the day this punch turned out to be, from what the command actually wrote.
	 * Nobody chose it: the first punch of the day is the arrival and every later one moves the
	 * departure, so the answer only exists once the write has happened.
	 */
	const recordedDirection = $derived<Direction | null>(
		punch?.status === 'in' || punch?.status === 'out' ? punch.status : null
	);

	const blockedStatus = (): KioskStatus => {
		// Not rostered today is not a failure and must not be dressed as one: the person did nothing
		// wrong, and the only useful thing the screen can do is name the day's plan.
		if (punch?.reason === 'not-scheduled')
			return {
				tone: 'warning',
				icon: 'lucide:calendar-off',
				title: t('kiosk.not_scheduled'),
				detail: t('kiosk.not_scheduled_detail')
			};
		if (punch?.reason === 'not-a-work-day')
			return {
				tone: 'warning',
				icon: 'lucide:calendar-off',
				title: t('kiosk.not_a_work_day'),
				detail: t('kiosk.not_a_work_day_detail', { code: punch.plannedCode ?? '—' })
			};
		if (punch?.reason === 'cooldown')
			return {
				tone: 'warning',
				icon: 'lucide:timer-reset',
				title: t('kiosk.too_soon'),
				detail: t('kiosk.too_soon_detail', {
					seconds: Math.ceil((punch.retryAfterMs ?? 0) / 1000)
				})
			};
		return {
			tone: 'warning',
			icon: 'lucide:circle-alert',
			title: t('kiosk.unchanged'),
			detail: t('kiosk.unchanged_detail')
		};
	};

	const hintStatus = (kind: Hint): KioskStatus =>
		kind === 'live_face_required'
			? {
					tone: 'warning',
					icon: 'lucide:shield-alert',
					title: t('kiosk.live_face_required'),
					detail: t('kiosk.live_face_required_detail')
				}
			: kind === 'move_closer'
				? {
						tone: 'warning',
						icon: 'lucide:scan-face',
						title: t('kiosk.move_closer'),
						detail: t('kiosk.move_closer_detail')
					}
				: {
						tone: 'warning',
						icon: 'lucide:user-round-search',
						title: t('kiosk.no_face'),
						detail: t('kiosk.no_face_detail')
					};

	const status = $derived.by((): KioskStatus => {
		if (notice !== null) return notice;
		if (companyId == null)
			return {
				tone: 'neutral',
				icon: 'lucide:building-2',
				title: t('component.choose_legal_entity'),
				detail: companies.error ?? t('kiosk.choose_entity_before_punch')
			};
		if (tab === 'manual')
			return {
				tone: 'neutral',
				icon: 'lucide:keyboard',
				title: t('kiosk.manual_entry'),
				detail: t('kiosk.manual_status')
			};
		if (phase === 'boot')
			return {
				tone: 'neutral',
				icon: 'lucide:loader-circle',
				title: t('kiosk.preparing'),
				detail: t('kiosk.preparing_detail')
			};
		if (phase === 'error')
			return {
				tone: 'error',
				icon: 'lucide:camera-off',
				title: t('kiosk.camera_unavailable'),
				detail: fatal ?? t('kiosk.camera_help')
			};
		if (phase === 'unavailable')
			return {
				tone: 'error',
				icon: 'lucide:cpu',
				title: t('kiosk.engine_unavailable'),
				detail: t('kiosk.engine_unavailable_detail', { models: engineMissing.join(', ') })
			};
		if (phase === 'challenge')
			return {
				tone: 'neutral',
				icon: 'lucide:scan-face',
				title:
					candidate === null
						? t('kiosk.reading_face')
						: t('kiosk.identity_confirmed', { name: candidate.employeeName }),
				detail: t('kiosk.countdown_detail', { seconds: challengeLeft })
			};
		if (phase === 'working')
			return {
				tone: 'neutral',
				icon: 'lucide:loader-circle',
				title: t('kiosk.recording'),
				detail: t('kiosk.recording_detail')
			};
		if (phase === 'done' && candidate !== null)
			return {
				tone: 'success',
				icon: 'lucide:circle-check',
				title: recordedDirection === 'out' ? t('kiosk.recorded_out') : t('kiosk.recorded_in'),
				detail: t('kiosk.recorded_detail', {
					name: candidate.employeeName,
					time: clockTime(punch?.time)
				})
			};
		if (phase === 'blocked') return blockedStatus();
		if (phase === 'unknown')
			return {
				tone: 'warning',
				icon: 'lucide:user-round-question',
				title: t('kiosk.unknown_person'),
				detail: t('kiosk.unknown_hint')
			};
		if (hint !== null) return hintStatus(hint);
		return {
			tone: 'neutral',
			icon: 'lucide:scan-face',
			title: t('kiosk.ready'),
			detail: t('kiosk.waiting_for_face_hint')
		};
	});

	/**
	 * The frame keeps the camera's own aspect ratio at every size, so it is the video's ratio fitted
	 * inside this cell and centred. The cell is a grid track, never sized by its content, so measuring
	 * it cannot feed back into itself. The silhouette is drawn in the frame's pixels and the analysed
	 * image is the whole camera picture, which is exactly what the person sees.
	 */
	const measureCell = (node: HTMLElement) => {
		const read = () => {
			const box = node.getBoundingClientRect();
			if (box.width > 0 && box.height > 0) cell = { width: box.width, height: box.height };
		};
		read();
		const observer = new ResizeObserver(read);
		observer.observe(node);
		return () => observer.disconnect();
	};

	/** Video node and stream may arrive in either order across the scan view's remounts. */
	const attachVideo = (node: HTMLVideoElement) => {
		handles.videoNode = node;
		if (handles.stream !== null) showStream(node, handles.stream);
		const readSize = () => {
			if (node.videoWidth > 0 && node.videoHeight > 0)
				videoSize = { width: node.videoWidth, height: node.videoHeight };
		};
		readSize();
		node.addEventListener('loadedmetadata', readSize);
		node.addEventListener('resize', readSize);
		return () => {
			node.removeEventListener('loadedmetadata', readSize);
			node.removeEventListener('resize', readSize);
			if (handles.videoNode === node) handles.videoNode = null;
		};
	};

	const startCamera = async () => {
		if (handles.stream !== null) return;
		handles.stream = await openCamera({ ideal: 'user' });
		if (handles.videoNode !== null) showStream(handles.videoNode, handles.stream);
	};

	const stopCamera = () => {
		closeCamera(handles.stream);
		handles.stream = null;
	};

	const stopTimers = () => {
		if (handles.loopTimer !== null) clearInterval(handles.loopTimer);
		if (handles.clockTimer !== null) clearInterval(handles.clockTimer);
		if (handles.resetTimer !== null) clearTimeout(handles.resetTimer);
		handles.loopTimer = null;
		handles.clockTimer = null;
		handles.resetTimer = null;
	};

	const clearResetTimer = () => {
		if (handles.resetTimer !== null) clearTimeout(handles.resetTimer);
		handles.resetTimer = null;
	};

	const clearHints = () => {
		hint = null;
		handles.unreadableSince = 0;
		handles.absentSince = 0;
		spokenHints.clear();
	};

	const resumeScan = () => {
		clearResetTimer();
		handles.scanSession = {};
		handles.matchInFlight = false;
		hold = null;
		candidate = null;
		punch = null;
		notice = null;
		clearHints();
		phase = 'scan';
	};

	const scheduleResume = (delay = 4500) => {
		clearResetTimer();
		handles.resetTimer = setTimeout(resumeScan, delay);
	};

	$effect(() => {
		narrator.setLanguage(kioskVoiceLanguage(bolt.locale));
	});

	/** A status the screen shows and, when it has one, the phrase the kiosk says for it. */
	const announce = (next: KioskStatus, phrase: KioskPhraseKey | null) => {
		notice = next;
		if (phrase !== null) narrator.say(phrase);
	};

	const showHint = (kind: Hint) => {
		if (hint === kind) return;
		hint = kind;
		if (spokenHints.has(kind)) return;
		spokenHints.add(kind);
		narrator.say(kind === 'live_face_required' ? 'enroll_straight' : kind);
	};

	const toggleVoice = () => {
		voiceEnabled = !voiceEnabled;
		writeKioskSettings({ voiceEnabled });
		narrator.setEnabled(voiceEnabled);
	};

	const openTab = (next: Tab) => {
		clearResetTimer();
		handles.scanSession = {};
		handles.matchInFlight = false;
		hold = null;
		tab = next;
		candidate = null;
		punch = null;
		notice = null;
		if (phase !== 'boot' && phase !== 'error' && phase !== 'unavailable') phase = 'scan';
	};

	const toScan = () => {
		openTab('scan');
		if (phase === 'boot' || phase === 'unavailable' || fatal !== null) return;
		resumeScan();
	};
	const selectCompany = (id: Id<'companies'> | null) => {
		if (phase === 'working' || manualWorking) return;
		selectedCompanyId = id;
		handles.completedProbe = null;
		narrator.stop();
		openTab(tab);
	};

	/**
	 * Camera, then engine, then the gate: every enabled model must have loaded before the loop may
	 * run. A model that 404s does not fail `load()`; it fails `detect()` on the first face, from
	 * inside Human's own promise, and the kiosk used to say "Camera ready" over an engine that could
	 * not read anyone. Missing models are the `unavailable` phase, which never scans.
	 */
	const boot = async () => {
		phase = 'boot';
		fatal = null;
		engineMissing = [];
		try {
			await startCamera();
			if (handles.disposed) {
				stopCamera();
				return;
			}
			const [engine, spoof] = await Promise.allSettled([warmFaceEngine(false), loadAntiSpoof()]);
			if (engine.status === 'fulfilled') handles.human = engine.value;
			if (spoof.status === 'fulfilled') handles.antiSpoof = spoof.value;
			if (handles.disposed) {
				handles.human?.reset();
				await handles.antiSpoof?.release();
				return;
			}
			if (engine.status === 'rejected') throw engine.reason;
			handles.analyseCanvas = createAnalyseCanvas();
			handles.cropCanvas = document.createElement('canvas');
			handles.cropCanvas.width = handles.cropCanvas.height = 80;
			engineMissing = missingFaceModels(engine.value);
			if (spoof.status === 'rejected') engineMissing.push('MiniFASNet');
			phase = engineMissing.length > 0 ? 'unavailable' : 'scan';
			if (phase === 'unavailable') narrator.say('engine_unavailable');
		} catch (error) {
			phase = 'error';
			fatal = getErrorMessage(error);
		}
	};

	const clockTime = (iso: string | undefined) =>
		iso === undefined
			? '—'
			: new Date(iso).toLocaleTimeString(bolt.locale, {
					hour: '2-digit',
					minute: '2-digit'
				});

	const rejectFace = (
		next: KioskStatus,
		phrase: KioskPhraseKey | null,
		preserveIdentity = false
	) => {
		hold = null;
		phase = 'rejected';
		if (!preserveIdentity) candidate = null;
		announce(next, phrase);
		scheduleResume();
	};

	/** What the kiosk says for a refused punch; the screen's `blockedStatus` explains it. */
	/**
	 * A direction-free punch has one way to be blocked — the debounce — so the three contradiction
	 * phrases went with the question that produced them.
	 */
	const acceptPunch = (result: PunchCommandResult) => {
		if (tab !== 'scan' || phase !== 'working') return;
		punch = result;
		phase = result.status === 'blocked' ? 'blocked' : 'done';
		handles.completedProbe = hold?.probe ?? null;
		hold = null;
		narrator.say(
			phase === 'blocked'
				? blockedPhraseKey(result.reason)
				: result.status === 'out'
					? 'checked_out'
					: 'checked_in'
		);
	};

	const failPunch = (error: unknown) => {
		if (tab !== 'scan' || phase !== 'working') return;
		rejectFace(
			{
				tone: 'error',
				icon: 'lucide:triangle-alert',
				title: t('kiosk.record_failed'),
				detail: getErrorMessage(error)
			},
			'try_again',
			true
		);
	};

	/**
	 * A reply for the hold that asked. An empty reply is not a verdict: the frame that produced the
	 * probe may have been blurred or half-turned, so the hold simply asks again with its next
	 * embedding, and only a hold that runs its full second without a name is "unknown".
	 */
	const acceptMatch = (
		matched: MatchResult,
		holdProbe: readonly number[],
		requestedCompanyId: Id<'companies'>
	) => {
		if (
			tab !== 'scan' ||
			phase !== 'challenge' ||
			hold?.probe !== holdProbe ||
			companyId !== requestedCompanyId
		)
			return;
		if (matched.status === 'unenrolled') {
			rejectFace(
				{
					tone: 'warning',
					icon: 'lucide:badge-alert',
					title: matched.employee.name,
					detail: t('kiosk.no_active_contract_in_entity')
				},
				'no_active_employment'
			);
			return;
		}
		if (matched.status !== 'match') return;
		candidate = {
			employeeName: matched.employee.name,
			employmentId: matched.employment.id,
			employeeNumber: matched.employment.employee_number,
			companyId: matched.employment.company_id
		};
	};

	onMount(() => {
		void boot();
		handles.clockTimer = setInterval(() => (now = new Date()), 1000);
		// Recognition runs during the live-face hold; only a fresh passing frame may submit it.
		handles.loopTimer = setInterval(async () => {
			const activeCompanyId = companyId;
			if (
				activeCompanyId == null ||
				tab !== 'scan' ||
				handles.human === null ||
				handles.antiSpoof === null ||
				handles.cropCanvas === null ||
				handles.analyseCanvas === null ||
				handles.videoNode === null ||
				handles.inFlight ||
				handles.videoNode.currentTime === handles.lastFrameTime ||
				(phase !== 'scan' && phase !== 'challenge' && phase !== 'done' && phase !== 'blocked') ||
				!drawVideoFrame(handles.videoNode, handles.analyseCanvas, frame)
			)
				return;
			handles.lastFrameTime = handles.videoNode.currentTime;
			handles.inFlight = true;
			const activeSession = handles.scanSession;
			try {
				const detectStart = performance.now();
				const result = await handles.human.detect(handles.analyseCanvas);
				if (
					handles.disposed ||
					activeSession !== handles.scanSession ||
					(phase !== 'scan' && phase !== 'challenge' && phase !== 'done' && phase !== 'blocked')
				)
					return;
				performance.clearMeasures('kiosk.face');
				performance.measure('kiosk.face', { start: detectStart });
				const faces = result.face
					.map((face) => ({ ...face, box: unpaddedFaceBox(face.box) }))
					.filter((face) => faceInsideSilhouette(face.box, handles.analyseCanvas!, frame));
				const face = faces.length === 1 ? faces[0] : undefined;
				const nowMs = performance.now();
				if (face?.embedding === undefined) {
					handles.completedProbe = null;
					hold = null;
					candidate = null;
					phase = 'scan';
					if (result.face.length > 0) {
						handles.absentSince = 0;
						if (handles.unreadableSince === 0) handles.unreadableSince = nowMs;
						else if (nowMs - handles.unreadableSince >= MOVE_CLOSER_AFTER_MS)
							showHint('move_closer');
					} else {
						handles.unreadableSince = 0;
						if (handles.absentSince === 0) handles.absentSince = nowMs;
						else if (nowMs - handles.absentSince >= NO_FACE_AFTER_MS) showHint('no_face');
					}
					return;
				}
				// One arrival per visit to the outline. A new person can use it immediately.
				if (
					handles.completedProbe !== null &&
					sameKioskPerson(handles.completedProbe, face.embedding)
				)
					return;
				handles.completedProbe = null;
				const scoreStart = performance.now();
				const liveScore = await scoreAntiSpoof(
					handles.antiSpoof,
					handles.analyseCanvas,
					face.box,
					handles.cropCanvas
				);
				if (
					handles.disposed ||
					activeSession !== handles.scanSession ||
					(phase !== 'scan' && phase !== 'challenge' && phase !== 'done' && phase !== 'blocked')
				)
					return;
				performance.clearMeasures('kiosk.liveness');
				performance.measure('kiosk.liveness', {
					start: scoreStart,
					detail: { score: liveScore, box: face.box }
				});
				const previousProbe = hold?.probe;
				hold = observeKioskHold(hold, { embedding: face.embedding, liveScore }, performance.now());
				if (hold === null) {
					candidate = null;
					phase = 'scan';
					showHint('live_face_required');
					return;
				}
				handles.unreadableSince = 0;
				handles.absentSince = 0;
				hint = null;
				phase = 'challenge';
				if (hold.probe !== previousProbe) candidate = null;
				if (candidate === null && !handles.matchInFlight && kioskSecondsLeft(hold) === 0) {
					// Two seconds of live frames, and the last reply named nobody.
					hold = null;
					phase = 'unknown';
					narrator.say('identity_unknown');
					scheduleResume(5500);
					return;
				}
				if (candidate === null && !handles.matchInFlight) {
					handles.matchInFlight = true;
					const holdProbe = hold.probe;
					const matchStart = performance.now();
					void bolt
						.query('employees.kiosk_match', {
							company_id: activeCompanyId,
							probe: [...hold.embedding],
							threshold: KIOSK_MATCH_THRESHOLD
						})
						.then(
							(answer) => {
								const matched = answer as MatchResult;
								handles.matchInFlight = false;
								performance.clearMeasures('kiosk.match');
								performance.measure('kiosk.match', { start: matchStart });
								if (activeSession === handles.scanSession)
									acceptMatch(matched, holdProbe, activeCompanyId);
							},
							(error: unknown) => {
								handles.matchInFlight = false;
								if (hold?.probe !== holdProbe || handles.disposed) return;
								rejectFace(
									{
										tone: 'error',
										icon: 'lucide:triangle-alert',
										title: t('kiosk.read_failed'),
										detail: getErrorMessage(error)
									},
									'try_again'
								);
							}
						);
				}
				if (
					candidate !== null &&
					candidate.companyId === activeCompanyId &&
					kioskSecondsLeft(hold) === 0
				) {
					phase = 'working';
					const punchStart = performance.now();
					performance.clearMeasures('kiosk.hold');
					performance.measure('kiosk.hold', { start: hold.startedAt });
					try {
						const result = await punchWork(candidate.employmentId, 'FACE');
						performance.clearMeasures('kiosk.punch');
						performance.measure('kiosk.punch', { start: punchStart });
						if (!handles.disposed && activeSession === handles.scanSession) acceptPunch(result);
					} catch (error) {
						if (!handles.disposed && activeSession === handles.scanSession) failPunch(error);
					}
				}
			} catch (error) {
				if (handles.disposed || activeSession !== handles.scanSession) return;
				rejectFace(
					{
						tone: 'error',
						icon: 'lucide:triangle-alert',
						title: t('kiosk.read_failed'),
						detail: getErrorMessage(error)
					},
					'try_again'
				);
			} finally {
				handles.inFlight = false;
			}
		}, KIOSK_LOOP_MS);
		return () => {
			handles.disposed = true;
			handles.scanSession = {};
			hold = null;
			stopTimers();
			stopCamera();
			handles.human?.reset();
			void handles.antiSpoof?.release();
			narrator.stop();
		};
	});
</script>

{#snippet header()}
	<Cluster
		as="header"
		justify="between"
		gap="md"
		class="min-h-16 border-b bg-card px-4 py-3 sm:px-6"
	>
		<Inline gap="sm">
			<Inline
				justify="center"
				shrink={false}
				class="size-10 overflow-clip rounded-lg border bg-background"
			>
				{#if organizationLogoUrl !== null}
					<img
						src={organizationLogoUrl}
						alt={t('kiosk.organization_logo', { name: organizationDisplayName })}
						class="size-full object-contain p-1"
					/>
				{:else}
					<span class="text-sm font-semibold">{organizationInitials}</span>
				{/if}
			</Inline>
			<div class="min-w-0">
				<p class="truncate text-heading">{organizationDisplayName}</p>
				<p class="text-meta">{t('kiosk.title')}</p>
			</div>
		</Inline>

		<div data-kiosk-company>
			<Picker
				of="companies"
				label={['name']}
				where={{ approval_id: { isNull: true } }}
				orderBy="name"
				value={companyId}
				onChange={selectCompany}
				disabled={phase === 'working' || manualWorking || companies.loading}
			/>
		</div>

		<div class="hidden text-right sm:block">
			<time datetime={now.toISOString()} class="block text-heading tabular-nums">{currentTime}</time
			>
			<p class="text-meta">{currentDate}</p>
		</div>

		<Inline gap="xs" shrink={false} aria-label={t('kiosk.tools')}>
			<Button
				variant={tab === 'scan' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={toScan}
				aria-label={t('kiosk.clock')}
				aria-pressed={tab === 'scan'}
			>
				<Icon icon="lucide:scan-face" class="size-4" />
				<span class="hidden md:inline">{t('kiosk.clock')}</span>
			</Button>
			<Button
				variant={tab === 'manual' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={() => openTab('manual')}
				aria-label={t('kiosk.manual_entry')}
				aria-pressed={tab === 'manual'}
			>
				<Icon icon="lucide:keyboard" class="size-4" />
				<span class="hidden md:inline">{t('kiosk.manual_entry')}</span>
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-pressed={voiceEnabled}
				aria-label={voiceEnabled ? t('kiosk.voice_off') : t('kiosk.voice_on')}
				onclick={toggleVoice}
			>
				<Icon icon={voiceEnabled ? 'lucide:volume-2' : 'lucide:volume-x'} class="size-4" />
			</Button>
		</Inline>
	</Cluster>
{/snippet}

{#snippet statusBar()}
	<div
		class="border-t px-4 py-3 sm:px-6 {STATUS_TONE_CLASSES[status.tone]}"
		role="status"
		aria-live="polite"
		aria-atomic="true"
	>
		<Center measure="full" layout="inline" gap="sm" class="max-w-5xl">
			<Frame ratio="square" shrink={false} class="size-9 rounded-full bg-current/10">
				<Icon
					icon={status.icon}
					class="size-5 {status.icon === 'lucide:loader-circle' ? 'animate-spin' : ''}"
				/>
			</Frame>
			<div class="min-w-0">
				<p class="text-sm font-medium">{status.title}</p>
				<p class="text-sm opacity-80">{status.detail}</p>
			</div>
		</Center>
	</div>
{/snippet}

<!--
	`Bound size="full"` + `Cover`: the kiosk is a full-screen device surface with its own header
	and status bar as the chrome rows and the body as the definite middle track — deliberately not
	an `AppShell`, which would add a workspace hero around a shop-floor time clock. The body grid
	used to be `h-full` under a root with no definite height, which is where the empty band under
	the status bar came from. The camera cell is a definite track at every breakpoint — the
	remaining height above the identity panel below `lg`, the left column from `lg` — and the frame
	inside it keeps the camera's own aspect ratio, letterboxed on the dark cell, never cropped: a
	near-square iPad column used to show a 16:9 stream with its sides cut off, and a portrait
	tablet under a 16:9 `aspect-video` frame showed a third of a portrait stream.
-->
<Bound size="full">
	<Cover as="main" top={header} bottom={statusBar} gap="none" class="bg-background text-foreground">
		{#if tab === 'scan' && phase === 'boot'}
			<Stack align="center" justify="center" fill gap="md">
				<Spinner class="size-8" label={t('kiosk.preparing')} />
				<p class="text-sm text-muted-foreground">{t('kiosk.preparing_detail')}</p>
			</Stack>
		{:else if tab === 'scan' && phase === 'error'}
			<Stack align="center" justify="center" fill gap="md" class="px-6 text-center">
				<Frame ratio="square" class="size-14 rounded-full bg-destructive/10 text-destructive">
					<Icon icon="lucide:camera-off" class="size-7" />
				</Frame>
				<Stack gap="xs" align="center">
					<h1 class="text-section">{t('kiosk.camera_unavailable')}</h1>
					<p class="max-w-xl text-sm text-muted-foreground">{fatal ?? t('kiosk.camera_help')}</p>
				</Stack>
				<Button onclick={() => void boot()}>
					<Icon icon="lucide:refresh-cw" class="size-4" />
					{t('kiosk.retry')}
				</Button>
			</Stack>
		{:else if tab === 'scan'}
			<div
				// repository-health:allow UI6 -- the camera is a definite 1fr row above the auto aside, then a column beside it at lg: Split stacks into auto rows at a 40rem container width, Switcher's wrapped lines share the free height equally, and Cover never goes side by side
				// repository-health:allow UI27 -- same track template as UI6: no primitive switches a 1fr/auto row template to a two-column split
				class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.8fr)] lg:grid-rows-none"
			>
				<Stack
					{@attach measureCell}
					align="center"
					justify="center"
					class="overflow-clip bg-foreground"
					data-kiosk-cell
				>
					<Bound
						as="section"
						size="full"
						clip
						class="relative"
						style="width: {frame.width}px; height: {frame.height}px;"
						aria-label={t('kiosk.camera')}
					>
						<Imposter placement="fill">
							<video
								{@attach attachVideo}
								playsinline
								autoplay
								muted
								class="size-full -scale-x-100 object-cover"
							></video>
						</Imposter>

						<!--
						One silhouette, drawn in the frame's own pixels over the scrim: a head ellipse
						spanning 58% of the frame's height, a neck gap, then shoulders that fade as they run
						off the bottom edge. The geometry is `silhouetteGeometry(frame)`; the frame is
						measured above, so the guide scales with the video at every breakpoint. The
						countdown sits in the head.
					-->
						<Imposter placement="fill" class="pointer-events-none bg-black/25">
							<svg
								viewBox="0 0 {silhouette.width} {silhouette.height}"
								preserveAspectRatio="none"
								class="size-full {phase === 'challenge' ? 'text-brand' : 'text-white/80'}"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-dasharray="6 8"
								data-kiosk-silhouette
								data-head-height={Math.round(silhouette.head.ry * 2)}
								data-frame-height={Math.round(silhouette.height)}
								aria-hidden="true"
							>
								<defs>
									<linearGradient
										id="kiosk-silhouette-fade"
										x1="0"
										y1={silhouette.shoulders.top}
										x2="0"
										y2={silhouette.height}
										gradientUnits="userSpaceOnUse"
									>
										<stop offset="0" stop-color="currentColor" stop-opacity="1" />
										<stop offset="0.6" stop-color="currentColor" stop-opacity="0.6" />
										<stop offset="1" stop-color="currentColor" stop-opacity="0" />
									</linearGradient>
								</defs>
								<ellipse
									cx={silhouette.head.cx}
									cy={silhouette.head.cy}
									rx={silhouette.head.rx}
									ry={silhouette.head.ry}
								/>
								<path d={silhouette.shoulders.path} stroke="url(#kiosk-silhouette-fade)" />
							</svg>
						</Imposter>

						<Imposter placement="top-start" class="m-2">
							<Inline
								gap="sm"
								class="rounded-full bg-black/60 px-3 py-1.5 text-sm text-white"
								data-kiosk-engine={phase === 'unavailable' ? 'unavailable' : 'ready'}
							>
								{#if phase === 'unavailable'}
									<span class="size-2 rounded-full bg-destructive"></span>
									{t('kiosk.engine_unavailable')}
								{:else}
									<span class="size-2 rounded-full bg-success"></span>
									{t('kiosk.camera_ready')}
								{/if}
							</Inline>
						</Imposter>

						{#if phase === 'challenge'}
							<Imposter
								placement="center"
								class="pointer-events-none"
								style="left: {(silhouette.head.cx / silhouette.width) * 100}%; top: {(silhouette
									.head.cy /
									silhouette.height) *
									100}%;"
							>
								<Frame
									as="span"
									ratio="square"
									class="size-20 rounded-full bg-black/70 text-title text-white tabular-nums"
									aria-hidden="true">{challengeLeft}</Frame
								>
							</Imposter>
						{/if}
					</Bound>
				</Stack>

				<Scroll as="aside" name={t('kiosk.identity')} class="bg-card px-5 py-6 sm:px-8 sm:py-8">
					<Center measure="narrow" layout="stack" gap="xl">
						<!--
							No action cards. The kiosk does not ask which way to punch — the day already
							knows — so the aside is the person, and the one line above it says what to do.
						-->
						<Stack as="section" gap="sm" class="max-lg:hidden">
							<h1 class="text-section">{t('kiosk.how_it_works')}</h1>
							<p class="text-sm text-muted-foreground">{t('kiosk.how_it_works_hint')}</p>
						</Stack>

						<Stack
							as="section"
							gap="md"
							class="lg:border-t lg:pt-7"
							aria-labelledby="identity-heading"
						>
							<h2 id="identity-heading" class="text-heading">{t('kiosk.identity')}</h2>
							{#if candidate !== null}
								<Inline align="start" gap="md">
									<Frame
										ratio="square"
										shrink={false}
										class="size-12 rounded-full bg-primary text-primary-foreground"
									>
										<Icon
											icon={phase === 'done' ? 'lucide:check' : 'lucide:user-round'}
											class="size-6"
										/>
									</Frame>
									<Stack gap="sm" grow>
										<p class="truncate text-subhead">{candidate.employeeName}</p>
										<Stack as="dl" gap="sm" class="text-sm">
											<Inline justify="between" gap="md" class="border-b pb-2">
												<dt class="text-muted-foreground">{t('kiosk.entity')}</dt>
												<dd class="truncate font-medium">{candidateCompany}</dd>
											</Inline>
											<Inline justify="between" gap="md">
												<dt class="text-muted-foreground">{t('kiosk.employee_number')}</dt>
												<dd class="font-mono text-sm">{candidate.employeeNumber}</dd>
											</Inline>
										</Stack>
									</Stack>
								</Inline>
							{:else if phase === 'unknown'}
								<Inline align="start" gap="md">
									<Frame ratio="square" shrink={false} class="size-12 rounded-full bg-warning/15">
										<Icon
											icon="lucide:user-round-question"
											class="size-6 text-warning-foreground"
										/>
									</Frame>
									<div>
										<p class="text-base font-medium">{t('kiosk.unknown_person')}</p>
										<p class="mt-1 text-sm text-muted-foreground">{t('kiosk.unknown_hint')}</p>
									</div>
								</Inline>
							{:else if phase === 'rejected' && notice !== null}
								<Inline align="start" gap="md">
									<Frame
										ratio="square"
										shrink={false}
										class="size-12 rounded-full bg-destructive/10"
									>
										<Icon icon={notice.icon} class="size-6 text-destructive" />
									</Frame>
									<div>
										<p class="text-base font-medium">{notice.title}</p>
										<p class="mt-1 text-sm text-muted-foreground">{notice.detail}</p>
									</div>
								</Inline>
							{:else if phase === 'unavailable'}
								<Inline align="start" gap="md">
									<Frame
										ratio="square"
										shrink={false}
										class="size-12 rounded-full bg-destructive/10"
									>
										<Icon icon="lucide:cpu" class="size-6 text-destructive" />
									</Frame>
									<Stack gap="md" align="start">
										<Stack gap="xs">
											<p class="text-base font-medium">{t('kiosk.engine_unavailable')}</p>
											<p class="text-sm text-muted-foreground">
												{t('kiosk.engine_unavailable_detail', { models: engineMissing.join(', ') })}
											</p>
										</Stack>
										<Button variant="secondary" onclick={() => openTab('manual')}>
											<Icon icon="lucide:keyboard" class="size-4" />
											{t('kiosk.manual_entry')}
										</Button>
									</Stack>
								</Inline>
							{:else}
								<Inline align="start" gap="md">
									<Frame ratio="square" shrink={false} class="size-12 rounded-full bg-muted">
										<Icon icon="lucide:user-round" class="size-6 text-muted-foreground" />
									</Frame>
									<div>
										<p class="text-base font-medium">
											{companyId == null
												? t('component.choose_legal_entity')
												: hint !== null
													? hintStatus(hint).title
													: t('kiosk.waiting_for_face')}
										</p>
										<p class="mt-1 text-sm text-muted-foreground">
											{companyId == null
												? t('kiosk.choose_entity_before_punch')
												: hint !== null
													? hintStatus(hint).detail
													: t('kiosk.waiting_for_face_hint')}
										</p>
									</div>
								</Inline>
							{/if}
						</Stack>
					</Center>
				</Scroll>
			</div>
		{:else}
			<Scroll name={t('kiosk.manual_entry')} inset class="bg-muted/40">
				{#key companyId}
					<ManualTab
						{companyId}
						ondone={toScan}
						onworkingchange={(value) => {
							manualWorking = value;
						}}
					/>
				{/key}
			</Scroll>
		{/if}
	</Cover>
</Bound>
