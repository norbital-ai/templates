/**
 * The person a claim's entitlement ceiling is read against, at write time.
 *
 * An entitlement band is gated by an `eligibility` expression over the person — grade, department,
 * service, children, the company's region — so the ceiling is not a property of the component
 * alone. MEASURE builds this context from the bundle it already gathered; a write hook has to read
 * it, and reads exactly the five things `personContext` consumes and nothing else.
 *
 * `null` means the employment is not on file, which is a different refusal made elsewhere: this
 * function's absence of an answer must not become a silent absence of a cap.
 */

import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { personContext, type PersonContext } from '../collections/payroll_runs/lib/eligibility.js';
import { coversDate } from '../collections/payroll_runs/lib/effective.js';
import { childrenOn, resolveEmployment } from './employment-contract.js';
import type { WorkspaceRow } from '$bolt/types.js';
import { dateKey } from './iso-day.js';

const LIMIT = 10_000;

/** Later obligations use the final terms of their own closed contract; in-service gaps stay gaps. */
export function payRequestTerms<T extends { readonly effective_range: unknown }>(
	terms: readonly T[],
	employment: { readonly exit_date?: string | null },
	eventDate: string
): T | null {
	const end = employment.exit_date == null ? null : dateKey(employment.exit_date);
	const date = end != null && eventDate > end ? end : eventDate;
	return terms.find((row) => coversDate(row.effective_range, date)) ?? null;
}

type CapSubject = {
	readonly subject: PersonContext;
	/** Reuses the approved history for each prior source's own rule date. */
	readonly at: (date: string) => PersonContext;
	/** How a refusal names the person: their employee number, as the run's own message does. */
	readonly label: string;
};

export function capSubject(
	// The authored api, narrowed to the reads this makes.
	api: {
		readonly db: {
			readonly employments: {
				readonly findFirst: (input: unknown) => Effect.Effect<Record<string, unknown> | undefined>;
			};
			readonly employees: {
				readonly findFirst: (input: unknown) => Effect.Effect<Record<string, unknown> | undefined>;
			};
			readonly employment_terms: {
				readonly findMany: (input: unknown) => Effect.Effect<readonly Record<string, unknown>[]>;
			};
			readonly companies: {
				readonly findFirst: (input: unknown) => Effect.Effect<Record<string, unknown> | undefined>;
			};
		};
	},
	employmentId: string,
	asOf: string
): Effect.Effect<CapSubject | null> {
	return Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId }, approval_id: { isNull: true } },
			columns: {
				id: true,
				employee_id: true,
				company_id: true,
				employee_number: true,
				hire_date: true,
				effective_range: true,
				exit_date: true,
				exit_reason: true,
				children: true
			}
		});
		if (employment == null) return null;
		const contract = resolveEmployment(employment as Parameters<typeof resolveEmployment>[0]);
		const [employee, terms, company] = yield* Effect.all(
			[
				api.db.employees.findFirst({
					where: { id: { eq: String(employment.employee_id) } },
					columns: {
						gender: true,
						date_of_birth: true,
						nationality: true,
						marital_status: true,
						solo_parent: true,
						race: true,
						religion: true
					}
				}),
				api.db.employment_terms.findMany({
					where: { employment_id: { eq: employmentId }, approval_id: { isNull: true } },
					limit: LIMIT
				}),
				api.db.companies.findFirst({
					where: { id: { eq: String(employment.company_id) } },
					columns: { region: true }
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (terms.length >= LIMIT)
			refuse('The contract cap eligibility history exceeds the supported read limit.');
		const at = (date: string): PersonContext =>
			personContext({
				employee: employee as never,
				employment: { hire_date: String(employment.hire_date) },
				terms: payRequestTerms(
					terms as readonly { effective_range: unknown }[],
					contract,
					date
				) as never,
				children: childrenOn(
					(employment.children ?? []) as WorkspaceRow<'employments'>['children'],
					date
				),
				company: company as never,
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
	});
}
