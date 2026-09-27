import { collection } from '@norbital-ai/bolt';

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

export default collection('workers', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
