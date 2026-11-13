import { BigDecimal } from 'effect';
import { type D, type DecimalLike, dec, div, sum } from './values.js';
import type { Id, ReadAnswer } from '@norbital-ai/bolt';

export const fifoStockFields = [
	'product',
	'source',
	'warehouse',
	'lot_number',
	'unit',
	'on_hand',
	'as_of'
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
	readonly on_hand: DecimalLike;
	readonly as_of: string;
};
const unitKey = (unit: string | null) => unit?.normalize('NFKC').trim().toLowerCase();

/** An advisory pick from physical stock, with purchase price evidence scoped to the selected warehouse. */
export function estimateFifoCost(
	lots: readonly StockLot[],
	purchase: PurchaseLotCosts,
	input: {
		product: string;
		productCode: string;
		source: string;
		warehouses: readonly string[];
		quantity: DecimalLike;
		unit: string;
		currency: string;
		as_of: string;
	}
) {
	const quantity = dec(input.quantity);
	const now = Date.parse(input.as_of);
	const fresh = (value: string) => Math.abs(now - Date.parse(value)) < 30 * 60_000;
	if (
		!BigDecimal.isPositive(quantity) ||
		purchase.currency !== input.currency ||
		!fresh(purchase.observed_at)
	)
		return null;
	const productLots = lots.filter(
		(lot) => lot.product === input.product && lot.source === input.source
	);
	const selected = productLots.filter(
		(lot) => input.warehouses.includes(lot.warehouse) && !BigDecimal.isZero(dec(lot.on_hand))
	);
	if (
		selected.some(
			(lot) =>
				!lot.lot_number ||
				!fresh(lot.as_of) ||
				unitKey(lot.unit) !== unitKey(input.unit) ||
				BigDecimal.isNegative(dec(lot.on_hand))
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
		{ lot_number: string; quantity: D; unit_cost: D; received_on: string }
	>();
	for (const lot of selected) {
		const name = lot.lot_number ?? '';
		const receipt = costs.get(name);
		if (!receipt || unitKey(receipt.unit) !== unitKey(input.unit)) return null;
		const recorded = productLots.filter(
			(row) => row.lot_number === name && BigDecimal.isPositive(dec(row.on_hand))
		);
		if (
			recorded.some((row) => !fresh(row.as_of) || unitKey(row.unit) !== unitKey(input.unit)) ||
			BigDecimal.isGreaterThan(sum(recorded.map((row) => row.on_hand)), dec(receipt.received_qty))
		)
			return null;
		const previous = picks.get(name);
		if (previous) previous.quantity = BigDecimal.sum(previous.quantity, dec(lot.on_hand));
		else
			picks.set(name, {
				lot_number: name,
				quantity: dec(lot.on_hand),
				unit_cost: dec(receipt.unit_cost),
				received_on: receipt.received_on
			});
	}
	const ordered = [...picks.values()].sort(
		(a, b) => a.received_on.localeCompare(b.received_on) || a.lot_number.localeCompare(b.lot_number)
	);
	let left = quantity;
	let total = dec(0);
	const allocated = [];
	for (const lot of ordered) {
		const used = BigDecimal.min(left, lot.quantity);
		allocated.push({ ...lot, quantity: used });
		total = BigDecimal.sum(total, BigDecimal.multiply(used, lot.unit_cost));
		left = BigDecimal.subtract(left, used);
		if (BigDecimal.isZero(left))
			return { total, unit_cost: div(total, quantity, 8), lots: allocated };
	}
	return null;
}
/** Weighted cost of remaining stock in compatible units and currency; missing prices stay unknown. */
export function averageLotCost(
	rows: readonly {
		product: string;
		unit: string | null;
		currency: string | null;
		on_hand: DecimalLike;
		unit_cost: DecimalLike | null;
	}[],
	product: string,
	unit: string,
	currency: string
) {
	if (
		rows.some(
			(r) => r.product === product && r.unit === null && BigDecimal.isPositive(dec(r.on_hand))
		)
	)
		return null;
	const lots = rows.filter(
		(r) =>
			r.product === product &&
			r.unit === unit &&
			r.currency === currency &&
			BigDecimal.isPositive(dec(r.on_hand))
	);
	if (!lots.length || lots.some((r) => r.unit_cost === null)) return null;
	return div(
		sum(lots.map((r) => BigDecimal.multiply(dec(r.on_hand), dec(r.unit_cost!)))),
		sum(lots.map((r) => r.on_hand)),
		8
	);
}
/** The remaining lots of one product a floor is compared with. */
export const inventoryCostRead = (product: Id<'products'>, group = '') =>
	({
		products: { where: { id: { eq: product } }, fields: ['source', 'external_code'], limit: 1 },
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
		price: DecimalLike;
		tax_inclusive: boolean;
		tax_rate: DecimalLike;
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

export function floorNetPrice(floor: {
	price: DecimalLike;
	tax_inclusive: boolean;
	tax_rate: DecimalLike;
}) {
	return div(
		floor.price,
		floor.tax_inclusive ? BigDecimal.sum(dec(1), div(floor.tax_rate, 100, 8)) : 1,
		8
	);
}
