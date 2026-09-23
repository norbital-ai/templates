/**
 * Server-side helpers shared by the collection roles that speak in payroll months.
 *
 * `controller-surfaces.md` §1 tells app and representation authors to inline duplicated one-liners
 * rather than grow the import graph. It scopes that to controller UI; these are transforms and
 * `+pipelines.ts` code, where a copy that drifts changes what the server *accepts*, not how a cell
 * reads. The month arithmetic itself lives in the engine's `dates.ts`.
 */

import { daysBetween, monthBounds } from '../collections/payroll_runs/lib/dates.js';

/** `YYYY-MM` for a payroll month. */
export function isYearMonth(value: string): boolean {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Every calendar day of a `YYYY-MM` month, in order. */
export function calendarDaysInMonth(month: string): readonly string[] {
	const { start, end } = monthBounds(month);
	return daysBetween(start, end);
}

/**
 * A bulleted refusal listing, truncated so a failed import of twenty thousand rows does not answer
 * with twenty thousand lines.
 */
export function formatNamedList(items: readonly string[]): string {
	const limit = 20;
	const shown = items.slice(0, limit);
	const lines = shown.map((item) => `• ${item}`);
	const remainder = items.length > limit ? `\n…and ${items.length - limit} more.` : '';
	return `${lines.join('\n')}${remainder}`;
}
