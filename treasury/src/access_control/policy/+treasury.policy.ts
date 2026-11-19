import { policy } from '@norbital-ai/bolt';

const INVOICE_FIELDS = [
	'invoice_number',
	'invoice_date',
	'currency',
	'amount',
	'bank_bill_number',
	'drawdown',
	'notes'
] as const;

/**
 * Treasury: sees every facility, line, purchase order and supplier, and is the team that changes them: limits and
 * terms, lines through their lifecycle (allocate, advices, settle, cash or convert), charges, banks, fee rules, watch
 * points, letters of offer, sub-limits, which banks finance each supplier, month-end locks, FX rates, and FX hedges
 * (deals, fixing rates, documents and proposals). It also keys
 * invoices against POs and keeps every purchase order as Accounts (edit, cancel or reopen it, file or remove any
 * document, the issued LC included), links POs to the lines that pay them, and removes bank advices not yet
 * submitted.
 */
export default policy({
	description: 'Treasury: change banks, facilities, lines, charges, month-ends; link POs to lines.',
	capabilities: {
		apps: ['treasury', 'hedging', 'purchasing', 'configuration'],
		automations: [
			'facility_form_pack',
			'purchase_order_read',
			'drawdown_allocate',
			'drawdown_earmark_po',
			'drawdown_cancel',
			'drawdown_record_advice',
			'drawdown_settle',
			'drawdown_close_bill',
			'bank_document_read',
			'bank_document_apply',
			'month_end_lock',
			'month_end_unlock',
			'fx_rates_fetch',
			'fx_document_read',
			'fx_proposal_read'
		]
	},
	grants: {
		bank: { outputs: { default: {} }, create: {}, update: {} },
		watch_point: { outputs: { default: {} }, create: {}, update: {} },
		letter_of_offer: { outputs: { default: {} }, create: {}, update: {} },
		facility: { outputs: { default: {} }, create: {}, update: {} },
		facility_fee: { outputs: { default: {} } },
		sub_limit: { outputs: { default: {} }, create: {}, update: {} },
		business_partner: { outputs: { default: {} }, create: {}, update: {} },
		supplier_bank: { outputs: { default: {} } },
		drawdown: { outputs: { default: {} }, create: {}, update: {} },
		drawdown_charge: { outputs: { default: {} } },
		bank_document: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		month_end: { outputs: { default: {} }, update: { fields: ['notes'] } },
		month_end_line: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} }, create: {}, update: {} },
		fx_deal: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		fx_fixing: { outputs: { default: {} } },
		fx_document: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		fx_proposal: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		purchase_order: {
			outputs: { default: {} },
			update: {
				fields: [
					'po_number',
					'po_date',
					'supplier',
					'salesperson',
					'currency',
					'ship_to_country',
					'lc_requested',
					'is_cancelled',
					'payment_date',
					'no_financing',
					'notes'
				],
				lines: { fields: ['item', 'quantity', 'amount'] },
				invoices: {
					fields: [...INVOICE_FIELDS],
					lines: { fields: ['po_line', 'quantity', 'amount'] }
				}
			}
		},
		po_line: { outputs: { default: {} } },
		invoice: { outputs: { default: {} } },
		invoice_line: { outputs: { default: {} } },
		po_document: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		po_financing: { outputs: { default: {} }, create: {}, delete: {} },
		facility_form: { outputs: { default: {} } },
		facility_attachment: { outputs: { default: {} } }
	}
});
