import { Schema } from 'effect';
import { decodeNumber } from '@norbital-ai/std/json';
import { expressionEngine, evaluateBoolean, evaluateNumber } from '../expressions/evaluate.js';

/** The CEL break rule one settings version carries (RFC 0001 §5). */
const workBreakLikeSchema = Schema.Struct({
	when: Schema.String,
	owed_minutes: Schema.Union([Schema.Number, Schema.String]),
	counts_as_worked_time: Schema.NullOr(Schema.Boolean)
});
export type BreakRuleLike = Schema.Schema.Type<typeof workBreakLikeSchema>;

/** The rule that governed one day, with its obligation evaluated. */
type SelectedBreakRule = {
	readonly when: string;
	readonly minimum_minutes: number | null;
	readonly counts_as_worked_time: boolean | null;
};

/**
 * Whether a working day satisfied the rest break its jurisdiction owes, derived from the punches.
 *
 * The premise this module deliberately does **not** encode is "if someone works N hours of overtime
 * they must take a break". Every statute transcribed in `work_rules.breaks` is a
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
	/** The version's CEL obligations, absent on every lineage that declares none. */
	breaks: Schema.optional(Schema.NullOr(Schema.Array(workBreakLikeSchema))),
	/**
	 * Whether this day's work is of the kind that "must be carried on continuously and which
	 * requires [the employee's] continual attendance" — EA 1955 s.60A(1) proviso (ii), EA 1968
	 * s.38(1)(c). It is a fact about the work, which the model does not yet carry a column for, so
	 * it is passed in and defaults to false: claiming the proviso is claiming an exception, and an
	 * exception nobody asserted is not available.
	 */
	continuousAttendance: Schema.optional(Schema.Boolean),
	/** The day's derived overtime hours, which a rule's obligation may read. */
	overtimeHours: Schema.optional(Schema.NullOr(Schema.Number))
});
type RestBreakInput = Schema.Schema.Type<typeof restBreakInputSchema>;

const restBreakAssessmentSchema = Schema.Struct({
	/** The rule that governs this day, or null when the jurisdiction declares none. */
	rule: Schema.NullOr(
		Schema.Struct({
			when: Schema.String,
			minimum_minutes: Schema.NullOr(Schema.Number),
			counts_as_worked_time: Schema.NullOr(Schema.Boolean)
		})
	),
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
	}
): SelectedBreakRule | null {
	for (const rule of breaks ?? []) {
		const matches = evaluateBoolean(expressionEngine, rule.when, {
			consecutive_hours: facts.consecutiveHours,
			overtime_hours: facts.overtimeHours,
			continuous_attendance: facts.continuousAttendance
		});
		if (!matches) continue;
		const owed =
			typeof rule.owed_minutes === 'number'
				? rule.owed_minutes
				: evaluateNumber(expressionEngine, rule.owed_minutes, {
						consecutive_hours: facts.consecutiveHours,
						overtime_hours: facts.overtimeHours,
						continuous_attendance: facts.continuousAttendance
					});
		return {
			when: rule.when,
			minimum_minutes: Number.isFinite(owed) ? owed : null,
			counts_as_worked_time: rule.counts_as_worked_time
		};
	}
	return null;
}

/**
 * The break obligation's assessment for one day, from the version's CEL rules.
 *
 * The longest unbroken stretch is measured first — every positive gap interrupts it — and is the
 * `consecutive_hours` fact a rule's `when` reads. The selected rule then supplies the qualifying
 * threshold: a gap at or above its minimum is the period of leisure that actually breaks the run.
 */
export function restBreakAssessment(input: RestBreakInput): RestBreakAssessment {
	const { spans, open } = spansOf(input.intervals);
	const longestRun = (gaps: readonly number[]): number => {
		let longest = 0;
		let runStart = spans[0]?.start ?? 0;
		let runEnd = spans[0]?.end ?? runStart;
		for (const span of spans.slice(1)) {
			const gap = (span.start - runEnd) / MINUTE_MS;
			if (gap > 0) {
				longest = Math.max(longest, (runEnd - runStart) / MINUTE_MS);
				runStart = span.start;
			}
			runEnd = span.end;
		}
		return spans.length === 0 ? 0 : Math.max(longest, (runEnd - runStart) / MINUTE_MS);
	};
	const longestRunMinutes = longestRun([]);
	const rule = selectBreakRule(input.breaks, {
		consecutiveHours: Math.round((longestRunMinutes / 60) * 10_000) / 10_000,
		overtimeHours: input.overtimeHours ?? 0,
		continuousAttendance: input.continuousAttendance ?? false
	});
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
