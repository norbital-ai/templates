import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import { rollupDocument, sumQuantity } from '../../lib/document-lines.js';
import { documentLineAmounts, type LineAmounts } from '../../lib/pricing.js';
import type { Hooks, WorkspaceRow } from './$types.js';

type AfterApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['after']>['handler']
>[0]['api'];
type BeforeApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
>[0]['api'];

const LINE_LIMIT = 5000;

/**
 * The invoices, order lines and existing invoiced quantities this batch refers to, read once.
 *
 * Three questions per line — is its invoice a draft, is its order line on the same order, and how
 * much of that order line is already invoiced — were three round trips a row and are now three for
 * the batch. `prepare` decides nothing; every refusal is still written once, for one line.
 */
interface PurchaseInvoiceLineBatch {
	readonly invoices: ReadonlyMap<string, WorkspaceRow<'purchase_invoices'>>;
	readonly orderLines: ReadonlyMap<string, WorkspaceRow<'purchase_order_lines'>>;
	readonly invoicedByOrderLine: ReadonlyMap<string, number>;
}

/** `Hooks` with what `prepare` returns filled in; see the note in `quote_lines/+hooks.ts`. */
type PurchaseInvoiceLineHooks = CollectionHooks<
	WorkspaceSchema,
	'purchase_invoice_lines',
	PurchaseInvoiceLineBatch
>;

/** The pricing inputs a line under validation contributes, from the row's own fields. */
type ResolvedLineInput = Partial<
	Pick<WorkspaceRow<'purchase_invoice_lines'>, 'quantity' | 'unit_cost' | 'tax_rate'>
>;

function validateLineFields(input: ResolvedLineInput): void {
	const quantity = Number(input.quantity);
	if (Number.isNaN(quantity) || quantity <= 0) {
		throw new Error('Quantity must be greater than zero.');
	}
	const unitCost = Number(input.unit_cost);
	if (input.unit_cost == null || Number.isNaN(unitCost)) {
		throw new Error('Unit cost is required.');
	}
	if (unitCost < 0) throw new Error('Unit cost cannot be negative.');
	const taxRate = Number(input.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) {
		throw new Error('Tax rate must be between 0 and 100.');
	}
}

/** Lines on an invoice that still counts: a cancelled invoice claims nothing against an order. */
const liveLinesOfOrderLine = (orderLineId: string) => ({
	purchase_order_line_id: { eq: orderLineId },
	purchase_invoice_line_invoice: { status: { ne: 'cancelled' } }
});

/** Invoiced quantity on live (non-cancelled) invoices for one order line. */
function liveInvoicedQuantity(api: BeforeApi, orderLineId: string): Effect.Effect<number> {
	return sumQuantity(
		api.db.purchase_invoice_lines.findMany({
			where: liveLinesOfOrderLine(orderLineId),
			columns: { quantity: true },
			limit: LINE_LIMIT
		})
	);
}

function computeLineAmounts(
	invoice: WorkspaceRow<'purchase_invoices'>,
	line: ResolvedLineInput
): LineAmounts {
	return documentLineAmounts(invoice, {
		quantity: line.quantity,
		unit_price: line.unit_cost,
		tax_rate: line.tax_rate
	});
}

/** The invoice a roll-up writes back to. */
const invoiceById = (api: AfterApi, invoiceId: string) =>
	api.db.purchase_invoices.findFirst({ where: { id: { eq: invoiceId } } });

/** The money cells of every line on one invoice. */
const invoiceLineTotals = (api: AfterApi, invoiceId: string) =>
	api.db.purchase_invoice_lines.findMany({
		where: { purchase_invoice_id: { eq: invoiceId } },
		columns: { net: true, tax: true, line_total: true },
		limit: LINE_LIMIT
	});

function rollupInvoice(api: AfterApi, invoiceId: string): Effect.Effect<void> {
	return rollupDocument({
		document: invoiceById(api, invoiceId),
		lines: invoiceLineTotals(api, invoiceId),
		write: (totals) => api.db.purchase_invoices.mutate({ id: invoiceId, ...totals })
	});
}

const afterRollup = ({
	record,
	api
}: {
	readonly record: { readonly purchase_invoice_id: string };
	readonly api: AfterApi;
}) => rollupInvoice(api, record.purchase_invoice_id);

export default {
	create: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const invoiceIds = [
					...new Set(
						inputs.flatMap((input) =>
							input.purchase_invoice_id ? [input.purchase_invoice_id] : []
						)
					)
				];
				const orderLineIds = [
					...new Set(
						inputs.flatMap((input) =>
							input.purchase_order_line_id ? [input.purchase_order_line_id] : []
						)
					)
				];
				const invoices = invoiceIds.length
					? yield* api.db.purchase_invoices.findMany({
							where: { id: { in: invoiceIds } },
							limit: LINE_LIMIT
						})
					: [];
				const orderLines = orderLineIds.length
					? yield* api.db.purchase_order_lines.findMany({
							where: { id: { in: orderLineIds } },
							limit: LINE_LIMIT
						})
					: [];
				// The same filter `liveInvoicedQuantity` applied one order line at a time, asked once.
				const invoiced = orderLineIds.length
					? yield* api.db.purchase_invoice_lines.findMany({
							where: {
								purchase_order_line_id: { in: orderLineIds },
								purchase_invoice_line_invoice: { status: { ne: 'cancelled' } }
							},
							columns: { purchase_order_line_id: true, quantity: true },
							limit: LINE_LIMIT
						})
					: [];
				const invoicedByOrderLine = new Map<string, number>();
				for (const line of invoiced) {
					invoicedByOrderLine.set(
						line.purchase_order_line_id,
						(invoicedByOrderLine.get(line.purchase_order_line_id) ?? 0) + Number(line.quantity ?? 0)
					);
				}
				return {
					invoices: new Map(invoices.map((invoice) => [invoice.id, invoice])),
					orderLines: new Map(orderLines.map((orderLine) => [orderLine.id, orderLine])),
					invoicedByOrderLine
				};
			}),
		perRecord: {
			before: {
				description:
					'Matches an invoice line to a purchase order line on the same order and refuses to invoice more than was ordered, counting only lines on invoices that are not cancelled.',
				handler: ({ input, prepared }) => {
					if (!input.purchase_invoice_id) {
						throw new Error('A purchase invoice line must reference a purchase invoice.');
					}
					const invoice = prepared.invoices.get(input.purchase_invoice_id);
					if (!invoice) throw new Error('Referenced purchase invoice does not exist.');
					if (invoice.status !== 'draft') {
						throw new Error('Lines can only be added to draft purchase invoices.');
					}

					if (!input.purchase_order_line_id) {
						throw new Error('A purchase invoice line must reference a purchase order line.');
					}
					const orderLine = prepared.orderLines.get(input.purchase_order_line_id);
					if (!orderLine) throw new Error('Referenced purchase order line does not exist.');
					if (orderLine.purchase_order_id !== invoice.purchase_order_id) {
						throw new Error('The invoiced line belongs to a different purchase order.');
					}

					const resolved = {
						...input,
						quantity: input.quantity,
						product_code: input.product_code ?? orderLine.product_code,
						product_name: input.product_name ?? orderLine.product_name,
						unit_cost: input.unit_cost ?? orderLine.unit_cost,
						tax_rate: input.tax_rate ?? orderLine.tax_rate ?? 0
					};
					validateLineFields(resolved);

					const alreadyInvoiced = prepared.invoicedByOrderLine.get(orderLine.id) ?? 0;
					const ordered = Number(orderLine.quantity ?? 0);
					if (alreadyInvoiced + Number(resolved.quantity) > ordered) {
						throw new Error(
							`Over-invoice: ${alreadyInvoiced} of ${ordered} invoiced so far; this line would exceed the ordered quantity.`
						);
					}

					const amounts = computeLineAmounts(invoice, resolved);
					return {
						...resolved,
						net: amounts.net,
						tax: amounts.tax,
						line_total: amounts.gross
					};
				}
			},
			after: {
				description:
					'Recomputes the purchase invoice net, tax and gross from its lines after a line is added.',
				handler: afterRollup
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Keeps a line on its own draft invoice, re-prices it from the changed quantity or unit cost, and refuses to push the invoiced quantity past the quantity ordered.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (
							input.purchase_invoice_id != null &&
							input.purchase_invoice_id !== existing.purchase_invoice_id
						) {
							return yield* Effect.fail(
								new Error('A line cannot be moved to a different purchase invoice.')
							);
						}

						const invoice = yield* api.db.purchase_invoices.findFirst({
							where: { id: { eq: existing.purchase_invoice_id } }
						});
						if (!invoice)
							return yield* Effect.fail(new Error('Referenced purchase invoice does not exist.'));
						if (invoice.status !== 'draft') {
							return yield* Effect.fail(
								new Error('Lines can only be modified on draft purchase invoices.')
							);
						}

						const resolved = { ...existing, ...input };
						validateLineFields(resolved);

						const orderLine = yield* api.db.purchase_order_lines.findFirst({
							where: { id: { eq: existing.purchase_order_line_id } }
						});
						if (orderLine) {
							const invoiced = yield* liveInvoicedQuantity(api, orderLine.id);
							const ordered = Number(orderLine.quantity ?? 0);
							const own = Number(existing.quantity ?? 0);
							if (invoiced - own + Number(resolved.quantity) > ordered) {
								return yield* Effect.fail(
									new Error(
										`Over-invoice: this line would push invoiced quantity past the ordered ${ordered}.`
									)
								);
							}
						}

						const amounts = computeLineAmounts(invoice, resolved);
						return { ...input, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
					})
			},
			after: {
				description:
					'Recomputes the purchase invoice net, tax and gross from its lines after a line is changed.',
				handler: afterRollup
			}
		}
	},
	delete: {
		perRecord: {
			after: {
				description:
					'Recomputes the purchase invoice net, tax and gross from its lines after a line is removed.',
				handler: afterRollup
			}
		}
	}
} satisfies PurchaseInvoiceLineHooks;
