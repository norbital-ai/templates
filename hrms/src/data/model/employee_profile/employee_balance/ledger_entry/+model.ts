import { model } from '../../../../../../.norbital/models/ledger_entry.ts';
import { manualAdjustments, syncLate, writesLedger } from '../../../../../lib/ledger/service.js';
import { jsonObject } from '../../../../../lib/payroll_engine/foundation.js';

export default model({
	description:
		'One immutable movement of an employee balance: an amount added to or deducted from one account key.',
	record_label: "record.code + ' · ' + string(record.effective_on)",
	fields: {
		balance_id: { kind: 'ref', to: 'employee_balance', inverse: 'entries' },
		operation: { kind: 'enum', values: ['ADD', 'DEDUCT'] },
		account: { kind: 'text' },
		code: { kind: 'text' },
		period: { kind: 'text', optional: true },
		measure: {
			kind: 'enum',
			values: ['total', 'used', 'entitled', 'carried', 'limit', 'paid'],
			optional: true
		},
		amount: { kind: 'decimal', scale: 12, min: 0, optional: true },
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR', 'MONEY', 'COUNT'],
			optional: true
		},
		effective_on: { kind: 'date' },
		source: { kind: 'text', optional: true },
		note: { kind: 'text', optional: true }
	},
	constraints: {
		// optional on the way in, because a manual adjustment's period and source are worked out in its write
		names_its_movement: {
			check: {
				source: { is_null: false },
				period: { is_null: false },
				measure: { is_null: false },
				amount: { is_null: false }
			},
			message: 'errors.ledger_entry_names_its_movement'
		}
	},
	outputs: { default: { fields: 'all' } },
	create: {
		columns: {
			fields: [
				'balance_id',
				'operation',
				'account',
				'code',
				'amount',
				'unit',
				'effective_on',
				'period',
				'measure',
				'source',
				'note'
			]
		},
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			if (writesLedger(ctx)) return rows;
			// a manual row's source names its own id, which the created row (not the set) carries
			const created = changes.map(({ after }) => after);
			// HR's manual adjustment is the one write by hand, and only of its own shape
			if (!ctx.policies.includes('hr_controller'))
				return yield* ctx.refuse('errors.ledger_entry_posting_only');
			const { keys, onApproved } = yield* manualAdjustments(ctx.query, created.map(jsonObject));
			return {
				sets: rows.map((row, index) => ({ ...row, ...keys[index] })),
				on_approved: onApproved
			};
		},
		effect: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			yield* syncLate(ctx, rows.map(jsonObject));
		}
	}
});
