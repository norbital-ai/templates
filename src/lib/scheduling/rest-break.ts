import { Schema } from 'effect';
import { statutoryRestBreakRuleValueSchema } from '../../datatypes/statutory_regime/+definition.js';
import type { StatutoryRestBreakRule } from '../../datatypes/statutory_regime/+definition.js';

/**
 * Whether a working day satisfied the rest break its jurisdiction owes, derived from the punches.
 *
 * The premise this module deliberately does **not** encode is "if someone works N hours of overtime
 * they must take a break". Every statute transcribed in `statutory_regime.rest_break_rules` is a
 * **consecutive-hours** rule, and overtime is merely the usual way a person crosses the trigger on
 * the far side of a shift. A function of overtime hours would answer wrongly for a ten-hour split
 * shift with no overtime at all, and could not express the Employment Act 1955 s.60A(1) proviso (i)
 * subtlety that a break shorter than the statutory minimum does not interrupt the consecutive
 * hours. So the input is intervals and a break total, never a derived overtime figure.
 *
 * Pure, like `lock.ts` and for the identical reason: a badge on the day sheet, a roster publish
 * gate and a `work_days` write hook must quote the same number, and the only way to guarantee
 * that is for all three to call one function over inputs each of them reads for itself.
 *
 * It produces a **compliance assessment with a citation, never a priced quantity.** No caller may
 * turn `shortfallMinutes` into money. `counts_as_worked_time` is null for Malaysia because
 * s.60A(1)(a) calls the period "leisure" and is silent on payment, and pricing off a null is
 * inventing law; `docs/architecture.md` records the paid/unpaid question as unresolved from primary
 * text. Where a shortfall must reach money the honest route is an explicit, dated company policy
 * that imputes a break — never a default buried in the overtime engine, which this module does not
 * touch and does not feed.
 */

const MINUTE_MS = 60_000;

/**
 * One worked interval in the authored record shape. Workbook dates are normalized before they reach
 * this rule, so all callers supply the same ISO-string boundaries.
 */
const workedIntervalLikeSchema = Schema.Struct({
	start: Schema.String,
	end: Schema.NullOr(Schema.String)
});
type WorkedIntervalLike = Schema.Schema.Type<typeof workedIntervalLikeSchema>;

const restBreakInputSchema = Schema.Struct({
	intervals: Schema.optional(Schema.NullOr(Schema.Array(workedIntervalLikeSchema))),
	/** The flat `work_days.break_minutes` column: how long a break was, never when it was owed. */
	breakMinutes: Schema.optional(Schema.NullOr(Schema.Number)),
	/** The snapshot member, absent on every jurisdiction that declares no rule. */
	rules: Schema.optional(Schema.NullOr(Schema.Array(statutoryRestBreakRuleValueSchema))),
	/**
	 * Whether this day's work is of the kind that "must be carried on continuously and which
	 * requires [the employee's] continual attendance" — EA 1955 s.60A(1) proviso (ii), EA 1968
	 * s.38(1)(c). It is a fact about the work, which the model does not yet carry a column for, so
	 * it is passed in and defaults to false: claiming the proviso is claiming an exception, and an
	 * exception nobody asserted is not available.
	 */
	continuousAttendance: Schema.optional(Schema.Boolean)
});
type RestBreakInput = Schema.Schema.Type<typeof restBreakInputSchema>;

const restBreakAssessmentSchema = Schema.Struct({
	/** The rule that governs this day, or null when the jurisdiction declares none. */
	rule: Schema.NullOr(statutoryRestBreakRuleValueSchema),
	/**
	 * An interval has no end. The day is still being worked, so the figures below describe only what
	 * has happened so far and `shortfallMinutes` is withheld — a person mid-shift is not short of a
	 * break they may still be about to take.
	 */
	open: Schema.Boolean,
	/** Whether the rule's trigger was crossed. A rule with no trigger is owed on any worked day. */
	triggered: Schema.Boolean,
	/** The longest stretch of work no qualifying period of leisure interrupted. */
	longestRunHours: Schema.Number,
	/**
	 * What the rule requires: its minimum when triggered, 0 when it is not, and **null when the
	 * statute states a trigger but no duration** (Singapore EA 1968 s.38(1)(a)). Null is not zero:
	 * zero would claim the Act demands nothing, which is the opposite of what it says.
	 */
	requiredMinutes: Schema.NullOr(Schema.Number),
	/** Break actually recorded: the qualifying gaps, topped up to the flat column where it is larger. */
	takenMinutes: Schema.Number,
	/** `required − taken`, floored at zero; null wherever the question cannot be answered. */
	shortfallMinutes: Schema.NullOr(Schema.Number)
});
export type RestBreakAssessment = Schema.Schema.Type<typeof restBreakAssessmentSchema>;

const spanSchema = Schema.Struct({ start: Schema.Number, end: Schema.Number });
type Span = Schema.Schema.Type<typeof spanSchema>;

function instant(value: string): number {
	return Date.parse(value);
}

/**
 * The worked intervals as a sorted, unioned set of instants, plus whether any is still open.
 *
 * Overlap is rejected by the write hook, but unioning here keeps an imported duplicate from
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
 * Which arm of the statute governs this day.
 *
 * The continual-attendance arm is an **exception that replaces** the general one, not an extra
 * requirement stacked on it: s.60A(1) proviso (ii) says such an employee "may be required to work
 * eight consecutive hours inclusive of" the aggregate meal periods — a permission that would be
 * meaningless if the five-hour rule in s.60A(1)(a) still bound the same day. So it is selected in
 * place of `ALWAYS`, and only when the caller asserts the work is of that kind.
 *
 * A jurisdiction that grants no such exception (the Philippines, Indonesia) falls back to its
 * general rule even when the caller asserts continual attendance. An exception has to be granted by
 * the statute being applied; it is not a property of the work that travels between legal systems.
 *
 * Exported because a screen naming the arm should not have to run the whole assessment to get it.
 */
export function selectRestBreakRule(
	rules: readonly StatutoryRestBreakRule[] | null | undefined,
	continuousAttendance: boolean | undefined
): StatutoryRestBreakRule | null {
	const declared = rules ?? [];
	if (continuousAttendance === true) {
		const exception = declared.find((rule) => rule.applies_when === 'CONTINUOUS_ATTENDANCE');
		if (exception != null) return exception;
	}
	// First match, not "the strictest": two rules sharing an arm is a defect `statutoryRegimeIssues`
	// already refuses at the write boundary, and picking a winner here would hide it from the person
	// who can fix it.
	return declared.find((rule) => rule.applies_when === 'ALWAYS') ?? null;
}

/**
 * Assess one day against its jurisdiction's rest break rule.
 *
 * The four steps, and the text behind each:
 *
 *   1. A gap between worked intervals that is at least the rule's minimum is a period of leisure in
 *      its own right — the punches already prove it was taken, whatever the flat column says.
 *   2. A gap shorter than the minimum does **not** interrupt continuity. EA 1955 s.60A(1) proviso
 *      (i): "a break of less than thirty minutes shall not be deemed to interrupt [the] continuous
 *      hours". The stretch either side of it is therefore one run, and the run is measured as
 *      elapsed wall-clock time from its first punch to its last — the pause is inside the
 *      consecutive hours, which is exactly what the proviso is for.
 *   3. The flat `break_minutes` column tops the observed gaps up. A break that was taken but never
 *      punched exists only in that column, and a day recorded as one interval with 60 break minutes
 *      is a real and common shape; taking the larger of the two never invents break that was not
 *      recorded somewhere.
 *   4. The longest run is compared with `after_consecutive_hours` to decide whether anything is
 *      owed at all.
 *
 * Two arms differ in step 1, because the statutes differ:
 *
 *   - `ALWAYS` counts only gaps of at least the minimum, because proviso (i) says a shorter one is
 *     not a period of leisure. Three ten-minute pauses do not add up to a thirty-minute break.
 *   - `CONTINUOUS_ATTENDANCE` counts every gap, because proviso (ii) requires "a period or periods
 *     of not less than forty-five minutes **in the aggregate**" — that arm says outright that the
 *     periods add up. EA 1968 s.38(1)(c) uses the same words.
 *
 * A note on the comparison, recorded rather than smoothed over. The trigger is tested strictly:
 * more than `after_consecutive_hours`, not at least. Three of the four transcribed statutes say
 * "more than" — EA 1955 s.60A(1)(a), EA 1968 s.38(1)(a), and proviso (ii)'s eight hours are a
 * permission, so only a longer stretch breaches it. Indonesia's ps.79(2)(a) says "setelah bekerja
 * selama 4 jam terus menerus", after four consecutive hours, which at exactly four hours is
 * arguably already owed. The strict test under-reports that single boundary instant; the inclusive
 * test would over-report a Malaysian day of exactly five hours, warning about something s.60A(1)(a)
 * expressly permits, and manufacturing a warning the statute does not support is the worse error.
 * Drawing the distinction properly needs a `trigger_is_inclusive` field on the rule — the same
 * device `overtime_coverage.ceiling_is_inclusive` already uses for "exceeds" versus "not less than"
 * — and it is not in the transcribed shape, so it is named here instead of guessed at.
 */
export function restBreakAssessment(input: RestBreakInput): RestBreakAssessment {
	const rule = selectRestBreakRule(input.rules, input.continuousAttendance);
	const { spans, open } = spansOf(input.intervals);

	/**
	 * A gap this long is a period of leisure, so the stretch before it has ended. With no minimum
	 * stated — Singapore — any gap at all qualifies: the Act requires "a period of leisure" and
	 * prescribes no length, so the shortest observed pause is one.
	 */
	const threshold = rule?.minimum_minutes ?? 0;
	const interrupts = (gap: number): boolean => gap > 0 && gap >= threshold;
	const aggregates = rule?.applies_when === 'CONTINUOUS_ATTENDANCE';

	let longestRunMinutes = 0;
	let observedBreakMinutes = 0;
	if (spans.length > 0) {
		let runStart = spans[0]!.start;
		let runEnd = spans[0]!.end;
		for (let index = 1; index < spans.length; index += 1) {
			const span = spans[index]!;
			const gap = (span.start - runEnd) / MINUTE_MS;
			if (aggregates ? gap > 0 : interrupts(gap)) observedBreakMinutes += gap;
			if (interrupts(gap)) {
				longestRunMinutes = Math.max(longestRunMinutes, (runEnd - runStart) / MINUTE_MS);
				runStart = span.start;
			}
			runEnd = span.end;
		}
		longestRunMinutes = Math.max(longestRunMinutes, (runEnd - runStart) / MINUTE_MS);
	}

	const recorded = Number(input.breakMinutes ?? 0);
	const takenMinutes = Math.round(
		Math.max(observedBreakMinutes, Number.isFinite(recorded) ? Math.max(0, recorded) : 0)
	);

	const triggered =
		rule != null &&
		spans.length > 0 &&
		(rule.after_consecutive_hours === null ||
			longestRunMinutes > rule.after_consecutive_hours * 60);

	// A rule with no stated minimum can never quantify what is owed, so it never quantifies what is
	// missing either. Null, not zero — see `requiredMinutes`.
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

/** Whether the day fell short of a break it was owed. */
export function restBreakShort(assessment: RestBreakAssessment): boolean {
	return (assessment.shortfallMinutes ?? 0) > 0;
}

/**
 * Whether this shortfall must refuse the write rather than warn about it.
 *
 * `on_exceed` is read from the rule, so the answer is effective-dated with the statute and a
 * jurisdiction can be tightened without touching a hook. A day whose shortfall cannot be quantified
 * never blocks: refusing a write on a figure the statute declines to state would be enforcement
 * invented by this codebase.
 */
export function restBreakBlocksWrite(assessment: RestBreakAssessment): boolean {
	return assessment.rule?.on_exceed === 'BLOCK' && restBreakShort(assessment);
}

function hoursText(hours: number): string {
	return String(Number(hours.toFixed(2)));
}

/**
 * The one sentence every consumer quotes, or null when the day has nothing to say.
 *
 * It is returned for two situations and no others: a quantified shortfall, and a trigger crossed
 * under a statute that states no duration. The second is not a warning that something is wrong —
 * it is the module refusing to imply that nothing is owed merely because it cannot say how much,
 * which is the whole reason `requiredMinutes` is nullable.
 *
 * The citation is always appended, because a sentence that says a break is short without saying
 * which law says so sends the reader to look for a setting.
 */
export function restBreakMessage(assessment: RestBreakAssessment, subject: string): string | null {
	const rule = assessment.rule;
	if (rule == null || !assessment.triggered) return null;
	if (restBreakShort(assessment))
		return (
			`${subject}: ${hoursText(assessment.longestRunHours)} consecutive hours worked with ` +
			`${assessment.takenMinutes} minutes of break, but ${assessment.requiredMinutes} are ` +
			`required — ${assessment.shortfallMinutes} minutes short. ${rule.authority}`
		);
	if (assessment.requiredMinutes === null)
		return (
			`${subject}: ${hoursText(assessment.longestRunHours)} consecutive hours worked, which ` +
			'requires a period of leisure the statute does not put a length on. ' +
			`Recorded break: ${assessment.takenMinutes} minutes. ${rule.authority}`
		);
	return null;
}
