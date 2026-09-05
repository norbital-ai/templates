<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import type Human from '@vladmandic/human';
	import { workspaceSession } from '@norbital-ai/bolt/client';
	import { Button } from '@norbital-ai/ui/button';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { LocaleToggle } from '@norbital-ai/ui/locale-toggle';
	import { Cover, Stack } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import ManualTab from './kiosk-manual.svelte';
	import EnrollTab from './kiosk-enroll.svelte';
	import type { KioskSample } from '../../lib/kiosk/sample.js';
	import {
		createAnalyseCanvas,
		drawVideoFrame,
		extractFaceSample,
		largestFace,
		showStream,
		warmFaceEngine
	} from '../../lib/kiosk/face.js';
	import {
		KIOSK_CAPTURE_HEIGHT,
		KIOSK_CAPTURE_WIDTH,
		KIOSK_CONFIRMATION_SECONDS,
		KIOSK_LOOP_MS,
		KIOSK_MATCH_THRESHOLD,
		KIOSK_REAL_MIN
	} from '../../lib/kiosk/config.js';

	type Tab = 'scan' | 'manual' | 'enroll';
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
		| 'error';
	type StatusTone = 'neutral' | 'success' | 'warning' | 'error';

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

	let tab = $state<Tab>('scan');
	let direction = $state<Direction | null>(null);
	let phase = $state<Phase>('boot');
	let fatal = $state<string | null>(null);
	let candidate = $state<Candidate | null>(null);
	let punch = $state<PunchResult | null>(null);
	let notice = $state<KioskStatus | null>(null);
	let challengeLeft = $state(0);
	let voiceEnabled = $state(true);
	let now = $state(new Date());
	let organizationName = $state('');
	let organizationLogoUrl = $state<string | null>(null);

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
	let challengeEyesOpenSeen = false;
	let challengeLivenessSeen = false;

	const FACE_LOST_GRACE_MS = 700;
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

	const actionLabel = (value: Direction): string =>
		value === 'in' ? t('kiosk.check_in') : t('kiosk.check_out');

	const blockedStatus = (): KioskStatus => {
		if (punch?.reason === 'already-in')
			return {
				tone: 'warning',
				icon: 'lucide:circle-alert',
				title: t('kiosk.already_in'),
				detail: t('kiosk.already_in_detail')
			};
		if (punch?.reason === 'no-open-interval')
			return {
				tone: 'warning',
				icon: 'lucide:circle-alert',
				title: t('kiosk.no_arrival'),
				detail: t('kiosk.no_arrival_detail')
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

	const status = $derived.by((): KioskStatus => {
		if (notice !== null) return notice;
		if (tab === 'manual')
			return {
				tone: 'neutral',
				icon: 'lucide:keyboard',
				title: t('kiosk.manual_entry'),
				detail: t('kiosk.manual_status')
			};
		if (tab === 'enroll')
			return {
				tone: 'neutral',
				icon: 'lucide:user-round-plus',
				title: t('kiosk.enroll_face'),
				detail: t('kiosk.enroll_status')
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
		if (direction === null)
			return {
				tone: 'neutral',
				icon: 'lucide:hand',
				title: t('kiosk.choose_action'),
				detail: t('kiosk.choose_action_detail')
			};
		if (phase === 'challenge' && candidate !== null)
			return {
				tone: 'neutral',
				icon: 'lucide:scan-face',
				title: t('kiosk.identity_confirmed', { name: candidate.employeeName }),
				detail: t('kiosk.countdown_detail', {
					action: actionLabel(direction),
					seconds: challengeLeft
				})
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
				title: direction === 'in' ? t('kiosk.recorded_in') : t('kiosk.recorded_out'),
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
		return {
			tone: 'neutral',
			icon: 'lucide:scan-face',
			title: t('kiosk.ready_for', { action: actionLabel(direction) }),
			detail: t('kiosk.waiting_for_face_hint')
		};
	});

	/** Video node and stream may arrive in either order across scan and enrollment views. */
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

	const resumeScan = (clearDirection = false) => {
		clearResetTimer();
		if (clearDirection) direction = null;
		candidate = null;
		punch = null;
		notice = null;
		challengeEyesOpenSeen = false;
		challengeLivenessSeen = false;
		phase = 'scan';
	};

	const scheduleResume = (delay = 4500) => {
		clearResetTimer();
		resetTimer = setTimeout(() => resumeScan(true), delay);
	};

	const speak = (message: string) => {
		if (!voiceEnabled || !('speechSynthesis' in window)) return;
		window.speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(message);
		utterance.lang = i18n.intlLocale;
		utterance.rate = 0.95;
		window.speechSynthesis.speak(utterance);
	};

	const announce = (next: KioskStatus) => {
		notice = next;
		speak(`${next.title}. ${next.detail}`);
	};

	const selectDirection = (next: Direction) => {
		resumeScan();
		direction = next;
		speak(t('kiosk.action_selected', { action: actionLabel(next) }));
	};

	const openTab = (next: Tab) => {
		clearResetTimer();
		tab = next;
		candidate = null;
		punch = null;
		notice = null;
		if (phase !== 'boot' && phase !== 'error') phase = 'scan';
	};

	const toScan = () => {
		openTab('scan');
		if (phase === 'boot' || fatal !== null) return;
		resumeScan(true);
	};

	const detectedBlink = (gestures: Human['result']['gesture']): boolean =>
		gestures.some(
			(gesture) => 'face' in gesture && gesture.face === 0 && gesture.gesture.startsWith('blink ')
		);

	const boot = async () => {
		phase = 'boot';
		fatal = null;
		try {
			await startCamera();
			human = await warmFaceEngine();
			analyseCanvas = createAnalyseCanvas();
			phase = 'scan';
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

	/** One analysed frame for enrollment: largest face wins, same pipeline as the loop. */
	const analyzeSample = async (): Promise<KioskSample | null> => {
		if (human === null || analyseCanvas === null || videoNode === null) return null;
		return extractFaceSample(human, videoNode, analyseCanvas);
	};

	const rejectFace = (next: KioskStatus, preserveIdentity = false) => {
		phase = 'rejected';
		if (!preserveIdentity) candidate = null;
		announce(next);
		scheduleResume();
	};

	const acceptPunch = (
		result: PunchCommandResult,
		matchedCandidate: Candidate,
		matchedDirection: Direction
	) => {
		if (tab !== 'scan' || phase !== 'working') return;
		punch = {
			status: result.status,
			intervalIndex: 'intervalIndex' in result ? result.intervalIndex : undefined,
			time: 'time' in result ? result.time : undefined,
			reason: 'reason' in result ? String(result.reason) : undefined,
			retryAfterMs: 'retryAfterMs' in result ? Number(result.retryAfterMs) : undefined
		};
		phase = result.status === 'blocked' ? 'blocked' : 'done';
		const outcome = phase === 'blocked' ? blockedStatus() : null;
		if (outcome !== null) speak(`${outcome.title}. ${outcome.detail}`);
		else
			speak(
				`${matchedDirection === 'in' ? t('kiosk.recorded_in') : t('kiosk.recorded_out')}. ${matchedCandidate.employeeName}.`
			);
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
			true
		);
	};

	const acceptMatch = (matched: MatchResult, blinked: boolean) => {
		if (tab !== 'scan' || direction === null || phase !== 'matching') return;
		if (matched.status === 'unenrolled') {
			rejectFace({
				tone: 'warning',
				icon: 'lucide:badge-alert',
				title: matched.employee.name,
				detail: t('kiosk.no_active_employment')
			});
			return;
		}
		if (matched.status !== 'match') {
			phase = 'unknown';
			const unknown = {
				tone: 'warning',
				icon: 'lucide:user-round-question',
				title: t('kiosk.unknown_person'),
				detail: t('kiosk.unknown_hint')
			} satisfies KioskStatus;
			speak(`${unknown.title}. ${unknown.detail}`);
			scheduleResume(5500);
			return;
		}
		candidate = {
			employeeName: matched.employee.name,
			employmentId: matched.employment.id,
			employeeNumber: matched.employment.employee_number,
			companyId: matched.employment.company_id
		};
		phase = 'challenge';
		challengeDeadline = Date.now() + KIOSK_CONFIRMATION_SECONDS * 1000;
		challengeLeft = KIOSK_CONFIRMATION_SECONDS;
		lastFaceSeenAt = Date.now();
		challengeEyesOpenSeen = !blinked;
		challengeLivenessSeen = false;
		speak(
			t('kiosk.identity_confirmed_voice', {
				name: candidate.employeeName,
				action: actionLabel(direction)
			})
		);
	};

	onMount(() => {
		void boot();
		void loadOrganizationBrand();
		clockTimer = setInterval(() => (now = new Date()), 1000);
		loopTimer = setInterval(async () => {
			if (
				tab !== 'scan' ||
				direction === null ||
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
				const faceVisible = face !== undefined && face.embedding !== undefined;
				const blinked = detectedBlink(result.gesture ?? []);

				if (phase === 'challenge') {
					if (faceVisible) {
						lastFaceSeenAt = Date.now();
						if (blinked && challengeEyesOpenSeen) challengeLivenessSeen = true;
						else if (!blinked) challengeEyesOpenSeen = true;
					}
					if (Date.now() - lastFaceSeenAt > FACE_LOST_GRACE_MS) {
						rejectFace(
							{
								tone: 'warning',
								icon: 'lucide:scan-face',
								title: t('kiosk.face_lost'),
								detail: t('kiosk.face_lost_detail')
							},
							true
						);
						return;
					}
					if (faceVisible && (face.real ?? 0) < KIOSK_REAL_MIN) {
						rejectFace(
							{
								tone: 'error',
								icon: 'lucide:shield-alert',
								title: t('kiosk.live_face_required'),
								detail: t('kiosk.live_face_required_detail')
							},
							true
						);
						return;
					}
					challengeLeft = Math.max(0, Math.ceil((challengeDeadline - Date.now()) / 1000));
					if (faceVisible && Date.now() >= challengeDeadline) {
						if (!challengeLivenessSeen) {
							rejectFace(
								{
									tone: 'error',
									icon: 'lucide:shield-alert',
									title: t('kiosk.live_face_required'),
									detail: t('kiosk.live_face_required_detail')
								},
								true
							);
							return;
						}
						const matchedCandidate = candidate;
						const matchedDirection = direction;
						if (matchedCandidate === null || matchedDirection === null) return;
						phase = 'working';
						try {
							const punchResult = await client.invoke.kiosk_punch({
								employment_id: matchedCandidate.employmentId,
								kind: 'FACE',
								direction: matchedDirection
							});
							acceptPunch(punchResult, matchedCandidate, matchedDirection);
						} catch (error) {
							failPunch(error);
						}
					}
					return;
				}

				if (!faceVisible) return;
				if ((face.real ?? 0) < KIOSK_REAL_MIN) {
					rejectFace({
						tone: 'error',
						icon: 'lucide:shield-alert',
						title: t('kiosk.live_face_required'),
						detail: t('kiosk.live_face_required_detail')
					});
					return;
				}
				phase = 'matching';
				const matched = await client.invoke.kiosk_match({
					probe: face.embedding,
					threshold: KIOSK_MATCH_THRESHOLD
				});
				acceptMatch(matched, blinked);
			} catch (error) {
				rejectFace({
					tone: 'error',
					icon: 'lucide:triangle-alert',
					title: t('kiosk.read_failed'),
					detail: error instanceof Error ? error.message : String(error)
				});
			} finally {
				inFlight = false;
			}
		}, KIOSK_LOOP_MS);
		return () => {
			stopTimers();
			stopCamera();
			human?.reset();
			window.speechSynthesis?.cancel();
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
				<span class="hidden lg:inline">{t('kiosk.clock')}</span>
			</Button>
			<Button
				variant={tab === 'manual' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={() => openTab('manual')}
				aria-label={t('kiosk.manual_entry')}
				aria-pressed={tab === 'manual'}
			>
				<Icon icon="lucide:keyboard" class="size-4" />
				<span class="hidden lg:inline">{t('kiosk.manual_entry')}</span>
			</Button>
			<Button
				variant={tab === 'enroll' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={() => openTab('enroll')}
				aria-label={t('kiosk.enroll_face')}
				aria-pressed={tab === 'enroll'}
			>
				<Icon icon="lucide:user-round-plus" class="size-4" />
				<span class="hidden lg:inline">{t('kiosk.enroll_face')}</span>
			</Button>
			<LocaleToggle showLabel={false} />
			<Button
				variant="ghost"
				size="icon"
				aria-pressed={voiceEnabled}
				aria-label={voiceEnabled ? t('kiosk.voice_off') : t('kiosk.voice_on')}
				onclick={() => {
					voiceEnabled = !voiceEnabled;
					if (!voiceEnabled) window.speechSynthesis?.cancel();
				}}
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
		<div class="grid h-full min-h-0 lg:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.8fr)]">
			<section
				class="relative min-h-80 overflow-hidden bg-foreground lg:min-h-0"
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
				>
					<span class="size-2 rounded-full bg-success"></span>
					{t('kiosk.camera_ready')}
				</div>
				{#if direction !== null}
					<div
						class="absolute top-4 right-4 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white"
					>
						{actionLabel(direction)}
					</div>
				{/if}

				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center px-8 py-12"
				>
					<div class="relative h-72 w-64 max-w-full">
						<div
							class="absolute top-0 left-1/2 h-44 w-36 -translate-x-1/2 rounded-[48%] border-2 {phase ===
							'challenge'
								? 'border-brand'
								: 'border-white/80'}"
						></div>
						<div
							class="absolute inset-x-0 bottom-0 h-28 rounded-t-[50%] border-x border-t {phase ===
							'challenge'
								? 'border-brand'
								: 'border-white/80'}"
						></div>
						{#if phase === 'challenge'}
							<div class="absolute inset-0 flex items-center justify-center">
								<span
									class="flex size-20 items-center justify-center rounded-full bg-black/70 text-title text-white tabular-nums"
									aria-hidden="true">{challengeLeft}</span
								>
							</div>
						{/if}
					</div>
				</div>
			</section>

			<aside class="min-h-0 overflow-y-auto bg-card px-5 py-6 sm:px-8 sm:py-8">
				<div class="mx-auto flex max-w-lg flex-col gap-8">
					<section>
						<h1 class="text-section">{t('kiosk.ask_action')}</h1>
						<p class="mt-2 text-sm text-muted-foreground">{t('kiosk.ask_action_hint')}</p>
						<div class="mt-5 grid grid-cols-2 gap-3">
							<button
								type="button"
								aria-pressed={direction === 'in'}
								disabled={phase === 'matching' || phase === 'challenge' || phase === 'working'}
								onclick={() => selectDirection('in')}
								class="flex min-h-28 flex-col items-start justify-between rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {direction ===
								'in'
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-input bg-background hover:bg-accent'}"
							>
								<Icon icon="lucide:log-in" class="size-6" />
								<span>
									<strong class="block text-base font-semibold">{t('kiosk.check_in')}</strong>
									<span class="mt-1 block text-sm opacity-75">{t('kiosk.check_in_hint')}</span>
								</span>
							</button>
							<button
								type="button"
								aria-pressed={direction === 'out'}
								disabled={phase === 'matching' || phase === 'challenge' || phase === 'working'}
								onclick={() => selectDirection('out')}
								class="flex min-h-28 flex-col items-start justify-between rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {direction ===
								'out'
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-input bg-background hover:bg-accent'}"
							>
								<Icon icon="lucide:log-out" class="size-6" />
								<span>
									<strong class="block text-base font-semibold">{t('kiosk.check_out')}</strong>
									<span class="mt-1 block text-sm opacity-75">{t('kiosk.check_out_hint')}</span>
								</span>
							</button>
						</div>
					</section>

					<section class="border-t pt-7" aria-labelledby="identity-heading">
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
									<Icon icon="lucide:user-round-question" class="size-6 text-warning-foreground" />
								</div>
								<div>
									<p class="text-base font-medium">{t('kiosk.unknown_person')}</p>
									<p class="mt-1 text-sm text-muted-foreground">{t('kiosk.unknown_hint')}</p>
									<Button class="mt-4" variant="secondary" onclick={() => openTab('enroll')}>
										<Icon icon="lucide:user-round-plus" class="size-4" />
										{t('kiosk.enroll_person')}
									</Button>
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
						{:else}
							<div class="mt-4 flex items-start gap-4">
								<div
									class="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted"
								>
									<Icon icon="lucide:user-round" class="size-6 text-muted-foreground" />
								</div>
								<div>
									<p class="text-base font-medium">
										{direction === null ? t('kiosk.choose_action') : t('kiosk.waiting_for_face')}
									</p>
									<p class="mt-1 text-sm text-muted-foreground">
										{direction === null
											? t('kiosk.choose_action_detail')
											: t('kiosk.waiting_for_face_hint')}
									</p>
								</div>
							</div>
						{/if}
					</section>
				</div>
			</aside>
		</div>
	{:else if tab === 'manual'}
		<div class="h-full overflow-y-auto bg-muted/40">
			<ManualTab ondone={toScan} />
		</div>
	{:else}
		<div class="h-full overflow-y-auto bg-muted/40">
			<EnrollTab ondone={toScan} ensureCamera={startCamera} {analyzeSample} {attachVideo} />
		</div>
	{/if}
</Cover>
