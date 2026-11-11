import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('work_event_catalog', {
	description:
		'Configuration for dated real-world events that affect work and may dispense an allowance. The catalog row itself is the event type; it is referenced directly by a work event.',
	label: 'code',
	fields: {
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'work_event_catalog',
			owned: true
		},
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		subtotal_id: { kind: 'ref', to: 'subtotal', optional: true, onDelete: 'restrict' },
		references: { kind: 'custom', of: 'references', optional: true },
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		work_event_catalog: { fields: 'all' },
		'work_event_catalog.settings_id': { fields: 'all' },
		'work_event_catalog.subtotal_id': { fields: ['code', 'name'] }
	},
	create: {
		columns: {
			work_event_catalog: [
				'settings_id',
				'code',
				'description',
				'subtotal_id',
				'references',
				'lookup'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'work_event_catalog',
				rows,
				rows.map((row) => row.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			work_event_catalog: ['code', 'description', 'subtotal_id', 'references', 'lookup']
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'work_event_catalog',
				changes.map((change) => ({ ...change.before, ...change.set })),
				changes.map((change) => change.before.settings_id)
			);
			return changes.map((change) => change.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* requireDraftSettings(
				ctx.db.query,
				rows.map((row) => row.settings_id)
			);
		}
	}
});
