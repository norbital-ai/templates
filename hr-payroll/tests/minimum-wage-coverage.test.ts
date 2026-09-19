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
import { accumulatePayslip } from '../src/collections/payroll_runs/lib/accumulate.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { minimumWageCovers, minimumWageIssues } from '../src/lib/payroll/contribution.ts';
import { settingsVersions } from './fixtures/statutory-world.ts';
import { compileExpression } from '../src/lib/expressions/compile.ts';

/** A payslip whose only money is a salary of `base`. */
const accumulationOf = (base: number) => {
	const accumulated = accumulatePayslip({ items: [] });
	return {
		...accumulated,
		reserved: { ...accumulated.reserved, BASE: base }
	};
};

const FLOORED = {
	when: 'base >= 0.0',
	employee: 'round_cent((base < person.wage_floor ? person.wage_floor : base) * 1.0 / 100.0)',
	employer:
		'round_cent((base > 20.0 * minimum_wage(person.company.region) ? 20.0 * minimum_wage(person.company.region) : base) * 4.0 / 100.0)'
};
const scheme = {
	row: {
		id: 'id-BPJS',
		code: 'BPJS',
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [FLOORED],
		assessed_on: 'BASE + OVERTIME + NIGHT_PREMIUM - ABSENCE'
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
		accumulation: accumulationOf(3_000_000),
		contributions: [scheme],
		facts: new Map(),
		yearToDate: () => ({ employee: 0, employer: 0, base: 0 }),
		yearEarned: new Map(),
		period: {
			key: '2026-01',
			start: '2026-01-01',
			end: '2026-01-31',
			index: 1,
			instalments: 1,
			monthlyOn: 'FIRST',
			lastOfYear: false
		},
		year: { start: '2025-01-01', end: '2025-12-31', months_employed: 12 },
		projection: { payslipsRemaining: 12, futurePayslipEquivalents: 0 },
		person: { ...person(employmentType), wage_floor: applies ? 5_729_876 : 0 },
		minimumWage: 5_729_876
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
		work_rules: {
			wages: {
				by_region: { 'DKI Jakarta': 5_729_876 },
				applies_when: 'employment.type != "INTERN"'
			}
		}
	};
	assert.equal(minimumWageCovers({ jurisdiction }, person('PERMANENT')), true);
	assert.equal(minimumWageCovers({ jurisdiction }, person('INTERN')), false);
	assert.equal(
		minimumWageCovers(
			{ jurisdiction: { work_rules: { wages: { by_region: {} } } } },
			person('INTERN')
		),
		true
	);
});

test('a covered person under the wage is a warning on the run; an intern is not', () => {
	const configuration = {
		jurisdiction: {
			work_rules: {
				wages: { by_region: { Malaysia: 1700 }, applies_when: 'employment.type != "INTERN"' }
			}
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

test('a wages order’s rule on the contract’s composition warns like the floor (ID PP 36/2021 art.7(2): basic at least 75%)', () => {
	// The fixed allowance is on the contract; 2,000,000 basic beside a 1,500,000 allowance is
	// 57% basic, under the 75% the rule states; 4,500,000 basic clears it.
	const configuration = {
		jurisdiction: {
			work_rules: {
				wages: {
					by_region: { Jakarta: 1_000_000 },
					terms_when: 'terms.basic_salary >= 0.75 * terms.monthly_wage'
				}
			}
		},
		company: { id: 'co', region: 'Jakarta' },
		catalogueComponents: [
			{ id: 'house', family: 'ALLOWANCE', destination: 'PAY', direction: 'ADD', counts_toward: [] }
		],
		allowanceCodeById: new Map()
	};
	const bundle = (number: string, basic: number) => ({
		employment: {
			id: `e-${number}`,
			employee_number: number,
			effective_range: { start: '2025-01-01', end: null }
		},
		employee: { nationality: 'IDN', date_of_birth: '2000-01-01', children: [] },
		children: [],
		employedDays: { start: '2026-01-01', end: '2026-01-31' },
		deferral: null,
		terms: [],
		payRequests: [],
		termsHistory: [
			{
				id: `t-${number}`,
				employment_type: 'PERMANENT',
				base_salary: { value: basic, currency: 'IDR' },
				allowances: [{ catalogue_id: 'house', amount: 1_500_000 }],
				effective_range: { start: '2025-01-01', end: null }
			}
		]
	});
	const issues = minimumWageIssues({
		configuration,
		asOf: '2026-01-31',
		bundles: [bundle('A', 2_000_000), bundle('B', 4_500_000)]
	} as never);
	assert.deepEqual(
		issues.map((issue) => [issue.code, issue.severity, issue.recordId]),
		[['WAGE_TERMS_RULE', 'WARNING', 't-A']]
	);
	assert.match(issues[0]!.message, /basic 2000000, fixed allowances 1500000/);
	// The ID versions state the rule.
	for (const version of settingsVersions('ID'))
		assert.equal(
			version.work_rules.wages.terms_when,
			'terms.basic_salary >= 0.75 * terms.monthly_wage'
		);
});
