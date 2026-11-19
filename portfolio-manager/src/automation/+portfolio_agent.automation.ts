import { BigDecimal, DateTime, Effect, Option } from 'effect';
import { automation, is_instance, type CreateInput } from '@norbital-ai/bolt';
import {
	NEWS_URL,
	QUOTE_URL,
	RATES_URL,
	movementOf,
	parseHeadlines,
	parseQuote,
	parseRates,
	QUOTE_SOURCE,
	RATES_SOURCE,
	cite,
	numbered,
	quoteSymbol,
	readPage,
	search,
	sourceOf,
	unlinked,
	type Quote,
	type Read,
	type Source
} from '../lib/portfolio/market.ts';
import { computeMetrics, costInBase, isPosition, lineValue } from '../lib/portfolio/book.ts';

/** How many dated P&L entries a line keeps, and how many of the largest lines are researched. */
const PNL_DAYS = 90;
const RESEARCHED = 6;
/** The base currency of a workspace with no `portfolio_settings` row. */
const DEFAULT_CURRENCY = 'USD';
/** How the report is written: the model's instructions and the agent brief carry the same rules. */
const WRITING = [
	'1. Plain words. Short sentences. Plain prose, no lists, no markdown.',
	'2. No hype, no jokes, no filler, no repetition.',
	'3. Every number carries its unit, and its date where it has one.',
	'4. Every claim cites its source inline as "per [n]", n from the numbered sources. Leave out any claim you cannot cite.',
	'5. Cut anything that does not change a decision on this book.',
	'6. Never invent a figure, a headline or a source.'
].join('\n');

/** A figure as the stored decimal, two places; null stays null. */
const fixed = (value: number | null) =>
	value === null
		? null
		: BigDecimal.format(
				BigDecimal.round(BigDecimal.fromNumberUnsafe(value), { scale: 2, mode: 'half-from-zero' })
			);
/** The signals as stored on a holding and a markets row. */
const signals = (quote: Quote) => ({
	change_1w_pct: fixed(quote.change_1w_pct),
	change_1m_pct: fixed(quote.change_1m_pct),
	change_1y_pct: fixed(quote.change_1y_pct),
	trend: quote.trend,
	money_flow: fixed(quote.money_flow),
	pressure: quote.pressure,
	rsi: fixed(quote.rsi),
	from_high_pct: fixed(quote.from_high_pct),
	volatility_pct: fixed(quote.volatility_pct)
});
/** The trading in words for the model: only what the bars carried. */
const tradingOf = (quote: Quote) =>
	[
		quote.change_pct === null ? '' : `day ${quote.change_pct}%`,
		quote.change_1w_pct === null ? '' : `week ${quote.change_1w_pct}%`,
		quote.change_1m_pct === null ? '' : `month ${quote.change_1m_pct}%`,
		quote.change_1y_pct === null ? '' : `year ${quote.change_1y_pct}%`,
		quote.trend === null
			? ''
			: `trend ${quote.trend} (price and 50-session average against the 200-session average)`,
		quote.money_flow === null
			? ''
			: `20-session money flow ${quote.money_flow} (${quote.pressure} pressure)`,
		quote.volume_ratio === null ? '' : `volume ${quote.volume_ratio}x its 20-session average`,
		quote.rsi === null ? '' : `RSI(14) ${quote.rsi}`,
		quote.from_high_pct === null ? '' : `${quote.from_high_pct}% from the 52-week high`,
		quote.volatility_pct === null ? '' : `volatility ${quote.volatility_pct}% a year`
	]
		.filter((part) => part.length > 0)
		.join(', ');

/**
 * The one agent. Once a day it prices the book, measures each line's trading, files each line's P&L for the day,
 * researches the market and the largest lines in its browser, asks the model for the market view and one call per
 * position, files the day's report and sends it to every subscriber through the envoy's accounts.
 */
export default automation({
	description:
		'Once a day: prices the book and its benchmarks, files each line’s P&L, researches the market and the largest lines in its browser, writes the day’s report with every claim cited (a section per line with cited news), and sends its record view as a PDF to every subscriber through the accounts an envoy is deployed on.',
	input: { send: { kind: 'bool', optional: true, default: true } },
	on: [{ cron: '0 8 * * *' }],
	policies: ['portfolio_automation'],
	run: function* (input, ctx) {
		const log: string[] = [];
		const read = (url: string, raw = false) => ctx.web.read(url, { raw }).pipe(Effect.option);

		const { holding, portfolio_settings, report_subscription } = yield* ctx.query({
			holding: { order_by: { value_base: 'desc' }, limit: 200 },
			portfolio_settings: { limit: 2 },
			report_subscription: { fields: ['user'], limit: 1000 }
		});
		if (portfolio_settings.rows.length > 1) return yield* ctx.refuse('errors.settings_ambiguous');
		const settings = portfolio_settings.rows[0];
		const base = settings?.base_currency ?? DEFAULT_CURRENCY;
		const subscribers = input.send === false ? [] : report_subscription.rows.map((one) => one.user);
		if (holding.rows.length === 0) return;
		/** The chat accounts an envoy is deployed on: the report reaches each subscriber's own handle there. */
		const { sys_integration } = yield* ctx.query({
			sys_integration: { where: { envoy: { is_null: false }, active: { eq: true } }, limit: 20 }
		});
		const via = sys_integration.rows.flatMap((one) =>
			is_instance('whatsapp', one) ||
			is_instance('telegram', one) ||
			is_instance('slack', one) ||
			is_instance('discord', one)
				? [one.id]
				: []
		);
		if (subscribers.length > 0)
			log.push(
				via.length === 0
					? `${subscribers.length} subscriber(s) notified in the app only: no envoy is deployed on a chat account`
					: `${subscribers.length} subscriber(s) sent through ${via.length} envoy account(s)`
			);

		const ratesPage = yield* read(RATES_URL(base));
		const rates = Option.match(ratesPage, {
			onNone: () => new Map<string, number>(),
			onSome: (page) => parseRates(page.text, base)
		});
		log.push(`rates ${base}: ${rates.size > 0 ? `${rates.size} currencies` : 'did not answer'}`);

		/** Each tickered line priced from the market; the rest keep their last values. */
		type Live = ReturnType<typeof signals> & {
			live_price: string;
			live_change_pct: string | null;
			live_value_base: string;
			price_updated_at: typeof ctx.now;
			volume_ratio: string | null;
			movement: ReturnType<typeof movementOf>;
		};
		const book: {
			row: (typeof holding.rows)[number];
			quote: Quote | null;
			live: Live | null;
			value: BigDecimal.BigDecimal;
		}[] = [];
		/** Base per unit of a currency at this run; base itself is 1. */
		const rateOf = (code: string) => (code === base ? 1 : rates.get(code));
		for (const row of holding.rows) {
			const ticker = row.symbol ? quoteSymbol(row.symbol) : null;
			const page = ticker ? yield* read(QUOTE_URL(ticker)) : Option.none();
			const quote = Option.isSome(page) ? parseQuote(page.value.text) : null;
			if (ticker) log.push(`quote ${ticker}: ${quote ? quote.price : 'no answer'}`);
			const valued =
				quote === null ? null : { price: quote.price, currency: quote.currency ?? row.currency };
			const value = lineValue(row, valued, rateOf);
			/** A quote counts once its currency has a rate: then the line is priced at it. */
			const live: Live | null =
				quote && valued && rateOf(valued.currency) !== undefined
					? {
							live_price: BigDecimal.format(
								BigDecimal.round(BigDecimal.fromNumberUnsafe(quote.price), {
									scale: 4,
									mode: 'half-from-zero'
								})
							),
							live_change_pct:
								quote.change_pct === null
									? null
									: BigDecimal.format(
											BigDecimal.round(BigDecimal.fromNumberUnsafe(quote.change_pct), {
												scale: 2,
												mode: 'half-from-zero'
											})
										),
							live_value_base: BigDecimal.format(
								BigDecimal.round(value, { scale: 2, mode: 'half-from-zero' })
							),
							price_updated_at: ctx.now,
							volume_ratio:
								quote.volume_ratio === null
									? null
									: BigDecimal.format(
											BigDecimal.round(BigDecimal.fromNumberUnsafe(quote.volume_ratio), {
												scale: 2,
												mode: 'half-from-zero'
											})
										),
							movement: movementOf(quote.volume_ratio),
							...signals(quote)
						}
					: null;
			book.push({ row, quote, live, value });
		}
		/** Unrealised P&L in base: each position's value now less its cost; cash and facilities carry none. */
		const metrics = computeMetrics(
			book.map(({ row, value }) => ({
				asset_class: row.asset_class,
				currency: row.currency,
				value,
				unrealised_pl: isPosition(row)
					? BigDecimal.subtract(value, costInBase(row))
					: BigDecimal.fromBigInt(0n)
			}))
		);

		/**
		 * The market and the largest positions, searched in the browser; a line the browser finds nothing on falls back to
		 * its news feed. Each line's stored sources are read too.
		 */
		const market = yield* search(ctx, 'stock market today', 3, log);
		const reads = new Map<string, Read[]>();
		for (const { row } of book.filter(({ row }) => isPosition(row)).slice(0, RESEARCHED)) {
			const name = row.symbol ?? row.instrument;
			const pages = yield* search(ctx, `${name} stock news`, 2, log);
			if (pages.length === 0) {
				const feed = yield* read(NEWS_URL(`${name} stock`), true);
				const headlines = Option.match(feed, {
					onNone: () => [],
					onSome: (page) => parseHeadlines(page.html ?? page.text)
				});
				log.push(`news ${name}: ${headlines.length} item(s)`);
				pages.push(...headlines.map((one) => ({ label: one.title, url: one.url, text: '' })));
			}
			for (const source of row.sources ?? []) {
				const text = yield* readPage(ctx, source.url);
				log.push(
					`source ${source.label}: ${Option.isSome(text) ? `${text.value.length} characters` : 'nothing readable'}`
				);
				if (Option.isSome(text))
					pages.push({ label: source.label, url: source.url, text: text.value });
			}
			reads.set(row.id, pages);
		}

		/**
		 * One section per material line: a line the agent read something on gets a call, kept only when every paragraph
		 * cites what was read; an uncited answer is dropped. Every line takes its price read and its P&L for the day.
		 */
		const sections = [];
		const cited: Source[] = [];
		const writes = [];
		for (const { row, quote, live, value } of book) {
			if (!isPosition(row)) {
				if (live) writes.push({ target: row, set: live });
				continue;
			}
			const cost = costInBase(row);
			const pnl = BigDecimal.round(BigDecimal.subtract(value, cost), {
				scale: 2,
				mode: 'half-from-zero'
			});
			const pnl_pct = BigDecimal.isPositive(cost)
				? BigDecimal.round(
						BigDecimal.divideUnsafe(BigDecimal.multiply(pnl, BigDecimal.fromBigInt(100n)), cost),
						{ scale: 2, mode: 'half-from-zero' }
					)
				: null;
			const pages = reads.get(row.id) ?? [];
			const name = row.symbol ?? row.instrument;
			const sources = [QUOTE_SOURCE, ...pages.map(sourceOf)];
			const call =
				pages.length === 0
					? null
					: Option.getOrNull(
							yield* ctx.ai.sys_2
								.infer({
									label: name,
									system: `You write one short section on one holding for the owner of the book.\n${WRITING}`,
									prompt: [
										`Today is ${ctx.today}. The book is valued in ${base}.`,
										`Holding: ${row.instrument} (${row.symbol ?? 'no ticker'}), ${row.asset_class}, ${row.currency}.`,
										`Per [1]: cost ${base} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(cost, { scale: 2, mode: 'half-from-zero' })))}, worth ${base} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(value, { scale: 2, mode: 'half-from-zero' })))}, P&L ${base} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(pnl, { scale: 2, mode: 'half-from-zero' })))}${pnl_pct === null ? '' : ` (${BigDecimal.format(pnl_pct)}%)`}.`,
										quote ? `Per [1], the trading: ${tradingOf(quote)}.` : '',
										row.research_direction ? `Research direction: ${row.research_direction}.` : '',
										'Sources:',
										`[1] ${QUOTE_SOURCE.publisher}: ${QUOTE_SOURCE.title}`,
										...pages.map(
											(one, index) =>
												`[${index + 2}] ${sourceOf(one).publisher}: ${one.label}${one.text ? ` — ${one.text.slice(0, 900)}` : ''}`
										),
										'headline: a plain headline. happened: one paragraph on what happened. matters: one paragraph on why it matters for this book. reason: one or two sentences behind the call. happened, matters and reason each cite at least one source as [n].'
									]
										.filter((part) => part.length > 0)
										.join('\n'),
									output: {
										kind: 'object',
										fields: {
											headline: { kind: 'text' },
											happened: { kind: 'text' },
											matters: { kind: 'text' },
											call: { kind: 'enum', values: ['buy', 'sell', 'hold', 'watch'] },
											reason: { kind: 'text' },
											confidence: { kind: 'decimal', scale: 2, optional: true }
										}
									}
								})
								.pipe(Effect.option)
						);
			const happened = call && cite(call.happened, sources);
			const matters = call && cite(call.matters, sources);
			const reason = call && cite(call.reason, sources);
			const section =
				call && happened && matters && reason
					? {
							instrument: row.instrument,
							symbol: row.symbol,
							weight: BigDecimal.format(
								BigDecimal.round(
									(BigDecimal.isPositive(metrics.total_assets)
										? BigDecimal.round(
												BigDecimal.divideUnsafe(
													BigDecimal.multiply(value, BigDecimal.fromBigInt(100n)),
													metrics.total_assets
												),
												{ scale: 2, mode: 'half-from-zero' }
											)
										: null) ?? BigDecimal.fromBigInt(0n),
									{ scale: 2, mode: 'half-from-zero' }
								)
							),
							change_pct: live ? live.live_change_pct : row.live_change_pct,
							call: call.call,
							headline: call.headline,
							analysis: [
								`**What happened:** ${happened.text}`,
								`**Why it matters for the book:** ${matters.text}`,
								`**Call:** ${call.call.toUpperCase()}. ${reason.text}`
							].join('\n\n'),
							confidence: call.confidence ?? null,
							pnl: BigDecimal.format(BigDecimal.round(pnl, { scale: 2, mode: 'half-from-zero' })),
							pnl_pct:
								pnl_pct === null
									? null
									: BigDecimal.format(
											BigDecimal.round(pnl_pct, { scale: 2, mode: 'half-from-zero' })
										)
						}
					: null;
			log.push(
				`model ${name}: ${pages.length === 0 ? 'nothing read' : call === null ? 'no answer' : section ? call.call : 'dropped, uncited'}`
			);
			if (section && happened && matters && reason) {
				sections.push(section);
				cited.push(...happened.sources, ...matters.sources, ...reason.sources);
			}
			writes.push({
				target: row,
				set: {
					...live,
					pnl_history: [
						...(row.pnl_history ?? []).filter((entry) => entry.date !== ctx.today),
						{
							date: ctx.today,
							pnl: BigDecimal.format(BigDecimal.round(pnl, { scale: 2, mode: 'half-from-zero' })),
							pnl_pct:
								pnl_pct === null
									? null
									: BigDecimal.format(
											BigDecimal.round(pnl_pct, { scale: 2, mode: 'half-from-zero' })
										)
						}
					]
						.sort((a, b) => a.date.localeCompare(b.date))
						.slice(-PNL_DAYS),
					...(pages.length > 0
						? {
								research_summary: section ? section.analysis : row.research_summary,
								research_at: ctx.now,
								insights: pages.slice(0, 6).map((one) => ({
									headline: one.label.slice(0, 300),
									source_name: sourceOf(one).publisher,
									url: one.url
								}))
							}
						: {})
				}
			});
		}
		if (writes.length > 0) yield* ctx.act({ 'holding.update': writes });

		/** A markets row: the price, the move over a day, a week, a month and a year, the trend and the pressure. */
		const marketRow = (instrument: string, quote: Quote) => ({
			instrument,
			level: fixed(quote.price) ?? '0',
			change_pct: fixed(quote.change_pct),
			change_1w_pct: fixed(quote.change_1w_pct),
			change_1m_pct: fixed(quote.change_1m_pct),
			change_1y_pct: fixed(quote.change_1y_pct),
			trend: quote.trend,
			pressure: quote.pressure
		});
		/** The benchmarks the settings name, quoted like the book's lines; one that does not answer is left out. */
		const benchmarks = [];
		for (const one of settings?.benchmarks ?? []) {
			const page = yield* read(QUOTE_URL(one.symbol));
			const quote = Option.isSome(page) ? parseQuote(page.value.text) : null;
			log.push(`benchmark ${one.symbol}: ${quote ? quote.price : 'no answer'}`);
			if (quote) benchmarks.push(marketRow(one.name ?? one.symbol, quote));
		}
		/** The benchmarks, then every quoted line of the book. */
		const markets = [
			...benchmarks,
			...book.flatMap(({ row, quote }) => (quote ? [marketRow(row.instrument, quote)] : []))
		];
		const quoted = markets.length > 0;
		const asOf = DateTime.format(DateTime.makeZonedUnsafe(ctx.now, { timeZone: ctx.tz }), {
			locale: 'en-US',
			timeZone: ctx.tz,
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short'
		});
		/** The latest statement the book stands on: lines without a quote keep its amounts, revalued at today's rates. */
		const statement = holding.rows
			.flatMap((one) => (one.price_date === null ? [] : [one.price_date]))
			.sort()
			.at(-1);
		const dataLine = [
			`Data as of ${asOf}`,
			statement === undefined ? '' : `; holdings per the statement of ${statement}`,
			quoted
				? `; prices per [${QUOTE_SOURCE.publisher}](${QUOTE_SOURCE.url})`
				: '; no quote answered',
			rates.size > 0
				? `; rates per [${RATES_SOURCE.publisher}](${RATES_SOURCE.url})`
				: `; no rate answered, so lines stand at the statement's rates`,
			'.'
		].join('');

		const { report } = yield* ctx.query({
			report: {
				where: { for_date: { lte: ctx.today } },
				order_by: { for_date: 'desc' },
				limit: 2
			}
		});
		const existing = report.rows.find((one) => one.for_date === ctx.today);
		const previous = report.rows.find((one) => one.for_date !== ctx.today);
		const dayChange = previous
			? BigDecimal.round(
					BigDecimal.subtract(metrics.net_assets, BigDecimal.fromStringUnsafe(previous.net_assets)),
					{ scale: 2, mode: 'half-from-zero' }
				)
			: null;
		const totals = `net assets ${base} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(metrics.net_assets, { scale: 2, mode: 'half-from-zero' })))}${dayChange === null ? '' : ` (${BigDecimal.isNegative(dayChange) ? '' : '+'}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(dayChange, { scale: 2, mode: 'half-from-zero' })))} since ${previous?.for_date})`}`;

		/** The lead and the market paragraph, cited from the market reads, the providers and the sections' sources. */
		const leadSources = [
			...new Set([QUOTE_SOURCE, RATES_SOURCE, ...market.map(sourceOf), ...cited])
		];
		const view = Option.getOrNull(
			yield* ctx.ai.sys_2
				.infer({
					label: 'lead',
					system: `You write the lead and the market paragraph of a daily portfolio report for the owner of the book.\n${WRITING}`,
					prompt: [
						`Today is ${ctx.today}. Per [1] and [2]: ${totals}; invested ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(metrics.invested, { scale: 2, mode: 'half-from-zero' })))}, cash ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(metrics.cash, { scale: 2, mode: 'half-from-zero' })))}, owed ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(BigDecimal.toNumberUnsafe(BigDecimal.round(metrics.liabilities, { scale: 2, mode: 'half-from-zero' })))}.`,
						`Per [1]: ${markets.map((one) => `${one.instrument} ${one.change_pct === null ? 'no change read' : `${one.change_pct}% on the day`}${one.change_1m_pct === null ? '' : `, ${one.change_1m_pct}% on the month`}${one.trend === null ? '' : `, trend ${one.trend}`}${one.pressure === null ? '' : `, ${one.pressure} pressure`}`).join('; ')}.`,
						'Sections in this report:',
						sections
							.map((one) => `- ${one.symbol ?? one.instrument}: ${one.headline}`)
							.join('\n') || '- none',
						'What the agent read on the market:',
						market.map((one) => `- ${one.label}: ${one.text.slice(0, 1200)}`).join('\n') ||
							'- nothing',
						'Sources:',
						numbered(leadSources),
						'lead: one sentence, the single most important thing for this book today. market: one short paragraph explaining the move. Both cite at least one source as [n].'
					].join('\n'),
					output: { kind: 'object', fields: { lead: { kind: 'text' }, market: { kind: 'text' } } }
				})
				.pipe(Effect.option)
		);
		const lead = view && cite(view.lead, leadSources);
		const move = view && cite(view.market, leadSources);
		log.push(
			`model lead: ${view === null ? 'no answer' : `${lead ? 'cited' : 'dropped, uncited'}; market ${move ? 'cited' : 'dropped, uncited'}`}`
		);
		const headline =
			lead?.text ??
			`${totals.charAt(0).toUpperCase()}${totals.slice(1)}${quoted ? `, per [${QUOTE_SOURCE.publisher}](${QUOTE_SOURCE.url})` : ''}.`;
		const summary = [
			`- Markets: ${totals}`,
			...sections.slice(0, 3).map((one) => `- ${one.symbol ?? one.instrument}: ${one.headline}`)
		].join('\n');
		const title = `Portfolio report · ${ctx.today}`;
		const sources = [
			...new Map(
				[...cited, ...(lead?.sources ?? []), ...(move?.sources ?? [])].map((one) => [
					one.url,
					{ ...one, at: ctx.now }
				])
			).values()
		];

		const filed: Omit<CreateInput<'report'>, 'for_date'> = {
			base_currency: base,
			headline,
			summary,
			markets,
			market_view: [dataLine, move?.text ?? ''].filter((part) => part.length > 0).join('\n\n'),
			research_log: log.join('\n').slice(0, 8000),
			net_assets: BigDecimal.format(
				BigDecimal.round(metrics.net_assets, { scale: 2, mode: 'half-from-zero' })
			),
			invested: BigDecimal.format(
				BigDecimal.round(metrics.invested, { scale: 2, mode: 'half-from-zero' })
			),
			cash: BigDecimal.format(BigDecimal.round(metrics.cash, { scale: 2, mode: 'half-from-zero' })),
			liabilities: BigDecimal.format(
				BigDecimal.round(metrics.liabilities, { scale: 2, mode: 'half-from-zero' })
			),
			unrealised_pl: BigDecimal.format(
				BigDecimal.round(metrics.unrealised_pl, { scale: 2, mode: 'half-from-zero' })
			),
			day_change:
				dayChange === null
					? null
					: BigDecimal.format(BigDecimal.round(dayChange, { scale: 2, mode: 'half-from-zero' })),
			allocation: metrics.allocation.map((one) => ({
				label: one.label,
				value: BigDecimal.format(BigDecimal.round(one.value, { scale: 2, mode: 'half-from-zero' })),
				weight: BigDecimal.format(
					BigDecimal.round(one.weight, { scale: 2, mode: 'half-from-zero' })
				)
			})),
			exposure: metrics.exposure.map((one) => ({
				currency: one.label,
				value: BigDecimal.format(one.value),
				weight: BigDecimal.format(one.weight)
			})),
			/** Every rate a line or a quote was valued at. */
			fx_used: [...rates]
				.filter(
					([code]) =>
						code !== base &&
						book.some(({ row, quote }) => row.currency === code || quote?.currency === code)
				)
				.map(([code, rate]) => ({
					pair: `${code}/${base}`,
					rate: BigDecimal.format(
						BigDecimal.round(BigDecimal.fromNumberUnsafe(rate), {
							scale: 6,
							mode: 'half-from-zero'
						})
					)
				})),
			positions: sections,
			sources
		};
		const answer = existing
			? yield* ctx.act({ 'report.update': [{ target: existing, set: filed }] })
			: yield* ctx.act({ 'report.create': [{ for_date: ctx.today, ...filed }] });
		/** An unchanged rewrite writes no row: the day's report then stands as read. */
		const written = answer.records.find((record) => record.model === 'report') ?? existing;
		if (answer.kind !== 'committed' || written === undefined)
			return yield* ctx.refuse('errors.report_not_filed');

		/**
		 * The report's own record view rendered to PDF goes to every subscriber: in their inbox, and through each account
		 * an envoy is deployed on to their own handle there (WhatsApp at their phone, Telegram, Slack or Discord).
		 */
		if (subscribers.length > 0) {
			const pdf = yield* ctx.convert.record('report', written.id, {
				to: 'pdf',
				name: `portfolio-report-${ctx.today}.pdf`
			});
			yield* ctx.notify({
				title,
				description: `${unlinked(headline)}\n\n${unlinked(summary)}`,
				to: subscribers.map((user) => ({ user })),
				via,
				attachments: [pdf],
				once: `report-sent-${ctx.today}`
			});
		}

		const busy = book.filter(({ live }) => live?.movement === 'surge').map(({ row }) => row);
		yield* ctx.notify([
			{
				title,
				description: unlinked(headline),
				to: [{ team: 'investors' }],
				once: `report-${ctx.today}`
			},
			...busy.map((line) => ({
				title: `Movement on ${line.symbol ?? line.instrument}`,
				description: `${line.instrument} traded at more than twice its 20-session average volume.`,
				to: [{ team: 'investors' as const }],
				once: `movement-${line.id}-${ctx.today}`
			}))
		]);
	}
});
