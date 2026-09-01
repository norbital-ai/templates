/**
 * Deterministic input for the payroll guest-CPU benchmark.
 *
 * This is a `PreparedRun`: PICK and GATHER have already happened. Keeping the fixture at that
 * boundary means the benchmark measures the pure VALIDATE -> GRAPH path in `buildPayrollRun`, not
 * database latency, runtime RPC, fixture construction or clocks. The calendar and plain settlement
 * policy come from the payroll engine itself so the benchmark does not maintain a second version of
 * those rules.
 */

import type { Configuration } from './lib/configuration.js';
import type { PreparedRun } from './lib/engine.js';
import type { EmploymentBundle } from './lib/gather.js';
import { payPeriodsRemaining, resolveWindow } from './lib/period.js';
import { PLAIN_CALENDAR } from './lib/settlement.js';

const EMPLOYEE_COUNT = 290;
const PERIOD = '2026-04';

export const PAYROLL_CPU_BENCHMARK_FIXTURE = Object.freeze({
	// Bump this identity whenever any fixture value or population rule changes.
	id: 'hr-payroll:my-monthly-basic-epf-pcb:2026-04:290:v1',
	employeeCount: EMPLOYEE_COUNT,
	period: PERIOD,
	profile:
		'290 monthly Malaysian employments; one scheduled salary; EPF-style bracketed percentage and progressive withholding; no attendance, leave, loans, entries or host reads'
});

const COMPANY = {
	id: '00000000-0000-4000-8000-000000000001',
	jurisdiction_id: '00000000-0000-4000-8000-000000000002',
	name: 'Benchmark Malaysia',
	registration_number: 'BENCHMARK-NOT-A-LEGAL-ENTITY',
	pay_cutoff_day: 21,
	pay_day: 28,
	pay_calendar: null,
	leave_year_start_month: 1,
	overtime_calculation_method: 'STATUTORY_AGGREGATE',
	settlement_policy: null,
	risk_class: null,
	effective_range: { start: '2020-01-01', end: null }
} as const;

const JURISDICTION = {
	id: COMPANY.jurisdiction_id,
	code: 'MY',
	name: 'Benchmark Malaysia profile',
	lifecycle: 'SEALED',
	currency: 'MYR',
	tax_year_start_month: 1,
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_rate_basis: 'DAYS_PER_MONTH',
	ordinary_rate_divisor: 26,
	regime: {
		overtime_coverage: null,
		overtime_rules: [],
		overtime_limits: [],
		rest_break_rules: []
	},
	statutory_leave: [],
	effective_range: { start: '2020-01-01', end: null }
} as const;

const EPF_ID = '00000000-0000-4000-8000-000000000003';
const PCB_ID = '00000000-0000-4000-8000-000000000004';
const BASIC_ID = '00000000-0000-4000-8000-000000000005';

const includeTreatment = (statutoryContributionId: string, authority: string) => ({
	statutory_contribution_id: statutoryContributionId,
	authority,
	treatment: { kind: 'INCLUDE' as const },
	effective_range: { start: '2020-01-01', end: null }
});

const BASIC = {
	id: BASIC_ID,
	company_id: COMPANY.id,
	statutory_profile_id: JURISDICTION.id,
	code: 'BASIC',
	policy: {
		kind: 'EARNING',
		settlement: 'ADD',
		statutory_treatments: [
			includeTreatment(EPF_ID, 'Benchmark EPF treatment'),
			includeTreatment(PCB_ID, 'Benchmark PCB treatment')
		]
	},
	nature: 'EARNING',
	sequence: 10,
	eligibility: [],
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
} as const;

const excludedOvertime = {
	treatment: { kind: 'EXCLUDE' as const },
	effective_range: { start: '2020-01-01', end: null }
};

const CONTRIBUTIONS = [
	{
		row: {
			id: EPF_ID,
			jurisdiction_id: JURISDICTION.id,
			statutory_profile_id: JURISDICTION.id,
			code: 'EPF',
			name: 'Benchmark retirement fund',
			authority: 'Synthetic benchmark schedule',
			payer: 'BOTH',
			keyed_by: 'WAGE_AND_AGE',
			rounding: 'UP_TO_UNIT',
			relief_for: [PCB_ID],
			sequence: 10,
			special_rules: [
				'BRACKET_STEP:5000:20',
				'BRACKET_STEP:20000:100',
				'RELIEF_CAP:4000',
				'RELIEF_PROJECTED'
			],
			overtime_treatments: [],
			overtime_excess_treatments: []
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
		],
		overtimeTreatment: excludedOvertime,
		overtimeExcessTreatment: excludedOvertime
	},
	{
		row: {
			id: PCB_ID,
			jurisdiction_id: JURISDICTION.id,
			statutory_profile_id: JURISDICTION.id,
			code: 'PCB',
			name: 'Benchmark progressive withholding',
			authority: 'Synthetic benchmark schedule',
			payer: 'EMPLOYEE',
			keyed_by: 'WAGE',
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
			],
			overtime_treatments: [],
			overtime_excess_treatments: []
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
		],
		overtimeTreatment: excludedOvertime,
		overtimeExcessTreatment: excludedOvertime
	}
] as const;

/*
 * The fixture states the columns the engine reads and no others.
 *
 * `Company`, `Jurisdiction`, `StatutoryContribution` and `PayComponent` are stored-row types, so
 * they also carry the columns storage owns — `created_at`, `updated_at`, `sys_period`,
 * `row_version`, `approval_id` — and a benchmark that invented values for them would be stating
 * facts no run ever reads while moving the fixture identity every time storage changes shape.
 *
 * repository-health:allow R3b -- PICK output assembled from engine-read columns; the stored row types add storage-owned columns a CPU benchmark must not invent.
 */
const CONFIGURATION = {
	company: COMPANY,
	jurisdiction: JURISDICTION,
	contributions: CONTRIBUTIONS,
	treatments: new Map(
		BASIC.policy.statutory_treatments.map((entry) => [
			`${BASIC.id}:${entry.statutory_contribution_id}`,
			entry
		])
	),
	payComponents: [BASIC],
	overtimeRules: [],
	overtimeLimits: [],
	restBreakRules: [],
	overtimeCoverageRule: null,
	shiftById: new Map(),
	holidays: new Map(),
	leaveTypes: [],
	hash: PAYROLL_CPU_BENCHMARK_FIXTURE.id
} as unknown as Configuration;

const WORK_PATTERN = {
	type: 'ROSTERED',
	expectation: {
		kind: 'GUARANTEED_SCHEDULE',
		period: 'WEEK',
		required_work_days: 5,
		required_paid_minutes: 2400
	}
} as const;

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
				work_pattern: WORK_PATTERN,
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
		componentEntries: [],
		children: [],
		loans: [],
		loanRepayments: [],
		ledger: [],
		workDays: [],
		serviceMonths: 75,
		age: 29 + (index % 30),
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
		policy: PLAIN_CALENDAR,
		gathered: {
			bundles: Array.from({ length: EMPLOYEE_COUNT }, (_, index) => bundle(index, window)),
			headcount: EMPLOYEE_COUNT,
			yearToDate: new Map(),
			consumedEntries: new Map(),
			consumedRepayments: new Map()
		},
		periodsRemaining: payPeriodsRemaining(PERIOD, JURISDICTION.tax_year_start_month),
		readLog: {
			assertComplete: (rows) => rows,
			logString: () => 'benchmark PreparedRun: zero reads'
		}
	};
}
