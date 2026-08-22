<!--
	One person-day, opened for editing: the plan, the actual, and why it may be neither.

	── WHY A DRAWER AND NOT A DIALOG ────────────────────────────────────────────────────────────────
	This replaces the single-select assignment dialog the board used to open. A dialog was the right
	container while a cell owned one fact — which roster code is this day? — and stopped being one as
	soon as the cell owned two records and a lock explanation. A modal that covers the board also
	takes away the month while the operator is deciding about one day of it, and the month is most of
	the context: the day before, the day after, and whether the person is already working both.

	A right-hand sheet leaves the board on screen, which is what makes an overlap warning legible.

	── WHAT THIS COMPONENT IS NOT ───────────────────────────────────────────────────────────────────
	It writes nothing. Every save is handed back through `onSave`, because the two records behind a
	day belong to two collections with two different write paths, and both must go through
	`client.db.*` so every hook still runs. A component that reached for the client itself would be a
	second write path, and the first thing it would skip is the lock ladder.

	── OVERTIME ─────────────────────────────────────────────────────────────────────────────────────
	There is no overtime field here and none may be added. `overtime_authorized` and the five
	`approved_ot_*_hours` buckets were dropped deliberately — see `docs/architecture.md` §Gates — and
	"beyond schedule" below is derived by `beyondScheduleMinutes` and rendered read-only. A control
	that let somebody type an overtime figure would be re-introducing the buckets by another name.

	── THE BREAK CLAMP ──────────────────────────────────────────────────────────────────────────────
	`time_entries/+hooks.ts` refuses a closed day whose unpaid break is not strictly shorter than the
	recorded worked time. That is not a hypothetical: four seeded rows carried a sixty-minute break
	against nineteen to forty-one minutes of attendance, which is exactly the shape a naive editor
	produces — it shortens a punch and leaves the break at the roster code's scheduled hour. So the
	sheet assesses every edit with `assessAttendanceDraft`, which is the same arithmetic the hook
	uses, and STATES the clamp where the operator can see it. Silently correcting the break would
	hide that the punch, not the break, is the half that is wrong.

	════════════════════════════════════════════════════════════════════════════════════════════════
	PROP CONTRACT — STABLE. Employee Self-Service renders this same component with `mode="employee"`.
	Adding an optional prop is fine; renaming or re-typing anything below breaks that surface.

	  open                 boolean, bindable   whether the drawer is showing
	  mode                 'controller' | 'employee'  (default 'controller')
	  person               DaySheetPerson | null      employment id, employee number, display name
	  date                 string | null              YYYY-MM-DD, the work date
	  day                  DayFacts | undefined       the person-day, from `buildRosterMonth`
	  intervals            readonly IntervalDraft[]   the day's stored punches (see note below)
	  timeZone             string                     (default PAYROLL_TIME_ZONE) clocks are read in
	  rosterCodeOptions    readonly DaySheetRosterCodeOption[]   controller only; ignored otherwise
	  rosterCodeId         string | null              the code the day currently carries
	  note                 string | null              the note on the explicit entry, if any
	  hasExplicitEntry     boolean                    false when the day is pattern-projected
	  planLocked           boolean                    the plan cannot be changed (no draft, published)
	  planLockedReason     string | null              why, in the operator's words
	  lockRung             LockRung                   OPEN | IN_DRAFT_RUN | CONSUMED | PAID
	  lockReason           string | null              from `sourceLockReason`; null when writable
	  overlapWarning       string | null              a composed sentence, or null
	  canSwap              boolean                    show the swap affordance (draft months only)
	  saving               boolean                    disables the footer and shows progress
	  error                string | null              the write path's own refusal, verbatim
	  restBreakNotice      Snippet | undefined        INTEGRATION POINT — see below
	  onPlanDraftChange    (rosterCodeId: string | null) => void   controller only; keeps the
	                       caller's live overlap check in step with the picker
	  onSave               (change: DaySheetChange) => void | Promise<void>
	  onClearPlan          () => void | Promise<void> remove the explicit entry (controller only)
	  onStartSwap          () => void                 hand the swap gesture back to the board
	  onOpenChange         (open: boolean) => void    close requested

	`DaySheetChange` carries `plan` and `attendance` independently, each null when that half is
	unchanged, hidden or locked — they are two records in two collections and they save separately
	even though one button starts both.
	════════════════════════════════════════════════════════════════════════════════════════════════
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { DayFacts, IntervalDraft, LockRung } from './roster-month.js';

	type DaySheetMode = 'controller' | 'employee';

	export type DaySheetPerson = {
		/** The employment id — the board's row key and the foreign key every write carries. */
		readonly id: string;
		readonly number: string;
		readonly name: string;
	};

	/** A roster code as the picker takes it; the same shape `Combobox` uses everywhere else. */
	type DaySheetRosterCodeOption = {
		readonly value: string;
		readonly label: string;
		readonly search_term?: string;
	};

	type DaySheetPlanChange = {
		readonly rosterCodeId: string;
		readonly note: string | null;
	};

	type DaySheetAttendanceChange = {
		/** Null when nothing has been recorded for this day yet, which makes the write a create. */
		readonly timeEntryId: string | null;
		readonly intervals: readonly IntervalDraft[];
		/** Already clamped by `assessAttendanceDraft`, so the write path cannot refuse it for length. */
		readonly breakMinutes: number;
	};

	export type DaySheetChange = {
		readonly employmentId: string;
		readonly date: string;
		readonly plan: DaySheetPlanChange | null;
		readonly attendance: DaySheetAttendanceChange | null;
	};

	type DaySheetProps = {
		open: boolean;
		mode?: DaySheetMode;
		person: DaySheetPerson | null;
		date: string | null;
		day: DayFacts | undefined;
		/**
		 * The day's stored punches.
		 *
		 * Separate from `day` on purpose. `DayFacts` carries counts and totals because a board cell
		 * needs a glyph, not a list — putting the intervals on it would make every one of nine
		 * thousand person-days hold an array the grid never reads. The sheet is the one surface that
		 * needs them, so the caller hands them over for the one day it opened.
		 */
		intervals?: readonly IntervalDraft[];
		timeZone?: string;
		rosterCodeOptions?: readonly DaySheetRosterCodeOption[];
		rosterCodeId?: string | null;
		note?: string | null;
		hasExplicitEntry?: boolean;
		planLocked?: boolean;
		planLockedReason?: string | null;
		lockRung?: LockRung;
		lockReason?: string | null;
		overlapWarning?: string | null;
		canSwap?: boolean;
		saving?: boolean;
		error?: string | null;
		/**
		 * INTEGRATION POINT — the rest-break badge (§4 of the proposal).
		 *
		 * A sibling module owns `src/lib/scheduling/rest-break.ts` and the `rest_break_rules` member
		 * of `statutory_regime`. When it lands, the app renders `restBreakAssessment(...)` into this
		 * snippet: the shortfall, the citation, and whether an inter-interval gap already satisfied
		 * the rule. Nothing here computes it, and nothing here should — the same numbers have to
		 * reach the publish gate and the write hook, which is why it is a module and not a component.
		 *
		 * Until then the slot renders nothing, which is the correct empty state: no rule is
		 * configured, so there is no shortfall to report.
		 */
		restBreakNotice?: Snippet;
		/**
		 * The roster code currently chosen, mirrored out as it changes.
		 *
		 * The drawer owns the draft — a form that had to round-trip every keystroke through its
		 * caller would be a controlled input pretending to be a component. But the overlap check
		 * needs the *whole month* to run, and only the caller has that. So the choice is mirrored and
		 * the answer comes back as `overlapWarning`. Employee mode never calls it: there is no picker.
		 */
		onPlanDraftChange?: (rosterCodeId: string | null) => void;
		onSave?: (change: DaySheetChange) => void | Promise<void>;
		onClearPlan?: () => void | Promise<void>;
		onStartSwap?: () => void;
		onOpenChange?: (open: boolean) => void;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import * as Sheet from '@norbital-ai/ui/sheet';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { Badge } from '@norbital-ai/ui/badge';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Input } from '@norbital-ai/ui/input';
	import { Label } from '@norbital-ai/ui/label';
	import { Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { cn } from '@norbital-ai/ui/utils';
	import { PAYROLL_TIME_ZONE } from '../calendar.js';
	import { formatCalendarDate, formatDurationHours } from '../display-formatters.js';
	import {
		ATTENDANCE_DRAFT_PROBLEM_KEY,
		DAY_MINUTES,
		HOLIDAY_PRESENTATION,
		LOCK_RAIL_PRESENTATION,
		STATUS_PRESENTATION,
		assessAttendanceDraft,
		beyondScheduleMinutes,
		clockToDayMinutes,
		dayMinutesOffsetDays,
		dayMinutesToClock,
		instantFromDayStart,
		lockRungFreezes,
		minutesFromDayStart,
		scheduledMinutes
	} from './roster-month.js';

	const { t } = useI18n<TenantI18nKeys>();

	let {
		open = $bindable(false),
		mode = 'controller',
		person,
		date,
		day,
		intervals = [],
		timeZone = PAYROLL_TIME_ZONE,
		rosterCodeOptions = [],
		rosterCodeId = null,
		note = null,
		hasExplicitEntry = false,
		planLocked = false,
		planLockedReason = null,
		lockRung = 'OPEN',
		lockReason = null,
		overlapWarning = null,
		canSwap = false,
		saving = false,
		error = null,
		restBreakNotice,
		onPlanDraftChange,
		onSave,
		onClearPlan,
		onStartSwap,
		onOpenChange
	}: DaySheetProps = $props();

	/**
	 * An interval while it is being edited: minutes from the start of the work date.
	 *
	 * Not instants. An operator types a wall clock, and the conversion between a clock and an instant
	 * needs the work date and the business zone — both of which are fixed for the whole sheet. Held
	 * as minutes, a night shift ending at 02:00 is simply 1560 rather than a second date the form
	 * has to keep consistent with the first, and the round trip through
	 * `minutesFromDayStart` / `instantFromDayStart` is exact arithmetic with no timezone in it.
	 */
	type EditableInterval = { startMinutes: number; endMinutes: number | null };

	let draftCodeId = $state<string | null>(null);
	let draftNote = $state('');
	let draftIntervals = $state<EditableInterval[]>([]);
	let draftBreak = $state(0);
	/** Employee mode only: the operator has asked to report a punch on a day that has none. */
	let reporting = $state(false);

	/** Identity of the person-day the drawer is currently loaded with, so a new one re-seeds it. */
	const sheetKey = $derived(`${person?.id ?? ''}:${date ?? ''}`);

	/**
	 * Seed the editors from the record whenever the drawer lands on a different person-day.
	 *
	 * Keyed on the identity rather than on `open`, so re-opening the same cell does not discard an
	 * edit the operator has not saved, while stepping to the next cell always shows that cell's own
	 * numbers. Reading `sheetKey` is the whole dependency — everything else is read untracked
	 * through the assignment, which is what stops the seed from fighting the operator's typing.
	 */
	$effect(() => {
		void sheetKey;
		untrack(() => {
			reporting = false;
			draftCodeId = rosterCodeId;
			onPlanDraftChange?.(rosterCodeId ?? null);
			draftNote = note ?? '';
			draftBreak = day?.breakMinutes ?? day?.shiftBreakMinutes ?? 0;
			/**
			 * A fresh array every time, including when the day has no entry.
			 *
			 * `$state` compares by reference, so re-using the previous array — or leaving it in place
			 * on the empty branch — is an assignment Svelte discards, and the editor would keep
			 * showing the punches of the cell before this one.
			 */
			const workDate = date;
			draftIntervals =
				workDate == null
					? []
					: intervals.map((interval) => ({
							startMinutes: minutesFromDayStart(interval.start_at, workDate, timeZone),
							endMinutes:
								interval.end_at == null
									? null
									: minutesFromDayStart(interval.end_at, workDate, timeZone)
						}));
		});
	});

	const assessment = $derived(
		assessAttendanceDraft(
			date == null
				? []
				: draftIntervals.map((interval) => ({
						start_at: instantFromDayStart(date, interval.startMinutes, timeZone),
						end_at:
							interval.endMinutes == null
								? null
								: instantFromDayStart(date, interval.endMinutes, timeZone)
					})),
			draftBreak
		)
	);

	const frozen = $derived(lockRungFreezes(lockRung));
	const attendanceEditable = $derived(
		!frozen && (mode === 'controller' || reporting) && date != null && person != null
	);
	const planEditable = $derived(mode === 'controller' && !frozen && !planLocked);

	/** Employee mode's one affordance: a day with nothing recorded, on a day that is not locked. */
	const canReportMissingPunch = $derived(
		mode === 'employee' && !frozen && !reporting && day?.timeEntryId == null && day?.past === true
	);

	const planned = $derived(day == null ? null : scheduledMinutes(day));
	/**
	 * Beyond schedule, recomputed from the DRAFT rather than from the stored day.
	 *
	 * The operator is editing punches; the line under them has to move as they type, or it is
	 * describing the record they are replacing. `beyondScheduleMinutes` reads `workedMinutes` off a
	 * `DayFacts`, so the draft's own total is substituted for it — the same function, a different
	 * set of numbers.
	 */
	const beyond = $derived(
		day == null ? null : beyondScheduleMinutes({ ...day, workedMinutes: assessment.workedMinutes })
	);

	/**
	 * The refusal to show, or null.
	 *
	 * Silent while the editor is empty: a controller opening a day nobody has punched has not done
	 * anything wrong, and `NO_INTERVALS` shouted at them in destructive red would say they had.
	 */
	const problemMessage = $derived(
		assessment.problem == null || draftIntervals.length === 0
			? null
			: t(ATTENDANCE_DRAFT_PROBLEM_KEY[assessment.problem])
	);

	/**
	 * Silent for the same reason `problemMessage` is: an empty editor has nothing to clamp against.
	 *
	 * `draftBreak` is seeded from the roster code's scheduled break, so a day nobody has punched opens
	 * with sixty minutes of break against zero minutes of work — which `assessAttendanceDraft` quite
	 * correctly clamps to zero, and which the drawer then announced in an alert saying the break had
	 * been adjusted. Nothing had been adjusted; nothing had been entered. The notice belongs to a
	 * clamp the operator's own numbers caused, which is the only case where it tells them anything.
	 */
	const breakClampNotice = $derived(assessment.breakClamped && draftIntervals.length > 0);

	/**
	 * Whether a save can be offered at all.
	 *
	 * The attendance half is gated on the same assessment the hook will make, so the button is never
	 * live on a draft the write path would refuse. That is the whole point of assessing early: a form
	 * that offers a save and then reports the server's refusal has taught the operator nothing about
	 * which of four things they did wrong, and it does it after a round trip.
	 */
	const attendanceTouched = $derived(attendanceEditable && draftIntervals.length > 0);
	/**
	 * The plan half saves only when it CHANGED.
	 *
	 * The dialog this replaced wrote a `roster_entries` row on every save, which meant that editing a
	 * punch on a pattern-projected day quietly materialised an explicit assignment for it. An
	 * explicit row is not a neutral record of the same fact: it is what stops the pattern from
	 * re-projecting that day, so a month of attendance corrections used to pin a month of the
	 * schedule as a side effect. `rosterCodeId` is seeded with whatever the day already resolves to —
	 * explicit or projected — so "differs from that" is exactly the right test.
	 */
	const planTouched = $derived(
		planEditable &&
			draftCodeId != null &&
			(draftCodeId !== rosterCodeId || draftNote.trim() !== (note ?? '').trim())
	);
	const savable = $derived(
		!saving &&
			(planTouched || attendanceTouched) &&
			(!attendanceTouched || assessment.problem == null) &&
			overlapWarning == null
	);

	function clockValue(minutes: number | null): string {
		return minutes == null ? '' : dayMinutesToClock(minutes);
	}

	function setStart(index: number, clock: string): void {
		const interval = draftIntervals[index];
		if (interval == null) return;
		const minutes = clockToDayMinutes(clock, dayMinutesOffsetDays(interval.startMinutes));
		if (minutes == null) return;
		// A fresh array: `$state` ignores a mutation-in-place that leaves the reference identical.
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index ? { ...entry, startMinutes: minutes } : entry
		);
	}

	function setEnd(index: number, clock: string): void {
		const interval = draftIntervals[index];
		if (interval == null) return;
		if (clock === '') {
			draftIntervals = draftIntervals.map((entry, position) =>
				position === index ? { ...entry, endMinutes: null } : entry
			);
			return;
		}
		const offset = dayMinutesOffsetDays(interval.endMinutes ?? interval.startMinutes);
		const minutes = clockToDayMinutes(clock, offset);
		if (minutes == null) return;
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index ? { ...entry, endMinutes: minutes } : entry
		);
	}

	/**
	 * Move an end onto the following morning, or back off it.
	 *
	 * A night shift needs this and nothing else does, so it is one toggle per end rather than a date
	 * picker on every field — the work date is already the sheet's subject, and offering to change it
	 * per interval would invite a punch to be filed against a day it does not belong to.
	 */
	function shiftEndDay(index: number, days: number): void {
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index && entry.endMinutes != null
				? { ...entry, endMinutes: entry.endMinutes + days * DAY_MINUTES }
				: entry
		);
	}

	function addInterval(): void {
		const previous = draftIntervals.at(-1);
		// A new row starts where the last one ended, which is what an operator adding a second half
		// of a split shift is about to type anyway; failing that, at the rostered start.
		const start =
			previous?.endMinutes ??
			(day?.shiftStart == null ? 9 * 60 : (clockToDayMinutes(day.shiftStart, 0) ?? 9 * 60));
		draftIntervals = [...draftIntervals, { startMinutes: start, endMinutes: start + 60 }];
	}

	function removeInterval(index: number): void {
		draftIntervals = draftIntervals.filter((_entry, position) => position !== index);
	}

	/**
	 * Employee mode's one write: pre-fill the day the roster says it should have been, then let the
	 * person correct it.
	 *
	 * The pre-fill takes the roster code's own break, which is the value that produced the seeded
	 * defect — a scheduled hour against a day that turned out to be minutes long. It is safe here
	 * for the same reason every other path is: nothing goes out un-assessed. `assessAttendanceDraft`
	 * runs over the draft the moment it changes, so a pre-fill the punches cannot support is clamped
	 * and announced exactly as a typed one would be. That is the point of having one assessment
	 * rather than a rule repeated at each affordance.
	 */
	function reportMissingPunch(): void {
		reporting = true;
		if (draftIntervals.length > 0) return;
		const start =
			day?.shiftStart == null ? 9 * 60 : (clockToDayMinutes(day.shiftStart, 0) ?? 9 * 60);
		const end =
			day?.shiftEnd == null ? start + 480 : (clockToDayMinutes(day.shiftEnd, 0) ?? start + 480);
		draftIntervals = [{ startMinutes: start, endMinutes: end <= start ? end + DAY_MINUTES : end }];
		draftBreak = day?.shiftBreakMinutes ?? 0;
	}

	function save(): void {
		if (person == null || date == null || !savable) return;
		void onSave?.({
			employmentId: person.id,
			date,
			plan:
				planTouched && draftCodeId != null
					? { rosterCodeId: draftCodeId, note: draftNote.trim() === '' ? null : draftNote.trim() }
					: null,
			attendance: attendanceTouched
				? {
						timeEntryId: day?.timeEntryId ?? null,
						intervals: draftIntervals.map((interval) => ({
							start_at: instantFromDayStart(date, interval.startMinutes, timeZone),
							end_at:
								interval.endMinutes == null
									? null
									: instantFromDayStart(date, interval.endMinutes, timeZone)
						})),
						// The clamped value, never the typed one. `assessAttendanceDraft` has already
						// reduced it to something the hook accepts, and the notice below says it did.
						breakMinutes: assessment.breakMinutes
					}
				: null
		});
	}

	const heading = $derived(
		date == null
			? ''
			: `${formatCalendarDate(date)} · ${person?.number ?? ''} ${person?.name ?? ''}`
	);
</script>

{#snippet fieldRow(label: string, value: string)}
	<Inline gap="sm" align="baseline" class="text-xs">
		<span class="min-w-28 shrink-0 text-muted-foreground">{label}</span>
		<span class="min-w-0 break-words">{value}</span>
	</Inline>
{/snippet}

<Sheet.Root
	bind:open
	onOpenChange={(next) => {
		open = next;
		onOpenChange?.(next);
	}}
>
	<!--
		Width comes from the sheet's own `--sheet-width` knob rather than a `w-*` class. The variant
		spells its desktop width as `md:w-[var(--sheet-width,75%)]`, and a utility class of the same
		specificity would win or lose depending on Tailwind's emission order — which is the exact bug
		`sheet-variants.ts` documents having already been bitten by once.
	-->
	<Sheet.Content side="right" style="--sheet-width: 34rem; --sheet-max-width: 95vw;">
		<Sheet.Header>
			<Sheet.Title>{heading}</Sheet.Title>
			<Sheet.Description>
				{day == null ? t('roster.day_sheet_no_facts') : t(STATUS_PRESENTATION[day.status].labelKey)}
			</Sheet.Description>
		</Sheet.Header>

		{#if day != null && date != null}
			<Scroll name={t('roster.day_sheet_plan')} layout="stack" gap="lg" grow class="pr-1">
				<!-- ── PLAN ────────────────────────────────────────────────────────────────────── -->
				<Stack gap="sm">
					<Inline gap="sm" justify="between" align="center">
						<h3 class="text-overline text-muted-foreground">{t('roster.day_sheet_plan')}</h3>
						{#if mode === 'controller'}
							<!--
								DISABLED WITH A REASON, never hidden.

								This button used to be rendered only when `canSwap`, so in a published month — or a
								month nobody has drafted yet — the affordance simply was not there, and the operator
								was left to conclude that swapping shifts is not something this product does. It is:
								a swap is two `roster_entries` writes, and `roster_entries/+hooks.ts` refuses both in
								a month that is not a draft. That refusal is a fact worth stating, and the sentence
								for it is already on screen — `planLockedReason` renders under the picker below and
								names which of the two cases this is. A frozen day (payroll has taken it) disables it
								too, and the LOCK panel further down says which run.
							-->
							<Button
								variant="outline"
								size="sm"
								disabled={saving || frozen || !canSwap}
								title={canSwap ? undefined : (planLockedReason ?? undefined)}
								onclick={() => onStartSwap?.()}
							>
								<IconWrapper name="lucide:arrow-left-right" class="size-3.5" />
								{t('roster.day_sheet_swap')}
							</Button>
						{/if}
					</Inline>

					{#if mode === 'controller'}
						<Stack gap="xs">
							<!--
								A <span>, not a <Label>. `Combobox` is not a labellable control — it carries its
								own `ariaLabel` — and a <label> with nothing to point at is an accessibility
								warning that reads as a fix while making the picker no easier to reach.
							-->
							<span class="text-xs font-medium">{t('roster.choose_roster_code')}</span>
							<Combobox
								ariaLabel={t('roster.choose_roster_code')}
								options={[...rosterCodeOptions]}
								value={draftCodeId}
								disabled={!planEditable}
								onValueChange={(value) => {
									draftCodeId = typeof value === 'string' ? value : null;
									onPlanDraftChange?.(draftCodeId);
								}}
								emptyPlaceholder={t('roster.choose_roster_code')}
								searchPlaceholder={t('roster.search_roster_codes')}
							/>
						</Stack>
						<Stack gap="xs">
							<Label for="day-sheet-note">{t('roster.day_sheet_note')}</Label>
							<Input
								id="day-sheet-note"
								value={draftNote}
								disabled={!planEditable}
								placeholder={t('roster.day_sheet_note_placeholder')}
								oninput={(event) => (draftNote = event.currentTarget.value)}
							/>
						</Stack>
					{:else}
						<!-- Employee mode reads the plan; it never sets it. A roster is HR's record. -->
						{@render fieldRow(
							t('roster.day_sheet_roster_code'),
							day.shiftCode ?? t(STATUS_PRESENTATION[day.status].labelKey)
						)}
					{/if}

					{@render fieldRow(
						t('roster.day_sheet_source'),
						hasExplicitEntry
							? day.origin === 'IMPORT'
								? t('roster.origin_import')
								: t('roster.origin_manual')
							: t('roster.day_sheet_source_pattern')
					)}
					{#if day.shiftStart != null && day.shiftEnd != null}
						{@render fieldRow(
							t('roster.day_sheet_scheduled'),
							t('roster.shift_window', {
								start: day.shiftStart,
								end: day.shiftEnd,
								break: (day.shiftBreakMinutes ?? 0) / 60
							})
						)}
					{/if}

					<Cluster gap="xs">
						{#if day.holidayName != null}
							<Badge variant="outline">
								{t(HOLIDAY_PRESENTATION.labelKey)}: {day.holidayName}
							</Badge>
						{/if}
						{#if day.leaveCode != null}
							<Badge variant="outline">
								{day.leaveCode}{day.halfDayLeave ? ` (${t('roster.half_day')})` : ''}
							</Badge>
						{/if}
						{#if day.pendingLeave}
							<Badge variant="outline">{t('roster.pending_leave')}</Badge>
						{/if}
						{#if day.plannedOT}
							<Badge variant="outline">{t('roster.planned_ot')}</Badge>
						{/if}
					</Cluster>

					{#if overlapWarning != null}
						<Alert variant="destructive">
							<AlertTitle>{t('roster.overlapping_shift')}</AlertTitle>
							<AlertDescription>{overlapWarning}</AlertDescription>
						</Alert>
					{:else if mode === 'controller' && planLocked && planLockedReason != null}
						<p class="text-xs text-muted-foreground">{planLockedReason}</p>
					{/if}
				</Stack>

				<!-- ── ACTUAL ──────────────────────────────────────────────────────────────────── -->
				<Stack gap="sm">
					<h3 class="text-overline text-muted-foreground">{t('roster.day_sheet_actual')}</h3>

					{#if attendanceEditable}
						{#each draftIntervals as interval, index (index)}
							<Inline gap="xs" align="center" class="text-xs">
								<span class="min-w-16 shrink-0 text-muted-foreground">
									{t('roster.day_sheet_interval', { index: index + 1 })}
								</span>
								<Input
									type="time"
									class="w-28"
									aria-label={t('roster.day_sheet_interval_start', { index: index + 1 })}
									value={clockValue(interval.startMinutes)}
									oninput={(event) => setStart(index, event.currentTarget.value)}
								/>
								<span aria-hidden="true">→</span>
								<Input
									type="time"
									class="w-28"
									aria-label={t('roster.day_sheet_interval_end', { index: index + 1 })}
									value={clockValue(interval.endMinutes)}
									oninput={(event) => setEnd(index, event.currentTarget.value)}
								/>
								{#if interval.endMinutes != null}
									<!-- The night-shift affordance: one toggle, not a date picker per field. -->
									<Button
										variant={dayMinutesOffsetDays(interval.endMinutes) > 0 ? 'default' : 'ghost'}
										size="sm"
										aria-pressed={dayMinutesOffsetDays(interval.endMinutes) > 0}
										title={t('roster.day_sheet_next_day')}
										onclick={() =>
											shiftEndDay(
												index,
												dayMinutesOffsetDays(interval.endMinutes ?? 0) > 0 ? -1 : 1
											)}
									>
										+1d
									</Button>
								{/if}
								<Button
									variant="ghost"
									size="icon"
									aria-label={t('roster.day_sheet_remove_interval', { index: index + 1 })}
									onclick={() => removeInterval(index)}
								>
									<IconWrapper name="lucide:x" class="size-3.5" />
								</Button>
							</Inline>
						{/each}
						<Inline>
							<Button variant="outline" size="sm" onclick={() => addInterval()}>
								<IconWrapper name="lucide:plus" class="size-3.5" />
								{t('roster.day_sheet_add_interval')}
							</Button>
						</Inline>

						<Inline gap="sm" align="center">
							<Label for="day-sheet-break" class="min-w-28 shrink-0 text-xs">
								{t('roster.day_sheet_unpaid_break')}
							</Label>
							<Input
								id="day-sheet-break"
								type="number"
								min="0"
								step="1"
								class="w-24"
								value={String(draftBreak)}
								oninput={(event) => (draftBreak = Number(event.currentTarget.value) || 0)}
							/>
							<span class="text-xs text-muted-foreground">{t('roster.day_sheet_minutes')}</span>
						</Inline>

						{#if breakClampNotice}
							<!--
								Stated, never silent. The operator asked for one break and the day can only carry
								another, and the reason is almost always that the punch is too short rather than
								that the break is too long — which they can only see if the change is visible.
							-->
							<Alert>
								<AlertTitle>{t('roster.day_sheet_break_clamped_title')}</AlertTitle>
								<AlertDescription>
									{t('roster.day_sheet_break_clamped', {
										requested: assessment.requestedBreakMinutes,
										applied: assessment.breakMinutes,
										worked: Math.round(assessment.closedMinutes)
									})}
								</AlertDescription>
							</Alert>
						{/if}
						{#if problemMessage != null}
							<Alert variant="destructive">
								<AlertTitle>{t('roster.day_sheet_cannot_save')}</AlertTitle>
								<AlertDescription>{problemMessage}</AlertDescription>
							</Alert>
						{/if}
					{:else}
						<!-- Read-only actual: the same numbers, with nothing to press. -->
						{@render fieldRow(
							t('roster.day_sheet_recorded'),
							day.workedIntervalCount === 0
								? t('roster.no_attendance')
								: t('roster.attendance_intervals', { count: day.workedIntervalCount })
						)}
						{#if canReportMissingPunch}
							<Inline>
								<Button variant="outline" size="sm" onclick={() => reportMissingPunch()}>
									<IconWrapper name="lucide:flag" class="size-3.5" />
									{t('roster.day_sheet_report_missing_punch')}
								</Button>
							</Inline>
							<p class="text-xs text-muted-foreground">
								{t('roster.day_sheet_report_missing_punch_help')}
							</p>
						{/if}
					{/if}

					<!--
						Derived, read-only, and the only place a length-of-day figure appears. There is no
						overtime input on this sheet and none may be added — see the header comment.

						The two-arm split is not cosmetic. `beyondScheduleMinutes` is signed, so a day with
						nothing recorded against an eight-hour shift reports "beyond schedule −8 hr", which
						reads as a measurement of overtime that came out negative rather than as the absence
						of any measurement at all. Nobody worked −8 hours. Until there is a punch to compare,
						the honest line is the plan and the fact that nothing has been recorded against it.
					-->
					<p class="text-xs">
						{#if assessment.workedMinutes == null || assessment.workedMinutes === 0}
							{t('roster.day_sheet_totals_planned', {
								scheduled: formatDurationHours(planned, t)
							})}
						{:else}
							{t('roster.day_sheet_totals', {
								worked: formatDurationHours(assessment.workedMinutes, t),
								scheduled: formatDurationHours(planned, t),
								beyond: formatDurationHours(beyond, t)
							})}
						{/if}
					</p>

					<!-- INTEGRATION POINT: the rest-break badge and its citation. See the prop doc. -->
					{#if restBreakNotice}
						{@render restBreakNotice()}
					{/if}
				</Stack>

				<!-- ── LOCK ────────────────────────────────────────────────────────────────────── -->
				<Stack gap="xs">
					<h3 class="text-overline text-muted-foreground">{t('roster.day_sheet_lock')}</h3>
					<Inline gap="xs" align="center">
						<!--
							Literal variants, never assembled. A class built with a template literal is a class
							Tailwind's source scan never sees, so the swatch would be styled in dev and blank in
							production — the same rule `roster-month.ts` states over `STATUS_PRESENTATION`.
						-->
						<span
							class={cn(
								'inline-block h-4 w-1 rounded-sm',
								lockRung === 'OPEN' && 'bg-muted',
								lockRung === 'IN_DRAFT_RUN' && 'bg-brand/40',
								lockRung === 'CONSUMED' && 'bg-brand/70',
								lockRung === 'PAID' && 'bg-brand'
							)}
						></span>
						<span class="text-xs font-medium">
							{t(LOCK_RAIL_PRESENTATION[lockRung].labelKey)}
						</span>
						{#if LOCK_RAIL_PRESENTATION[lockRung].padlock !== ''}
							<span aria-hidden="true">{LOCK_RAIL_PRESENTATION[lockRung].padlock}</span>
						{/if}
					</Inline>
					<p class="text-xs text-muted-foreground">
						{lockReason ??
							(lockRung === 'IN_DRAFT_RUN' && day.lock.kind === 'IN_WINDOW'
								? t('roster.in_payroll_window', { period: day.lock.period })
								: t('roster.day_sheet_lock_open'))}
					</p>
					<!--
						SCOPED OUT — the `AMENDMENT` origin arm for a published month (§2.4 of the proposal).
						A single-cell write in a published month is refused whole today, and that stays true:
						opening a narrow amendment path needs a new `roster_entries.origin` enum arm and a
						migration, and the decision has not been taken. When it is, this panel is where the
						amendment is offered and `planLockedReason` is the sentence it replaces.
					-->
				</Stack>

				{#if error != null}
					<Alert variant="destructive">
						<AlertTitle>{t('roster.assignment_failed')}</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				{/if}
			</Scroll>
		{/if}

		<Sheet.Footer>
			{#if mode === 'controller' && hasExplicitEntry && planEditable}
				<Button variant="outline" disabled={saving} onclick={() => void onClearPlan?.()}>
					{t('roster.clear_assignment')}
				</Button>
			{/if}
			<Sheet.Close disabled={saving}>{t('roster.cancel')}</Sheet.Close>
			<!--
				The label names what THIS mode's save actually writes. An employee has no `roster_entries`
				grant and never sees the picker, so "Save assignment" described, to the one reader who
				cannot do it, the half of the sheet they are not looking at — while the half they are
				looking at is a punch.
			-->
			<Button disabled={!savable} onclick={() => void save()}>
				{mode === 'controller' ? t('roster.save_assignment') : t('roster.save_punch')}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
