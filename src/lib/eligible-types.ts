/**
 * The types an event form offers: the catalogue rows whose `eligibility` holds for the person.
 *
 * The rule is the engine's own (`payroll_runs/lib/eligibility.ts`), fed by the facts a browser can
 * read in one query: the employment, its employee, its terms and its entity (`ELIGIBILITY_SELECT`). The picker then
 * narrows to these ids, so an ineligible type is not offered rather than refused after the fact;
 * the transform keeps the same rule for a write that did not come through the form.
 */
import { isEligible, personContext, type PersonContext } from '../lib/payroll/run/eligibility.js';
import { childrenOn, resolveEmployment } from './employment-contract.js';
import { payRequestTerms } from './component_entry_cap_subject.js';
import { dateKey } from './iso-day.js';

/**
 * The employment row with its person, entity and terms selected through its relations
 * (`ELIGIBILITY_SELECT`), plain values (`lib/wire.ts`).
 */
type PersonFacts = {
	readonly effective_range: unknown;
	readonly employee_id?: Parameters<typeof personContext>[0]['employee'] & {
		readonly children?: ReadonlyArray<{
			readonly child_birthdate: string;
			readonly effective_range: unknown;
		}> | null;
	};
	readonly company_id?:
		{ readonly region?: string | null; readonly settings_code?: string } | null | undefined;
	readonly employment_terms?: ReadonlyArray<
		NonNullable<Parameters<typeof personContext>[0]['terms']> & {
			readonly effective_range: unknown;
		}
	> | null;
};

/** The one read the offer needs: the employment with its person, entity and every term. */
export const ELIGIBILITY_SELECT = {
	effective_range: true,
	employee_id: {
		select: {
			gender: true,
			date_of_birth: true,
			nationality: true,
			marital_status: true,
			solo_parent: true,
			race: true,
			religion: true,
			children: true
		}
	},
	company_id: { select: { region: true, settings_code: true } },
	employment_terms: {
		select: {
			effective_range: true,
			residency_status: true,
			employment_type: true,
			work_classification: true,
			base_salary: true,
			statutory_work_category: true,
			department: true,
			payroll_group: true,
			paid_rest_days: true,
			grade: true,
			residency_since: true
		},
		all: true
	}
} as const;

/** The person as the predicate grammar sees them on `day`. */
export function personAsOf(facts: PersonFacts, day: string): PersonContext {
	const contract = resolveEmployment(facts);
	const start = contract.effective_range == null ? '' : dateKey(contract.effective_range.start);
	return personContext({
		employee: facts.employee_id ?? null,
		employment: { service_start: start },
		terms: payRequestTerms(facts.employment_terms ?? [], contract, day),
		children: childrenOn(facts.employee_id?.children ?? [], day),
		company: facts.company_id ?? null,
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
