import { model } from '@norbital-ai/bolt';
import { manualAdjustments, syncLate, writesLedger } from '../../../../../lib/ledger/service.js';
import { jsonObject } from '../../../../../lib/payroll_engine/foundation.js';

export default model('ledger_entry', {
	description:
		'One immutable movement of an employee balance: an amount added to or deducted from one account key.',
	label: 'code',
	fields: {
		balance_id: { kind: 'ref', to: 'employee_balance', inverse: 'entries' },
		operation: { kind: 'enum', values: ['ADD', 'DEDUCT'] },
		account: { kind: 'text', help: 'Catalogue family key, for example leave or claim.' },
		code: { kind: 'text', help: 'Account code inside the family, for example ANNUAL_LEAVE.' },
		period: {
			kind: 'text',
			optional: true,
			help: 'The window the value belongs to, for example MY.S.2026-03-05.'
		},
		measure: {
			kind: 'enum',
			values: ['total', 'used', 'entitled', 'carried', 'limit', 'paid'],
			optional: true,
			help: 'What is held in that window.'
		},
		amount: { kind: 'decimal', scale: 12, min: 0, optional: true },
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR', 'MONEY', 'COUNT'],
			optional: true
		},
		effective_on: { kind: 'date' },
		source: {
			kind: 'text',
			optional: true,
			help: 'What caused this movement. Plain text, so a movement outlives what caused it.'
		},
		note: {
			kind: 'text',
			optional: true,
			help: "The cause of HR's manual adjustment."
		}
	},
	// optional on the way in, because a manual adjustment's period and source are worked out in its write
	check: {
		names_its_movement: {
			where: {
				source: { isNull: false },
				period: { isNull: false },
				measure: { isNull: false },
				amount: { isNull: false }
			},
			message: 'A ledger row names its source, period, measure and amount.'
		}
	},
	read: 'all',
	create: {
		columns: {
			ledger_entry: [
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
		transform: function* (rows, ctx) {
			if (writesLedger(ctx)) return rows;
			// HR's manual adjustment is the one write by hand, and only of its own shape
			if (!ctx.policies.includes('hr_controller'))
				return yield* ctx.refuse(
					"Only posting, sync and HR's manual adjustments write the ledger, an admin included."
				);
			const { keys, onApproved } = yield* manualAdjustments(ctx.db.query, rows.map(jsonObject));
			return { rows: rows.map((row, index) => ({ ...row, ...keys[index] })), onApproved };
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* syncLate(ctx, rows.map(jsonObject));
			// an entry that waited for approval has now posted: the law's effects on it are due
			for (const collection of ['leave_catalog_entry', 'claim_catalog_entry']) {
				const ids = [
					...new Set(
						rows.flatMap((row) =>
							row.source?.startsWith(`${collection}:`)
								? [row.source.slice(collection.length + 1)]
								: []
						)
					)
				];
				if (ids.length > 0)
					yield* ctx.schedule('registered_effects', { collection, operation: 'create', ids });
			}
		}
	}
});
