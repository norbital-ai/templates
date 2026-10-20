// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { expect, it, vi } from 'vitest';
import DayCell from '../../src/lib/ui/roster/day_cell.svelte';
import {
	buildDays,
	dayEdit,
	dayKey,
	isAbsent,
	type Interval
} from '../../src/lib/ui/roster/month_board.js';
import { plannedShift, type PlannedShift } from '../../src/lib/payroll_engine/shift_pattern.js';
import { fixtureId, nativeId } from '../fixture_values.js';

vi.mock('$bolt', () => ({ bolt: { locale: 'en', t: (key: string) => key } }));

it('renders pattern projection separately from an explicit plan and credited completion', async () => {
	const person = { id: fixtureId('day-layers-employment'), from: '2026-01-01', to: null };
	const pattern = {
		id: fixtureId('day-layers-pattern-shift'),
		...plannedShift({
			code: '01',
			variant: { day_type: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
		})
	};
	const planned = {
		id: fixtureId('day-layers-planned-shift'),
		...plannedShift({
			code: '02',
			variant: { day_type: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
		})
	};
	const dates = ['2026-01-10', '2026-01-11'];
	const days = buildDays({
		dates,
		people: [person],
		timeZone: 'Asia/Singapore',
		entries: [
			{
				id: nativeId('roster_entry', fixtureId('day-layers-explicit-day')),
				employment_id: person.id,
				work_date: '2026-01-11',
				shift_definition_id: planned.id,
				planned_overtime_hours: '3',
				worked_intervals: [{ start: '2026-01-11T08:00:00+08:00', end: '2026-01-11T19:54:00+08:00' }]
			}
		],
		holidays: [],
		leave: [],
		shiftOf: (_id, _date, rostered) => (rostered == null ? pattern : planned)
	});
	for (const [index, date] of dates.entries()) {
		const day = days.get(dayKey(person.id, date));
		if (day == null) throw new Error('Missing person-day fixture.');
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(DayCell, { target, props: { day, dense: true } });
		try {
			flushSync();
			const text = (layer: string) =>
				target.querySelector(`[data-work-layer="${layer}"]`)?.textContent?.replace(/\s+/g, '');
			expect(text('projected')).toBe(index === 0 ? '01' : '—');
			expect(text('planned')).toBe(index === 0 ? '—' : '02+3h');
			expect(text('actual')).toBe(index === 0 ? '—' : '95%');
			const progress = target.querySelector('[role="progressbar"]');
			expect(progress?.getAttribute('aria-valuenow') ?? null).toBe(index === 0 ? null : '95');
			if (index === 1) {
				expect(progress?.getAttribute('aria-valuemax')).toBe('100');
				expect(progress?.getAttribute('aria-valuetext')).toBeTruthy();
			}
			expect(target.textContent).not.toContain('08:00');
			expect(target.textContent).not.toContain('19:54');
		} finally {
			await unmount(app);
			target.remove();
		}
	}
});

it('credits read-only dated pre-shift approval without filling an ordinary leading gap', async () => {
	const person = { id: fixtureId('pre-shift-employment'), from: '2026-01-01', to: null };
	const shiftId = nativeId('shift_definition', fixtureId('pre-shift-code'));
	const shift = plannedShift({
		code: 'DAY',
		variant: { day_type: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 }
	});
	const dates = ['2026-01-10', '2026-01-11'];
	for (const [index, date] of dates.entries()) {
		const approved = [{ start: `${date}T05:30:00+08:00`, end: `${date}T08:30:00+08:00` }];
		const intervals =
			index === 0
				? [{ start: `${date}T05:30:00+08:00`, end: `${date}T17:30:00+08:00` }]
				: [...approved, { start: `${date}T09:30:00+08:00`, end: `${date}T17:30:00+08:00` }];
		const day = buildDays({
			dates: [date],
			people: [person],
			timeZone: 'Asia/Singapore',
			entries: [
				{
					id: nativeId('roster_entry', fixtureId(`pre-shift-${date}`)),
					employment_id: person.id,
					work_date: date,
					shift_definition_id: shiftId,
					planned_overtime_hours: '3',
					approved_overtime_intervals: approved,
					worked_intervals: intervals
				}
			],
			holidays: [],
			leave: [],
			shiftOf: () => shift
		}).get(dayKey(person.id, date));
		if (day == null) throw new Error('Missing approved pre-shift fixture.');
		expect(day.approvedOvertimeIntervals).toEqual(approved);
		expect(day.overtime).toBe(3);
		expect(day.completion?.normal_hours).toBe(index === 0 ? 8 : 7);
		expect(day.completion?.segments[0]?.kind).toBe('OT');
		const unchanged = dayEdit(day, shiftId, 3, intervals);
		expect('approved_overtime_intervals' in unchanged).toBe(false);
		expect('shift_definition_id' in unchanged).toBe(false);
		const changedPlan = dayEdit(day, shiftId, 2, intervals);
		expect('approved_overtime_intervals' in changedPlan).toBe(false);
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(DayCell, { target, props: { day, dense: true } });
		try {
			flushSync();
			const progress = target.querySelector('[role="progressbar"]');
			expect(progress?.getAttribute('aria-valuenow')).toBe(index === 0 ? '100' : '90');
			const rects = [...target.querySelectorAll('[data-credit-interval]')];
			expect(Number(rects[0]?.getAttribute('x'))).toBe(0);
			if (index === 1) expect(Number(rects[1]?.getAttribute('x'))).toBeCloseTo((100 * 4) / 11);
			expect(target.querySelector('input')).toBeNull();
		} finally {
			await unmount(app);
			target.remove();
		}
	}
});

it('keeps capped progress accessible for missing OT, excess, overnight, open, rest and leave days', async () => {
	const date = '2026-01-10';
	const person = { id: fixtureId('progress-employment'), from: '2026-01-01', to: null };
	const work = plannedShift({
		code: '01',
		variant: { day_type: 'WORK', start_time: '08:00', end_time: '16:00', break_minutes: 0 }
	});
	const rest = plannedShift({ code: 'REST', variant: { day_type: 'REST' } });
	const interval = (end: string): readonly Interval[] => [
		{ start: `${date}T08:00:00+08:00`, end: `${date}T${end}+08:00` }
	];
	const cases: readonly {
		name: string;
		shift: PlannedShift | null;
		explicit: boolean;
		plannedOT: number | null;
		intervals: readonly Interval[] | null;
		percent: number | null;
		overtime: number | null;
		leave?: boolean;
		open?: boolean;
		creditOffsets?: readonly number[];
	}[] = [
		{
			name: 'zero approved OT',
			shift: work,
			explicit: true,
			plannedOT: 0,
			intervals: interval('21:00:00'),
			percent: 100,
			overtime: 0
		},
		{
			name: 'missing approved OT',
			shift: work,
			explicit: true,
			plannedOT: null,
			intervals: interval('21:00:00'),
			percent: 100,
			overtime: 0
		},
		{
			name: 'excess beyond planned OT',
			shift: work,
			explicit: true,
			plannedOT: 3,
			intervals: interval('20:00:00'),
			percent: 100,
			overtime: 3
		},
		{
			name: 'ordinary shortfall',
			shift: work,
			explicit: true,
			plannedOT: 0,
			intervals: interval('15:54:00'),
			percent: 93,
			overtime: 0
		},
		{
			name: 'overnight',
			shift: plannedShift({
				code: 'NIGHT',
				variant: { day_type: 'WORK', start_time: '23:00', end_time: '08:00', break_minutes: 60 }
			}),
			explicit: true,
			plannedOT: 3,
			intervals: [{ start: `${date}T23:00:00+08:00`, end: '2026-01-11T10:54:00+08:00' }],
			percent: 95,
			overtime: 2.5
		},
		{
			name: 'late arrival cannot be made up after the shift',
			shift: work,
			explicit: true,
			plannedOT: 0,
			intervals: [{ start: `${date}T09:00:00+08:00`, end: `${date}T17:00:00+08:00` }],
			percent: 87,
			overtime: 0,
			creditOffsets: [12.5]
		},
		{
			name: 'interior missed work remains a gap',
			shift: work,
			explicit: true,
			plannedOT: 0,
			intervals: [
				{ start: `${date}T08:00:00+08:00`, end: `${date}T10:00:00+08:00` },
				{ start: `${date}T11:00:00+08:00`, end: `${date}T16:00:00+08:00` }
			],
			percent: 87,
			overtime: 0,
			creditOffsets: [0, 37.5]
		},
		{
			name: 'unrecorded',
			shift: work,
			explicit: true,
			plannedOT: 3,
			intervals: null,
			percent: null,
			overtime: null
		},
		{
			name: 'open punch',
			shift: work,
			explicit: true,
			plannedOT: 3,
			intervals: [{ start: `${date}T08:00:00+08:00`, end: null }],
			percent: null,
			overtime: null,
			open: true
		},
		{
			name: 'rest without planned work',
			shift: rest,
			explicit: true,
			plannedOT: 0,
			intervals: [],
			percent: null,
			overtime: 0
		},
		{
			name: 'planned rest-day overtime',
			shift: rest,
			explicit: true,
			plannedOT: 3,
			intervals: interval('10:54:00'),
			percent: null,
			overtime: 0
		},
		{
			name: 'approved full-day leave',
			shift: work,
			explicit: true,
			plannedOT: 0,
			intervals: [],
			percent: 0,
			overtime: 0,
			leave: true
		},
		{
			name: 'pattern baseline',
			shift: work,
			explicit: false,
			plannedOT: null,
			intervals: interval('17:00:00'),
			percent: 100,
			overtime: 0
		},
		{
			name: 'no effective shift',
			shift: null,
			explicit: false,
			plannedOT: null,
			intervals: interval('17:00:00'),
			percent: null,
			overtime: 0
		}
	];
	for (const scenario of cases) {
		const shiftId = fixtureId(`progress-shift-${scenario.name}`);
		const day = buildDays({
			dates: [date],
			people: [person],
			timeZone: 'Asia/Singapore',
			entries: [
				{
					id: nativeId('roster_entry', fixtureId(`progress-day-${scenario.name}`)),
					employment_id: person.id,
					work_date: date,
					shift_definition_id: scenario.explicit ? shiftId : null,
					planned_overtime_hours: scenario.plannedOT,
					worked_intervals: scenario.intervals
				}
			],
			holidays: [],
			leave: scenario.leave
				? [
						{
							employment_id: person.id,
							occurred_on: date,
							days: '1',
							catalog_id: { code: 'ANNUAL', name: 'Annual leave' }
						}
					]
				: [],
			shiftOf: () => scenario.shift
		}).get(dayKey(person.id, date));
		if (day == null) throw new Error(`Missing ${scenario.name}.`);
		expect(day.overtime, scenario.name).toBe(scenario.overtime);
		if (scenario.leave || scenario.shift?.day_type === 'REST') expect(isAbsent(day)).toBe(false);
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(DayCell, { target, props: { day, dense: true } });
		try {
			flushSync();
			const actual = target.querySelector('[data-work-layer="actual"]');
			const progress = actual?.querySelector('[role="progressbar"]');
			expect(actual?.textContent?.replace(/\s+/g, ''), scenario.name).toBe(
				scenario.percent == null
					? scenario.open
						? 'roster.progress_open'
						: '—'
					: `${scenario.percent}%`
			);
			expect(progress?.getAttribute('aria-valuenow') ?? null, scenario.name).toBe(
				scenario.percent == null ? null : String(scenario.percent)
			);
			if (scenario.percent != null) {
				expect(progress?.getAttribute('aria-label')).toBe(
					scenario.explicit ? 'roster.actual_progress' : 'roster.projected_progress'
				);
				expect(progress?.getAttribute('aria-valuetext')).toBeTruthy();
				if (scenario.creditOffsets != null)
					expect(
						[...target.querySelectorAll('[data-credit-interval]')].map((rect) =>
							Number(rect.getAttribute('x'))
						),
						scenario.name
					).toEqual(scenario.creditOffsets);
			}
		} finally {
			await unmount(app);
			target.remove();
		}
	}
});
