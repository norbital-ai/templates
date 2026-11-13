import { BigDecimal, Effect, Option, Schema } from 'effect';
import type { AutomationCtx } from '@norbital-ai/bolt';

/** Free, keyless sources the daily agent reads over plain HTTP. */
export const RATES_URL = (base: string) => `https://open.er-api.com/v6/latest/${base}`;
export const QUOTE_URL = (ticker: string) =>
	`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`;
export const NEWS_URL = (query: string) =>
	`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;

/** A source a claim cites: what was read, who published it, where, and when the agent read it. */
export type Source = { readonly title: string; readonly publisher: string; readonly url: string };
/** The providers market figures cite: quotes and exchange rates. */
export const QUOTE_SOURCE: Source = {
	title: 'Quotes',
	publisher: 'Yahoo Finance',
	url: 'https://finance.yahoo.com'
};
export const RATES_SOURCE: Source = {
	title: 'Exchange rates',
	publisher: 'ExchangeRate-API',
	url: 'https://www.exchangerate-api.com'
};
/** A read page as a source: its publisher is the site's host. */
export const sourceOf = (read: Read): Source => ({
	title: read.label,
	publisher: (read.url.split('/')[2] ?? read.url).replace(/^www\./, ''),
	url: read.url
});
/** The numbered list a prompt shows: the model cites a source as `[n]`. */
export const numbered = (sources: readonly Source[]) =>
	sources.map((one, index) => `[${index + 1}] ${one.publisher}: ${one.title}`).join('\n') ||
	'- none';

/**
 * A model's text with every `[n]` turned into a link to its source (publisher as link text), and the sources it cites;
 * null when any paragraph cites nothing or a marker names no source, so an uncited claim is dropped, never printed.
 */
export const cite = (text: string, sources: readonly Source[]) => {
	const paragraphs = text
		.split(/\n\s*\n/)
		.map((one) => one.trim())
		.filter((one) => one.length > 0);
	const used = new Set<Source>();
	const linked: string[] = [];
	for (const paragraph of paragraphs) {
		const marked = [...paragraph.matchAll(/\[(\d+)\]/g)].map((one) => sources[Number(one[1]) - 1]);
		if (marked.length === 0) return null;
		for (const one of marked) {
			if (one === undefined) return null;
			used.add(one);
		}
		linked.push(
			paragraph.replace(/\[(\d+)\]/g, (marker, n: string) => {
				const one = sources[Number(n) - 1];
				return one ? `[${one.publisher}](${one.url.replace(/\)/g, '%29')})` : marker;
			})
		);
	}
	return linked.length === 0 ? null : { text: linked.join('\n\n'), sources: [...used] };
};
/** Markdown links as their text alone: a chat message shows no markup. */
export const unlinked = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

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
		change_pct: previous
			? BigDecimal.toNumberUnsafe(
					BigDecimal.round(BigDecimal.fromNumberUnsafe(((price - previous) / previous) * 100), {
						scale: 2,
						mode: 'half-ceil'
					})
				)
			: null,
		volume_ratio:
			volume !== undefined && average > 0
				? BigDecimal.toNumberUnsafe(
						BigDecimal.round(BigDecimal.fromNumberUnsafe(volume / average), {
							scale: 2,
							mode: 'half-ceil'
						})
					)
				: null
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

/** What the agent read: a search result, a headline or a stored source, with its readable text when it has one. */
export type Read = { readonly label: string; readonly url: string; readonly text: string };
/** The run's browser tab, falling back to a plain web read where the browser cannot open a page. */
export type Reader = {
	readonly browser: Pick<AutomationCtx['browser'], 'navigate' | 'evaluate'>;
	readonly web: AutomationCtx['web'];
};

const clip = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 1800);

/** One page's readable text: as the browser renders it, else as a plain read; none when neither answers. */
export const readPage = (reader: Reader, url: string) =>
	reader.browser.navigate(url).pipe(
		Effect.catch(() => reader.web.read(url)),
		Effect.map((page) => clip(page.text)),
		Effect.option,
		Effect.map(Option.filter((text) => text.length > 0))
	);

/** The search pages a query's results are read from, each with the selector of its result links. */
const ENGINES = [
	{ name: 'bing', url: 'https://www.bing.com/search?q=', selector: 'li.b_algo h2 a' },
	{ name: 'duckduckgo', url: 'https://html.duckduckgo.com/html/?q=', selector: 'a.result__a' },
	{ name: 'mojeek', url: 'https://www.mojeek.com/search?q=', selector: 'ul.results-standard h2 a' }
] as const;
const decodeLinks = Schema.decodeUnknownOption(
	Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String }))
);

/**
 * A query searched in the browser and its first `keep` results read: the first engine whose results read. Without a
 * browser it answers nothing at once, and the caller keeps its other sources. `log` records each step.
 */
export const search = Effect.fnUntraced(function* (
	reader: Reader,
	query: string,
	keep: number,
	log: string[]
) {
	for (const engine of ENGINES) {
		const opened = yield* reader.browser.navigate(`${engine.url}${encodeURIComponent(query)}`).pipe(
			Effect.as('open' as const),
			Effect.catchTag('Unavailable', () => Effect.succeed('no browser' as const)),
			Effect.catchTag('FacilityFailure', () => Effect.succeed('failed' as const))
		);
		if (opened === 'no browser') {
			log.push(`search "${query}": no browser`);
			return [];
		}
		const found =
			opened === 'failed'
				? Option.none()
				: yield* reader.browser
						.evaluate(
							`Array.from(document.querySelectorAll(${JSON.stringify(engine.selector)})).slice(0, ${keep}).map((a) => ({ title: (a.textContent || '').trim(), url: a.href }))`
						)
						.pipe(Effect.option, Effect.map(Option.flatMap(decodeLinks)));
		const links = Option.getOrElse(found, () => []).filter(
			(one) => one.title.length > 0 && one.url.startsWith('http')
		);
		log.push(`search ${engine.name} "${query}": ${links.length} result(s)`);
		const pages: Read[] = [];
		for (const link of links) {
			const text = yield* readPage(reader, link.url);
			log.push(
				`  ${link.url}: ${Option.isSome(text) ? `${text.value.length} characters` : 'nothing readable'}`
			);
			if (Option.isSome(text)) pages.push({ label: link.title, url: link.url, text: text.value });
		}
		if (pages.length > 0) return pages;
	}
	return [];
});
