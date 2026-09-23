import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { catalogueTransform } from '../../lib/catalogue_rules.js';

const columns = {
	settings_id: true,
	code: true,
	name: true,
	authority: true,
	destination: true,
	direction: true,
	bands: true,
	eligibility: true,
	counts_toward: true,
	npl_prorates: true
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
	transform: catalogueTransform('Allowance')
});
