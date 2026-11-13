import { model } from '../../../../../../.norbital/models/leave_catalog_entry_day.ts';

export default model({
	description:
		'One leave slot: a dated half-day. A payroll run stamps payroll_run_id when it prices the slot. A slot is corrected where it stands; when its period is paid, the next run carries the difference.',
	record_label: 'string(record.incurred_on)',
	fields: {
		leave_entry_id: {
			kind: 'ref',
			to: 'leave_catalog_entry',
			inverse: 'leave_catalog_entry_day',
			owned: true,
			on_delete: 'cascade'
		},
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'leave_day',
			optional: true,
			on_delete: 'set_null'
		},
		incurred_on: { kind: 'date' },
		part: { kind: 'enum', values: ['AM', 'PM'] }
	},
	constraints: { slot: { unique: ['leave_entry_id', 'incurred_on', 'part'] } },
	outputs: {
		default: {
			fields: 'all',
			leave_entry_id: { fields: ['id', 'employment_id', 'catalog_code', 'payroll_run_id'] },
			payroll_run_id: { fields: ['id', 'period', 'state'] }
		}
	},
	create: { columns: { fields: ['incurred_on', 'part'] } },
	update: { columns: { fields: ['payroll_run_id'] } },
	delete: {}
});
