import { model } from '@norbital-ai/bolt';

const SYSTEM_ONLY = 'Only posting and sync move a balance, an admin included.';

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
		},
		transform: function* (rows, ctx) {
			if (!ctx.policies.includes('payroll_execution')) return yield* ctx.refuse(SYSTEM_ONLY);
			return rows;
		}
	},
	update: {
		columns: {
			employee_balance: ['account']
		},
		transform: function* (changes, ctx) {
			if (!ctx.policies.includes('payroll_execution')) return yield* ctx.refuse(SYSTEM_ONLY);
			return changes.map(({ set }) => set);
		}
	}
});
