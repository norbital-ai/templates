import { Effect } from 'effect';
import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { admitCatalogueRow } from '../../lib/catalogue_rules.js';
import { versionsById } from '../../lib/settings_seal.js';

const columns = {
	settings_id: true,
	code: true,
	name: true,
	destination: true,
	direction: true,
	bands: true,
	eligibility: true,
	evidence: true
} as const;

/**
 * Claim catalogue rows belong to a settings version and are sealed with it: a row of a sealed
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
			versionsById(db, [
				...inputs.map((input) => input.settings_id),
				...existing.map((row) => row?.settings_id)
			]),
			(versions) =>
				inputs.map((input, index) => admitCatalogueRow(versions, input, existing[index], 'Claim'))
		)
});
