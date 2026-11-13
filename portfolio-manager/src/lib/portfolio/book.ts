import { BigDecimal } from 'effect';

type D = BigDecimal.BigDecimal;
const ZERO = BigDecimal.fromBigInt(0n);
const HUNDRED = BigDecimal.fromBigInt(100n);

/** A stored decimal (a field's string) to compute with. */
export const dec = (value: string): D => BigDecimal.fromStringUnsafe(value);
/** A figure read as a number (a quote, a rate) to compute with. */
export const num = (value: number): D => BigDecimal.fromNumberUnsafe(value);
/** A figure rounded half away from zero to `scale` places. */
export const round = (value: D, scale = 2): D =>
	BigDecimal.round(value, { scale, mode: 'half-from-zero' });
/** A figure as the string a decimal field stores, at `scale` places. */
export const stored = (value: D, scale = 2): string => BigDecimal.format(round(value, scale));
/** A figure for prose: two places, thousands grouped. */
export const money = (value: D): string =>
	BigDecimal.toNumberUnsafe(round(value)).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
/** `part` as a percentage of `whole`, or null when the whole is not positive. */
export const percent = (part: D, whole: D, scale = 2): D | null =>
	BigDecimal.isPositive(whole)
		? round(BigDecimal.divideUnsafe(BigDecimal.multiply(part, HUNDRED), whole), scale)
		: null;

/** The statement fields of a holding the figures read. */
export type Statement = {
	readonly value_base: string;
	readonly market_value: string;
	readonly cost_value: string | null;
	readonly live_value_base: string | null;
};

/** What a line is worth now: its calculated value once the agent priced it, else the statement's. */
export const lineValue = (row: Statement): D => dec(row.live_value_base ?? row.value_base);

/** What a line cost in base currency: its local cost at the statement's own rate. */
export const costInBase = (row: Statement): D => {
	const local = row.cost_value === null ? ZERO : dec(row.cost_value);
	const market = dec(row.market_value);
	const base = dec(row.value_base);
	return round(
		BigDecimal.isPositive(market) && BigDecimal.isPositive(base)
			? BigDecimal.divideUnsafe(BigDecimal.multiply(local, base), market)
			: local
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
		total_assets: round(total),
		invested: round(invested),
		cash: round(cash),
		liabilities: round(liabilities),
		net_assets: round(BigDecimal.subtract(total, liabilities)),
		unrealised_pl: round(unrealised),
		allocation: [['cash', cash] as const, ...byClass]
			.filter(([, value]) => !BigDecimal.isZero(value))
			.map(([label, value]) => ({
				label,
				value: round(value),
				weight: percent(value, total, 1) ?? ZERO
			}))
			.sort((a, b) => BigDecimal.Order(b.value, a.value))
	};
};
