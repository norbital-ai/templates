/**
 * Statutory registrations name a scheme row, and scheme rows are versioned with their jurisdiction
 * settings: a new version clones every scheme under a new id, while the employment's registration
 * keeps pointing at the row it was entered against. A registration is a fact about the person
 * (registered, exempt, a rate override) under a jurisdiction's law named by its code, so before the engine
 * reads the facts they are realigned to the picked version: a fact whose scheme carries a code the
 * picked version levies names that version's row; one whose code the version no longer levies is
 * left as it is and matches nothing, which the engine already reads as the scheme default.
 */
import { Effect } from 'effect';
import type { WorkspaceRow } from '../$types.js';
import type { PayrollReadApi } from './api.js';
import type { Configuration } from './configuration.js';

type StatutoryFact = WorkspaceRow<'employment_statutory_facts'>;

export function realignStatutoryFacts(
	db: PayrollReadApi['db'],
	facts: readonly StatutoryFact[],
	configuration: Pick<Configuration, 'contributions' | 'jurisdiction'>
): Effect.Effect<StatutoryFact[], never, never> {
	return Effect.gen(function* () {
		const pickedByCode = new Map(
			configuration.contributions.map((entry) => [entry.row.code, entry.row.id])
		);
		const pickedIds = new Set(pickedByCode.values());
		const foreign = [
			...new Set(
				facts.map((fact) => fact.statutory_contribution_id).filter((id) => !pickedIds.has(id))
			)
		];
		if (foreign.length === 0) return [...facts];
		const schemes = yield* db.statutory_contributions.findMany({
			where: { id: { in: foreign } },
			columns: { id: true, code: true, settings_id: true },
			limit: foreign.length
		});
		const settingsIds = [...new Set(schemes.map((scheme) => scheme.settings_id))];
		const settings =
			settingsIds.length === 0
				? []
				: yield* db.jurisdiction_settings.findMany({
						where: {
							id: { in: settingsIds },
							jurisdiction_code: { eq: configuration.jurisdiction.jurisdiction_code }
						},
						columns: { id: true },
						limit: settingsIds.length
					});
		const sameJurisdiction = new Set(settings.map((row) => row.id));
		const codeById = new Map(
			schemes
				.filter((scheme) => sameJurisdiction.has(scheme.settings_id))
				.map((scheme) => [scheme.id, scheme.code])
		);
		return facts.map((fact) => {
			const code = codeById.get(fact.statutory_contribution_id);
			const picked = code === undefined ? undefined : pickedByCode.get(code);
			return picked === undefined ? fact : { ...fact, statutory_contribution_id: picked };
		});
	});
}
