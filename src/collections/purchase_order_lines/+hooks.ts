import {
	refuse,
	type MutateAfterContext,
	type MutateBeforeContext,
	type MutateEditContext,
	type MutatePrepareContext
} from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { rowsById } from '../../lib/batch-reads.js';
import { rollupDocument } from '../../lib/document-lines.js';
import { documentLineAmounts, type LineAmounts } from '../../lib/pricing.js';
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

type AfterApi = MutateAfterContext<Hooks<PurchaseOrderLineBatch>>['api'];
type PrepareApi = MutatePrepareContext<Hooks<PurchaseOrderLineBatch>>['api'];

const LINE_LIMIT = 5000;

/** The orders a batch of lines is being added to. */
const ordersByIds = (api: PrepareApi) => (ids: readonly string[]) =>
	api.db.purchase_orders.findMany({ where: { id: { in: ids } }, limit: LINE_LIMIT });

/** The catalogue products a batch of lines names. */
const productsByIds = (api: PrepareApi) => (ids: readonly string[]) =>
	api.db.products.findMany({ where: { id: { in: ids } }, limit: LINE_LIMIT });

/** The pricing inputs a line under validation contributes, from the row's own fields. */
type ResolvedLineInput = Partial<
	Pick<WorkspaceRow<'purchase_order_lines'>, 'quantity' | 'unit_cost' | 'tax_rate'>
>;

function validateLineFields(input: ResolvedLineInput): void {
	const quantity = decodeNumber(input.quantity);
	if (Number.isNaN(quantity) || quantity <= 0) {
		refuse('Quantity must be greater than zero.');
	}

	const unitCost = decodeNumber(input.unit_cost);
	if (input.unit_cost == null || Number.isNaN(unitCost)) {
		refuse('Unit cost is required.');
	}
	if (unitCost < 0) {
		refuse('Unit cost cannot be negative.');
	}

	const taxRate = decodeNumber(input.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) {
		refuse('Tax rate must be between 0 and 100.');
	}
}

function computeLineAmounts(
	order: WorkspaceRow<'purchase_orders'>,
	line: ResolvedLineInput
): LineAmounts {
	return documentLineAmounts(order, {
		quantity: line.quantity,
		unit_price: line.unit_cost,
		tax_rate: line.tax_rate
	});
}

/** The order a roll-up writes back to. */
const orderById = (api: AfterApi, purchaseOrderId: string) =>
	api.db.purchase_orders.findFirst({ where: { id: { eq: purchaseOrderId } } });

/** The money cells of every line on one order. */
const orderLineTotals = (api: AfterApi, purchaseOrderId: string) =>
	api.db.purchase_order_lines.findMany({
		where: { purchase_order_id: { eq: purchaseOrderId } },
		columns: { net: true, tax: true, line_total: true },
		limit: LINE_LIMIT
	});

function rollupPurchaseOrder(api: AfterApi, purchaseOrderId: string): Effect.Effect<void> {
	return rollupDocument({
		document: orderById(api, purchaseOrderId),
		lines: orderLineTotals(api, purchaseOrderId),
		write: (totals) => api.db.purchase_orders.mutate({ id: purchaseOrderId, ...totals })
	});
}

const afterRollup = ({
	record,
	api
}: {
	readonly record: { readonly purchase_order_id: string };
	readonly api: AfterApi;
}) => rollupPurchaseOrder(api, record.purchase_order_id);

/** The context a `mutate.before` handler receives, named so the two halves can be hoisted. */
type BeforeContext = MutateBeforeContext<Hooks<PurchaseOrderLineBatch>>;

/** The same context on an edit, where `existing` is the stored row rather than undefined. */
type EditContext = MutateEditContext<Hooks<PurchaseOrderLineBatch>>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, prepared }: BeforeContext) => {
	if (!input.purchase_order_id) {
		refuse('A purchase order line must reference a purchase order.');
	}
	const order = prepared.orders.get(input.purchase_order_id);
	if (!order) refuse('Referenced purchase order does not exist.');
	if (order.status !== 'draft') {
		refuse('Line items can only be added to draft purchase orders.');
	}

	if (!input.product_id) refuse('A purchase order line must reference a product.');
	const product = prepared.products.get(input.product_id);
	if (!product) refuse('Referenced product does not exist.');
	if (!product.active) {
		refuse('Cannot add a line for an inactive product.');
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
};

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({ input, existing, api }: EditContext) => {
	if (input.purchase_order_id != null && input.purchase_order_id !== existing.purchase_order_id) {
		refuse('A line item cannot be moved to a different purchase order.');
	}

	return Effect.map(
		api.db.purchase_orders.findFirst({ where: { id: { eq: existing.purchase_order_id } } }),
		(order) => {
			if (!order) refuse('Referenced purchase order does not exist.');
			if (order.status !== 'draft') {
				refuse('Line items can only be modified on draft purchase orders.');
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
		}
	);
};

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.all({
				orders: rowsById(inputs, (input) => input.purchase_order_id, ordersByIds(api)),
				products: rowsById(inputs, (input) => input.product_id, productsByIds(api))
			}),
		perRecord: {
			before: {
				description:
					'Adds a line only to a draft order for an active product, fills the product code, name, unit and tax rate from the catalogue, and prices the line net, tax and total from quantity and unit cost. Keeps a line on its own draft order and re-prices its net, tax and total from the changed quantity, unit cost or tax rate.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
			},
			after: {
				description:
					'Recomputes the purchase order net, tax and gross from its lines after a line is added. Recomputes the purchase order net, tax and gross from its lines after a line is changed.',
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
} satisfies Hooks<PurchaseOrderLineBatch>;
