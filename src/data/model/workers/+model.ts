import { model } from '@norbital-ai/bolt';
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
export default model('workers', {
	description: 'Worker roster used for job assignment and compliance checks.',
	icon: 'lucide:users',
	label: ['worker_number', 'worker_name'],
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
	search: { text: ['worker_name', 'worker_number'] },
	read: 'all',
	create: { columns: { workers: columns } },
	update: { columns: { workers: columns } }
});
