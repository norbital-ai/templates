import { model } from '@norbital-ai/bolt';

export default model('ledger_entry', {
	description:
		'One immutable operation on an employee balance account map: create an account, remove it, or add to/deduct from it.',
	label: 'code',
	fields: {
		balance_id: { kind: 'ref', to: 'employee_balance', inverse: 'entries' },
		operation: { kind: 'enum', values: ['CREATE', 'REMOVE', 'ADD', 'DEDUCT'] },
		account: { kind: 'text', help: 'Catalogue family key, for example leave or claim.' },
		code: { kind: 'text', help: 'Account code inside the family, for example ANNUAL_LEAVE.' },
		amount: { kind: 'decimal', scale: 12, min: 0, optional: true },
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR', 'MONEY', 'COUNT'],
			optional: true
		},
		effective_on: { kind: 'date' },
		source_id: {
			kind: 'ref',
			to: [
				'leave_catalog_entry',
				'claim_catalog_entry',
				'adhoc_catalog_entry',
				'loan_catalog_entry',
				'loan_repayment_entry',
				'payroll_run'
			],
			inverse: 'ledger_entries',
			optional: true,
			onDelete: 'setNull'
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
				'source_id'
			]
		}
	}
});
