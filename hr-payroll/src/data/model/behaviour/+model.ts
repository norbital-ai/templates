import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const columns = [
	'code',
	'name',
	'references',
	'order',
	'target_collection',
	'events',
	'when',
	'fields',
	'reads',
	'effect',
	'definition'
] as const;

export default model('behaviour', {
	description:
		"One jurisdiction version's event rule: when a row event (`target_collection` and `events`) happens and its CEL `when` holds, it loads its declared `reads` and its CEL `effect` returns the writes to make. The rules one event selects run in `order`. An obligation or task rule carries the duty it raises as `definition`.",
	icon: 'lucide:workflow',
	label: 'code',
	fields: {
		...STATUTORY_FIELDS.behaviour,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'behaviour',
			owned: true
		}
	},
	// a rule names one row of its version: the drift snapshot and the duties it raises key on its code
	unique: [{ fields: ['settings_id', 'code'] }],
	read: 'all',
	create: { columns: { behaviour: [...columns, 'settings_id'] } },
	update: { columns: { behaviour: columns } }
});
