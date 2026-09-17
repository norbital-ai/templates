import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { currentInstant } from '../../lib/clock.js';
import { deskToday } from '../../lib/desk-date.js';
import { docNoSeries, docNoSeriesPattern } from '../../lib/document-numbers.js';
import { assertTransition, batchEntries, requireReason, uniqueIds } from '../../lib/lifecycle.js';
import model from './+model.js';

type Order = WorkspaceRow<'purchase_orders'>;
type OrderStatus = NonNullable<Order['status']>;

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
	draft: ['submitted', 'cancelled'],
	submitted: ['confirmed', 'cancelled'],
	confirmed: [],
	cancelled: []
};

const EXPECTED_LEAD_DAYS = 14;

function shiftCalendarDate(value: string, days: number): string {
	const date = new Date(`${value}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** The terms the purchaser states on an order, on creation and while it is a draft. */
const terms = {
	owner_id: true,
	status: true,
	currency: true,
	tax_inclusive: true,
	expected_date: true
} as const;

/** `doc_no`, the supplier snapshot and the totals are derived; the supplier is fixed once set. */
const create = { input: { columns: { supplier_id: true, ...terms } } } as const;
/** `net`, `tax` and `gross` are written by the line roll-up automations. */
const update = {
	input: {
		columns: { ...terms, doc_no: true, cancel_reason: true, net: true, tax: true, gross: true }
	}
} as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;

const LIMIT = 5000;

/**
 * Opens an order against an active supplier, copies down the supplier code, name and currency,
 * sets the expected date two weeks out, and assigns the next PO document number for the year.
 * Moves an order from draft to submitted to confirmed, refuses edits once it has left draft,
 * requires at least one line to submit, and requires a cancellation reason to cancel.
 */
export default defineCollection({
	model,
	create,
	update,
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const now = yield* currentInstant;
			const year = now.getFullYear();
			const entries = batchEntries<Create, Update, Order>(inputs, existing);
			const supplierIds = uniqueIds(
				entries.flatMap((entry) => (entry.kind === 'create' ? [entry.input.supplier_id] : []))
			);
			const submittingIds = entries.flatMap((entry) =>
				entry.kind === 'update' && entry.input.status === 'submitted' ? [entry.stored.id] : []
			);
			const [suppliers, issued, lines] = yield* Effect.all(
				[
					supplierIds.length
						? db.suppliers.findMany({ where: { id: { in: supplierIds } }, limit: LIMIT })
						: Effect.succeed([]),
					supplierIds.length
						? db.purchase_orders.findMany({
								where: { doc_no: { like: docNoSeriesPattern('PO', year) } },
								columns: { doc_no: true },
								limit: LIMIT
							})
						: Effect.succeed([]),
					submittingIds.length
						? db.purchase_order_lines.findMany({
								where: { purchase_order_id: { in: submittingIds } },
								columns: { purchase_order_id: true },
								limit: LIMIT
							})
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
			const nextDocNo = docNoSeries(
				issued.map((order) => order.doc_no),
				'PO',
				year
			);
			const withLines = new Set(lines.map((line) => line.purchase_order_id));

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const supplier = supplierById.get(input.supplier_id);
					if (!supplier) refuse('Referenced supplier does not exist.');
					if (!supplier.active) refuse('Cannot create a purchase order for an inactive supplier.');
					return {
						...input,
						doc_no: nextDocNo(),
						supplier_code: supplier.code,
						supplier_name: supplier.name,
						currency: input.currency ?? supplier.currency,
						status: input.status ?? 'draft',
						expected_date:
							input.expected_date ?? shiftCalendarDate(deskToday(now), EXPECTED_LEAD_DAYS),
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
					refuse(`A ${oldStatus} purchase order is immutable. Revise by starting a new order.`);
				}
				assertTransition(TRANSITIONS, oldStatus, newStatus);
				const stamps: { confirmed_at?: string; cancelled_at?: string } = {};
				if (newStatus === 'submitted' && !withLines.has(stored.id)) {
					refuse('A purchase order must have at least one line before it can be submitted.');
				}
				if (newStatus === 'confirmed' && stored.confirmed_at == null) {
					stamps.confirmed_at = now.toISOString();
				}
				if (newStatus === 'cancelled') {
					requireReason(input.cancel_reason ?? stored.cancel_reason, 'cancellation');
					if (stored.cancelled_at == null) stamps.cancelled_at = now.toISOString();
				}
				return { ...input, ...stamps };
			});
		})
});
