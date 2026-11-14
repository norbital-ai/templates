import { model } from '@norbital-ai/bolt';
/**
 * One financing line: an earmark planned by the team, then applied to a bank, drawn, and settled.
 * The bank's own numbers, the dates, the all-in rate and the
 * settlement figures are kept exactly as the bank's advice gives them.
 */
export default model('drawdown', {
	description: 'One financing line, from earmark through drawdown to settlement.',
	icon: 'lucide:hand-coins',
	record_label: 'record.bank_reference',
	fields: {
		facility: {
			kind: 'ref',
			to: 'facility',
			inverse: 'drawdowns',
			optional: true,
			on_delete: 'restrict'
		},
		supplier: {
			kind: 'ref',
			to: 'supplier',
			inverse: 'drawdowns',
			optional: true,
			on_delete: 'restrict'
		},
		product: {
			kind: 'enum',
			values: [
				'if',
				'if_after_lc_or_da',
				'lc',
				'import_bill',
				'da',
				'dp',
				'tb',
				'twc',
				'stl',
				'bg',
				'cash',
				'other'
			],
			default: 'if'
		},
		status: {
			kind: 'enum',
			values: ['earmarked', 'applied', 'active', 'settled', 'cancelled', 'unclear'],
			default: 'active',
			transitions: {
				earmarked: ['applied', 'active', 'cancelled'],
				applied: ['active', 'cancelled'],
				active: ['settled', 'cancelled'],
				settled: [],
				cancelled: [],
				unclear: ['active', 'settled', 'cancelled']
			}
		},
		is_archived: { kind: 'bool', default: false },
		bank_reference: { kind: 'text', optional: true },
		lc_number: { kind: 'text', optional: true },
		lc_expiry_date: { kind: 'date', optional: true },
		bill_number: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'USD' },
		amount: { kind: 'decimal', scale: 2 },
		application_date: { kind: 'date', optional: true },
		released_date: { kind: 'date', optional: true },
		start_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		charge_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		day_count_basis: {
			kind: 'enum',
			values: ['actual_360', 'actual_365'],
			default: 'actual_360'
		},
		expected_draw_date: { kind: 'date', optional: true },
		earliest_invoice_date: { kind: 'date', optional: true },
		purpose: { kind: 'text', optional: true },
		settlement_date: { kind: 'date', optional: true },
		settled_principal: { kind: 'decimal', scale: 2, optional: true },
		settled_interest: { kind: 'decimal', scale: 2, optional: true },
		notes: { kind: 'text', optional: true }
	},
	indexes: {
		by_status_due: { on: ['status', 'due_date'] },
		by_reference: { text: ['bank_reference', 'lc_number', 'bill_number'] }
	},
	outputs: {
		default: {
			fields: 'all',
			facility: {
				fields: [
					'name',
					'currency',
					'limit',
					'max_tenor_days',
					'day_count_basis',
					'interest_rounding'
				],
				bank: { fields: ['code', 'name'] }
			},
			supplier: { fields: ['name'] },
			charges: {
				fields: ['charge_type', 'stage', 'currency', 'amount', 'is_estimate', 'description']
			},
			invoices: { fields: ['invoice_number', 'invoice_date', 'amount', 'bank_bill_number'] },
			documents: {
				fields: ['doc_type', 'advice_reference', 'advice_date', 'read_status']
			}
		}
	},
	create: {
		fields: [
			'facility',
			'supplier',
			'product',
			'status',
			'bank_reference',
			'lc_number',
			'lc_expiry_date',
			'bill_number',
			'currency',
			'amount',
			'application_date',
			'released_date',
			'start_date',
			'due_date',
			'interest_rate_pct',
			'charge_rate_pct',
			'day_count_basis',
			'expected_draw_date',
			'earliest_invoice_date',
			'purpose',
			'notes'
		],
		charges: {
			fields: ['charge_type', 'stage', 'currency', 'amount', 'is_estimate', 'description']
		}
	},
	update: {
		fields: [
			'facility',
			'supplier',
			'product',
			'status',
			'is_archived',
			'bank_reference',
			'lc_number',
			'lc_expiry_date',
			'bill_number',
			'currency',
			'amount',
			'application_date',
			'released_date',
			'start_date',
			'due_date',
			'interest_rate_pct',
			'charge_rate_pct',
			'day_count_basis',
			'expected_draw_date',
			'earliest_invoice_date',
			'purpose',
			'settlement_date',
			'settled_principal',
			'settled_interest',
			'notes'
		],
		charges: {
			fields: ['charge_type', 'stage', 'currency', 'amount', 'is_estimate', 'description']
		}
	}
});
