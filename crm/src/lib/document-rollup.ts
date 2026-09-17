import { Effect } from 'effect';
import type { Api } from '$bolt/types.js';
import { totalsOfLines } from './document-lines.js';
import type { LineAmounts } from './pricing.js';

const LINE_LIMIT = 5000;

/** The stored header cells a roll-up reads before it writes. */
type RollupDocument = { readonly status: string | null; readonly currency: string | null };

/**
 * How one line collection rolls into its document: the column that names the document, and the
 * three table-specific calls. The roll-up itself — read header and lines, sum, write — is
 * `documentRollup` below, once for the four document kinds.
 */
interface Rollup<Column extends string> {
	readonly label: string;
	readonly column: Column;
	readonly document: (api: Api, id: string) => Effect.Effect<RollupDocument | undefined>;
	readonly lines: (
		api: Api,
		id: string
	) => Effect.Effect<
		readonly {
			readonly net: number | null;
			readonly tax: number | null;
			readonly line_total: number | null;
		}[]
	>;
	readonly write: (api: Api, id: string, totals: LineAmounts) => Effect.Effect<unknown>;
}

const header = { status: true, currency: true } as const;
const money = { net: true, tax: true, line_total: true } as const;

export const quoteRollup: Rollup<'quote_id'> = {
	label: 'quote',
	column: 'quote_id',
	document: (api, id) => api.db.quotes.findFirst({ where: { id: { eq: id } }, columns: header }),
	lines: (api, id) =>
		api.db.quote_lines.findMany({
			where: { quote_id: { eq: id } },
			columns: money,
			limit: LINE_LIMIT
		}),
	write: (api, id, totals) => api.collection.quotes.update(id, totals)
};

export const salesInvoiceRollup: Rollup<'sales_invoice_id'> = {
	label: 'sales invoice',
	column: 'sales_invoice_id',
	document: (api, id) =>
		api.db.sales_invoices.findFirst({ where: { id: { eq: id } }, columns: header }),
	lines: (api, id) =>
		api.db.sales_invoice_lines.findMany({
			where: { sales_invoice_id: { eq: id } },
			columns: money,
			limit: LINE_LIMIT
		}),
	write: (api, id, totals) => api.collection.sales_invoices.update(id, totals)
};

export const purchaseOrderRollup: Rollup<'purchase_order_id'> = {
	label: 'purchase order',
	column: 'purchase_order_id',
	document: (api, id) =>
		api.db.purchase_orders.findFirst({ where: { id: { eq: id } }, columns: header }),
	lines: (api, id) =>
		api.db.purchase_order_lines.findMany({
			where: { purchase_order_id: { eq: id } },
			columns: money,
			limit: LINE_LIMIT
		}),
	write: (api, id, totals) => api.collection.purchase_orders.update(id, totals)
};

export const purchaseInvoiceRollup: Rollup<'purchase_invoice_id'> = {
	label: 'purchase invoice',
	column: 'purchase_invoice_id',
	document: (api, id) =>
		api.db.purchase_invoices.findFirst({ where: { id: { eq: id } }, columns: header }),
	lines: (api, id) =>
		api.db.purchase_invoice_lines.findMany({
			where: { purchase_invoice_id: { eq: id } },
			columns: money,
			limit: LINE_LIMIT
		}),
	write: (api, id, totals) => api.collection.purchase_invoices.update(id, totals)
};

/**
 * The spec of one change-triggered roll-up automation.
 *
 * Lines are written on their own — each has its own form and table — so the document cannot
 * re-total itself in its transform; the line's change event re-totals it here, after the line has
 * committed. Only a draft document is re-totalled: the line transforms admit no other, and a
 * document that has left draft is immutable by its own rule.
 */
export function documentRollup<Column extends string>(rollup: Rollup<Column>, verb: string) {
	return {
		policies: ['document_rollup'] as const,
		description: `Recomputes the ${rollup.label} net, tax and gross from its lines after a line is ${verb}.`,
		handler: (
			api: Api,
			{ scope }: { readonly scope: { readonly incoming_record: Readonly<Record<Column, string>> } }
		) =>
			Effect.gen(function* () {
				const id = scope.incoming_record[rollup.column];
				const [document, lines] = yield* Effect.all(
					[rollup.document(api, id), rollup.lines(api, id)],
					{ concurrency: 'unbounded' }
				);
				if (document === undefined || document.status !== 'draft') {
					return { document_id: id, skipped: true };
				}
				const totals = totalsOfLines(lines, document.currency);
				yield* rollup.write(api, id, totals);
				return { document_id: id, ...totals };
			})
	};
}
