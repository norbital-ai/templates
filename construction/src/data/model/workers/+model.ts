import { model } from '../../../../.norbital/models/workers.ts';
const columns = [
	'worker_name',
	'worker_number',
	'trade',
	'status',
	'phone',
	'email',
	'emergency_contact',
	'date_of_birth',
	'nationality',
	'work_permit_expiry',
	'medical_check_date',
	'safety_induction_date'
] as const;
export default model({
	description: 'Worker roster used for job assignment and compliance checks.',
	icon: 'lucide:users',
	record_label:
		"[record.worker_number != null ? string(record.worker_number) : '', record.worker_name != null ? string(record.worker_name) : ''].filter(part, part != '').join(' · ')",
	fields: {
		worker_name: { kind: 'text' },
		worker_number: { kind: 'text', optional: true, unique: true },
		trade: { kind: 'text', optional: true },
		status: { kind: 'enum', values: ['active', 'inactive', 'suspended'], optional: true },
		phone: { kind: 'text', optional: true },
		email: { kind: 'text', optional: true },
		emergency_contact: { kind: 'custom', of: 'emergency_contact', optional: true },
		date_of_birth: { kind: 'date', optional: true },
		nationality: { kind: 'text', optional: true },
		work_permit_expiry: { kind: 'date', optional: true },
		medical_check_date: { kind: 'date', optional: true },
		safety_induction_date: { kind: 'date', optional: true }
	},
	indexes: { find: { text: ['worker_name', 'worker_number'] } },
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
