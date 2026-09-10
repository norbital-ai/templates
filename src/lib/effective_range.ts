import { dateKey } from './iso-day.js';

/**
 * Day membership for stored `effective_range` values.
 *
 * Every effective-dated collection except `jurisdiction_settings` reads its range **inclusively**
 * — `payroll_runs/lib/effective.ts`'s `coversDate` says so, and the models' `EXCLUDE` constraints
 * are the inclusive `[]` form — so a day on either bound belongs to the range. Membership is
 * resolved with `dateKey`, never by slicing the instant: a day picked in a UI east of UTC is
 * stored at the viewer's local day boundary in UTC (`2026-09-01` becomes
 * `2026-08-31T16:00:00.000Z`), whose first ten characters name the day before.
 *
 * `jurisdiction_settings` is the deliberate exception: it is read **half-open** by `coversDay` and
 * the database exclusion, so it uses `dateKey(row.effective_range.start) <= day < end`.
 */
export function inForceOnDay(
	range: Readonly<{ start?: string | null; end?: string | null }> | null | undefined,
	day: string
): boolean {
	if (range?.start == null) return false;
	const start = dateKey(range.start);
	if (start === '' || start > day) return false;
	const end = range.end == null ? '' : dateKey(range.end);
	return end === '' || end >= day;
}
