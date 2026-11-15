import { policy } from '@norbital-ai/bolt';
/**
 * Purchasing: a purchaser raises purchase orders with their item lines and documents, and changes one until its first
 * invoice is recorded; reads the supplier list to pick from; and prepares facility forms. Each purchaser sees only the
 * orders they raised (the created-by stamp every record carries). They see which line pays an order, never Treasury's
 * pages.
 */
export default policy({
	description: 'Purchasing: raise and change your own purchase orders; prepare facility forms.',
	capabilities: { apps: ['purchasing'], automations: ['facility_form_read'] },
	grants: {
		supplier: { outputs: { default: {} } },
		purchase_order: {
			outputs: { default: { where: { created_by: { eq: { var: 'actor.id' } } } } },
			create: {},
			update: {
				fields: [
					'po_number',
					'po_date',
					'supplier',
					'purchaser',
					'salesperson',
					'currency',
					'ship_to_country',
					'lc_requested',
					'is_cancelled',
					'notes'
				],
				lines: { fields: ['item', 'quantity', 'amount'] },
				verdict: function* (changes, ctx) {
					const { purchase_order } = yield* ctx.query({
						purchase_order: {
							where: { id: { in: changes.map(({ before }) => before.id) } },
							fields: ['invoice_count']
						}
					});
					const invoiced = new Set(
						purchase_order.rows.filter((p) => p.invoice_count > 0).map((p) => p.id)
					);
					const row = changes.findIndex(({ before }) => invoiced.has(before.id));
					return row < 0 ? ctx.allow() : yield* ctx.refuse('errors.po_invoiced', { row });
				}
			}
		},
		po_line: { outputs: { default: {} } },
		invoice: { outputs: { default: {} } },
		invoice_line: { outputs: { default: {} } },
		po_financing: { outputs: { default: {} } },
		po_document: { outputs: { default: {} }, create: {}, update: {} },
		facility_form: { outputs: { default: {} }, create: {}, update: {} },
		facility_attachment: { outputs: { default: {} } }
	}
});
