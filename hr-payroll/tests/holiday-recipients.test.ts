/**
 * A substitute holiday scoped to staff who were off on the replaced date.
 *
 * When a public holiday falls on a non-working day for some staff, the observed replacement is
 * theirs alone: a person whose roster had the original date as WORK already took the holiday
 * itself and works the observed day, while a person who was off on the original date gets the
 * observed day as their holiday.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSchedule } from '../src/collections/payroll_runs/lib/schedule.ts';

const RANGE = { start: '2020-01-01T00:00:00.000Z', end: null };
const WORK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const REST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

type Cycle = {
	readonly days: readonly { readonly roster_code_id: string }[];
	readonly anchor: string;
};

const cycle = (work: number, rest: number, anchor: string): Cycle => ({
	anchor,
	days: [
		...Array.from({ length: work }, () => ({ roster_code_id: WORK_ID })),
		...Array.from({ length: rest }, () => ({ roster_code_id: REST_ID }))
	]
});

/** Mon–Fri work, Sat/Sun rest: the holiday's Saturday fell on their off day. */
const fiveDay = cycle(5, 2, '2026-03-16');
/** Mon–Sat work, Sunday rest: the holiday's Saturday was a working day. */
const sixDay = cycle(6, 1, '2026-03-16');

const shiftById = new Map([
	[
		WORK_ID,
		{
			id: WORK_ID,
			code: 'DAY',
			name: 'Day',
			variant: { kind: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 60 },
			effective_range: RANGE,
			approval_id: null
		}
	],
	[
		REST_ID,
		{
			id: REST_ID,
			code: 'REST',
			name: 'Rest',
			variant: { kind: 'REST' },
			effective_range: RANGE,
			approval_id: null
		}
	]
]);

const holiday = (givenTo: 'EVERYONE' | 'ONLY_IF_OFF_ON_REPLACED_DATE') => ({
	id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
	company_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
	date: '2026-03-23',
	name: 'Replacement Public Holiday (in lieu of 21 Mar)',
	kind: 'SUBSTITUTE' as const,
	replaces: '2026-03-21',
	given_to: givenTo,
	published_at: '2025-12-01T00:00:00.000Z'
});

const dates = ['2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23', '2026-03-24', '2026-03-25'];

const run = (cycleValue: Cycle, givenTo: 'EVERYONE' | 'ONLY_IF_OFF_ON_REPLACED_DATE') =>
	resolveSchedule({
		window: { start: '2026-03-01', end: '2026-03-31' },
		dates,
		terms: () => ({
			work_pattern: { days: cycleValue.days },
			pattern_anchor: cycleValue.anchor,
			normal_daily_hours: 8
		}),
		workDays: [],
		configuration: {
			holidays: new Map([['2026-03-23', holiday(givenTo)]]),
			shiftById,
			holidayRestPrecedence: 'SUBSTITUTE' as const
		}
	});

test('a worker whose roster had the replaced date off gets the observed holiday', () => {
	const schedule = run(fiveDay, 'ONLY_IF_OFF_ON_REPLACED_DATE');
	assert.equal(schedule.get('2026-03-21')?.dayType, 'REST_DAY');
	assert.equal(schedule.get('2026-03-23')?.dayType, 'PUBLIC_HOLIDAY');
});

test('a worker who was rostered on the replaced date works the observed day', () => {
	const schedule = run(sixDay, 'ONLY_IF_OFF_ON_REPLACED_DATE');
	assert.equal(schedule.get('2026-03-21')?.dayType, 'ORDINARY');
	assert.equal(schedule.get('2026-03-23')?.dayType, 'ORDINARY');
});

test('an unscoped holiday still applies to everyone', () => {
	const schedule = run(sixDay, 'EVERYONE');
	assert.equal(schedule.get('2026-03-23')?.dayType, 'PUBLIC_HOLIDAY');
});
