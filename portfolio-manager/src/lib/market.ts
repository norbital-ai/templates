import { Option, Schema } from 'effect';

/** Free, keyless sources the daily agent reads over plain HTTP. */
export const RATES_URL = (base: string) => `https://open.er-api.com/v6/latest/${base}`;
export const QUOTE_URL = (ticker: string) =>
	`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`;
export const NEWS_URL = (query: string) =>
	`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;

/**
 * What one unit of each currency is worth in `base`. The source quotes the base against everything,
 * so each is inverted. An unreadable answer is an empty map: the caller keeps its recorded values.
 */
const decodeRates = Schema.decodeUnknownOption(
	Schema.fromJsonString(
		Schema.Struct({ result: Schema.String, rates: Schema.Record(Schema.String, Schema.Number) })
	)
);
export const parseRates = (payload: string, base: string): ReadonlyMap<string, number> => {
	const body = decodeRates(payload);
	const rates = new Map<string, number>();
	if (Option.isNone(body) || body.value.result !== 'success') return rates;
	for (const [code, quoted] of Object.entries(body.value.rates))
		if (quoted > 0) rates.set(code.toUpperCase(), 1 / quoted);
	rates.set(base.toUpperCase(), 1);
	return rates;
};

/** A held ticker as the quote source names it: Bloomberg-style "AAPL UW" or "700 HK" gets a market suffix. */
export const quoteSymbol = (symbol: string): string | null => {
	const [ticker, exchange, ...rest] = symbol.trim().toUpperCase().split(/\s+/);
	if (!ticker || rest.length > 0) return null;
	if (exchange === undefined) return ticker;
	if (exchange === 'HK') return `${ticker.padStart(4, '0')}.HK`;
	if (exchange === 'SP') return `${ticker}.SI`;
	if (exchange === 'LN') return `${ticker}.L`;
	if (/^U[ANPQRSW]$/.test(exchange)) return ticker;
	return null;
};

export type Quote = {
	readonly price: number;
	readonly change_pct: number | null;
	readonly volume_ratio: number | null;
};

const Series = Schema.Array(Schema.NullOr(Schema.Number));
const Chart = Schema.Struct({
	chart: Schema.Struct({
		result: Schema.Array(
			Schema.Struct({
				meta: Schema.Struct({
					regularMarketPrice: Schema.optionalKey(Schema.Number),
					previousClose: Schema.optionalKey(Schema.Number)
				}),
				indicators: Schema.Struct({
					quote: Schema.Array(
						Schema.Struct({ close: Schema.optionalKey(Series), volume: Schema.optionalKey(Series) })
					)
				})
			})
		)
	})
});
const decodeChart = Schema.decodeUnknownOption(Schema.fromJsonString(Chart));
const positive = (values: readonly (number | null)[] | undefined) =>
	(values ?? []).filter((one): one is number => one !== null && one > 0);
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The last price, its change on the day, and the last complete session's volume against the twenty
 * before it, from a chart answer; null when unreadable.
 */
export const parseQuote = (payload: string): Quote | null => {
	const body = decodeChart(payload);
	const result = Option.isSome(body) ? body.value.chart.result[0] : undefined;
	if (!result) return null;
	const series = result.indicators.quote[0];
	const closes = positive(series?.close);
	const price = result.meta.regularMarketPrice ?? closes.at(-1);
	if (price === undefined || price <= 0) return null;
	const previous = result.meta.previousClose ?? closes.at(-2);
	/** The last bar may be a partial session: measure the last complete one. */
	const volumes = positive(series?.volume).slice(0, -1);
	const volume = volumes.at(-1);
	const prior = volumes.slice(0, -1).slice(-20);
	const average = prior.length > 0 ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
	return {
		price,
		change_pct: previous ? round2(((price - previous) / previous) * 100) : null,
		volume_ratio: volume !== undefined && average > 0 ? round2(volume / average) : null
	};
};

/** How busy a line traded, from its volume against its average. */
export const movementOf = (ratio: number | null) =>
	ratio === null
		? null
		: ratio >= 2
			? 'surge'
			: ratio >= 1.3
				? 'active'
				: ratio <= 0.5
					? 'quiet'
					: 'normal';

export type Headline = { readonly title: string; readonly url: string };

const decodeEntities = (value: string) =>
	value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();

/** The first headlines of an RSS answer with their links; quote and chart pages carry no news. */
export const parseHeadlines = (payload: string, limit = 4): Headline[] =>
	(payload.match(/<item>[\s\S]*?<\/item>/g) ?? [])
		.map((item) => ({
			title: decodeEntities(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
			url: decodeEntities(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '')
		}))
		.filter(
			(one) =>
				one.title.length > 0 &&
				one.url.startsWith('http') &&
				!/stock (price|quote|chart)|quote and history/i.test(one.title)
		)
		.slice(0, limit);
