import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../../lib/payroll_engine/taps.js';

/** One ended employment with no same-jurisdiction successor: the fact exit duties read. */
export default model('contract_exit', {
	description:
		'An ended employment that has no same-jurisdiction successor. The system writes it once; exit duties read it instead of the contract update.',
	fields: {
		employment_id: {
			kind: 'ref',
			to: 'employee_contract',
			onDelete: 'cascade'
		},
		employee_id: {
			kind: 'ref',
			to: 'employee_profile',
			onDelete: 'cascade'
		},
		entity_id: {
			kind: 'ref',
			to: 'entity',
			onDelete: 'cascade'
		},
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			onDelete: 'restrict'
		},
		effective_to: { kind: 'date' },
		final_pay_due_on: { kind: 'date', optional: true }
	},
	unique: [{ fields: ['employment_id'] }],
	read: { contract_exit: { fields: 'all' } },
	create: {
		columns: {
			contract_exit: [
				'employment_id',
				'employee_id',
				'entity_id',
				'settings_id',
				'effective_to',
				'final_pay_due_on'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'contract_exit', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		}
	}
});
