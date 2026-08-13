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
	validateDailyWorkLimit,
	validateOvertimeLimits,
	validatePayCalendar
} from './lib/validate.ts';

const DAY_WAGE_RULE = {
	norbital_id: 'rule-rest-day-wage',
	authority: 'EA 1955 s.60(3)',
	day_type: 'REST_DAY',
	band: { measure: 'FROM_START_OF_DAY', from_fraction: 0.5, to_fraction: null },
	award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 1 }
};

/** Enough of a configuration for the overtime-completeness pass, and nothing that would add noise. */
const configuration = (overrides = {}) => ({
	jurisdiction: {
		norbital_id: 'jur-my',
		code: 'MY',
		proration: { by: 'CALENDAR_DAYS' }
	},
	company: {
		norbital_id: 'co-my',
		name: 'Nihon (MY)',
		pay_cutoff_day: 21
	},
	payComponents: [],
	contributions: [],
	treatments: new Map(),
	overtimeRules: [],
	overtimeLimits: [],
	...overrides
});

test('an unmapped rest-day wage rule stops the run instead of quietly going unpaid', () => {
	/*
	 * This was the one warning with a written excuse: a day-wage rule was called unreachable "while
	 * the hourly reading is in force". It is reachable — `priceDay` awards the highest day-wage band
	 * a rest day entered — and `measure` pays a segment only if some pay component claims it, with
	 * no complaint when none does. An unmapped rule is a day's wages the employee never sees.
	 */
	const issues = validateConfiguration(configuration({ overtimeRules: [DAY_WAGE_RULE] }));
	const unmapped = issues.filter((issue) => issue.code === 'OVERTIME_RULE_UNMAPPED');
	assert.equal(unmapped.length, 1);
	assert.match(unmapped[0].message, /REST_DAY FROM_START_OF_DAY/);
	assert.match(unmapped[0].message, /would be unpaid/);
	assert.equal(unmapped[0].collection, 'jurisdictions');
	assert.equal(unmapped[0].recordId, 'jur-my');
});

test('a mapped rule raises nothing, so an ordinary company still builds', () => {
	const issues = validateConfiguration(
		configuration({
			overtimeRules: [DAY_WAGE_RULE],
			payComponents: [
				{
					norbital_id: 'pc-rest-day',
					code: 'OT_REST_DAY',
					nature: 'EARNING',
					definition: {
						source: 'OVERTIME',
						rule: { day_type: 'REST_DAY', measure: 'FROM_START_OF_DAY', band_from: 0.5 }
					}
				}
			]
		})
	);
	assert.deepEqual(issues, []);
});

test('an exceeded overtime ceiling honors on_exceed: WARN is advisory, BLOCK refuses', () => {
	const limit = (on_exceed) => ({
		norbital_id: `limit-${on_exceed}`,
		period: 'MONTH',
		measures: 'OVERTIME_HOURS',
		max_hours: 104,
		on_exceed,
		authority: 'Employment (Limitation of Overtime Work) Regulations 1980'
	});
	const warned = validateOvertimeLimits({
		configuration: configuration({ overtimeLimits: [limit('WARN')] }),
		employeeNumber: 'NHPMY0023',
		calendarMonth: '2026-03',
		monthHours: 112
	});
	assert.equal(warned.length, 1);
	assert.equal(warned[0].severity, 'WARNING');
	assert.equal(blockers(warned).length, 0);
	assert.match(warned[0].message, /NHPMY0023/);
	assert.match(warned[0].message, /2026-03/);
	assert.match(warned[0].message, /1980/);

	const blocked = validateOvertimeLimits({
		configuration: configuration({ overtimeLimits: [limit('BLOCK')] }),
		employeeNumber: 'NHPMY0023',
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
						norbital_id: 'limit-total',
						period: 'MONTH',
						measures: 'TOTAL_WORK_HOURS',
						max_hours: 104,
						on_exceed: 'BLOCK',
						authority: 'a total-hours ceiling'
					}
				]
			}),
			employeeNumber: 'NHPMY0023',
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
						norbital_id: 'limit',
						period: 'MONTH',
						measures: 'OVERTIME_HOURS',
						max_hours: 104,
						on_exceed: 'WARN',
						authority: '1980 Regulations'
					}
				]
			}),
			employeeNumber: 'NHPMY0023',
			calendarMonth: '2026-03',
			monthHours: 104
		}),
		[]
	);
});

test('a day past the hours-of-work limit is a warning that names whose day it was', () => {
	const issues = validateDailyWorkLimit({
		employeeNumber: 'NHPMY0002',
		days: [
			{
				date: '2026-03-10',
				timeEntryId: 'time-entry-1',
				dayType: 'ORDINARY',
				hours: 4.5,
				normalHours: 8,
				totalWorkHours: 13.25
			},
			{
				date: '2026-03-11',
				timeEntryId: 'time-entry-2',
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
	assert.match(issues[0].message, /NHPMY0002 worked 13\.25 hours on 2026-03-10/);
	assert.equal(issues[0].collection, 'time_entries');
	assert.equal(issues[0].recordId, 'time-entry-1', 'the issue links to the attendance row to fix');
});

test('a cadence the company calendar cannot express stops the run and names the people on it', () => {
	const issues = validatePayCalendar({
		configuration: configuration(),
		bundles: [
			{
				employment: { norbital_id: 'emp-1', employee_number: 'NHPMY0009' },
				terms: [{ pay_frequency: 'SEMI_MONTHLY' }]
			},
			{
				employment: { norbital_id: 'emp-2', employee_number: 'NHPMY0002' },
				terms: [{ pay_frequency: 'MONTHLY' }]
			}
		]
	});
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /NHPMY0009/);
	assert.doesNotMatch(issues[0].message, /NHPMY0002/, 'a monthly employment is not implicated');
	assert.match(issues[0].message, /SEMI_MONTHLY/);
});

test('an all-monthly company raises nothing', () => {
	assert.deepEqual(
		validatePayCalendar({
			configuration: configuration(),
			bundles: [
				{
					employment: { norbital_id: 'emp-2', employee_number: 'NHPMY0002' },
					terms: [{ pay_frequency: 'MONTHLY' }, { pay_frequency: null }]
				}
			]
		}),
		[]
	);
});

test('the refusal spells out every issue rather than counting them', () => {
	const issues = [
		{ code: 'DAILY_WORK_LIMIT_EXCEEDED', message: 'NHPMY0002 worked 13.25 hours on 2026-03-10.' },
		{ code: 'OVERTIME_LIMIT_EXCEEDED', message: 'NHPMY0023 worked 112 hours in 2026-03.' }
	];
	const described = describeIssues(issues);
	assert.match(described, /2 things must be fixed first/);
	assert.match(described, /NHPMY0002 worked 13\.25 hours on 2026-03-10/);
	assert.match(described, /NHPMY0023 worked 112 hours in 2026-03/);
	assert.match(described, /DAILY_WORK_LIMIT_EXCEEDED/);
});

test('one issue reads as one issue, and a flood is capped with an honest count', () => {
	assert.match(
		describeIssues([{ code: 'PRORATION_MISSING', message: 'Jurisdiction MY states no basis.' }]),
		/One thing must be fixed first/
	);
	const many = Array.from({ length: 40 }, (_value, index) => ({
		code: 'DAILY_WORK_LIMIT_EXCEEDED',
		message: `NHPMY${String(index).padStart(4, '0')} worked 13 hours on 2026-03-10.`
	}));
	const described = describeIssues(many);
	assert.match(described, /40 things must be fixed first/);
	assert.match(described, /and 15 more of the same kinds/);
	assert.equal(described.split('\n').filter((line) => line.startsWith('•')).length, 25);
});
