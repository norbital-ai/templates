import { currencyFractionDigits, fromMinorUnits, toMinorUnits } from '@norbital-ai/std/finance';
import type { Hooks, WorkspaceRow } from './$types.js';

function roundHalfUp(value: number, digits: number): number {
	if (!Number.isFinite(value)) {
		throw new Error('Cannot round a value that is not a finite number.');
	}
	const magnitude = Math.abs(shiftExponent(value, digits));
	const rounded = Math.round(magnitude);
	return shiftExponent(value < 0 ? -rounded : rounded, -digits);
}

function shiftExponent(value: number, places: number): number {
	if (value === 0) return 0;
	const [mantissa, exponent] = value.toExponential().split('e');
	return Number(`${mantissa}e${Number(exponent) + places}`);
}

interface LinePricing {
	readonly quantity: number;
	readonly unit_price: number;
	readonly discount_pct?: number | null;
	readonly tax_rate?: number | null;
	readonly tax_inclusive: boolean;
	readonly currency: string;
}

interface LineAmounts {
	readonly net: number;
	readonly tax: number;
	readonly gross: number;
}

function lineAmounts(line: LinePricing): LineAmounts {
	const digits = currencyFractionDigits(line.currency);
	const discount = line.discount_pct ?? 0;
	const rate = (line.tax_rate ?? 0) / 100;
	const base = line.quantity * line.unit_price * (1 - discount / 100);

	if (line.tax_inclusive) {
		const gross = roundHalfUp(base, digits);
		const net = roundHalfUp(gross / (1 + rate), digits);
		return { net, tax: roundHalfUp(gross - net, digits), gross };
	}

	const net = roundHalfUp(base, digits);
	const tax = roundHalfUp(net * rate, digits);
	return { net, tax, gross: roundHalfUp(net + tax, digits) };
}

function documentTotals(lines: readonly LineAmounts[], currency: string): LineAmounts {
	let net = 0n;
	let tax = 0n;
	let gross = 0n;
	for (const line of lines) {
		net += toMinorUnits(line.net, currency);
		tax += toMinorUnits(line.tax, currency);
		gross += toMinorUnits(line.gross, currency);
	}
	return {
		net: fromMinorUnits(net, currency),
		tax: fromMinorUnits(tax, currency),
		gross: fromMinorUnits(gross, currency)
	};
}

type AfterApi = Parameters<NonNullable<NonNullable<Hooks['create']>['after']>['handler']>[0]['api'];

const LINE_LIMIT = 5000;

function requireCurrency(currency: string | null): string {
	if (!currency) throw new Error('Document currency is required.');
	return currency;
}

function validateLineFields(input: Record<string, unknown>): void {
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

function computeLineAmounts(order: WorkspaceRow<'purchase_orders'>, line: Record<string, unknown>) {
	return lineAmounts({
		quantity: Number(line.quantity),
		unit_price: Number(line.unit_cost),
		tax_rate: Number(line.tax_rate ?? 0),
		tax_inclusive: order.tax_inclusive,
		currency: requireCurrency(order.currency)
	});
}

async function rollupPurchaseOrder(api: AfterApi, purchaseOrderId: string): Promise<void> {
	const order = await api.db.query.purchase_orders.findFirst({
		where: { norbital_id: { eq: purchaseOrderId } }
	});
	if (!order) return;

	const lines = await api.db.query.purchase_order_lines.findMany({
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

	await api.db.mutate('purchase_orders', [
		{
			norbital_id: purchaseOrderId,
			net: totals.net,
			tax: totals.tax,
			gross: totals.gross
		}
	]);
}

const afterRollup = async ({
	record,
	api
}: {
	readonly record: { readonly purchase_order_id: string };
	readonly api: AfterApi;
}) => {
	await rollupPurchaseOrder(api, record.purchase_order_id);
};

export default {
	create: {
		before: {
			description:
				'Adds a line only to a draft order for an active product, fills the product code, name, unit and tax rate from the catalogue, and prices the line net, tax and total from quantity and unit cost.',
			batchHandler: async ({ inputs, api }) => {
				const orderIds = [
					...new Set(
						inputs.flatMap((input) => (input.purchase_order_id ? [input.purchase_order_id] : []))
					)
				];
				const productIds = [
					...new Set(inputs.flatMap((input) => (input.product_id ? [input.product_id] : [])))
				];
				const [orders, products] = await Promise.all([
					orderIds.length
						? api.db.query.purchase_orders.findMany({
								where: { norbital_id: { in: orderIds } },
								limit: LINE_LIMIT
							})
						: [],
					productIds.length
						? api.db.query.products.findMany({
								where: { norbital_id: { in: productIds } },
								limit: LINE_LIMIT
							})
						: []
				]);
				const ordersById = new Map(orders.map((order) => [order.norbital_id, order]));
				const productsById = new Map(products.map((product) => [product.norbital_id, product]));

				return inputs.map((input) => {
					if (!input.purchase_order_id) {
						throw new Error('A purchase order line must reference a purchase order.');
					}
					const order = ordersById.get(input.purchase_order_id);
					if (!order) throw new Error('Referenced purchase order does not exist.');
					if (order.status !== 'draft') {
						throw new Error('Line items can only be added to draft purchase orders.');
					}
					if (!input.product_id) throw new Error('A purchase order line must reference a product.');
					const product = productsById.get(input.product_id);
					if (!product) throw new Error('Referenced product does not exist.');
					if (!product.active) throw new Error('Cannot add a line for an inactive product.');
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
					return { ...resolved, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
				});
			},
			handler: async ({ input, api }) => {
				if (!input.purchase_order_id) {
					throw new Error('A purchase order line must reference a purchase order.');
				}
				const order = await api.db.query.purchase_orders.findFirst({
					where: { norbital_id: { eq: input.purchase_order_id } }
				});
				if (!order) throw new Error('Referenced purchase order does not exist.');
				if (order.status !== 'draft') {
					throw new Error('Line items can only be added to draft purchase orders.');
				}

				if (!input.product_id) throw new Error('A purchase order line must reference a product.');
				const product = await api.db.query.products.findFirst({
					where: { norbital_id: { eq: input.product_id } }
				});
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
			batchHandler: async ({ records, api }) => {
				const orderIds = [...new Set(records.map((record) => record.purchase_order_id))];
				const [orders, lines] = await Promise.all([
					api.db.query.purchase_orders.findMany({
						where: { norbital_id: { in: orderIds } },
						limit: LINE_LIMIT
					}),
					api.db.query.purchase_order_lines.findMany({
						where: { purchase_order_id: { in: orderIds } },
						columns: { purchase_order_id: true, net: true, tax: true, line_total: true },
						limit: LINE_LIMIT
					})
				]);
				const linesByOrder = new Map<string, typeof lines>();
				for (const line of lines) {
					const grouped = linesByOrder.get(line.purchase_order_id) ?? [];
					grouped.push(line);
					linesByOrder.set(line.purchase_order_id, grouped);
				}
				await api.db.mutate(
					'purchase_orders',
					orders.map((order) => {
						const totals = documentTotals(
							(linesByOrder.get(order.norbital_id) ?? []).map((line) => ({
								net: Number(line.net ?? 0),
								tax: Number(line.tax ?? 0),
								gross: Number(line.line_total ?? 0)
							})),
							requireCurrency(order.currency)
						);
						return {
							norbital_id: order.norbital_id,
							net: totals.net,
							tax: totals.tax,
							gross: totals.gross
						};
					})
				);
			},
			handler: afterRollup
		}
	},
	update: {
		before: {
			description:
				'Keeps a line on its own draft order and re-prices its net, tax and total from the changed quantity, unit cost or tax rate.',
			handler: async ({ input, existing, api }) => {
				if (
					input.purchase_order_id != null &&
					input.purchase_order_id !== existing.purchase_order_id
				) {
					throw new Error('A line item cannot be moved to a different purchase order.');
				}

				const order = await api.db.query.purchase_orders.findFirst({
					where: { norbital_id: { eq: existing.purchase_order_id } }
				});
				if (!order) throw new Error('Referenced purchase order does not exist.');
				if (order.status !== 'draft') {
					throw new Error('Line items can only be modified on draft purchase orders.');
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
		},
		after: {
			description:
				'Recomputes the purchase order net, tax and gross from its lines after a line is changed.',
			handler: afterRollup
		}
	},
	delete: {
		after: {
			description:
				'Recomputes the purchase order net, tax and gross from its lines after a line is removed.',
			handler: afterRollup
		}
	}
} satisfies Hooks;
