// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A payroll run has two outcomes: payslips, or a refusal that says why.
 *
 * Configuration faults stop the build. Hours-of-work ceilings honor `on_exceed`: WARN is advisory,
 * BLOCK refuses. Daily hours breaches are always warnings — the engine already prices the excess.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	blockers,
	describeIssues,
	validateConfiguration,
	validateDailyOvertimeHoursLimit,
	validateDailyWorkLimit,
	validateOpenWorkDays,
	validateOvertimeLimits,
	validatePayCalendar
} from '../src/collections/payroll_runs/lib/validate.ts';

const DAY_WAGE_RULE = {
	id: 'rule-rest-day-wage',
	authority: 'EA 1955 s.60(3)',
	day_type: 'REST_DAY',
	band: { measure: 'FROM_START_OF_DAY', from_fraction: 0.5, to_fraction: null },
	award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 1 }
};

/** Enough of a configuration for the overtime-completeness pass, and nothing that would add noise. */
const configuration = (overrides = {}) => ({
	jurisdiction: {
		id: 'jur-my',
		code: 'MY',
		proration: { by: 'CALENDAR_DAYS' }
	},
	company: {
		id: 'co-my',
		name: 'Public Fixture Co',
		pay_cutoff_day: 21,
		pay_day: 28,
		pay_calendar: null
	},
	payComponents: [],
	contributions: [],
	treatments: new Map(),
	overtimeRules: [],
	overtimeLimits: [],
	...overrides
});

test('a stated rest-day wage rule needs no pay component behind it', () => {
	/*
	 * There used to be an `OVERTIME_RULE_UNMAPPED` blocker here, because MEASURE paid a priced
	 * segment only if some pay component claimed it and said nothing when none did — a day's wages
	 * the employee worked for and never saw. The check is gone because the hole it guarded is gone:
	 * a segment now becomes a payslip line on its own, so a stated rule pays by construction and
	 * there is no mapping left to omit. This is the assertion that the company catalogue is not
	 * consulted at all: an empty catalogue against a stated ladder is a clean configuration.
	 */
	const issues = validateConfiguration(configuration({ overtimeRules: [DAY_WAGE_RULE] }));
	assert.deepEqual(issues, []);
});

test('an overtime rule with no band can never be entered, and still stops the run', () => {
	// No band means no hour can fall inside it, whatever MEASURE does with the segments it prices.
	const issues = validateConfiguration(
		configuration({ overtimeRules: [{ ...DAY_WAGE_RULE, band: null }] })
	);
	assert.equal(issues.length, 1);
	assert.equal(issues[0].code, 'OVERTIME_RULE_UNBANDED');
	assert.equal(blockers(issues).length, 1);
	assert.equal(issues[0].collection, 'jurisdictions');
	assert.equal(issues[0].recordId, 'jur-my');
});

test('a scheme that has not said what it does with overtime cannot charge it', () => {
	/*
	 * The treatment grid's own rule, applied to the schedule that replaced its overtime row: an
	 * empty position is an undecided scheme, never an exempt one. Reading the silence as EXCLUDE is
	 * the dangerous outcome — an under-contribution nobody notices — so the run refuses instead.
	 */
	const scheme = (overrides) => ({
		row: { id: 'sc-epf', code: 'EPF', sequence: 100, relief_for: [], special_rules: [] },
		rates: [],
		overtimeTreatment: undefined,
		overtimeExcessTreatment: undefined,
		...overrides
	});
	const stated = { authority: 'EPF Act 1991 s.2', treatment: { kind: 'EXCLUDE' } };

	// A bandless scheme raises its own unrelated blocker; this test is about the overtime position.
	const overtimeIssues = (contribution) =>
		validateConfiguration(configuration({ contributions: [contribution] })).filter((issue) =>
			issue.code.startsWith('OVERTIME_TREATMENT')
		);

	const undecided = overtimeIssues(scheme({}));
	assert.equal(undecided.length, 2);
	assert.equal(blockers(undecided).length, 2);
	assert.equal(undecided[0].collection, 'statutory_contributions');
	assert.equal(undecided[0].recordId, 'sc-epf');
	assert.match(undecided[0].message, /EPF states no overtime position/);
	assert.match(undecided[1].message, /EPF states no excess overtime position/);

	// Only the ordinary position decided: the excess one is still a missing decision on its own.
	const half = overtimeIssues(scheme({ overtimeTreatment: stated }));
	assert.equal(half.length, 1);
	assert.match(half[0].message, /no excess overtime position/);

	assert.deepEqual(
		overtimeIssues(scheme({ overtimeTreatment: stated, overtimeExcessTreatment: stated })),
		[]
	);
});

test('an exceeded overtime ceiling honors on_exceed: WARN is advisory, BLOCK refuses', () => {
	const limit = (on_exceed) => ({
		id: `limit-${on_exceed}`,
		period: 'MONTH',
		measures: 'OVERTIME_HOURS',
		max_hours: 104,
		on_exceed,
		authority: 'Employment (Limitation of Overtime Work) Regulations 1980'
	});
	const warned = validateOvertimeLimits({
		configuration: configuration({ overtimeLimits: [limit('WARN')] }),
		employeeNumber: 'PUBEM0023',
		calendarMonth: '2026-03',
		monthHours: 112
	});
	assert.equal(warned.length, 1);
	assert.equal(warned[0].severity, 'WARNING');
	assert.equal(blockers(warned).length, 0);
	assert.match(warned[0].message, /PUBEM0023/);
	assert.match(warned[0].message, /2026-03/);
	assert.match(warned[0].message, /1980/);

	const blocked = validateOvertimeLimits({
		configuration: configuration({ overtimeLimits: [limit('BLOCK')] }),
		employeeNumber: 'PUBEM0023',
		calendarMonth: '2026-03',
		monthHours: 112
	});
	assert.equal(blocked.length, 1);
	assert.equal(blocked[0].severity, 'BLOCKER');
	assert.equal(blockers(blocked).length, 1);
});

test('a total-hours ceiling is not compared against overtime hours', () => {
	// 104 here counts every hour worked, not the overtime among them. Comparing a month's overtime
	// against it would refuse a run that never came near the limit the authority actually set.
	assert.deepEqual(
		validateOvertimeLimits({
			configuration: configuration({
				overtimeLimits: [
					{
						id: 'limit-total',
						period: 'MONTH',
						measures: 'TOTAL_WORK_HOURS',
						max_hours: 104,
						on_exceed: 'BLOCK',
						authority: 'a total-hours ceiling'
					}
				]
			}),
			employeeNumber: 'PUBEM0023',
			calendarMonth: '2026-03',
			monthHours: 200
		}),
		[]
	);
});

test('a ceiling that was not reached raises nothing', () => {
	assert.deepEqual(
		validateOvertimeLimits({
			configuration: configuration({
				overtimeLimits: [
					{
						id: 'limit',
						period: 'MONTH',
						measures: 'OVERTIME_HOURS',
						max_hours: 104,
						on_exceed: 'WARN',
						authority: '1980 Regulations'
					}
				]
			}),
			employeeNumber: 'PUBEM0023',
			calendarMonth: '2026-03',
			monthHours: 104
		}),
		[]
	);
});

test('a day past the hours-of-work limit is a warning that names whose day it was', () => {
	const issues = validateDailyWorkLimit({
		employeeNumber: 'PUBEM0002',
		days: [
			{
				date: '2026-03-10',
				workDayId: 'work-day-1',
				dayType: 'ORDINARY',
				hours: 4.5,
				normalHours: 8,
				totalWorkHours: 13.25
			},
			{
				date: '2026-03-11',
				workDayId: 'work-day-2',
				dayType: 'ORDINARY',
				hours: 2,
				normalHours: 8,
				totalWorkHours: 11
			}
		],
		maxWorkHours: 12
	});
	assert.equal(issues.length, 1, 'only the day over the limit is raised');
	assert.equal(issues[0].severity, 'WARNING');
	assert.equal(blockers(issues).length, 0);
	assert.match(issues[0].message, /PUBEM0002 worked 13\.25 hours on 2026-03-10/);
	assert.equal(issues[0].collection, 'work_days');
	assert.equal(issues[0].recordId, 'work-day-1', 'the issue links to the attendance row to fix');
});

test('a day past the daily overtime-hours ceiling is a warning on ordinary OT only', () => {
	const issues = validateDailyOvertimeHoursLimit({
		employeeNumber: 'VN-0004',
		days: [
			{
				date: '2026-03-10',
				workDayId: 'work-day-1',
				dayType: 'ORDINARY',
				hours: 6,
				normalHours: 8,
				totalWorkHours: 14
			},
			{
				date: '2026-03-15',
				workDayId: 'rest-day-1',
				dayType: 'REST_DAY',
				hours: 8,
				normalHours: 8,
				totalWorkHours: 8
			}
		],
		maxOvertimeHours: 4
	});
	assert.equal(issues.length, 1, 'rest-day overtime is outside this counter');
	assert.equal(issues[0].code, 'DAILY_OVERTIME_LIMIT_EXCEEDED');
	assert.equal(issues[0].severity, 'WARNING');
	assert.equal(blockers(issues).length, 0);
	assert.match(issues[0].message, /VN-0004 worked 6\.00 overtime hours on 2026-03-10/);
	assert.equal(issues[0].recordId, 'work-day-1');
});

test('a cadence the company has written no calendar for stops the run and names the people on it', () => {
	const issues = validatePayCalendar({
		configuration: configuration(),
		bundles: [
			{
				employment: { id: 'emp-1', employee_number: 'PUBEM0009' },
				terms: [{ pay_frequency: 'SEMI_MONTHLY' }]
			},
			{
				employment: { id: 'emp-2', employee_number: 'PUBEM0002' },
				terms: [{ pay_frequency: 'MONTHLY' }]
			}
		]
	});
	assert.equal(issues.length, 1);
	assert.equal(issues[0].code, 'PAY_CALENDAR_CADENCE_UNSTATED');
	assert.match(issues[0].message, /PUBEM0009/);
	assert.doesNotMatch(issues[0].message, /PUBEM0002/, 'a monthly employment is not implicated');
	assert.match(issues[0].message, /SEMI_MONTHLY/);
});

/**
 * The defect this whole check used to be: twelve of twenty-three employments at the Philippine
 * entity are semi-monthly because the law requires payment at least twice a month, and the run
 * refused them for being data the model could not hold. A company that states the cadence's
 * instalments raises nothing — the fault was never in the data.
 */
test('a semi-monthly employment is no fault once the company states that calendar', () => {
	assert.deepEqual(
		validatePayCalendar({
			configuration: configuration({
				company: {
					id: 'co-ph',
					name: 'Public Fixture PH',
					pay_cutoff_day: 21,
					pay_day: 30,
					pay_calendar: [
						{
							pay_frequency: 'SEMI_MONTHLY',
							instalments: [
								{ start_day: 1, end_day: 15, pay_day: 15 },
								{ start_day: 16, end_day: 31, pay_day: 30 }
							]
						}
					]
				}
			}),
			bundles: [
				{
					employment: { id: 'emp-1', employee_number: 'PUBPH0009' },
					terms: [{ pay_frequency: 'SEMI_MONTHLY' }]
				},
				{
					employment: { id: 'emp-2', employee_number: 'PUBPH0002' },
					terms: [{ pay_frequency: 'MONTHLY' }]
				}
			]
		}),
		[]
	);
});

/**
 * A calendar keyed by day of month cannot describe a weekly cycle, so it is not expressible and the
 * refusal stands. This is the check kept from the old one: a company that genuinely cannot pay
 * someone on their stated frequency still stops the run.
 */
test('a cadence no calendar of instalments could describe is still refused', () => {
	const issues = validatePayCalendar({
		configuration: configuration({
			company: {
				id: 'co-ph',
				name: 'Public Fixture PH',
				pay_cutoff_day: 21,
				pay_day: 30,
				pay_calendar: [
					{
						pay_frequency: 'SEMI_MONTHLY',
						instalments: [
							{ start_day: 1, end_day: 15, pay_day: 15 },
							{ start_day: 16, end_day: 31, pay_day: 30 }
						]
					}
				]
			}
		}),
		bundles: [
			{
				employment: { id: 'emp-3', employee_number: 'PUBPH0031' },
				terms: [{ pay_frequency: 'WEEKLY' }]
			}
		]
	});
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /PUBPH0031/);
	assert.match(issues[0].message, /WEEKLY/);
});

test('an all-monthly company raises nothing', () => {
	assert.deepEqual(
		validatePayCalendar({
			configuration: configuration(),
			bundles: [
				{
					employment: { id: 'emp-2', employee_number: 'PUBEM0002' },
					terms: [{ pay_frequency: 'MONTHLY' }, { pay_frequency: null }]
				}
			]
		}),
		[]
	);
});

test('the refusal spells out every issue rather than counting them', () => {
	const issues = [
		{ code: 'DAILY_WORK_LIMIT_EXCEEDED', message: 'PUBEM0002 worked 13.25 hours on 2026-03-10.' },
		{ code: 'OVERTIME_LIMIT_EXCEEDED', message: 'PUBEM0023 worked 112 hours in 2026-03.' }
	];
	const described = describeIssues(issues);
	assert.match(described, /2 things must be fixed first/);
	assert.match(described, /PUBEM0002 worked 13\.25 hours on 2026-03-10/);
	assert.match(described, /PUBEM0023 worked 112 hours in 2026-03/);
	assert.match(described, /DAILY_WORK_LIMIT_EXCEEDED/);
});

test('one issue reads as one issue, and a flood is grouped with an honest count', () => {
	assert.match(
		describeIssues([{ code: 'PRORATION_MISSING', message: 'Jurisdiction MY states no basis.' }]),
		/One thing must be fixed first/
	);
	const many = Array.from({ length: 40 }, (_value, index) => ({
		code: 'DAILY_WORK_LIMIT_EXCEEDED',
		message: `PUBEM${String(index).padStart(4, '0')} worked 13 hours on 2026-03-10.`
	}));
	const described = describeIssues(many);
	assert.match(described, /40 things must be fixed first/);
	assert.match(described, /DAILY_WORK_LIMIT_EXCEEDED \(40\)/);
	assert.match(described, /PUBEM0000/);
	assert.match(described, /and 30 others/);
	assert.match(described, /Worked 13 hours on 2026-03-10/);
	assert.equal(described.split('\n').filter((line) => line.startsWith('•')).length, 1);
});

test('repeated shortfalls share one bullet that names everyone and states the shape once', () => {
	const described = describeIssues(
		['NHPMY0354', 'NHPMY0347', 'NHPMY0325'].map((number) => ({
			code: 'WORKLOAD_BELOW_TERMS',
			message:
				`The pay window assigns 0 work day(s) and 0 paid minute(s) for ${number}, ` +
				'below the employment terms of 27 day(s) and 11958 minute(s).'
		}))
	);
	assert.match(described, /3 things must be fixed first/);
	assert.match(described, /WORKLOAD_BELOW_TERMS \(3\)/);
	assert.match(described, /NHPMY0354, NHPMY0347, NHPMY0325/);
	assert.match(described, /below the employment terms of 27 day\(s\) and 11958 minute\(s\)/);
	assert.equal(described.split('\n').filter((line) => line.startsWith('•')).length, 1);
});

/*
 * An open clock stops the run, and every one of them is named in the same refusal.
 *
 * The engine used to `find` the first unclosed entry and throw on it, which meant a month with
 * thirty-six of them — an ordinary month, people forget to clock out — took thirty-six builds to
 * enumerate. A typical month of forgotten clock-outs is exactly that shape.
 */
const openBundle = (employeeNumber, days) => ({
	employment: { employee_number: employeeNumber },
	workDays: days
});

test('every unclosed clock is reported, not just the first', () => {
	const issues = validateOpenWorkDays({
		bundles: [
			openBundle('PUBEM0193', [
				{
					id: 'wd-1',
					work_date: '2026-01-15',
					worked_intervals: [{ start: '2026-01-15T01:00:00.000Z', end: null }]
				},
				{
					id: 'wd-2',
					work_date: '2026-01-16',
					worked_intervals: [{ start: '2026-01-16T01:00:00.000Z', end: '2026-01-16T09:00:00.000Z' }]
				}
			]),
			openBundle('PUBEM0271', [
				{
					id: 'wd-3',
					work_date: '2025-12-27',
					worked_intervals: [{ start: null, end: '2025-12-27T09:00:00.000Z' }]
				}
			])
		]
	});
	assert.equal(issues.length, 2);
	assert.deepEqual(
		issues.map((issue) => issue.recordId),
		['wd-1', 'wd-3']
	);
	// A blocker, exactly as hard as the throw it replaced: this reports, it does not forgive.
	assert.equal(blockers(issues).length, 2);
	for (const issue of issues) {
		assert.equal(issue.code, 'WORK_DAY_OPEN');
		assert.equal(issue.collection, 'work_days');
	}
	// The employee, not only the date — dozens of people clock on any given day.
	assert.match(issues[0].message, /PUBEM0193 has an unclosed clock on 2026-01-15/);
	// A clock-out with no clock-in is just as unpriceable as a clock that never stopped.
	assert.match(issues[1].message, /PUBEM0271 has an unclosed clock on 2025-12-27/);
});

test('closed attendance raises nothing, and a null interval list is not an open clock', () => {
	// `worked_intervals: null` is the presence test for the actual half of a work day: it says no
	// attendance was recorded at all, which is a plan rather than a clock that is still running.
	// Claiming it here would report the wrong thing to fix.
	const issues = validateOpenWorkDays({
		bundles: [
			openBundle('PUBEM0001', [
				{
					id: 'wd-4',
					work_date: '2026-01-05',
					worked_intervals: [{ start: '2026-01-05T01:00:00.000Z', end: '2026-01-05T09:00:00.000Z' }]
				},
				{ id: 'wd-5', work_date: '2026-01-06', worked_intervals: null }
			])
		]
	});
	assert.deepEqual(issues, []);
});
