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

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import {
	buildPayrollRun,
	gatherPayrollRun
} from '../../src/collections/payroll_runs/lib/engine.ts';
import { calculateFamilyAssessments } from '../../src/lib/payroll/families.ts';
import { memoryPayrollApi, type PayrollWorld } from './memory-payroll-api.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every lineage snapshotted under `tests/fixtures/statutory/`, read from the directory.
 *
 * Listing them by hand means a lineage added to the bank is silently absent from every test that
 * iterates them — the golden files would still pass, having never been asked about it.
 */
export const LINEAGES = readdirSync(resolve(here, 'statutory'), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort() as readonly Lineage[];

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
	/** Singapore's self-help groups band on `employee.race`, and MBMF on `employee.religion`. */
	readonly race?: string;
	readonly religion?: string;
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
	readonly registrations?: Readonly<
		Record<string, { kind: string; rate_override?: number | null }>
	>;
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
	/**
	 * Pads the world to this many employments, so a HEADCOUNT band (Malaysia's HRDF) is reached.
	 * `gathered.headcount` counts everyone the company employs in the month, so the padding is
	 * extra people on a token wage rather than a number the fixture asserts.
	 */
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

/** `count` children, each young enough to be under every `children.under(n)` age in the bank. */
function childrenOf(count: number, period: string) {
	return Array.from({ length: count }, (_, index) => ({
		child_birthdate: birthDateFor(index + 1, period)
	}));
}

export function createStatutoryWorld(options: WorldOptions): PayrollWorld {
	const { code, period } = options;
	const versions = settingsVersions(code);
	const jurisdictionCode = versions[0]!.jurisdiction_code;
	const schemes = law(code, 'statutory_contributions');
	// Padding employments stand outside every scheme: they count toward a HEADCOUNT band but
	// charge nothing, relieve nothing, and always settle positive on their token wage.
	const padding: Person[] = Array.from(
		{ length: Math.max(0, (options.headcount ?? 0) - options.people.length) },
		(_, index) => ({
			key: `PAD-${index}`,
			wage: 1,
			registrations: Object.fromEntries(
				schemes.map((scheme) => [scheme.code, { kind: 'NOT_REGISTERED' }])
			)
		})
	);
	const people = [...options.people, ...padding];
	const employmentIds = people.map(
		(_, index) => `e0000000-0000-4000-8000-${String(index).padStart(12, '0')}`
	);

	const employees = people.map((person, index) => ({
		id: `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		name: person.key,
		date_of_birth: birthDateFor(person.age ?? 40, period),
		gender: person.gender ?? 'FEMALE',
		marital_status: person.marital_status ?? 'SINGLE',
		spouse_status: person.spouse_status ?? 'NONE',
		solo_parent: person.solo_parent ?? false,
		race: person.race ?? null,
		religion: person.religion ?? null,
		dependents_count: person.children ?? 0,
		approval_id: null
	}));

	const employments = people.map((person, index) => ({
		id: employmentIds[index]!,
		employee_id: employees[index]!.id,
		company_id: COMPANY_ID,
		employee_number: person.key,
		hire_date: person.hire_date ?? '2015-01-01',
		exit_date: null,
		exit_reason: null,
		children: childrenOf(person.children ?? 0, period),
		bank: null,
		effective_range: { start: person.hire_date ?? '2015-01-01', end: null },
		approval_id: null
	}));

	const terms = people.map((person, index) => ({
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
	const facts: PayrollWorld['employment_statutory_facts'] = [];
	for (const [index, person] of people.entries())
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

// ─────────────────────────────────────────────────────────────────────────────
// Golden-test harness.
//
// `assessStatutory` runs the two calls production runs — `gatherPayrollRun` then
// `buildPayrollRun` (PICK, GATHER, VALIDATE, MEASURE, ACCUMULATE, CONTRIBUTE, SETTLE,
// GRAPH) — over the memory API, and indexes the built payslips' statutory charges by
// employee number and scheme code. A figure asserted from this book has been through the
// whole pipeline, not just `contribute()`.
//
// `assessStatutoryUnvalidated` runs GATHER, MEASURE, ACCUMULATE and CONTRIBUTE only. It
// exists for the lineage whose sealed seed trips a validation blocker (ID `PPH21` — see
// `tests/statutory-golden-id.test.ts`). The figures are what the engine computes; the
// blocker's relief linkage is computationally inert on a `PERCENT` award, so they are what
// a corrected seed would build. The run as a whole does not build until that correction.
// ─────────────────────────────────────────────────────────────────────────────

export type StatutoryCharge = {
	readonly base: number;
	readonly employee: number;
	readonly employer: number;
	readonly band: string | null;
};

export type StatutoryBook = Map<string, Map<string, StatutoryCharge>>;

type PricedCharge = {
	readonly code: string;
	readonly base: number;
	readonly employee: number;
	readonly employer: number;
	readonly band: string | null;
};

/**
 * Index one run's charges by employee number and scheme code.
 *
 * `+ 0` normalises negative zero: `roundMoney(0, 'UP_TO_UNIT')` is `Math.ceil(0 - eps)`,
 * which is `-0`, and `assert.equal` compares primitives with `Object.is`, where `-0 !== 0`.
 * It reaches a payslip as JSON `0` and is invisible downstream, so it is normalised here
 * rather than asserted.
 */
function indexStatutory(
	employments: PayrollWorld['employments'],
	runs: ReadonlyArray<{ employmentId: string; charges: readonly PricedCharge[] }>
): StatutoryBook {
	const numbers = new Map<string, string>();
	for (const employment of employments)
		numbers.set(String(employment.id), String(employment.employee_number));
	const book: StatutoryBook = new Map();
	for (const run of runs) {
		const rows = new Map<string, StatutoryCharge>();
		for (const charge of run.charges)
			rows.set(charge.code, {
				base: charge.base + 0,
				employee: charge.employee + 0,
				employer: charge.employer + 0,
				band: charge.band
			});
		book.set(numbers.get(run.employmentId)!, rows);
	}
	return book;
}

/**
 * Every `(lineage, sealed version id)` a golden in the running file has actually priced.
 *
 * A golden names its version indirectly, through the period it runs — so a version sealed after
 * the golden was written is priced by nothing and nothing says so. `assertEveryVersionPriced`
 * reads this at the foot of each golden file. Recorded per process, which is what `node --test`
 * gives each file.
 */
const pricedVersions = new Set<string>();

/**
 * Fail if any sealed version of `code` was never priced by a golden in this file.
 *
 * A sealed version is a law in force. One with no golden is a law nothing checks, and the seed
 * bank's whole contract is that a law change means a new sealed version — so the versions are
 * exactly the thing coverage has to be measured against.
 */
export function assertEveryVersionPriced(code: Lineage): void {
	const missing = settingsVersions(code)
		.filter((version) => !pricedVersions.has(`${code}:${String(version.id)}`))
		.map((version) => String(version.effective_range.start).slice(0, 10));
	assert.deepEqual(
		missing,
		[],
		`${code} has sealed versions no golden in this file prices: ${missing.join(', ')}`
	);
}

export function assessStatutory(options: WorldOptions): StatutoryBook {
	const world = createStatutoryWorld(options);
	const prepared = Effect.runSync(
		gatherPayrollRun({
			api: memoryPayrollApi(world),
			companyId: COMPANY_ID,
			period: options.period
		})
	);
	pricedVersions.add(`${options.code}:${String(prepared.configuration.jurisdiction.id)}`);
	return indexStatutory(
		world.employments,
		buildPayrollRun(prepared).payslip_payroll_run.map((payslip) => ({
			employmentId: String(payslip.employment_id),
			charges: payslip.statutory.map((charge) => ({
				code: charge.scheme_code,
				base: charge.base_amount,
				employee: charge.employee_amount,
				employer: charge.employer_amount,
				band: charge.band_key
			}))
		}))
	);
}

export function assessStatutoryUnvalidated(options: WorldOptions): StatutoryBook {
	const world = createStatutoryWorld(options);
	const prepared = Effect.runSync(
		gatherPayrollRun({
			api: memoryPayrollApi(world),
			companyId: COMPANY_ID,
			period: options.period
		})
	);
	pricedVersions.add(`${options.code}:${String(prepared.configuration.jurisdiction.id)}`);
	const { measuredContracts, chargesByEmployment } = calculateFamilyAssessments({
		configuration: prepared.configuration,
		gathered: prepared.gathered,
		window: prepared.window,
		period: options.period
	});
	return indexStatutory(
		world.employments,
		measuredContracts.map((contract) => ({
			employmentId: contract.employment.id,
			charges: (chargesByEmployment.get(contract.employment.id) ?? []).map((charge) => ({
				code: charge.contribution.row.code,
				base: charge.base,
				employee: charge.employee,
				employer: charge.employer,
				band: charge.bandReference
			}))
		}))
	);
}

/** The scheme's charge for that person, or a failure naming what the run did produce. */
function priced(book: StatutoryBook, person: string, code: string): StatutoryCharge {
	const rows = book.get(person);
	assert.ok(rows, `no payslip for ${person}: the run produced ${[...book.keys()].join(', ')}`);
	const row = rows.get(code);
	assert.ok(
		row,
		`${person} has no ${code} charge; the run charged ${[...rows.keys()].join(', ')}. ` +
			'A scheme the person is outside produces no row at all — not a zero one.'
	);
	return row;
}

/** `expectStatutory(book, 'MY-5001', 'EPF', 561, 612)` — employee and employer shares. */
export function expectStatutory(
	book: StatutoryBook,
	person: string,
	code: string,
	employee: number,
	employer: number
): void {
	const row = priced(book, person, code);
	assert.deepEqual(
		{ employee: row.employee, employer: row.employer },
		{ employee, employer },
		`${person} × ${code} (base ${row.base}, band ${row.band ?? 'n/a'})`
	);
}

/** A scheme whose own `eligibility` excludes the person contributes nothing and appears nowhere. */
export function expectStatutorySkipped(book: StatutoryBook, person: string, code: string): void {
	const rows = book.get(person);
	assert.ok(rows, `no payslip for ${person}`);
	assert.equal(
		rows.has(code),
		false,
		`${person} should be outside ${code} entirely, but the run charged ` +
			JSON.stringify(rows.get(code))
	);
}

/** The chargeable base a scheme accumulated — the salary line, where nothing else is paid. */
export function expectStatutoryBase(
	book: StatutoryBook,
	person: string,
	code: string,
	base: number
): void {
	assert.equal(priced(book, person, code).base, base, `${person} × ${code} base`);
}
