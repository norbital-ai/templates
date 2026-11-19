import { BigDecimal } from 'effect';

type D = BigDecimal.BigDecimal;
const ZERO = BigDecimal.fromBigInt(0n);
const HUNDRED = BigDecimal.fromBigInt(100n);
const two = (value: D) => BigDecimal.round(value, { scale: 2, mode: 'half-from-zero' });
const decimal = (value: string) => BigDecimal.fromStringUnsafe(value);

/**
 * The statement fields of a holding the figures read. `market_value`, `cost_value` and `accrued_interest` are in the
 * line's own currency; `value_base` is the statement's value in base, at the statement's rate.
 */
export type Statement = {
	readonly currency: string;
	readonly quantity: string;
	readonly value_base: string;
	readonly market_value: string;
	readonly cost_value: string | null;
	readonly accrued_interest: string | null;
	readonly price_date: string | null;
	readonly live_value_base: string | null;
	readonly price_updated_at: string | null;
};

/** Base per unit of a currency at the run (1 for base itself); undefined when no rate was read. */
export type RateOf = (currency: string) => number | undefined;

/** The statement's own rate: base per unit of the line's currency (its base value over its local value); null for an empty line. */
const statementRate = (row: Statement): D | null =>
	BigDecimal.isZero(decimal(row.market_value))
		? null
		: BigDecimal.divideUnsafe(decimal(row.value_base), decimal(row.market_value));

/**
 * What a line is worth in base at the run, accrued interest included:
 * - quoted: quantity × the quote's price, at the run's rate of the quote's currency (a quote may be in another currency
 *   than the line: silver held as XAG is priced in USD an ounce);
 * - not quoted today but priced since its latest statement: its last priced value;
 * - otherwise its statement amount (a monthly snapshot) at the run's rate of its currency, or at the statement's own
 *   rate when no rate was read.
 */
export const lineValue = (
	row: Statement,
	quote: { readonly price: number; readonly currency: string } | null,
	rateOf: RateOf
): D => {
	const rate = rateOf(row.currency);
	const own = rate === undefined ? statementRate(row) : BigDecimal.fromNumberUnsafe(rate);
	const accrued =
		row.accrued_interest === null || own === null
			? ZERO
			: BigDecimal.multiply(decimal(row.accrued_interest), own);
	const quoted = quote === null ? undefined : rateOf(quote.currency);
	if (quote !== null && quoted !== undefined)
		return two(
			BigDecimal.sum(
				BigDecimal.multiply(
					BigDecimal.multiply(decimal(row.quantity), BigDecimal.fromNumberUnsafe(quote.price)),
					BigDecimal.fromNumberUnsafe(quoted)
				),
				accrued
			)
		);
	if (
		row.live_value_base !== null &&
		row.price_updated_at !== null &&
		(row.price_date === null || row.price_updated_at.slice(0, 10) >= row.price_date)
	)
		return decimal(row.live_value_base);
	return two(
		BigDecimal.sum(
			own === null ? decimal(row.value_base) : BigDecimal.multiply(decimal(row.market_value), own),
			accrued
		)
	);
};

/** What a line cost in base currency: its local cost at the statement's own rate. */
export const costInBase = (row: Statement): D => {
	const local = row.cost_value === null ? ZERO : decimal(row.cost_value);
	const rate = statementRate(row);
	return two(rate === null ? local : BigDecimal.multiply(local, rate));
};

/** Cash and facilities are lines of the book, but not positions to analyse. */
export const isPosition = (row: { readonly asset_class: string }) =>
	row.asset_class !== 'cash' && row.asset_class !== 'loan';

/** One line as the totals read it: its class and currency, its value now in base and its unrealised P&L in base. */
export type BookLine = {
	readonly asset_class: string;
	readonly currency: string;
	readonly value: D;
	readonly unrealised_pl: D;
};

type Share = { label: string; value: D; weight: D };
export type Metrics = {
	readonly total_assets: D;
	readonly invested: D;
	readonly cash: D;
	readonly liabilities: D;
	readonly net_assets: D;
	readonly unrealised_pl: D;
	/** By asset class and by currency, each weighed against total assets; facilities left out. */
	readonly allocation: readonly Share[];
	readonly exposure: readonly Share[];
};

/** The book's totals, allocation and currency exposure; the report and the dashboard both read these. */
export const computeMetrics = (rows: readonly BookLine[]): Metrics => {
	let cash = ZERO;
	let invested = ZERO;
	let liabilities = ZERO;
	let unrealised = ZERO;
	const byClass = new Map<string, D>();
	const byCurrency = new Map<string, D>();
	for (const row of rows) {
		if (row.asset_class === 'loan') liabilities = BigDecimal.subtract(liabilities, row.value);
		else {
			if (row.asset_class === 'cash') cash = BigDecimal.sum(cash, row.value);
			else {
				invested = BigDecimal.sum(invested, row.value);
				byClass.set(
					row.asset_class,
					BigDecimal.sum(byClass.get(row.asset_class) ?? ZERO, row.value)
				);
			}
			byCurrency.set(row.currency, BigDecimal.sum(byCurrency.get(row.currency) ?? ZERO, row.value));
		}
		unrealised = BigDecimal.sum(unrealised, row.unrealised_pl);
	}
	const total = BigDecimal.sum(cash, invested);
	const shares = (parts: Iterable<readonly [string, D]>) =>
		[...parts]
			.filter(([, value]) => !BigDecimal.isZero(value))
			.map(([label, value]) => ({
				label,
				value: two(value),
				weight: BigDecimal.isPositive(total)
					? two(BigDecimal.divideUnsafe(BigDecimal.multiply(value, HUNDRED), total))
					: ZERO
			}))
			.sort((a, b) => BigDecimal.Order(b.value, a.value));
	return {
		total_assets: two(total),
		invested: two(invested),
		cash: two(cash),
		liabilities: two(liabilities),
		net_assets: two(BigDecimal.subtract(total, liabilities)),
		unrealised_pl: two(unrealised),
		allocation: shares([['cash', cash] as const, ...byClass]),
		exposure: shares(byCurrency)
	};
};
