import { Schema } from 'effect';
import type { WorkPattern } from '../../datatypes/work_pattern/+definition.js';
import { dateKey } from '../iso-day.js';
import { readRange } from '../../collections/payroll_runs/lib/effective.js';
import { rosterCodeKind, workWindow, type RosterCodeLike } from './roster-code.js';

const DAY_MS = 86_400_000;

/** A `shift_patterns` row as the pattern readers need it. */
export type ShiftPatternLike = {
	readonly id: string;
	readonly code: string;
	readonly pattern: WorkPattern;
	/** The stored effective range; the cycle counts from its start. Missing only in code fixtures. */
	readonly effective_range?: unknown;
};

/**
 * Employment terms as every pattern reader sees them: the pointer, and the row when it rode the
 * read (`with: { term_shift_pattern }`). A reader that loaded the company's patterns separately
 * hands them in as `patternById` instead; the row wins when both are present.
 */
type TermPatternLike = {
	readonly shift_pattern_id: string | null;
	readonly term_shift_pattern?: ShiftPatternLike | null;
};

/**
 * The named pattern behind one terms row, or null when the terms name none.
 *
 * Every schedule question goes through here rather than through a `work_pattern` column: the
 * board, the employee's calendar, the write hooks, the leave preview, the payroll engine and its
 * export all resolve the same pointer the same way, so a term cannot project one base on the
 * board and another in a payslip.
 */
export function termPatternRow(
	term: TermPatternLike,
	patternById?: ReadonlyMap<string, ShiftPatternLike>
): ShiftPatternLike | null {
	if (term.shift_pattern_id == null) return null;
	const carried = term.term_shift_pattern;
	if (carried != null && carried.id === term.shift_pattern_id) return carried;
	const looked = patternById?.get(term.shift_pattern_id);
	if (looked != null) return looked;
	if (carried != null) return carried;
	throw new Error(
		`Employment terms name shift pattern ${term.shift_pattern_id}, which was not loaded.`
	);
}

/** The pattern value one terms row projects from, or null when the terms name no pattern. */
export function termPattern(
	term: TermPatternLike,
	patternById?: ReadonlyMap<string, ShiftPatternLike>
): WorkPattern | null {
	return termPatternRow(term, patternById)?.pattern ?? null;
}

/**
 * The day a pattern's cycle counts from: the effective start of the `shift_patterns` row. Terms
 * name the pattern and the pattern row states its own beginning, so the anchor is never an operator
 * decision and no value carries a second date.
 */
export function patternAnchor(
	row: { readonly effective_range?: unknown } | null | undefined
): string | null {
	if (row == null) return null;
	const range = readRange(row.effective_range);
	return range == null ? null : dateKey(range.start);
}

/** Every roster code a pattern's cycle names; empty for an expectation. */
export function patternRosterCodeIds(pattern: WorkPattern | null): string[] {
	if (pattern == null || !('days' in pattern)) return [];
	return [...new Set(pattern.days.map((day) => day.roster_code_id))];
}

function dateNumber(date: string): number {
	const value = Date.parse(`${date}T00:00:00.000Z`);
	if (Number.isNaN(value)) throw new Error(`Invalid calendar date "${date}".`);
	return Math.floor(value / DAY_MS);
}

/**
 * The roster code one day projects, or null when the pattern generates nothing for that day. The
 * cycle's first day is `anchor`, the pattern row's effective start, and it repeats forever.
 */
export function patternRosterCodeId(
	pattern: WorkPattern | null,
	date: string,
	anchor: string | null
): string | null {
	if (pattern == null || !('days' in pattern) || anchor == null) return null;
	const offset = dateNumber(date) - dateNumber(anchor);
	const index = ((offset % pattern.days.length) + pattern.days.length) % pattern.days.length;
	return pattern.days[index]!.roster_code_id;
}

const patternWorkloadSchema = Schema.Struct({
	work_days: Schema.Number,
	paid_minutes: Schema.Number,
	reference_days: Schema.Number,
	average_weekly_paid_minutes: Schema.Number
});
export type PatternWorkload = Schema.Schema.Type<typeof patternWorkloadSchema>;

/**
 * Derive the amount promised by a pattern: the expectation's own statement where there is no
 * cycle, else the day cycle's real total over one full turn of the cycle.
 */
export function patternWorkload(
	pattern: WorkPattern | null,
	rosterCodeById: ReadonlyMap<string, RosterCodeLike>
): PatternWorkload | null {
	if (pattern == null) return null;
	if ('expectation' in pattern) {
		if (pattern.expectation.kind === 'AS_ASSIGNED') return null;
		const referenceDays = pattern.expectation.period === 'WEEK' ? 7 : 30;
		return {
			work_days: pattern.expectation.required_work_days,
			paid_minutes: pattern.expectation.required_paid_minutes,
			reference_days: referenceDays,
			average_weekly_paid_minutes: (pattern.expectation.required_paid_minutes * 7) / referenceDays
		};
	}

	const referenceDays = pattern.days.length;
	// One pass over each roster code: the paid minutes are the only fact the workload needs.
	const paidMinutesByCode = new Map<string, number | null>();
	const paidMinutesOf = (id: string): number | null => {
		const known = paidMinutesByCode.get(id);
		if (known !== undefined) return known;
		const code = rosterCodeById.get(id);
		if (code == null) throw new Error(`Work pattern names missing roster code ${id}.`);
		const paid =
			rosterCodeKind(code.variant) === 'WORK' ? workWindow(code.variant)!.paid_minutes : null;
		paidMinutesByCode.set(id, paid);
		return paid;
	};

	let workDays = 0;
	let paidMinutes = 0;
	for (const day of pattern.days) {
		const paid = paidMinutesOf(day.roster_code_id);
		if (paid == null) continue;
		workDays += 1;
		paidMinutes += paid;
	}
	return {
		work_days: workDays,
		paid_minutes: paidMinutes,
		reference_days: referenceDays,
		average_weekly_paid_minutes: (paidMinutes * 7) / referenceDays
	};
}
