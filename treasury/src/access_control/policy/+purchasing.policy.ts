import { policy } from '@norbital-ai/bolt';

const OWN = { created_by: { eq: { var: 'actor.id' } } } as const;
const OWN_PO = { po: { is: OWN } } as const;
/** What a purchaser files on their own PO; the issued LC and the supplier's invoice are Accounts'. */
const PURCHASER_KINDS: readonly string[] = ['purchase_order', 'supporting', 'other'];
/**
 * Purchasing: a purchaser raises purchase orders with their item lines and documents, and changes one until its first
 * invoice is recorded; files the PO, supporting documents and others on their own orders and removes files they
 * filed; reads the supplier list to pick from; and prepares facility forms. Each purchaser sees only the orders they
 * raised (the created-by stamp every record carries). They see which line pays an order, never Treasury's pages.
 */
export default policy({
	description: 'Purchasing: raise and change your own purchase orders; prepare financing requests.',
	capabilities: {
		apps: ['purchasing'],
		automations: ['facility_form_read', 'facility_form_pack', 'purchase_order_read']
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
					'salesperson',
					'currency',
					'ship_to_country',
					'lc_requested',
					'is_cancelled',
					'payment_date',
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
					if (away >= 0) return yield* ctx.refuse('errors.po_owner', { row: away });
					// an omitted kind takes the model's default, a supporting document
					const kind = changes.findIndex(
						({ after }) => after.kind !== undefined && !PURCHASER_KINDS.includes(after.kind)
					);
					return kind < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.po_document_kind', { row: kind });
				}
			},
			update: {
				verdict: function* (changes, ctx) {
					if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.po_owner');
					const member = ctx.actor.id;
					const uploader = changes.findIndex(({ before }) => before.created_by !== member);
					if (uploader >= 0)
						return yield* ctx.refuse('errors.po_document_owner', { row: uploader });
					const { purchase_order } = yield* ctx.query({
						purchase_order: {
							where: {
								id: { in: changes.map(({ before }) => before.po) },
								created_by: { eq: member }
							},
							fields: ['id']
						}
					});
					const own = new Set(purchase_order.rows.map((p) => p.id));
					const away = changes.findIndex(({ before }) => !own.has(before.po));
					if (away >= 0) return yield* ctx.refuse('errors.po_owner', { row: away });
					const kind = changes.findIndex(
						({ before, after }) =>
							!PURCHASER_KINDS.includes(before.kind) || !PURCHASER_KINDS.includes(after.kind)
					);
					return kind < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.po_document_kind', { row: kind });
				}
			},
			delete: {
				verdict: function* (changes, ctx) {
					const away = changes.findIndex(
						({ before }) => ctx.actor.kind !== 'member' || before.created_by !== ctx.actor.id
					);
					return away < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.po_document_owner', { row: away });
				}
			}
		},
		facility_form: { outputs: { default: {} }, create: {}, update: {} },
		facility_attachment: { outputs: { default: {} } }
	}
});
