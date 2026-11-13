import { BigDecimal, DateTime, Effect, Option } from 'effect';
import {
	automation,
	is_instance,
	type AutomationCtx,
	type CreateInput,
	type Id
} from '@norbital-ai/bolt';
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

/** The report's record view rendered to PDF bytes: never stored, only attached. */
type Rendered = Effect.Success<ReturnType<AutomationCtx['convert']['record']>>;

/**
 * How a text and the rendered report reach one chat through the configured account, by its channel, and the account as
 * a notice channel for subscribers: `null` for an account that carries no chat. A WhatsApp recipient may be a plain
 * number or a group JID.
 */
const senderOf = (
	ctx: Pick<AutomationCtx, 'send'>,
	account: { readonly id: Id<'sys_integration'>; readonly integration: string }
) => {
	if (is_instance('whatsapp', account))
		return {
			via: account.id,
			send: (to: string, text: string, pdf: Rendered) =>
				ctx.send(account.id, {
					to: to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`,
					text,
					attachments: [pdf]
				})
		};
	if (is_instance('telegram', account))
		return {
			via: account.id,
			send: (to: string, text: string, pdf: Rendered) =>
				ctx.send(account.id, { to, text, attachments: [pdf] })
		};
	if (is_instance('slack', account))
		return {
			via: account.id,
			send: (to: string, text: string, pdf: Rendered) =>
				ctx.send(account.id, { to, text, attachments: [pdf] })
		};
	if (is_instance('discord', account))
		return {
			via: account.id,
			send: (to: string, text: string, pdf: Rendered) =>
				ctx.send(account.id, { to, text, attachments: [pdf] })
		};
	return null;
};

/**
 * The one agent. Once a day it prices the book, measures each line's trading, files each line's P&L for the day,
 * researches the market and the largest lines in its browser, asks the model for the market view and one call per
 * position, files the day's report and sends it to the configured recipients.
 */
export default automation({
	description:
		'Once a day: prices the book and its benchmarks, files each line’s P&L, researches the market and the largest lines in its browser, writes the day’s report with every claim cited (a section per line with cited news), and sends its record view as a PDF to the chats in the portfolio settings and every subscribed user.',
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
		const recipients = input.send === false ? [] : (settings?.recipients ?? []);
		const subscribers = input.send === false ? [] : report_subscription.rows.map((one) => one.user);
		const via =
			recipients.length > 0 || subscribers.length > 0 ? (settings?.report_via ?? null) : null;
		const account =
			via === null
				? undefined
				: (yield* ctx.query({
						sys_integration: { where: { id: { eq: via }, active: { eq: true } }, limit: 1 }
					})).sys_integration.rows[0];
		const channel = account === undefined ? null : senderOf(ctx, account);
		/** Chats named in the settings need the account; a client's own subscription never stops the run. */
		if (recipients.length > 0 && channel === null)
			return yield* ctx.refuse('errors.no_report_account');
		if (subscribers.length > 0 && channel === null)
			log.push(`${subscribers.length} subscriber(s) not sent: no active account to send through`);
		if (holding.rows.length === 0) return;

		const ratesPage = yield* read(RATES_URL(base));
		const rates = Option.match(ratesPage, {
			onNone: () => new Map<string, number>(),
			onSome: (page) => parseRates(page.text, base)
		});
		log.push(`rates ${base}: ${rates.size > 0 ? `${rates.size} currencies` : 'did not answer'}`);

		/** Each tickered line priced from the market; the rest keep their last values. */
		type Live = {
			live_price: string;
			live_change_pct: string | null;
			live_value_base: string;
			price_updated_at: typeof ctx.now;
			volume_ratio: string | null;
			movement: ReturnType<typeof movementOf>;
		};
		const book: {
			row: (typeof holding.rows)[number];
			live: Live | null;
			value: BigDecimal.BigDecimal;
		}[] = [];
		for (const row of holding.rows) {
			const ticker = row.symbol ? quoteSymbol(row.symbol) : null;
			const page = ticker ? yield* read(QUOTE_URL(ticker)) : Option.none();
			const quote = Option.isSome(page) ? parseQuote(page.value.text) : null;
			if (ticker) log.push(`quote ${ticker}: ${quote ? quote.price : 'no answer'}`);
			const perBase = row.currency === base ? 1 : rates.get(row.currency);
			const value =
				quote && perBase !== undefined
					? BigDecimal.round(
							BigDecimal.multiply(
								BigDecimal.multiply(
									BigDecimal.fromStringUnsafe(row.quantity),
									BigDecimal.fromNumberUnsafe(quote.price)
								),
								BigDecimal.fromNumberUnsafe(perBase)
							),
							{ scale: 2, mode: 'half-from-zero' }
						)
					: lineValue(row);
			const live: Live | null = quote
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
						movement: movementOf(quote.volume_ratio)
					}
				: null;
			book.push({ row, live, value });
		}
		const metrics = computeMetrics(
			book.map(({ row, value }) => ({
				asset_class: row.asset_class,
				value,
				unrealised_pl: BigDecimal.fromStringUnsafe(row.unrealised_pl ?? '0')
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
		for (const { row, live, value } of book) {
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

		/** The benchmarks the settings name, quoted like the book's lines; one that does not answer is left out. */
		const benchmarks = [];
		for (const one of settings?.benchmarks ?? []) {
			const page = yield* read(QUOTE_URL(one.symbol));
			const quote = Option.isSome(page) ? parseQuote(page.value.text) : null;
			log.push(`benchmark ${one.symbol}: ${quote ? quote.price : 'no answer'}`);
			if (quote)
				benchmarks.push({
					instrument: one.name ?? one.symbol,
					level: BigDecimal.format(
						BigDecimal.round(BigDecimal.fromNumberUnsafe(quote.price), {
							scale: 2,
							mode: 'half-from-zero'
						})
					),
					change_pct:
						quote.change_pct === null
							? null
							: BigDecimal.format(
									BigDecimal.round(BigDecimal.fromNumberUnsafe(quote.change_pct), {
										scale: 2,
										mode: 'half-from-zero'
									})
								)
				});
		}
		/** Every line of the book: its price where it is quoted, else its value in base. */
		const markets = [
			...benchmarks,
			...book.map(({ row, live, value }) => ({
				instrument: row.instrument,
				level: live
					? BigDecimal.format(
							BigDecimal.round(BigDecimal.fromStringUnsafe(live.live_price), {
								scale: 2,
								mode: 'half-from-zero'
							})
						)
					: BigDecimal.format(BigDecimal.round(value, { scale: 2, mode: 'half-from-zero' })),
				change_pct: live ? live.live_change_pct : null
			}))
		];
		const quoted = benchmarks.length > 0 || book.some(({ live }) => live !== null);
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
		const dataLine = quoted
			? `Data as of ${asOf}; prices per [${QUOTE_SOURCE.publisher}](${QUOTE_SOURCE.url})${rates.size > 0 ? `, rates per [${RATES_SOURCE.publisher}](${RATES_SOURCE.url})` : ''}. Lines without a quote show their value in ${base}.`
			: `Data as of ${asOf}. No quote answered: every line shows its recorded value in ${base}.`;

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
						`Per [1]: ${markets.map((one) => `${one.instrument} ${one.change_pct === null ? 'no change read' : `${one.change_pct}%`}`).join('; ')}.`,
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
			fx_used: [...rates]
				.filter(([code]) => code !== base && book.some(({ row }) => row.currency === code))
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
		 * The report's own record view rendered to PDF: a short text carries it to each chat and a notice to each
		 * subscriber, directly on the account. Each chat message id is kept on the report; a notice's messages are queued
		 * only once the run commits, so they stay on the notice.
		 */
		if (channel !== null) {
			const pdf = yield* ctx.convert.record('report', written.id, {
				to: 'pdf',
				name: `portfolio-report-${ctx.today}.pdf`
			});
			const text = `${title}\n\n${unlinked(headline)}`;
			const sent = [];
			for (const recipient of recipients)
				sent.push(yield* channel.send(recipient.handle, text, pdf));
			if (subscribers.length > 0)
				yield* ctx.notify({
					title,
					description: unlinked(headline),
					to: subscribers.map((user) => ({ user })),
					via: [channel.via],
					attachments: [pdf]
				});
			yield* ctx.act({
				'report.update': [
					{ target: written, set: { deliveries: [...(existing?.deliveries ?? []), ...sent] } }
				]
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
