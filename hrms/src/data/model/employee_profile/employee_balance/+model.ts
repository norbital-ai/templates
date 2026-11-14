import { model } from '@norbital-ai/bolt';
import { RUN_STINT } from '../../../../lib/payroll_engine/run_output.js';
import { writesLedger } from '../../../../lib/ledger/service.js';

export default model('employee_balance', {
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
	// a company's balances are found through the person and their stints
	outputs: {
		// the payroll run's named read: this model through the stint a run finds it by
		run: { fields: 'all', employee_id: { fields: ['id'], employment: RUN_STINT } },
		default: {
			fields: 'all',
			employee_id: { fields: ['name'], employment: { fields: ['entity_id'] } }
		}
	},
	create: {
		fields: ['employee_id', 'account'],
		transform: function* (changes, ctx) {
			if (!writesLedger(ctx)) return yield* ctx.refuse('errors.employee_balance_ledger_only');
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: ['account'],
		transform: function* (changes, ctx) {
			if (!writesLedger(ctx)) return yield* ctx.refuse('errors.employee_balance_ledger_only');
			return changes.map(({ set }) => set);
		}
	}
});
