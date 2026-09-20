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
import { refuse } from '@norbital-ai/bolt/authoring';
import { resolveFactValues } from '../declared-facts.js';
import { stableJson } from '../jurisdiction_settings.js';
import { factScopeFault, type FactKey } from '../../datatypes/fact_keys/+definition.js';

type FactRow = Pick<
	EmploymentBundle['statutoryFacts'][number],
	'employment_id' | 'statutory_contribution_id' | 'status' | 'effective_range'
>;

type PersonFactScheme = {
	readonly id: string;
	readonly code: string;
	readonly elections: readonly FactKey[];
};

function selectFactStatusesOn(
	rows: readonly FactRow[],
	asOf: IsoDate,
	employmentId: string,
	schemes: readonly PersonFactScheme[]
): Map<string, StatutoryFactStatus> {
	const selected = new Map<string, FactRow>();
	for (const fact of rows) {
		if (!coversDate(fact.effective_range, asOf) || fact.status == null) continue;
		if (fact.employment_id != null && fact.employment_id !== employmentId) continue;
		const previous = selected.get(fact.statutory_contribution_id);
		if (previous?.employment_id != null && fact.employment_id == null) continue;
		if (
			previous != null &&
			(previous.employment_id ?? null) === (fact.employment_id ?? null) &&
			stableJson(previous.status) !== stableJson(fact.status)
		)
			refuse(
				`Conflicting statutory declarations apply on ${asOf}. Close or correct overlapping declarations before calculating payroll.`
			);
		selected.set(fact.statutory_contribution_id, fact);
	}
	const fields = new Map(schemes.map((scheme) => [scheme.id, scheme.elections]));
	const facts = new Map<string, StatutoryFactStatus>();
	for (const [schemeId, fact] of selected) {
		if (fact.status.kind === 'REGISTERED') {
			const fault = factScopeFault(
				fields.get(schemeId) ?? [],
				fact.status.elections ?? {},
				fact.employment_id
			);
			if (fault != null) refuse(fault);
		}
		facts.set(schemeId, fact.status);
	}
	return facts;
}

/** The statutory facts in force on a day, by scheme id. */
export function factStatusesOn(
	rows: EmploymentBundle['statutoryFacts'],
	asOf: IsoDate,
	employmentId: string,
	contributions: Configuration['contributions']
): Map<string, StatutoryFactStatus> {
	return selectFactStatusesOn(
		rows,
		asOf,
		employmentId,
		contributions.map((scheme) => scheme.row)
	);
}

/** Resolve dated personal facts for one employment without exposing payroll's wrapped config rows. */
export function personFactsOn(
	rows: readonly FactRow[],
	schemes: readonly PersonFactScheme[],
	asOf: IsoDate,
	employmentId: string
): NonNullable<PersonInput['facts']> {
	return personFactsFromSchemes(schemes, selectFactStatusesOn(rows, asOf, employmentId, schemes));
}

/** The facts as the person site reads them: one row per scheme of the version, registered or not. */
export function personFacts(
	contributions: Configuration['contributions'],
	facts: ReadonlyMap<string, StatutoryFactStatus>
): NonNullable<PersonInput['facts']> {
	return personFactsFromSchemes(
		contributions.map((scheme) => scheme.row),
		facts
	);
}

function personFactsFromSchemes(
	schemes: readonly PersonFactScheme[],
	facts: ReadonlyMap<string, StatutoryFactStatus>
): NonNullable<PersonInput['facts']> {
	return schemes.map((scheme) => {
		const status = facts.get(scheme.id);
		return {
			code: scheme.code,
			registered: status?.kind === 'REGISTERED',
			since: status?.kind === 'REGISTERED' ? (status.since ?? null) : null,
			elections: resolveFactValues(
				scheme.elections,
				status?.kind === 'REGISTERED' ? (status.elections ?? {}) : {},
				scheme.code,
				false
			),
			election_keys: status?.kind === 'REGISTERED' ? Object.keys(status.elections ?? {}) : []
		};
	});
}
