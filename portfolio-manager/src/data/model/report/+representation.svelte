<script lang="ts">
	/**
	 * The day's report as a client reads it, top to bottom, in Markdown: the date and the lead, what is in it, the book at
	 * a glance (net assets over the recent reports, allocation, the P&L of each line in the report), the markets as a
	 * plain table with its data line and the move, then one section per line with cited news. Every claim links its
	 * source. The PDF the agent sends is this view, rendered: the charts carry axes and legends, so they read on paper.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Chart, ReadonlyMarkdown, RecordShell, format, type RecordView } from '@norbital-ai/ui';
	let { ctx, view }: { ctx: PageContext; view: RecordView<'report'> } = $props();
	const t = ctx.t;

	const past = $derived(
		view.mode === 'create'
			? null
			: ctx.query({
					report: {
						where: { for_date: { lte: view.record.for_date } },
						order_by: { for_date: 'desc' },
						fields: ['for_date', 'net_assets'],
						limit: 30
					}
				})
	);
	const day = new Intl.DateTimeFormat(ctx.locale, {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});
	const trend = $derived(
		(past?.current?.report.rows ?? [])
			.map((one) => ({
				date: day.format(new Date(`${one.for_date}T00:00:00Z`)),
				net_assets: Number(one.net_assets)
			}))
			.reverse()
	);
	const decimal = (value: string) =>
		format({ kind: 'decimal', scale: 2 }, value, { locale: ctx.locale });
	/**
	 * The book by currency as a plain Markdown table: the rate the run valued it at (base per unit, from `fx_used`), its
	 * value in base and its share of total assets.
	 */
	const currencyTable = (
		base: string,
		exposure: readonly {
			readonly currency: string;
			readonly value: string;
			readonly weight: string;
		}[],
		rates: readonly { readonly pair: string; readonly rate: string }[]
	) =>
		[
			`| ${t('component.report_currency')} | ${t('component.report_rate', { base })} | ${t('component.report_value', { base })} | ${t('component.report_share')} |`,
			'| --- | ---: | ---: | ---: |',
			...exposure.map((one) => {
				const rate =
					one.currency === base
						? '1'
						: rates.find((r) => r.pair === `${one.currency}/${base}`)?.rate;
				return `| ${one.currency} | ${rate ?? '—'} | ${decimal(one.value)} | ${one.weight}% |`;
			})
		].join('\n');
	/** A change as the table shows it: ▲ or ▼ and the percentage. */
	const move = (value: string | null | undefined) =>
		value == null ? '—' : `${value.startsWith('-') ? '▼' : '▲'} ${value.replace(/^-/, '')}%`;
	const word = (value: string | null | undefined) =>
		value == null ? '—' : value.charAt(0).toUpperCase() + value.slice(1);
	/** The markets as a plain Markdown table: the level, the move over a day, week, month and year, trend and pressure. */
	const marketTable = (
		rows: readonly {
			readonly instrument: string;
			readonly level: string;
			readonly change_pct?: string | null;
			readonly change_1w_pct?: string | null;
			readonly change_1m_pct?: string | null;
			readonly change_1y_pct?: string | null;
			readonly trend?: string | null;
			readonly pressure?: string | null;
		}[]
	) =>
		[
			`| ${[
				t('component.report_instrument'),
				t('component.report_level'),
				t('component.report_change'),
				t('component.report_week'),
				t('component.report_month'),
				t('component.report_year'),
				t('component.report_trend_column'),
				t('component.report_pressure')
			].join(' | ')} |`,
			'| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
			...rows.map(
				(one) =>
					`| ${[
						one.instrument.replaceAll('|', '\\|'),
						decimal(one.level),
						move(one.change_pct),
						move(one.change_1w_pct),
						move(one.change_1m_pct),
						move(one.change_1y_pct),
						word(one.trend),
						word(one.pressure)
					].join(' | ')} |`
			)
		].join('\n');
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="report" mode="create" values={view.values} />
{:else}
	{@const report = view.record}
	<RecordShell {ctx} of="report" mode={view.mode} id={report.id}>
		<article class="flex max-w-4xl flex-col gap-6">
			<ReadonlyMarkdown value={`**${report.headline}**`} />
			<section>
				<h2 class="font-semibold">{t('component.report_contents')}</h2>
				<ReadonlyMarkdown value={report.summary} />
			</section>
			<section class="flex flex-col gap-4">
				<h2 class="font-semibold">{t('component.report_book')}</h2>
				{#if past?.current === undefined}
					<div aria-busy="true"></div>
				{:else if trend.length > 1}
					<Chart
						{ctx}
						of={trend}
						x="date"
						y="net_assets"
						kind="line"
						title={t('component.report_trend')}
					/>
				{/if}
				{#if (report.allocation ?? []).length > 0}
					<Chart
						{ctx}
						of={(report.allocation ?? []).map((one) => ({
							...one,
							label: one.label.charAt(0).toUpperCase() + one.label.slice(1)
						}))}
						x="label"
						y="weight"
						kind="bar"
						orientation="horizontal"
						title={t('component.report_allocation')}
					/>
				{/if}
				{#if (report.positions ?? []).some((one) => one.pnl !== null)}
					<Chart
						{ctx}
						of={(report.positions ?? []).flatMap((one) =>
							one.pnl == null ? [] : [{ instrument: one.instrument, profit_and_loss: one.pnl }]
						)}
						x="instrument"
						y="profit_and_loss"
						kind="bar"
						orientation="horizontal"
						title={t('component.report_pnl', { currency: report.base_currency })}
					/>
				{/if}
			</section>
			{#if (report.exposure ?? []).length > 0}
				<section>
					<h2 class="font-semibold">{t('component.report_currencies')}</h2>
					<ReadonlyMarkdown
						value={currencyTable(report.base_currency, report.exposure ?? [], report.fx_used ?? [])}
					/>
				</section>
			{/if}
			<section>
				<h2 class="font-semibold">{t('component.report_markets')}</h2>
				{#if (report.markets ?? []).length > 0}<ReadonlyMarkdown
						value={marketTable(report.markets ?? [])}
					/>{/if}
				{#if report.market_view}<ReadonlyMarkdown value={report.market_view} />{/if}
			</section>
			{#each report.positions ?? [] as item (item.instrument)}
				<section class="flex flex-col gap-1">
					<p class="text-muted-foreground text-xs uppercase">
						{item.symbol ?? item.instrument} · {item.call}
					</p>
					<h2 class="font-semibold">{item.headline}</h2>
					<ReadonlyMarkdown value={item.analysis} />
				</section>
			{/each}
		</article>
	</RecordShell>
{/if}
