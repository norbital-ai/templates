/**
 * The person a claim's entitlement ceiling is read against, at write time.
 *
 * An entitlement band is gated by an `eligibility` expression over the person — grade, department,
 * service, children, the company's region — so the ceiling is not a property of the component
 * alone. MEASURE builds this context from the bundle it already gathered; a transform has to read
 * it, and reads exactly the five things `personContext` consumes and nothing else.
 *
 * `null` means the employment is not on file, which is a different refusal made elsewhere: this
 * function's absence of an answer must not become a silent absence of a cap.
 */

import { Effect } from 'effect';
import { refuse, type CollectionTransformDatabase } from '@norbital-ai/bolt/authoring';
import { personContext, type PersonContext } from '../collections/payroll_runs/lib/eligibility.js';
import { coversDate } from '../collections/payroll_runs/lib/effective.js';
import { childrenOn, resolveEmployment, stint } from './employment-contract.js';
import { dateKey } from './iso-day.js';

const LIMIT = 10_000;

/** Later obligations use the final terms of their own closed contract; in-service gaps stay gaps. */
export function payRequestTerms<T extends { readonly effective_range: unknown }>(
	terms: readonly T[],
	employment: { readonly effective_range: { readonly end: string | null } | null },
	eventDate: string
): T | null {
	const end = employment.effective_range?.end;
	const date = end != null && eventDate > dateKey(end) ? dateKey(end) : eventDate;
	return terms.find((row) => coversDate(row.effective_range, date)) ?? null;
}

type CapSubject = {
	readonly subject: PersonContext;
	/** Reuses the approved history for each prior source's own rule date. */
	readonly at: (date: string) => PersonContext;
	/** How a refusal names the person: their employee number, as the run's own message does. */
	readonly label: string;
};

/** The five things `personContext` consumes, read as one nested query per batch. */
type CapEmployment = {
	readonly id: string;
	readonly employee_id: string;
	readonly company_id: string;
	readonly employee_number: string | null;
	readonly effective_range: unknown;
	readonly exit_reason: string | null;
	readonly employment_employee: Record<string, unknown> | null;
	readonly employment_company: { readonly region?: string | null } | null;
	readonly term_employment: ReadonlyArray<{ readonly effective_range: unknown }>;
};

/**
 * The cap subjects of a batch: one read, keyed by the employment ids the inputs name, with the
 * person, the entity and the terms nested under each employment. `null` for an employment that is
 * not on file, which is a different refusal made elsewhere: an absent answer must not become a
 * silent absence of a cap.
 */
export function capSubjects(
	db: Pick<CollectionTransformDatabase, 'employments'>,
	employmentIds: ReadonlyArray<string>
): Effect.Effect<(employmentId: string, asOf: string) => CapSubject | null> {
	const ids = [...new Set(employmentIds.filter((id) => id !== ''))];
	if (ids.length === 0) return Effect.succeed(() => null);
	return Effect.map(
		db.employments.findMany({
			where: { id: { in: ids }, approval_id: { isNull: true } },
			columns: {
				id: true,
				employee_id: true,
				company_id: true,
				employee_number: true,
				effective_range: true,
				exit_reason: true
			},
			with: {
				employment_employee: {
					columns: {
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
				employment_company: { columns: { region: true } },
				term_employment: { where: { approval_id: { isNull: true } }, limit: LIMIT }
			},
			limit: ids.length
		}),
		(rows) => {
			const byId = new Map(rows.map((row) => [row.id, row as unknown as CapEmployment]));
			return (employmentId, asOf) => {
				const employment = byId.get(employmentId);
				if (employment == null) return null;
				const terms = employment.term_employment;
				if (terms.length >= LIMIT)
					refuse('The contract cap eligibility history exceeds the supported read limit.');
				const contract = resolveEmployment(employment);
				const employee = employment.employment_employee;
				// The whole stint, exit included: a separation class's eligibility reads the leaver's
				// exit reason and service on the last day, at the write as in the run.
				const at = (date: string): PersonContext =>
					personContext({
						employee: employee as never,
						employment: stint({ ...contract, exit_reason: employment.exit_reason }),
						terms: payRequestTerms(terms, contract, date) as never,
						children: childrenOn(
							(
								employee as {
									children?:
										readonly { child_birthdate: string; effective_range: unknown }[] | null;
								} | null
							)?.children ?? [],
							date
						),
						company: employment.employment_company as never,
						asOf: date
					});
				return {
					subject: at(asOf),
					at,
					label:
						employment.employee_number == null || employment.employee_number === ''
							? employmentId
							: String(employment.employee_number)
				};
			};
		}
	);
}
