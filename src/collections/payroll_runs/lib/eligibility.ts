/**
 * Shared CEL eligibility for family catalogues and entitlement bands.
 *
 * Rules evaluate the person, contract terms and child facts on the input date. The context
 * carries empty strings and zeros for missing facts. An empty expression includes everyone;
 * an ineligible entry produces no pay item, and an ineligible date earns no leave.
 *
 * employee.gender  employee.age  employee.citizenship  employee.marital_status  employee.spouse_status
 * terms.ordinary_hours_per_week  terms.working_days_per_week
 * employee.solo_parent  employee.race  employee.religion  employee.residency_months
 * employment.type  employment.classification  employment.service_months  employment.service_start
 * terms.basic_salary  terms.workman  terms.department  terms.payroll_group  terms.grade
 * children.count  children.under(age)  company.region
 *
 * compileEligibility validates syntax, available context members and a boolean result when
 * the catalogue is written. Jurisdiction standing comes from the effective contract terms.
 */

import { Effect } from 'effect';
import { createReckonEngine, type ComputationDefinition } from '@norbital-ai/std/reckon';
import { decodeNumber } from '@norbital-ai/std/json';
import { completedMonths, completedYears } from './dates.js';
import { dateKey } from '../../../lib/iso-day.js';
import { compileExpression } from '../../../lib/expressions/compile.js';
import { childUnder } from '../../../lib/expressions/child-under.js';

/** The person, as an expression sees them. Every key is present; nothing is null. */
export type PersonContext = {
	readonly employee: {
		readonly gender: string;
		readonly age: number;
		readonly citizenship: string;
		readonly marital_status: string;
		/** `NONE` | `WITHOUT_INCOME` | `WITH_INCOME` — whether a spouse has income of their own. */
		readonly spouse_status: string;
		/** Recorded dependants, the count statutory relief and household schemes charge for. */
		readonly dependents_count: number;
		readonly solo_parent: boolean;
		readonly race: string;
		readonly religion: string;
		/** Completed months since `employment_terms.residency_since` on the rule date; 0 when unrecorded. */
		readonly residency_months: number;
	};
	readonly employment: {
		readonly type: string;
		readonly classification: string;
		readonly service_months: number;
		/** Completed years of service on the rule date; separation payments count in these. */
		readonly service_years: number;
		/** First day of the stint, `YYYY-MM-DD`; service is measured from it. */
		readonly service_start: string;
		/** Last day of work, or empty while the stint is open. */
		readonly exit_date: string;
		/** `employments.exit_reason`, or empty while the stint is open or unrecorded. */
		readonly exit_reason: string;
	};
	readonly terms: {
		readonly basic_salary: number;
		/** Standing PAY allowances in force on the rule date; 0 where the caller knows none. */
		readonly fixed_allowances: number;
		/** Basic plus the fixed allowances: "one month's wage" where a statute says so. */
		readonly monthly_wage: number;
		readonly workman: boolean;
		/** The statutory work category itself, for an overtime predicate that names one. */
		readonly statutory_work_category: string;
		/** Basic plus every other cash payment for work settling in the run; 0 outside payroll. */
		readonly statutory_wages: number;
		readonly department: string;
		readonly payroll_group: string;
		readonly grade: string;
		/**
		 * The working week this contract actually works, derived from the roster rather than typed.
		 *
		 * A statutory rate can turn on it — the Philippine day factor is 261 annual days for a
		 * five-day week and 313 for a six-day one (DOLE Handbook ch.2), which is employee-level law
		 * and cannot be a company-wide divisor. Zero where no workload has been measured, which no
		 * seeded predicate should match on.
		 */
		readonly ordinary_hours_per_week: number;
		readonly working_days_per_week: number;
	};
	readonly children: {
		readonly count: number;
		/** Completed years of each child on the rule date; `children.under(age)` counts these. */
		readonly ages: readonly number[];
	};
	readonly company: {
		readonly region: string;
	};
	/** The pay month, where a rate divisor turns on it; zero outside payroll. */
	readonly period: { readonly working_days: number };
};

type PersonInput = {
	readonly employee: {
		readonly gender?: string | null;
		readonly date_of_birth?: string | null;
		readonly nationality?: string | null;
		readonly marital_status?: string | null;
		readonly spouse_status?: string | null;
		readonly dependents_count?: unknown;
		readonly solo_parent?: boolean | null;
		readonly race?: string | null;
		readonly religion?: string | null;
	} | null;
	readonly employment: {
		readonly service_start: string;
		readonly exit_date?: string | null;
		readonly exit_reason?: string | null;
	};
	/** Standing PAY allowances in force on `asOf`, summed; see `fixedAllowancesOn`. */
	readonly fixedAllowances?: number | null;
	readonly terms: {
		readonly residency_status?: string | null;
		readonly employment_type?: string | null;
		readonly work_classification?: string | null;
		readonly base_salary?: unknown;
		readonly statutory_work_category?: string | null;
		readonly department?: string | null;
		readonly payroll_group?: string | null;
		readonly grade?: string | null;
		readonly residency_since?: string | null;
	} | null;
	/**
	 * The working week the roster produced, where one has been measured. Separate from `terms`
	 * because it is derived from the workload rather than stated on the contract row.
	 */
	readonly week?: {
		readonly ordinary_hours_per_week?: number | null;
		readonly working_days_per_week?: number | null;
	} | null;
	/** The employing entity; `company.region` picks its minimum wage. Absent reads as no region. */
	readonly company?: { readonly region?: string | null } | null;
	/** The statutory wage comparand this run derived, where one is known. */
	readonly statutoryWages?: number | null;
	/** The pay month's scheduled working days, where a run knows them. */
	readonly period?: { readonly working_days?: number | null } | null;
	readonly children?: ReadonlyArray<{ readonly child_birthdate: string }>;
	/** The rule date: service, age and children are measured on it. */
	readonly asOf: string;
};

/** The person context on one date, from approved contract and personal facts. */
export function personContext(input: PersonInput): PersonContext {
	const start = dateKey(input.employment.service_start);
	const born = dateKey(input.employee?.date_of_birth);
	const residency = dateKey(input.terms?.residency_since);
	const salary = input.terms?.base_salary as { value?: unknown } | null | undefined;
	const basic = salary == null ? 0 : decodeNumber(salary.value);
	const fixed = decodeNumber(input.fixedAllowances ?? 0);
	const exit = dateKey(input.employment.exit_date);
	const ages = (input.children ?? [])
		.map((child) => dateKey(child.child_birthdate))
		.filter((birth) => birth !== '' && birth <= input.asOf)
		.map((birth) => completedYears(birth, input.asOf));
	return {
		employee: {
			gender: input.employee?.gender ?? '',
			age: born === '' ? 0 : completedYears(born, input.asOf),
			// Effective contract terms hold jurisdiction-relative standing. A concurrent contract
			// elsewhere may have different standing; nationality is not a substitute.
			citizenship: input.terms?.residency_status ?? '',
			marital_status: input.employee?.marital_status ?? '',
			// A tax category that turns on whether a spouse has income of their own — Malaysia's MTD
			// Category 2 against Category 3 — cannot be told from marital status alone.
			spouse_status: input.employee?.spouse_status ?? '',
			dependents_count: decodeNumber(input.employee?.dependents_count ?? 0),
			solo_parent: input.employee?.solo_parent === true,
			race: input.employee?.race ?? '',
			religion: input.employee?.religion ?? '',
			residency_months:
				residency === '' || residency > input.asOf ? 0 : completedMonths(residency, input.asOf)
		},
		employment: {
			type: input.terms?.employment_type ?? '',
			classification: input.terms?.work_classification ?? '',
			service_months: start === '' ? 0 : completedMonths(start, input.asOf),
			service_years: start === '' ? 0 : completedYears(start, input.asOf),
			service_start: start,
			exit_date: exit,
			exit_reason: input.employment.exit_reason ?? ''
		},
		terms: {
			basic_salary: basic,
			fixed_allowances: fixed,
			monthly_wage: basic + fixed,
			workman: (input.terms?.statutory_work_category ?? '').startsWith('MANUAL_LABOUR'),
			statutory_work_category: input.terms?.statutory_work_category ?? '',
			statutory_wages: decodeNumber(input.statutoryWages ?? 0),
			department: input.terms?.department ?? '',
			payroll_group: input.terms?.payroll_group ?? '',
			grade: input.terms?.grade ?? '',
			ordinary_hours_per_week: input.week?.ordinary_hours_per_week ?? 0,
			working_days_per_week: input.week?.working_days_per_week ?? 0
		},
		children: { count: ages.length, ages },
		company: { region: input.company?.region ?? '' },
		period: { working_days: decodeNumber(input.period?.working_days ?? 0) }
	};
}

/** `children.under(n)`: see `lib/expressions/child-under.ts` for why the count is a BigInt. */
const engine = createReckonEngine().registerFunction('under', 'map.under(int): int', childUnder);

function evaluate(expression: string, context: PersonContext): unknown {
	const definition: ComputationDefinition = {
		id: 'eligibility',
		tables: {},
		exprs: { eligible: expression },
		outputs: ['eligible']
	};
	// Same shape as a formula fault: the engine's own error, unwrapped.
	return Effect.runSync(
		Effect.try({
			try: () => engine.runComputation<PersonContext, { eligible: unknown }>(definition, context),
			catch: (error) => error
		})
	).outputs.eligible;
}

/** Whether the person satisfies the expression. `''` is everyone. */
export function isEligible(expression: string | null | undefined, context: PersonContext): boolean {
	const expr = (expression ?? '').trim();
	if (expr === '') return true;
	return evaluate(expr, context) === true;
}

/**
 * The sentence that refuses a malformed expression, or `null` when it compiles. Parsed by
 * Reckon, checked against the person context's members, and evaluated against a blank person:
 * the result must be a boolean. The context itself is `lib/expressions`.
 */
export function compileEligibility(expression: string | null | undefined): string | null {
	return compileExpression({ expression, site: 'person', type: 'boolean' });
}
