<script lang="ts">
	/**
	 * The day's report as a client reads it, top to bottom: the date and the lead, what is in it, the markets table with
	 * its data line and the move, then one section per line with cited news. Every claim links its source. The PDF the
	 * agent sends is this view, rendered; totals, the research log and the messages stay off it.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		ReadonlyMarkdown,
		RecordShell,
		Table,
		format,
		type RecordView,
		type ShowProps
	} from '@norbital-ai/ui';
	let { ctx, view }: { ctx: PageContext; view: RecordView<'report'> } = $props();
	const t = ctx.t;
</script>

{#snippet move({ value }: { value: ShowProps['value'] })}
	{#if typeof value === 'string'}{value.startsWith('-') ? '▼' : '▲'}
		{value.replace(/^-/, '')}%{/if}
{/snippet}

{#if view.mode === 'create'}
	<RecordShell {ctx} of="report" mode="create" values={view.values} />
{:else}
	{@const report = view.record}
	<RecordShell
		{ctx}
		of="report"
		mode={view.mode}
		id={report.id}
		title={format({ kind: 'date' }, report.for_date, { locale: ctx.locale })}
	>
		<article class="flex max-w-prose flex-col gap-4">
			<ReadonlyMarkdown value={`**${report.headline}**`} />
			<section>
				<h2 class="font-semibold">{t('component.report_contents')}</h2>
				<ReadonlyMarkdown value={report.summary} />
			</section>
			<section class="flex flex-col gap-2">
				<h2 class="font-semibold">{t('component.report_markets')}</h2>
				<Table
					{ctx}
					of={report.markets ?? []}
					key="report-markets"
					columns={[
						{ field: 'instrument', label: t('component.report_instrument') },
						{ field: 'level', label: t('component.report_level') },
						{ field: 'change_pct', label: t('component.report_change'), cell: move }
					]}
					toolbar={{ new: false }}
				/>
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
