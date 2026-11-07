import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../lib/payroll_engine/configuration.js';

export default model('registered_effect', {
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	label: 'code',
	fields: {
		lookup: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		code: { kind: 'text' },
		name: { kind: 'text' },
		references: { kind: 'custom', of: 'references', optional: true },
		source_collection: { kind: 'text' },
		events: {
			kind: 'enum',
			values: [
				'create',
				'update',
				'delete',
				'prepare_request',
				'seal',
				'void',
				'approve',
				'entries_changed',
				'prepare_payroll',
				'after_basic',
				'after_gross',
				'after_contributions',
				'after_tax',
				'after_net',
				'finalise',
				'mark_paid',
				'daily',
				'calendar',
				'after_exit'
			],
			many: true
		},
		reads: { kind: 'custom', of: 'reads', optional: true },
		condition: { kind: 'text', max: 65536 },
		target_collection: { kind: 'text' },
		target_action: { kind: 'enum', values: ['create', 'update', 'delete'] },
		effects: { kind: 'text', max: 65536 },
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'registered_effect',
			owned: true
		}
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		registered_effect: { fields: 'all' },
		'registered_effect.settings_id': { fields: 'all' },
		'registered_effect.settings_id.registered_effect': { fields: 'all' }
	},
	create: {
		columns: {
			registered_effect: [
				'lookup',
				'code',
				'name',
				'references',
				'source_collection',
				'events',
				'reads',
				'condition',
				'target_collection',
				'target_action',
				'effects',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'registered_effect',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			registered_effect: [
				'lookup',
				'code',
				'name',
				'references',
				'source_collection',
				'events',
				'reads',
				'condition',
				'target_collection',
				'target_action',
				'effects'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'registered_effect',
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
