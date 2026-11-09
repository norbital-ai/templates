import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('loan_catalog', {
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	label: 'code',
	fields: {
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			optional: true,
			onDelete: 'restrict',
			inverse: 'loan_catalog'
		},
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		eligibility: { kind: 'text', max: 65536, optional: true },
		conversion: { kind: 'text', max: 65536, optional: true },
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', inverse: 'loan_catalog', owned: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		loan_catalog: { fields: 'all' },
		'loan_catalog.settings_id': { fields: 'all' },
		'loan_catalog.subtotal_id': { fields: ['code', 'name'] },
		'loan_catalog.settings_id.registered_rule': { fields: 'all' }
	},
	create: {
		columns: {
			loan_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'eligibility',
				'conversion',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'loan_catalog',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			loan_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'eligibility',
				'conversion'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'loan_catalog',
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
