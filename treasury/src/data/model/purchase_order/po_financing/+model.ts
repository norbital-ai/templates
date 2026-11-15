import { model } from '@norbital-ai/bolt';
/**
 * A purchase order and the line that pays it, usually its LC: one LC can cover several POs and a PO can be split
 * across lines. `is_lc` is filled from the line (an LC, or financing that keeps an LC number), so a PO asking to be
 * paid by LC leaves "LCs to open" once it is linked to one.
 */
export default model('po_financing', {
	description: 'A purchase order linked to the line that pays it.',
	icon: 'lucide:link',
	record_label:
		"record.purchase_order.po_number + ' · ' + (record.drawdown.bank_reference != null ? record.drawdown.bank_reference : string(record.drawdown.product))",
	fields: {
		purchase_order: {
			kind: 'ref',
			to: 'purchase_order',
			inverse: 'financings',
			on_delete: 'cascade'
		},
		drawdown: { kind: 'ref', to: 'drawdown', inverse: 'financings', on_delete: 'cascade' },
		is_lc: { kind: 'bool', default: false }
	},
	constraints: {
		one_link: { unique: ['purchase_order', 'drawdown'] }
	},
	outputs: {
		default: {
			fields: 'all',
			purchase_order: { fields: ['po_number', 'po_date', 'currency', 'amount'] },
			drawdown: {
				fields: [
					'bank_reference',
					'product',
					'currency',
					'amount',
					'status',
					'lc_number',
					'due_date'
				]
			}
		}
	},
	create: {
		fields: ['purchase_order', 'drawdown', 'is_lc'],
		filled: { fields: ['is_lc'] },
		transform: function* (changes, ctx) {
			const { drawdown } = yield* ctx.query({
				drawdown: {
					where: { id: { in: changes.map((c) => c.after.drawdown) } },
					fields: ['product', 'lc_number']
				}
			});
			const lc = new Set(
				drawdown.rows.filter((d) => d.product === 'lc' || d.lc_number !== null).map((d) => d.id)
			);
			return changes.map((c) => ({ ...c.set, is_lc: lc.has(c.after.drawdown) }));
		}
	},
	delete: {}
});
