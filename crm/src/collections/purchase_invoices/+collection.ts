import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { currentInstant } from '../../lib/clock.js';
import { docNoSeries, docNoSeriesPattern } from '../../lib/document-numbers.js';
import { assertTransition, batchEntries, requireReason, uniqueIds } from '../../lib/lifecycle.js';
import model from './+model.js';

type Invoice = WorkspaceRow<'purchase_invoices'>;
type InvoiceStatus = NonNullable<Invoice['status']>;

const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
	draft: ['confirmed', 'cancelled'],
	confirmed: [],
	cancelled: []
};

/** The supplier, currency and tax basis come down from the order; `doc_no` is issued here. */
const create = {
	input: {
		columns: {
			purchase_order_id: true,
			owner_id: true,
			invoice_reference: true,
			invoice_date: true,
			status: true
		}
	}
} as const;
/** `net`, `tax` and `gross` are written by the line roll-up automations. */
const update = {
	input: {
		columns: {
			doc_no: true,
			owner_id: true,
			invoice_reference: true,
			invoice_date: true,
			status: true,
			cancel_reason: true,
			net: true,
			tax: true,
			gross: true
		}
	}
} as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;

const LIMIT = 5000;

/**
 * Books an invoice only against a confirmed purchase order, copies the supplier and currency down
 * from that order, and assigns the next PI document number for the year. Freezes a purchase
 * invoice once it is confirmed or cancelled, requires at least one line to confirm, and requires a
 * cancellation reason to cancel.
 */
export default defineCollection({
	model,
	create,
	update,
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const now = yield* currentInstant;
			const year = now.getFullYear();
			const entries = batchEntries<Create, Update, Invoice>(inputs, existing);
			const orderIds = uniqueIds(
				entries.flatMap((entry) => (entry.kind === 'create' ? [entry.input.purchase_order_id] : []))
			);
			const confirmingIds = entries.flatMap((entry) =>
				entry.kind === 'update' && entry.input.status === 'confirmed' ? [entry.stored.id] : []
			);
			const [orders, issued, lines] = yield* Effect.all(
				[
					orderIds.length
						? db.purchase_orders.findMany({ where: { id: { in: orderIds } }, limit: LIMIT })
						: Effect.succeed([]),
					orderIds.length
						? db.purchase_invoices.findMany({
								where: { doc_no: { like: docNoSeriesPattern('PI', year) } },
								columns: { doc_no: true },
								limit: LIMIT
							})
						: Effect.succeed([]),
					confirmingIds.length
						? db.purchase_invoice_lines.findMany({
								where: { purchase_invoice_id: { in: confirmingIds } },
								columns: { purchase_invoice_id: true },
								limit: LIMIT
							})
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			const orderById = new Map(orders.map((order) => [order.id, order]));
			const nextDocNo = docNoSeries(
				issued.map((invoice) => invoice.doc_no),
				'PI',
				year
			);
			const withLines = new Set(lines.map((line) => line.purchase_invoice_id));

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const order = orderById.get(input.purchase_order_id);
					if (!order) refuse('Referenced purchase order does not exist.');
					if (order.status !== 'confirmed') {
						refuse('Invoices can only be booked against a confirmed purchase order.');
					}
					return {
						...input,
						doc_no: nextDocNo(),
						supplier_id: order.supplier_id,
						supplier_code: order.supplier_code,
						supplier_name: order.supplier_name,
						currency: order.currency,
						tax_inclusive: order.tax_inclusive,
						status: input.status ?? 'draft',
						net: 0,
						tax: 0,
						gross: 0
					};
				}
				const { input, stored } = entry;
				const oldStatus = stored.status ?? 'draft';
				const newStatus = input.status ?? oldStatus;
				if (oldStatus === newStatus) {
					if (oldStatus === 'draft') return input;
					refuse(`A ${oldStatus} purchase invoice is immutable. Revise by booking a new invoice.`);
				}
				assertTransition(TRANSITIONS, oldStatus, newStatus);
				const stamps: { confirmed_at?: string; cancelled_at?: string } = {};
				if (newStatus === 'confirmed') {
					if (!withLines.has(stored.id)) {
						refuse('A purchase invoice must have at least one line before it can be confirmed.');
					}
					if (stored.confirmed_at == null) stamps.confirmed_at = now.toISOString();
				}
				if (newStatus === 'cancelled') {
					requireReason(input.cancel_reason ?? stored.cancel_reason, 'cancellation');
					if (stored.cancelled_at == null) stamps.cancelled_at = now.toISOString();
				}
				return { ...input, ...stamps };
			});
		})
});
