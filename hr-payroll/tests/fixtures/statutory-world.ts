// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A synthetic payroll world bound to one **sealed lineage of the seed bank**, snapshotted into
 * `tests/fixtures/statutory/<CODE>/` by `scripts/refresh-statutory-fixtures.mjs`.
 *
 * The point is to price a real statute rather than an invented one: the settings versions, the
 * contribution schemes with their published band tables, the work regime and its treatment grid are
 * the bank's own JSON, unedited. Everything else — the company, the people, their wages, their
 * registrations — is the smallest thing that makes a run happen: full attendance, no leave, no
 * allowances, no loans, one salary line.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PayrollWorld } from './memory-payroll-api.ts';

const here = dirname(fileURLToPath(import.meta.url));

export type Lineage = 'MY' | 'MY-nihon' | 'PH' | 'SG' | 'VN' | 'TW' | 'ID';

function law(code: Lineage, file: string): any[] {
	return JSON.parse(readFileSync(resolve(here, 'statutory', code, `${file}.json`), 'utf8'));
}

export const settingsVersions = (code: Lineage) => law(code, 'jurisdiction_settings');
export const leaveCatalogue = (code: Lineage) => law(code, 'leave_catalogue');

export const COMPANY_ID = 'c0000000-0000-4000-8000-000000000001';
const SHIFT_ID = 'c0000000-0000-4000-8000-0000000000d1';
const REST_ID = 'c0000000-0000-4000-8000-0000000000d3';
const PATTERN_ID = 'c0000000-0000-4000-8000-0000000000d2';

const RANGE = { start: '2000-01-01', end: null };

/** One person to price: the wage, and the facts a band or a scheme predicate reads about them. */
export type Person = {
	readonly key: string;
	readonly wage: number;
	/** Completed years of age at the period end; the fixture derives a birth date from it. */
	readonly age?: number;
	readonly gender?: string;
	readonly marital_status?: string;
	readonly spouse_status?: string;
	readonly solo_parent?: boolean;
	/** `employee.citizenship` — read off `employment_terms.residency_status`, never nationality. */
	readonly citizenship?: string;
	/** `employee.residency_months` counts from here (Singapore's SPR ladders). */
	readonly residency_since?: string;
	/** Feeds `children.count` and, through `dependents_count`, a tax child relief. */
	readonly children?: number;
	readonly grade?: string;
	readonly statutory_work_category?: string;
	readonly hire_date?: string;
	/** Per-scheme registration: a code mapped to `NOT_REGISTERED`, or to a flat rate override. */
	readonly registrations?: Readonly<Record<string, { kind: string; rate_override?: number | null }>>;
};

export type WorldOptions = {
	readonly code: Lineage;
	/** The company's own `settings_code`; defaults to the lineage's own code. */
	readonly settingsCode?: string;
	/** `YYYY-MM`. The window is [21st of the previous month, 20th of this one]. */
	readonly period: string;
	readonly people: readonly Person[];
	/** VN and ID band their minimum wage by region; `companies.region` picks it. */
	readonly region?: string | null;
	readonly riskClass?: string | null;
	/** Overrides the derived headcount for a HEADCOUNT band (Malaysia's HRDF). */
	readonly headcount?: number;
};

function monthEnd(month: string): string {
	const [year, index] = month.split('-').map(Number);
	return new Date(Date.UTC(year!, index!, 0)).toISOString().slice(0, 10);
}

/** A birth date that lands the person on exactly `age` completed years at the period end. */
function birthDateFor(age: number, period: string): string {
	const end = monthEnd(period);
	const [year, month, day] = end.split('-').map(Number);
	return `${String(year! - age).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function createStatutoryWorld(options: WorldOptions): PayrollWorld {
	const { code, period } = options;
	const versions = settingsVersions(code);
	const jurisdictionCode = versions[0]!.jurisdiction_code;
	const employmentIds = options.people.map((_, index) => `e0000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

	const employees = options.people.map((person, index) => ({
		id: `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		name: person.key,
		date_of_birth: birthDateFor(person.age ?? 40, period),
		gender: person.gender ?? 'FEMALE',
		marital_status: person.marital_status ?? 'SINGLE',
		spouse_status: person.spouse_status ?? 'NONE',
		solo_parent: person.solo_parent ?? false,
		dependents_count: person.children ?? 0,
		approval_id: null
	}));

	const employments = options.people.map((person, index) => ({
		id: employmentIds[index]!,
		employee_id: employees[index]!.id,
		company_id: COMPANY_ID,
		employee_number: person.key,
		hire_date: person.hire_date ?? '2015-01-01',
		exit_date: null,
		exit_reason: null,
		children: [],
		bank: null,
		effective_range: { start: person.hire_date ?? '2015-01-01', end: null },
		approval_id: null
	}));

	const terms = options.people.map((person, index) => ({
		id: `b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		employment_id: employmentIds[index]!,
		base_salary: { value: person.wage, currency: versions[0]!.currency },
		pay_frequency: 'MONTHLY',
		work_classification: 'EA_COVERED',
		statutory_work_category: person.statutory_work_category ?? 'NON_MANUAL',
		employment_type: 'PERMANENT',
		residency_status: person.citizenship ?? null,
		residency_since: person.residency_since ?? null,
		department: null,
		job_title: 'Fixture',
		grade: person.grade ?? null,
		payroll_group: null,
		shift_pattern_id: PATTERN_ID,
		effective_range: { start: person.hire_date ?? '2015-01-01', end: null },
		approval_id: null
	}));

	// Every scheme the version levies gets an explicit REGISTERED row, so a scheme that only charges
	// a registered employment is charged and a NOT_REGISTERED case is a deliberate override rather
	// than an absence of data.
	const schemes = law(code, 'statutory_contributions');
	const facts: PayrollWorld['employment_statutory_facts'] = [];
	for (const [index, person] of options.people.entries())
		for (const scheme of schemes) {
			const declared = person.registrations?.[scheme.code];
			facts.push({
				id: `f-${index}-${scheme.id}`,
				employment_id: employmentIds[index]!,
				statutory_contribution_id: scheme.id,
				status: {
					kind: declared?.kind ?? 'REGISTERED',
					reference_number: 'FIXTURE',
					rate_override: declared?.rate_override ?? null,
					reason: ''
				},
				effective_range: RANGE,
				approval_id: null
			});
		}

	return {
		companies: [
			{
				id: COMPANY_ID,
				settings_code: options.settingsCode ?? code,
				jurisdiction_code: jurisdictionCode,
				name: `${code} fixture`,
				registration_number: `${code}-0001`,
				pay_cutoff_day: 21,
				pay_frequency: 'MONTHLY',
				region: options.region ?? null,
				risk_class: options.riskClass ?? null,
				effective_range: RANGE,
				approval_id: null
			}
		],
		jurisdiction_settings: versions,
		statutory_contributions: schemes,
		work_catalogue: law(code, 'work_catalogue'),
		loan_catalogue: [],
		claim_catalogue: [],
		allowance_catalogue: [],
		payment_catalogue: [],
		shift_definitions: [
			{
				id: SHIFT_ID,
				company_id: COMPANY_ID,
				code: 'DAY',
				name: 'Day',
				variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
				effective_range: RANGE,
				approval_id: null
			},
			{
				id: REST_ID,
				company_id: COMPANY_ID,
				code: 'REST',
				name: 'Rest day',
				variant: { kind: 'REST' },
				effective_range: RANGE,
				approval_id: null
			}
		],
		shift_patterns: [
			{
				id: PATTERN_ID,
				company_id: COMPANY_ID,
				code: 'MON-FRI',
				name: 'Five days, two rest days',
				// PATTERNED, and therefore projected rather than rostered: with no `work_days` row the
				// pattern's projection stands and the person is taken to have worked it (`work.ts`,
				// "attendance records exceptions, so silence is presence"). That is exactly the case
				// these tests want — full attendance, nothing captured, no absence and no overtime —
				// and a ROSTERED pattern cannot express it, because its plan-only rows read as absence.
				pattern: {
					type: 'PATTERNED',
					anchor_date: '2000-01-03',
					phases: [
						{
							duration: { kind: 'CONTINUOUS' },
							day_cycle: [
								{ roster_code_id: SHIFT_ID },
								{ roster_code_id: SHIFT_ID },
								{ roster_code_id: SHIFT_ID },
								{ roster_code_id: SHIFT_ID },
								{ roster_code_id: SHIFT_ID },
								{ roster_code_id: REST_ID },
								{ roster_code_id: REST_ID }
							]
						}
					]
				},
				effective_range: RANGE,
				approval_id: null
			}
		],
		jurisdiction_holidays: [],
		leave_catalogue: [],
		leave_entries: [],
		employments,
		employees,
		employment_terms: terms,
		employment_statutory_facts: facts,
		claim_requests: [],
		allowance_requests: [],
		payment_requests: [],
		loans: [],
		loan_repayments: [],
		work_days: [],
		payroll_runs: [],
		payslips: [],
		payslip_allowance_request_inputs: [],
		payslip_leave_inputs: [],
		payslip_loan_repayment_inputs: []
	};
}
