import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import {
	documentTotals,
	lineAmounts,
	requireCurrency,
	type LineAmounts
} from '../../lib/pricing.js';
import type { Hooks, WorkspaceRow } from './$types.js';

/**
 * The purchase orders and products this batch of lines refers to, read once for all of them.
 *
 * Two questions per line — is its order a draft, is its product active — become two queries for the
 * batch instead of two round trips per row. `prepare` returns data and decides nothing; every
 * refusal below is still written once, for one line.
 */
interface PurchaseOrderLineBatch {
	readonly orders: ReadonlyMap<string, WorkspaceRow<'purchase_orders'>>;
	readonly products: ReadonlyMap<string, WorkspaceRow<'products'>>;
}

/**
 * `Hooks` with what `prepare` returns filled in.
 *
 * The generated `Hooks` alias fixes that parameter at `void`, so a collection that prepares anything
 * has to name the type itself. Once `bolt sync` emits `Hooks<Prepared = void>` this becomes
 * `satisfies Hooks<PurchaseOrderLineBatch>` and both lines go away.
 */
type PurchaseOrderLineHooks = CollectionHooks<
	WorkspaceSchema,
	'purchase_order_lines',
	PurchaseOrderLineBatch
>;

type AfterApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['after']>['handler']
>[0]['api'];

const LINE_LIMIT = 5000;

/** The pricing inputs a line under validation contributes, from the row's own fields. */
type ResolvedLineInput = Partial<
	Pick<WorkspaceRow<'purchase_order_lines'>, 'quantity' | 'unit_cost' | 'tax_rate'>
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
	if (unitCost < 0) {
		throw new Error('Unit cost cannot be negative.');
	}

	const taxRate = Number(input.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) {
		throw new Error('Tax rate must be between 0 and 100.');
	}
}

function computeLineAmounts(
	order: WorkspaceRow<'purchase_orders'>,
	line: ResolvedLineInput
): LineAmounts {
	return lineAmounts({
		quantity: Number(line.quantity ?? 0),
		unit_price: Number(line.unit_cost ?? 0),
		tax_rate: Number(line.tax_rate ?? 0),
		tax_inclusive: order.tax_inclusive,
		currency: requireCurrency(order.currency)
	});
}

function rollupPurchaseOrder(api: AfterApi, purchaseOrderId: string): Effect.Effect<void> {
	return Effect.gen(function* () {
		const order = yield* api.db.query.purchase_orders.findFirst({
			where: { id: { eq: purchaseOrderId } }
		});
		if (!order) return;

		const lines = yield* api.db.query.purchase_order_lines.findMany({
			where: { purchase_order_id: { eq: purchaseOrderId } },
			columns: { net: true, tax: true, line_total: true },
			limit: LINE_LIMIT
		});

		const totals = documentTotals(
			lines.map((line) => ({
				net: Number(line.net ?? 0),
				tax: Number(line.tax ?? 0),
				gross: Number(line.line_total ?? 0)
			})),
			requireCurrency(order.currency)
		);

		yield* api.db.purchase_orders.mutate([
			{
				id: purchaseOrderId,
				net: totals.net,
				tax: totals.tax,
				gross: totals.gross
			}
		]);
	});
}

const afterRollup = ({
	record,
	api
}: {
	readonly record: { readonly purchase_order_id: string };
	readonly api: AfterApi;
}) => rollupPurchaseOrder(api, record.purchase_order_id);

export default {
	create: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const orderIds = [
					...new Set(
						inputs.flatMap((input) => (input.purchase_order_id ? [input.purchase_order_id] : []))
					)
				];
				const productIds = [
					...new Set(inputs.flatMap((input) => (input.product_id ? [input.product_id] : [])))
				];
				const orders = orderIds.length
					? yield* api.db.query.purchase_orders.findMany({
							where: { id: { in: orderIds } },
							limit: LINE_LIMIT
						})
					: [];
				const products = productIds.length
					? yield* api.db.query.products.findMany({
							where: { id: { in: productIds } },
							limit: LINE_LIMIT
						})
					: [];
				return {
					orders: new Map(orders.map((order) => [order.id, order])),
					products: new Map(products.map((product) => [product.id, product]))
				};
			}),
		perRecord: {
			before: {
				description:
					'Adds a line only to a draft order for an active product, fills the product code, name, unit and tax rate from the catalogue, and prices the line net, tax and total from quantity and unit cost.',
				handler: ({ input, prepared }) => {
					if (!input.purchase_order_id) {
						throw new Error('A purchase order line must reference a purchase order.');
					}
					const order = prepared.orders.get(input.purchase_order_id);
					if (!order) throw new Error('Referenced purchase order does not exist.');
					if (order.status !== 'draft') {
						throw new Error('Line items can only be added to draft purchase orders.');
					}

					if (!input.product_id) throw new Error('A purchase order line must reference a product.');
					const product = prepared.products.get(input.product_id);
					if (!product) throw new Error('Referenced product does not exist.');
					if (!product.active) {
						throw new Error('Cannot add a line for an inactive product.');
					}

					const resolved = {
						...input,
						product_code: input.product_code ?? product.code,
						product_name: input.product_name ?? product.name,
						product_unit: input.product_unit ?? product.unit ?? '',
						unit_cost: input.unit_cost,
						tax_rate: input.tax_rate ?? product.tax_rate ?? 0
					};
					validateLineFields(resolved);

					const amounts = computeLineAmounts(order, resolved);
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
					'Recomputes the purchase order net, tax and gross from its lines after a line is added.',
				handler: afterRollup
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Keeps a line on its own draft order and re-prices its net, tax and total from the changed quantity, unit cost or tax rate.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (
							input.purchase_order_id != null &&
							input.purchase_order_id !== existing.purchase_order_id
						) {
							return yield* Effect.fail(
								new Error('A line item cannot be moved to a different purchase order.')
							);
						}

						const order = yield* api.db.query.purchase_orders.findFirst({
							where: { id: { eq: existing.purchase_order_id } }
						});
						if (!order)
							return yield* Effect.fail(new Error('Referenced purchase order does not exist.'));
						if (order.status !== 'draft') {
							return yield* Effect.fail(
								new Error('Line items can only be modified on draft purchase orders.')
							);
						}

						const resolved = { ...existing, ...input };
						validateLineFields(resolved);

						const amounts = computeLineAmounts(order, resolved);
						return {
							...input,
							net: amounts.net,
							tax: amounts.tax,
							line_total: amounts.gross
						};
					})
			},
			after: {
				description:
					'Recomputes the purchase order net, tax and gross from its lines after a line is changed.',
				handler: afterRollup
			}
		}
	},
	delete: {
		perRecord: {
			after: {
				description:
					'Recomputes the purchase order net, tax and gross from its lines after a line is removed.',
				handler: afterRollup
			}
		}
	}
} satisfies PurchaseOrderLineHooks;
