import { model } from '../../../../.norbital/models/report_subscription.ts';

/**
 * A user subscribed to the daily report, one row each: the run sends the report to every subscriber through the account
 * the settings name. A client subscribes and unsubscribes themselves; managers see and manage every row.
 */
export default model({
	description: 'A user who receives the daily report directly.',
	icon: 'lucide:bell',
	record_label: 'record.user.name',
	fields: {
		user: { kind: 'ref', to: 'sys_user', default: { var: 'requestor.id' } }
	},
	constraints: { one_per_user: { unique: ['user'], message: 'errors.already_subscribed' } },
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: ['user'] } },
	delete: {}
});
