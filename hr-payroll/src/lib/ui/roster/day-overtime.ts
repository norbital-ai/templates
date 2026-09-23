/**
 * The day sheet's overtime split, read the way the `work_days` transform splits it: over the
 * employment's assessment window (`assessmentWindow`), every stored day at its stored total and this
 * day at its draft plan and total, each date resolved to its explicit roster code or the pattern's.
 *
 * The limits split in date order, so a change to one day can move the split of a later one. The
 * transform refuses a write that moves a day it was not given; the sheet therefore restates the open
 * days this draft moves in the same write, at their unchanged totals, and the transform re-splits
 * them together. A sealed day cannot be restated: it is returned so the sheet can say so.
 */

import { addDays } from '../../../collections/payroll_runs/lib/dates.js';
import {
	plannedDay,
	splitPlannedOvertime,
	type OvertimeSplit,
	type RosterCodeFacts
} from '../../scheduling/work-limits.js';

/** One stored day of the window, as the split reads it. */
export type WindowDay = {
	readonly id: string;
	readonly date: string;
	readonly shift_definition_id: string | null;
	/** The day's stored total: approved plus incentive hours. */
	readonly total: number;
	readonly emergency: boolean;
	/** A payslip has taken the day into account. */
	readonly sealed: boolean;
};

type SplitOptions = Parameters<typeof splitPlannedOvertime>[0];

export function windowOvertime(options: {
	readonly window: { readonly start: string; readonly end: string };
	readonly date: string;
	readonly draft: {
		readonly codeId: string | null;
		readonly total: number;
		readonly emergency: boolean;
	};
	readonly stored: readonly WindowDay[];
	/** The roster code the pattern projects on a date with no explicit one. */
	readonly projected: (date: string) => string | null;
	readonly codeById: ReadonlyMap<string, RosterCodeFacts>;
	readonly holidays: ReadonlySet<string>;
	readonly limits: SplitOptions['limits'];
	readonly cutoffDay: number;
}): {
	readonly split: OvertimeSplit | undefined;
	/** Open days the draft moves: the save restates them. */
	readonly moved: readonly WindowDay[];
	/** Sealed days the draft moves: the save is refused. */
	readonly sealed: readonly WindowDay[];
} {
	const byDate = new Map(options.stored.map((day) => [day.date, day]));
	const days: (SplitOptions['days'][number] & { readonly before: number })[] = [];
	for (let date = options.window.start; date <= options.window.end; date = addDays(date, 1)) {
		const stored = byDate.get(date);
		const own = date === options.date;
		const explicit = own ? options.draft.codeId : (stored?.shift_definition_id ?? null);
		days.push({
			...plannedDay({
				date,
				rosterCodeId: explicit ?? options.projected(date),
				codeById: options.codeById
			}),
			holiday: options.holidays.has(date),
			emergency: own ? options.draft.emergency : stored?.emergency === true,
			total_overtime_hours: own ? options.draft.total : (stored?.total ?? 0),
			before: stored?.total ?? 0
		});
	}
	const splitWith = (total: (day: (typeof days)[number]) => number) =>
		splitPlannedOvertime({
			days: days.map((day) => ({ ...day, total_overtime_hours: total(day) })),
			limits: options.limits,
			cutoffDay: options.cutoffDay
		});
	const after = splitWith((day) => day.total_overtime_hours);
	const before = splitWith((day) => day.before);
	const changed = options.stored.filter((day) => {
		if (day.date === options.date) return false;
		const was = before.get(day.date);
		const is = after.get(day.date);
		return (
			was?.approved_overtime_hours !== is?.approved_overtime_hours ||
			was?.incentive_hours !== is?.incentive_hours
		);
	});
	return {
		split: after.get(options.date),
		moved: changed.filter((day) => !day.sealed),
		sealed: changed.filter((day) => day.sealed)
	};
}
