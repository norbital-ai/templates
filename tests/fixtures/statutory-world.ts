// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A synthetic payroll world bound to one **sealed lineage of the template's public seed** at
 * `seed/jurisdiction/<CODE>/` — the same files the reset pipeline loads into a workspace.
 *
 * The point is to price a real statute rather than an invented one: the settings versions, the
 * contribution schemes with their published band tables, the work regime and its treatment grid are
 * the bank's own JSON, unedited. Everything else — the company, the people, their wages, their
 * registrations — is the smallest thing that makes a run happen: full attendance, no leave, no
 * allowances, no loans, one salary line.
 */

import { readdirSync } from 'node:fs';
import { readLawFile } from './law-file.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import {
	buildPayrollRun,
	gatherPayrollRun,
	type PreparedRun
} from '../../src/collections/payroll_runs/lib/engine.ts';
import { calculateFamilyAssessments } from '../../src/lib/payroll/families.ts';
import { prepareWorkContext } from '../../src/lib/payroll/work.ts';
import {
	dailyWorkedHours,
	nightWindowHours
} from '../../src/collections/payroll_runs/lib/overtime.ts';
import { derivedBreakMinutes, restBreakAssessment } from '../../src/lib/scheduling/rest-break.ts';
import { roundMinute } from '../../src/collections/payroll_runs/lib/rounding.ts';
import { offsetMinutesFor } from '../../src/lib/timezone.ts';
import {
	applicableLimits,
	funnelledLimitKeys,
	splitPlannedOvertime
} from '../../src/lib/scheduling/work-limits.ts';
import { decodeNumber } from '@norbital-ai/std/json';
import type { PayslipProration } from '../../src/datatypes/payslip_proration/+definition.ts';
import { memoryPayrollApi, type PayrollWorld } from './memory-payroll-api.ts';

const here = dirname(fileURLToPath(import.meta.url));
/** The template's public seed: the jurisdiction law the reset pipeline loads, read in place. */
const jurisdictionRoot = resolve(here, '../../seed/jurisdiction');

/**
 * Every lineage under `seed/jurisdiction/`, read from the directory.
 *
 * Listing them by hand means a lineage added to the public seed is silently absent from every test
 * that iterates them — the golden files would still pass, having never been asked about it.
 */
export const LINEAGES = readdirSync(jurisdictionRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort() as readonly Lineage[];

export type Lineage = 'MY' | 'MY-nihon' | 'PH' | 'SG' | 'VN' | 'TW' | 'ID';

function law(code: Lineage, file: string, options?: { optional: true }): any[] {
	return readLawFile(resolve(jurisdictionRoot, code, file), options);
}

export const settingsVersions = (code: Lineage) => law(code, 'jurisdiction_settings');
export const leaveCatalogue = (code: Lineage) => law(code, 'leave_catalogue');
/** The bank omits a column at its model default; the database fills it, so the world does too. */
export const contributionSchemes = (code: Lineage) =>
	law(code, 'statutory_contributions').map((row) => ({
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		...row
	}));
export const allowanceCatalogue = (code: Lineage) =>
	law(code, 'allowance_catalogue', { optional: true });
export const adhocCatalogue = (code: Lineage) => law(code, 'adhoc_catalogue', { optional: true });

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
	/** An exact birth date, for a test that needs one measured in months; overrides `age`. */
	readonly birth_date?: string;
	readonly gender?: string;
	/** `employees.receiving_pension`. */
	readonly receiving_pension?: boolean;
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
	/** `employment.classification`; `EA_COVERED` unless stated. */
	readonly work_classification?: string;
	readonly hire_date?: string;
	/** The last employed day; the fixture closes the employment and its terms on it. */
	readonly exit_date?: string;
	/** `employments.exit_reason`, the separation bands' gate. */
	readonly exit_reason?: string;
	/**
	 * Per-scheme registration: a code mapped to `NOT_REGISTERED`, a flat rate override, or the
	 * employment's declared elections under that scheme (e.g. `shg_opt_out`).
	 */
	readonly registrations?: Readonly<
		Record<
			string,
			{
				readonly kind: string;
				/** Force the declaration person-wide or bind it to this synthetic employment. */
				readonly scope?: 'EMPLOYMENT' | 'PERSON';
				readonly rate_override?: number | null;
				readonly first_contribution_due_on?: string | null;
				readonly elections?: Readonly<Record<string, boolean | number | string>>;
				readonly deduction_claims?: ReadonlyArray<{
					period: string;
					category: string;
					amount: number;
					source: 'EMPLOYEE' | 'PRIOR_EMPLOYER';
					reference: string;
				}>;
				readonly child_claims?: ReadonlyArray<{
					readonly year: string;
					readonly relief_class: string;
					readonly full_count: number;
					readonly half_count: number;
					readonly reference: string;
				}>;
				/** An earlier employer's figures for a tax year (MY TP3, PH 2316). */
				readonly opening?: ReadonlyArray<{
					readonly year: string;
					readonly base: number;
					readonly employee: number;
					readonly employer: number;
					readonly rebate?: number;
					readonly ordinary?: number | null;
					readonly months?: number | null;
					readonly reference: string;
				}>;
			}
		>
	>;
	/** The cadence the contract is paid on; `MONTHLY` unless stated. */
	readonly pay_frequency?: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY' | 'DAILY' | 'HOURLY';
	readonly employment_type?: string;
	readonly pass_type?: string | null;
	readonly tax_residency?: string | null;
	readonly disabled?: boolean;
	/** Recorded children with their own facts, where `children` (a count) is not enough. */
	readonly child_rows?: ReadonlyArray<{
		readonly child_birthdate: string;
		readonly citizenship?: string | null;
		readonly relief_class?: string | null;
	}>;
};

export type WorldOptions = {
	readonly code: Lineage;
	/** The company's own `settings_code`; defaults to the lineage's own code. */
	readonly settingsCode?: string;
	/**
	 * `YYYY-MM`. The window is [21st of the previous month, 20th of this one]. A `SEMI_MONTHLY`
	 * company runs halves, `YYYY-MM-1` / `YYYY-MM-2`.
	 */
	readonly period: string;
	/** The company's calendar; `MONTHLY` unless stated. */
	readonly payFrequency?: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY';
	readonly people: readonly Person[];
	/** VN and ID band their minimum wage by region; `companies.region` picks it. */
	readonly region?: string | null;
	readonly riskClass?: string | null;
	/** The entity's recorded facts (`company.facts.<key>`), where a rule turns on one. */
	readonly companyFacts?: Readonly<Record<string, string | number | boolean>>;
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

/**
 * The departure declarations MY and SG require (round 5, D15), answered as the plain case: not
 * leaving the country, no misconduct, a resignation with no notice question settled either way
 * (MY: not without notice; SG: notice not served). A test that turns on one states it.
 */
function exitFactsFor(code: Lineage, person: Person): { exit_facts?: Record<string, boolean> } {
	const reason = person.exit_reason;
	const facts: Record<string, boolean> = {};
	if (code === 'MY' || code === 'MY-nihon') {
		if (person.citizenship === 'CITIZEN' && reason !== 'RETIREMENT' && reason !== 'DEATH')
			facts.leaving_malaysia = false;
		if (reason === 'RESIGNATION') facts.terminated_without_notice = false;
	}
	if (code === 'SG') {
		if (person.citizenship === 'PERMANENT_RESIDENT') facts.leaving_singapore = false;
		if (reason === 'RESIGNATION') facts.notice_served = false;
	}
	if ((code === 'MY' || code === 'MY-nihon' || code === 'SG') && reason === 'DISMISSAL')
		facts.misconduct_dismissal = false;
	return Object.keys(facts).length === 0 ? {} : { exit_facts: facts };
}

export function createStatutoryWorld(options: WorldOptions): PayrollWorld {
	const { code, period } = options;
	const versions = settingsVersions(code);
	const jurisdictionCode = versions[0]!.jurisdiction_code;
	const schemes = contributionSchemes(code);
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
		date_of_birth: person.birth_date ?? birthDateFor(person.age ?? 40, period),
		// Unrecorded unless stated: a predicate that turns on gender must be given one explicitly.
		// VN refuses a foreigner, and ID a married resident, whose gender is unrecorded; synthetic
		// cases there are men unless stated, the reading those lineages took before they refused.
		gender:
			person.gender ??
			((code === 'VN' && person.citizenship === 'FOREIGNER') ||
			(code === 'ID' && person.marital_status === 'MARRIED')
				? 'MALE'
				: ''),
		marital_status: person.marital_status ?? 'SINGLE',
		spouse_status: person.spouse_status ?? 'NONE',
		receiving_pension: person.receiving_pension ?? false,
		solo_parent: person.solo_parent ?? false,
		disabled: person.disabled ?? false,
		// SG warns of an unrecorded race (citizens and PRs) or religion under the SHG funds; synthetic
		// SG cases are outside every fund unless stated.
		race: person.race ?? (code === 'SG' ? 'OTHERS' : null),
		religion: person.religion ?? (code === 'SG' ? 'NONE' : null),
		dependents_count: person.children ?? 0,
		children:
			person.child_rows == null
				? childrenOf(person.children ?? 0, period)
				: person.child_rows.map((child) => ({
						child_birthdate: child.child_birthdate,
						relationship: 'CHILD' as const,
						effective_range: null,
						citizenship: child.citizenship ?? null,
						relief_class: child.relief_class ?? null
					})),
		approval_id: null
	}));

	const employments = people.map((person, index) => ({
		id: employmentIds[index]!,
		employee_id: employees[index]!.id,
		company_id: COMPANY_ID,
		employee_number: person.key,
		bank: null,
		effective_range: { start: person.hire_date ?? '2015-01-01', end: person.exit_date ?? null },
		exit_reason: person.exit_reason ?? null,
		...(person.exit_reason == null ? {} : exitFactsFor(code, person)),
		approval_id: null
	}));

	const terms = people.map((person, index) => ({
		id: `b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		employment_id: employmentIds[index]!,
		base_salary: { value: person.wage, currency: versions[0]!.payroll.currency },
		pay_frequency: person.pay_frequency ?? 'MONTHLY',
		work_classification: person.work_classification ?? 'EA_COVERED',
		statutory_work_category: person.statutory_work_category ?? 'NON_MANUAL',
		employment_type: person.employment_type ?? 'PERMANENT',
		// VN, ID, TW and SG refuse an unrecorded citizenship; synthetic cases there are citizens unless stated.
		residency_status:
			person.citizenship === undefined &&
			(code === 'VN' || code === 'ID' || code === 'TW' || code === 'SG')
				? 'CITIZEN'
				: (person.citizenship ?? null),
		residency_since: person.residency_since ?? null,
		// A synthetic VN foreigner holds a work permit unless stated (Law 41/2024 art.2(2)).
		// A synthetic TW foreigner is a foreign professional (not a migrant worker) unless stated.
		pass_type:
			person.pass_type ??
			(code === 'VN' && person.citizenship === 'FOREIGNER'
				? 'WORK_PERMIT'
				: code === 'TW' && person.citizenship === 'FOREIGNER'
					? 'OTHER'
					: null),
		// Synthetic golden cases declare tax residence. Explicit null tests missing declarations.
		tax_residency:
			person.tax_residency === undefined &&
			(code === 'MY' ||
				code === 'MY-nihon' ||
				code === 'TW' ||
				code === 'PH' ||
				code === 'VN' ||
				code === 'ID')
				? code === 'TW' && person.citizenship === 'FOREIGNER'
					? 'NON_RESIDENT'
					: 'RESIDENT'
				: (person.tax_residency ?? null),
		notice_days: null,
		department: null,
		job_title: 'Fixture',
		grade: person.grade ?? null,
		payroll_group: null,
		paid_rest_days: false,
		shift_pattern_id: PATTERN_ID,
		effective_range: { start: person.hire_date ?? '2015-01-01', end: person.exit_date ?? null },
		approval_id: null
	}));

	// Every scheme the version levies gets an explicit REGISTERED row, so a scheme that only charges
	// a registered employment is charged and a NOT_REGISTERED case is a deliberate override rather
	// than an absence of data.
	const facts: PayrollWorld['employment_statutory_facts'] = [];
	const taiwanVersion =
		code === 'TW'
			? versions.find(
					(version) =>
						String(version.effective_range.start).slice(0, 7) <= period.slice(0, 7) &&
						(version.effective_range.end == null ||
							String(version.effective_range.end).slice(0, 10) > `${period.slice(0, 7)}-01`)
				)
			: null;
	// Synthetic initial declarations use the published grade choices. Tests of changed pay,
	// variable wages or insurer notices must change the dated declaration independently.
	const taiwanInsuredAmount = (person: Person, schemeCode: string): number | undefined => {
		if (taiwanVersion == null) return undefined;
		const scheme = schemes.find(
			(row) => row.code === schemeCode && row.settings_id === taiwanVersion.id
		);
		const choices = scheme?.elections.find((field) => field.key === 'insured_amount')?.options;
		if (choices == null) return undefined;
		const floor = taiwanVersion.work_rules.wages.by_region.Taiwan;
		const lowerGrades =
			person.employment_type === 'PART_TIME' &&
			['LI', 'EI', 'LABOR_PENSION', 'WAGE_ARREARS_BASE'].includes(schemeCode);
		const grades = choices.filter(
			(amount) =>
				// 115年度 replaces the 28,800 grade with 29,500; lower part-time grades remain.
				(period.slice(0, 7) < '2026-01' ? amount !== 29500 : amount !== 28800) &&
				(lowerGrades || amount >= floor)
		);
		const monthly =
			person.wage *
			(person.pay_frequency === 'HOURLY'
				? 240
				: person.pay_frequency === 'DAILY'
					? 30
					: person.pay_frequency === 'WEEKLY'
						? 6
						: 1);
		return grades.find((amount) => amount >= monthly) ?? grades.at(-1);
	};
	for (const [index, person] of people.entries())
		for (const scheme of schemes) {
			const declared = person.registrations?.[scheme.code];
			const insuredAmount = taiwanInsuredAmount(person, scheme.code);
			const employmentScoped =
				declared?.scope === 'EMPLOYMENT' ||
				(declared?.scope !== 'PERSON' &&
					scheme.elections.some(
						(field) =>
							field.scope === 'EMPLOYMENT' && Object.hasOwn(declared?.elections ?? {}, field.key)
					));
			const [birthYear, birthMonth, birthDay] =
				employees[index]!.date_of_birth.split('-').map(Number);
			const adult = new Date(Date.UTC(birthYear! + 18, birthMonth! - 1, birthDay!))
				.toISOString()
				.slice(0, 10);
			const firstDue =
				scheme.code === 'EIS'
					? [person.hire_date ?? '2015-01-01', '2018-01-01', adult].sort().at(-1)!
					: (person.hire_date ?? '2015-01-01');
			facts.push({
				id: `f-${index}-${scheme.id}`,
				employee_id: employees[index]!.id,
				employment_id: employmentScoped ? employmentIds[index]! : null,
				statutory_contribution_id: scheme.id,
				status: {
					kind: declared?.kind ?? 'REGISTERED',
					reference_number: 'FIXTURE',
					rate_override: declared?.rate_override ?? null,
					elections: {
						...(insuredAmount == null ? {} : { insured_amount: insuredAmount }),
						// Synthetic unpaid-leave cases explicitly state whether continuation was agreed.
						...(code === 'VN' && scheme.code === 'SI' ? { continue_si_unpaid: false } : {}),
						// Synthetic VN and ID cases declare what those versions require of every employee:
						// pension qualification and union membership (VN), and the PTKP status, dependants
						// and tax identity at 1 January (ID) — the values the family record would suggest.
						...(code === 'VN' && scheme.code === 'UI' ? { pension_qualified: false } : {}),
						...(code === 'VN' && scheme.code === 'UNION_DUES' ? { union_member: false } : {}),
						...(code === 'ID' && scheme.code === 'PPH21'
							? {
									ptkp_marital_status: person.marital_status ?? 'SINGLE',
									ptkp_dependants: person.children ?? 0,
									no_tax_id: false
								}
							: {}),
						// Synthetic Taiwan table cases have an explicit withholding declaration.
						// Production family records alone do not establish this exemption count.
						...(code === 'TW' && scheme.code === 'INCOME_TAX'
							? {
									table_declaration_reference: 'FIXTURE-TABLE-DECLARATION',
									table_dependants:
										(person.children ?? 0) + (person.spouse_status === 'WITHOUT_INCOME' ? 1 : 0)
								}
							: {}),
						...(code === 'TW' && scheme.code === 'NHI'
							? {
									enrolled_dependants:
										(person.children ?? 0) + (person.spouse_status === 'WITHOUT_INCOME' ? 1 : 0)
								}
							: {}),
						...declared?.elections
					},
					...(declared?.deduction_claims == null
						? {}
						: { deduction_claims: declared.deduction_claims }),
					...(declared?.child_claims == null ? {} : { child_claims: declared.child_claims }),
					...(declared?.opening == null ? {} : { opening: declared.opening }),
					// Synthetic registration and liability dates remain independent inputs.
					since: person.hire_date ?? '2015-01-01',
					first_contribution_due_on:
						declared?.first_contribution_due_on === undefined
							? firstDue > monthEnd(period)
								? null
								: firstDue
							: declared.first_contribution_due_on,
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
				pay_frequency: options.payFrequency ?? 'MONTHLY',
				// A Philippine entity is in CALABARZON unless the test says otherwise: the wage order the
				// seeded salaries are built on (IVA-22), and the floor RA 9504's exemption reads.
				region: options.region ?? (code === 'PH' ? 'IV-A' : null),
				risk_class: options.riskClass ?? null,
				// PH declares both establishment-size exemptions as required entity facts.
				facts:
					code === 'PH'
						? {
								small_establishment: false,
								retirement_exempt_establishment: false,
								...options.companyFacts
							}
						: (options.companyFacts ?? {}),
				effective_range: RANGE,
				approval_id: null
			}
		],
		jurisdiction_settings: versions,
		statutory_contributions: schemes,
		loan_catalogue: [],
		claim_catalogue: [],
		allowance_catalogue: allowanceCatalogue(code),
		adhoc_catalogue: adhocCatalogue(code),
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
					days: [
						{ roster_code_id: SHIFT_ID },
						{ roster_code_id: SHIFT_ID },
						{ roster_code_id: SHIFT_ID },
						{ roster_code_id: SHIFT_ID },
						{ roster_code_id: SHIFT_ID },
						{ roster_code_id: REST_ID },
						{ roster_code_id: REST_ID }
					]
				},
				effective_range: { start: '2000-01-03', end: null },
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
		allowances: [],
		adhoc_requests: [],
		loans: [],
		loan_repayments: [],
		work_days: [],
		payroll_runs: [],
		payslips: []
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

export function assessStatutory(
	options: WorldOptions,
	/** Seed prior runs and payslips a year-end reconciliation reads as year-to-date. */
	prepareWorld?: (world: PayrollWorld, period: string) => void
): StatutoryBook {
	const world = createStatutoryWorld(options);
	prepareWorld?.(world, options.period);
	const prepared = Effect.runSync(
		gatherPayrollRun({
			api: memoryPayrollApi(world),
			companyId: COMPANY_ID,
			period: options.period
		})
	);
	pricedVersions.add(`${options.code}:${String(prepared.configuration.jurisdiction.id)}`);
	const built = buildPayrollRun(prepared);
	const book = indexStatutory(
		world.employments,
		built.payslip_payroll_run.map((payslip) => ({
			employmentId: String(payslip.employment_id),
			charges: payslip.statutory.map((charge) => ({
				code: charge.scheme_code,
				base: charge.base_amount,
				employee: charge.employee_amount,
				employer: charge.employer_amount,
				band: charge.rule_when
			}))
		}))
	);
	// The entity's own levies, charged once on the run, under the COMPANY key — where it has any.
	if (built.company_charges.length > 0)
		book.set(
			COMPANY,
			new Map(
				built.company_charges.map((charge) => [
					charge.scheme_code,
					{
						base: charge.base_amount,
						employee: charge.employee_amount,
						employer: charge.employer_amount,
						band: charge.rule_when
					}
				])
			)
		);
	return book;
}

/** The book's key for the COMPANY-scope schemes: one row for the run, on no payslip. */
export const COMPANY = '__company__';

/** One built payslip, keyed by the employee number the golden names. */
export type BuiltPayslip = ReturnType<typeof buildPayrollRun>['payslip_payroll_run'][number];

/**
 * Plans each punched day's clocked overtime, stored as the `work_days` transform would store it.
 *
 * These suites price statutes — bands, rates, rest-day and holiday multiples — not the plan. Since
 * overtime is planned (owner's rule, 2026-09-23), a day pays only its planned entries, so the
 * fixtures state each punched day's clock as its plan, in one place: the hours beyond the normal
 * day on an ordinary day, every worked hour on a rest, off or holiday day. The total is then split
 * the way the transform splits it (`splitPlannedOvertime`, over the version's limits that split),
 * so what the payroll-time funnel used to move to INCENTIVE is stored as incentive hours instead.
 * A fixture that plans a day itself can do so before this runs.
 *
 * The resolved schedule is the engine's own (`prepareWorkContext`), so the boundary is the day the
 * run will price — shift, holiday and pattern included — and never a fixture's idea of a normal day.
 */
function keyClockOverruns(prepared: PreparedRun): void {
	for (const bundle of prepared.gathered.bundles) {
		const punched = bundle.workDays.filter((entry) => entry.worked_intervals != null);
		if (punched.length === 0) continue;
		const work = prepareWorkContext({
			bundle,
			configuration: prepared.configuration,
			salary: prepared.window.salary,
			employed: bundle.employedDays ?? bundle.attendance
		});
		const planned = new Map<string, (typeof punched)[number]>();
		for (const entry of punched) {
			if (entry.approved_overtime_hours != null) continue;
			const workDate = String(entry.work_date).slice(0, 10);
			const day = work.schedule.get(workDate);
			if (day == null) continue;
			const clocked = {
				...entry,
				break_minutes: derivedBreakMinutes(entry.worked_intervals, day.shift?.break_minutes ?? 0)
			};
			const offset = offsetMinutesFor(
				prepared.configuration.jurisdiction.payroll.timezone,
				workDate
			);
			const observed = dailyWorkedHours(clocked, day, offset);
			// A rest, off or holiday day plans every worked hour, less a statutory break the day owed
			// and did not take where the statute says it is not work (ID ps.79(2)(a)).
			const night = prepared.configuration.nightPremium;
			const measuredNight =
				night == null ? null : nightWindowHours(clocked, night, day.shift, offset);
			const shortfall = restBreakAssessment({
				intervals: entry.worked_intervals ?? [],
				breakMinutes: clocked.break_minutes,
				breaks: prepared.configuration.breaks,
				overtimeHours: observed,
				nightHours: measuredNight == null ? 0 : measuredNight.ordinary + measuredNight.overtime,
				person: work.subject
			});
			const unpaid =
				shortfall.rule?.counts_as_worked_time === false
					? (shortfall.shortfallMinutes ?? 0) / 60
					: 0;
			entry.approved_overtime_hours = roundMinute(
				Math.max(0, day.dayType === 'ORDINARY' ? observed - day.normalHours : observed - unpaid)
			);
			planned.set(workDate, entry);
		}
		if (planned.size === 0) continue;
		const limits = applicableLimits(prepared.configuration.limits, work.subject);
		const split = splitPlannedOvertime({
			days: [...work.schedule.values()].map((day) => ({
				date: day.date,
				kind: day.restDay ? 'REST' : day.shift != null ? 'WORK' : 'OFF',
				paid_minutes: day.shift?.paid_minutes ?? 0,
				break_minutes: day.shift?.break_minutes ?? 0,
				spread_hours: 0,
				holiday: day.dayType === 'PUBLIC_HOLIDAY' || day.dayType === 'SPECIAL_HOLIDAY',
				emergency:
					bundle.workDays.find((entry) => String(entry.work_date).startsWith(day.date))
						?.emergency_cause === true,
				total_overtime_hours: decodeNumber(
					bundle.workDays.find((entry) => String(entry.work_date).startsWith(day.date))
						?.approved_overtime_hours ?? 0
				)
			})),
			limits,
			caps: funnelledLimitKeys(prepared.configuration.work, limits),
			cutoffDay: prepared.configuration.company.pay_cutoff_day
		});
		for (const [date, entry] of planned) {
			const row = split.get(date);
			if (row == null) continue;
			entry.approved_overtime_hours = row.approved_overtime_hours;
			entry.incentive_hours = row.incentive_hours;
		}
	}
}

/**
 * The whole run — every payslip with its base, proration, adjustments and charges, and the run's
 * warnings — for a golden that prices the pay side of a statute (overtime bands, the ordinary
 * rate, proration, absence) rather than a contribution scheme. `prepareWorld` is where a test
 * plants the work days and holidays the world starts without.
 */
export function buildStatutory(
	options: WorldOptions,
	prepareWorld?: (world: PayrollWorld, period: string) => void
): {
	readonly slips: Map<string, BuiltPayslip>;
	/** The allowance lines each payslip priced: the base line's segments, by class code. */
	readonly allowances: Map<string, readonly PayslipProration[]>;
	readonly warnings: readonly string[];
	/** The entity's own levies, charged once on the run: `[base, employer]` by scheme code. */
	readonly companyCharges: Map<string, readonly [number, number]>;
	readonly trace: ReturnType<typeof buildPayrollRun>['calculation_trace'];
} {
	const world = createStatutoryWorld(options);
	prepareWorld?.(world, options.period);
	const prepared = Effect.runSync(
		gatherPayrollRun({
			api: memoryPayrollApi(world),
			companyId: COMPANY_ID,
			period: options.period
		})
	);
	keyClockOverruns(prepared);
	pricedVersions.add(`${options.code}:${String(prepared.configuration.jurisdiction.id)}`);
	const built = buildPayrollRun(prepared);
	const numbers = new Map(
		world.employments.map((row) => [String(row.id), String(row.employee_number)])
	);
	const slips = new Map(
		built.payslip_payroll_run.map((slip) => [numbers.get(String(slip.employment_id))!, slip])
	);
	return {
		slips,
		trace: built.calculation_trace,
		allowances: new Map(
			[...slips].map(([key, slip]) => [
				key,
				slip.proration.filter(
					(segment) =>
						prepared.configuration.catalogueComponents.find(
							(component) => component.code === segment.component_code
						)?.family === 'ALLOWANCE'
				)
			])
		),
		warnings: built.warnings,
		companyCharges: new Map(
			built.company_charges.map((charge) => [
				charge.scheme_code,
				[charge.base_amount, charge.employer_amount] as const
			])
		)
	};
}

export function assessStatutoryUnvalidated(
	options: WorldOptions,
	prepareWorld?: (world: PayrollWorld, period: string) => void
): StatutoryBook {
	const world = createStatutoryWorld(options);
	prepareWorld?.(world, options.period);
	const prepared = Effect.runSync(
		gatherPayrollRun({
			api: memoryPayrollApi(world),
			companyId: COMPANY_ID,
			period: options.period
		})
	);
	keyClockOverruns(prepared);
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
				band: charge.ruleReference
			}))
		}))
	);
}

/** The scheme's charge for that person, or a failure naming what the run did produce. */
/** The charge one person carries for one scheme; refuses by name when the book has none. */
export function chargeOf(book: StatutoryBook, person: string, code: string): StatutoryCharge {
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
	const row = chargeOf(book, person, code);
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
	assert.equal(chargeOf(book, person, code).base, base, `${person} × ${code} base`);
}
