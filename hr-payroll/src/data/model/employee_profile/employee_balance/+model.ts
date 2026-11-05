import { model } from '@norbital-ai/bolt';

export default model('employee_balance', {
	description:
		'One balance row per employee profile. Accounts are keyed by catalogue family (leave, claim, statutory contribution, …), then by account code, so the map is data rather than fixed columns.',
	record_label: "'Balance'",
	fields: {
		employee_id: { kind: 'ref', to: 'employee_profile' },
		account: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'record', of: { kind: 'json' } } },
			default: {}
		}
	},
	unique: [{ fields: ['employee_id'] }],
	read: {
		employee_balance: { fields: 'all' },
		'employee_balance.employee_id': { fields: ['name'] }
	},
	create: {
		columns: {
			employee_balance: ['employee_id', 'account']
		}
	},
	update: {
		columns: {
			employee_balance: ['account']
		}
	}
});
