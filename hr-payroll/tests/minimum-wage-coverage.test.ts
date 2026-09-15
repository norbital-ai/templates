// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Minimum wage coverage: `wages.applies_when` says who the wages order covers. A person outside it
 * reads `wage_floor` as 0 in a scheme rule, so a base floored at the minimum wage is not floored;
 * `minimum_wage(region)` still states the table for the ceilings that read it. A covered person
 * contracted below the wage is a warning on the run, an intern is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { contribute } from '../src/collections/payroll_runs/lib/contribute.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { minimumWageCovers, minimumWageIssues } from '../src/lib/payroll/contribution.ts';
import { compileExpression } from '../src/lib/expressions/compile.ts';

const FLOORED = {
	when: 'base >= 0.0',
	employee: 'round_cent((base < wage_floor ? wage_floor : base) * 1.0 / 100.0)',
	employer:
		'round_cent((base > 20.0 * minimum_wage(region) ? 20.0 * minimum_wage(region) : base) * 4.0 / 100.0)'
};
const scheme = {
	row: {
		id: 'id-BPJS',
		code: 'BPJS',
		assessment_period: 'PAY_PERIOD',
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [FLOORED],
		base: { salary: true, absence: true, overtime: true, night_premium: true, entries: [] }
	},
	rules: [FLOORED]
};
const person = (employmentType: string) =>
	personContext({
		employee: { nationality: 'IDN', date_of_birth: '1990-01-01' },
		employment: { service_start: '2025-01-01' },
		terms: { employment_type: employmentType, base_salary: { value: 3_000_000, currency: 'IDR' } },
		company: { region: 'DKI Jakarta' },
		asOf: '2026-01-31'
	});
const charge = (employmentType: string, applies: boolean) =>
	contribute({
		bases: [{ contribution: scheme, base: 3_000_000, lines: [] }],
		facts: new Map(),
		yearToDate: () => ({ employee: 0, employer: 0, base: 0 }),
		age: 36,
		headcount: 10,
		riskClass: null,
		projection: { payslipsRemaining: 12, futurePayslipEquivalents: 0 },
		person: person(employmentType),
		minimumWage: 5_729_876,
		minimumWageApplies: applies
	})[0];

test('the floor reads the minimum wage for a covered person and 0 for one the order excludes', () => {
	const covered = charge('PERMANENT', true);
	assert.equal(covered.employee, 57298.76, '1% of the floored base 5,729,876');
	const intern = charge('INTERN', false);
	assert.equal(intern.employee, 30000, '1% of the unfloored 3,000,000');
	// The ceiling still reads the table for both.
	assert.equal(covered.employer, 120000);
	assert.equal(intern.employer, 120000);
});

test('the coverage predicate compiles over the person and empty covers everyone', () => {
	assert.equal(
		compileExpression({
			expression: 'employment.type != "INTERN"',
			site: 'person',
			type: 'boolean'
		}),
		null
	);
	const jurisdiction = {
		wages: { by_region: { 'DKI Jakarta': 5_729_876 }, applies_when: 'employment.type != "INTERN"' }
	};
	assert.equal(minimumWageCovers({ jurisdiction }, person('PERMANENT')), true);
	assert.equal(minimumWageCovers({ jurisdiction }, person('INTERN')), false);
	assert.equal(
		minimumWageCovers({ jurisdiction: { wages: { by_region: {} } } }, person('INTERN')),
		true
	);
});

test('a covered person under the wage is a warning on the run; an intern is not', () => {
	const configuration = {
		jurisdiction: {
			wages: { by_region: { Malaysia: 1700 }, applies_when: 'employment.type != "INTERN"' }
		},
		company: { id: 'co', region: 'Malaysia' }
	};
	const bundle = (number: string, employmentType: string, basic: number) => ({
		employment: {
			id: `e-${number}`,
			employee_number: number,
			effective_range: { start: '2025-01-01', end: null }
		},
		employee: { nationality: 'MAL', date_of_birth: '2000-01-01', children: [] },
		children: [],
		employedDays: { start: '2026-01-01', end: '2026-01-31' },
		deferral: null,
		terms: [],
		payRequests: [],
		termsHistory: [
			{
				id: `t-${number}`,
				employment_type: employmentType,
				base_salary: { value: basic, currency: 'MYR' },
				effective_range: { start: '2025-01-01', end: null }
			}
		]
	});
	const issues = minimumWageIssues({
		configuration,
		asOf: '2026-01-31',
		bundles: [
			bundle('A', 'PERMANENT', 1500),
			bundle('B', 'INTERN', 900),
			bundle('C', 'PERMANENT', 1700)
		]
	});
	assert.deepEqual(
		issues.map((issue) => [issue.code, issue.severity, issue.recordId]),
		[['MINIMUM_WAGE_BELOW', 'WARNING', 't-A']]
	);
	assert.match(
		issues[0].message,
		/A is contracted at 1500 a month, below the Malaysia minimum wage of 1700/
	);
});
