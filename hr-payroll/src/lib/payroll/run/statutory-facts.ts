/**
 * Statutory registrations name a scheme row, and scheme rows are versioned with their jurisdiction
 * settings: a new version clones every scheme under a new id, while the employment's registration
 * keeps pointing at the row it was entered against. A registration is a fact about the person
 * (registered, exempt, a rate override) under a jurisdiction's law named by its code, so before the engine
 * reads the facts they are realigned to the picked version: a fact whose scheme carries a code the
 * picked version levies names that version's row; one whose code the version no longer levies is
 * left as it is and matches nothing, which the engine already reads as the scheme default.
 */
import type { WorkspaceRow } from '../../../lib/rows.js';
import type { PayrollWorld } from '../world.js';
import type { Configuration } from './configuration.js';

import type { StatutoryFactStatus } from '../../datatypes/statutory_fact_status.js';

/** A stored registration: its `status` is what the custom field's check admits (`StatutoryFactStatus`). */
export type StatutoryFact = Omit<WorkspaceRow<'employment_statutory_facts'>, 'status'> & {
	readonly status: StatutoryFactStatus;
};

export function realignStatutoryFacts(
	world: Pick<PayrollWorld, 'statutory_contributions' | 'jurisdiction_settings'>,
	facts: readonly StatutoryFact[],
	configuration: Pick<Configuration, 'contributions' | 'jurisdiction'>
): StatutoryFact[] {
	const pickedByCode = new Map(
		configuration.contributions.map((entry) => [entry.row.code, entry.row.id])
	);
	const pickedIds = new Set(pickedByCode.values());
	const foreign = new Set(
		facts.map((fact) => fact.statutory_contribution_id).filter((id) => !pickedIds.has(id))
	);
	if (foreign.size === 0) return [...facts];
	const sameJurisdiction = new Set(
		world.jurisdiction_settings
			.filter((row) => row.jurisdiction_code === configuration.jurisdiction.jurisdiction_code)
			.map((row) => row.id)
	);
	const codeById = new Map(
		world.statutory_contributions
			.filter((scheme) => foreign.has(scheme.id) && sameJurisdiction.has(scheme.settings_id))
			.map((scheme) => [scheme.id, scheme.code])
	);
	return facts.map((fact) => {
		const code = codeById.get(fact.statutory_contribution_id);
		const picked = code === undefined ? undefined : pickedByCode.get(code);
		return picked === undefined ? fact : { ...fact, statutory_contribution_id: picked };
	});
}
