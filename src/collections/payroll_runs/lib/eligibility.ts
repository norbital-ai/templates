/**
 * Shared CEL eligibility for family catalogues and claim cap layers.
 *
 * Rules evaluate the person, contract terms and child facts on the input date. The context
 * carries empty strings and zeros for missing facts. An empty expression includes everyone;
 * an ineligible entry produces no pay item, and an ineligible date earns no leave.
 *
 * employee.gender  employee.age  employee.citizenship
 * employment.type  employment.classification  employment.service_months  employment.hire_date
 * terms.basic_salary  terms.workman  terms.department  terms.payroll_group
 * children.count  children.under(age)
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
	};
	readonly children: {
		readonly count: number;
		/** Completed years of each child on the rule date; `children.under(age)` counts these. */
		readonly ages: readonly number[];
	};
};

/** The member names each root may be asked for, checked at write time. */
const CONTEXT_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = {
	employee: new Set(['gender', 'age', 'citizenship']),
	employment: new Set(['type', 'classification', 'service_months', 'hire_date']),
	terms: new Set(['basic_salary', 'workman', 'department', 'payroll_group']),
	children: new Set(['count', 'under'])
};

/** A person with nothing recorded: what a new expression is compiled against. */
const BLANK_PERSON: PersonContext = {
	employee: { gender: '', age: 0, citizenship: '' },
	employment: { type: '', classification: '', service_months: 0, hire_date: '' },
	terms: { basic_salary: 0, workman: false, department: '', payroll_group: '' },
	children: { count: 0, ages: [] }
};

type PersonInput = {
	readonly employee: {
		readonly gender?: string | null;
		readonly date_of_birth?: string | null;
		readonly nationality?: string | null;
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
	} | null;
	readonly children?: ReadonlyArray<{ readonly child_birthdate: string }>;
	/** The rule date: service, age and children are measured on it. */
	readonly asOf: string;
};

/** The person context on one date, from approved contract and personal facts. */
export function personContext(input: PersonInput): PersonContext {
	const hire = dateKey(input.employment.hire_date);
	const born = dateKey(input.employee?.date_of_birth);
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
			citizenship: input.terms?.residency_status ?? ''
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
			payroll_group: input.terms?.payroll_group ?? ''
		},
		children: { count: ages.length, ages }
	};
}

const engine = createReckonEngine().registerFunction(
	'under',
	'map.under(int): int',
	(children, age) => {
		const ages = (children as { ages?: unknown }).ages;
		const limit = Number(age);
		return Array.isArray(ages) ? ages.filter((value) => Number(value) < limit).length : 0;
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
		/\b(employee|employment|terms|children)\.([A-Za-z_][A-Za-z0-9_]*)/g
	)) {
		const [, root, member] = match;
		if (root != null && member != null && !CONTEXT_MEMBERS[root]?.has(member))
			return (
				`Eligibility names ${root}.${member}, which the person context does not carry. ` +
				`Use employee.gender, employee.age, employee.citizenship, employment.type, employment.classification, employment.service_months, employment.hire_date, terms.basic_salary, terms.workman, terms.department, terms.payroll_group, children.count or children.under(age).`
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
