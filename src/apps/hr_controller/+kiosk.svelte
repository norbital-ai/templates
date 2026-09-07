<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import type Human from '@vladmandic/human';
	import { workspaceSession } from '@norbital-ai/bolt/client';
	import { Button } from '@norbital-ai/ui/button';
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
		largestFace,
		missingFaceModels,
		showStream,
		warmFaceEngine
	} from '../../lib/kiosk/face.js';
	import {
		KIOSK_CAPTURE_HEIGHT,
		KIOSK_CAPTURE_WIDTH,
		KIOSK_CONFIRMATION_SECONDS,
		KIOSK_LOOP_MS,
		KIOSK_MATCH_THRESHOLD,
		KIOSK_LIVE_MIN,
		KIOSK_REAL_MIN
	} from '../../lib/kiosk/config.js';
	import { readKioskSettings, writeKioskSettings } from '../../lib/kiosk/settings.js';
	import { browserNarratorPlatform, createKioskNarrator } from '../../lib/kiosk/voice.js';
	import { kioskVoiceLanguage, type KioskPhraseKey } from '../../lib/kiosk/phrases.js';
	import { blockedPhraseKey } from '../../lib/kiosk/punch.js';
	import { silhouetteGeometry, type FrameSize } from '../../lib/kiosk/silhouette.js';

	type Tab = 'scan' | 'manual';
	type Direction = 'in' | 'out';
	type Phase =
		| 'boot'
		| 'scan'
		| 'matching'
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
	type Hint = 'move_closer' | 'no_face';

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
	let phase = $state<Phase>('boot');
	let fatal = $state<string | null>(null);
	/** The enabled face models the engine failed to load; non-empty is the `unavailable` phase. */
	let engineMissing = $state<string[]>([]);
	let candidate = $state<Candidate | null>(null);
	let punch = $state<PunchResult | null>(null);
	let notice = $state<KioskStatus | null>(null);
	let hint = $state<Hint | null>(null);
	let challengeLeft = $state(0);
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
	let analyseCanvas: HTMLCanvasElement | null = null;
	let loopTimer: ReturnType<typeof setInterval> | null = null;
	let clockTimer: ReturnType<typeof setInterval> | null = null;
	let resetTimer: ReturnType<typeof setTimeout> | null = null;
	let inFlight = false;
	let challengeDeadline = 0;
	let lastFaceSeenAt = 0;
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

	const FACE_LOST_GRACE_MS = 700;
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
		columns: { id: true, name: true },
		limit: 200
	});
	const companyById = $derived(
		new Map((companiesQuery.current ?? []).map((company) => [company.id, company.name]))
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
		kind === 'move_closer'
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
		if (phase === 'challenge' && candidate !== null)
			return {
				tone: 'neutral',
				icon: 'lucide:scan-face',
				title: t('kiosk.identity_confirmed', { name: candidate.employeeName }),
				detail: t('kiosk.countdown_detail', { seconds: challengeLeft })
			};
		if (phase === 'working')
			return {
				tone: 'neutral',
				icon: 'lucide:loader-circle',
				title: t('kiosk.recording'),
				detail: t('kiosk.recording_detail')
			};
		if (phase === 'matching')
			return {
				tone: 'neutral',
				icon: 'lucide:scan-face',
				title: t('kiosk.reading_face'),
				detail: t('kiosk.reading_face_detail')
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
		narrator.say(kind);
	};

	const toggleVoice = () => {
		voiceEnabled = !voiceEnabled;
		writeKioskSettings({ voiceEnabled });
		narrator.setEnabled(voiceEnabled);
	};

	const openTab = (next: Tab) => {
		clearResetTimer();
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

	/**
	 * Whether this face reads as a living person rather than a print or a screen, from the two
	 * independent Human graphs. Both must clear; they fail on different attacks, which is why there
	 * are two. A face the engine could not score at all reads as not live, never as live by default.
	 */
	const isLiveFace = (face: { readonly real?: number; readonly live?: number }): boolean =>
		(face.real ?? 0) >= KIOSK_REAL_MIN && (face.live ?? 0) >= KIOSK_LIVE_MIN;

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
			human = await warmFaceEngine();
			analyseCanvas = createAnalyseCanvas();
			engineMissing = missingFaceModels(human);
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
	const acceptPunch = (result: PunchCommandResult, matchedCandidate: Candidate) => {
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
		narrator.say(
			phase === 'blocked'
				? blockedPhraseKey(punch.reason)
				: result.status === 'out'
					? 'checked_out'
					: 'checked_in'
		);
		void matchedCandidate;
		scheduleResume(5000);
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

	const acceptMatch = (matched: MatchResult) => {
		if (tab !== 'scan' || phase !== 'matching') return;
		if (matched.status === 'unenrolled') {
			rejectFace(
				{
					tone: 'warning',
					icon: 'lucide:badge-alert',
					title: matched.employee.name,
					detail: t('kiosk.no_active_employment')
				},
				'no_active_employment'
			);
			return;
		}
		if (matched.status !== 'match') {
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
		// The hold, and nothing asked of the person: standing there is the confirmation, and it is
		// also what gives the two presentation-attack graphs a run of frames instead of one lucky
		// one. Silent on purpose — the countdown in the silhouette is the whole instruction.
		phase = 'challenge';
		challengeDeadline = Date.now() + KIOSK_CONFIRMATION_SECONDS * 1000;
		challengeLeft = KIOSK_CONFIRMATION_SECONDS;
		lastFaceSeenAt = Date.now();
	};

	onMount(() => {
		void boot();
		void loadOrganizationBrand();
		clockTimer = setInterval(() => (now = new Date()), 1000);
		/**
		 * The loop runs whenever the engine is ready and the tab is the clock. There is nothing to
		 * choose first: a readable, live face is matched, held for the confirmation window, and
		 * written — the clock decides whether that punch was the arrival or the departure.
		 */
		loopTimer = setInterval(async () => {
			if (
				tab !== 'scan' ||
				human === null ||
				analyseCanvas === null ||
				videoNode === null ||
				inFlight ||
				(phase !== 'scan' && phase !== 'challenge') ||
				!drawVideoFrame(videoNode, analyseCanvas)
			)
				return;
			inFlight = true;
			try {
				const result = await human.detect(analyseCanvas);
				const face = largestFace(result.face ?? []);
				const present = face !== undefined;
				const faceVisible = face !== undefined && face.embedding !== undefined;
				const nowMs = Date.now();

				if (phase === 'challenge') {
					if (faceVisible) lastFaceSeenAt = nowMs;
					if (nowMs - lastFaceSeenAt > FACE_LOST_GRACE_MS) {
						rejectFace(
							{
								tone: 'warning',
								icon: 'lucide:scan-face',
								title: t('kiosk.face_lost'),
								detail: t('kiosk.face_lost_detail')
							},
							'face_lost',
							true
						);
						return;
					}
					// Every frame of the hold must read as live, not just the one that started it: a
					// print swapped in front of a real face mid-countdown fails here.
					if (faceVisible && !isLiveFace(face)) {
						rejectFace(
							{
								tone: 'error',
								icon: 'lucide:shield-alert',
								title: t('kiosk.live_face_required'),
								detail: t('kiosk.live_face_required_detail')
							},
							'live_face_required',
							true
						);
						return;
					}
					challengeLeft = Math.max(0, Math.ceil((challengeDeadline - nowMs) / 1000));
					if (faceVisible && nowMs >= challengeDeadline) {
						const matchedCandidate = candidate;
						if (matchedCandidate === null) return;
						phase = 'working';
						try {
							const punchResult = await client.invoke.kiosk_punch({
								employment_id: matchedCandidate.employmentId,
								kind: 'FACE'
							});
							acceptPunch(punchResult, matchedCandidate);
						} catch (error) {
							failPunch(error);
						}
					}
					return;
				}

				// Scanning: a face the engine cannot read (a box with no embedding: too small, turned
				// away, or a description graph that never loaded) is "move closer" after two
				// seconds; nobody at all is "no face detected" after five. Each is said once per
				// attempt so the kiosk is never mute at a person.
				if (!faceVisible) {
					if (present) {
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
				unreadableSince = 0;
				absentSince = 0;
				hint = null;
				if (!isLiveFace(face)) {
					rejectFace(
						{
							tone: 'error',
							icon: 'lucide:shield-alert',
							title: t('kiosk.live_face_required'),
							detail: t('kiosk.live_face_required_detail')
						},
						'live_face_required'
					);
					return;
				}
				phase = 'matching';
				const matched = await client.invoke.kiosk_match({
					probe: face.embedding,
					threshold: KIOSK_MATCH_THRESHOLD
				});
				acceptMatch(matched);
			} catch (error) {
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
			stopTimers();
			stopCamera();
			human?.reset();
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
		class="flex min-h-16 items-center justify-between gap-4 border-b bg-card px-4 py-3 sm:px-6"
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
											{hint !== null ? hintStatus(hint).title : t('kiosk.waiting_for_face')}
										</p>
										<p class="mt-1 text-sm text-muted-foreground">
											{hint !== null ? hintStatus(hint).detail : t('kiosk.waiting_for_face_hint')}
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
				<ManualTab ondone={toScan} />
			</div>
		{/if}
	</Cover>
</Bound>
