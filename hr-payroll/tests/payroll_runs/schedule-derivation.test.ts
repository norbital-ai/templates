// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSchedule } from '../../src/collections/payroll_runs/lib/schedule.ts';

const range = { start: '2020-01-01', end: null };
const DAY_ID = '00000000-0000-4000-8000-000000000001';
const NIGHT_ID = '00000000-0000-4000-8000-000000000002';
const REST_ID = '00000000-0000-4000-8000-000000000003';
const OFF_ID = '00000000-0000-4000-8000-000000000004';
const code = (id, value, variant) => ({
	id: id,
	code: value,
	name: value,
	variant,
	effective_range: range
});
const DAY = code(DAY_ID, 'D', {
	kind: 'WORK',
	start_time: '08:30',
	end_time: '17:30',
	break_minutes: 60
});
const NIGHT = code(NIGHT_ID, 'N', {
	kind: 'WORK',
	start_time: '20:00',
	end_time: '05:00',
	break_minutes: 60
});
const REST = code(REST_ID, 'REST', { kind: 'REST' });
const OFF = code(OFF_ID, 'OFF', { kind: 'OFF' });
const shiftById = new Map([DAY, NIGHT, REST, OFF].map((row) => [row.id, row]));

const weeklyPattern = {
	type: 'PATTERNED',
	anchor_date: '2026-03-02', // Monday
	phases: [
		{
			duration: { kind: 'CONTINUOUS' },
			day_cycle: [DAY_ID, DAY_ID, DAY_ID, DAY_ID, DAY_ID, OFF_ID, REST_ID].map(
				(roster_code_id) => ({ roster_code_id })
			)
		}
	]
};

const terms =
	(work_pattern = weeklyPattern) =>
	() => ({
		work_pattern,
		normal_daily_hours: 8
	});

test('a fixed week is generated directly from the embedded pattern when no roster was imported', () => {
	const schedule = resolveSchedule({
		window: { start: '2026-03-06', end: '2026-03-08' },
		dates: ['2026-03-06', '2026-03-07', '2026-03-08'],
		terms: terms(),
		workDays: [],
		configuration: { shiftById, holidays: new Map() }
	});
	assert.equal(schedule.get('2026-03-06').dayType, 'ORDINARY');
	assert.equal(schedule.get('2026-03-07').dayType, 'OFF_DAY');
	assert.equal(schedule.get('2026-03-08').dayType, 'REST_DAY');
});

test('a WORK roster assignment on a patterned REST day is explicit scheduled overtime', () => {
	const schedule = resolveSchedule({
		window: { start: '2026-03-08', end: '2026-03-08' },
		dates: ['2026-03-08'],
		terms: terms(),
		workDays: [{ work_date: '2026-03-08', shift_definition_id: DAY_ID }],
		configuration: { shiftById, holidays: new Map() }
	});
	const sunday = schedule.get('2026-03-08');
	assert.equal(sunday.dayType, 'REST_DAY', 'the contractual baseline remains protected');
	assert.equal(sunday.shift.code, 'D', 'the monthly assignment supplies the scheduled work window');
});

test('an observed public holiday overlays the pattern and roster instead of becoming another code', () => {
	const schedule = resolveSchedule({
		window: { start: '2026-03-06', end: '2026-03-06' },
		dates: ['2026-03-06'],
		terms: terms(),
		workDays: [],
		configuration: {
			shiftById,
			holidays: new Map([
				['2026-03-06', { date: '2026-03-06', substitutes_date: null, scope: 'NATIONAL' }]
			])
		}
	});
	assert.equal(schedule.get('2026-03-06').dayType, 'PUBLIC_HOLIDAY');
	assert.equal(schedule.get('2026-03-06').shift.code, 'D');
});

test('calendar-month phases support a three-month day / three-month night rotation', () => {
	const phased = {
		type: 'PATTERNED',
		anchor_date: '2026-01-01',
		phases: [
			{
				duration: { kind: 'CALENDAR_MONTHS', months: 3 },
				day_cycle: [{ roster_code_id: DAY_ID }]
			},
			{
				duration: { kind: 'CALENDAR_MONTHS', months: 3 },
				day_cycle: [{ roster_code_id: NIGHT_ID }]
			}
		]
	};
	const schedule = resolveSchedule({
		window: { start: '2026-03-31', end: '2026-04-01' },
		dates: ['2026-03-31', '2026-04-01'],
		terms: terms(phased),
		workDays: [],
		configuration: { shiftById, holidays: new Map() }
	});
	assert.equal(schedule.get('2026-03-31').shift.code, 'D');
	assert.equal(schedule.get('2026-04-01').shift.code, 'N');
});
