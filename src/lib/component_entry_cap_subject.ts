/**
 * The person a claim's entitlement ceiling is read against, at write time.
 *
 * A cap layer may be gated by an `eligibility` expression over the person — grade, department,
 * service, children — so the ceiling is not a property of the component alone. MEASURE builds this
 * context from the bundle it already gathered; a write hook has to read it, and reads exactly the
 * four things `personContext` consumes and nothing else.
 *
 * `null` means the employment is not on file, which is a different refusal made elsewhere: this
 * function's absence of an answer must not become a silent absence of a cap.
 */

import { Effect } from 'effect';
import { personContext, type PersonContext } from '../collections/payroll_runs/lib/eligibility.js';
import { coversDate } from '../collections/payroll_runs/lib/effective.js';

const LIMIT = 10_000;

export type CapSubject = {
	readonly subject: PersonContext;
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
			readonly employee_children: {
				readonly findMany: (input: unknown) => Effect.Effect<readonly Record<string, unknown>[]>;
			};
		};
	},
	employmentId: string,
	asOf: string
): Effect.Effect<CapSubject | null> {
	return Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId }, approval_id: { isNull: true } },
			columns: { id: true, employee_id: true, employee_number: true, hire_date: true }
		});
		if (employment == null) return null;
		const [employee, terms, children] = yield* Effect.all(
			[
				api.db.employees.findFirst({
					where: { id: { eq: String(employment.employee_id) } },
					columns: {
						gender: true,
						date_of_birth: true,
						nationality: true,
						residency_status: true
					}
				}),
				api.db.employment_terms.findMany({
					where: { employment_id: { eq: employmentId }, approval_id: { isNull: true } },
					limit: LIMIT
				}),
				api.db.employee_children.findMany({
					where: { employment_id: { eq: employmentId }, approval_id: { isNull: true } },
					limit: LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		return {
			subject: personContext({
				employee: employee as never,
				employment: { hire_date: String(employment.hire_date) },
				terms: (terms.find((row) => coversDate(row.effective_range, asOf)) ?? null) as never,
				children: children as never,
				asOf
			}),
			label:
				employment.employee_number == null || employment.employee_number === ''
					? employmentId
					: String(employment.employee_number)
		};
	});
}
