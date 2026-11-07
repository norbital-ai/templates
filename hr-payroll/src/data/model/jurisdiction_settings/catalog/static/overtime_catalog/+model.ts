import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('overtime_catalog', {
	description:
		'Effective jurisdiction overtime pricing. One lookup, an eligibility function and an amount function; no bands or selectors.',
	label: 'code',
	fields: {
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			onDelete: 'restrict',
			inverse: 'overtime_catalog'
		},
		lookup: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		code: { kind: 'text' },
		name: { kind: 'text' },
		references: { kind: 'custom', of: 'references', optional: true },
		eligibility: { kind: 'text', max: 65536 },
		conversion: { kind: 'text', max: 65536 },
		incurred_on: { kind: 'text', max: 65536, optional: true },
		direction: { kind: 'enum', values: ['ADD', 'DEDUCT'] },
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'overtime_catalog',
			owned: true
		}
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		overtime_catalog: { fields: 'all' },
		'overtime_catalog.settings_id': { fields: 'all' }
	},
	create: {
		columns: {
			overtime_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'name',
				'references',
				'eligibility',
				'conversion',
				'incurred_on',
				'direction',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'overtime_catalog',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			overtime_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'name',
				'references',
				'eligibility',
				'conversion',
				'incurred_on',
				'direction'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'overtime_catalog',
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
