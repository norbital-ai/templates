import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../lib/payroll_engine/configuration.js';

export default model('registered_rule', {
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	label: 'code',
	fields: {
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'registered_rule',
			owned: true
		},
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		target_collection: { kind: 'text' },
		events: {
			kind: 'enum',
			values: ['create', 'update', 'delete'],
			many: true
		},
		reads: { kind: 'custom', of: 'reads', optional: true },
		condition: { kind: 'text', max: 65536, optional: true },
		validate: { kind: 'text', max: 65536 },
		order: { kind: 'int', default: 0 },
		lookup: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		references: { kind: 'custom', of: 'references', optional: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		registered_rule: { fields: 'all' },
		'registered_rule.settings_id': { fields: 'all' },
		'registered_rule.settings_id.registered_rule': { fields: 'all' }
	},
	create: {
		columns: {
			registered_rule: [
				'settings_id',
				'code',
				'description',
				'target_collection',
				'events',
				'reads',
				'condition',
				'validate',
				'order',
				'lookup',
				'references'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'registered_rule',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			registered_rule: [
				'code',
				'description',
				'target_collection',
				'events',
				'reads',
				'condition',
				'validate',
				'order',
				'lookup',
				'references'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'registered_rule',
				changes.map((c) => ({ ...c.before, ...c.set })),
				changes.map((c) => c.before.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* requireDraftSettings(
				ctx.db.query,
				rows.map((r) => r.settings_id)
			);
		}
	}
});
