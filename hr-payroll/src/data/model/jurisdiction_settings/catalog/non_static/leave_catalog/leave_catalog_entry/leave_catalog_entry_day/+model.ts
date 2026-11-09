import { model } from '@norbital-ai/bolt';

export default model('leave_catalog_entry_day', {
	description:
		'One leave slot: a dated half-day. A payroll run stamps payroll_run_id when it prices the slot; an unpriced slot is corrected by deletion.',
	label: 'incurred_on',
	fields: {
		leave_entry_id: {
			kind: 'ref',
			to: 'leave_catalog_entry',
			inverse: 'leave_catalog_entry_day',
			owned: true,
			onDelete: 'cascade'
		},
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			optional: true,
			onDelete: 'setNull'
		},
		incurred_on: { kind: 'date' },
		part: { kind: 'enum', values: ['AM', 'PM'] }
	},
	unique: [{ fields: ['leave_entry_id', 'incurred_on', 'part'] }],
	read: {
		leave_catalog_entry_day: { fields: 'all' },
		'leave_catalog_entry_day.leave_entry_id': {
			fields: ['id', 'employment_id', 'catalog_id', 'reverses', 'payroll_run_id']
		},
		'leave_catalog_entry_day.payroll_run_id': { fields: ['id', 'period', 'state'] }
	},
	create: {
		columns: {
			leave_catalog_entry_day: ['incurred_on', 'part']
		}
	},
	update: {
		columns: {
			leave_catalog_entry_day: ['payroll_run_id']
		}
	},
	delete: {
		check: function* (rows, ctx) {
			if (rows.some((row) => row.payroll_run_id != null))
				return yield* ctx.refuse(
					'A slot a payroll run priced cannot be deleted; reverse it instead.'
				);
		}
	}
});
