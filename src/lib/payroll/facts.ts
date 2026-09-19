/**
 * The employment's statutory facts as the person and scheme sites read them: which schemes it is
 * registered with, and since when.
 */
import type { PersonInput } from '../../collections/payroll_runs/lib/eligibility.js';
import type { StatutoryFactStatus } from '../../collections/payroll_runs/lib/contribute.js';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import type { IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';

/** The statutory facts in force on a day, by scheme id. */
export function factStatusesOn(
	rows: EmploymentBundle['statutoryFacts'],
	asOf: IsoDate
): Map<string, StatutoryFactStatus> {
	const facts = new Map<string, StatutoryFactStatus>();
	for (const fact of rows) {
		if (!coversDate(fact.effective_range, asOf) || fact.status == null) continue;
		facts.set(fact.statutory_contribution_id, fact.status);
	}
	return facts;
}

/** The facts as the person site reads them: one row per scheme of the version, registered or not. */
export function personFacts(
	contributions: Configuration['contributions'],
	facts: ReadonlyMap<string, StatutoryFactStatus>
): NonNullable<PersonInput['facts']> {
	return contributions.map((scheme) => {
		const status = facts.get(scheme.row.id);
		return {
			code: scheme.row.code,
			registered: status?.kind === 'REGISTERED',
			since: status?.kind === 'REGISTERED' ? (status.since ?? null) : null
		};
	});
}
