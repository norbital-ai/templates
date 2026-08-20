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

type InvoiceStatus = 'draft' | 'confirmed' | 'cancelled';

type InvoiceUpdate = {
	-readonly [K in keyof WorkspaceRow<'purchase_invoices'>]?: WorkspaceRow<'purchase_invoices'>[K];
};

const VALID_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
	draft: ['confirmed', 'cancelled'],
	confirmed: [],
	cancelled: []
};

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Books an invoice only against a confirmed purchase order, copies the supplier and currency down from that order, and assigns the next PI document number for the year.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (!input.purchase_order_id) {
							throw new Error('A purchase invoice must reference a purchase order.');
						}
						const order = yield* api.db.query.purchase_orders.findFirst({
							where: { norbital_id: { eq: input.purchase_order_id } }
						});
						if (!order) throw new Error('Referenced purchase order does not exist.');
						if (order.status !== 'confirmed') {
							throw new Error('Invoices can only be booked against a confirmed purchase order.');
						}

						const resolved = {
							...input,
							supplier_id: order.supplier_id,
							supplier_code: order.supplier_code,
							supplier_name: order.supplier_name,
							currency: order.currency,
							tax_inclusive: order.tax_inclusive,
							status: input.status ?? 'draft',
							net: input.net ?? 0,
							tax: input.tax ?? 0,
							gross: input.gross ?? 0
						};

						if (!input.doc_no) {
							const year = new Date().getFullYear();
							const existing = yield* api.db.query.purchase_invoices.findMany({
								where: { doc_no: { like: docNoSeriesPattern('PI', year) } },
								columns: { doc_no: true },
								limit: 5000
							});
							return {
								...resolved,
								doc_no: nextDocNo(
									existing.map((row) => row.doc_no),
									'PI',
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
					'Freezes a purchase invoice once it is confirmed or cancelled, requires at least one line to confirm, and requires a cancellation reason to cancel.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const newStatus = (input.status ?? existing.status) as InvoiceStatus;
						const oldStatus = existing.status as InvoiceStatus;

						if (oldStatus === newStatus) {
							if (oldStatus === 'draft') return input;
							throw new Error(
								`A ${oldStatus} purchase invoice is immutable. Revise by booking a new invoice.`
							);
						}

						const allowed = VALID_TRANSITIONS[oldStatus];
						if (!allowed.includes(newStatus)) {
							throw new Error(
								`Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}.`
							);
						}

						const updates: InvoiceUpdate = { ...input };

						if (newStatus === 'confirmed') {
							const lines = yield* api.db.query.purchase_invoice_lines.findMany({
								where: { purchase_invoice_id: { eq: existing.norbital_id } },
								limit: 1
							});
							if (lines.length === 0) {
								throw new Error(
									'A purchase invoice must have at least one line before it can be confirmed.'
								);
							}
							if (existing.confirmed_at == null) updates.confirmed_at = new Date();
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
