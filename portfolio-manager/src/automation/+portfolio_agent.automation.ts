import { Effect, Option } from 'effect';
import { automation, is_instance, type AutomationCtx, type Id } from '@norbital-ai/bolt';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import {
	NEWS_URL,
	QUOTE_URL,
	RATES_URL,
	movementOf,
	parseHeadlines,
	parseQuote,
	parseRates,
	quoteSymbol,
	readPage,
	search,
	type Read
} from '../lib/portfolio/market.ts';
import { computeMetrics, costInBase, isPosition, lineValue, round } from '../lib/portfolio/book.ts';

/** How many dated P&L entries a line keeps, and how many of the largest lines are researched. */
const PNL_DAYS = 90;
const RESEARCHED = 6;
/** The base currency of a workspace with no `portfolio_settings` row. */
const DEFAULT_CURRENCY = currency('USD');
const PROSE =
	'Write plain prose only: no lists, no markdown. Keep sentences short and never invent a figure, a headline or a source.';

/** A figure as the two-place decimal a nested field stores. */
const amount = (value: number) => Decimal.from_number(value, 2);
const money = (value: number) =>
	value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * How a text reaches one recipient through the configured account, by its channel: `null` for an account that carries
 * no chat. A WhatsApp recipient may be a plain number.
 */
const senderOf = (
	ctx: Pick<AutomationCtx, 'send'>,
	account: { readonly id: Id<'sys_integration'>; readonly integration: string }
) => {
	if (is_instance('whatsapp', account))
		return (to: string, text: string) =>
			ctx.send(account.id, {
				to: to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`,
				text
			});
	if (is_instance('telegram', account))
		return (to: string, text: string) => ctx.send(account.id, { to, text });
	if (is_instance('slack', account))
		return (to: string, text: string) => ctx.send(account.id, { to, text });
	if (is_instance('discord', account))
		return (to: string, text: string) => ctx.send(account.id, { to, text });
	return null;
};

/**
 * The one agent. Once a day it prices the book, measures each line's trading, files each line's P&L for the day,
 * researches the market and the largest lines in its browser, asks the model for the market view and one call per
 * position, files the day's report and sends it to the configured recipients.
 */
export default automation({
	description:
		'Once a day: prices the book, files each line’s P&L, researches the market and the largest lines in its browser, writes one call per holding and the market view into the day’s report, and sends it to the recipients in the portfolio settings.',
	input: { send: { kind: 'bool', optional: true, default: true } },
	on: [{ cron: '0 8 * * *' }],
	policies: ['portfolio_automation'],
	run: function* (input, ctx) {
		const log: string[] = [];
		const read = (url: string, raw = false) => ctx.web.read(url, { raw }).pipe(Effect.option);

		const { holding, portfolio_settings } = yield* ctx.query({
			holding: { order_by: { value_base: 'desc' }, limit: 200 },
			portfolio_settings: { limit: 2 }
		});
		if (portfolio_settings.rows.length > 1) return yield* ctx.refuse('errors.settings_ambiguous');
		const settings = portfolio_settings.rows[0];
		const base = settings?.base_currency ?? DEFAULT_CURRENCY;
		const recipients = input.send === false ? [] : (settings?.recipients ?? []);
		const via = recipients.length > 0 ? (settings?.report_via ?? null) : null;
		const account =
			via === null
				? undefined
				: (yield* ctx.query({
						sys_integration: { where: { id: { eq: via }, active: { eq: true } }, limit: 1 }
					})).sys_integration.rows[0];
		const send = account === undefined ? null : senderOf(ctx, account);
		if (recipients.length > 0 && send === null)
			return yield* ctx.refuse('errors.no_report_account');
		if (holding.rows.length === 0) return;

		const ratesPage = yield* read(RATES_URL(base));
		const rates = Option.match(ratesPage, {
			onNone: () => new Map<string, number>(),
			onSome: (page) => parseRates(page.text, base)
		});
		log.push(`rates ${base}: ${rates.size > 0 ? `${rates.size} currencies` : 'did not answer'}`);

		/** Each tickered line priced from the market; the rest keep their last values. */
		type Live = {
			live_price: number;
			live_change_pct: number | null;
			live_value_base: number;
			price_updated_at: typeof ctx.now;
			volume_ratio: number | null;
			movement: ReturnType<typeof movementOf>;
		};
		const book: { row: (typeof holding.rows)[number]; live: Live | null; value: number }[] = [];
		for (const row of holding.rows) {
			const ticker = row.symbol ? quoteSymbol(row.symbol) : null;
			const page = ticker ? yield* read(QUOTE_URL(ticker)) : Option.none();
			const quote = Option.isSome(page) ? parseQuote(page.value.text) : null;
			if (ticker) log.push(`quote ${ticker}: ${quote ? quote.price : 'no answer'}`);
			const perBase = row.currency === base ? 1 : rates.get(row.currency);
			const value =
				quote && perBase !== undefined
					? round(row.quantity.to_number() * quote.price * perBase)
					: lineValue(row);
			const live: Live | null = quote
				? {
						live_price: quote.price,
						live_change_pct: quote.change_pct,
						live_value_base: value,
						price_updated_at: ctx.now,
						volume_ratio: quote.volume_ratio,
						movement: movementOf(quote.volume_ratio)
					}
				: null;
			book.push({ row, live, value });
		}
		const metrics = computeMetrics(
			book.map(({ row, value }) => ({
				asset_class: row.asset_class,
				value,
				unrealised_pl: row.unrealised_pl?.to_number() ?? 0
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

		const view = yield* ctx.ai.sys_2
			.infer({
				label: 'market view',
				system: `You are a portfolio strategist. ${PROSE}`,
				prompt: [
					`Today is ${ctx.today}. The book is valued in ${base}.`,
					`Net assets ${money(metrics.net_assets)}; invested ${money(metrics.invested)}; cash ${money(metrics.cash)}; owed ${money(metrics.liabilities)}.`,
					`Allocation: ${metrics.allocation.map((one) => `${one.label} ${one.weight}%`).join(', ') || 'none'}.`,
					'The market, as the agent read it:',
					market.map((one) => `- ${one.label}: ${one.text.slice(0, 1200)}`).join('\n') ||
						'- nothing was readable',
					'Headlines on the largest lines:',
					[...reads.values()]
						.flat()
						.map((one) => `- ${one.label}`)
						.join('\n') || '- none'
				].join('\n'),
				output: {
					kind: 'object',
					fields: {
						summary: { kind: 'text' },
						market_view: { kind: 'text' }
					}
				}
			})
			.pipe(Effect.option);
		const marketView = Option.getOrNull(view);
		log.push(marketView ? 'model: market view answered' : 'model: no market view');

		/** One call per position, with its P&L as the yardstick; every line takes its price read. */
		const positions = [];
		const writes = [];
		for (const { row, live, value } of book) {
			if (!isPosition(row)) {
				if (live) writes.push({ target: row, set: live });
				continue;
			}
			const cost = costInBase(row);
			const pnl = round(value - cost);
			const pnl_pct = cost > 0 ? round((pnl / cost) * 100) : null;
			const pages = reads.get(row.id) ?? [];
			const name = row.symbol ?? row.instrument;
			const call = Option.getOrNull(
				yield* ctx.ai.sys_2
					.infer({
						label: name,
						system: `You are a portfolio analyst writing one call on one holding, in two or three sentences. ${PROSE}`,
						prompt: [
							`Today is ${ctx.today}. The book is valued in ${base}.`,
							`Holding: ${row.instrument} (${row.symbol ?? 'no ticker'}), ${row.asset_class}, ${row.currency}.`,
							`Cost ${money(cost)}. Worth now ${money(value)}. P&L ${money(pnl)}${pnl_pct === null ? '' : ` (${pnl_pct}%)`}.`,
							row.research_direction ? `Research direction: ${row.research_direction}.` : '',
							marketView ? `The market view: ${marketView.market_view}` : '',
							'What the agent read on this line:',
							pages
								.map((one) => `- ${one.label}${one.text ? `: ${one.text.slice(0, 900)}` : ''}`)
								.join('\n') || '- nothing was readable'
						]
							.filter((part) => part.length > 0)
							.join('\n'),
						output: {
							kind: 'object',
							fields: {
								call: { kind: 'enum', values: ['buy', 'sell', 'hold', 'watch'] },
								analysis: { kind: 'text' },
								confidence: { kind: 'decimal', scale: 2, optional: true }
							}
						}
					})
					.pipe(Effect.option)
			);
			log.push(`model ${name}: ${call ? call.call : 'no answer'}`);
			positions.push({
				instrument: row.instrument,
				symbol: row.symbol,
				weight: amount(metrics.total_assets > 0 ? round((value / metrics.total_assets) * 100) : 0),
				change_pct: !live
					? row.live_change_pct
					: live.live_change_pct === null
						? null
						: amount(live.live_change_pct),
				call: call ? call.call : 'hold',
				analysis: call ? call.analysis : 'No view came back for this line on this run.',
				confidence: call?.confidence ?? null,
				pnl: amount(pnl),
				pnl_pct: pnl_pct === null ? null : amount(pnl_pct)
			});
			writes.push({
				target: row,
				set: {
					...live,
					pnl_history: [
						...(row.pnl_history ?? []).filter((entry) => entry.date !== ctx.today),
						{
							date: ctx.today,
							pnl: amount(pnl),
							pnl_pct: pnl_pct === null ? null : amount(pnl_pct)
						}
					]
						.sort((a, b) => a.date.localeCompare(b.date))
						.slice(-PNL_DAYS),
					...(call || pages.length > 0
						? {
								research_summary: call ? call.analysis : row.research_summary,
								research_at: ctx.now,
								insights: pages.slice(0, 6).map((one) => ({
									headline: one.label.slice(0, 300),
									source_name: one.url.split('/')[2] ?? null,
									url: one.url
								}))
							}
						: {})
				}
			});
		}
		if (writes.length > 0) yield* ctx.act({ 'holding.update': writes });

		const { report } = yield* ctx.query({
			report: {
				where: { for_date: { lte: ctx.today } },
				order_by: { for_date: 'desc' },
				limit: 2
			}
		});
		const existing = report.rows.find((one) => one.for_date === ctx.today);
		const previous = report.rows.find((one) => one.for_date !== ctx.today);
		const dayChange = previous ? round(metrics.net_assets - previous.net_assets.to_number()) : null;
		const headline = `Net assets ${base} ${money(metrics.net_assets)}${dayChange === null ? '' : ` (${dayChange >= 0 ? '+' : ''}${money(dayChange)} on the day)`}`;
		const summary = [
			`Invested ${money(metrics.invested)}, cash ${money(metrics.cash)}, owed ${money(metrics.liabilities)}.`,
			marketView ? marketView.summary : ''
		]
			.filter((part) => part.length > 0)
			.join(' ');
		const title = `Portfolio report · ${ctx.today}`;

		/** The report as text, queued to each recipient; the message ids are kept on the report. */
		const text = [
			title,
			headline,
			summary,
			marketView ? `Market: ${marketView.market_view}` : '',
			...positions.map(
				(one) => `${one.symbol ?? one.instrument}: ${one.call.toUpperCase()}. ${one.analysis}`
			)
		]
			.filter((part) => part.length > 0)
			.join('\n\n');
		const deliveries = [];
		if (send !== null)
			for (const recipient of recipients) deliveries.push(yield* send(recipient.handle, text));
		log.push(`sent to ${deliveries.length} recipient(s)`);

		const filed = {
			base_currency: base,
			headline,
			summary,
			market_view: marketView ? marketView.market_view : null,
			research_log: log.join('\n').slice(0, 8000),
			net_assets: metrics.net_assets,
			invested: metrics.invested,
			cash: metrics.cash,
			liabilities: metrics.liabilities,
			unrealised_pl: metrics.unrealised_pl,
			day_change: dayChange,
			allocation: metrics.allocation.map((one) => ({
				label: one.label,
				value: amount(one.value),
				weight: amount(one.weight)
			})),
			fx_used: [...rates]
				.filter(([code]) => code !== base && book.some(({ row }) => row.currency === code))
				.map(([code, rate]) => ({ pair: `${code}/${base}`, rate: Decimal.from_number(rate, 6) })),
			positions,
			deliveries: [...(existing?.deliveries ?? []), ...deliveries]
		};
		if (existing) yield* ctx.act({ 'report.update': [{ target: existing, set: filed }] });
		else yield* ctx.act({ 'report.create': [{ for_date: ctx.today, ...filed }] });

		const busy = book.filter(({ live }) => live?.movement === 'surge').map(({ row }) => row);
		yield* ctx.notify([
			{
				title,
				description: `${headline}. ${summary}`,
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
