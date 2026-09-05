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
	The plan picker, the interval editor and the note are custom composition: they write their
	columns through the internal `CollectionForm` (`work_days`) via `form.setValues`, and the
	framework footer owns the native submit, so every write still goes through `client.db.*`
	and every hook still runs. The form's default write carries the whole person-day row, which
	is value-identical on the halves the operator did not touch.

 	`DaySheetChange` is gone with the `onSave` callback it travelled on. The plan and the
 	actual are still two independently-gated halves of ONE row — the plan needs a draft month
 	and a controller, the clock needs neither — and the semantic gate below refuses a submit
 	that changed neither.

	── OVERTIME ─────────────────────────────────────────────────────────────────────────────────────
	There is no overtime field here and none may be added. `overtime_authorized` and the five
	`approved_ot_*_hours` buckets were dropped deliberately — see `docs/architecture.md` §Gates — and
	"beyond schedule" below is derived by `beyondScheduleMinutes` and rendered read-only. A control
	that let somebody type an overtime figure would be re-introducing the buckets by another name.

	── THE BREAK CLAMP ──────────────────────────────────────────────────────────────────────────────
	`work_days/+hooks.ts` refuses a closed day whose unpaid break is not strictly shorter than the
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
	  hasExplicitEntry     boolean                    false when the day carries no plan of its own
	                       (pattern-projected, or a row that holds only attendance)
	  planLocked           boolean                    the plan cannot be changed (no draft, published)
	  planLockedReason     string | null              why, in the operator's words
	  lockRung             LockRung                   OPEN | IN_DRAFT_RUN | CONSUMED | PAID
	  lockReason           string | null              from `sourceLockReason`; null when writable
 	overlapWarning       string | null              a composed sentence, or null
 	canSwap              boolean                    show the swap affordance (draft months only)
 	restBreakNotice      Snippet | undefined        INTEGRATION POINT — see below
 	resolveOverlap       (codeId: string | null) => string | null   controller only; the caller
 	                       owns the month, so the drawer asks it what the currently chosen code
 	                       would overlap; the answer is shown until the choice changes
 	onStartSwap          () => void                 hand the swap gesture back to the board
 	onOpenChange         (open: boolean) => void    close requested

	The drawer owns one `CollectionForm` over `work_days`, keyed by person-day so a new day
	remounts its baseline. Saving, approval-waiting and failure are framework-owned (the footer
	submit, the pending toast, `failure_message`); there are no `saving` / `pendingApproval` /
	`error` props. Clearing the plan is a zero-input gesture, not a form submit: an inline
	command arrow nulls the four plan columns and toasts the outcome itself.
 ════════════════════════════════════════════════════════════════════════════════════════════════
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { DayFacts, IntervalDraft, LockRung } from './roster-month.js';
	import type { AttendanceValue } from './controller-attendance-state.js';

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
		 * The overlap judge, mirrored in as a function instead of the draft being mirrored out.
		 *
		 * The drawer owns its draft — a controlled picker would round-trip every keystroke through
		 * the caller — but the overlap check needs the whole month, and only the caller has that.
		 * So the caller hands over the question, not the answer: the drawer asks whenever its choice
		 * changes and shows the sentence until the next change. No state is mirrored in either
		 * direction.
		 */
		resolveOverlap?: (codeId: string | null) => string | null;
		onStartSwap?: () => void;
		onOpenChange?: (open: boolean) => void;
	};
</script>

<script lang="ts">
	import { Effect } from 'effect';
	import { watch } from 'runed';
	import { client } from '../../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import {
		CollectionForm,
		submitCollectionMutation,
		type CollectionFormController,
		type CollectionFormSemantic
	} from '@norbital-ai/ui/collection-form';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '@norbital-ai/std';
	import * as Sheet from '@norbital-ai/ui/sheet';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { Badge } from '@norbital-ai/ui/badge';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Input } from '@norbital-ai/ui/input';
	import { Label } from '@norbital-ai/ui/label';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { cn } from '@norbital-ai/ui/utils';
	import {
		attendanceChanged,
		daySheetSaveIntent,
		daySheetSaveLabelKey,
		type DaySheetSaveIntent
	} from './controller-attendance-state.js';
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
	import { decodeNumber } from '@norbital-ai/std/json';

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
		canSwap = false,
		restBreakNotice,
		resolveOverlap,
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
	type EditableInterval = { startMinutes: number | null; endMinutes: number | null };

	let draftCodeId = $state<string | null>(null);
	let draftNote = $state('');
	let baselineCodeId = $state<string | null>(null);
	let baselineNote = $state('');
	/** The caller's verdict on the currently chosen code; recomputed on seed and on every change. */
	let overlapWarning = $state<string | null>(null);
	let draftIntervals = $state<EditableInterval[]>([]);
	let draftBreak = $state(0);
	let draftAttendanceRecorded = $state(false);
	let baselineAttendance = $state<AttendanceValue>({ intervals: null, breakMinutes: 0 });
	/** Employee mode only: the operator has asked to report a punch on a day that has none. */
	let reporting = $state(false);

	/** Identity of the person-day the drawer is currently loaded with, so a new one re-seeds it. */
	const sheetKey = $derived(`${person?.id ?? ''}:${date ?? ''}`);

	/**
	 * Seed the editors from the record whenever the drawer lands on a person-day.
	 *
	 * Runs in two cases and no others: the keyed wrapper mounts (a different person-day), and the
	 * sheet opens — which covers reopening the same day after a save, where the key is unchanged
	 * but the baseline must be fresh. While the sheet is open, nothing reseeds: remote updates
	 * must not fight the operator's typing.
	 */
	function seedSheet(): void {
		reporting = false;
		draftCodeId = rosterCodeId;
		baselineCodeId = rosterCodeId;
		overlapWarning = resolveOverlap?.(rosterCodeId ?? null) ?? null;
		draftNote = note ?? '';
		baselineNote = (note ?? '').trim();
		draftBreak = day?.breakMinutes ?? 0;
		draftAttendanceRecorded = day?.attendanceState != null;
		baselineAttendance = {
			intervals:
				day?.attendanceState == null
					? null
					: intervals.map((interval) => ({ start: interval.start, end: interval.end })),
			breakMinutes: day?.breakMinutes ?? 0
		};
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
						startMinutes: minutesFromDayStart(interval.start, workDate, timeZone),
						endMinutes:
							interval.end == null ? null : minutesFromDayStart(interval.end, workDate, timeZone)
					}));
	}

	function seedAttach(): void {
		seedSheet();
	}

	/** Reopening the same person-day keeps its key, so the mount attach does not run; seed here. */
	watch(
		() => open,
		(isOpen) => {
			if (isOpen) seedSheet();
		}
	);

	const draftIntervalValues = $derived(
		date == null
			? []
			: draftIntervals.map((interval) => ({
					start:
						interval.startMinutes == null
							? ''
							: instantFromDayStart(date, interval.startMinutes, timeZone),
					end:
						interval.endMinutes == null
							? null
							: instantFromDayStart(date, interval.endMinutes, timeZone)
				}))
	);
	const assessment = $derived(assessAttendanceDraft(draftIntervalValues, draftBreak));
	const missingIntervalStart = $derived(
		draftAttendanceRecorded && draftIntervals.some((interval) => interval.startMinutes == null)
	);
	const draftAttendance = $derived<AttendanceValue>({
		intervals: draftAttendanceRecorded ? draftIntervalValues : null,
		breakMinutes:
			draftAttendanceRecorded && draftIntervalValues.length > 0
				? Math.max(0, Math.trunc(draftBreak))
				: 0
	});

	const frozen = $derived(lockRungFreezes(lockRung));
	const attendanceWritable = $derived(
		!frozen && (mode === 'controller' || reporting) && date != null && person != null
	);
	const planWritable = $derived(mode === 'controller' && !frozen && !planLocked);

	/** Employee mode's one affordance: a day with nothing recorded, on a day that is not locked. */
	const canReportMissingPunch = $derived(
		mode === 'employee' &&
			!frozen &&
			!reporting &&
			day?.attendanceState == null &&
			day?.past === true
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
		missingIntervalStart
			? t('roster.day_sheet_problem_missing_start')
			: assessment.problem == null || draftIntervals.length === 0
				? null
				: t(ATTENDANCE_DRAFT_PROBLEM_KEY[assessment.problem])
	);

	/**
	 * Silent for the same reason `problemMessage` is: an empty editor has nothing to clamp against.
	 *
	 * An unrecorded day starts with an actual break of zero. Adding the first interval suggests the
	 * scheduled break beside the scheduled window, and only then can a clamp be the result of numbers
	 * the operator is actually considering.
	 */
	const breakClampNotice = $derived(assessment.breakClamped && draftIntervals.length > 0);

	/**
	 * Whether a save can be offered at all.
	 *
	 * Interval attendance is gated on the same assessment the hook will make. The two interval-free
	 * states are intentional exceptions: `[]` is reviewed-no-work and `null` is explicit clearing,
	 * neither of which should be rejected as a missing interval.
	 */
	const attendanceTouched = $derived(
		attendanceWritable && attendanceChanged(baselineAttendance, draftAttendance)
	);
	/**
	 * The plan half saves only when it CHANGED.
	 *
	 * The dialog this replaced wrote an explicit plan on every save, which meant that editing a
	 * punch on a pattern-projected day quietly materialised an explicit assignment for it. An
	 * explicit row is not a neutral record of the same fact: it is what stops the pattern from
	 * re-projecting that day, so a month of attendance corrections used to pin a month of the
	 * schedule as a side effect. The baseline is captured when the sheet changes identity because the
	 * selected code is also mirrored to the caller for live overlap validation; comparing against the
	 * live prop would otherwise erase plan dirty state as soon as the caller received that mirror.
	 */
	const planTouched = $derived(
		planWritable &&
			draftCodeId != null &&
			(draftCodeId !== baselineCodeId || draftNote.trim() !== baselineNote)
	);
	const saveIntent = $derived<DaySheetSaveIntent>(
		daySheetSaveIntent(planTouched, attendanceTouched)
	);

	/**
	 * The form's baseline: update the stored row when one exists, create it when none does.
	 *
	 * Minimal on purpose — only the routing (`id`, or employment plus date) is seeded. Custom
	 * editors push their columns via `setValues` as they are touched, and untouched columns ride
	 * as `undefined`, which the client transport strips, so an attendance-only save cannot rewrite
	 * the plan and a punch on a pattern-projected day cannot materialise an explicit assignment.
	 */
	const formDefaults = $derived(
		day?.workDayId != null
			? { id: day.workDayId }
			: person != null && date != null
				? { employment_id: person.id, work_date: date }
				: undefined
	);

	/**
	 * The guards the old Save button applied, as form validation.
	 *
	 * Interval attendance is gated on the same assessment the hook will make. The two interval-free
	 * states are intentional exceptions: `[]` is reviewed-no-work and `null` is explicit clearing,
	 * neither of which should be rejected as a missing interval. An untouched form is refused so a
	 * create-mode submit cannot land an empty person-day row.
	 */
	const daySheetSemantic: CollectionFormSemantic = (values) =>
		Effect.sync(() => {
			if (overlapWarning != null) return [{ message: overlapWarning }];
			if (!planTouched && !attendanceTouched)
				return [{ message: t('roster.day_sheet_cannot_save') }];
			if (!attendanceTouched) return;
			if (missingIntervalStart) return [{ message: t('roster.day_sheet_problem_missing_start') }];
			if (draftIntervals.length === 0) return;
			const problem = assessment.problem;
			if (problem != null) return [{ message: t(ATTENDANCE_DRAFT_PROBLEM_KEY[problem]) }];
			return;
		});

	/** Mirror the plan half into the form; the picker and the note are custom composition. */
	function pushPlan(form: CollectionFormController): void {
		form.setValues({
			shift_definition_id: draftCodeId,
			planned_origin: 'MANUAL',
			planned_note: draftNote.trim() === '' ? null : draftNote.trim()
		});
	}

	/**
	 * Mirror the actual half into the form, carrying the clamped break, never the typed one.
	 *
	 * `assessAttendanceDraft` has already reduced it to something the hook accepts, and the notice
	 * below says it did. `null` intervals are explicit clearing; untouched editors never call this,
	 * so their columns stay `undefined` and ride past the write.
	 */
	function pushAttendance(form: CollectionFormController): void {
		form.setValues({
			worked_intervals: draftAttendanceRecorded ? draftIntervalValues : null,
			break_minutes:
				draftAttendanceRecorded && draftIntervalValues.length > 0 ? assessment.breakMinutes : 0
		});
	}

	function clockValue(minutes: number | null): string {
		return minutes == null ? '' : dayMinutesToClock(minutes);
	}

	function setStart(index: number, clock: string): void {
		const interval = draftIntervals[index];
		if (interval == null) return;
		if (clock === '') {
			draftIntervals = draftIntervals.map((entry, position) =>
				position === index ? { ...entry, startMinutes: null } : entry
			);
			return;
		}
		const minutes = clockToDayMinutes(clock, dayMinutesOffsetDays(interval.startMinutes ?? 0));
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
		const offset = dayMinutesOffsetDays(interval.endMinutes ?? interval.startMinutes ?? 0);
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
		const scheduledStart =
			day?.shiftStart == null ? 9 * 60 : (clockToDayMinutes(day.shiftStart, 0) ?? 9 * 60);
		const scheduledEnd =
			day?.shiftEnd == null
				? scheduledStart + 8 * 60
				: (clockToDayMinutes(day.shiftEnd, 0) ?? scheduledStart + 8 * 60);
		// The first interval is a suggestion of the planned window, not a persisted fact. Subsequent
		// intervals begin where the preceding split ended and stay intentionally short for editing.
		const start = previous?.endMinutes ?? scheduledStart;
		const end =
			previous == null
				? scheduledEnd <= start
					? scheduledEnd + DAY_MINUTES
					: scheduledEnd
				: start + 60;
		if (!draftAttendanceRecorded) draftBreak = day?.shiftBreakMinutes ?? 0;
		draftAttendanceRecorded = true;
		draftIntervals = [...draftIntervals, { startMinutes: start, endMinutes: end }];
	}

	function removeInterval(index: number): void {
		draftAttendanceRecorded = true;
		draftIntervals = draftIntervals.filter((_entry, position) => position !== index);
		if (draftIntervals.length === 0) draftBreak = 0;
	}

	/** Mark the day absent: a deliberate reviewed-no-work fact without an interval. */
	function markAbsent(): void {
		draftAttendanceRecorded = true;
		draftIntervals = [];
		draftBreak = 0;
	}

	/** Return actual attendance to the distinct unrecorded `null` state. */
	function clearAttendance(): void {
		draftAttendanceRecorded = false;
		draftIntervals = [];
		draftBreak = 0;
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
		draftAttendanceRecorded = true;
		draftBreak = day?.shiftBreakMinutes ?? 0;
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
			{#key sheetKey}
				<div style="display: contents;" {@attach seedAttach}>
					<CollectionForm
						{client}
						collection="work_days"
						defaultValues={formDefaults}
						submitLabel={t(daySheetSaveLabelKey(mode, saveIntent))}
						semantic={daySheetSemantic}
						failure_message={t('roster.day_sheet_save_failed')}
						class="flex-1"
						onAfterSubmit={() => {
							open = false;
						}}
					>
						{#snippet children({ Field, form })}
							<Field name="employment_id" hidden />
							<Field name="work_date" hidden />
							<Field name="shift_definition_id" hidden />
							<Field name="assignment_code" hidden />
							<Field name="planned_origin" hidden />
							<Field name="planned_note" hidden />
							<Field name="worked_intervals" hidden />
							<Field name="break_minutes" hidden />
							<Stack gap="lg" class="pr-1">
								<!-- ── PLAN ────────────────────────────────────────────────────────────────────── -->
								<Stack gap="sm">
									<Inline gap="sm" justify="between" align="center">
										<h3 class="text-overline text-muted-foreground">
											{t('roster.day_sheet_plan')}
										</h3>
										{#if mode === 'controller'}
											<!--
								DISABLED WITH A REASON, never hidden.

								This button used to be rendered only when `canSwap`, so in a published month — or a
								month nobody has drafted yet — the affordance simply was not there, and the operator
								was left to conclude that swapping shifts is not something this product does. It is:
								a swap is two `work_days` writes, and `work_days/+hooks.ts` refuses both in
								a month that is not a draft. That refusal is a fact worth stating, and the sentence
								for it is already on screen — `planLockedReason` renders under the picker below and
								names which of the two cases this is. A frozen day (payroll has taken it) disables it
								too, and the LOCK panel further down says which run.
							-->
											<Button
												variant="outline"
												size="sm"
												type="button"
												disabled={frozen || !canSwap}
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
												disabled={!planWritable}
												onValueChange={(value) => {
													draftCodeId = value;
													overlapWarning = resolveOverlap?.(draftCodeId) ?? null;
													pushPlan(form);
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
												disabled={!planWritable}
												placeholder={t('roster.day_sheet_note_placeholder')}
												oninput={(event) => {
													draftNote = event.currentTarget.value;
													pushPlan(form);
												}}
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
											? day.plannedOrigin === 'IMPORT'
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
									<h3 class="text-overline text-muted-foreground">
										{t('roster.day_sheet_actual')}
									</h3>

									{#if attendanceWritable}
										{#each draftIntervals as interval, index (index)}
											<Inline gap="xs" align="center" class="flex-wrap text-xs">
												<span class="min-w-16 shrink-0 text-muted-foreground">
													{t('roster.day_sheet_interval', { number: index + 1 })}
												</span>
												<Input
													type="time"
													required
													class="w-28"
													aria-label={t('roster.day_sheet_interval_start', { number: index + 1 })}
													value={clockValue(interval.startMinutes)}
													oninput={(event) => {
														setStart(index, event.currentTarget.value);
														pushAttendance(form);
													}}
												/>
												<span aria-hidden="true">→</span>
												<Input
													type="time"
													class="w-28"
													aria-label={t('roster.day_sheet_interval_end', { number: index + 1 })}
													value={clockValue(interval.endMinutes)}
													oninput={(event) => {
														setEnd(index, event.currentTarget.value);
														pushAttendance(form);
													}}
												/>
												{#if interval.endMinutes != null}
													<!-- The night-shift affordance: one toggle, not a date picker per field. -->
													<Button
														variant={dayMinutesOffsetDays(interval.endMinutes) > 0
															? 'default'
															: 'ghost'}
														size="sm"
														type="button"
														aria-pressed={dayMinutesOffsetDays(interval.endMinutes) > 0}
														title={t('roster.day_sheet_next_day')}
														onclick={() => {
															shiftEndDay(
																index,
																dayMinutesOffsetDays(interval.endMinutes ?? 0) > 0 ? -1 : 1
															);
															pushAttendance(form);
														}}
													>
														+1d
													</Button>
												{/if}
												<Button
													variant="ghost"
													size="icon"
													type="button"
													aria-label={t('roster.day_sheet_remove_interval', { number: index + 1 })}
													onclick={() => {
														removeInterval(index);
														pushAttendance(form);
													}}
												>
													<IconWrapper name="lucide:x" class="size-3.5" />
												</Button>
											</Inline>
										{/each}
										{#if draftAttendanceRecorded && draftIntervals.length === 0}
											<Alert>
												<AlertTitle>{t('roster.day_sheet_absent')}</AlertTitle>
												<AlertDescription>
													{t('roster.day_sheet_absent_description')}
												</AlertDescription>
											</Alert>
										{:else if !draftAttendanceRecorded}
											<p class="text-xs text-muted-foreground">
												{t('roster.day_sheet_unrecorded_attendance')}
											</p>
										{/if}

										<Cluster gap="xs">
											<Button
												variant="outline"
												size="sm"
												type="button"
												onclick={() => {
													addInterval();
													pushAttendance(form);
												}}
											>
												<IconWrapper name="lucide:plus" class="size-3.5" />
												{t('roster.day_sheet_add_interval')}
											</Button>
											{#if !draftAttendanceRecorded}
												<Button
													variant="outline"
													size="sm"
													type="button"
													onclick={() => {
														markAbsent();
														pushAttendance(form);
													}}
												>
													<IconWrapper name="lucide:circle-check" class="size-3.5" />
													{t('roster.day_sheet_mark_absent')}
												</Button>
											{/if}
											{#if draftAttendanceRecorded}
												<Button
													variant="ghost"
													size="sm"
													type="button"
													onclick={() => {
														clearAttendance();
														pushAttendance(form);
													}}
												>
													<IconWrapper name="lucide:eraser" class="size-3.5" />
													{t('roster.day_sheet_clear_attendance')}
												</Button>
											{/if}
										</Cluster>

										{#if draftAttendanceRecorded && draftIntervals.length > 0}
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
													oninput={(event) => {
														draftBreak = decodeNumber(event.currentTarget.value) || 0;
														pushAttendance(form);
													}}
												/>
												<span class="text-xs text-muted-foreground"
													>{t('roster.day_sheet_minutes')}</span
												>
											</Inline>
										{/if}

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
												<Button
													variant="outline"
													size="sm"
													type="button"
													onclick={() => {
														reportMissingPunch();
														pushAttendance(form);
													}}
												>
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
						SCOPED OUT — the `AMENDMENT` provenance arm for a published month (§2.4 of the proposal).
						A single-cell write in a published month is refused whole today, and that stays true:
						opening a narrow amendment path needs a new `work_days.planned_origin` enum arm and a
						migration, and the decision has not been taken. When it is, this panel is where the
						amendment is offered and `planLockedReason` is the sentence it replaces.
					-->
								</Stack>
							</Stack>
						{/snippet}
					</CollectionForm>
				</div>
			{/key}
		{/if}

		<Sheet.Footer>
			{#if mode === 'controller' && hasExplicitEntry && planWritable}
				<!--
 					Clearing the plan clears the PLAN, and never the row: the write nulls the plan
 					columns and leaves any attendance on the row exactly where it was. A zero-input
 					gesture, so it stays an inline command arrow rather than a second form — the
 					pattern baseline resumes for that day, which is what clearing an override means.
 				-->
				<Button
					variant="outline"
					type="button"
					onclick={() => {
						const workDayId = day?.workDayId;
						if (workDayId == null) return;
						Effect.runFork(
							submitCollectionMutation(() =>
								client.db.work_days.mutate([
									{
										id: workDayId,
										shift_definition_id: null,
										assignment_code: null,
										planned_note: null,
										planned_origin: null
									}
								])
							).pipe(
								Effect.tap((submission) =>
									Effect.sync(() => {
										if (submission.kind === 'pendingApproval') {
											toast.success(t('roster.day_sheet_pending_approval'));
											return;
										}
										open = false;
									})
								),
								Effect.catch((cause) =>
									Effect.sync(() => {
										const message = t('roster.day_sheet_error_context', {
											person: person?.name ?? '—',
											date: date ?? '—',
											message: getErrorMessage(cause)
										});
										toast.error(t('roster.day_sheet_save_failed'), { description: message });
									})
								)
							)
						);
					}}
				>
					{t('roster.clear_assignment')}
				</Button>
			{/if}
			<Sheet.Close>{t('roster.cancel')}</Sheet.Close>
			<!--
 				The framework footer above carries the native submit, labelled for what THIS mode's
 				save actually writes. An employee's `work_days` grant is masked to the clock fields
 				and they never see the picker, so "Save assignment" described, to the one reader who
 				cannot do it, the half of the sheet they are not looking at — while the half they
 				are looking at is a punch.
 			-->
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
