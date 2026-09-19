/**
 * Map-receiver functions over the person: `employee.age_on(date)` and `leave.taken(code)`, beside
 * the children's in `child-under.ts`. Registered on both engines.
 */
import { decodeNumber } from '@norbital-ai/std/json';
import { completedMonths, completedYears } from '../../collections/payroll_runs/lib/dates.js';

/** The person's birth date and the day asked about, or null where either is missing or the day precedes the birth. */
function birthAndDay(employee: unknown, date: unknown): [string, string] | null {
	const born = String((employee as { birth_date?: unknown }).birth_date ?? '');
	const day = String(date).slice(0, 10);
	return born === '' || day < born ? null : [born, day];
}

/** `employee.age_on(date)`: completed years on that day, 0 with no birth date on record. */
export function ageOn(employee: unknown, date: unknown): bigint {
	const pair = birthAndDay(employee, date);
	return pair == null ? 0n : BigInt(completedYears(...pair));
}

/** `employee.age_months_on(date)`: completed months of age on that day (VN's retirement age is stated in years and months). */
export function ageMonthsOn(employee: unknown, date: unknown): bigint {
	const pair = birthAndDay(employee, date);
	return pair == null ? 0n : BigInt(completedMonths(...pair));
}

/** `leave.taken(code)`: the days of that code charged in the leave year before this day. */
export function leaveTaken(leave: unknown, code: unknown): number {
	const taken = (leave as { year_taken?: Record<string, unknown> }).year_taken;
	return decodeNumber(taken?.[String(code)] ?? 0);
}
