import {
	refuse,
	type MutateAfterContext,
	type MutateBeforeContext,
	type MutateEditContext
} from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { rollupDocument, sumQuantity } from '../../lib/document-lines.js';
import { documentLineAmounts, type LineAmounts } from '../../lib/pricing.js';
import type { Hooks, WorkspaceRow } from './$types.js';

type AfterApi = MutateAfterContext<Hooks<SalesInvoiceLineBatch>>['api'];
type BeforeApi = MutateBeforeContext<Hooks<SalesInvoiceLineBatch>>['api'];

const LINE_LIMIT = 5000;

/**
 * The invoices, quote lines and existing allocations this batch of lines refers to, read once.
 *
 * The rule below asks three questions per line — is its invoice a draft, is its quote line on the
 * same quote, and how much of that quote line is already billed — and each was its own round trip.
 * Three for the batch now, whatever its size. `prepare` decides nothing; every refusal is still
 * written once, for one line.
 */
interface SalesInvoiceLineBatch {
	readonly invoices: ReadonlyMap<string, WorkspaceRow<'sales_invoices'>>;
	readonly quoteLines: ReadonlyMap<string, WorkspaceRow<'quote_lines'>>;
	readonly allocatedByQuoteLine: ReadonlyMap<string, number>;
}

/** The pricing inputs a line under validation contributes, from the row's own fields. */
type ResolvedLineInput = Partial<
	Pick<WorkspaceRow<'sales_invoice_lines'>, 'quantity' | 'unit_price' | 'tax_rate'>
>;

function validateLineFields(input: ResolvedLineInput): void {
	const quantity = Number(input.quantity);
	if (Number.isNaN(quantity) || quantity <= 0) {
		refuse('Quantity must be greater than zero.');
	}
	const unitPrice = Number(input.unit_price);
	if (Number.isNaN(unitPrice) || unitPrice < 0) {
		refuse('Unit price cannot be negative.');
	}
	const taxRate = Number(input.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) {
		refuse('Tax rate must be between 0 and 100.');
	}
}

/** Lines on an invoice that still counts: a cancelled invoice bills nothing against a quote. */
const liveLinesOfQuoteLine = (quoteLineId: string) => ({
	quote_line_id: { eq: quoteLineId },
	sales_invoice_line_invoice: { some: { status: { ne: 'cancelled' } } }
});

/** Allocated quantity on live (non-cancelled) invoices for one quote line. */
function liveAllocatedQuantity(api: BeforeApi, quoteLineId: string): Effect.Effect<number> {
	return sumQuantity(
		api.db.sales_invoice_lines.findMany({
			where: liveLinesOfQuoteLine(quoteLineId),
			columns: { quantity: true },
			limit: LINE_LIMIT
		})
	);
}

function computeLineAmounts(
	invoice: WorkspaceRow<'sales_invoices'>,
	line: ResolvedLineInput
): LineAmounts {
	return documentLineAmounts(invoice, {
		quantity: line.quantity,
		unit_price: line.unit_price,
		tax_rate: line.tax_rate
	});
}

/** The invoice a roll-up writes back to. */
const invoiceById = (api: AfterApi, invoiceId: string) =>
	api.db.sales_invoices.findFirst({ where: { id: { eq: invoiceId } } });

/** The money cells of every line on one invoice. */
const invoiceLineTotals = (api: AfterApi, invoiceId: string) =>
	api.db.sales_invoice_lines.findMany({
		where: { sales_invoice_id: { eq: invoiceId } },
		columns: { net: true, tax: true, line_total: true },
		limit: LINE_LIMIT
	});

function rollupInvoice(api: AfterApi, invoiceId: string): Effect.Effect<void> {
	return rollupDocument({
		document: invoiceById(api, invoiceId),
		lines: invoiceLineTotals(api, invoiceId),
		write: (totals) => api.db.sales_invoices.mutate({ id: invoiceId, ...totals })
	});
}

const afterRollup = ({
	record,
	api
}: {
	readonly record: { readonly sales_invoice_id: string };
	readonly api: AfterApi;
}) => rollupInvoice(api, record.sales_invoice_id);

/** The context a `mutate.before` handler receives, named so the two halves can be hoisted. */
type BeforeContext = MutateBeforeContext<Hooks<SalesInvoiceLineBatch>>;

/** The same context on an edit, where `existing` is the stored row rather than undefined. */
type EditContext = MutateEditContext<Hooks<SalesInvoiceLineBatch>>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, prepared }: BeforeContext) => {
	if (!input.sales_invoice_id) {
		refuse('A sales invoice line must reference a sales invoice.');
	}
	const invoice = prepared.invoices.get(input.sales_invoice_id);
	if (!invoice) refuse('Referenced sales invoice does not exist.');
	if (invoice.status !== 'draft') {
		refuse('Lines can only be added to draft sales invoices.');
	}

	if (!input.quote_line_id) {
		refuse('A sales invoice line must reference a quote line.');
	}
	const quoteLine = prepared.quoteLines.get(input.quote_line_id);
	if (!quoteLine) refuse('Referenced quote line does not exist.');
	if (quoteLine.quote_id !== invoice.quote_id) {
		refuse('The billed line belongs to a different quote.');
	}

	const resolved = {
		...input,
		quantity: input.quantity,
		product_code: input.product_code ?? quoteLine.product_code,
		product_name: input.product_name ?? quoteLine.product_name,
		product_unit: input.product_unit ?? quoteLine.product_unit ?? '',
		unit_price: input.unit_price ?? quoteLine.unit_price,
		tax_rate: input.tax_rate ?? quoteLine.tax_rate ?? 0
	};
	validateLineFields(resolved);

	const allocated = prepared.allocatedByQuoteLine.get(quoteLine.id) ?? 0;
	const quoted = Number(quoteLine.quantity ?? 0);
	if (allocated + Number(resolved.quantity) > quoted) {
		refuse(
			`Over-allocation: ${allocated} of ${quoted} billed so far; this line would exceed the quoted quantity.`
		);
	}

	const amounts = computeLineAmounts(invoice, resolved);
	return { ...resolved, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
};

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({ input, existing, api }: EditContext) =>
	Effect.gen(function* () {
		if (input.sales_invoice_id != null && input.sales_invoice_id !== existing.sales_invoice_id) {
			refuse('A line cannot be moved to a different sales invoice.');
		}

		const invoice = yield* api.db.sales_invoices.findFirst({
			where: { id: { eq: existing.sales_invoice_id } }
		});
		if (!invoice) refuse('Referenced sales invoice does not exist.');
		if (invoice.status !== 'draft') {
			refuse('Lines can only be modified on draft sales invoices.');
		}

		const resolved = { ...existing, ...input };
		validateLineFields(resolved);

		const quoteLine = yield* api.db.quote_lines.findFirst({
			where: { id: { eq: existing.quote_line_id } }
		});
		if (quoteLine) {
			const allocated = yield* liveAllocatedQuantity(api, quoteLine.id);
			const quoted = Number(quoteLine.quantity ?? 0);
			const own = Number(existing.quantity ?? 0);
			if (allocated - own + Number(resolved.quantity) > quoted) {
				refuse(`Over-allocation: this line would push billed quantity past the quoted ${quoted}.`);
			}
		}

		const amounts = computeLineAmounts(invoice, resolved);
		return { ...input, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
	});

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const invoiceIds = [
					...new Set(
						inputs.flatMap((input) => (input.sales_invoice_id ? [input.sales_invoice_id] : []))
					)
				];
				const quoteLineIds = [
					...new Set(inputs.flatMap((input) => (input.quote_line_id ? [input.quote_line_id] : [])))
				];
				const invoices = invoiceIds.length
					? yield* api.db.sales_invoices.findMany({
							where: { id: { in: invoiceIds } },
							limit: LINE_LIMIT
						})
					: [];
				const quoteLines = quoteLineIds.length
					? yield* api.db.quote_lines.findMany({
							where: { id: { in: quoteLineIds } },
							limit: LINE_LIMIT
						})
					: [];
				// What is already billed against every quote line this call touches, in one read —
				// the same filter `liveAllocatedQuantity` applied one line at a time.
				const allocations = quoteLineIds.length
					? yield* api.db.sales_invoice_lines.findMany({
							where: {
								quote_line_id: { in: quoteLineIds },
								sales_invoice_line_invoice: { some: { status: { ne: 'cancelled' } } }
							},
							columns: { quote_line_id: true, quantity: true },
							limit: LINE_LIMIT
						})
					: [];
				const allocatedByQuoteLine = new Map<string, number>();
				for (const line of allocations) {
					allocatedByQuoteLine.set(
						line.quote_line_id,
						(allocatedByQuoteLine.get(line.quote_line_id) ?? 0) + Number(line.quantity ?? 0)
					);
				}
				return {
					invoices: new Map(invoices.map((invoice) => [invoice.id, invoice])),
					quoteLines: new Map(quoteLines.map((quoteLine) => [quoteLine.id, quoteLine])),
					allocatedByQuoteLine
				};
			}),
		perRecord: {
			before: {
				description:
					'Bills a quote line belonging to the same quote as the invoice and refuses to bill more than was quoted, counting only lines on invoices that are not cancelled. Keeps a line on its own draft invoice, re-prices it from the changed quantity or unit price, and refuses to push the billed quantity past the quantity quoted.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
			},
			after: {
				description:
					'Recomputes the sales invoice net, tax and gross from its lines after a line is added. Recomputes the sales invoice net, tax and gross from its lines after a line is changed.',
				handler: afterRollup
			}
		}
	},
	delete: {
		perRecord: {
			after: {
				description:
					'Recomputes the sales invoice net, tax and gross from its lines after a line is removed.',
				handler: afterRollup
			}
		}
	}
} satisfies Hooks<SalesInvoiceLineBatch>;
