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

import { readAll, type Reads } from './reads.js';
import { personContext, type PersonContext } from '../lib/payroll/run/eligibility.js';
import { coversDate } from '../lib/payroll/run/effective.js';
import { childrenOn, resolveEmployment, stint } from './employment-contract.js';
import { dateKey } from './iso-day.js';
import { settingsInForce } from './jurisdiction_settings.js';
import { personFactsForVersion } from './payroll/facts.js';

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
	readonly currency: string | null;
	/** Reuses the approved history for each prior source's own rule date. */
	readonly at: (date: string) => PersonContext;
	/** How a refusal names the person: their employee number, as the run's own message does. */
	readonly label: string;
	readonly companyId: string;
};

type CapEmployment = {
	readonly id: string;
	readonly employee_id: string;
	readonly company_id: string;
	readonly employee_number: string | null;
	readonly effective_range: unknown;
	readonly exit_reason: string | null;
};
type CapEmployee = Record<string, unknown> & {
	readonly id: string;
	readonly children?:
		readonly { child_birthdate: string; effective_range: unknown }[] | null | undefined;
};

/**
 * The cap subjects of a batch, keyed by the employment ids the inputs name: the employments and
 * their terms, then the people and the entities they name. `null` for an employment that is not
 * on file, which is a different refusal made elsewhere: an absent answer must not become a
 * silent absence of a cap.
 */
export async function capSubjects(
	reads: Reads,
	employmentIds: ReadonlyArray<string>
): Promise<(employmentId: string, asOf: string) => CapSubject | null> {
	const ids = [...new Set(employmentIds.filter((id) => id !== ''))];
	const settled = { approval_id: { isNull: true } };
	const [employments, terms] = await Promise.all([
		readAll<CapEmployment>(reads, 'employments', { id: { in: ids }, ...settled }),
		readAll<{
			readonly employment_id: string;
			readonly effective_range: unknown;
			readonly currency: string | null;
		}>(reads, 'employment_terms', { employment_id: { in: ids }, ...settled })
	]);
	const employeeIds = [...new Set(employments.map((row) => row.employee_id))];
	const [employees, companies, versions, facts] = await Promise.all([
		readAll<CapEmployee>(reads, 'employees', { id: { in: employeeIds } }),
		readAll<{
			readonly id: string;
			readonly region?: string | null;
			readonly settings_code: string;
		}>(reads, 'companies', {
			id: { in: [...new Set(employments.map((row) => row.company_id))] }
		}),
		readAll<{
			readonly id: string;
			readonly code: string;
			readonly sealed_at: unknown;
			readonly voided_at: unknown;
			readonly effective_range: unknown;
			readonly approval_id: unknown;
		}>(reads, 'jurisdiction_settings', settled, undefined, {
			id: true,
			code: true,
			sealed_at: true,
			voided_at: true,
			effective_range: true,
			approval_id: true
		}),
		readAll<Parameters<typeof personFactsForVersion>[0][number] & { readonly employee_id: string }>(
			reads,
			'employment_statutory_facts',
			{ employee_id: { in: employeeIds }, ...settled }
		)
	]);
	// The schemes name the codes a rule reads a fact under (`facts.UI.since_months`), as in the run.
	const lineageIds = versions
		.filter((row) => companies.some((company) => company.settings_code === row.code))
		.map((row) => row.id);
	const schemes = await readAll<Parameters<typeof personFactsForVersion>[1][number]>(
		reads,
		'statutory_contributions',
		{ settings_id: { in: lineageIds }, ...settled },
		undefined,
		{ id: true, code: true, settings_id: true, elections: true }
	);
	const byId = new Map(employments.map((row) => [row.id, row]));
	return (employmentId, asOf) => {
		const employment = byId.get(employmentId);
		if (employment == null) return null;
		const contract = resolveEmployment(employment);
		const employee = employees.find((row) => row.id === employment.employee_id) ?? null;
		const company = companies.find((row) => row.id === employment.company_id) ?? null;
		const ownTerms = terms.filter((row) => row.employment_id === employmentId);
		// The whole stint, exit included: a separation class's eligibility reads the leaver's
		// exit reason and service on the last day, at the write as in the run.
		const at = (date: string): PersonContext =>
			personContext({
				employee: employee as never,
				employment: stint({ ...contract, exit_reason: employment.exit_reason }, []),
				terms: payRequestTerms(ownTerms, contract, date) as never,
				children: childrenOn(employee?.children ?? [], date),
				company: company as never,
				facts:
					company == null
						? []
						: personFactsForVersion(
								facts.filter((row) => row.employee_id === employment.employee_id),
								schemes,
								settingsInForce(versions, company.settings_code, date)?.id ?? '',
								date,
								employmentId
							),
				asOf: date
			});
		return {
			subject: at(asOf),
			currency: payRequestTerms(ownTerms, contract, asOf)?.currency ?? null,
			at,
			label:
				employment.employee_number == null || employment.employee_number === ''
					? employmentId
					: employment.employee_number,
			companyId: employment.company_id
		};
	};
}
