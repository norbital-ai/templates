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
 * employment.type  employment.classification  employment.service_months  employment.hire_date
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

/** The person, as an expression sees them. Every key is present; nothing is null. */
export type PersonContext = {
	readonly employee: {
		readonly gender: string;
		readonly age: number;
		readonly citizenship: string;
		readonly marital_status: string;
		/** `NONE` | `WITHOUT_INCOME` | `WITH_INCOME` — whether a spouse has income of their own. */
		readonly spouse_status: string;
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
		readonly hire_date: string;
	};
	readonly terms: {
		readonly basic_salary: number;
		readonly workman: boolean;
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
};

/** The member names each root may be asked for, checked at write time. */
const CONTEXT_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = {
	employee: new Set([
		'gender',
		'age',
		'citizenship',
		'marital_status',
		'spouse_status',
		'solo_parent',
		'race',
		'religion',
		'residency_months'
	]),
	employment: new Set(['type', 'classification', 'service_months', 'hire_date']),
	terms: new Set([
		'basic_salary',
		'workman',
		'department',
		'payroll_group',
		'grade',
		'ordinary_hours_per_week',
		'working_days_per_week'
	]),
	children: new Set(['count', 'under']),
	company: new Set(['region'])
};

/** A person with nothing recorded: what a new expression is compiled against. */
const BLANK_PERSON: PersonContext = {
	employee: {
		gender: '',
		age: 0,
		citizenship: '',
		marital_status: '',
		spouse_status: '',
		solo_parent: false,
		race: '',
		religion: '',
		residency_months: 0
	},
	employment: { type: '', classification: '', service_months: 0, hire_date: '' },
	terms: {
		basic_salary: 0,
		workman: false,
		department: '',
		payroll_group: '',
		grade: '',
		ordinary_hours_per_week: 0,
		working_days_per_week: 0
	},
	children: { count: 0, ages: [] },
	company: { region: '' }
};

type PersonInput = {
	readonly employee: {
		readonly gender?: string | null;
		readonly date_of_birth?: string | null;
		readonly nationality?: string | null;
		readonly marital_status?: string | null;
		readonly spouse_status?: string | null;
		readonly solo_parent?: boolean | null;
		readonly race?: string | null;
		readonly religion?: string | null;
	} | null;
	readonly employment: { readonly hire_date: string };
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
	readonly children?: ReadonlyArray<{ readonly child_birthdate: string }>;
	/** The rule date: service, age and children are measured on it. */
	readonly asOf: string;
};

/** The person context on one date, from approved contract and personal facts. */
export function personContext(input: PersonInput): PersonContext {
	const hire = dateKey(input.employment.hire_date);
	const born = dateKey(input.employee?.date_of_birth);
	const residency = dateKey(input.terms?.residency_since);
	const salary = input.terms?.base_salary as { value?: unknown } | null | undefined;
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
			solo_parent: input.employee?.solo_parent === true,
			race: input.employee?.race ?? '',
			religion: input.employee?.religion ?? '',
			residency_months:
				residency === '' || residency > input.asOf ? 0 : completedMonths(residency, input.asOf)
		},
		employment: {
			type: input.terms?.employment_type ?? '',
			classification: input.terms?.work_classification ?? '',
			service_months: hire === '' ? 0 : completedMonths(hire, input.asOf),
			hire_date: hire
		},
		terms: {
			basic_salary: salary == null ? 0 : decodeNumber(salary.value),
			workman: (input.terms?.statutory_work_category ?? '').startsWith('MANUAL_LABOUR'),
			department: input.terms?.department ?? '',
			payroll_group: input.terms?.payroll_group ?? '',
			grade: input.terms?.grade ?? '',
			ordinary_hours_per_week: input.week?.ordinary_hours_per_week ?? 0,
			working_days_per_week: input.week?.working_days_per_week ?? 0
		},
		children: { count: ages.length, ages },
		company: { region: input.company?.region ?? '' }
	};
}

/**
 * `children.under(n)` — how many children are under `n` completed years.
 *
 * The count is returned as a **BigInt** because the signature declares CEL's `int`, and CEL
 * dispatches `==` on the runtime value: an `int`-typed call handing back a JavaScript number
 * compares against no integer literal at all, so `children.under(7) == 0` was false even for a
 * childless person while `< 1` and `>= 1` behaved, and `children.under(7) + 1` threw. Singapore's
 * seeded extended-childcare rule is written `children.under(13) >= 1 && children.under(7) == 0`,
 * and granted nobody on any version. `compileEligibility` cannot catch it: `false` is a boolean.
 */
const engine = createReckonEngine().registerFunction(
	'under',
	'map.under(int): int',
	(children, age) => {
		const ages = (children as { ages?: unknown }).ages;
		const limit = Number(age);
		// BigInt, not number: cel-js wraps a custom function's numeric return as a double, and
		// a double never `==` an integer literal — so `children.under(7) == 0` was false even for
		// a childless person while `< 1` held. A bigint return evaluates as an integer.
		if (!Array.isArray(ages)) return 0n;
		return BigInt(ages.filter((value) => Number(value) < limit).length);
	}
);

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
 * Reckon, checked against the context's members, and evaluated against a blank person: the
 * result must be a boolean.
 */
export function compileEligibility(expression: string | null | undefined): string | null {
	const expr = (expression ?? '').trim();
	if (expr === '') return null;
	for (const match of expr.matchAll(
		/\b(employee|employment|terms|children|company)\.([A-Za-z_][A-Za-z0-9_]*)/g
	)) {
		const [, root, member] = match;
		if (root != null && member != null && !CONTEXT_MEMBERS[root]?.has(member))
			return (
				`Eligibility names ${root}.${member}, which the person context does not carry. ` +
				`Use employee.gender, employee.age, employee.citizenship, employee.marital_status, employee.spouse_status, employee.solo_parent, employee.race, employee.religion, employee.residency_months, employment.type, employment.classification, employment.service_months, employment.hire_date, terms.basic_salary, terms.workman, terms.department, terms.payroll_group, terms.grade, terms.ordinary_hours_per_week, terms.working_days_per_week, children.count, children.under(age) or company.region.`
			);
	}
	try {
		const value = evaluate(expr, BLANK_PERSON);
		if (typeof value !== 'boolean')
			return `Eligibility must be a true-or-false expression; this one produces ${JSON.stringify(value)}.`;
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
		return `Eligibility does not compile: ${message}`;
	}
}
