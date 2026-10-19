import { termInForceOn, termsFromFacts } from '../../payroll_engine/contract_terms.js';
import {
	plannedShift,
	plannedShiftId,
	type PlannedShift
} from '../../payroll_engine/shift_pattern.js';
import * as Predicate from 'effect/Predicate';

/**
 * A day's planned shift as the board reads it: the rostered definition, else the one the cycle of the pattern the
 * person's terms in force name plans (anchored at its effective start, inside its range), else null. An unknown
 * definition is named by its id and plans no hours.
 */
export const plannedShiftOf = (input: {
	readonly contracts: readonly { readonly id: string; readonly facts?: unknown }[];
	readonly definitions: readonly {
		readonly id: string;
		readonly code?: string | null;
		readonly variant?: unknown;
	}[];
	readonly patterns: readonly {
		readonly id: string;
		readonly pattern?: unknown;
		readonly effective_range?: { readonly from: unknown; readonly to?: unknown } | null;
	}[];
}) => {
	const shifts = new Map(input.definitions.map((row) => [String(row.id), plannedShift(row)]));
	const terms = new Map(input.contracts.map((row) => [String(row.id), termsFromFacts(row.facts)]));
	const patterns = new Map(input.patterns.map((row) => [String(row.id), row]));
	return (employmentId: string, date: string, rostered: string | null): PlannedShift | null => {
		const patternId = termInForceOn(terms.get(employmentId) ?? [], date)?.shift_pattern_id;
		const pattern = Predicate.isString(patternId) ? patterns.get(patternId) : undefined;
		const range = pattern?.effective_range;
		const from = range?.from == null ? null : String(range.from).slice(0, 10);
		const inRange =
			from != null && from <= date && (range?.to == null || date <= String(range.to).slice(0, 10));
		const id = plannedShiftId({
			date,
			rostered,
			pattern: pattern == null || !inRange ? null : { pattern: pattern.pattern, anchor: from }
		});
		return id == null ? null : (shifts.get(id) ?? plannedShift({ code: id }));
	};
};
