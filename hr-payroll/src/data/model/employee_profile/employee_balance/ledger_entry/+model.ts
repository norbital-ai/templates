import { model } from '@norbital-ai/bolt';

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
			kind: 'text',
			optional: true,
			help: 'What is held in that window, for example entitled or used.'
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
				'source'
			]
		},
		transform: function* (rows, ctx) {
			if (!ctx.policies.includes('payroll_execution'))
				return yield* ctx.refuse('Only posting and sync write the ledger, an admin included.');
			return rows;
		}
	}
});
