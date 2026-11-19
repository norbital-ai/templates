import { expect, it } from '@effect/vitest';
import {
	cite,
	parseHeadlines,
	parseQuote,
	parseRates,
	quoteSymbol,
	signalsOf
} from '../src/lib/portfolio/market.ts';
import { BigDecimal } from 'effect';
import { computeMetrics, costInBase, lineValue } from '../src/lib/portfolio/book.ts';

it('reads tickers, a quote, a rate answer and a headline feed', () => {
	expect(quoteSymbol('ACME UW')).toBe('ACME');
	expect(quoteSymbol('700 HK')).toBe('0700.HK');
	expect(quoteSymbol('0700.HK')).toBe('0700.HK');
	expect(quoteSymbol('ACME ZZ')).toBeNull();

	const chart = {
		chart: {
			result: [
				{
					meta: { regularMarketPrice: 500, previousClose: 490 },
					indicators: { quote: [{ volume: [100, 100, 100, 100, 400, 500] }] }
				}
			]
		}
	};
	expect(parseQuote(JSON.stringify(chart))).toEqual({
		price: 500,
		change_pct: 2.04,
		volume_ratio: 4,
		change_1w_pct: null,
		change_1m_pct: null,
		change_1y_pct: null,
		trend: null,
		money_flow: null,
		pressure: null,
		rsi: null,
		from_high_pct: null,
		volatility_pct: null
	});
	expect(parseQuote('not json')).toBeNull();

	const rates = parseRates(
		JSON.stringify({ result: 'success', rates: { USD: 1, EUR: 0.8 } }),
		'USD'
	);
	expect(rates.get('EUR')).toBeCloseTo(1.25, 6);
	expect(parseRates('{"result":"error"}', 'USD').size).toBe(0);

	const headlines = parseHeadlines(
		'<rss><item><title>Acme &amp; partners</title><link>https://example.com/a</link></item><item><title>ACME stock price today</title><link>https://example.com/b</link></item></rss>'
	);
	expect(headlines).toEqual([{ title: 'Acme & partners', url: 'https://example.com/a' }]);
});

const n = (value: BigDecimal.BigDecimal) =>
	Number(BigDecimal.format(BigDecimal.round(value, { scale: 2, mode: 'half-from-zero' })));
const line = (
	values: Partial<Parameters<typeof lineValue>[0]> &
		Pick<Parameters<typeof lineValue>[0], 'currency'>
): Parameters<typeof lineValue>[0] => ({
	quantity: '1',
	value_base: '0',
	market_value: '0',
	cost_value: null,
	accrued_interest: null,
	price_date: '2026-10-15',
	live_value_base: null,
	price_updated_at: null,
	...values
});

it('adds the book up in base: cash and facilities apart from positions, and each currency’s share', () => {
	const metrics = computeMetrics([
		{
			asset_class: 'equity',
			currency: 'USD',
			value: BigDecimal.fromStringUnsafe('13000'),
			unrealised_pl: BigDecimal.fromStringUnsafe('2000')
		},
		{
			asset_class: 'cash',
			currency: 'HKD',
			value: BigDecimal.fromStringUnsafe('3000'),
			unrealised_pl: BigDecimal.fromStringUnsafe('0')
		},
		{
			asset_class: 'loan',
			currency: 'USD',
			value: BigDecimal.fromStringUnsafe('-2000'),
			unrealised_pl: BigDecimal.fromStringUnsafe('0')
		}
	]);
	expect([metrics.invested, metrics.cash, metrics.liabilities, metrics.net_assets].map(n)).toEqual([
		13000, 3000, 2000, 14000
	]);
	expect(metrics.allocation.map((one) => [one.label, n(one.weight)])).toEqual([
		['equity', 81.25],
		['cash', 18.75]
	]);
	/** A facility is owed, not exposure. */
	expect(metrics.exposure.map((one) => [one.label, n(one.value)])).toEqual([
		['USD', 13000],
		['HKD', 3000]
	]);
	expect(
		n(
			costInBase(
				line({ currency: 'USD', value_base: '1100', market_value: '1000', cost_value: '800' })
			)
		)
	).toBe(880);
});

it('values a line at the run’s rates: a quote in its own currency, a statement amount revalued, accrued interest included', () => {
	/** SGD base: a dollar is worth 1.30 today; the statement valued it at 1.28. */
	const rateOf = (code: string) => ({ SGD: 1, USD: 1.3, GBP: 1.7 })[code];
	const deposit = line({
		currency: 'USD',
		market_value: '1000',
		value_base: '1280',
		accrued_interest: '10'
	});
	expect(n(lineValue(deposit, null, rateOf))).toBe(1313);
	/** No rate read for the line's currency: the statement's own rate stands. */
	expect(n(lineValue(deposit, null, () => undefined))).toBe(1292.8);
	/** Silver held as XAG, quoted in USD an ounce. */
	expect(
		n(lineValue(line({ currency: 'XAG', quantity: '100' }), { price: 45, currency: 'USD' }, rateOf))
	).toBe(5850);
	/** A London quote arrives in pence and is read in pounds. */
	const chart = {
		chart: {
			result: [
				{
					meta: { currency: 'GBp', regularMarketPrice: 250, previousClose: 200 },
					indicators: { quote: [{}] }
				}
			]
		}
	};
	expect(parseQuote(JSON.stringify(chart))).toMatchObject({
		price: 2.5,
		currency: 'GBP',
		change_pct: 25
	});
	/** Priced since its statement but not today: its last priced value; a newer statement wins over it. */
	const priced = line({
		currency: 'USD',
		market_value: '1000',
		value_base: '1280',
		live_value_base: '1500',
		price_updated_at: '2026-11-18T00:00:00.000Z'
	});
	expect(n(lineValue(priced, null, rateOf))).toBe(1500);
	expect(n(lineValue({ ...priced, price_date: '2026-11-19' }, null, rateOf))).toBe(1300);
});

it('links every cited claim to its source and drops text that cites nothing', () => {
	const sources = [
		{ title: 'Quotes', publisher: 'Yahoo Finance', url: 'https://finance.yahoo.com' },
		{ title: 'Acme wins', publisher: 'news.example', url: 'https://news.example/acme' }
	];
	expect(cite('Acme won an order, per [2].\n\nIt trades at USD 10, per [1].', sources)).toEqual({
		text: 'Acme won an order, per [news.example](https://news.example/acme).\n\nIt trades at USD 10, per [Yahoo Finance](https://finance.yahoo.com).',
		sources: [sources[1], sources[0]]
	});
	expect(cite('Acme won an order, per [2].\n\nIt will rise.', sources)).toBeNull();
	expect(cite('Acme won an order, per [3].', sources)).toBeNull();
	expect(cite('', sources)).toBeNull();
});

it('reads a year of bars: the moves, the trend, who leads, momentum and the distance from the high', () => {
	/** A year of steady gains, each close at the top of its range; then the same year falling, each close at the bottom. */
	const rising = Array.from({ length: 250 }, (_, i) => ({
		close: 100 + i,
		high: 100 + i,
		low: 98 + i,
		volume: 1000
	}));
	expect(signalsOf(349, rising)).toMatchObject({
		change_1w_pct: 1.45,
		change_1y_pct: 249,
		trend: 'up',
		money_flow: 1,
		pressure: 'buying',
		rsi: 100,
		from_high_pct: 0
	});
	expect(signalsOf(349, rising).volatility_pct).toBeGreaterThan(0);

	const falling = Array.from({ length: 250 }, (_, i) => ({
		close: 350 - i,
		high: 352 - i,
		low: 350 - i,
		volume: 1000
	}));
	expect(signalsOf(101, falling)).toMatchObject({
		trend: 'down',
		money_flow: -1,
		pressure: 'selling',
		rsi: 0,
		from_high_pct: -71.31
	});

	/** A month of bars carries no year, trend or 52-week high. */
	expect(signalsOf(129, rising.slice(0, 30))).toMatchObject({
		change_1y_pct: null,
		trend: null,
		from_high_pct: null
	});
});
