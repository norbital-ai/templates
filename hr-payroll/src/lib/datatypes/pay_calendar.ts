/**
 * The pay calendar of a settings version (`payroll.pay_calendar`): when wages of each cadence fall
 * due, as a stored `YYYY-MM-DD` expression over the obligation site (`period.*`, `run.*`,
 * `company.*`). A run whose operator states no pay due date takes it from here; lateness is not
 * judged here but by the wage-due duty type (L1), whose `due` reads `run.pay_due_date`.
 */

import { evaluateDate, expressionEngine } from '../expressions/evaluate.js';
import { obligationContext } from '../obligations/materialise.js';

export type PayCalendarEntry = {
	/** A pay frequency (`MONTHLY`, `SEMI_MONTHLY`, `WEEKLY`, …): the cadence this entry dates. */
	readonly cadence: string;
	/** The wage due date: `add_days(period.end, 7)`. */
	readonly due: string;
	readonly authority: string;
};

export type PayCalendar = readonly PayCalendarEntry[];

/** Why a stored pay calendar is malformed, or undefined. One entry per cadence. */
export function payCalendarFault(calendar: PayCalendar | null | undefined): string | undefined {
	const seen = new Set<string>();
	for (const entry of calendar ?? []) {
		if (entry.cadence === '' || entry.due.trim() === '' || entry.authority === '')
			return 'pay_calendar: an entry states its cadence, due expression and authority';
		if (seen.has(entry.cadence)) return `pay_calendar: ${entry.cadence} is dated twice`;
		seen.add(entry.cadence);
	}
	return undefined;
}

/** The pay calendar a stored payroll block declares; `[]` where it declares none. */
export const payCalendarOf = (payroll: object): PayCalendar => {
	const value = 'pay_calendar' in payroll ? payroll.pay_calendar : null;
	return (Array.isArray(value) ? value : []) as PayCalendar;
};

/** The wage due date the calendar gives a run, or undefined when it dates no such cadence. */
export function calendarDueDate(options: {
	readonly calendar: PayCalendar;
	readonly cadence: string;
	readonly period: { readonly start: string; readonly end: string };
	readonly run: { readonly period: string; readonly pay_date: string };
	readonly company: {
		readonly settings_code: string;
		readonly pay_frequency: string;
	};
}): string | undefined {
	const entry = options.calendar.find((row) => row.cadence === options.cadence);
	if (entry == null) return undefined;
	return evaluateDate(
		expressionEngine,
		entry.due,
		obligationContext({ period: options.period, run: options.run, company: options.company })
	);
}
