import { collection } from '@norbital-ai/bolt';

const columns = [
	'eta_limit_minutes',
	'eta_check_lead_minutes',
	'shift_check_lead_minutes',
	'shift_reply_minutes',
	'free_change_hours'
] as const;

export default collection('dispatch_settings', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
