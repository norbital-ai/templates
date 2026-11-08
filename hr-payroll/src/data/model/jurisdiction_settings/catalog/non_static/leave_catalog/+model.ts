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
		name: { kind: 'text' },
		description: { kind: 'text', optional: true },
		pay_treatment: { kind: 'enum', values: ['PAID', 'UNPAID'] },
		conversion: { kind: 'text', max: 65536, optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		eligibility: { kind: 'text', max: 65536, optional: true },
		incurred_on: { kind: 'text', max: 65536, optional: true },
		direction: { kind: 'enum', values: ['ADD', 'DEDUCT'], default: 'ADD' },
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', inverse: 'leave_catalog', owned: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		leave_catalog: { fields: 'all' },
		'leave_catalog.settings_id': { fields: 'all' },
		'leave_catalog.settings_id.registered_rule': { fields: 'all' }
	},
	create: {
		columns: {
			leave_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'name',
				'description',
				'pay_treatment',
				'conversion',
				'references',
				'eligibility',
				'incurred_on',
				'direction',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			if (
				rows.some(
					(row) => row.pay_treatment === 'UNPAID' && row.conversion != null && row.conversion !== ''
				)
			)
				return yield* ctx.refuse('An unpaid leave row cannot also carry a conversion.');
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
				'name',
				'description',
				'pay_treatment',
				'conversion',
				'references',
				'eligibility',
				'incurred_on',
				'direction'
			]
		},
		transform: function* (changes, ctx) {
			if (
				changes.some(
					({ before, set }) =>
						({ ...before, ...set }).pay_treatment === 'UNPAID' &&
						{ ...before, ...set }.conversion != null &&
						{ ...before, ...set }.conversion !== ''
				)
			)
				return yield* ctx.refuse('An unpaid leave row cannot also carry a conversion.');
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
