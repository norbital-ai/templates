import { collection } from '@norbital-ai/bolt';
import { admitCatalogueRows } from '../../../lib/catalogue_rules.js';
import { plain } from '../../../lib/wire.js';

/**
 * Allowance catalogue rows belong to a settings version and are sealed with it: a row of a sealed
 * version refuses create and update here, and delete through the grant (`DRAFT_SETTINGS_ROW`).
 * The eligibility expression compiles at the write; `counts_toward` names schemes of the version.
 */
const c = collection('allowance_catalogue', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'settings_id',
				'code',
				'name',
				'authority',
				'destination',
				'direction',
				'bands',
				'eligibility',
				'counts_toward',
				'npl_prorates',
				'owed'
			]
		}
	},
	update: {
		input: {
			columns: [
				'code',
				'name',
				'authority',
				'destination',
				'direction',
				'bands',
				'eligibility',
				'counts_toward',
				'npl_prorates',
				'owed'
			]
		}
	},
	delete: {}
});
export default c;

c.transform(async (inputs, ctx) => {
	await admitCatalogueRows(
		'Allowance',
		inputs.map((input) => plain(input)),
		ctx.existing.map((row) => plain(row) as Record<string, unknown> | undefined),
		ctx.db
	);
	return inputs;
});
