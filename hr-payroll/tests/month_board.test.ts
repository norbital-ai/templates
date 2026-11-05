import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import {
	buildDays,
	cycleShiftId,
	datesBetween,
	dayKey,
	describeDay,
	hoursLabel,
	isAbsent,
	shiftMinutes,
	type PatternRow,
	type ShiftRow
} from '../src/lib/ui/roster/month_board.ts';

const dayShift: ShiftRow = {
	id: 'day',
	code: 'DAY',
	variant: {
		day_type: 'WORK',
		start_time: '09:00',
		end_time: '17:00',
		ends_next_day: false,
		breaks: [{ start_time: '12:00', end_time: '13:00', paid: false }]
	}
};

const nightShift: ShiftRow = {
	id: 'night',
	code: 'NIGHT',
	variant: {
		day_type: 'WORK',
		start_time: '22:00',
		end_time: '06:00',
		ends_next_day: true,
		breaks: []
	}
};

const pattern: PatternRow = {
	id: 'cycle',
	pattern: {
		anchor_date: '2026-03-02',
		days: [{ shift_definition_id: 'day' }, { shift_definition_id: 'night' }]
	}
};

describe('month board', () => {
	it('lists each calendar day of the period', () => {
		assert.deepEqual(datesBetween('2026-03-30', '2026-04-02'), [
			'2026-03-30',
			'2026-03-31',
			'2026-04-01',
			'2026-04-02'
		]);
	});

	it('nets the unpaid break from a shift', () => {
		assert.equal(shiftMinutes(dayShift), 420);
		assert.equal(shiftMinutes(nightShift), 480);
	});

	it('places a date in the pattern cycle from its anchor', () => {
		assert.equal(cycleShiftId(pattern, '2026-03-02'), 'day');
		assert.equal(cycleShiftId(pattern, '2026-03-03'), 'night');
		assert.equal(cycleShiftId(pattern, '2026-03-04'), 'day');
		assert.equal(cycleShiftId(pattern, '2026-03-01'), null);
	});

	it('reads each day from the contract valid on it, and crosses the days after the last', () => {
		const days = buildDays({
			dates: datesBetween('2026-03-02', '2026-03-05'),
			today: '2026-03-06',
			people: [
				{
					id: 'person',
					employee: 'person',
					from: '2026-03-03',
					to: '2026-03-04',
					patternId: 'cycle',
					contracts: [
						{ id: 'first', from: '2026-01-01', to: '2026-03-02', patternId: 'cycle' },
						{ id: 'next', from: '2026-03-03', to: '2026-03-04', patternId: 'cycle' }
					]
				}
			],
			entries: [],
			shifts: [dayShift, nightShift],
			patterns: [pattern],
			holidays: [],
			leave: [
				{
					employment_id: 'next',
					employee: 'person',
					days: [{ date: '2026-03-02', part: 'AM' }],
					catalog_id: { code: 'AL' }
				}
			],
			locked: new Set()
		});
		const day = (date: string) => days.get(dayKey('person', date));
		assert.equal(day('2026-03-02')?.employmentId, 'first');
		assert.equal(day('2026-03-02')?.projectedShift, 'DAY');
		assert.equal(day('2026-03-03')?.employmentId, 'next');
		assert.equal(day('2026-03-03')?.projectedShift, 'NIGHT');
		// a pattern switch is no departure; leave follows the person across contracts
		assert.equal(day('2026-03-03')?.left, null);
		assert.equal(day('2026-03-02')?.leave?.label, 'AL AM');
		assert.equal(day('2026-03-05')?.employed, false);
		assert.equal(day('2026-03-05')?.left, '2026-03-04');
		assert.equal(day('2026-03-05')?.gone, true);
		assert.equal(day('2026-03-05')?.projectedShift, null);
	});

	it('says leaving until the last day has passed, then left', () => {
		const label = (today: string) => {
			const days = buildDays({
				dates: ['2026-03-05'],
				today,
				people: [{ id: 'c', from: '2026-01-01', to: '2026-03-04', patternId: null }],
				entries: [],
				shifts: [],
				patterns: [],
				holidays: [],
				leave: [],
				locked: new Set()
			});
			const day = days.get(dayKey('c', '2026-03-05'));
			assert.ok(day);
			return describeDay(day, 'Ana', 'UTC', (key) => key);
		};
		assert.equal(label('2026-03-04'), 'Ana · roster.leaving_on');
		assert.equal(label('2026-03-05'), 'Ana · roster.left_on');
	});

	it('marks no one as left while a contract stays open', () => {
		const days = buildDays({
			dates: ['2026-03-02'],
			today: '2026-03-03',
			people: [{ id: 'c', from: '2026-03-05', to: null, patternId: null }],
			entries: [],
			shifts: [],
			patterns: [],
			holidays: [],
			leave: [],
			locked: new Set()
		});
		assert.equal(days.get(dayKey('c', '2026-03-02'))?.employed, false);
		assert.equal(days.get(dayKey('c', '2026-03-02'))?.left, null);
	});

	it('projects the pattern, then prefers the entry shift and counts the actual work', () => {
		const days = buildDays({
			dates: datesBetween('2026-03-02', '2026-03-04'),
			today: '2026-03-05',
			people: [{ id: 'contract-1', from: '2026-03-01', to: null, patternId: 'cycle' }],
			entries: [
				{
					id: 'entry-1',
					employment_id: 'contract-1',
					work_date: '2026-03-03',
					shift_definition_id: 'day',
					planned_overtime_intervals: [
						{ start: '2026-03-03T17:00:00Z', end: '2026-03-03T18:00:00Z' }
					],
					actual_worked_intervals: [{ start: '2026-03-03T09:00:00Z', end: '2026-03-03T13:00:00Z' }],
					findings: [{ code: 'roster.daily_hours', message: 'Daily limit crossed' }]
				}
			],
			shifts: [dayShift, nightShift],
			patterns: [pattern],
			holidays: [{ date: '2026-03-04', name: 'Holiday' }],
			leave: [],
			locked: new Set(['contract-1'])
		});

		const projected = days.get(dayKey('contract-1', '2026-03-02'));
		assert.equal(projected?.projectedShift, 'DAY');
		assert.equal(projected?.plannedMinutes, 420);
		assert.equal(projected?.locked, true);

		const recorded = days.get(dayKey('contract-1', '2026-03-03'));
		assert.equal(recorded?.shift, 'DAY');
		assert.equal(recorded?.actualMinutes, 240);
		assert.equal(recorded?.plannedOvertimeMinutes, 60);
		assert.equal(recorded?.percent, 50);
		assert.deepEqual(recorded?.findings, ['Daily limit crossed']);
		assert.equal(isAbsent(recorded ?? assert.fail('missing day')), false);

		const holiday = days.get(dayKey('contract-1', '2026-03-04'));
		assert.equal(holiday?.holiday, 'Holiday');
		assert.equal(holiday?.projectedShift, 'DAY');
	});

	it('labels hours without inventing precision', () => {
		assert.equal(hoursLabel(510), '8.5h');
	});
});
