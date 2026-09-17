import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { batchEntries, uniqueIds } from '../../lib/lifecycle.js';
import { costLineColumns } from '../../lib/pricing.js';
import model from './+model.js';

/** The buy-side cells the purchaser states; code, name, unit and the money columns are derived. */
const cells = { quantity: true, unit_cost: true, tax_rate: true } as const;

const create = {
	input: { columns: { purchase_order_id: true, product_id: true, ...cells } }
} as const;
/** A line stays on its order and its product; only its cells move. */
const update = { input: { columns: cells } } as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;
type Stored = WorkspaceRow<'purchase_order_lines'>;

const LIMIT = 5000;

/**
 * Adds a line only to a draft order for an active product, fills the product code, name, unit and
 * tax rate from the catalogue, and prices the line from quantity and unit cost. Keeps a line on its
 * own draft order and re-prices it from the changed cells. The order's own totals follow through
 * the roll-up automations.
 */
export default defineCollection({
	model,
	create,
	update,
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const entries = batchEntries<Create, Update, Stored>(inputs, existing);
			const orderIds = uniqueIds(
				entries.map((entry) =>
					entry.kind === 'create' ? entry.input.purchase_order_id : entry.stored.purchase_order_id
				)
			);
			const productIds = uniqueIds(
				entries.flatMap((entry) => (entry.kind === 'create' ? [entry.input.product_id] : []))
			);
			const [orders, products] = yield* Effect.all(
				[
					db.purchase_orders.findMany({ where: { id: { in: orderIds } }, limit: LIMIT }),
					productIds.length
						? db.products.findMany({ where: { id: { in: productIds } }, limit: LIMIT })
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			const orderById = new Map(orders.map((order) => [order.id, order]));
			const productById = new Map(products.map((product) => [product.id, product]));

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const order = orderById.get(input.purchase_order_id);
					if (!order) refuse('Referenced purchase order does not exist.');
					if (order.status !== 'draft') {
						refuse('Line items can only be added to draft purchase orders.');
					}
					const product = productById.get(input.product_id);
					if (!product) refuse('Referenced product does not exist.');
					if (!product.active) refuse('Cannot add a line for an inactive product.');
					const resolved = {
						...input,
						tax_rate: input.tax_rate ?? product.tax_rate ?? 0,
						product_code: product.code,
						product_name: product.name,
						product_unit: product.unit ?? ''
					};
					return { ...resolved, ...costLineColumns(order, resolved) };
				}
				const { input, stored } = entry;
				const order = orderById.get(stored.purchase_order_id);
				if (!order) refuse('Referenced purchase order does not exist.');
				if (order.status !== 'draft') {
					refuse('Line items can only be modified on draft purchase orders.');
				}
				return { ...input, ...costLineColumns(order, { ...stored, ...input }) };
			});
		})
});
