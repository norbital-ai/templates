/**
 * The day sheet's overtime headroom, read the way the `work_days` transform judges a write: over the
 * employment's assessment window (`assessmentWindow`), every other stored day at its stored approved
 * hours and this day at its draft plan, each date resolved to its explicit roster code or the
 * pattern's (`overtimeHeadroom`).
 *
 * The sheet never splits: the operator keys approved overtime up to this maximum and any incentive
 * hours by hand, and the transform refuses an approved figure above it.
 */

import { addDays } from '../../../collections/payroll_runs/lib/dates.js';
import {
	overtimeHeadroom,
	plannedDay,
	type OvertimeMaximum,
	type RosterCodeFacts
} from '../../scheduling/work-limits.js';

/** One stored day of the window, as the headroom reads it. */
type WindowDay = {
	readonly date: string;
	readonly shift_definition_id: string | null;
	readonly approved: number;
	readonly emergency: boolean;
};

type HeadroomOptions = Parameters<typeof overtimeHeadroom>[0];

/** The most approved overtime the day can hold, and the limit that binds; null is unbounded. */
export function windowOvertime(options: {
	readonly window: { readonly start: string; readonly end: string };
	readonly date: string;
	readonly draft: { readonly codeId: string | null; readonly emergency: boolean };
	readonly stored: readonly WindowDay[];
	/** The roster code the pattern projects on a date with no explicit one. */
	readonly projected: (date: string) => string | null;
	readonly codeById: ReadonlyMap<string, RosterCodeFacts>;
	/** The dates the person observes a company holiday on (`observedHolidayDates`). */
	readonly holidays: ReadonlySet<string>;
	readonly limits: HeadroomOptions['limits'];
	readonly cutoffDay: number;
}): OvertimeMaximum | null {
	const byDate = new Map(options.stored.map((day) => [day.date, day]));
	const days: HeadroomOptions['days'][number][] = [];
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
			// The day's own figure does not enter its maximum: every other day's does.
			approved_overtime_hours: own ? 0 : (stored?.approved ?? 0)
		});
	}
	return (
		overtimeHeadroom({ days, limits: options.limits, cutoffDay: options.cutoffDay }).maximum.get(
			options.date
		) ?? null
	);
}
