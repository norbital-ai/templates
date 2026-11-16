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
const EARMARK_FIELDS = [
	'status',
	'supplier',
	'product',
	'currency',
	'amount',
	'expected_draw_date',
	'earliest_invoice_date',
	'requested_by',
	'purpose',
	'notes'
] as const;

/**
 * Finance: opens every treasury page, plans payments as earmarks (and cancels them), keeps the supplier list,
 * records supplier invoices against purchase orders and keeps PO documents (the issued LC). Which banks finance a
 * supplier, and everything on a line once Treasury has allocated it, stay with Treasury.
 */
export default policy({
	description: 'Finance: plan earmarks, keep suppliers, record invoices; read everything else.',
	capabilities: {
		apps: ['treasury', 'purchasing', 'configuration'],
		automations: ['drawdown_cancel', 'facility_form_pack']
	},
	grants: {
		bank: { outputs: { default: {} } },
		watch_point: { outputs: { default: {} } },
		letter_of_offer: { outputs: { default: {} } },
		facility: { outputs: { default: {} } },
		facility_fee: { outputs: { default: {} } },
		sub_limit: { outputs: { default: {} } },
		business_partner: {
			outputs: { default: {} },
			create: {
				fields: [
					'name',
					'is_supplier',
					'is_customer',
					'aliases',
					'country',
					'payment_terms',
					'products',
					'relationship_since',
					'notes',
					'is_active'
				]
			},
			update: {
				fields: [
					'name',
					'is_supplier',
					'is_customer',
					'aliases',
					'country',
					'payment_terms',
					'products',
					'relationship_since',
					'notes',
					'is_active'
				]
			}
		},
		supplier_bank: { outputs: { default: {} } },
		drawdown: {
			outputs: { default: {} },
			create: {
				fields: [...EARMARK_FIELDS],
				verdict: function* (changes, ctx) {
					const row = changes.findIndex(({ after }) => after.status !== 'earmarked');
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.finance_earmarks_only', { row });
				}
			},
			update: {
				fields: [...EARMARK_FIELDS],
				verdict: function* (changes, ctx) {
					const row = changes.findIndex(({ before }) => before.status !== 'earmarked');
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.finance_earmarks_only', { row });
				}
			}
		},
		drawdown_charge: { outputs: { default: {} } },
		bank_document: { outputs: { default: {} } },
		month_end: { outputs: { default: {} } },
		month_end_line: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} } },
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
		po_financing: { outputs: { default: {} } },
		facility_form: { outputs: { default: {} } },
		facility_attachment: { outputs: { default: {} } }
	}
});
