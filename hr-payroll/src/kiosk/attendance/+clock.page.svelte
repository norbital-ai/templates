<script lang="ts">
	import { createKioskSession } from './kiosk_session.svelte.js';
	import { Clock, Data, Duration, Effect, Match, Result } from 'effect';
	import { watch } from 'runed';
	/**
	 * The attendance kiosk: a full-screen time clock for one legal entity. A live face held in the outline for two
	 * seconds is matched on the device against the enrolled descriptors and punched on the person's day
	 * (`roster_entry`); the manual tab keys a punch by name. The engine, anti-spoof, voice and silhouette are
	 * this page's own modules.
	 */
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
	import ManualTab from './manual.svelte';
	import { punchWork, type PunchResult as PunchCommandResult } from './punch.js';
	import {
		createAnalyseCanvas,
		drawVideoFrame,
		FaceUnavailable,
		missingFaceModels,
		showStream,
		unpaddedFaceBox
	} from './face.ts';
	import { KIOSK_CAPTURE_HEIGHT, KIOSK_CAPTURE_WIDTH } from './config.ts';
	import { KIOSK_MATCH_THRESHOLD } from './embed.ts';
	import { readKioskSettings, writeKioskSettings } from './settings.ts';
	import { browserNarratorPlatform, createKioskNarrator } from './voice.ts';
	import { kioskVoiceLanguage, kioskCaptureRefusalPhrase, type KioskPhraseKey } from './phrases.ts';
	import { todayKey } from '../../lib/ui/format/calendar.js';
	import {
		faceInsideSilhouette,
		fitFrame,
		silhouetteGeometry,
		type FrameSize
	} from './silhouette.ts';
	import { loadAntiSpoof, scoreAntiSpoof } from './anti_spoof.ts';
	import { observeKioskHold, kioskSecondsLeft, sameKioskPerson, type KioskHold } from './hold.ts';
	import { getErrorMessage } from '../../lib/payroll_engine/foundation.js';
	type Tab = 'scan' | 'manual';
	type Phase = Data.TaggedEnum<{
		boot: {};
		scan: { readonly hint: Hint | null };
		challenge: { readonly candidate: Candidate | null; readonly hold: KioskHold };
		working: { readonly candidate: Candidate };
		done: { readonly candidate: Candidate; readonly punch: PunchResult };
		blocked: { readonly candidate: Candidate; readonly punch: PunchResult };
		unknown: {};
		rejected: { readonly candidate: Candidate | null; readonly notice: KioskStatus };
		unavailable: { readonly models: readonly string[] };
		error: { readonly message: string };
	}>;
	const Phase = Data.taggedEnum<Phase>();
	type StatusTone = 'neutral' | 'success' | 'warning' | 'error';
	/** What the loop tells a person it can see but cannot read, or cannot see at all. */
	type Hint = 'move_closer' | 'no_face' | 'live_face_required';
	type Candidate = Readonly<{
		employeeName: string;
		employmentId: Id<'employment_contract'>;
		employeeNumber: string;
		companyId: Id<'entity'>;
	}>;
	type PunchResult = PunchCommandResult;
	/** What the kiosk's own face match answers. */
	type MatchResult =
		| {
				readonly status: 'unknown';
		  }
		| {
				readonly status: 'unenrolled';
				readonly employee: {
					readonly id: Id<'employment_profile'>;
					readonly name: string;
				};
		  }
		| {
				readonly status: 'match';
				readonly employee: {
					readonly id: Id<'employment_profile'>;
					readonly name: string;
				};
				readonly employment: {
					readonly id: Id<'employment_contract'>;
					readonly employee_number: string;
					readonly company_id: Id<'entity'>;
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
	let selectedCompanyId = $state<Id<'entity'> | null>(null);
	let manualWorking = $state(false);
	let phase = $state<Phase>(Phase.boot());
	const fatal = $derived(phase._tag === 'error' ? phase.message : null);
	const engineMissing = $derived(phase._tag === 'unavailable' ? phase.models : []);
	const candidate = $derived('candidate' in phase ? phase.candidate : null);
	const notice = $derived(phase._tag === 'rejected' ? phase.notice : null);
	const hint = $derived(phase._tag === 'scan' ? phase.hint : null);
	let hold = $state.raw<KioskHold | null>(null);
	const challengeLeft = $derived(phase._tag === 'challenge' ? kioskSecondsLeft(phase.hold) : 0);
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
		antiSpoof: Effect.Success<ReturnType<typeof loadAntiSpoof>> | null;
		cropCanvas: HTMLCanvasElement | null;
		analyseCanvas: HTMLCanvasElement | null;
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
	const companies = $derived.by(() =>
		bolt.query({
			entity: { output: 'kiosk', fields: ['name'], orderBy: { name: 'asc' }, limit: 200 }
		})
	);
	const companyById = $derived(
		new Map((companies?.current?.entity.rows ?? []).map((company) => [company.id, company.name]))
	);
	const companyId = $derived(
		selectedCompanyId != null && companyById.has(selectedCompanyId) ? selectedCompanyId : null
	);
	const candidateCompany = $derived(
		candidate === null
			? bolt.t('kiosk.entity_unknown')
			: (companyById.get(candidate.companyId) ?? bolt.t('kiosk.entity_unknown'))
	);
	const organizationDisplayName = $derived(
		organizationName.trim() || bolt.t('kiosk.organization_fallback')
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
	const blockedStatus = (punch: PunchResult): KioskStatus => {
		if (punch?.reason === 'pendingApproval')
			return {
				tone: 'warning',
				icon: 'lucide:clock',
				title: bolt.t('offboarding.pending'),
				detail: bolt.t('kiosk.pending_approval_detail')
			};
		// Not rostered today is not a failure and must not be dressed as one: the person did nothing
		// wrong, and the only useful thing the screen can do is name the day's plan.
		if (punch?.reason === 'not-scheduled')
			return {
				tone: 'warning',
				icon: 'lucide:calendar-off',
				title: bolt.t('kiosk.not_scheduled'),
				detail: bolt.t('kiosk.not_scheduled_detail')
			};
		if (punch?.reason === 'not-a-work-day')
			return {
				tone: 'warning',
				icon: 'lucide:calendar-off',
				title: bolt.t('kiosk.not_a_work_day'),
				detail: bolt.t('kiosk.not_a_work_day_detail', { code: punch.plannedCode ?? '—' })
			};
		if (punch?.reason === 'cooldown')
			return {
				tone: 'warning',
				icon: 'lucide:timer-reset',
				title: bolt.t('kiosk.too_soon'),
				detail: bolt.t('kiosk.too_soon_detail', {
					seconds: Math.ceil((punch.retryAfterMs ?? 0) / 1000)
				})
			};
		return {
			tone: 'warning',
			icon: 'lucide:circle-alert',
			title: bolt.t('kiosk.unchanged'),
			detail: bolt.t('kiosk.unchanged_detail')
		};
	};
	const hintStatus = (kind: Hint): KioskStatus =>
		kind === 'live_face_required'
			? {
					tone: 'warning',
					icon: 'lucide:shield-alert',
					title: bolt.t('kiosk.live_face_required'),
					detail: bolt.t('kiosk.live_face_required_detail')
				}
			: kind === 'move_closer'
				? {
						tone: 'warning',
						icon: 'lucide:scan-face',
						title: bolt.t('kiosk.move_closer'),
						detail: bolt.t('kiosk.move_closer_detail')
					}
				: {
						tone: 'warning',
						icon: 'lucide:user-round-search',
						title: bolt.t('kiosk.no_face'),
						detail: bolt.t('kiosk.no_face_detail')
					};
	const status = $derived.by((): KioskStatus => {
		if (notice !== null) return notice;
		if (companyId == null)
			return {
				tone: 'neutral',
				icon: 'lucide:building-2',
				title: bolt.t('component.choose_legal_entity'),
				detail: companies?.error?.message ?? bolt.t('kiosk.choose_entity_before_punch')
			};
		if (tab === 'manual')
			return {
				tone: 'neutral',
				icon: 'lucide:keyboard',
				title: bolt.t('kiosk.manual_entry'),
				detail: bolt.t('kiosk.manual_status')
			};
		return Match.value(phase).pipe(
			Match.tagsExhaustive({
				boot: (): KioskStatus => ({
					tone: 'neutral',
					icon: 'lucide:loader-circle',
					title: bolt.t('kiosk.preparing'),
					detail: bolt.t('kiosk.preparing_detail')
				}),
				error: ({ message }): KioskStatus => ({
					tone: 'error',
					icon: 'lucide:camera-off',
					title: bolt.t('kiosk.camera_unavailable'),
					detail: message || bolt.t('kiosk.camera_help')
				}),
				unavailable: ({ models }): KioskStatus => ({
					tone: 'error',
					icon: 'lucide:cpu',
					title: bolt.t('kiosk.engine_unavailable'),
					detail: bolt.t('kiosk.engine_unavailable_detail', { models: models.join(', ') })
				}),
				challenge: ({ candidate, hold }): KioskStatus => ({
					tone: 'neutral',
					icon: 'lucide:scan-face',
					title:
						candidate === null
							? bolt.t('kiosk.reading_face')
							: bolt.t('kiosk.identity_confirmed', { name: candidate.employeeName }),
					detail: bolt.t('kiosk.countdown_detail', { seconds: kioskSecondsLeft(hold) })
				}),
				working: (): KioskStatus => ({
					tone: 'neutral',
					icon: 'lucide:loader-circle',
					title: bolt.t('kiosk.recording'),
					detail: bolt.t('kiosk.recording_detail')
				}),
				done: ({ candidate, punch }): KioskStatus => ({
					tone: 'success',
					icon: 'lucide:circle-check',
					title:
						punch.status === 'out' ? bolt.t('kiosk.recorded_out') : bolt.t('kiosk.recorded_in'),
					detail: bolt.t('kiosk.recorded_detail', {
						name: candidate.employeeName,
						time: clockTime(punch.time)
					})
				}),
				blocked: ({ punch }) => blockedStatus(punch),
				unknown: (): KioskStatus => ({
					tone: 'warning',
					icon: 'lucide:user-round-question',
					title: bolt.t('kiosk.unknown_person'),
					detail: bolt.t('kiosk.unknown_hint')
				}),
				rejected: ({ notice }) => notice,
				scan: ({ hint }): KioskStatus =>
					hint === null
						? {
								tone: 'neutral',
								icon: 'lucide:scan-face',
								title: bolt.t('kiosk.ready'),
								detail: bolt.t('kiosk.waiting_for_face_hint')
							}
						: hintStatus(hint)
			})
		);
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
	const clearResetTimer = () => session.cancelReset();
	const clearHints = () => {
		if (phase._tag === 'scan') phase = Phase.scan({ hint: null });
		handles.unreadableSince = 0;
		handles.absentSince = 0;
		spokenHints.clear();
	};
	const resumeScan = () => {
		clearResetTimer();
		handles.scanSession = {};
		handles.matchInFlight = false;
		hold = null;
		clearHints();
		phase = Phase.scan({ hint: null });
	};
	const scheduleResume = (delay = 4500) => session.resumeAfter(delay, resumeScan);
	watch(
		() => bolt.locale,
		(locale) => narrator.setLanguage(kioskVoiceLanguage(locale))
	);
	const showHint = (kind: Hint) => {
		if (hint === kind) return;
		if (phase._tag === 'scan') phase = Phase.scan({ hint: kind });
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
		if (phase._tag !== 'boot' && phase._tag !== 'error' && phase._tag !== 'unavailable')
			phase = Phase.scan({ hint: null });
	};
	const toScan = () => {
		openTab('scan');
		if (phase._tag === 'boot' || phase._tag === 'unavailable' || fatal !== null) return;
		resumeScan();
	};
	const selectCompany = (id: Id<'entity'> | null) => {
		if (phase._tag === 'working' || manualWorking) return;
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
	let sessionId = $state(0);
	const boot = () => {
		sessionId += 1;
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
		const held = preserveIdentity ? candidate : null;
		hold = null;
		phase = Phase.rejected({ candidate: held, notice: next });
		if (phrase !== null) narrator.say(phrase);
		scheduleResume();
	};
	/** Only a committed punch announces arrival/departure; the screen explains pending or refused writes. */
	const acceptPunch = (result: PunchCommandResult) => {
		if (tab !== 'scan' || phase._tag !== 'working') return;
		const held = phase.candidate;
		phase =
			result.status === 'blocked'
				? Phase.blocked({ candidate: held, punch: result })
				: Phase.done({ candidate: held, punch: result });
		handles.completedProbe = hold?.probe ?? null;
		hold = null;
		if (result.reason !== 'pendingApproval')
			narrator.say(
				phase._tag === 'blocked'
					? kioskCaptureRefusalPhrase(result.reason)
					: result.status === 'out'
						? 'checked_out'
						: 'checked_in'
			);
	};
	const failPunch = (error: unknown) => {
		if (tab !== 'scan' || phase._tag !== 'working') return;
		rejectFace(
			{
				tone: 'error',
				icon: 'lucide:triangle-alert',
				title: bolt.t('kiosk.record_failed'),
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
		requestedCompanyId: Id<'entity'>
	) => {
		if (
			tab !== 'scan' ||
			phase._tag !== 'challenge' ||
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
					detail: bolt.t('kiosk.no_active_contract_in_entity')
				},
				'no_active_employment'
			);
			return;
		}
		if (matched.status !== 'match') return;
		phase = Phase.challenge({
			hold: phase.hold,
			candidate: {
				employeeName: matched.employee.name,
				employmentId: matched.employment.id,
				employeeNumber: matched.employment.employee_number,
				companyId: matched.employment.company_id
			}
		});
	};
	/** Cosine distance between two descriptors; `NaN` when either is unusable. */
	const faceDistance = (left: readonly number[], right: readonly number[]): number => {
		if (left.length === 0 || left.length !== right.length) return Number.NaN;
		let dot = 0;
		let leftNorm = 0;
		let rightNorm = 0;
		for (const [i, a] of left.entries()) {
			const b = right[i];
			if (b === undefined) return Number.NaN;
			dot += a * b;
			leftNorm += a * a;
			rightNorm += b * b;
		}
		const norm = leftNorm * rightNorm;
		return Number.isFinite(norm) && norm > 0 ? 1 - dot / Math.sqrt(norm) : Number.NaN;
	};
	const rangeCovers = (
		range: {
			readonly from: string;
			readonly to: string | null;
		},
		day: string
	): boolean => range.from <= day && (range.to == null || range.to >= day);
	/**
	 * The enrolled person nearest the probe, then their active contract in the entity. A cleared
	 * face_embedding on the signed-in person's profile is not read: the read is over APPROVED rows only.
	 */
	const matchFace = Effect.fnUntraced(function* (
		requestedCompanyId: Id<'entity'>,
		probe: readonly number[],
		threshold: number
	) {
		const { employment_profile: holders } = yield* bolt.query({
			employment_profile: {
				output: 'kiosk',
				where: { face_enrollment_status: { eq: 'APPROVED' } },
				fields: ['name', 'face_embedding']
			}
		});
		let best: {
			readonly id: Id<'employment_profile'>;
			readonly name: string;
		} | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const row of holders.rows) {
			const stored = row.face_embedding;
			if (stored == null) continue;
			const distance = faceDistance(probe, stored);
			if (Number.isFinite(distance) && distance < bestDistance) {
				bestDistance = distance;
				best = { id: row.id, name: row.name };
			}
		}
		if (best == null || bestDistance > threshold)
			return { status: 'unknown' } satisfies MatchResult;
		const { employment_contract: contracts } = yield* bolt.query({
			employment_contract: {
				output: 'kiosk',
				where: {
					employee_id: { eq: best.id },
					company_id: { eq: requestedCompanyId }
				},
				fields: ['employee_number', 'company_id', 'effective_range']
			}
		});
		const day = todayKey(new Date(yield* Clock.currentTimeMillis));
		const active = contracts.rows.find((row) => rangeCovers(row.effective_range, day));
		if (active == null) return { status: 'unenrolled', employee: best } satisfies MatchResult;
		return {
			status: 'match',
			employee: best,
			employment: {
				id: active.id,
				employee_number: active.employee_number,
				company_id: active.company_id
			}
		} satisfies MatchResult;
	});
	const scanAttendanceFrame = Effect.fnUntraced(function* () {
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
			(phase._tag !== 'scan' &&
				phase._tag !== 'challenge' &&
				phase._tag !== 'done' &&
				phase._tag !== 'blocked') ||
			!drawVideoFrame(handles.videoNode, handles.analyseCanvas, frame)
		)
			return;
		handles.lastFrameTime = handles.videoNode.currentTime;
		handles.inFlight = true;
		const activeSession = handles.scanSession;
		const human = handles.human,
			antiSpoof = handles.antiSpoof,
			analyseCanvas = handles.analyseCanvas,
			cropCanvas = handles.cropCanvas;
		return yield* Effect.gen(function* () {
			const detectStart = Duration.toMillis(Duration.nanos(yield* Clock.monotonicTimeNanos));
			const result = yield* Effect.tryPromise({
				try: (signal) =>
					human.detect(analyseCanvas).then((result) => {
						if (signal.aborted) human.reset();
						return result;
					}),
				catch: (cause) => new FaceUnavailable({ message: getErrorMessage(cause) })
			});
			if (
				handles.disposed ||
				activeSession !== handles.scanSession ||
				(phase._tag !== 'scan' &&
					phase._tag !== 'challenge' &&
					phase._tag !== 'done' &&
					phase._tag !== 'blocked')
			)
				return;
			performance.clearMeasures('kiosk.face');
			performance.measure('kiosk.face', { start: detectStart });
			const faces = result.face
				.map((face) => ({ ...face, box: unpaddedFaceBox(face.box) }))
				.filter((face) => faceInsideSilhouette(face.box, analyseCanvas, frame));
			const face = faces.length === 1 ? faces[0] : undefined;
			const nowMs = Duration.toMillis(Duration.nanos(yield* Clock.monotonicTimeNanos));
			if (face?.embedding === undefined) {
				handles.completedProbe = null;
				hold = null;
				phase = Phase.scan({ hint: null });
				if (result.face.length > 0) {
					handles.absentSince = 0;
					if (handles.unreadableSince === 0) handles.unreadableSince = nowMs;
					else if (nowMs - handles.unreadableSince >= MOVE_CLOSER_AFTER_MS) showHint('move_closer');
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
			const scoreStart = Duration.toMillis(Duration.nanos(yield* Clock.monotonicTimeNanos));
			const liveScore = yield* scoreAntiSpoof(antiSpoof, analyseCanvas, face.box, cropCanvas);
			if (
				handles.disposed ||
				activeSession !== handles.scanSession ||
				(phase._tag !== 'scan' &&
					phase._tag !== 'challenge' &&
					phase._tag !== 'done' &&
					phase._tag !== 'blocked')
			)
				return;
			performance.clearMeasures('kiosk.liveness');
			performance.measure('kiosk.liveness', {
				start: scoreStart,
				detail: { score: liveScore, box: face.box }
			});
			const previousProbe = hold?.probe;
			hold = observeKioskHold(
				hold,
				{ embedding: face.embedding, liveScore },
				Duration.toMillis(Duration.nanos(yield* Clock.monotonicTimeNanos))
			);
			if (hold === null) {
				phase = Phase.scan({ hint: null });
				showHint('live_face_required');
				return;
			}
			handles.unreadableSince = 0;
			handles.absentSince = 0;
			if (phase._tag === 'scan') phase = Phase.scan({ hint: null });
			phase = Phase.challenge({ hold, candidate: hold.probe !== previousProbe ? null : candidate });
			if (candidate === null && !handles.matchInFlight && kioskSecondsLeft(hold) === 0) {
				// Two seconds of live frames, and the last reply named nobody.
				hold = null;
				phase = Phase.unknown();
				narrator.say('identity_unknown');
				scheduleResume(5500);
				return;
			}
			if (candidate === null && !handles.matchInFlight) {
				handles.matchInFlight = true;
				const holdProbe = hold.probe;
				const matchStart = Duration.toMillis(Duration.nanos(yield* Clock.monotonicTimeNanos));
				yield* Effect.forkScoped(
					matchFace(activeCompanyId, hold.embedding, KIOSK_MATCH_THRESHOLD).pipe(
						Effect.tap((matched) =>
							Effect.sync(() => {
								performance.clearMeasures('kiosk.match');
								performance.measure('kiosk.match', { start: matchStart });
								if (activeSession === handles.scanSession)
									acceptMatch(matched, holdProbe, activeCompanyId);
							})
						),
						Effect.catch((error) =>
							Effect.sync(() => {
								if (
									activeSession !== handles.scanSession ||
									hold?.probe !== holdProbe ||
									handles.disposed
								)
									return;
								rejectFace(
									{
										tone: 'error',
										icon: 'lucide:triangle-alert',
										title: bolt.t('kiosk.read_failed'),
										detail: getErrorMessage(error)
									},
									'try_again'
								);
							})
						),
						Effect.ensuring(
							Effect.sync(() => {
								if (activeSession === handles.scanSession) handles.matchInFlight = false;
							})
						)
					)
				);
			}
			if (
				candidate !== null &&
				candidate.companyId === activeCompanyId &&
				kioskSecondsLeft(hold) === 0
			) {
				const selectedCandidate = candidate;
				phase = Phase.working({ candidate: selectedCandidate });
				const punchStart = Duration.toMillis(Duration.nanos(yield* Clock.monotonicTimeNanos));
				performance.clearMeasures('kiosk.hold');
				performance.measure('kiosk.hold', { start: hold.startedAt });
				const employment = selectedCandidate.employmentId;
				yield* punchWork(employment, 'FACE').pipe(
					Effect.tap((result) =>
						Effect.sync(() => {
							performance.clearMeasures('kiosk.punch');
							performance.measure('kiosk.punch', { start: punchStart });
							if (!handles.disposed && activeSession === handles.scanSession) acceptPunch(result);
						})
					),
					Effect.catch((error) =>
						Effect.sync(() => {
							if (!handles.disposed && activeSession === handles.scanSession) failPunch(error);
						})
					)
				);
			}
		}).pipe(
			Effect.catch((error) =>
				Effect.sync(() => {
					if (handles.disposed || activeSession !== handles.scanSession) return;
					rejectFace(
						{
							tone: 'error',
							icon: 'lucide:triangle-alert',
							title: bolt.t('kiosk.read_failed'),
							detail: getErrorMessage(error)
						},
						'try_again'
					);
				})
			),
			Effect.ensuring(
				Effect.sync(() => {
					if (human === handles.human) handles.inFlight = false;
				})
			)
		);
	});
	const session = createKioskSession({
		boot: () => {
			handles.disposed = false;
			handles.scanSession = {};
			handles.inFlight = false;
			handles.matchInFlight = false;
			handles.lastFrameTime = -1;
			handles.completedProbe = null;
			handles.stream = null;
			handles.human = null;
			handles.antiSpoof = null;
			hold = null;
			phase = Phase.boot();
			clearHints();
		},
		ready: (stream, human, spoof) => {
			handles.stream = stream;
			handles.human = human;
			handles.antiSpoof = Result.isSuccess(spoof) ? spoof.success : null;
			handles.analyseCanvas = createAnalyseCanvas();
			handles.cropCanvas = document.createElement('canvas');
			handles.cropCanvas.width = handles.cropCanvas.height = 80;
			if (handles.videoNode !== null) showStream(handles.videoNode, stream);
			const models = missingFaceModels(human);
			if (Result.isFailure(spoof)) models.push('MiniFASNet');
			phase = models.length > 0 ? Phase.unavailable({ models }) : Phase.scan({ hint: null });
			if (phase._tag === 'unavailable') narrator.say('engine_unavailable');
		},
		clock: (next) => {
			now = next;
		},
		scan: scanAttendanceFrame,
		failed: (failure) => {
			phase = Phase.error({ message: getErrorMessage(failure) });
		},
		disposed: () => {
			handles.disposed = true;
			handles.scanSession = {};
			hold = null;
			handles.stream = null;
			handles.human = null;
			handles.antiSpoof = null;
			narrator.stop();
		}
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
			<Inline justify="center" class="size-10 overflow-clip rounded-lg border bg-background">
				{#if organizationLogoUrl !== null}
					<img
						src={organizationLogoUrl}
						alt={bolt.t('kiosk.organization_logo', { name: organizationDisplayName })}
						class="size-full object-contain p-1"
					/>
				{:else}
					<span class="text-sm font-semibold">{organizationInitials}</span>
				{/if}
			</Inline>
			<div class="min-w-0">
				<p class="truncate text-heading">{organizationDisplayName}</p>
				<p class="text-meta">{bolt.t('kiosk.title')}</p>
			</div>
		</Inline>

		<div data-kiosk-company>
			<Picker
				of="entity"
				label={['name']}
				where={{}}
				orderBy="name"
				value={companyId}
				onChange={selectCompany}
				disabled={phase._tag === 'working' || manualWorking || companies?.loading}
			/>
		</div>

		<div class="hidden text-right sm:block">
			<time datetime={now.toISOString()} class="block text-heading tabular-nums">{currentTime}</time
			>
			<p class="text-meta">{currentDate}</p>
		</div>

		<Inline gap="xs" aria-label={bolt.t('kiosk.tools')}>
			<Button
				variant={tab === 'scan' ? 'secondary' : 'ghost'}
				onclick={toScan}
				aria-label={bolt.t('kiosk.clock')}
				aria-pressed={tab === 'scan'}
			>
				<Icon icon="lucide:scan-face" class="size-4" />
				<span class="hidden md:inline">{bolt.t('kiosk.clock')}</span>
			</Button>
			<Button
				variant={tab === 'manual' ? 'secondary' : 'ghost'}
				onclick={() => openTab('manual')}
				aria-label={bolt.t('kiosk.manual_entry')}
				aria-pressed={tab === 'manual'}
			>
				<Icon icon="lucide:keyboard" class="size-4" />
				<span class="hidden md:inline">{bolt.t('kiosk.manual_entry')}</span>
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-pressed={voiceEnabled}
				aria-label={voiceEnabled ? bolt.t('kiosk.voice_off') : bolt.t('kiosk.voice_on')}
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
			<Frame ratio="square" class="size-9 rounded-full bg-current/10">
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
	`Bound size="fill"` + `Cover`: the kiosk is a full-screen device surface with its own header
	and status bar as the chrome rows and the body as the definite middle track — deliberately not
	an `AppShell`, which would add a workspace hero around a shop-floor time clock. The body grid
	used to be `h-full` under a root with no definite height, which is where the empty band under
	the status bar came from. The camera cell is a definite track at every breakpoint — the
	remaining height above the identity panel below `lg`, the left column from `lg` — and the frame
	inside it keeps the camera's own aspect ratio, letterboxed on the dark cell, never cropped: a
	near-square iPad column used to show a 16:9 stream with its sides cut off, and a portrait
	tablet under a 16:9 `aspect-video` frame showed a third of a portrait stream.
-->
<Bound size="fill">
	{#key sessionId}
		<div {@attach session.attach} class="contents">
			<Cover
				as="main"
				size="fill"
				top={header}
				bottom={statusBar}
				gap="none"
				class="bg-background text-foreground"
			>
				{#if tab === 'scan' && phase._tag === 'boot'}
					<Stack align="center" justify="center" size="fill" gap="md">
						<Spinner class="size-8" label={bolt.t('kiosk.preparing')} />
						<p class="text-sm text-muted-foreground">{bolt.t('kiosk.preparing_detail')}</p>
					</Stack>
				{:else if tab === 'scan' && phase._tag === 'error'}
					<Stack align="center" justify="center" size="fill" gap="md" class="px-6 text-center">
						<Frame ratio="square" class="size-14 rounded-full bg-destructive/10 text-destructive">
							<Icon icon="lucide:camera-off" class="size-7" />
						</Frame>
						<Stack gap="xs" align="center">
							<h1 class="text-section">{bolt.t('kiosk.camera_unavailable')}</h1>
							<p class="max-w-xl text-sm text-muted-foreground">
								{fatal ?? bolt.t('kiosk.camera_help')}
							</p>
						</Stack>
						<Button onclick={() => void boot()}>
							<Icon icon="lucide:refresh-cw" class="size-4" />
							{bolt.t('kiosk.retry')}
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
								clip
								class="relative"
								style="width: {frame.width}px; height: {frame.height}px;"
								aria-label={bolt.t('kiosk.camera')}
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
										class="size-full {phase._tag === 'challenge' ? 'text-brand' : 'text-white/80'}"
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
										data-kiosk-engine={phase._tag === 'unavailable' ? 'unavailable' : 'ready'}
									>
										{#if phase._tag === 'unavailable'}
											<span class="size-2 rounded-full bg-destructive"></span>
											{bolt.t('kiosk.engine_unavailable')}
										{:else}
											<span class="size-2 rounded-full bg-success"></span>
											{bolt.t('kiosk.camera_ready')}
										{/if}
									</Inline>
								</Imposter>

								{#if phase._tag === 'challenge'}
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

						<Scroll
							as="aside"
							size="fill"
							name={bolt.t('kiosk.identity')}
							class="bg-card px-5 py-6 sm:px-8 sm:py-8"
						>
							<Center measure="narrow" layout="stack" gap="xl">
								<!--
							No action cards. The kiosk does not ask which way to punch — the day already
							knows — so the aside is the person, and the one line above it says what to do.
						-->
								<Stack as="section" gap="sm" class="max-lg:hidden">
									<h1 class="text-section">{bolt.t('kiosk.how_it_works')}</h1>
									<p class="text-sm text-muted-foreground">{bolt.t('kiosk.how_it_works_hint')}</p>
								</Stack>

								<Stack
									as="section"
									gap="md"
									class="lg:border-t lg:pt-7"
									aria-labelledby="identity-heading"
								>
									<h2 id="identity-heading" class="text-heading">{bolt.t('kiosk.identity')}</h2>
									{#if candidate !== null}
										<Inline align="start" gap="md">
											<Frame
												ratio="square"
												class="size-12 rounded-full bg-primary text-primary-foreground"
											>
												<Icon
													icon={phase._tag === 'done' ? 'lucide:check' : 'lucide:user-round'}
													class="size-6"
												/>
											</Frame>
											<Stack gap="sm" size="fill">
												<p class="truncate text-subhead">{candidate.employeeName}</p>
												<Stack as="dl" gap="sm" class="text-sm">
													<Inline justify="between" gap="md" class="border-b pb-2">
														<dt class="text-muted-foreground">{bolt.t('kiosk.entity')}</dt>
														<dd class="truncate font-medium">{candidateCompany}</dd>
													</Inline>
													<Inline justify="between" gap="md">
														<dt class="text-muted-foreground">{bolt.t('kiosk.employee_number')}</dt>
														<dd class="font-mono text-sm">{candidate.employeeNumber}</dd>
													</Inline>
												</Stack>
											</Stack>
										</Inline>
									{:else if phase._tag === 'unknown'}
										<Inline align="start" gap="md">
											<Frame ratio="square" class="size-12 rounded-full bg-warning/15">
												<Icon
													icon="lucide:user-round-question"
													class="size-6 text-warning-foreground"
												/>
											</Frame>
											<div>
												<p class="text-base font-medium">{bolt.t('kiosk.unknown_person')}</p>
												<p class="mt-1 text-sm text-muted-foreground">
													{bolt.t('kiosk.unknown_hint')}
												</p>
											</div>
										</Inline>
									{:else if phase._tag === 'rejected' && notice !== null}
										<Inline align="start" gap="md">
											<Frame ratio="square" class="size-12 rounded-full bg-destructive/10">
												<Icon icon={notice.icon} class="size-6 text-destructive" />
											</Frame>
											<div>
												<p class="text-base font-medium">{notice.title}</p>
												<p class="mt-1 text-sm text-muted-foreground">{notice.detail}</p>
											</div>
										</Inline>
									{:else if phase._tag === 'unavailable'}
										<Inline align="start" gap="md">
											<Frame ratio="square" class="size-12 rounded-full bg-destructive/10">
												<Icon icon="lucide:cpu" class="size-6 text-destructive" />
											</Frame>
											<Stack gap="md" align="start">
												<Stack gap="xs">
													<p class="text-base font-medium">{bolt.t('kiosk.engine_unavailable')}</p>
													<p class="text-sm text-muted-foreground">
														{bolt.t('kiosk.engine_unavailable_detail', {
															models: engineMissing.join(', ')
														})}
													</p>
												</Stack>
												<Button variant="secondary" onclick={() => openTab('manual')}>
													<Icon icon="lucide:keyboard" class="size-4" />
													{bolt.t('kiosk.manual_entry')}
												</Button>
											</Stack>
										</Inline>
									{:else}
										<Inline align="start" gap="md">
											<Frame ratio="square" class="size-12 rounded-full bg-muted">
												<Icon icon="lucide:user-round" class="size-6 text-muted-foreground" />
											</Frame>
											<div>
												<p class="text-base font-medium">
													{companyId == null
														? bolt.t('component.choose_legal_entity')
														: hint !== null
															? hintStatus(hint).title
															: bolt.t('kiosk.waiting_for_face')}
												</p>
												<p class="mt-1 text-sm text-muted-foreground">
													{companyId == null
														? bolt.t('kiosk.choose_entity_before_punch')
														: hint !== null
															? hintStatus(hint).detail
															: bolt.t('kiosk.waiting_for_face_hint')}
												</p>
											</div>
										</Inline>
									{/if}
								</Stack>
							</Center>
						</Scroll>
					</div>
				{:else}
					<Scroll name={bolt.t('kiosk.manual_entry')} size="fill" inset class="bg-muted/40">
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
		</div>
	{/key}
</Bound>
