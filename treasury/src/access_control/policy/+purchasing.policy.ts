import { policy } from '@norbital-ai/bolt';

const OWN = { created_by: { eq: { var: 'actor.id' } } } as const;
const OWN_PO = { po: { is: OWN } } as const;
/**
 * Purchasing: a purchaser raises purchase orders with their item lines and documents, and changes one until its first
 * invoice is recorded; reads the supplier list to pick from; and prepares facility forms. Each purchaser sees only the
 * orders they raised (the created-by stamp every record carries). They see which line pays an order, never Treasury's
 * pages.
 */
export default policy({
	description: 'Purchasing: raise and change your own purchase orders; prepare financing requests.',
	capabilities: {
		apps: ['purchasing'],
		automations: ['facility_form_read', 'facility_form_pack']
	},
	grants: {
		business_partner: { outputs: { default: {} } },
		purchase_order: {
			outputs: { default: { where: OWN } },
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
					const away = changes.findIndex(
						({ before }) => ctx.actor.kind !== 'member' || before.created_by !== ctx.actor.id
					);
					if (away >= 0) return yield* ctx.refuse('errors.po_owner', { row: away });
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
		po_line: { outputs: { default: { where: OWN_PO } } },
		invoice: { outputs: { default: { where: OWN_PO } } },
		invoice_line: { outputs: { default: { where: { invoice: { is: OWN_PO } } } } },
		po_financing: { outputs: { default: { where: { purchase_order: { is: OWN } } } } },
		po_document: {
			outputs: { default: { where: OWN_PO } },
			create: {
				verdict: function* (changes, ctx) {
					if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.po_owner');
					const { purchase_order } = yield* ctx.query({
						purchase_order: {
							where: {
								id: { in: changes.map(({ after }) => after.po) },
								created_by: { eq: ctx.actor.id }
							},
							fields: ['id']
						}
					});
					const own = new Set(purchase_order.rows.map((p) => p.id));
					const away = changes.findIndex(({ after }) => !own.has(after.po));
					return away < 0 ? ctx.allow() : yield* ctx.refuse('errors.po_owner', { row: away });
				}
			},
			update: {
				verdict: function* (changes, ctx) {
					if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.po_owner');
					const { purchase_order } = yield* ctx.query({
						purchase_order: {
							where: {
								id: { in: changes.map(({ before }) => before.po) },
								created_by: { eq: ctx.actor.id }
							},
							fields: ['id']
						}
					});
					const own = new Set(purchase_order.rows.map((p) => p.id));
					const away = changes.findIndex(({ before }) => !own.has(before.po));
					return away < 0 ? ctx.allow() : yield* ctx.refuse('errors.po_owner', { row: away });
				}
			}
		},
		facility_form: { outputs: { default: {} }, create: {}, update: {} },
		facility_attachment: { outputs: { default: {} } }
	}
});
