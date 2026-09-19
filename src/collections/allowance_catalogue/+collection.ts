import { Effect } from 'effect';
import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import {
	admitCatalogueRow,
	refuseUnknownMemberships,
	schemePartsByVersion
} from '../../lib/catalogue_rules.js';
import { versionsById } from '../../lib/settings_seal.js';

const columns = {
	settings_id: true,
	code: true,
	name: true,
	authority: true,
	destination: true,
	direction: true,
	bands: true,
	eligibility: true,
	counts_toward: true
} as const;

/**
 * Allowance catalogue rows belong to a settings version and are sealed with it: a row of a sealed
 * version refuses create and update here, and delete through the grant (`settingsCatalogueGrants`).
 * The eligibility expression compiles at the write.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.map(
			Effect.all(
				[
					versionsById(db, [
						...inputs.map((input) => input.settings_id),
						...existing.map((row) => row?.settings_id)
					]),
					schemePartsByVersion(db, [
						...inputs.map((input) => input.settings_id),
						...existing.map((row) => row?.settings_id)
					])
				],
				{ concurrency: 'unbounded' }
			),
			([versions, schemes]) =>
				inputs.map((input, index) => {
					const row = { ...existing[index], ...input };
					if (input.counts_toward !== undefined)
						refuseUnknownMemberships(
							row.settings_id == null ? undefined : schemes.get(String(row.settings_id)),
							input.counts_toward,
							`Allowance ${String(row.code ?? '')}`
						);
					return admitCatalogueRow(versions, input, existing[index], 'Allowance');
				})
		)
});
