/**
 * Deterministic input for the payroll guest-CPU benchmark.
 *
 * This is a `PreparedRun`: PICK and GATHER have already happened. Keeping the fixture at that
 * boundary means the benchmark measures the pure VALIDATE -> GRAPH path in `buildPayrollRun`, not
 * database latency, runtime RPC, fixture construction or clocks. The calendar comes from the
 * payroll engine itself so the benchmark does not maintain a second version of those rules.
 */

import type { Configuration, ShiftDefinition, ShiftPattern } from './lib/configuration.js';
import type { PreparedRun } from './lib/engine.js';
import type { EmploymentBundle } from './lib/gather.js';
import { resolveWindow } from './lib/period.js';

const EMPLOYEE_COUNT = 290;
const PERIOD = '2026-04';

export const PAYROLL_CPU_BENCHMARK_FIXTURE = Object.freeze({
	// Bump this identity whenever any fixture value or population rule changes.
	id: 'hr-payroll:my-monthly-basic-epf-pcb:2026-04:290:v3',
	employeeCount: EMPLOYEE_COUNT,
	period: PERIOD,
	profile:
		'290 monthly Malaysian employments; one scheduled salary; EPF-style bracketed percentage and progressive withholding; no attendance, leave, loans, entries or host reads'
});

const COMPANY = {
	id: '00000000-0000-4000-8000-000000000001',
	settings_code: 'MY',
	name: 'Benchmark Malaysia',
	registration_number: 'BENCHMARK-NOT-A-LEGAL-ENTITY',
	pay_cutoff_day: 21,
	pay_frequency: 'MONTHLY',
	risk_class: null,
	effective_range: { start: '2020-01-01', end: null }
} as const;

const JURISDICTION = {
	id: '00000000-0000-4000-8000-000000000002',
	code: 'MY',
	jurisdiction_code: 'MY',
	name: 'Benchmark Malaysia profile',
	sealed_at: '2020-01-01T00:00:00.000Z',
	voided_at: null,
	void_reason: null,
	cloned_from_id: null,
	payroll: { currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', tax_year_start_month: 1 },
	wages: { by_region: {} },
	sources: { urls: [] },
	effective_range: { start: '2020-01-01', end: null }
} as const;

const WORK = {
	settings_id: JURISDICTION.id,
	jurisdiction_code: 'MY',
	proration: { by: 'CALENDAR_DAYS' },
	engine_lines: {
		salary: { statutory_opt_ins: [] },
		absence: { statutory_opt_ins: [] },
		night: { statutory_opt_ins: [] }
	},
	rates: {
		ordinary: [{ when: '', unit: 'DAY', divisor: 26 }],
		bands: []
	},
	limits: [],
	breaks: [],
	weekly_rest_rule: { max_consecutive_work_days: 6, discharged_by: 'REST' },
	coverage: null,
	holiday_rest_precedence: 'REST_DAY'
} as const;

const EPF_ID = '00000000-0000-4000-8000-000000000003';
const PCB_ID = '00000000-0000-4000-8000-000000000004';
const BASIC_ID = '00000000-0000-4000-8000-000000000005';

const BASIC = {
	family: 'WORK',
	output: 'salary',
	id: BASIC_ID,
	settings_id: JURISDICTION.id,
	code: 'BASIC',
	name: 'BASIC',
	is_statutory: false,
	destination: 'PAY',
	direction: 'ADD',
	bands: [],
	optIns: [
		{ contribution_id: EPF_ID, effect: 'INCLUDE' as const },
		{ contribution_id: PCB_ID, effect: 'INCLUDE' as const }
	],
	eligibility: '',
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
} as const;

// The PCB benchmark states the annual scale its old typed path did: project the year, relieve it,
// scale it through the published ladder, spread what is left, then gate on the minimum.
const PCB_CHARGEABLE =
	'year_to_date.base + base * (1.0 + projection.future_equivalents) - produced.EPF.employee - ' +
	'(9000.0 + (person.employee.spouse_status == "WITHOUT_INCOME" ? 4000.0 : 0.0) + 2000.0 * person.employee.dependents_count)';
const PCB_CLAMPED = `(${PCB_CHARGEABLE} > 0.0 ? ${PCB_CHARGEABLE} : 0.0)`;
const PCB_TAX = `progressive(${PCB_CLAMPED}, [0.0, 0.0, 0.0, 5000.0, 0.0, 1.0, 20000.0, 150.0, 3.0, 35000.0, 600.0, 6.0, 50000.0, 1500.0, 11.0, 70000.0, 3700.0, 19.0])`;
const PCB_REGULAR = `up_5_cents(truncate_cent((${PCB_TAX} - year_to_date.employee) > 0.0 ? (${PCB_TAX} - year_to_date.employee) / (projection.payslips_remaining > 1.0 ? projection.payslips_remaining : 1.0) : 0.0))`;
const PCB_EMPLOYEE = `(rate_override > 0.0 ? up_5_cents(truncate_cent(base * rate_override / 100.0)) : (${PCB_REGULAR} < 10.0 ? 0.0 : ${PCB_REGULAR}))`;

const CONTRIBUTIONS = [
	{
		row: {
			id: EPF_ID,
			settings_id: JURISDICTION.id,
			is_statutory: true,
			code: 'EPF',
			name: 'Benchmark retirement fund',
			authority: 'Synthetic benchmark schedule',
			assessment_period: 'PAY_PERIOD',
			employee_share_annual_cap: 4000,
			shared_cap_group: null,
			project_relief_annually: true,
			rules: [
				{
					when: 'bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) <= 5000.0 && age < 60',
					employee:
						'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 11.0 / 100.0)',
					employer:
						'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 13.0 / 100.0)'
				},
				{
					when: 'bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) > 5000.0 && age < 60',
					employee:
						'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 11.0 / 100.0)',
					employer:
						'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 12.0 / 100.0)'
				}
			]
		},
		rules: [
			{
				when: 'bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) <= 5000.0 && age < 60',
				employee: 'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 11.0 / 100.0)',
				employer: 'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 13.0 / 100.0)'
			},
			{
				when: 'bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) > 5000.0 && age < 60',
				employee: 'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 11.0 / 100.0)',
				employer: 'up_to_unit(bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0) * 12.0 / 100.0)'
			}
		]
	},
	{
		row: {
			id: PCB_ID,
			settings_id: JURISDICTION.id,
			is_statutory: true,
			code: 'PCB',
			name: 'Benchmark progressive withholding',
			authority: 'Synthetic benchmark schedule',
			assessment_period: 'PAY_PERIOD',
			employee_share_annual_cap: null,
			shared_cap_group: null,
			project_relief_annually: false,
			rules: [{ when: '', employee: PCB_EMPLOYEE, employer: '0.0' }]
		},
		rules: [{ when: '', employee: PCB_EMPLOYEE, employer: '0.0' }]
	}
] as const;

/*
 * The fixture states the columns the engine reads and no others.
 *
 * `Company`, `Jurisdiction`, `StatutoryContribution` and `CatalogueComponent` are stored-row types, so
 * they also carry the columns storage owns — `created_at`, `updated_at`, `sys_period`,
 * `row_version`, `approval_id` — and a benchmark that invented values for them would be stating
 * facts no run ever reads while moving the fixture identity every time storage changes shape.
 *
 * repository-health:allow R3b -- PICK output assembled from engine-read columns; the stored row types add storage-owned columns a CPU benchmark must not invent.
 */
/**
 * The one named pattern every benchmark employment points at: a PATTERNED five-day week, so the
 * fixture needs no person-day rows — the pattern projects every day and silence is presence.
 * repository-health:allow R3b -- PICK output assembled from engine-read columns, like `CONFIGURATION`.
 */
const DAY_SHIFT = {
	id: '00000000-0000-4000-8000-000000000041',
	company_id: COMPANY.id,
	code: 'DAY',
	name: 'Day',
	variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
	effective_range: { start: '2020-01-01', end: null }
} as unknown as ShiftDefinition;

const REST_SHIFT = {
	id: '00000000-0000-4000-8000-000000000042',
	company_id: COMPANY.id,
	code: 'REST',
	name: 'Rest day',
	variant: { kind: 'REST' },
	effective_range: { start: '2020-01-01', end: null }
} as unknown as ShiftDefinition;

const SHIFT_PATTERN = {
	id: '00000000-0000-4000-8000-000000000040',
	company_id: COMPANY.id,
	code: 'MON-FRI',
	name: 'Five days, two rest days',
	pattern: {
		days: [
			{ roster_code_id: DAY_SHIFT.id },
			{ roster_code_id: DAY_SHIFT.id },
			{ roster_code_id: DAY_SHIFT.id },
			{ roster_code_id: DAY_SHIFT.id },
			{ roster_code_id: DAY_SHIFT.id },
			{ roster_code_id: REST_SHIFT.id },
			{ roster_code_id: REST_SHIFT.id }
		]
	},
	effective_range: { start: '2020-01-01', end: null }
} as unknown as ShiftPattern;

const CONFIGURATION = {
	company: COMPANY,
	jurisdiction: JURISDICTION,
	work: WORK,
	holidayRestPrecedence: 'REST_DAY',
	holidaySnapshots: [],
	holidayInputs: [],
	contributions: CONTRIBUTIONS,
	catalogueComponents: [BASIC],
	limits: WORK.limits,
	breaks: WORK.breaks,
	nightPremium: null,
	overtimeCoverageRule: null,
	shiftById: new Map([
		[DAY_SHIFT.id, DAY_SHIFT],
		[REST_SHIFT.id, REST_SHIFT]
	]),
	patternById: new Map([[SHIFT_PATTERN.id, SHIFT_PATTERN]]),
	holidays: new Map(),
	catalogueLeaves: [],
	hash: PAYROLL_CPU_BENCHMARK_FIXTURE.id
} as unknown as Configuration;

function fixtureUuid(namespace: number, index: number): string {
	return `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${index
		.toString()
		.padStart(12, '0')}`;
}

function bundle(index: number, window: ReturnType<typeof resolveWindow>): EmploymentBundle {
	const serial = index + 1;
	const employmentId = fixtureUuid(10, serial);
	const employeeId = fixtureUuid(11, serial);
	const terms = [
		{
			id: fixtureUuid(12, serial),
			employment_id: employmentId,
			base_salary: { value: 3400 + (index % 12) * 350, currency: 'MYR' },
			pay_frequency: 'MONTHLY',
			shift_pattern_id: SHIFT_PATTERN.id,
			job_title: `Benchmark role ${index % 8}`,
			statutory_work_category: 'NON_MANUAL',
			work_classification: 'EA_COVERED',
			employment_type: 'PERMANENT',
			department: `D${index % 10}`,
			payroll_group: null,
			effective_range: { start: '2020-01-01', end: null }
		}
	];
	// Same boundary as `CONFIGURATION`: GATHER output built from the columns the engine reads, while
	// `Employment`, `Employee` and `EmploymentTerms` are stored-row types carrying storage-owned and
	// unread nullable columns besides.
	// repository-health:allow R3b -- GATHER output assembled from engine-read columns; the stored row types add storage-owned columns a CPU benchmark must not invent.
	return {
		employment: {
			id: employmentId,
			employee_id: employeeId,
			employee_number: `BENCH${serial.toString().padStart(4, '0')}`,
			company_id: COMPANY.id,
			effective_range: { start: '2020-01-01', end: null }
		},
		employee: {
			id: employeeId,
			name: `Benchmark Employee ${serial.toString().padStart(4, '0')}`,
			date_of_birth: `${1997 - (index % 30)}-01-15`,
			gender: index % 2 === 0 ? 'FEMALE' : 'MALE',
			marital_status: index % 3 === 0 ? 'MARRIED' : 'SINGLE',
			spouse_status: index % 3 !== 0 ? 'NONE' : index % 6 === 0 ? 'WITHOUT_INCOME' : 'WITH_INCOME',
			dependents_count: index % 4,
			children: []
		},
		terms,
		termsHistory: terms,
		statutoryFacts: [],
		payRequests: [],
		children: [],
		loans: [],
		loanRepayments: [],
		leave: { entries: [], catalogues: [], captures: [], balances: {}, deductionEligibility: {} },
		workDays: [],
		serviceMonths: 75,
		age: 29 + (index % 30),
		payFrequency: 'MONTHLY',
		window,
		employedDays: window.salary,
		wageDays: window.salary,
		attendance: window.attendance,
		arrearsFor: null,
		deferral: null
	} as unknown as EmploymentBundle;
}

/** Construct once, outside every timed interval. The returned graph input is never mutated. */
export function makePayrollCpuBenchmarkPreparedRun(): PreparedRun {
	const window = resolveWindow(PERIOD, COMPANY);
	return {
		period: PERIOD,
		window,
		configuration: CONFIGURATION,
		gathered: {
			bundles: Array.from({ length: EMPLOYEE_COUNT }, (_, index) => bundle(index, window)),
			headcount: EMPLOYEE_COUNT,
			workHolidayEvidence: { inputs: [], holidays: [] },
			yearToDate: new Map(),
			priorOvertimeHours: new Map(),
			consumedEntries: new Map()
		},
		readLog: {
			assertComplete: (rows) => rows,
			logString: () => 'benchmark PreparedRun: zero reads'
		}
	};
}
