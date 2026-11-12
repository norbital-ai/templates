import { expect, it } from '@effect/vitest';
import { dec } from '@norbital-ai/std/decimal';
import {
	parseHeadlines,
	parseQuote,
	parseRates,
	quoteSymbol
} from '../src/lib/portfolio/market.ts';
import { computeMetrics, costInBase } from '../src/lib/portfolio/book.ts';

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
		volume_ratio: 4
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

it('adds the book up: cash and facilities apart from positions', () => {
	const metrics = computeMetrics([
		{ asset_class: 'equity', value: 13000, unrealised_pl: 2000 },
		{ asset_class: 'cash', value: 3000, unrealised_pl: 0 },
		{ asset_class: 'loan', value: -2000, unrealised_pl: 0 }
	]);
	expect(metrics).toMatchObject({
		invested: 13000,
		cash: 3000,
		liabilities: 2000,
		net_assets: 14000
	});
	expect(metrics.allocation.map((one) => one.label)).toEqual(['equity', 'cash']);
	expect(
		costInBase({
			value_base: dec(1100),
			market_value: dec(1000),
			cost_value: dec(800),
			live_value_base: null
		})
	).toBe(880);
});
