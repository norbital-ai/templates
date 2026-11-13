import { expect, it } from '@effect/vitest';
import {
	cite,
	parseHeadlines,
	parseQuote,
	parseRates,
	quoteSymbol
} from '../src/lib/portfolio/market.ts';
import { computeMetrics, costInBase, dec, stored } from '../src/lib/portfolio/book.ts';

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
		{ asset_class: 'equity', value: dec('13000'), unrealised_pl: dec('2000') },
		{ asset_class: 'cash', value: dec('3000'), unrealised_pl: dec('0') },
		{ asset_class: 'loan', value: dec('-2000'), unrealised_pl: dec('0') }
	]);
	expect(
		[metrics.invested, metrics.cash, metrics.liabilities, metrics.net_assets].map((one) =>
			Number(stored(one))
		)
	).toEqual([13000, 3000, 2000, 14000]);
	expect(metrics.allocation.map((one) => Number(stored(one.weight, 1)))).toEqual([81.3, 18.8]);
	expect(metrics.allocation.map((one) => one.label)).toEqual(['equity', 'cash']);
	const cost = costInBase({
		value_base: '1100',
		market_value: '1000',
		cost_value: '800',
		live_value_base: null
	});
	expect(Number(stored(cost))).toBe(880);
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
