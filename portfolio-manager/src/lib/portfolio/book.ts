import { BigDecimal } from 'effect';

type D = BigDecimal.BigDecimal;
const ZERO = BigDecimal.fromBigInt(0n);

/** The statement fields of a holding the figures read. */
export type Statement = {
	readonly value_base: string;
	readonly market_value: string;
	readonly cost_value: string | null;
	readonly live_value_base: string | null;
};

/** What a line is worth now: its calculated value once the agent priced it, else the statement's. */
export const lineValue = (row: Statement): D =>
	BigDecimal.fromStringUnsafe(row.live_value_base ?? row.value_base);

/** What a line cost in base currency: its local cost at the statement's own rate. */
export const costInBase = (row: Statement): D => {
	const local = row.cost_value === null ? ZERO : BigDecimal.fromStringUnsafe(row.cost_value);
	const market = BigDecimal.fromStringUnsafe(row.market_value);
	const base = BigDecimal.fromStringUnsafe(row.value_base);
	return BigDecimal.round(
		BigDecimal.isPositive(market) && BigDecimal.isPositive(base)
			? BigDecimal.divideUnsafe(BigDecimal.multiply(local, base), market)
			: local,
		{ scale: 2, mode: 'half-from-zero' }
	);
};

/** Cash and facilities are lines of the book, but not positions to analyse. */
export const isPosition = (row: { readonly asset_class: string }) =>
	row.asset_class !== 'cash' && row.asset_class !== 'loan';

/** One line as the totals read it: its value now in base currency and its statement P&L. */
export type BookLine = {
	readonly asset_class: string;
	readonly value: D;
	readonly unrealised_pl: D;
};

export type Metrics = {
	readonly total_assets: D;
	readonly invested: D;
	readonly cash: D;
	readonly liabilities: D;
	readonly net_assets: D;
	readonly unrealised_pl: D;
	readonly allocation: readonly { label: string; value: D; weight: D }[];
};

/** The book's totals and allocation; the report and the dashboard both read these. */
export const computeMetrics = (rows: readonly BookLine[]): Metrics => {
	let cash = ZERO;
	let invested = ZERO;
	let liabilities = ZERO;
	let unrealised = ZERO;
	const byClass = new Map<string, D>();
	for (const row of rows) {
		if (row.asset_class === 'cash') cash = BigDecimal.sum(cash, row.value);
		else if (row.asset_class === 'loan') liabilities = BigDecimal.subtract(liabilities, row.value);
		else {
			invested = BigDecimal.sum(invested, row.value);
			byClass.set(row.asset_class, BigDecimal.sum(byClass.get(row.asset_class) ?? ZERO, row.value));
		}
		unrealised = BigDecimal.sum(unrealised, row.unrealised_pl);
	}
	const total = BigDecimal.sum(cash, invested);
	return {
		total_assets: BigDecimal.round(total, { scale: 2, mode: 'half-from-zero' }),
		invested: BigDecimal.round(invested, { scale: 2, mode: 'half-from-zero' }),
		cash: BigDecimal.round(cash, { scale: 2, mode: 'half-from-zero' }),
		liabilities: BigDecimal.round(liabilities, { scale: 2, mode: 'half-from-zero' }),
		net_assets: BigDecimal.round(BigDecimal.subtract(total, liabilities), {
			scale: 2,
			mode: 'half-from-zero'
		}),
		unrealised_pl: BigDecimal.round(unrealised, { scale: 2, mode: 'half-from-zero' }),
		allocation: [['cash', cash] as const, ...byClass]
			.filter(([, value]) => !BigDecimal.isZero(value))
			.map(([label, value]) => ({
				label,
				value: BigDecimal.round(value, { scale: 2, mode: 'half-from-zero' }),
				weight:
					(BigDecimal.isPositive(total)
						? BigDecimal.round(
								BigDecimal.divideUnsafe(
									BigDecimal.multiply(value, BigDecimal.fromBigInt(100n)),
									total
								),
								{ scale: 1, mode: 'half-from-zero' }
							)
						: null) ?? ZERO
			}))
			.sort((a, b) => BigDecimal.Order(b.value, a.value))
	};
};
