import { model } from '../../../../../.norbital/models/pay_amendment.ts';

export default model({
	description:
		'One paid pay period of one person to work out again. A record of a paid period that is corrected leaves this row in the same write; the next run that pays the person carries the difference and takes the row.',
	icon: 'lucide:history',
	record_label: 'record.period',
	fields: {
		employee_id: { kind: 'ref', to: 'employee_profile', inverse: 'pay_amendments' },
		pay_group_id: {
			kind: 'ref',
			to: 'pay_group',
			// with the period, the one paid run to work out again
			on_delete: 'restrict'
		},
		period: { kind: 'text' },
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'amendments',
			optional: true,
			// empty is open; a run that is deleted unpaid opens its rows again
			on_delete: 'set_null'
		}
	},
	constraints: {
		// one open row a person and period, however many corrections
		open_period: {
			unique: ['employee_id', 'pay_group_id', 'period'],
			where: { payroll_run_id: { is_null: true } }
		}
	},
	outputs: {
		default: {
			fields: 'all',
			employee_id: { fields: ['name'] },
			pay_group_id: { fields: ['name'] },
			payroll_run_id: { fields: ['run_number', 'period', 'state'] }
		}
	},
	create: {
		columns: { fields: ['employee_id', 'pay_group_id', 'period'] },
		transform: function* (changes, ctx) {
			// only the write that corrects a paid period leaves a row: nobody keys one
			if (ctx.carried_by === null) return yield* ctx.refuse('errors.pay_amendment_carried_only');
			return changes.map(({ set }) => set);
		}
	},
	update: { columns: { fields: ['payroll_run_id'] } }
});
