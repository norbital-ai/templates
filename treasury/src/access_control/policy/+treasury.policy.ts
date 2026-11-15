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
 * points, letters of offer, sub-limits, which banks finance each supplier, month-end locks and FX rates. It also keys
 * invoices against POs, links POs to the lines that pay them and keeps PO documents (the issued LC).
 */
export default policy({
	description: 'Treasury: change banks, facilities, lines, charges, month-ends; link POs to lines.',
	capabilities: {
		apps: ['treasury', 'purchasing'],
		automations: [
			'drawdown_allocate',
			'drawdown_cancel',
			'drawdown_record_advice',
			'drawdown_settle',
			'drawdown_close_bill',
			'bank_document_read',
			'bank_document_apply',
			'month_end_lock',
			'month_end_unlock'
		]
	},
	grants: {
		bank: { outputs: { default: {} }, create: {}, update: {} },
		bank_contact: { outputs: { default: {} } },
		watch_point: { outputs: { default: {} }, create: {}, update: {} },
		letter_of_offer: { outputs: { default: {} }, create: {}, update: {} },
		facility: { outputs: { default: {} }, create: {}, update: {} },
		facility_fee: { outputs: { default: {} } },
		sub_limit: { outputs: { default: {} }, create: {}, update: {} },
		supplier: { outputs: { default: {} }, create: {}, update: {} },
		supplier_bank: { outputs: { default: {} } },
		drawdown: { outputs: { default: {} }, create: {}, update: {} },
		drawdown_charge: { outputs: { default: {} } },
		bank_document: { outputs: { default: {} }, create: {}, update: {} },
		month_end: { outputs: { default: {} }, create: {}, update: {} },
		month_end_line: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} }, create: {}, update: {} },
		purchase_order: {
			outputs: { default: {} },
			update: {
				fields: ['notes'],
				invoices: {
					fields: [...INVOICE_FIELDS],
					lines: { fields: ['po_line', 'quantity', 'amount'] }
				}
			}
		},
		po_line: { outputs: { default: {} } },
		invoice: { outputs: { default: {} } },
		invoice_line: { outputs: { default: {} } },
		po_document: { outputs: { default: {} }, create: {}, update: {} },
		po_financing: { outputs: { default: {} }, create: {}, delete: {} },
		facility_form: { outputs: { default: {} } },
		facility_attachment: { outputs: { default: {} } }
	}
});
