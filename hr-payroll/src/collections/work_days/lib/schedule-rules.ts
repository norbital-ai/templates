/**
 * The schedule rules a person-day write is judged by, over rows already in hand.
 *
 * Every function here is pure: the collection's transform reads the batch's rows in two waves
 * and calls these with the overlay of the write on top of what is stored.
 */
import { refuse } from '@norbital-ai/bolt/authoring';
import { coversDate } from '../../payroll_runs/lib/effective.js';
import { addDays, monthBounds } from '../../payroll_runs/lib/dates.js';
import {
	patternAnchor,
	patternRosterCodeId,
	termPatternRow,
	type ShiftPatternLike
} from '../../../lib/scheduling/work-pattern.js';
import type { WorkRestLimit } from '../../../datatypes/work_rules/+definition.js';

export type StatutoryWeeklyRestRule = WorkRestLimit;

export type PlanChange = {
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id: string | null;
};

export function assertMonthConformsToPattern(options: {
	readonly employeeNumber: string;
	readonly month: string;
	readonly plannedByDate: ReadonlyMap<string, string | null>;
	readonly terms: readonly {
		readonly shift_pattern_id: string | null;
		readonly effective_range: unknown;
	}[];
	/** The company's named patterns; a term's pointer is resolved through them. */
	readonly patternById: ReadonlyMap<string, ShiftPatternLike>;
	readonly codeKindById: ReadonlyMap<string, 'WORK' | 'REST' | 'OFF'>;
	readonly paidMinutesById: ReadonlyMap<string, number>;
}): void {
	const {
		employeeNumber,
		month,
		plannedByDate,
		terms,
		patternById,
		codeKindById,
		paidMinutesById
	} = options;
	let expectedDays = 0;
	let expectedMinutes = 0;
	let actualDays = 0;
	let actualMinutes = 0;
	let patterned = false;
	const bounds = monthBounds(month);
	let date = bounds.start;
	while (date <= bounds.end) {
		const term = terms.find((candidate) => coversDate(candidate.effective_range, date));
		const patternRow = term == null ? null : termPatternRow(term, patternById);
		if (patternRow != null && 'days' in patternRow.pattern) {
			patterned = true;
			let projectedId: string | null = null;
			try {
				projectedId = patternRosterCodeId(patternRow.pattern, date, patternAnchor(patternRow));
			} catch {
				projectedId = null;
			}
			const projectedKind = projectedId == null ? null : codeKindById.get(projectedId);
			if (projectedKind === 'WORK') {
				expectedDays += 1;
				expectedMinutes += paidMinutesById.get(projectedId!) ?? 0;
			}
			const explicitId = plannedByDate.get(date);
			// No row and a row with no plan both fall back to the pattern: only an explicit
			// assignment (including a batched one) overrides it. A cleared cell is `null`, and
			// `??` resumes the pattern for exactly that reason.
			const actualId = explicitId ?? projectedId;
			const actualKind = actualId == null ? null : codeKindById.get(actualId);
			if (actualKind === 'WORK') {
				actualDays += 1;
				actualMinutes += paidMinutesById.get(actualId!) ?? 0;
			}
		}
		date = addDays(date, 1);
	}
	if (!patterned) return;
	if (actualDays === expectedDays && actualMinutes === expectedMinutes) return;
	refuse(
		`Roster change for ${employeeNumber} in ${month} is refused: the month would assign ` +
			`${actualDays} WORK day(s) and ${actualMinutes} paid minute(s), but the work pattern ` +
			`projects ${expectedDays} WORK day(s) and ${expectedMinutes} paid minute(s). Extra work ` +
			`is not rostered — record a punch and overtime is derived; a contract change is a new ` +
			`employment-terms row.`
	);
}
/**
 * One rest day in every run: a roster may not commit a person to more consecutive worked days than
 * the jurisdiction in force allows between rest days.
 *
 * Judged over the batch's overlay, exactly as the month rule above is, so a two-cell swap that
 * *moves* the rest day rather than deleting it still passes. Only a run this write actually touches
 * is refused — `changedDates` is that intersection, and without it an import of one historical
 * month would freeze every unrelated cell around a run that was already there.
 *
 * "Worked" is the effective roster code's kind being WORK, and nothing else. A public holiday is a
 * separate entitlement rather than a rest day, and the schedule keeps the WORK shift on one while
 * relabelling the day type — the roster still commits the person, so reading holidays would only
 * make this rule more permissive than the Act. Approved leave is likewise not read: this judges the
 * roster, not attendance, and a roster committing thirteen straight WORK days is unlawful whether
 * or not leave later removes some of them.
 */
export function assertRunHasRestDay(options: {
	readonly employeeNumber: string;
	readonly rule: StatutoryWeeklyRestRule;
	/** The Work catalogue's citation, quoted in the refusal. */
	readonly authority: string | null;
	readonly window: { readonly start: string; readonly end: string };
	readonly plannedByDate: ReadonlyMap<string, string | null>;
	readonly changedDates: ReadonlySet<string>;
	readonly terms: readonly {
		readonly shift_pattern_id: string | null;
		readonly effective_range: unknown;
	}[];
	readonly patternById: ReadonlyMap<string, ShiftPatternLike>;
	readonly codeKindById: ReadonlyMap<string, 'WORK' | 'REST' | 'OFF'>;
	/** Dates under approved leave of a code in `rule.suspended_by_leave`; such a day discharges the run. */
	readonly suspendedDates?: ReadonlySet<string>;
	/** Whether `rule.average` applies to this person (its `when` judged by the caller); absent is yes. */
	readonly averaging?: boolean;
}): void {
	const {
		employeeNumber,
		rule,
		authority,
		window,
		plannedByDate,
		changedDates,
		terms,
		patternById,
		codeKindById
	} = options;
	const suspended = options.suspendedDates ?? new Set<string>();
	/** The dates the plan discharges the rule on, for the averaging arm's count. */
	const discharged: string[] = [];
	// The rule is always enforced: the weekly rest ceiling has no preference arm, so
	// a stated breach refuses the write.
	let runStart: string | null = null;
	let runEnd: string | null = null;
	let length = 0;
	let touched = false;
	const flush = (): void => {
		// The averaging arm: the span ending on the run's last day still holds the rest days the
		// month owes, so the run stands.
		const averaged =
			rule.average != null &&
			options.averaging !== false &&
			runEnd != null &&
			discharged.filter((date) => date > addDays(runEnd!, -rule.average!.days) && date <= runEnd!)
				.length >= rule.average.rest_days;
		if (touched && length > rule.max_days && !averaged)
			refuse(
				`Roster change for ${employeeNumber} is refused: ${runStart} to ${runEnd} would be ` +
					`${length} consecutive worked day(s) with no rest day inside them. This jurisdiction ` +
					`allows ${rule.max_days}${authority ? ` (${authority})` : ''}. Give the run a rest day — ` +
					`swap one of those days for a ${rule.discharged_by === 'REST' ? 'REST' : 'REST or OFF'} ` +
					`code in the same write — or move the work outside it.`
			);
		runStart = null;
		runEnd = null;
		length = 0;
		touched = false;
	};
	let date = window.start;
	while (date <= window.end) {
		const term = terms.find((candidate) => coversDate(candidate.effective_range, date));
		const patternRow = term == null ? null : termPatternRow(term, patternById);
		let projectedId: string | null = null;
		if (patternRow != null && 'days' in patternRow.pattern) {
			try {
				projectedId = patternRosterCodeId(patternRow.pattern, date, patternAnchor(patternRow));
			} catch {
				projectedId = null;
			}
		}
		// A rostered-as-assigned employment has no projection at all, which is precisely where
		// explicit rows stack thirteen days — so unlike the month rule this does not skip it.
		const effectiveId = plannedByDate.get(date) ?? projectedId;
		const kind = effectiveId == null ? null : codeKindById.get(effectiveId);
		if (kind === 'WORK' && !suspended.has(date)) {
			if (runStart == null) runStart = date;
			runEnd = date;
			length += 1;
			if (changedDates.has(date)) touched = true;
		} else if (
			kind === 'REST' ||
			(kind === 'OFF' && rule.discharged_by === 'REST_OR_OFF') ||
			suspended.has(date)
		) {
			discharged.push(date);
			flush();
		}
		// An OFF day under a REST-only rule, and a day with no code at all, are neither work nor
		// discharge: they carry the run rather than resetting it.
		date = addDays(date, 1);
	}
	flush();
}
