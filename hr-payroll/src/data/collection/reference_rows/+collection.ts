import { collection } from '@norbital-ai/bolt';
import { refuseUnlessDraftOnBoth, versionsById } from '../../../lib/settings_seal.js';

const COLUMNS = [
	'table',
	'code',
	'parent_code',
	'label',
	'effective_range',
	'range_from',
	'range_to',
	'values'
] as const;

/**
 * Reference rows belong to a settings version and are sealed with it: a row of a sealed version
 * refuses create and update here, and delete through the grant (`DRAFT_SETTINGS_ROW`). The rows
 * are judged against the version's `tables` when it seals (`referenceRowsFault`), where the whole
 * table is in view.
 */
const rows = collection('reference_rows', {
	read: { fields: 'all' },
	create: { input: { columns: ['settings_id', ...COLUMNS] } },
	update: { input: { columns: [...COLUMNS] } },
	delete: {}
});
export default rows;

rows.transform(async (inputs, { existing, db }) => {
	const versions = await versionsById(db, [
		...inputs.map((input) => input.settings_id),
		...existing.map((row) => row?.settings_id)
	]);
	for (const [index, input] of inputs.entries()) {
		const stored = existing[index];
		refuseUnlessDraftOnBoth(
			versions,
			stored?.settings_id,
			input.settings_id,
			`Reference row ${input.table ?? stored?.table ?? ''}/${input.code ?? stored?.code ?? ''}`
		);
	}
	return inputs;
});
