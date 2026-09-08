// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What a work day will and will not accept as a record of the clock.
 *
 * `assertWorkedIntervals` holds four rules, and none of its refusal sentences appeared in any
 * test. They are the rules that keep overtime honest: the engine unions and subtracts these
 * intervals to decide payable time, so an overlapping pair pays a minute twice, a break longer
 * than the work it is deducted from pays negative time, and an open interval that is not the last
 * one makes "still on the clock" ambiguous.
 *
 * Each rule is also driven with the write it must NOT refuse, because a validator that refuses
 * everything reads exactly like one that works — and one of these has a genuine zero case the
 * day sheet depends on: a day reviewed and found empty is `[]` with no break, and must land.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import workDayHooks from '../src/collections/work_days/+hooks.ts';

const api = {
	db: {
		employments: {
			findFirst: () => Effect.succeed({ company_id: 'co-1' }),
			findMany: ({ where }) =>
				Effect.succeed((where?.id?.in ?? ['emp-1']).map((id) => ({ id, company_id: 'co-1' })))
		},
		employment_terms: { findMany: () => Effect.succeed([]) },
		work_days: { findMany: () => Effect.succeed([]) },
		shift_definitions: { findMany: () => Effect.succeed([]) },
		shift_patterns: { findMany: () => Effect.succeed([]) },
		// A complete jurisdiction calendar is required even when this fixture has no holidays or
		// weekly rest rule. Preparation must reach interval validation with legitimate inputs.
		companies: { findMany: () => Effect.succeed([{ id: 'co-1', settings_code: 'TEST' }]) },
		jurisdiction_settings: {
			findMany: () =>
				Effect.succeed([
					{
						id: 'settings-1',
						code: 'TEST',
						jurisdiction_code: 'TEST-JUR',
						sealed_at: '2020-01-01T00:00:00.000Z',
						voided_at: null,
						approval_id: null,
						effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
					}
				])
		},
		work_catalogue: {
			findMany: () =>
				Effect.succeed([
					{
						settings_id: 'settings-1',
						regime: { overtime_coverage: null, overtime_rules: [], overtime_limits: [] }
					}
				])
		},
		jurisdiction_holiday_calendars: {
			findMany: () =>
				Effect.succeed([
					{
						id: 'calendar-2026',
						jurisdiction_code: 'TEST-JUR',
						year: 2026,
						revision: 1,
						published_at: '2025-12-01T00:00:00.000Z',
						observations: []
					}
				])
		},
		payroll_runs: { findMany: () => Effect.succeed([]) },
		payslip_work_day_inputs: { findFirst: () => Effect.succeed(null) },
		leave_entries: { findMany: () => Effect.succeed([]) }
	}
};

const at = (time) => `2026-07-01T${time}:00.000Z`;

const write = (overrides) => {
	const input = {
		employment_id: 'emp-1',
		work_date: '2026-07-01',
		shift_definition_id: null,
		worked_intervals: [{ start: at('01:00'), end: at('09:00') }],
		break_minutes: 60,
		...overrides
	};
	const prepared = Effect.runSync(workDayHooks.mutate.prepare({ inputs: [input], api }));
	return Effect.runSync(
		workDayHooks.mutate.perRecord.before.handler({ input, existing: undefined, prepared, api })
	);
};

test('overlapping intervals are refused, so no minute can be paid twice', () => {
	assert.throws(
		() =>
			write({
				worked_intervals: [
					{ start: at('01:00'), end: at('09:00') },
					{ start: at('08:00'), end: at('12:00') }
				]
			}),
		/Worked intervals must be in time order and cannot overlap/
	);
	// Touching is not overlapping: a split shift resuming exactly when the first half ended is legal.
	assert.doesNotThrow(() =>
		write({
			worked_intervals: [
				{ start: at('01:00'), end: at('09:00') },
				{ start: at('09:00'), end: at('12:00') }
			],
			break_minutes: 0
		})
	);
});

test('only the final interval may still be open', () => {
	assert.throws(
		() =>
			write({
				worked_intervals: [
					{ start: at('01:00'), end: null },
					{ start: at('09:00'), end: at('12:00') }
				]
			}),
		/Only the final worked interval may still be open/
	);
	assert.doesNotThrow(() =>
		write({
			worked_intervals: [
				{ start: at('01:00'), end: at('09:00') },
				{ start: at('10:00'), end: null }
			]
		})
	);
});

test('an interval must end after it starts', () => {
	assert.throws(
		() => write({ worked_intervals: [{ start: at('09:00'), end: at('09:00') }] }),
		/Each worked interval must end after it starts/
	);
	assert.throws(
		() => write({ worked_intervals: [{ start: at('09:00'), end: at('08:00') }] }),
		/Each worked interval must end after it starts/
	);
});

test('an unpaid break is a non-negative whole number of minutes', () => {
	assert.throws(
		() => write({ break_minutes: -1 }),
		/Unpaid break must be a non-negative whole number of minutes/
	);
	assert.throws(
		() => write({ break_minutes: 30.5 }),
		/Unpaid break must be a non-negative whole number of minutes/
	);
	assert.doesNotThrow(() => write({ break_minutes: 0 }));
});

test('a break cannot be as long as the work it is deducted from', () => {
	// Eight hours clocked, eight hours of break: the day would be worth nothing but the arithmetic
	// says so by subtraction rather than by refusal, which is how a negative payable day appears.
	assert.throws(
		() => write({ break_minutes: 480 }),
		/Unpaid break must be shorter than the recorded worked time/
	);
	assert.throws(() => write({ break_minutes: 481 }), /shorter than the recorded worked time/);
	assert.doesNotThrow(() => write({ break_minutes: 479 }));
});

test('a day reviewed and found empty is a legal statement, and a break on nothing is not', () => {
	// `[]` is not `null`: one says the day was read and produced no work, the other that no
	// attendance was recorded at all. The day sheet's "reviewed, nothing worked" action writes the
	// first, and `unpaidBreak > 0` in the rule above is what keeps that write legal.
	const reviewed = write({ worked_intervals: [], break_minutes: 0 });
	assert.deepEqual(reviewed.worked_intervals, []);
	assert.equal(reviewed.holiday_calendar_id, 'calendar-2026');
	assert.equal(reviewed.employment_id, 'emp-1');
	assert.doesNotThrow(() => write({ worked_intervals: null, break_minutes: 0 }));
	assert.throws(
		() => write({ worked_intervals: [], break_minutes: 30 }),
		/Unpaid break must be shorter than the recorded worked time/
	);
});

test('an open clock suspends the break rule rather than refusing the punch-in', () => {
	// The day is still being worked, so there is no recorded worked time to compare a break with.
	assert.doesNotThrow(() =>
		write({ worked_intervals: [{ start: at('01:00'), end: null }], break_minutes: 60 })
	);
});
