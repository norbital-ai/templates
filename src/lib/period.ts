/**
 * Server-side helpers shared by the collection roles that speak in payroll months.
 *
 * `controller-surfaces.md` §1 tells app and representation authors to inline duplicated one-liners
 * rather than grow the import graph. It scopes that to controller UI; these are `+hooks.ts` and
 * `+pipelines.ts` code, where a copy that drifts changes what the server *accepts*, not how a cell
 * reads. The month arithmetic itself lives in the engine's `dates.ts`; re-exported here so the
 * roles keep one import.
 */

import { addDays, monthBounds } from '../collections/payroll_runs/lib/dates.js';

export { addDays, monthBounds };

/** `YYYY-MM` for a payroll month. */
export function isYearMonth(value: string): boolean {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Every calendar day of a `YYYY-MM` month, in order. */
export function calendarDaysInMonth(month: string): readonly string[] {
	const { start, end } = monthBounds(month);
	const days: string[] = [];
	for (let cursor = start; cursor <= end;) {
		days.push(cursor);
		const utc = Date.parse(`${cursor}T00:00:00.000Z`) + 86_400_000;
		cursor = new Date(utc).toISOString().slice(0, 10);
	}
	return days;
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
