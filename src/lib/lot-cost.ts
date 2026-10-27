import { type DecimalLike, Decimal, sum } from '@norbital-ai/std/decimal';
import type { Id, ReadAnswer } from '@norbital-ai/bolt';
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
	if (rows.some((r) => r.product === product && r.unit === null && Decimal.of(r.on_hand).gt(0)))
		return null;
	const lots = rows.filter(
		(r) =>
			r.product === product &&
			r.unit === unit &&
			r.currency === currency &&
			Decimal.of(r.on_hand).gt(0)
	);
	if (!lots.length || lots.some((r) => r.unit_cost === null)) return null;
	return sum(lots.map((r) => Decimal.of(r.on_hand).times(r.unit_cost!))).div(
		sum(lots.map((r) => r.on_hand)),
		8
	);
}
/** The remaining lots of one product a floor is compared with. */
export const inventoryCostRead = (product: Id<'products'>) =>
	({
		stock_snapshots: {
			where: { product: { eq: product } },
			fields: ['product', 'unit', 'currency', 'on_hand', 'unit_cost']
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
	const net = Decimal.of(floor.price).div(
		floor.tax_inclusive
			? Decimal.of(1).plus(Decimal.of(floor.tax_rate).div(100, 8))
			: Decimal.of(1),
		8
	);
	return { below: average !== null && net.lt(average), average };
}
