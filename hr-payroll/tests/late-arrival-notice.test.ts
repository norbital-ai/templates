// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Late for work is a reminder, not a rule: one inbox notice per person-day to the production manager's team when a
 * rostered shift has no clock-in fifteen minutes after it started, and the run schedules itself for the next such
 * instant. The automation's own body runs here over a fake `ctx` that answers reads in wire form (`{ $d }`, `{ $t }`),
 * as the engine does.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import lateArrival from '../src/automation/+late_arrival_notice.automation.ts';

const d = (day) => ({ $d: day });
const COMPANY = { id: 'company:1', name: 'Public Fixture Co', settings_code: 'TEST' };
const VERSION = {
	id: 'version:1',
	code: 'TEST',
	sealed_at: { $t: '2026-01-01T00:00:00.000Z' },
	voided_at: null,
	approval_id: null,
	effective_range: { from: d('2026-01-01'), to: null },
	payroll: { timezone: 'Asia/Kuala_Lumpur' }
};
const shift = (id, variant) => ({
	id,
	variant,
	effective_range: { from: d('2020-01-01'), to: null }
});
const SHIFTS = [
	shift('shift:work', { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 }),
	shift('shift:rest', { kind: 'REST' }),
	shift('shift:night', { kind: 'WORK', start_time: '20:00', end_time: '05:00', break_minutes: 60 })
];
const EMPLOYMENT = {
	id: 'employment:1',
	employee_id: 'employee:1',
	employee_number: 'PUBEM0002',
	company_id: 'company:1',
	effective_range: { from: d('2020-01-01'), to: null }
};
const workDay = (overrides = {}) => ({
	id: 'day:1',
	employment_id: 'employment:1',
	work_date: d('2026-09-22'),
	shift_definition_id: 'shift:work',
	worked_intervals: null,
	...overrides
});

/** The run over planted rows at an instant: what it notified, scheduled and returned. */
async function run({ now = '2026-09-22T00:45:00.000Z', workDays = [], leave = [] } = {}) {
	const rows = {
		companies: [COMPANY],
		jurisdiction_settings: [VERSION],
		shift_definitions: SHIFTS,
		employments: [EMPLOYMENT],
		employees: [{ id: 'employee:1', name: 'Aisyah binti Rahman' }],
		work_days: workDays,
		leave_entries: leave
	};
	const notices = [];
	const scheduled = [];
	const ctx = {
		now,
		read: async (collection) => ({ rows: rows[collection], next: null }),
		notify: async (list) => void notices.push(...list),
		schedule: async (name, input, options) => void scheduled.push({ name, input, ...options })
	};
	const result = await lateArrival.body({}, ctx);
	return { result, notices, scheduled };
}

test('a shift fifteen minutes past its start with no clock-in raises one reminder, keyed by person and day', async () => {
	const { result, notices } = await run({ workDays: [workDay()] });
	assert.equal(result.reminded, 1);
	assert.deepEqual(notices, [
		{
			to: { team: 'Production Manager' },
			title: 'Late for work — Public Fixture Co',
			body: 'Aisyah binti Rahman (PUBEM0002) has not clocked in for the 08:30 shift on 2026-09-22.',
			once: 'late:employment:1:2026-09-22'
		}
	]);
});

test('a clock-in, the grace, full-day leave, a rest code and the lookback each keep a day from being late', async () => {
	const punched = workDay({
		worked_intervals: [{ start: { $t: '2026-09-22T00:31:00.000Z' }, end: null }]
	});
	assert.equal((await run({ workDays: [punched] })).result.reminded, 0);
	assert.equal(
		(await run({ workDays: [workDay()], now: '2026-09-22T00:35:00.000Z' })).result.reminded,
		0
	);
	const leave = {
		employment_id: 'employment:1',
		from_date: d('2026-09-22'),
		to_date: d('2026-09-22'),
		half_day_start: false,
		half_day_end: false
	};
	assert.equal((await run({ workDays: [workDay()], leave: [leave] })).result.reminded, 0);
	assert.equal(
		(await run({ workDays: [workDay({ shift_definition_id: 'shift:rest' })] })).result.reminded,
		0
	);
	assert.equal(
		(await run({ workDays: [workDay()], now: '2026-09-22T07:00:00.000Z' })).result.reminded,
		0
	);
});

test('a night shift that began before midnight is still inside the lookback', async () => {
	const { notices } = await run({
		workDays: [workDay({ work_date: d('2026-09-21'), shift_definition_id: 'shift:night' })],
		now: '2026-09-21T16:20:00.000Z'
	});
	assert.equal(notices[0].once, 'late:employment:1:2026-09-21');
});

test('the run schedules itself for the next shift start plus the grace, under one replacing key', async () => {
	// 07:00 in Kuala Lumpur: the 08:30 shift is next, due at 08:45 (00:45Z).
	const { result, scheduled } = await run({
		workDays: [workDay()],
		now: '2026-09-21T23:00:00.000Z'
	});
	assert.equal(result.reminded, 0);
	assert.deepEqual(scheduled, [
		{ name: 'late_arrival_notice', input: {}, at: '2026-09-22T00:45:00.000Z', key: 'late_arrival' }
	]);
});
