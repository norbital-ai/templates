import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('workplace_case_catalog', {
	description:
		'Effective jurisdiction catalogue of entity-wide workplace case variants and their registered effects.',
	label: 'name',
	fields: {
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'workplace_case_catalog',
			owned: true
		},
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		subtotal_id: { kind: 'ref', to: 'subtotal', optional: true, onDelete: 'restrict' },
		code: { kind: 'text' },
		name: { kind: 'text' },
		description: { kind: 'text', optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		events: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		workplace_case_catalog: { fields: 'all' },
		'workplace_case_catalog.settings_id': { fields: 'all' }
	},
	create: {
		columns: {
			workplace_case_catalog: [
				'settings_id',
				'lookup',
				'subtotal_id',
				'code',
				'name',
				'description',
				'references',
				'events'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'workplace_case_catalog',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			workplace_case_catalog: [
				'lookup',
				'subtotal_id',
				'code',
				'name',
				'description',
				'references',
				'events'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'workplace_case_catalog',
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
