import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('allowance_catalog', {
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	label: 'code',
	fields: {
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			onDelete: 'restrict',
			optional: true,
			inverse: 'allowance_catalog'
		},
		lookup: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		code: { kind: 'text' },
		description: {
			kind: 'text',
			optional: true,
			help: 'What this catalog row does: its rule, behaviour and any legal or operational note.'
		},
		references: { kind: 'custom', of: 'references', optional: true },
		eligibility: { kind: 'text', max: 65536 },
		conversion: { kind: 'text', max: 65536 },
		/** Whether this allowance is part of the wage a day or hour rate divides. */
		include_in_rate: { kind: 'bool', default: false },
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'allowance_catalog',
			owned: true
		}
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		allowance_catalog: { fields: 'all' },
		'allowance_catalog.settings_id': { fields: 'all' },
		'allowance_catalog.subtotal_id': { fields: ['code', 'name'] },
		'allowance_catalog.settings_id.registered_rule': { fields: 'all' }
	},
	create: {
		columns: {
			allowance_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'eligibility',
				'conversion',
				'include_in_rate',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'allowance_catalog',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			allowance_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'eligibility',
				'conversion',
				'include_in_rate'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'allowance_catalog',
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
