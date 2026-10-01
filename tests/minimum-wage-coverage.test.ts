// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Minimum wage coverage: `wages.applies_when` says who the wages order covers. A person outside it
 * reads `wage_floor` as 0 in a scheme rule, so a base floored at the minimum wage is not floored;
 * `minimum_wage(region)` still states the table for the ceilings that read it. A covered person
 * contracted below the wage is a warning on the run, an intern is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { contribute } from '../src/lib/payroll/run/contribute.ts';
import { accumulatePayslip } from '../src/lib/payroll/run/accumulate.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import {
	minimumWageCovers,
	minimumWageIssues,
	personWageFloor,
	windowMinimumWage
} from '../src/lib/payroll/contribution.ts';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';
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
	employee:
		'round((base < person.wage_floor ? person.wage_floor : base) * 1.0 / 100.0, 0.01, "HALF_UP")',
	employer:
		'round((base > 20.0 * minimum_wage(person.company.region) ? 20.0 * minimum_wage(person.company.region) : base) * 4.0 / 100.0, 0.01, "HALF_UP")'
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
		terms: { employment_type: employmentType, base_salary: 3_000_000, currency: 'IDR' },
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

test('workplace-keyed wage floors require a known locality or a declared province-wide order', () => {
	const configuration = {
		company: { region: 'Provinsi Bali' },
		jurisdiction: {
			jurisdiction_code: 'ID',
			work_rules: {
				wages: {
					by_region: {
						'Provinsi Bali': 3_000_000,
						'Provinsi Bali/Kabupaten Badung': 3_500_000,
						'Provinsi Bali/Kabupaten Bangli': 3_000_000,
						'Provinsi DKI Jakarta': 5_700_000
					},
					workplace_keyed: true,
					standalone_workplaces: ['Provinsi DKI Jakarta']
				}
			}
		}
	};
	const at = (worksite: string) =>
		personContext({
			employee: { nationality: 'IDN', date_of_birth: '1990-01-01' },
			employment: { service_start: '2025-01-01' },
			terms: { employment_type: 'PERMANENT', base_salary: 6_000_000, currency: 'IDR', worksite },
			asOf: '2026-01-31'
		});
	assert.equal(personWageFloor(configuration, at('Provinsi Bali/Kabupaten Badung')), 3_500_000);
	assert.equal(personWageFloor(configuration, at('Kabupaten Bangli')), 3_000_000);
	assert.equal(personWageFloor(configuration, at('Provinsi DKI Jakarta')), 5_700_000);
	assert.throws(
		() => personWageFloor(configuration, at('Provinsi Bali/Kabupaten Unknown')),
		/No sealed minimum-wage rate/
	);
	assert.throws(
		() => personWageFloor(configuration, at('Provinsi Bali')),
		/No sealed minimum-wage rate/
	);
});

test('a mid-month worksite change refuses without an approved monthly floor basis', () => {
	const configuration = {
		company: { region: 'Provinsi Bali' },
		jurisdiction: {
			id: 'id-version',
			jurisdiction_code: 'ID',
			code: 'ID',
			work_rules: {
				wages: {
					by_region: {
						'Provinsi Bali/Kabupaten Badung': 3_500_000,
						'Provinsi Bali/Kabupaten Bangli': 3_000_000
					},
					workplace_keyed: true
				}
			}
		},
		lineageVersions: []
	};
	const termsHistory = [
		{
			worksite: 'Provinsi Bali/Kabupaten Badung',
			effective_range: { start: '2026-01-01', end: '2026-01-16' }
		},
		{
			worksite: 'Provinsi Bali/Kabupaten Bangli',
			effective_range: { start: '2026-01-16', end: null }
		}
	];
	assert.throws(
		() =>
			windowMinimumWage(configuration, { start: '2026-01-01', end: '2026-01-31' }, termsHistory),
		/A workplace or wage class change inside one pay window/
	);
});

test('a sector class change across editions inside a pay month refuses even at one worksite', () => {
	const configuration = {
		company: { region: 'Provinsi DKI Jakarta' },
		jurisdiction: {
			id: 'id-version',
			jurisdiction_code: 'ID',
			code: 'ID',
			work_rules: {
				wages: {
					by_region: { 'Provinsi DKI Jakarta': 5_700_000 },
					workplace_keyed: true,
					standalone_workplaces: ['Provinsi DKI Jakarta'],
					sector_code_pattern: '^[0-9]{5}$',
					sector_editions: ['2020', '2025'],
					sector_edition: '2020',
					sector_edition_from: '2025-12-18',
					sector_edition_map: { '10120': '10130' }
				}
			}
		},
		lineageVersions: []
	};
	const termsHistory = [
		{
			worksite: 'Provinsi DKI Jakarta',
			worksite_sector: '62019',
			facts: { worksite_sector_edition: '2020' },
			effective_range: { start: '2026-01-01', end: '2026-01-16' }
		},
		{
			worksite: 'Provinsi DKI Jakarta',
			worksite_sector: '10120',
			facts: { worksite_sector_edition: '2025' },
			effective_range: { start: '2026-01-16', end: null }
		}
	];
	assert.throws(
		() =>
			windowMinimumWage(configuration, { start: '2026-01-01', end: '2026-01-31' }, termsHistory),
		/A workplace or wage class change inside one pay window/
	);
});

test('a pay window with no sealed governing version refuses instead of borrowing its successor', () => {
	const version = {
		id: 'id-successor',
		code: 'ID',
		jurisdiction_code: 'ID',
		sealed_at: '2026-01-15',
		voided_at: null,
		approval_id: null,
		effective_range: { from: '2026-01-16', to: null },
		work_rules: {
			wages: {
				by_region: { 'Provinsi DKI Jakarta': 5_700_000 },
				workplace_keyed: true,
				standalone_workplaces: ['Provinsi DKI Jakarta']
			}
		}
	};
	const configuration = {
		company: { region: 'Provinsi DKI Jakarta' },
		jurisdiction: version,
		lineageVersions: [version]
	};
	const termsHistory = [
		{ worksite: 'Provinsi DKI Jakarta', effective_range: { start: '2025-01-01', end: null } }
	];
	assert.throws(
		() =>
			windowMinimumWage(configuration, { start: '2026-01-01', end: '2026-01-31' }, termsHistory),
		/No sealed ID settings version governs 2026-01-01/
	);
});

test('a domestic wage order uses its region even when the company has a sector wage key', () => {
	const configuration = {
		company: { region: 'NCR-AGRI-SMALL' },
		jurisdiction: {
			jurisdiction_code: 'PH',
			work_rules: {
				wages: {
					by_region: { NCR: 18_000, 'NCR-AGRI-SMALL': 16_000 },
					by_employment_type: { DOMESTIC: { NCR: 7_800 } }
				}
			}
		}
	};
	const domestic = personContext({
		employee: { nationality: 'PHL', date_of_birth: '1990-01-01' },
		employment: { service_start: '2025-01-01' },
		terms: { employment_type: 'DOMESTIC', base_salary: 8_000, currency: 'PHP' },
		asOf: '2026-10-31'
	});
	assert.equal(personWageFloor(configuration, domestic), 7_800);
	assert.equal(
		windowMinimumWage(
			{
				...configuration,
				jurisdiction: { ...configuration.jurisdiction, id: 'ph-version', code: 'PH' },
				lineageVersions: []
			},
			{ start: '2026-10-01', end: '2026-10-31' },
			[{ employment_type: 'DOMESTIC', effective_range: { start: '2025-01-01', end: null } }]
		),
		7_800
	);
});

test('Malaysian piece remuneration cannot pass a monthly floor from contract basic alone', () => {
	const configuration = {
		jurisdiction: {
			jurisdiction_code: 'MY',
			work_rules: {
				wages: {
					by_region: { Malaysia: 1_700 },
					block_unmeasured_results_pay: true,
					block_below_when: 'true'
				}
			}
		},
		company: { id: 'co', region: 'Malaysia' },
		lineageVersions: [],
		catalogueComponents: [],
		allowanceCodeById: new Map()
	};
	const bundle = {
		employment: {
			id: 'e-1',
			employee_number: 'MY-1',
			effective_range: { start: '2025-01-01', end: null }
		},
		employee: { nationality: 'MAL', date_of_birth: '1990-01-01', children: [] },
		children: [],
		employedDays: { start: '2026-01-01', end: '2026-01-31' },
		deferral: null,
		terms: [],
		payRequests: [],
		termsHistory: [
			{
				id: 't-1',
				employment_type: 'PERMANENT',
				statutory_work_category: 'PIECE_RATE',
				base_salary: 0,
				currency: 'MYR',
				effective_range: { start: '2025-01-01', end: null }
			}
		]
	};
	assert.throws(
		() => minimumWageIssues({ configuration, bundles: [bundle], asOf: '2026-01-31' }),
		/cannot be verified against the monthly minimum wage of /
	);
});

test('Indonesia compares basic plus fixed allowances with the monthly floor', () => {
	const configuration = {
		jurisdiction: {
			id: 'id-wages',
			code: 'ID',
			jurisdiction_code: 'ID',
			work_rules: {
				wages: {
					by_region: { 'Provinsi DKI Jakarta': 4_500_000 },
					workplace_keyed: true,
					standalone_workplaces: ['Provinsi DKI Jakarta'],
					floor_includes_fixed_allowances: true,
					terms_when:
						'terms.monthly_basic >= 0.75 * (terms.monthly_basic + terms.fixed_allowances)',
					block_terms_when: true,
					block_below_when: 'true'
				}
			}
		},
		company: { id: 'co', region: 'Provinsi DKI Jakarta' },
		lineageVersions: [],
		catalogueComponents: [
			{ id: 'fixed', code: 'FIXED', family: 'ALLOWANCE', destination: 'PAY', direction: 'ADD' }
		],
		allowanceCodeById: new Map([['fixed', 'FIXED']])
	};
	const bundle = (allowance: number) => ({
		employment: {
			id: 'id-1',
			employee_number: 'ID-1',
			// Hired inside the window: the seeded ID contract rules read the PP 36/2021 wage scale
			// from a year of service; this case declares none and is about the allowance.
			effective_range: { start: '2026-01-01', end: null }
		},
		employee: { nationality: 'IDN', date_of_birth: '1990-01-01', children: [] },
		children: [],
		employedDays: { start: '2026-01-01', end: '2026-01-31' },
		deferral: null,
		terms: [],
		payRequests: [],
		termsHistory: [
			{
				id: 'terms-1',
				employment_type: 'PERMANENT',
				base_salary: 3_700_000,
				currency: 'IDR',
				pay_frequency: 'MONTHLY',
				worksite: 'Provinsi DKI Jakarta',
				allowances: [{ catalogue_id: 'fixed', amount: allowance }],
				effective_range: { start: '2025-01-01', end: null }
			}
		]
	});
	const issues = (allowance: number) =>
		minimumWageIssues({
			configuration,
			bundles: [bundle(allowance)],
			asOf: '2026-01-31'
		});
	assert.deepEqual(issues(1_000_000), []);
	assert.deepEqual(
		issues(500_000).map((issue) => [issue.code, issue.severity]),
		[['MINIMUM_WAGE_BELOW', 'BLOCKER']]
	);
});

test('a covered person under the wage is a warning on the run; an intern is not', () => {
	const configuration = {
		jurisdiction: {
			work_rules: {
				wages: { by_region: { Malaysia: 1700 }, applies_when: 'employment.type != "INTERN"' }
			}
		},
		company: { id: 'co', region: 'Malaysia' },
		lineageVersions: []
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
				base_salary: basic,
				currency: 'MYR',
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

test('PH daily apprentice at exactly 75% of each NCR floor has no rounding warning', () => {
	// RA 12063 s.13(b): NCR-26 ₱695 and NCR-28 ₱755 daily floors.
	for (const [period, floor] of [
		['2025-12', 695],
		['2026-10', 755]
	]) {
		const exact = floor * 0.75;
		const result = buildStatutory({
			code: 'PH',
			period,
			region: 'NCR',
			people: [
				{
					key: 'APP-BELOW',
					wage: exact - 0.01,
					pay_frequency: 'DAILY',
					employment_type: 'APPRENTICE'
				},
				{ key: 'APP-EXACT', wage: exact, pay_frequency: 'DAILY', employment_type: 'APPRENTICE' },
				{
					key: 'APP-ABOVE',
					wage: exact + 0.01,
					pay_frequency: 'DAILY',
					employment_type: 'APPRENTICE'
				},
				{ key: 'ORDINARY', wage: exact, pay_frequency: 'DAILY', employment_type: 'PERMANENT' }
			]
		});
		// December 2025 spans four versions with one NCR floor: one warning each, not one a version.
		assert.deepEqual(
			result.warnings
				.filter((warning) => warning.startsWith('MINIMUM_WAGE_BELOW:'))
				.map((warning) => warning.split(' ')[1]),
			['APP-BELOW', 'ORDINARY'],
			period
		);
	}
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
		allowanceCodeById: new Map(),
		lineageVersions: []
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
				base_salary: basic,
				currency: 'IDR',
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
	for (const version of settingsVersions('ID')) {
		assert.equal(
			version.work_rules.wages.terms_when,
			'terms.monthly_basic >= 0.75 * (terms.monthly_basic + terms.fixed_allowances)'
		);
		assert.deepEqual(
			version.work_rules.wages.contract_rules.map((rule: { key: string }) => rule.key),
			['wage_scale_recorded', 'wage_scale_minimum', 'output_wage_valued']
		);
		assert.equal(version.work_rules.wages.hourly_floor.from_monthly_divisor, 126);
	}
});

test('an Indonesian sector condition requires an explicit company classification', () => {
	const configuration = {
		jurisdiction: {
			jurisdiction_code: 'ID',
			facts: [
				{ key: 'umsp_hotel_star', type: 'number', label: 'Hotel star class', default_value: 0 }
			],
			work_rules: {
				wages: {
					by_region: { 'Provinsi Bali/Kabupaten Badung': 3_500_000 },
					workplace_keyed: true,
					sector_code_pattern: '^[0-9]{5}$',
					sector_editions: ['2020', '2025'],
					sector_edition: '2020',
					monthly_by_sector: [
						{
							place: 'Provinsi Bali/Kabupaten Badung',
							sector_codes: ['55110'],
							when: 'company.facts.umsp_hotel_star >= 4',
							amount: 3_800_000
						}
					]
				}
			}
		},
		company: { id: 'co', region: 'Provinsi Bali/Kabupaten Badung', facts: {} },
		recordedCompanyFacts: {},
		companyFactRevisions: [],
		catalogueComponents: [],
		allowanceCodeById: new Map(),
		lineageVersions: []
	};
	const bundle = {
		employment: {
			id: 'e-1',
			employee_number: 'ID-1',
			effective_range: { start: '2025-01-01', end: null }
		},
		employee: { nationality: 'IDN', date_of_birth: '1990-01-01', children: [] },
		children: [],
		employedDays: { start: '2026-01-01', end: '2026-01-31' },
		deferral: null,
		terms: [],
		payRequests: [],
		termsHistory: [
			{
				id: 't-1',
				employment_type: 'PERMANENT',
				base_salary: 3_600_000,
				currency: 'IDR',
				worksite: 'Provinsi Bali/Kabupaten Badung',
				worksite_sector: '55110',
				facts: { worksite_sector_edition: '2020' },
				effective_range: { start: '2025-01-01', end: null }
			}
		]
	};
	assert.throws(
		() => minimumWageIssues({ configuration, bundles: [bundle], asOf: '2026-01-31' }),
		/Record umsp_hotel_star/
	);
	const classified = { ...configuration, recordedCompanyFacts: { umsp_hotel_star: 4 } };
	const issues = minimumWageIssues({
		configuration: classified,
		bundles: [bundle],
		asOf: '2026-01-31'
	});
	assert.equal(issues.find((issue) => issue.code === 'MINIMUM_WAGE_BELOW')?.severity, 'WARNING');
	assert.match(
		issues.find((issue) => issue.code === 'MINIMUM_WAGE_BELOW')?.message ?? '',
		/3800000/
	);
});
