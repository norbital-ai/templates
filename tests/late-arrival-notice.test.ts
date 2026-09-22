// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Late for work is a reminder, not a rule.
 *
 * The automation reads the roster and the clock and asks one question per person-day: the shift
 * started more than fifteen minutes ago and nobody clocked in. What it does with the answer is
 * `api.notify`, keyed by person and day, so the next tick writes nothing — the platform's own
 * reminder semantics, which the fake `notify` below records rather than a ledger.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { runLateArrivalNotice } from '../src/automations/+late_arrival_notice.ts';

/** 2026-09-22 08:45 in Kuala Lumpur (UTC+8). */
const NOW = new Date('2026-09-22T00:45:00.000Z');

const COMPANY = {
	id: 'company:1',
	name: 'Public Fixture Co',
	settings_code: 'TEST'
};
const VERSION = {
	id: 'version:1',
	code: 'TEST',
	name: 'Test law',
	sealed_at: '2026-01-01T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { start: '2026-01-01', end: null },
	payroll: { timezone: 'Asia/Kuala_Lumpur', currency: 'MYR', tax_year_start_month: 1 }
};
const WORK_SHIFT = {
	id: 'shift:work',
	code: 'D',
	variant: { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 },
	effective_range: { start: '2020-01-01', end: null }
};
const REST_SHIFT = {
	id: 'shift:rest',
	code: 'REST',
	variant: { kind: 'REST' },
	effective_range: { start: '2020-01-01', end: null }
};
const EMPLOYMENT = {
	id: 'employment:1',
	employee_id: 'employee:1',
	employee_number: 'PUBEM0002',
	company_id: 'company:1',
	effective_range: { start: '2020-01-01', end: null }
};
const EMPLOYEE = { id: 'employee:1', name: 'Aisyah binti Rahman' };

const workDay = (overrides = {}) => ({
	id: 'day:1',
	employment_id: 'employment:1',
	work_date: '2026-09-22T00:00:00.000Z',
	shift_definition_id: 'shift:work',
	worked_intervals: null,
	...overrides
});

const leaveDay = (overrides = {}) => ({
	employment_id: 'employment:1',
	from_date: '2026-09-22T00:00:00.000Z',
	to_date: '2026-09-22T00:00:00.000Z',
	half_day_start: false,
	half_day_end: false,
	...overrides
});

/** The api the automation reaches, with only the reads each case plants. */
const harness = ({ workDays = [], leaveEntries = [], shifts = [WORK_SHIFT, REST_SHIFT] } = {}) => {
	const notifications = [];
	const api = {
		progress: () => Effect.void,
		notify: (reminder) =>
			Effect.sync(() => {
				notifications.push(reminder);
			}),
		db: {
			companies: { findMany: () => Effect.succeed([COMPANY]) },
			jurisdiction_settings: { findMany: () => Effect.succeed([VERSION]) },
			shift_definitions: { findMany: () => Effect.succeed(shifts) },
			employments: { findMany: () => Effect.succeed([EMPLOYMENT]) },
			employees: { findMany: () => Effect.succeed([EMPLOYEE]) },
			work_days: { findMany: () => Effect.succeed(workDays) },
			leave_entries: { findMany: () => Effect.succeed(leaveEntries) }
		}
	};
	return { api, notifications };
};

const run = async (options = {}) => {
	const { now = NOW, ...world } = options;
	const { api, notifications } = harness(world);
	const result = await Effect.runPromise(runLateArrivalNotice(api, { now }));
	return { result, notifications };
};

test('a shift fifteen minutes past its start with no clock-in raises one reminder', async () => {
	const { result, notifications } = await run({ workDays: [workDay()] });
	assert.equal(result.checked, 1);
	assert.equal(result.reminded, 1);
	assert.deepEqual(notifications, [
		{
			key: 'late:employment:1:2026-09-22',
			recipients: [{ team: 'Production Manager' }],
			title: 'Late for work — Public Fixture Co',
			body: 'Aisyah binti Rahman (PUBEM0002) has not clocked in for the 08:30 shift on 2026-09-22.'
		}
	]);
});

test('a clocked-in day is not late, open punch or closed', async () => {
	const closed = await run({
		workDays: [
			workDay({
				worked_intervals: [{ start: '2026-09-22T00:25:00.000Z', end: '2026-09-22T09:30:00.000Z' }]
			})
		]
	});
	assert.equal(closed.result.reminded, 0);
	const open = await run({
		workDays: [workDay({ worked_intervals: [{ start: '2026-09-22T00:31:00.000Z', end: null }] })]
	});
	assert.equal(open.result.reminded, 0, 'an open punch is somebody at work');
});

test('the fifteen-minute grace holds', async () => {
	// 08:35 Kuala Lumpur: five minutes past the start, inside the grace.
	const { result, notifications } = await run({
		workDays: [workDay()],
		now: new Date('2026-09-22T00:35:00.000Z')
	});
	assert.equal(result.reminded, 0);
	assert.deepEqual(notifications, []);
});

test('a full day of approved leave is not a late arrival', async () => {
	const { result } = await run({ workDays: [workDay()], leaveEntries: [leaveDay()] });
	assert.equal(result.checked, 1);
	assert.equal(result.reminded, 0);
});

test('a rest or off code has no start to be late for', async () => {
	const { result } = await run({
		workDays: [workDay({ shift_definition_id: 'shift:rest' })]
	});
	assert.equal(result.checked, 0);
	assert.equal(result.reminded, 0);
});

test('a shift that started more than six hours ago is no longer a late arrival', async () => {
	// 15:00 Kuala Lumpur against the same 08:30 shift.
	const { result, notifications } = await run({
		workDays: [workDay()],
		now: new Date('2026-09-22T07:00:00.000Z')
	});
	assert.equal(result.checked, 1);
	assert.equal(result.reminded, 0, 'the lookback bound keeps yesterday out of this morning');
	assert.deepEqual(notifications, []);
});

test('a night shift that began before midnight is still inside the lookback', async () => {
	// A 20:00 shift on the 21st, checked at 00:20 on the 22nd in Kuala Lumpur.
	const { api, notifications } = harness({
		workDays: [
			workDay({
				work_date: '2026-09-21T00:00:00.000Z',
				shift_definition_id: 'shift:night'
			})
		],
		shifts: [
			{
				id: 'shift:night',
				code: 'N',
				variant: { kind: 'WORK', start_time: '20:00', end_time: '05:00', break_minutes: 60 },
				effective_range: { start: '2020-01-01', end: null }
			}
		]
	});
	const result = await Effect.runPromise(
		runLateArrivalNotice(api, { now: new Date('2026-09-21T16:20:00.000Z') })
	);
	assert.equal(result.reminded, 1);
	assert.equal(notifications[0].key, 'late:employment:1:2026-09-21');
});
