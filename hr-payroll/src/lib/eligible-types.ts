/**
 * The types an event form offers: the catalogue rows whose `eligibility` holds for the person.
 *
 * The rule is the engine's own (`payroll_runs/lib/eligibility.ts`), fed by the facts a browser can
 * read in one query: the employment, its employee, its terms and its entity. The picker then
 * narrows to these ids, so an ineligible type is not offered rather than refused after the fact;
 * the hook keeps the same rule for a write that did not come through the form.
 */
import {
	isEligible,
	personContext,
	type PersonContext
} from '../collections/payroll_runs/lib/eligibility.js';
import { childrenOn, resolveEmployment } from './employment-contract.js';
import { payRequestTerms } from './component_entry_cap_subject.js';

/** The employment row with its person, terms and entity joined, as the form's one query reads it. */
type PersonFacts = {
	readonly hire_date: string;
	readonly effective_range: unknown;
	readonly exit_date?: string | null;
	readonly children?: ReadonlyArray<{
		readonly child_birthdate: string;
		readonly effective_range: unknown;
	}> | null;
	readonly employment_employee?: Parameters<typeof personContext>[0]['employee'];
	readonly employment_company?: { readonly region?: string | null } | null;
	readonly term_employment?: ReadonlyArray<
		NonNullable<Parameters<typeof personContext>[0]['terms']> & {
			readonly effective_range: unknown;
		}
	> | null;
};

/** The person as the predicate grammar sees them on `day`. */
export function personAsOf(facts: PersonFacts, day: string): PersonContext {
	const contract = resolveEmployment(facts);
	return personContext({
		employee: facts.employment_employee ?? null,
		employment: { hire_date: facts.hire_date },
		terms: payRequestTerms(facts.term_employment ?? [], contract, day),
		children: childrenOn(facts.children ?? [], day),
		company: facts.employment_company ?? null,
		asOf: day
	});
}

/** The ids of the rows whose rule holds for the person; an empty rule holds for everyone. */
export const eligibleTypeIds = (
	rows: ReadonlyArray<{ readonly id: string; readonly eligibility: string }>,
	person: PersonContext
): string[] => rows.filter((row) => isEligible(row.eligibility, person)).map((row) => row.id);

/** A uuid no row carries: `in ()` is not SQL, so an empty offer names this id instead. */
export const NO_ROW = '00000000-0000-0000-0000-000000000000';

/**
 * The picker's predicate: the in-force clause the page already applies, narrowed to the eligible
 * ids once the person is known. `null` ids is "no person yet", which offers every in-force row.
 */
export const eligibleTypeWhere = (
	inForce: Record<string, unknown> | undefined,
	ids: readonly string[] | null
): Record<string, unknown> | undefined =>
	ids == null ? inForce : { ...inForce, id: { in: ids.length === 0 ? [NO_ROW] : [...ids] } };
