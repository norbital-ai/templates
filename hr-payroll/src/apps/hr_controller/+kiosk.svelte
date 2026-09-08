<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import type Human from '@vladmandic/human';
	import { workspaceSession } from '@norbital-ai/bolt/client';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { LocaleToggle } from '@norbital-ai/ui/locale-toggle';
	import { Bound, Cover, Stack } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import ManualTab from './kiosk-manual.svelte';
	import {
		createAnalyseCanvas,
		drawVideoFrame,
		missingFaceModels,
		showStream,
		unpaddedFaceBox,
		warmFaceEngine
	} from '../../lib/kiosk/face.js';
	import {
		KIOSK_CAPTURE_HEIGHT,
		KIOSK_CAPTURE_WIDTH,
		KIOSK_LOOP_MS
	} from '../../lib/kiosk/config.js';
	import { KIOSK_MATCH_THRESHOLD } from '../../lib/kiosk/embed.js';
	import { readKioskSettings, writeKioskSettings } from '../../lib/kiosk/settings.js';
	import { browserNarratorPlatform, createKioskNarrator } from '../../lib/kiosk/voice.js';
	import { kioskVoiceLanguage, type KioskPhraseKey } from '../../lib/kiosk/phrases.js';
	import { blockedPhraseKey } from '../../lib/kiosk/punch.js';
	import {
		faceInsideSilhouette,
		silhouetteGeometry,
		type FrameSize
	} from '../../lib/kiosk/silhouette.js';
	import { loadAntiSpoof, scoreAntiSpoof } from '../../lib/kiosk/anti-spoof.js';
	import {
		observeKioskHold,
		kioskSecondsLeft,
		sameKioskPerson,
		type KioskHold
	} from '../../lib/kiosk/hold.js';

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
		employmentId: string;
		employeeNumber: string;
		companyId: string;
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
	type MatchResult = Awaited<ReturnType<(typeof client.invoke)['kiosk_match']>>;
	type PunchCommandResult = Awaited<ReturnType<(typeof client.invoke)['kiosk_punch']>>;

	type KioskStatus = Readonly<{
		tone: StatusTone;
		icon: string;
		title: string;
		detail: string;
	}>;

	const i18n = useI18n<TenantI18nKeys>();
	const { t } = i18n;
	const session = workspaceSession();
	const settings = readKioskSettings();

	let tab = $state<Tab>('scan');
	let selectedCompanyId = $state<string | null>(null);
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
	let organizationName = $state('');
	let organizationLogoUrl = $state<string | null>(null);
	/** The camera frame's box, measured, so the silhouette is drawn in its pixels. */
	let frame = $state<FrameSize>({ width: KIOSK_CAPTURE_WIDTH, height: KIOSK_CAPTURE_HEIGHT });
	const silhouette = $derived(silhouetteGeometry(frame));

	let videoNode: HTMLVideoElement | null = null;
	let stream: MediaStream | null = null;
	let human: Human | null = null;
	let antiSpoof: Awaited<ReturnType<typeof loadAntiSpoof>> | null = null;
	let cropCanvas: HTMLCanvasElement | null = null;
	let analyseCanvas: HTMLCanvasElement | null = null;
	let loopTimer: ReturnType<typeof setInterval> | null = null;
	let clockTimer: ReturnType<typeof setInterval> | null = null;
	let resetTimer: ReturnType<typeof setTimeout> | null = null;
	let inFlight = false;
	let lastFrameTime = -1;
	let scanSession = {};
	let completedProbe: readonly number[] | null = null;
	let disposed = false;
	/**
	 * Everything the kiosk says goes through here: pre-generated clips, one phrase at a time, never
	 * two at once. Created at init so the voice toggle and the locale effect below can reach it.
	 */
	const narrator = createKioskNarrator(browserNarratorPlatform(), {
		language: kioskVoiceLanguage(i18n.intlLocale),
		enabled: settings.voiceEnabled
	});
	let unreadableSince = 0;
	let absentSince = 0;
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

	const companiesQuery = client.db.companies.findMany({
		where: { approval_id: { isNull: true } },
		columns: { id: true, name: true },
		orderBy: { name: 'asc' },
		limit: 200
	});
	const companyById = $derived(
		new Map((companiesQuery.current ?? []).map((company) => [company.id, company.name]))
	);
	const companyId = $derived(
		selectedCompanyId != null && companyById.has(selectedCompanyId) ? selectedCompanyId : null
	);
	const companyOptions = $derived(
		(companiesQuery.current ?? []).map((company) => ({ value: company.id, label: company.name }))
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
		new Intl.DateTimeFormat(i18n.intlLocale, {
			hour: '2-digit',
			minute: '2-digit'
		}).format(now)
	);
	const currentDate = $derived(
		new Intl.DateTimeFormat(i18n.intlLocale, {
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
				detail: companiesQuery.error?.message ?? t('kiosk.choose_entity_before_punch')
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
	 * The silhouette is drawn in the frame's own pixels, so the frame reports its size whenever the
	 * viewport, the aside or the breakpoint changes it. The observer lives as long as the section.
	 */
	const measureFrame = (node: HTMLElement) => {
		const read = () => {
			const box = node.getBoundingClientRect();
			if (box.width > 0 && box.height > 0) frame = { width: box.width, height: box.height };
		};
		read();
		const observer = new ResizeObserver(read);
		observer.observe(node);
		return () => observer.disconnect();
	};

	/** Video node and stream may arrive in either order across the scan view's remounts. */
	const attachVideo = (node: HTMLVideoElement) => {
		videoNode = node;
		if (stream !== null) showStream(node, stream);
		return () => {
			if (videoNode === node) videoNode = null;
		};
	};

	const startCamera = async () => {
		if (stream !== null) return;
		stream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: { ideal: 'user' },
				width: { ideal: KIOSK_CAPTURE_WIDTH },
				height: { ideal: KIOSK_CAPTURE_HEIGHT }
			},
			audio: false
		});
		if (videoNode !== null) showStream(videoNode, stream);
	};

	const stopCamera = () => {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	};

	const stopTimers = () => {
		if (loopTimer !== null) clearInterval(loopTimer);
		if (clockTimer !== null) clearInterval(clockTimer);
		if (resetTimer !== null) clearTimeout(resetTimer);
		loopTimer = null;
		clockTimer = null;
		resetTimer = null;
	};

	const clearResetTimer = () => {
		if (resetTimer !== null) clearTimeout(resetTimer);
		resetTimer = null;
	};

	const clearHints = () => {
		hint = null;
		unreadableSince = 0;
		absentSince = 0;
		spokenHints.clear();
	};

	const resumeScan = () => {
		clearResetTimer();
		scanSession = {};
		hold = null;
		candidate = null;
		punch = null;
		notice = null;
		clearHints();
		phase = 'scan';
	};

	const scheduleResume = (delay = 4500) => {
		clearResetTimer();
		resetTimer = setTimeout(resumeScan, delay);
	};

	$effect(() => {
		narrator.setLanguage(kioskVoiceLanguage(i18n.intlLocale));
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
		scanSession = {};
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
	const selectCompany = (id: string | null) => {
		if (phase === 'working' || manualWorking) return;
		selectedCompanyId = id;
		completedProbe = null;
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
			if (disposed) {
				stopCamera();
				return;
			}
			const [engine, spoof] = await Promise.allSettled([warmFaceEngine(false), loadAntiSpoof()]);
			if (engine.status === 'fulfilled') human = engine.value;
			if (spoof.status === 'fulfilled') antiSpoof = spoof.value;
			if (disposed) {
				human?.reset();
				await antiSpoof?.release();
				return;
			}
			if (engine.status === 'rejected') throw engine.reason;
			analyseCanvas = createAnalyseCanvas();
			cropCanvas = document.createElement('canvas');
			cropCanvas.width = cropCanvas.height = 80;
			engineMissing = missingFaceModels(engine.value);
			if (spoof.status === 'rejected') engineMissing.push('MiniFASNet');
			phase = engineMissing.length > 0 ? 'unavailable' : 'scan';
			if (phase === 'unavailable') narrator.say('engine_unavailable');
		} catch (error) {
			phase = 'error';
			fatal = error instanceof Error ? error.message : String(error);
		}
	};

	const clockTime = (iso: string | undefined) =>
		iso === undefined
			? '—'
			: new Date(iso).toLocaleTimeString(i18n.intlLocale, {
					hour: '2-digit',
					minute: '2-digit'
				});

	const loadOrganizationBrand = async () => {
		try {
			const snapshot = await session.operations.read({ profileOnly: true });
			if (typeof snapshot !== 'object' || snapshot === null) return;
			const organization = Reflect.get(snapshot, 'organization');
			if (typeof organization !== 'object' || organization === null) return;
			const name = Reflect.get(organization, 'name');
			const logoKey = Reflect.get(organization, 'logoKey');
			if (typeof name === 'string') organizationName = name;
			organizationLogoUrl = typeof logoKey === 'string' ? session.files.urlFor(logoKey) : null;
		} catch (error) {
			console.warn('[kiosk] organization branding unavailable', error);
		}
	};

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
		punch = {
			status: result.status,
			intervalIndex: 'intervalIndex' in result ? result.intervalIndex : undefined,
			time: 'time' in result ? result.time : undefined,
			reason: 'reason' in result ? String(result.reason) : undefined,
			retryAfterMs: 'retryAfterMs' in result ? Number(result.retryAfterMs) : undefined,
			plannedCode: 'plannedCode' in result ? String(result.plannedCode) : undefined
		};
		phase = result.status === 'blocked' ? 'blocked' : 'done';
		completedProbe = hold?.probe ?? null;
		hold = null;
		narrator.say(
			phase === 'blocked'
				? blockedPhraseKey(punch.reason)
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
				detail: error instanceof Error ? error.message : String(error)
			},
			'try_again',
			true
		);
	};

	const acceptMatch = (
		matched: MatchResult,
		probe: readonly number[],
		requestedCompanyId: string
	) => {
		if (
			tab !== 'scan' ||
			phase !== 'challenge' ||
			hold?.probe !== probe ||
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
		if (matched.status !== 'match') {
			hold = null;
			phase = 'unknown';
			narrator.say('identity_unknown');
			scheduleResume(5500);
			return;
		}
		candidate = {
			employeeName: matched.employee.name,
			employmentId: matched.employment.id,
			employeeNumber: matched.employment.employee_number,
			companyId: matched.employment.company_id
		};
	};

	onMount(() => {
		void boot();
		void loadOrganizationBrand();
		clockTimer = setInterval(() => (now = new Date()), 1000);
		// Recognition runs during the live-face hold; only a fresh passing frame may submit it.
		loopTimer = setInterval(async () => {
			const activeCompanyId = companyId;
			if (
				activeCompanyId == null ||
				tab !== 'scan' ||
				human === null ||
				antiSpoof === null ||
				cropCanvas === null ||
				analyseCanvas === null ||
				videoNode === null ||
				inFlight ||
				videoNode.currentTime === lastFrameTime ||
				(phase !== 'scan' && phase !== 'challenge' && phase !== 'done' && phase !== 'blocked') ||
				!drawVideoFrame(videoNode, analyseCanvas, frame)
			)
				return;
			lastFrameTime = videoNode.currentTime;
			inFlight = true;
			const activeSession = scanSession;
			try {
				const detectStart = performance.now();
				const result = await human.detect(analyseCanvas);
				if (
					disposed ||
					activeSession !== scanSession ||
					(phase !== 'scan' && phase !== 'challenge' && phase !== 'done' && phase !== 'blocked')
				)
					return;
				performance.clearMeasures('kiosk.face');
				performance.measure('kiosk.face', { start: detectStart });
				const faces = result.face
					.map((face) => ({ ...face, box: unpaddedFaceBox(face.box) }))
					.filter((face) => faceInsideSilhouette(face.box, analyseCanvas!, frame));
				const face = faces.length === 1 ? faces[0] : undefined;
				const nowMs = performance.now();
				if (face?.embedding === undefined) {
					completedProbe = null;
					hold = null;
					candidate = null;
					phase = 'scan';
					if (result.face.length > 0) {
						absentSince = 0;
						if (unreadableSince === 0) unreadableSince = nowMs;
						else if (nowMs - unreadableSince >= MOVE_CLOSER_AFTER_MS) showHint('move_closer');
					} else {
						unreadableSince = 0;
						if (absentSince === 0) absentSince = nowMs;
						else if (nowMs - absentSince >= NO_FACE_AFTER_MS) showHint('no_face');
					}
					return;
				}
				// One arrival per visit to the outline. A new person can use it immediately.
				if (completedProbe !== null && sameKioskPerson(completedProbe, face.embedding)) return;
				completedProbe = null;
				const scoreStart = performance.now();
				const liveScore = await scoreAntiSpoof(antiSpoof, analyseCanvas, face.box, cropCanvas);
				if (
					disposed ||
					activeSession !== scanSession ||
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
				unreadableSince = 0;
				absentSince = 0;
				hint = null;
				phase = 'challenge';
				if (hold.probe !== previousProbe) {
					candidate = null;
					const probe = hold.probe;
					const matchStart = performance.now();
					void client.invoke
						.kiosk_match({
							company_id: activeCompanyId,
							probe: [...probe],
							threshold: KIOSK_MATCH_THRESHOLD
						})
						.then(
							(matched) => {
								performance.clearMeasures('kiosk.match');
								performance.measure('kiosk.match', { start: matchStart });
								if (activeSession === scanSession) acceptMatch(matched, probe, activeCompanyId);
							},
							(error: unknown) => {
								if (hold?.probe !== probe || disposed) return;
								rejectFace(
									{
										tone: 'error',
										icon: 'lucide:triangle-alert',
										title: t('kiosk.read_failed'),
										detail: error instanceof Error ? error.message : String(error)
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
						const result = await client.invoke.kiosk_punch({
							employment_id: candidate.employmentId,
							kind: 'FACE'
						});
						performance.clearMeasures('kiosk.punch');
						performance.measure('kiosk.punch', { start: punchStart });
						if (!disposed && activeSession === scanSession) acceptPunch(result);
					} catch (error) {
						if (!disposed && activeSession === scanSession) failPunch(error);
					}
				}
			} catch (error) {
				if (disposed || activeSession !== scanSession) return;
				rejectFace(
					{
						tone: 'error',
						icon: 'lucide:triangle-alert',
						title: t('kiosk.read_failed'),
						detail: error instanceof Error ? error.message : String(error)
					},
					'try_again'
				);
			} finally {
				inFlight = false;
			}
		}, KIOSK_LOOP_MS);
		return () => {
			disposed = true;
			scanSession = {};
			hold = null;
			stopTimers();
			stopCamera();
			human?.reset();
			void antiSpoof?.release();
			narrator.stop();
		};
	});
</script>

<svelte:head>
	<title>Attendance Kiosk</title>
	<meta name="description" content="Face-recognition time clock for the shop floor." />
	<meta name="bolt:icon" content="lucide:scan-face" />
	<meta name="bolt:kiosk" content="true" />
</svelte:head>

{#snippet header()}
	<header
		class="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b bg-card px-4 py-3 sm:px-6"
	>
		<div class="flex min-w-0 items-center gap-3">
			<div
				class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background"
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
			</div>
			<div class="min-w-0">
				<p class="truncate text-heading">{organizationDisplayName}</p>
				<p class="text-meta">{t('kiosk.title')}</p>
			</div>
		</div>

		<div data-kiosk-company>
			<Combobox
				options={companyOptions}
				value={companyId}
				onValueChange={selectCompany}
				disabled={phase === 'working' || manualWorking || companiesQuery.loading}
				allowClear={false}
				ariaLabel={t('component.legal_entity')}
				searchPlaceholder={t('component.search_companies')}
				emptyPlaceholder={t('component.choose_legal_entity')}
				class="w-64 max-w-full"
			/>
		</div>

		<div class="hidden text-right sm:block">
			<time datetime={now.toISOString()} class="block text-heading tabular-nums">{currentTime}</time
			>
			<p class="text-meta">{currentDate}</p>
		</div>

		<div class="flex shrink-0 items-center gap-1" aria-label={t('kiosk.tools')}>
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
			<LocaleToggle showLabel={false} />
			<Button
				variant="ghost"
				size="icon"
				aria-pressed={voiceEnabled}
				aria-label={voiceEnabled ? t('kiosk.voice_off') : t('kiosk.voice_on')}
				onclick={toggleVoice}
			>
				<Icon icon={voiceEnabled ? 'lucide:volume-2' : 'lucide:volume-x'} class="size-4" />
			</Button>
		</div>
	</header>
{/snippet}

{#snippet statusBar()}
	<div
		class="border-t px-4 py-3 sm:px-6 {STATUS_TONE_CLASSES[status.tone]}"
		role="status"
		aria-live="polite"
		aria-atomic="true"
	>
		<div class="mx-auto flex max-w-5xl items-center gap-3">
			<div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-current/10">
				<Icon
					icon={status.icon}
					class="size-5 {status.icon === 'lucide:loader-circle' ? 'animate-spin' : ''}"
				/>
			</div>
			<div class="min-w-0">
				<p class="text-sm font-medium">{status.title}</p>
				<p class="text-sm opacity-80">{status.detail}</p>
			</div>
		</div>
	</div>
{/snippet}

<!--
	`Bound size="full"` + `Cover`: the kiosk is a full-screen device surface with its own header
	and status bar as the chrome rows and the body as the definite middle track — deliberately not
	an `AppShell`, which would add a workspace hero around a shop-floor time clock. The body grid
	used to be `h-full` under a root with no definite height, which is where the empty band under
	the status bar came from. Below `lg` the video is an `aspect-video` frame with the action cards
	over its foot and the identity panel under it; from `lg` the frame and the aside sit side by
	side and fill the track.
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
				<div
					class="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive"
				>
					<Icon icon="lucide:camera-off" class="size-7" />
				</div>
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
				class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.8fr)] lg:grid-rows-none"
			>
				<section
					{@attach measureFrame}
					class="relative aspect-video overflow-hidden bg-foreground lg:aspect-auto lg:min-h-0"
					aria-label={t('kiosk.camera')}
				>
					<video
						{@attach attachVideo}
						playsinline
						autoplay
						muted
						class="absolute inset-0 size-full -scale-x-100 object-cover"
					></video>
					<div class="pointer-events-none absolute inset-0 bg-black/25"></div>

					<div
						class="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white"
						data-kiosk-engine={phase === 'unavailable' ? 'unavailable' : 'ready'}
					>
						{#if phase === 'unavailable'}
							<span class="size-2 rounded-full bg-destructive"></span>
							{t('kiosk.engine_unavailable')}
						{:else}
							<span class="size-2 rounded-full bg-success"></span>
							{t('kiosk.camera_ready')}
						{/if}
					</div>

					<!--
						One silhouette, drawn in the frame's own pixels: a head ellipse spanning 58% of the
						frame's height, a neck gap, then shoulders that fade as they run off the bottom edge.
						The geometry is `silhouetteGeometry(frame)`; the frame is measured above, so the
						guide scales with the video at every breakpoint. The countdown sits in the head.
					-->
					<svg
						viewBox="0 0 {silhouette.width} {silhouette.height}"
						preserveAspectRatio="none"
						class="pointer-events-none absolute inset-0 size-full {phase === 'challenge'
							? 'text-brand'
							: 'text-white/80'}"
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
					{#if phase === 'challenge'}
						<div
							class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
							style="left: {(silhouette.head.cx / silhouette.width) * 100}%; top: {(silhouette.head
								.cy /
								silhouette.height) *
								100}%;"
						>
							<span
								class="flex size-20 items-center justify-center rounded-full bg-black/70 text-title text-white tabular-nums"
								aria-hidden="true">{challengeLeft}</span
							>
						</div>
					{/if}
				</section>

				<aside class="min-h-0 overflow-y-auto bg-card px-5 py-6 sm:px-8 sm:py-8">
					<div class="mx-auto flex max-w-lg flex-col gap-8">
						<!--
							No action cards. The kiosk does not ask which way to punch — the day already
							knows — so the aside is the person, and the one line above it says what to do.
						-->
						<section class="hidden lg:block">
							<h1 class="text-section">{t('kiosk.how_it_works')}</h1>
							<p class="mt-2 text-sm text-muted-foreground">{t('kiosk.how_it_works_hint')}</p>
						</section>

						<section class="lg:border-t lg:pt-7" aria-labelledby="identity-heading">
							<h2 id="identity-heading" class="text-heading">{t('kiosk.identity')}</h2>
							{#if candidate !== null}
								<div class="mt-4 flex items-start gap-4">
									<div
										class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
									>
										<Icon
											icon={phase === 'done' ? 'lucide:check' : 'lucide:user-round'}
											class="size-6"
										/>
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate text-subhead">{candidate.employeeName}</p>
										<dl class="mt-3 grid gap-2 text-sm">
											<div class="flex items-center justify-between gap-4 border-b pb-2">
												<dt class="text-muted-foreground">{t('kiosk.entity')}</dt>
												<dd class="truncate font-medium">{candidateCompany}</dd>
											</div>
											<div class="flex items-center justify-between gap-4">
												<dt class="text-muted-foreground">{t('kiosk.employee_number')}</dt>
												<dd class="font-mono text-sm">{candidate.employeeNumber}</dd>
											</div>
										</dl>
									</div>
								</div>
							{:else if phase === 'unknown'}
								<div class="mt-4 flex items-start gap-4">
									<div
										class="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/15"
									>
										<Icon
											icon="lucide:user-round-question"
											class="size-6 text-warning-foreground"
										/>
									</div>
									<div>
										<p class="text-base font-medium">{t('kiosk.unknown_person')}</p>
										<p class="mt-1 text-sm text-muted-foreground">{t('kiosk.unknown_hint')}</p>
									</div>
								</div>
							{:else if phase === 'rejected' && notice !== null}
								<div class="mt-4 flex items-start gap-4">
									<div
										class="flex size-12 shrink-0 items-center justify-center rounded-full bg-destructive/10"
									>
										<Icon icon={notice.icon} class="size-6 text-destructive" />
									</div>
									<div>
										<p class="text-base font-medium">{notice.title}</p>
										<p class="mt-1 text-sm text-muted-foreground">{notice.detail}</p>
									</div>
								</div>
							{:else if phase === 'unavailable'}
								<div class="mt-4 flex items-start gap-4">
									<div
										class="flex size-12 shrink-0 items-center justify-center rounded-full bg-destructive/10"
									>
										<Icon icon="lucide:cpu" class="size-6 text-destructive" />
									</div>
									<div>
										<p class="text-base font-medium">{t('kiosk.engine_unavailable')}</p>
										<p class="mt-1 text-sm text-muted-foreground">
											{t('kiosk.engine_unavailable_detail', { models: engineMissing.join(', ') })}
										</p>
										<Button class="mt-4" variant="secondary" onclick={() => openTab('manual')}>
											<Icon icon="lucide:keyboard" class="size-4" />
											{t('kiosk.manual_entry')}
										</Button>
									</div>
								</div>
							{:else}
								<div class="mt-4 flex items-start gap-4">
									<div
										class="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted"
									>
										<Icon icon="lucide:user-round" class="size-6 text-muted-foreground" />
									</div>
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
								</div>
							{/if}
						</section>
					</div>
				</aside>
			</div>
		{:else}
			<div class="h-full overflow-y-auto bg-muted/40">
				{#key companyId}
					<ManualTab
						{companyId}
						ondone={toScan}
						onworkingchange={(value) => {
							manualWorking = value;
						}}
					/>
				{/key}
			</div>
		{/if}
	</Cover>
</Bound>
