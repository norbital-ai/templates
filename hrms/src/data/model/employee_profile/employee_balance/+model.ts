import { model } from '../../../../../.norbital/models/employee_balance.ts';
import { writesLedger } from '../../../../lib/ledger/service.js';

export default model({
	description:
		'One balance row per employee profile. Accounts are keyed by catalogue family (leave, claim, statutory contribution, …), then by account code, so the map is data rather than fixed columns.',
	record_label: "has(record.employee_id.name) ? record.employee_id.name : 'Balance'",
	fields: {
		employee_id: { kind: 'ref', to: 'employee_profile' },
		account: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'record', of: { kind: 'json' } } },
			default: {}
		}
	},
	constraints: { one_balance: { unique: ['employee_id'] } },
	outputs: { default: { fields: 'all', employee_id: { fields: ['name'] } } },
	create: {
		columns: {
			fields: ['employee_id', 'account']
		},
		transform: function* (changes, ctx) {
			if (!writesLedger(ctx)) return yield* ctx.refuse('errors.employee_balance_ledger_only');
			return changes.map(({ set }) => set);
		}
	},
	update: {
		columns: {
			fields: ['account']
		},
		transform: function* (changes, ctx) {
			if (!writesLedger(ctx)) return yield* ctx.refuse('errors.employee_balance_ledger_only');
			return changes.map(({ set }) => set);
		}
	}
});
