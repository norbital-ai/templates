import { model } from '@norbital-ai/bolt';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model('statutory_contribution_catalog', {
	description:
		'Effective jurisdiction statutory scheme. One lookup, an eligibility function and employee/employer amount functions.',
	label: 'code',
	fields: {
		employer_cost_subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			optional: true,
			onDelete: 'restrict',
			inverse: 'statutory_employer_cost'
		},
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			onDelete: 'restrict',
			inverse: 'statutory_contribution_catalog'
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
		kind: { kind: 'enum', values: ['CONTRIBUTION', 'TAX'] },
		/** The posting window this scheme holds in the ledger. */
		balance_window: { kind: 'enum', values: ['MONTH', 'YEAR'], default: 'YEAR' },
		eligibility: { kind: 'text', max: 65536 },
		depends_on: { kind: 'list', of: { kind: 'text' }, optional: true },
		employee_amount: { kind: 'text', max: 65536 },
		employer_amount: { kind: 'text', max: 65536, optional: true },
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'statutory_contribution_catalog',
			owned: true
		}
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: {
		statutory_contribution_catalog: { fields: 'all' },
		'statutory_contribution_catalog.settings_id': { fields: 'all' },
		'statutory_contribution_catalog.subtotal_id': { fields: ['code', 'name'] },
		'statutory_contribution_catalog.employer_cost_subtotal_id': { fields: ['code', 'name'] }
	},
	create: {
		columns: {
			statutory_contribution_catalog: [
				'employer_cost_subtotal_id',
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'kind',
				'balance_window',
				'eligibility',
				'depends_on',
				'employee_amount',
				'employer_amount',
				'settings_id'
			]
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'statutory_contribution_catalog',
				rows,
				rows.map((r) => r.settings_id)
			);
			return rows;
		}
	},
	update: {
		columns: {
			statutory_contribution_catalog: [
				'employer_cost_subtotal_id',
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'kind',
				'balance_window',
				'eligibility',
				'depends_on',
				'employee_amount',
				'employer_amount'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'statutory_contribution_catalog',
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
