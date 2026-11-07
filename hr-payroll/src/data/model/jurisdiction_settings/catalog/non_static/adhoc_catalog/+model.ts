import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('adhoc_catalog', {
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	label: 'code',
	fields: {
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			optional: true,
			onDelete: 'restrict',
			inverse: 'adhoc_catalog'
		},
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		code: { kind: 'text' },
		name: { kind: 'text' },
		description: { kind: 'text', optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		eligibility: { kind: 'text', max: 65536, optional: true },
		incurred_on: { kind: 'text', max: 65536, optional: true },
		direction: { kind: 'enum', values: ['ADD', 'DEDUCT'], default: 'ADD' },
		party: { kind: 'enum', values: ['EMPLOYEE', 'EMPLOYER'], default: 'EMPLOYEE' },
		off_cycle_eligible: { kind: 'bool' },
		conversion: { kind: 'text', max: 65536, optional: true },
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', inverse: 'adhoc_catalog', owned: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		adhoc_catalog: { fields: 'all' },
		'adhoc_catalog.settings_id': { fields: 'all' },
		'adhoc_catalog.settings_id.registered_rule': { fields: 'all' }
	},
	create: {
		columns: {
			adhoc_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'name',
				'description',
				'references',
				'eligibility',
				'incurred_on',
				'direction',
				'party',
				'off_cycle_eligible',
				'conversion',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'adhoc_catalog',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			adhoc_catalog: [
				'subtotal_id',
				'lookup',
				'code',
				'name',
				'description',
				'references',
				'eligibility',
				'incurred_on',
				'direction',
				'party',
				'off_cycle_eligible',
				'conversion'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'adhoc_catalog',
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
