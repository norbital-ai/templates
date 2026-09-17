import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { allocationLedger } from '../../lib/document-lines.js';
import { batchEntries, uniqueIds } from '../../lib/lifecycle.js';
import { costLineColumns } from '../../lib/pricing.js';
import model from './+model.js';

/** The product and cost are snapshotted from the order line; a line invoices a quantity. */
const create = {
	input: {
		columns: {
			purchase_invoice_id: true,
			purchase_order_line_id: true,
			quantity: true,
			tax_rate: true
		}
	}
} as const;
/** A line stays on its invoice and its order line; the invoiced cells may be re-priced. */
const update = { input: { columns: { quantity: true, unit_cost: true, tax_rate: true } } } as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;
type Stored = WorkspaceRow<'purchase_invoice_lines'>;

const LIMIT = 5000;

/**
 * Matches an invoice line to a purchase order line on the same order and refuses to invoice more
 * than was ordered, counting only lines on invoices that are not cancelled. Keeps a line on its own
 * draft invoice and re-prices it from the changed cells. The invoice's totals follow through the
 * roll-up automations.
 */
export default defineCollection({
	model,
	create,
	update,
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const entries = batchEntries<Create, Update, Stored>(inputs, existing);
			const invoiceIds = uniqueIds(
				entries.map((entry) =>
					entry.kind === 'create'
						? entry.input.purchase_invoice_id
						: entry.stored.purchase_invoice_id
				)
			);
			const orderLineIds = uniqueIds(
				entries.map((entry) =>
					entry.kind === 'create'
						? entry.input.purchase_order_line_id
						: entry.stored.purchase_order_line_id
				)
			);
			const [invoices, orderLines, invoiced] = yield* Effect.all(
				[
					db.purchase_invoices.findMany({ where: { id: { in: invoiceIds } }, limit: LIMIT }),
					db.purchase_order_lines.findMany({ where: { id: { in: orderLineIds } }, limit: LIMIT }),
					// What is already invoiced against every order line this batch touches: a cancelled
					// invoice claims nothing against an order.
					db.purchase_invoice_lines.findMany({
						where: {
							purchase_order_line_id: { in: orderLineIds },
							purchase_invoice_line_invoice: { some: { status: { ne: 'cancelled' } } }
						},
						columns: { id: true, purchase_order_line_id: true, quantity: true },
						limit: LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
			const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
			const orderLineById = new Map(orderLines.map((line) => [line.id, line]));
			// A line this batch re-states is claimed at its new quantity, not its stored one.
			const restated = new Set(
				entries.flatMap((entry) => (entry.kind === 'update' ? [entry.stored.id] : []))
			);
			const ledger = allocationLedger(
				invoiced.filter((line) => !restated.has(line.id)),
				(line) => line.purchase_order_line_id,
				(line) => line.quantity
			);

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const invoice = invoiceById.get(input.purchase_invoice_id);
					if (!invoice) refuse('Referenced purchase invoice does not exist.');
					if (invoice.status !== 'draft') {
						refuse('Lines can only be added to draft purchase invoices.');
					}
					const orderLine = orderLineById.get(input.purchase_order_line_id);
					if (!orderLine) refuse('Referenced purchase order line does not exist.');
					if (orderLine.purchase_order_id !== invoice.purchase_order_id) {
						refuse('The invoiced line belongs to a different purchase order.');
					}
					const resolved = {
						...input,
						product_code: orderLine.product_code,
						product_name: orderLine.product_name,
						unit_cost: orderLine.unit_cost,
						tax_rate: input.tax_rate ?? orderLine.tax_rate ?? 0
					};
					const amounts = costLineColumns(invoice, resolved);
					ledger.claim(
						orderLine.id,
						decodeNumber(resolved.quantity),
						decodeNumber(orderLine.quantity ?? 0),
						(soFar, ordered) =>
							`Over-invoice: ${soFar} of ${ordered} invoiced so far; this line would exceed the ordered quantity.`
					);
					return { ...resolved, ...amounts };
				}
				const { input, stored } = entry;
				const invoice = invoiceById.get(stored.purchase_invoice_id);
				if (!invoice) refuse('Referenced purchase invoice does not exist.');
				if (invoice.status !== 'draft') {
					refuse('Lines can only be modified on draft purchase invoices.');
				}
				const resolved = { ...stored, ...input };
				const amounts = costLineColumns(invoice, resolved);
				const orderLine = orderLineById.get(stored.purchase_order_line_id);
				if (orderLine) {
					ledger.claim(
						orderLine.id,
						decodeNumber(resolved.quantity),
						decodeNumber(orderLine.quantity ?? 0),
						(_, ordered) =>
							`Over-invoice: this line would push invoiced quantity past the ordered ${ordered}.`
					);
				}
				return { ...input, ...amounts };
			});
		})
});
