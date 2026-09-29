import type { PersonContext } from '../../lib/payroll/run/eligibility.js';
import { decodeNumber } from '../wire.js';
import { expressionEngine, evaluateBoolean, evaluateNumber } from '../expressions/evaluate.js';

/** The CEL break rule one settings version carries. */
export type BreakRuleLike = {
	readonly when: string;
	readonly owed_minutes: string;
	readonly counts_as_worked_time?: boolean | null | undefined;
};

/** The rule that governed one day, with its obligation evaluated. */
type SelectedBreakRule = {
	readonly when: string;
	readonly minimum_minutes: number | null;
	readonly counts_as_worked_time: boolean | null;
};

/**
 * Whether a working day satisfied its jurisdiction's rest break, from the punches: every statute in
 * `work_rules.breaks` is a consecutive-hours rule, so the input is timed intervals,
 * never overtime (a break shorter than the minimum does not interrupt the hours: EA 1955
 * s.60A(1)(i)). Pure, so the day sheet, the roster gate and the transform quote one number.
 *
 * A compliance assessment, never money: MY s.60A(1)(a) is silent on paying the break
 * (`counts_as_worked_time` null), so no caller prices `shortfallMinutes`.
 */

const MINUTE_MS = 60_000;

/**
 * One worked interval in the authored record shape. Workbook dates are normalized before they reach
 * this rule, so all callers supply the same ISO-string boundaries.
 */
type WorkedIntervalLike = {
	readonly start: string;
	readonly end: string | null;
};

type RestBreakInput = {
	readonly intervals?: ReadonlyArray<WorkedIntervalLike> | null | undefined;
	/** Informational gap total; only the timed intervals prove a qualifying break. */
	readonly breakMinutes?: number | null | undefined;
	/** The version's CEL obligations, absent on every lineage that declares none. */
	readonly breaks?: ReadonlyArray<BreakRuleLike> | null | undefined;
	/**
	 * Whether this day's work is of the kind that "must be carried on continuously and which
	 * requires [the employee's] continual attendance" — EA 1955 s.60A(1) proviso (ii), EA 1968
	 * s.38(1)(c). It is a fact about the work, which the model does not yet carry a column for, so
	 * it is passed in and defaults to false: claiming the proviso is claiming an exception, and an
	 * exception nobody asserted is not available.
	 */
	readonly continuousAttendance?: boolean | undefined;
	/** Hours inside the night window, for a rule that owes a longer break at night (VN art.109(1)). */
	readonly nightHours?: number | undefined;
	/** The person, for a rule that turns on an entity fact (TW §35 proviso); absent reads no facts. */
	readonly person?: PersonContext | null | undefined;
	/** The day's derived overtime hours, which a rule's obligation may read. */
	readonly overtimeHours?: number | null | undefined;
};

export type RestBreakAssessment = {
	/** The rule that governs this day, or null when the jurisdiction declares none. */
	readonly rule: {
		readonly when: string;
		readonly minimum_minutes: number | null;
		readonly counts_as_worked_time: boolean | null;
	} | null;
	/**
	 * An interval has no end. The day is still being worked, so the figures below describe only what
	 * has happened so far and `shortfallMinutes` is withheld — a person mid-shift is not short of a
	 * break they may still be about to take.
	 */
	readonly open: boolean;
	/** Whether the rule's trigger was crossed. A rule with no trigger is owed on any worked day. */
	readonly triggered: boolean;
	/** The longest stretch of work no qualifying period of leisure interrupted. */
	readonly longestRunHours: number;
	/**
	 * What the rule requires: its minimum when triggered, 0 when it is not, and **null when the
	 * statute states a trigger but no duration** (Singapore EA 1968 s.38(1)(a)). Null is not zero:
	 * zero would claim the Act demands nothing, which is the opposite of what it says.
	 */
	readonly requiredMinutes: number | null;
	/** Break actually recorded: the qualifying timed gaps between worked intervals. */
	readonly takenMinutes: number;
	/** `required − taken`, floored at zero; null wherever the question cannot be answered. */
	readonly shortfallMinutes: number | null;
};

type Span = {
	readonly start: number;
	readonly end: number;
};

function instant(value: string): number {
	return Date.parse(value);
}

/**
 * The worked intervals as a sorted, unioned set of instants, plus whether any is still open.
 *
 * Overlap is rejected by the transform, but unioning here keeps an imported duplicate from
 * inventing a gap between two copies of the same minute. Intervals that cannot be read as a pair of
 * instants are dropped rather than thrown on: this function is called during a render pass, and
 * `attendance.ts` already sets the precedent that malformed attendance is reported, not fatal.
 */
function spansOf(intervals: readonly WorkedIntervalLike[] | null | undefined): {
	spans: Span[];
	open: boolean;
} {
	let open = false;
	const parsed: Span[] = [];
	for (const interval of intervals ?? []) {
		if (interval.end == null) {
			open = true;
			continue;
		}
		const start = instant(interval.start);
		const end = instant(interval.end);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
		parsed.push({ start, end });
	}
	parsed.sort((left, right) => left.start - right.start || left.end - right.end);
	const spans: Span[] = [];
	for (const span of parsed) {
		const previous = spans.at(-1);
		if (previous == null || span.start > previous.end) spans.push({ ...span });
		else spans.splice(-1, 1, { start: previous.start, end: Math.max(previous.end, span.end) });
	}
	return { spans, open };
}

/**
 * The obligation governing this day, or null where the version declares none.
 *
 * Each rule's `when` is evaluated against what the day's punches measured — the longest
 * uninterrupted run, the day's overtime hours and the continual-attendance assertion — and the
 * first rule whose predicate holds is the one that governs. The predicate is the trigger: a
 * version that owes a break on any worked day states `true`.
 */
export function selectBreakRule(
	breaks: readonly BreakRuleLike[] | null | undefined,
	facts: {
		readonly consecutiveHours: number;
		readonly overtimeHours: number;
		readonly continuousAttendance: boolean;
		/** Hours inside the night window; 0 where none is declared or the caller has not measured it. */
		readonly nightHours?: number | undefined;
		/** The person the day belongs to, for a rule that turns on them or their entity's facts. */
		readonly person?: PersonContext | null | undefined;
	}
): SelectedBreakRule | null {
	const context = {
		...(facts.person ?? { company: { facts: {} } }),
		consecutive_hours: facts.consecutiveHours,
		overtime_hours: facts.overtimeHours,
		continuous_attendance: facts.continuousAttendance,
		night_hours: facts.nightHours ?? 0
	};
	for (const rule of breaks ?? []) {
		const matches = evaluateBoolean(expressionEngine, rule.when, context);
		if (!matches) continue;
		const owed = evaluateNumber(expressionEngine, rule.owed_minutes, context);
		return {
			when: rule.when,
			minimum_minutes: Number.isFinite(owed) ? owed : null,
			counts_as_worked_time: rule.counts_as_worked_time ?? null
		};
	}
	return null;
}

/**
 * The break obligation's assessment for one day, from the version's CEL rules.
 *
 * Each candidate's minimum is evaluated first. Only gaps at or above that minimum interrupt the
 * `consecutive_hours` run used by its trigger; shorter pauses leave the run continuous.
 */
export function restBreakAssessment(input: RestBreakInput): RestBreakAssessment {
	const { spans, open } = spansOf(input.intervals);
	const longestRun = (qualifyingGapMinutes: number): number => {
		let longest = 0;
		let runMinutes = spans[0] == null ? 0 : (spans[0].end - spans[0].start) / MINUTE_MS;
		let runEnd = spans[0]?.end ?? 0;
		for (const span of spans.slice(1)) {
			const gap = (span.start - runEnd) / MINUTE_MS;
			if (gap > 0 && gap >= qualifyingGapMinutes) {
				longest = Math.max(longest, runMinutes);
				runMinutes = 0;
			}
			runMinutes += (span.end - span.start) / MINUTE_MS;
			runEnd = span.end;
		}
		return Math.max(longest, runMinutes);
	};
	const facts = (minutes: number) => ({
		consecutiveHours: Math.round((minutes / 60) * 10_000) / 10_000,
		overtimeHours: input.overtimeHours ?? 0,
		continuousAttendance: input.continuousAttendance ?? false,
		nightHours: input.nightHours ?? 0,
		person: input.person ?? null
	});
	let longestRunMinutes = longestRun(0);
	let rule: SelectedBreakRule | null = null;
	for (const candidate of input.breaks ?? []) {
		const candidateMinimum = selectBreakRule(
			[{ ...candidate, when: 'true' }],
			facts(longestRun(Number.POSITIVE_INFINITY))
		)?.minimum_minutes;
		const measured = longestRun(candidateMinimum == null ? 0 : Math.max(0, candidateMinimum));
		const selected = selectBreakRule([candidate], facts(measured));
		if (selected == null) continue;
		rule = selected;
		longestRunMinutes = measured;
		break;
	}
	const threshold = rule?.minimum_minutes ?? 0;
	let observedBreakMinutes = 0;
	if (spans.length > 1) {
		let runEnd = spans[0]!.end;
		for (const span of spans.slice(1)) {
			const gap = (span.start - runEnd) / MINUTE_MS;
			if (gap > 0 && gap >= threshold) observedBreakMinutes += gap;
			runEnd = span.end;
		}
	}
	const recorded = input.breakMinutes ?? 0;
	// A time entry is a span: the break a day provides is what the shift grants or the statute owes,
	// whichever is larger, so it is taken unless the day shows a longer gap already.
	const takenMinutes = Math.round(
		Math.max(observedBreakMinutes, Number.isFinite(recorded) ? Math.max(0, recorded) : 0)
	);
	const triggered = rule != null && spans.length > 0;
	const requiredMinutes =
		rule == null || rule.minimum_minutes === null ? null : triggered ? rule.minimum_minutes : 0;
	return {
		rule,
		open,
		triggered,
		longestRunHours: Math.round((longestRunMinutes / 60) * 10_000) / 10_000,
		requiredMinutes,
		takenMinutes,
		shortfallMinutes:
			requiredMinutes === null || open ? null : Math.max(0, requiredMinutes - takenMinutes)
	};
}

/**
 * The break a day took, derived: the shift (or the statute) provides a break, and whatever of it is
 * already visible as a gap between the day's punches is not deducted twice. One interval takes the
 * whole provided break off; two intervals an hour apart on a shift granting an hour take nothing
 * further off. A day with no shift, or no punches, has no break to derive.
 *
 * A time entry carries a start and an end and nothing else, so the break a normal day provides is
 * deducted from the span: the predefined break is part of the work pattern, and where the statute's
 * mandatory minimum is longer, that minimum governs.
 */
export function grantedBreakMinutes(
	intervals: readonly WorkedIntervalLike[] | null | undefined,
	grantedMinutes: number | null | undefined
): number {
	if (intervals == null || intervals.length === 0) return 0;
	// A day still being worked has no completed span to take a break off.
	if (intervals.some((interval) => interval.end == null)) return 0;
	const closed = intervals
		.flatMap((interval) => {
			const start = Date.parse(interval.start);
			const end = interval.end == null ? Number.NaN : Date.parse(interval.end);
			return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
		})
		.toSorted((left, right) => left.start - right.start);
	let gapMinutes = 0;
	for (let index = 1; index < closed.length; index += 1)
		gapMinutes += Math.max(0, closed[index]!.start - closed[index - 1]!.end) / 60_000;
	return Math.max(0, Math.round(Math.max(0, grantedMinutes ?? 0) - gapMinutes));
}

/**
 * The break a punched day provides: the larger of the shift's granted minutes and the version's
 * statutory mandatory minimum, less any gap the day already shows.
 *
 * A time entry carries a start and an end, so the break a normal day provides is read from the work
 * pattern; where the statute owes a longer mandatory rest break, that minimum governs instead. A
 * rule whose break counts as worked time (`counts_as_worked_time: true`) adds nothing to deduct.
 */
export function providedBreakMinutes(input: {
	readonly intervals: readonly WorkedIntervalLike[] | null | undefined;
	readonly shiftMinutes: number | null | undefined;
	readonly breaks?: readonly BreakRuleLike[] | null | undefined;
	readonly person?: PersonContext | null | undefined;
	/** Hours inside the regime's night window, for a rule that owes a longer break at night (VN art.109(1)). */
	readonly nightHours?: number | null | undefined;
}): number {
	const granted = Math.max(0, input.shiftMinutes ?? 0);
	const assessment = restBreakAssessment({
		intervals: input.intervals,
		breakMinutes: granted,
		breaks: input.breaks,
		person: input.person ?? null,
		nightHours: input.nightHours ?? 0
	});
	const owed =
		assessment.rule?.counts_as_worked_time === true ? 0 : (assessment.requiredMinutes ?? 0);
	return grantedBreakMinutes(input.intervals, Math.max(granted, owed));
}

/** The name the call sites have always used for `grantedBreakMinutes`. */
export const derivedBreakMinutes = grantedBreakMinutes;
