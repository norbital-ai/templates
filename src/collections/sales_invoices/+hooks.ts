import { Effect } from 'effect';
import type { Hooks, WorkspaceRow } from './$types.js';

const DOC_NO_SEQUENCE_WIDTH = 4;

function docNoSeriesPattern(prefix: string, year: number): string {
	return `${prefix}-${year}-%`;
}

function nextDocNo(existingNumbers: readonly string[], prefix: string, year: number): string {
	const seriesPrefix = `${prefix}-${year}-`;
	let highest = 0;
	for (const number of existingNumbers) {
		if (!number.startsWith(seriesPrefix)) continue;
		const sequence = Number.parseInt(number.slice(seriesPrefix.length), 10);
		if (Number.isNaN(sequence)) continue;
		if (sequence > highest) highest = sequence;
	}
	return `${seriesPrefix}${String(highest + 1).padStart(DOC_NO_SEQUENCE_WIDTH, '0')}`;
}

type InvoiceStatus = 'draft' | 'issued' | 'cancelled';

type InvoiceUpdate = {
	-readonly [K in keyof WorkspaceRow<'sales_invoices'>]?: WorkspaceRow<'sales_invoices'>[K];
};

const VALID_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
	draft: ['issued', 'cancelled'],
	issued: [],
	cancelled: []
};

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Raises an invoice only against a confirmed quote, copies the account, currency and tax basis down from that quote, and assigns the next SI document number for the year.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (!input.quote_id) throw new Error('A sales invoice must reference a quote.');
						const quote = yield* api.db.query.quotes.findFirst({
							where: { norbital_id: { eq: input.quote_id } }
						});
						if (!quote) throw new Error('Referenced quote does not exist.');
						if (quote.status !== 'confirmed') {
							throw new Error('Invoices can only be raised against a confirmed quote.');
						}

						const resolved = {
							...input,
							account_id: quote.account_id,
							currency: quote.currency,
							tax_inclusive: quote.tax_inclusive,
							status: input.status ?? 'draft',
							net: input.net ?? 0,
							tax: input.tax ?? 0,
							gross: input.gross ?? 0
						};

						if (!input.doc_no) {
							const year = new Date().getFullYear();
							const existing = yield* api.db.query.sales_invoices.findMany({
								where: { doc_no: { like: docNoSeriesPattern('SI', year) } },
								columns: { doc_no: true },
								limit: 5000
							});
							return {
								...resolved,
								doc_no: nextDocNo(
									existing.map((row) => row.doc_no),
									'SI',
									year
								)
							};
						}

						return resolved;
					})
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Freezes a sales invoice once it is issued or cancelled, requires at least one line to issue, and requires a cancellation reason to cancel.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const newStatus = (input.status ?? existing.status) as InvoiceStatus;
						const oldStatus = existing.status as InvoiceStatus;

						if (oldStatus === newStatus) {
							if (oldStatus === 'draft') return input;
							throw new Error(
								`An ${oldStatus} sales invoice is immutable. Revise by raising a new invoice.`
							);
						}

						const allowed = VALID_TRANSITIONS[oldStatus];
						if (!allowed.includes(newStatus)) {
							throw new Error(
								`Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}.`
							);
						}

						const updates: InvoiceUpdate = { ...input };

						if (newStatus === 'issued') {
							const lines = yield* api.db.query.sales_invoice_lines.findMany({
								where: { sales_invoice_id: { eq: existing.norbital_id } },
								limit: 1
							});
							if (lines.length === 0) {
								throw new Error(
									'A sales invoice must have at least one line before it can be issued.'
								);
							}
							if (existing.issued_at == null) updates.issued_at = new Date();
						}

						if (newStatus === 'cancelled') {
							const cancelReason = input.cancel_reason ?? existing.cancel_reason;
							if (!cancelReason || String(cancelReason).trim() === '') {
								throw new Error('A cancellation reason is required.');
							}
							if (existing.cancelled_at == null) updates.cancelled_at = new Date();
						}

						return updates;
					})
			}
		}
	}
} satisfies Hooks;
