/**
 * A rostered guarantee is measured over the window an employment is actually paid for, in whole
 * days, and a holiday or company-off day is not a day the schedule could have used.
 *
 * NHPMY0325 on staging: a leaver on `6 days / 2700 minutes a week`, paid over 21 Dec → 29 Jan
 * (40 days), rostered 33 work days with one OFF day. `6 × 40 / 7 = 34.29` rounded up to 35 refused
 * the whole company's January run for a day nobody owed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	rosteredWorkCodeMaps,
	validateRosteredExpectations
} from '../src/collections/payroll_runs/lib/validate.ts';

const codes = [
	{
		id: 'work',
		variant: { kind: 'WORK', start_time: '08:30', end_time: '17:00', break_minutes: 60 }
	},
	{ id: 'rest', variant: { kind: 'REST' } },
	{ id: 'off', variant: { kind: 'OFF' } }
] as const;

const day = (offset: number): string =>
	new Date(Date.parse('2025-12-21T00:00:00.000Z') + offset * 86_400_000).toISOString().slice(0, 10);

test('a six-day roster with one holiday meets a 6-days-a-week guarantee over a leaver window', () => {
	// 40 dates: a REST every seventh day, one OFF on 23 Jan, the last date (29 Jan) unrostered.
	const workDays = Array.from({ length: 39 }, (_, offset) => ({
		work_date: `${day(offset)}T00:00:00.000Z`,
		shift_definition_id: day(offset) === '2026-01-23' ? 'off' : offset % 7 === 6 ? 'rest' : 'work'
	}));
	const worked = workDays.filter((row) => row.shift_definition_id === 'work').length;
	assert.equal(worked, 33);
	const issues = validateRosteredExpectations({
		period: '2026-01',
		window: { start: '2025-12-21', end: '2026-01-20' },
		employments: [
			{
				id: 'e1',
				employee_number: 'NHPMY0325',
				window: { start: '2025-12-21', end: '2026-01-29' },
				terms: [
					{
						id: 't1',
						pay_frequency: 'MONTHLY',
						work_pattern: {
							expectation: {
								kind: 'GUARANTEED_SCHEDULE',
								days_per_week: 6,
								paid_minutes_per_week: 2700
							}
						},
						effective_range: { start: '2023-05-15T00:00:00.000Z', end: '2026-01-28T23:59:59.999Z' }
					}
				],
				workDays
			}
		],
		...rosteredWorkCodeMaps(codes)
	});
	assert.deepEqual(issues, []);
});

test('a roster genuinely short of the guarantee warns, and the run proceeds', () => {
	const workDays = Array.from({ length: 28 }, (_, offset) => ({
		work_date: `${day(offset)}T00:00:00.000Z`,
		shift_definition_id: offset % 7 >= 5 ? 'rest' : 'work' // five-day weeks against a six-day promise
	}));
	const issues = validateRosteredExpectations({
		period: '2026-01',
		window: { start: '2025-12-21', end: '2026-01-17' },
		employments: [
			{
				id: 'e1',
				employee_number: 'X',
				terms: [
					{
						id: 't1',
						pay_frequency: 'MONTHLY',
						work_pattern: {
							expectation: {
								kind: 'GUARANTEED_SCHEDULE',
								days_per_week: 6,
								paid_minutes_per_week: 2700
							}
						},
						effective_range: { start: '2023-05-15T00:00:00.000Z', end: '9999-12-31T00:00:00.000Z' }
					}
				],
				workDays
			}
		],
		...rosteredWorkCodeMaps(codes)
	});
	assert.equal(issues.length, 1);
	assert.equal(issues[0].code, 'WORKLOAD_BELOW_TERMS');
	assert.equal(issues[0].severity, 'WARNING');
	assert.match(issues[0].message, /20 work day\(s\).*below the employment terms of 24 day\(s\)/);
});

test('a public holiday inside the window meets the guarantee as a paid day', () => {
	// Four six-day weeks with two Thursdays coded REST for the holidays the calendar names:
	// 22 rostered work days and two holidays are the 24 the guarantee owes.
	const holidays = new Set(['2025-12-25', '2026-01-01']);
	const workDays = Array.from({ length: 28 }, (_, offset) => ({
		work_date: `${day(offset)}T00:00:00.000Z`,
		shift_definition_id: offset % 7 === 6 || holidays.has(day(offset)) ? 'rest' : 'work'
	}));
	const employments = [
		{
			id: 'e1',
			employee_number: 'X',
			terms: [
				{
					id: 't1',
					pay_frequency: 'MONTHLY',
					work_pattern: {
						expectation: {
							kind: 'GUARANTEED_SCHEDULE',
							days_per_week: 6,
							paid_minutes_per_week: 2700
						}
					},
					effective_range: { start: '2023-05-15T00:00:00.000Z', end: '9999-12-31T00:00:00.000Z' }
				}
			],
			workDays
		}
	];
	const window = { start: '2025-12-21', end: '2026-01-17' };
	assert.equal(
		validateRosteredExpectations({
			period: '2026-01',
			window,
			employments,
			...rosteredWorkCodeMaps(codes)
		}).length,
		1
	);
	assert.deepEqual(
		validateRosteredExpectations({
			period: '2026-01',
			window,
			employments,
			holidayDates: holidays,
			...rosteredWorkCodeMaps(codes)
		}),
		[]
	);
});
