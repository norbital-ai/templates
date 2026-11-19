import { automation } from '@norbital-ai/bolt';
import { blank, documentSource } from '../lib/documents.js';

const key = (value: string | null | undefined) =>
	(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const READ = {
	kind: 'object',
	fields: {
		po_number: { kind: 'text', optional: true },
		po_date: { kind: 'date', optional: true },
		supplier: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		salesperson: { kind: 'text', optional: true },
		ship_to_country: { kind: 'text', optional: true },
		remarks: { kind: 'text', optional: true },
		items: {
			kind: 'object',
			many: true,
			optional: true,
			fields: {
				item: { kind: 'text' },
				quantity: { kind: 'decimal', scale: 3 },
				amount: { kind: 'decimal', scale: 2 }
			}
		}
	}
} as const;

/**
 * Fills a purchase order from its newest PO document, scheduled when one is filed or replaced: number, date, the
 * supplier (matched to the list by name or alias), salesperson (who requested it), ship-to country, the remarks word
 * for word into notes and, while the order has no items yet, its currency and item lines. Only empty fields are
 * filled; a number another order already has is left for the purchaser. It never picks the bank or ticks Pay by LC.
 */
export default automation({
	description: 'Fill a purchase order from its PO document; the purchaser checks it.',
	input: { po: { kind: 'ref', to: 'purchase_order', many: true } },
	policies: ['purchase_orders'],
	run: function* ({ po }, ctx) {
		const { purchase_order, po_document, business_partner } = yield* ctx.query({
			purchase_order: {
				where: { id: { in: po } },
				fields: [
					'revision',
					'po_number',
					'po_date',
					'supplier',
					'salesperson',
					'currency',
					'ship_to_country',
					'notes'
				],
				lines: { fields: ['item'] }
			},
			po_document: {
				where: { po: { in: po }, kind: { eq: 'purchase_order' } },
				fields: ['po', 'file'],
				order_by: { created_at: 'desc' }
			},
			business_partner: { fields: ['name', 'aliases'], limit: 1000 }
		});
		for (const order of purchase_order.rows) {
			const document = po_document.rows.find((d) => d.po === order.id);
			if (document === undefined) continue;
			const source = yield* documentSource(document.file, 'purchase_order_read', ctx);
			const read = yield* ctx.ai.sys_2.infer({
				label: 'purchase order',
				system:
					'You read a purchase order the company raised on a supplier. Copy what is printed; never guess or calculate, and never return bank account numbers.',
				prompt: `Extract the PO number, PO date, the supplier the order is raised on, the currency, the person it is requested by (salesperson), the ship-to country, the remarks word for word, and every item line with its quantity in kg and its amount. Use the attached page images for scanned text.\n\n${source.text}`,
				files: source.files,
				output: READ
			});
			const supplier = business_partner.rows.find((p) =>
				[p.name, ...(p.aliases ?? [])].some((n) => key(n) !== '' && key(n) === key(read.supplier))
			);
			const { purchase_order: taken } =
				order.po_number !== null || read.po_number == null
					? { purchase_order: { rows: [] } }
					: yield* ctx.query({
							purchase_order: {
								where: { po_number: { eq: read.po_number } },
								fields: ['po_number'],
								limit: 1
							}
						});
			const first = order.lines.length === 0;
			yield* ctx.act({
				'purchase_order.update': [
					{
						target: order,
						set: {
							po_number:
								taken.rows.length === 0 ? blank(order.po_number, read.po_number) : order.po_number,
							po_date: blank(order.po_date, read.po_date),
							supplier: order.supplier ?? supplier?.id ?? null,
							salesperson: blank(order.salesperson, read.salesperson),
							ship_to_country: blank(order.ship_to_country, read.ship_to_country),
							notes: blank(order.notes, read.remarks),
							...(first && read.currency != null ? { currency: read.currency } : {}),
							...(first && (read.items ?? []).length > 0
								? { lines: { create: read.items ?? [] } }
								: {})
						}
					}
				]
			});
		}
	}
});
