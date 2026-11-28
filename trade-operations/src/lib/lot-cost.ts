import { BigDecimal, Duration } from 'effect';
import type { Id, ReadAnswer } from '@norbital-ai/bolt';
import { unitRatio } from './commercial.js';

export const fifoStockFields = [
	'product',
	'source',
	'warehouse',
	'lot_number',
	'unit',
	'on_hand'
] as const;

export const purchaseLotCostRead = (source: Id<'sys_integration'>) =>
	({
		source_lot_costs: {
			where: { source: { eq: source } },
			fields: ['currency', 'observed_at', 'entries'],
			limit: 1
		}
	}) as const;

export type PurchaseLotCosts = ReadAnswer<
	ReturnType<typeof purchaseLotCostRead>
>['source_lot_costs']['rows'][number];
type StockLot = {
	readonly product: string;
	readonly source: string;
	readonly warehouse: string;
	readonly lot_number: string | null;
	readonly unit: string | null;
	readonly on_hand: string;
};
const convertQty = (amount: string, from: string | null, to: string) => {
	if (from === null) return null;
	const ratio = unitRatio(from, to);
	return ratio === null ? null : BigDecimal.multiply(BigDecimal.fromStringUnsafe(amount), ratio);
};

/** An advisory pick from physical stock, with purchase price evidence scoped to the selected warehouse. */
export function estimateFifoCost(
	lots: readonly StockLot[],
	purchase: PurchaseLotCosts,
	input: {
		product: string;
		productCode: string;
		source: string;
		warehouses: readonly string[];
		quantity: string;
		unit: string;
		currency: string;
		as_of: string;
		/** What the ledger last confirmed of its stock and purchase lots (`confirmedAt`), not a row's time. */
		confirmed: { readonly stock: string | null; readonly lots: string | null };
		readonly freshMinutes?: number;
	}
) {
	const quantity = BigDecimal.fromStringUnsafe(input.quantity);
	const now = Date.parse(input.as_of);
	const freshWindow = Duration.toMillis(Duration.minutes(input.freshMinutes ?? 30));
	const fresh = (value: string | null) =>
		value !== null && Math.abs(now - Date.parse(value)) < freshWindow;
	if (
		!BigDecimal.isPositive(quantity) ||
		purchase.currency !== input.currency ||
		!fresh(input.confirmed.lots) ||
		!fresh(input.confirmed.stock)
	)
		return null;
	const productLots = lots.filter(
		(lot) => lot.product === input.product && lot.source === input.source
	);
	const selected = productLots.filter(
		(lot) =>
			input.warehouses.includes(lot.warehouse) &&
			!BigDecimal.isZero(BigDecimal.fromStringUnsafe(lot.on_hand))
	);
	if (
		selected.some(
			(lot) =>
				!lot.lot_number ||
				lot.unit === null ||
				unitRatio(lot.unit, input.unit) === null ||
				BigDecimal.isNegative(BigDecimal.fromStringUnsafe(lot.on_hand))
		)
	)
		return null;
	const costs = new Map(
		purchase.entries
			.filter((entry) => entry.product_code === input.productCode)
			.map((entry) => [entry.lot_number, entry])
	);
	const picks = new Map<
		string,
		{
			lot_number: string;
			quantity: BigDecimal.BigDecimal;
			unit_cost: BigDecimal.BigDecimal;
			received_on: string;
		}
	>();
	for (const lot of selected) {
		const name = lot.lot_number ?? '';
		const receipt = costs.get(name);
		const receiptRatio = receipt ? unitRatio(receipt.unit, input.unit) : null;
		const lotQuantity = convertQty(lot.on_hand, lot.unit, input.unit);
		if (!receipt || receiptRatio === null || lotQuantity === null) return null;
		const recorded = productLots.filter(
			(row) =>
				row.lot_number === name && BigDecimal.isPositive(BigDecimal.fromStringUnsafe(row.on_hand))
		);
		const recordedConverted = recorded.map((row) => convertQty(row.on_hand, row.unit, input.unit));
		const receivedConverted = convertQty(receipt.received_qty, receipt.unit, input.unit);
		if (
			receivedConverted === null ||
			recordedConverted.some((q) => q === null) ||
			BigDecimal.isGreaterThan(
				BigDecimal.sumAll(recordedConverted.flatMap((q) => (q === null ? [] : [q]))),
				receivedConverted
			)
		)
			return null;
		const unitCost = BigDecimal.round(
			BigDecimal.divideUnsafe(BigDecimal.fromStringUnsafe(receipt.unit_cost), receiptRatio),
			{ scale: 8 }
		);
		const previous = picks.get(name);
		if (previous) previous.quantity = BigDecimal.sum(previous.quantity, lotQuantity);
		else
			picks.set(name, {
				lot_number: name,
				quantity: lotQuantity,
				unit_cost: unitCost,
				received_on: receipt.received_on
			});
	}
	const ordered = [...picks.values()].sort(
		(a, b) => a.received_on.localeCompare(b.received_on) || a.lot_number.localeCompare(b.lot_number)
	);
	let left = quantity;
	let total = BigDecimal.fromBigInt(0n);
	const allocated = [];
	for (const lot of ordered) {
		const used = BigDecimal.min(left, lot.quantity);
		allocated.push({ ...lot, quantity: used });
		total = BigDecimal.sum(total, BigDecimal.multiply(used, lot.unit_cost));
		left = BigDecimal.subtract(left, used);
		if (BigDecimal.isZero(left))
			return {
				total,
				unit_cost: BigDecimal.round(BigDecimal.divideUnsafe(total, quantity), { scale: 8 }),
				lots: allocated
			};
	}
	return null;
}
/** Weighted cost of remaining stock in compatible units and currency; missing prices stay unknown. */
export function averageLotCost(
	rows: readonly {
		product: string;
		unit: string | null;
		currency: string | null;
		on_hand: string;
		unit_cost: string | null;
	}[],
	product: string,
	unit: string,
	currency: string
) {
	if (
		rows.some(
			(r) =>
				r.product === product &&
				r.unit === null &&
				BigDecimal.isPositive(BigDecimal.fromStringUnsafe(r.on_hand))
		)
	)
		return null;
	const lots = rows.flatMap((r) => {
		if (
			r.product !== product ||
			r.currency !== currency ||
			r.unit === null ||
			!BigDecimal.isPositive(BigDecimal.fromStringUnsafe(r.on_hand))
		)
			return [];
		const ratio = unitRatio(r.unit, unit);
		return ratio === null ? [] : [{ row: r, ratio }];
	});
	const valued = lots.flatMap(({ row: r }) =>
		r.unit_cost === null
			? []
			: [
					BigDecimal.multiply(
						BigDecimal.fromStringUnsafe(r.on_hand),
						BigDecimal.fromStringUnsafe(r.unit_cost)
					)
				]
	);
	if (!lots.length || valued.length < lots.length) return null;
	return BigDecimal.round(
		BigDecimal.divideUnsafe(
			BigDecimal.sumAll(valued),
			BigDecimal.sumAll(
				lots.map(({ row: r, ratio }) =>
					BigDecimal.multiply(BigDecimal.fromStringUnsafe(r.on_hand), ratio)
				)
			)
		),
		{ scale: 8 }
	);
}
/** The remaining lots of one product a floor is compared with. */
export const inventoryCostRead = (product: Id<'products'>, group = '') =>
	({
		products: {
			where: { id: { eq: product } },
			fields: ['source', 'external_code'],
			source: { fields: ['active', 'status'] },
			limit: 1
		},
		warehouses: { where: { group_code: { eq: group } }, fields: ['source'] },
		stock_snapshots: {
			where: { product: { eq: product } },
			fields: [...fifoStockFields, 'currency', 'unit_cost'],
			limit: 10000
		}
	}) as const;
/** Whether a proposed floor (net of tax when tax-inclusive) is below the remaining inventory's weighted cost. */
export function inventoryCost(
	answer: ReadAnswer<ReturnType<typeof inventoryCostRead>>,
	floor: {
		product: string;
		unit: string;
		currency: string;
		price: string;
		tax_inclusive: boolean;
		tax_rate: string;
	}
) {
	const average = averageLotCost(
		answer.stock_snapshots.rows,
		floor.product,
		floor.unit,
		floor.currency
	);
	return {
		below: average !== null && BigDecimal.isLessThan(floorNetPrice(floor), average),
		average
	};
}

export function floorNetPrice(floor: { price: string; tax_inclusive: boolean; tax_rate: string }) {
	return BigDecimal.round(
		BigDecimal.divideUnsafe(
			BigDecimal.fromStringUnsafe(floor.price),
			floor.tax_inclusive
				? BigDecimal.sum(
						BigDecimal.fromBigInt(1n),
						BigDecimal.round(
							BigDecimal.divideUnsafe(
								BigDecimal.fromStringUnsafe(floor.tax_rate),
								BigDecimal.fromBigInt(100n)
							),
							{ scale: 8 }
						)
					)
				: BigDecimal.fromBigInt(1n)
		),
		{ scale: 8 }
	);
}
