import { type DecimalLike, Decimal, sum } from '@norbital-ai/std/decimal';
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
