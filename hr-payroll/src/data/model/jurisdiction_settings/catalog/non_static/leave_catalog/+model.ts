import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('leave_catalog', {
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	label: 'code',
	fields: {
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			optional: true,
			onDelete: 'restrict',
			inverse: 'leave_catalog'
		},
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		/** The share of a normal day a half-day slot pays, 0 to 1: empty pays it in full; a number, or JS per slot. */
		paid_share: { kind: 'text', max: 65536, optional: true },
		/** JS: what a cashed-out entry pays. Only a row with one can be cashed out. */
		payout: { kind: 'text', max: 65536, optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		eligibility: { kind: 'text', max: 65536, optional: true },
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', inverse: 'leave_catalog', owned: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		leave_catalog: { fields: 'all' },
		'leave_catalog.settings_id': { fields: 'all' },
		'leave_catalog.subtotal_id': { fields: ['code', 'name'] },
		'leave_catalog.settings_id.registered_rule': { fields: 'all' }
	},
	create: {
		columns: {
			leave_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'paid_share',
				'payout',
				'references',
				'eligibility',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'leave_catalog',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			leave_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'paid_share',
				'payout',
				'references',
				'eligibility'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'leave_catalog',
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
