import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { allocationLedger } from '../../lib/document-lines.js';
import { batchEntries, uniqueIds } from '../../lib/lifecycle.js';
import { documentLineAmounts, validateLineCells } from '../../lib/pricing.js';
import model from './+model.js';

/** The product, unit and price are snapshotted from the quote line; a line bills a quantity. */
const create = {
	input: {
		columns: { sales_invoice_id: true, quote_line_id: true, quantity: true, tax_rate: true }
	}
} as const;
/** A line stays on its invoice and its quote line; the billed cells may be re-priced. */
const update = {
	input: { columns: { quantity: true, unit_price: true, tax_rate: true } }
} as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;
type Stored = WorkspaceRow<'sales_invoice_lines'>;

const LIMIT = 5000;

/**
 * Bills a quote line belonging to the same quote as the invoice and refuses to bill more than was
 * quoted, counting only lines on invoices that are not cancelled. Keeps a line on its own draft
 * invoice and re-prices it from the changed cells. The invoice's totals follow through the roll-up
 * automations.
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
					entry.kind === 'create' ? entry.input.sales_invoice_id : entry.stored.sales_invoice_id
				)
			);
			const quoteLineIds = uniqueIds(
				entries.map((entry) =>
					entry.kind === 'create' ? entry.input.quote_line_id : entry.stored.quote_line_id
				)
			);
			const [invoices, quoteLines, allocations] = yield* Effect.all(
				[
					db.sales_invoices.findMany({ where: { id: { in: invoiceIds } }, limit: LIMIT }),
					db.quote_lines.findMany({ where: { id: { in: quoteLineIds } }, limit: LIMIT }),
					// What is already billed against every quote line this batch touches: a cancelled
					// invoice bills nothing against a quote.
					db.sales_invoice_lines.findMany({
						where: {
							quote_line_id: { in: quoteLineIds },
							sales_invoice_line_invoice: { some: { status: { ne: 'cancelled' } } }
						},
						columns: { id: true, quote_line_id: true, quantity: true },
						limit: LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
			const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
			const quoteLineById = new Map(quoteLines.map((line) => [line.id, line]));
			// A line this batch re-states is claimed at its new quantity, not its stored one.
			const restated = new Set(
				entries.flatMap((entry) => (entry.kind === 'update' ? [entry.stored.id] : []))
			);
			const billed = allocationLedger(
				allocations.filter((line) => !restated.has(line.id)),
				(line) => line.quote_line_id,
				(line) => line.quantity
			);

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const invoice = invoiceById.get(input.sales_invoice_id);
					if (!invoice) refuse('Referenced sales invoice does not exist.');
					if (invoice.status !== 'draft')
						refuse('Lines can only be added to draft sales invoices.');
					const quoteLine = quoteLineById.get(input.quote_line_id);
					if (!quoteLine) refuse('Referenced quote line does not exist.');
					if (quoteLine.quote_id !== invoice.quote_id) {
						refuse('The billed line belongs to a different quote.');
					}
					const resolved = {
						...input,
						product_code: quoteLine.product_code,
						product_name: quoteLine.product_name,
						product_unit: quoteLine.product_unit ?? '',
						unit_price: quoteLine.unit_price,
						tax_rate: input.tax_rate ?? quoteLine.tax_rate ?? 0
					};
					validateLineCells(resolved);
					billed.claim(
						quoteLine.id,
						decodeNumber(resolved.quantity),
						decodeNumber(quoteLine.quantity ?? 0),
						(soFar, quoted) =>
							`Over-allocation: ${soFar} of ${quoted} billed so far; this line would exceed the quoted quantity.`
					);
					const amounts = documentLineAmounts(invoice, resolved);
					return { ...resolved, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
				}
				const { input, stored } = entry;
				const invoice = invoiceById.get(stored.sales_invoice_id);
				if (!invoice) refuse('Referenced sales invoice does not exist.');
				if (invoice.status !== 'draft')
					refuse('Lines can only be modified on draft sales invoices.');
				const resolved = { ...stored, ...input };
				validateLineCells(resolved);
				const quoteLine = quoteLineById.get(stored.quote_line_id);
				if (quoteLine) {
					billed.claim(
						quoteLine.id,
						decodeNumber(resolved.quantity),
						decodeNumber(quoteLine.quantity ?? 0),
						(_, quoted) =>
							`Over-allocation: this line would push billed quantity past the quoted ${quoted}.`
					);
				}
				const amounts = documentLineAmounts(invoice, resolved);
				return { ...input, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
			});
		})
});
