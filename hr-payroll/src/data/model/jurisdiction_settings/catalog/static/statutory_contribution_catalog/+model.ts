import { Effect } from 'effect';
import { model } from '../../../../../../../.norbital/models/statutory_contribution_catalog.ts';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model({
	description:
		'Effective jurisdiction statutory scheme. One lookup, an eligibility function and employee/employer amount functions.',
	record_label: 'record.code',
	fields: {
		employer_cost_subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			optional: true,
			on_delete: 'restrict',
			inverse: 'statutory_employer_cost'
		},
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			on_delete: 'restrict',
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
			optional: true
		},
		references: { kind: 'custom', of: 'references', optional: true },
		kind: { kind: 'enum', values: ['CONTRIBUTION', 'TAX'] },
		/** The posting window this scheme holds in the ledger. */
		balance_window: { kind: 'enum', values: ['MONTH', 'YEAR'], default: 'YEAR' },
		/**
		 * Which month answers for pay a run carries for an earlier period. EARNED: the scheme is worked out again for
		 * the month the pay was earned, and the difference is carried. PAID: the earlier month's charge stands, and
		 * the carried pay counts as wages of the month that pays it.
		 */
		assessed: {
			kind: 'enum',
			values: ['EARNED', 'PAID'],
			default: 'EARNED'
		},
		eligibility: { kind: 'text', max: 65536 },
		depends_on: { kind: 'text', many: true, optional: true },
		employee_amount: { kind: 'text', max: 65536 },
		employer_amount: { kind: 'text', max: 65536, optional: true },
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'statutory_contribution_catalog',
			owned: true
		}
	},
	constraints: { code_per_settings: { unique: ['settings_id', 'code'] } },
	outputs: {
		default: {
			fields: 'all',
			settings_id: { fields: 'all' },
			subtotal_id: { fields: ['code', 'name'] },
			employer_cost_subtotal_id: { fields: ['code', 'name'] }
		}
	},
	create: {
		columns: {
			fields: [
				'employer_cost_subtotal_id',
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'kind',
				'balance_window',
				'assessed',
				'eligibility',
				'depends_on',
				'employee_amount',
				'employer_amount',
				'settings_id'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'statutory_contribution_catalog',
				changes.map((c) => c.after),
				changes.map((c) => c.after.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	update: {
		columns: {
			fields: [
				'employer_cost_subtotal_id',
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'kind',
				'balance_window',
				'assessed',
				'eligibility',
				'depends_on',
				'employee_amount',
				'employer_amount'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'statutory_contribution_catalog',
				changes.map((c) => c.after),
				changes.map((c) => c.before.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			yield* requireDraftSettings(
				ctx.query,
				changes.map((c) => c.before.settings_id)
			).pipe(
				Effect.catchTag('Refusal', (error) =>
					ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
				)
			);
		}
	}
});
