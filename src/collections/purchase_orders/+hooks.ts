import { Effect, Schema } from 'effect';
import { currentInstant } from '../../lib/clock.js';
import { deskToday } from '../../lib/desk-date.js';
import { docNoSeriesPattern, nextDocNo } from '../../lib/document-numbers.js';
import type { Hooks, WorkspaceRow } from './$types.js';

function shiftCalendarDate(value: string, days: number): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error('Calendar date must use YYYY-MM-DD.');
	}
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) throw new Error('Calendar date is invalid.');
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

const purchaseOrderStatusSchema = Schema.Literals(['draft', 'submitted', 'confirmed', 'cancelled']);
type PurchaseOrderStatus = Schema.Schema.Type<typeof purchaseOrderStatusSchema>;

type PurchaseOrderUpdate = {
	-readonly [K in keyof WorkspaceRow<'purchase_orders'>]?: WorkspaceRow<'purchase_orders'>[K];
};

const VALID_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
	draft: ['submitted', 'cancelled'],
	submitted: ['confirmed', 'cancelled'],
	confirmed: [],
	cancelled: []
};

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Opens an order against an active supplier, copies down the supplier code, name and currency, sets the expected date two weeks out, and assigns the next PO document number for the year.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						const now = yield* currentInstant;
						if (!input.supplier_id) {
							return yield* Effect.fail(new Error('A purchase order must reference a supplier.'));
						}
						const supplier = yield* api.db.suppliers.findFirst({
							where: { id: { eq: input.supplier_id } }
						});
						if (!supplier)
							return yield* Effect.fail(new Error('Referenced supplier does not exist.'));
						if (!supplier.active) {
							return yield* Effect.fail(
								new Error('Cannot create a purchase order for an inactive supplier.')
							);
						}

						const resolved = {
							...input,
							supplier_code: supplier.code,
							supplier_name: supplier.name,
							currency: input.currency ?? supplier.currency,
							status: input.status ?? 'draft',
							tax_inclusive: input.tax_inclusive ?? true,
							net: input.net ?? 0,
							tax: input.tax ?? 0,
							gross: input.gross ?? 0,
							expected_date: input.expected_date ?? shiftCalendarDate(deskToday(now), 14)
						};

						if (!input.doc_no) {
							const year = now.getFullYear();
							const existing = yield* api.db.purchase_orders.findMany({
								where: { doc_no: { like: docNoSeriesPattern('PO', year) } },
								columns: { doc_no: true },
								limit: 5000
							});
							return {
								...resolved,
								doc_no: nextDocNo(
									existing.map((row) => row.doc_no),
									'PO',
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
					'Moves an order from draft to submitted to confirmed, refuses edits once it has left draft, requires at least one line to submit, and requires a cancellation reason to cancel.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (input.supplier_id != null && input.supplier_id !== existing.supplier_id) {
							return yield* Effect.fail(
								new Error('Supplier cannot be changed on a purchase order.')
							);
						}

						const newStatus = yield* Schema.decodeUnknownEffect(purchaseOrderStatusSchema)(
							input.status ?? existing.status
						);
						const oldStatus = yield* Schema.decodeUnknownEffect(purchaseOrderStatusSchema)(
							existing.status
						);

						if (oldStatus === newStatus) {
							if (oldStatus === 'draft') return input;
							return yield* Effect.fail(
								new Error(
									`A ${oldStatus} purchase order is immutable. Revise by starting a new order.`
								)
							);
						}

						const allowed = VALID_TRANSITIONS[oldStatus];
						if (!allowed.includes(newStatus)) {
							return yield* Effect.fail(
								new Error(
									`Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}.`
								)
							);
						}

						const updates: PurchaseOrderUpdate = { ...input };

						if (newStatus === 'submitted') {
							const lines = yield* api.db.purchase_order_lines.findMany({
								where: { purchase_order_id: { eq: existing.id } },
								limit: 1
							});
							if (lines.length === 0) {
								return yield* Effect.fail(
									new Error(
										'A purchase order must have at least one line before it can be submitted.'
									)
								);
							}
						}

						if (newStatus === 'confirmed' && existing.confirmed_at == null) {
							const confirmedAt = (yield* currentInstant).toISOString();
							updates.confirmed_at = confirmedAt;
						}

						if (newStatus === 'cancelled') {
							const cancelReason = input.cancel_reason ?? existing.cancel_reason;
							if (!cancelReason || String(cancelReason).trim() === '') {
								return yield* Effect.fail(new Error('A cancellation reason is required.'));
							}
							if (existing.cancelled_at == null) {
								updates.cancelled_at = (yield* currentInstant).toISOString();
							}
						}

						return updates;
					})
			}
		}
	}
} satisfies Hooks;
