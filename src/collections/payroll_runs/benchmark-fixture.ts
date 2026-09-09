/**
 * Deterministic input for the payroll guest-CPU benchmark.
 *
 * This is a `PreparedRun`: PICK and GATHER have already happened. Keeping the fixture at that
 * boundary means the benchmark measures the pure VALIDATE -> GRAPH path in `buildPayrollRun`, not
 * database latency, runtime RPC, fixture construction or clocks. The calendar comes from the
 * payroll engine itself so the benchmark does not maintain a second version of those rules.
 */

import type { Configuration, ShiftPattern } from './lib/configuration.js';
import type { PreparedRun } from './lib/engine.js';
import type { EmploymentBundle } from './lib/gather.js';
import { resolveWindow } from './lib/period.js';

const EMPLOYEE_COUNT = 290;
const PERIOD = '2026-04';

export const PAYROLL_CPU_BENCHMARK_FIXTURE = Object.freeze({
	// Bump this identity whenever any fixture value or population rule changes.
	id: 'hr-payroll:my-monthly-basic-epf-pcb:2026-04:290:v2',
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
	currency: 'MYR',
	tax_year_start_month: 1,
	effective_range: { start: '2020-01-01', end: null }
} as const;

const WORK = {
	id: '00000000-0000-4000-8000-000000000006',
	settings_id: JURISDICTION.id,
	code: 'STANDARD',
	jurisdiction_code: 'MY',
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_rate: { per: 'DAY', divisor: 26 },
	regime: {
		overtime_coverage: null,
		overtime_rules: [],
		overtime_limits: [],
		rest_break_rules: []
	}
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
	is_statutory: false,
	policy: { kind: 'EARNING', settlement: 'ADD' },
	contribution_treatments: {
		EPF: { kind: 'INCLUDE' as const },
		PCB: { kind: 'INCLUDE' as const }
	},
	nature: 'EARNING',
	sequence: 10,
	eligibility: '',
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
} as const;

const CONTRIBUTIONS = [
	{
		row: {
			id: EPF_ID,
			settings_id: JURISDICTION.id,
			is_statutory: true,
			code: 'EPF',
			name: 'Benchmark retirement fund',
			authority: 'Synthetic benchmark schedule',
			rounding: 'UP_TO_UNIT',
			relief_for: [PCB_ID],
			sequence: 10,
			special_rules: [
				'BRACKET_STEP:5000:20',
				'BRACKET_STEP:20000:100',
				'RELIEF_CAP:4000',
				'RELIEF_PROJECTED'
			]
		},
		rates: [
			{
				id: '00000000-0000-4000-8000-000000000011',
				statutory_contribution_id: EPF_ID,
				selector: { by: 'WAGE_AND_AGE', from: 0, to: 5000, age_from: 0, age_to: 60 },
				award: { kind: 'PERCENT', employee: 11, employer: 13 }
			},
			{
				id: '00000000-0000-4000-8000-000000000012',
				statutory_contribution_id: EPF_ID,
				selector: { by: 'WAGE_AND_AGE', from: 5000, to: null, age_from: 0, age_to: 60 },
				award: { kind: 'PERCENT', employee: 11, employer: 12 }
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
			rounding: 'NEAREST_CENT',
			relief_for: [],
			sequence: 20,
			special_rules: [
				'PERSONAL_RELIEF:9000',
				'SPOUSE_RELIEF:4000',
				'CHILD_RELIEF:2000',
				'MIN_WITHHOLD:10',
				'ROUND:TRUNCATE_CENT',
				'ROUND:UP_5_CENTS'
			]
		},
		rates: [
			{
				id: '00000000-0000-4000-8000-000000000021',
				statutory_contribution_id: PCB_ID,
				selector: { by: 'WAGE', from: 0, to: 5000 },
				award: { kind: 'PROGRESSIVE', rate: 0, constant: 0 }
			},
			{
				id: '00000000-0000-4000-8000-000000000022',
				statutory_contribution_id: PCB_ID,
				selector: { by: 'WAGE', from: 5000, to: 20000 },
				award: { kind: 'PROGRESSIVE', rate: 1, constant: 0 }
			},
			{
				id: '00000000-0000-4000-8000-000000000023',
				statutory_contribution_id: PCB_ID,
				selector: { by: 'WAGE', from: 20000, to: 35000 },
				award: { kind: 'PROGRESSIVE', rate: 3, constant: 150 }
			},
			{
				id: '00000000-0000-4000-8000-000000000024',
				statutory_contribution_id: PCB_ID,
				selector: { by: 'WAGE', from: 35000, to: 50000 },
				award: { kind: 'PROGRESSIVE', rate: 6, constant: 600 }
			},
			{
				id: '00000000-0000-4000-8000-000000000025',
				statutory_contribution_id: PCB_ID,
				selector: { by: 'WAGE', from: 50000, to: 70000 },
				award: { kind: 'PROGRESSIVE', rate: 11, constant: 1500 }
			},
			{
				id: '00000000-0000-4000-8000-000000000026',
				statutory_contribution_id: PCB_ID,
				selector: { by: 'WAGE', from: 70000, to: null },
				award: { kind: 'PROGRESSIVE', rate: 19, constant: 3700 }
			}
		]
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
 * The one named pattern every benchmark employment points at: a rostered guarantee, so the fixture
 * needs no roster codes and no person-day rows for the engine to derive a weekly workload from.
 * repository-health:allow R3b -- PICK output assembled from engine-read columns, like `CONFIGURATION`.
 */
const SHIFT_PATTERN = {
	id: '00000000-0000-4000-8000-000000000040',
	company_id: COMPANY.id,
	code: 'ROSTER-5D-40H-WK',
	name: 'Rostered, 5 days and 40 hours guaranteed per week',
	pattern: {
		type: 'ROSTERED',
		expectation: {
			kind: 'GUARANTEED_SCHEDULE',
			period: 'WEEK',
			required_work_days: 5,
			required_paid_minutes: 2400
		}
	},
	effective_range: { start: '2020-01-01', end: null }
} as unknown as ShiftPattern;

const CONFIGURATION = {
	company: COMPANY,
	jurisdiction: JURISDICTION,
	work: WORK,
	holidayRestPrecedence: 'REST_DAY',
	holidayCalendars: [],
	holidayInputs: [],
	contributions: CONTRIBUTIONS,
	treatments: new Map(
		CONTRIBUTIONS.map((entry) => [
			`${BASIC.id}:${entry.row.id}`,
			BASIC.contribution_treatments[entry.row.code as 'EPF' | 'PCB']
		])
	),
	catalogueComponents: [BASIC],
	overtimeRules: [],
	overtimeLimits: [],
	restBreakRules: [],
	overtimeCoverageRule: null,
	shiftById: new Map(),
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
			hire_date: '2020-01-01',
			exit_date: null,
			effective_range: { start: '2020-01-01', end: null }
		},
		employee: {
			id: employeeId,
			name: `Benchmark Employee ${serial.toString().padStart(4, '0')}`,
			date_of_birth: `${1997 - (index % 30)}-01-15`,
			gender: index % 2 === 0 ? 'FEMALE' : 'MALE',
			marital_status: index % 3 === 0 ? 'MARRIED' : 'SINGLE',
			spouse_status: index % 3 !== 0 ? 'NONE' : index % 6 === 0 ? 'WITHOUT_INCOME' : 'WITH_INCOME',
			dependents_count: index % 4
		},
		terms: [
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
		],
		statutoryFacts: [],
		payRequests: [],
		children: [],
		loans: [],
		loanRepayments: [],
		ledger: [],
		workDays: [],
		serviceMonths: 75,
		age: 29 + (index % 30),
		payFrequency: 'MONTHLY',
		window,
		employedDays: window.salary,
		wageDays: window.salary,
		attendance: window.attendance,
		arrearsFor: null,
		deferral: null,
		extendedLeaveSettlesInOwnMonth: false
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
			consumedEntries: new Map(),
			consumedRepayments: new Map()
		},
		readLog: {
			assertComplete: (rows) => rows,
			logString: () => 'benchmark PreparedRun: zero reads'
		}
	};
}
