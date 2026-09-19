/**
 * Map-receiver functions over the person: `employee.age_on(date)` and `leave.taken(code)`, beside
 * the children's in `child-under.ts`. Registered on both engines.
 */
import { decodeNumber } from '@norbital-ai/std/json';
import { completedYears } from '../../collections/payroll_runs/lib/dates.js';

/** `employee.age_on(date)`: completed years on that day, 0 with no birth date on record. */
export function ageOn(employee: unknown, date: unknown): bigint {
	const born = String((employee as { birth_date?: unknown }).birth_date ?? '');
	const day = String(date).slice(0, 10);
	return born === '' || day < born ? 0n : BigInt(completedYears(born, day));
}

/** `leave.taken(code)`: the days of that code charged in the leave year before this day. */
export function leaveTaken(leave: unknown, code: unknown): number {
	const taken = (leave as { year_taken?: Record<string, unknown> }).year_taken;
	return decodeNumber(taken?.[String(code)] ?? 0);
}
