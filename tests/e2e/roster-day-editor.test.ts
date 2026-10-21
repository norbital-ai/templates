import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import {
	buildDays,
	clockStampOf,
	clocksOf,
	dayKey,
	intervalsFrom,
	isAbsent,
	overtimeOf
} from '../../src/lib/ui/roster/month_board.js';
import { fixtureId, nativeId } from '../fixture_values.js';
import { plannedShift } from '../../src/lib/payroll_engine/shift_pattern.js';

describe('work-day interval editor', () => {
	it('leaves blank editor rows unrecorded and keeps a final open clock-in', () => {
		assert.deepEqual(intervalsFrom([{ start: null, end: null }], 'Asia/Singapore'), {
			intervals: []
		});
		assert.deepEqual(
			intervalsFrom(
				[
					{ start: '2026-10-17T09:00:07', end: null },
					{ start: null, end: null }
				],
				'Asia/Singapore'
			),
			{ intervals: [{ start: '2026-10-17T01:00:07.000Z', end: null }] }
		);
	});

	it('preserves overnight intervals and refuses an end without a clock-in', () => {
		assert.deepEqual(
			intervalsFrom(
				[{ start: '2026-10-17T22:00:07', end: '2026-10-18T06:00:09' }],
				'Asia/Singapore'
			),
			{
				intervals: [{ start: '2026-10-17T14:00:07.000Z', end: '2026-10-17T22:00:09.000Z' }]
			}
		);
		assert.deepEqual(
			intervalsFrom([{ start: null, end: '2026-10-17T18:00:00' }], 'Asia/Singapore'),
			{ problem: 'roster.day_sheet_problem_missing_start' }
		);
		const exact = [{ start: '2026-10-16T23:59:07.123Z', end: '2026-10-17T01:00:09.456Z' }];
		assert.deepEqual(intervalsFrom(clocksOf(exact, 'Asia/Singapore'), 'Asia/Singapore'), {
			intervals: exact
		});
		assert.deepEqual(
			intervalsFrom(
				[{ start: '2026-10-17T22:00:00', end: '2026-10-17T06:00:00' }],
				'Asia/Singapore'
			),
			{ problem: 'roster.day_sheet_problem_clock_order' }
		);
	});
});

describe('work board calendar layers', () => {
	const person = { id: fixtureId('board-employment'), from: '2026-01-01', to: null };
	const work = plannedShift({
		code: 'DAY',
		variant: { day_type: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
	});

	it('shows leave ranges and public holidays before attendance is imported', () => {
		const dates = ['2026-01-01', '2026-01-02', '2026-01-03'];
		const days = buildDays({
			dates,
			timeZone: 'Asia/Singapore',
			people: [person],
			entries: [],
			holidays: [{ date: '2026-01-02', name: 'Public holiday' }],
			leave: [
				{
					employment_id: person.id,
					occurred_on: '2026-01-01',
					from: '2026-01-01',
					to: '2026-01-03',
					days: '2.5',
					half_day_start: true,
					catalog_id: { code: 'ANNUAL', name: 'Annual leave' }
				}
			],
			shiftOf: () => work
		});
		assert.equal(days.size, 3);
		for (const date of dates) {
			const day = days.get(dayKey(person.id, date));
			assert.ok(day);
			assert.equal(day.entryId, null);
			assert.equal(day.intervals, null);
			assert.ok(day.leave);
			assert.equal(day.leave.code, 'ANNUAL');
			assert.equal(day.leave.half, date === '2026-01-01');
			assert.equal(day.shift, null);
			assert.equal(day.shiftId, null);
			assert.equal(day.projectedShift, 'DAY');
			assert.equal(day.planned?.code, 'DAY');
			assert.equal(isAbsent(day), false);
		}
		assert.equal(days.get(dayKey(person.id, '2026-01-02'))?.holiday, 'Public holiday');
	});

	it('marks only uncovered scheduled work as AWOL after a zero-clock import', () => {
		const dates = Array.from({ length: 8 }, (_, index) => `2026-01-0${index + 1}`);
		const days = buildDays({
			dates,
			timeZone: 'Asia/Singapore',
			people: [person],
			entries: dates.slice(0, 7).map((date) => ({
				id: nativeId('roster_entry', fixtureId(`board-${date}`)),
				employment_id: person.id,
				work_date: date,
				worked_intervals: []
			})),
			holidays: [{ date: '2026-01-04', name: 'Public holiday' }],
			leave: [
				{
					employment_id: person.id,
					occurred_on: '2026-01-01',
					days: '1',
					catalog_id: { code: 'UNPAID', name: 'Unpaid leave' }
				},
				{
					employment_id: person.id,
					occurred_on: '2026-01-06',
					days: '0.5',
					half_day_end: true,
					catalog_id: { code: 'MEDICAL', name: 'Medical leave' }
				}
			],
			shiftOf: (_id, date) =>
				date === '2026-01-07'
					? null
					: {
							...work,
							day_type: date === '2026-01-02' ? 'REST' : date === '2026-01-03' ? 'OFF' : 'WORK'
						}
		});
		for (const date of dates) {
			const day = days.get(dayKey(person.id, date));
			assert.ok(day);
			assert.equal(isAbsent(day), date === '2026-01-05' || date === '2026-01-06');
		}
	});

	it('combines two approved half days and retains the lock of either leave entry', () => {
		const date = '2026-01-09';
		const days = buildDays({
			dates: [date],
			timeZone: 'Asia/Singapore',
			people: [person],
			entries: [
				{
					id: nativeId('roster_entry', fixtureId('board-two-halves')),
					employment_id: person.id,
					work_date: date,
					worked_intervals: []
				}
			],
			holidays: [],
			leave: [
				{
					employment_id: person.id,
					occurred_on: date,
					days: '0.5',
					half_day_end: true,
					payslip_id: fixtureId('board-payslip'),
					catalog_id: { code: 'ANNUAL', name: 'Annual leave' }
				},
				{
					employment_id: person.id,
					occurred_on: date,
					days: '0.5',
					half_day_start: true,
					catalog_id: { code: 'MEDICAL', name: 'Medical leave' }
				}
			],
			shiftOf: () => work
		});
		const day = days.get(dayKey(person.id, date));
		assert.ok(day);
		assert.deepEqual(day.leave, {
			code: 'ANNUAL/MEDICAL',
			name: 'Annual leave / Medical leave',
			half: false
		});
		assert.equal(day.locked, true);
		assert.equal(isAbsent(day), false);
	});

	it('keeps planned overtime separate and floors actual overtime after exact breaks and seconds', () => {
		const date = '2026-01-10';
		const planned = {
			...work,
			id: fixtureId('board-shift'),
			break: { from_minute: 12 * 60, minutes: 60 }
		};
		const days = buildDays({
			dates: [date],
			timeZone: 'Asia/Singapore',
			people: [person],
			entries: [
				{
					id: nativeId('roster_entry', fixtureId('board-planned-ot')),
					employment_id: person.id,
					work_date: date,
					shift_definition_id: planned.id,
					planned_overtime_hours: '3',
					worked_intervals: [{ start: `${date}T08:00:00+08:00`, end: `${date}T19:54:00+08:00` }]
				}
			],
			holidays: [],
			leave: [],
			shiftOf: () => planned
		});
		const day = days.get(dayKey(person.id, date));
		assert.ok(day);
		assert.equal(day.shift, 'DAY');
		assert.equal(day.shiftId, planned.id);
		assert.equal(day.projectedShift, null);
		assert.equal(day.plannedOvertime, 3);
		assert.equal(day.overtime, 2.5);
		assert.equal(day.completion?.credited_hours, 10.5);
		assert.equal(day.completion?.target_hours, 11);
		assert.equal(
			overtimeOf(
				[{ start: `${date}T08:00:00+08:00`, end: `${date}T19:59:59+08:00` }],
				planned,
				date,
				'Asia/Singapore',
				3
			),
			2.5
		);
		assert.equal(
			overtimeOf(
				[{ start: `${date}T08:00:00+08:00`, end: `${date}T20:00:00+08:00` }],
				planned,
				date,
				'Asia/Singapore',
				3
			),
			3
		);
		assert.equal(
			overtimeOf([{ start: `${date}T08:00:00+08:00`, end: null }], planned, date, 'Asia/Singapore'),
			null
		);
	});

	it('projects a pattern without materializing a plan and stamps clocks to the second', () => {
		const day = buildDays({
			dates: ['2026-01-10'],
			timeZone: 'Asia/Singapore',
			people: [person],
			entries: [],
			holidays: [],
			leave: [],
			shiftOf: () => ({ ...work, id: fixtureId('board-projected-shift') })
		}).get(dayKey(person.id, '2026-01-10'));
		assert.ok(day);
		assert.equal(day.projectedShift, 'DAY');
		assert.equal(day.shiftId, null);
		const intervals = [{ start: '2026-01-10T00:00:07.000Z', end: '2026-01-10T11:59:59.000Z' }];
		const [clocked] = intervals;
		assert.ok(clocked);
		assert.ok(clockStampOf(clocked.start, 'Asia/Singapore').includes('08:00:07'));
		assert.ok(clockStampOf(clocked.end, 'Asia/Singapore').includes('19:59:59'));
	});
});
