<script lang="ts">
	/** The book at its latest report: totals, net assets over time, allocation and the calls. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Chart,
		EmptyState,
		ReadonlyMarkdown,
		Table,
		format,
		type ShowProps
	} from '@norbital-ai/ui';
	import { AppShell, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();

	const reports = ctx.query({ report: { order_by: { for_date: 'desc' }, limit: 90 } });
	const rows = $derived(reports.current?.report.rows ?? []);
	const latest = $derived(rows[0]);
	const trend = $derived(
		rows
			.map((one) => ({
				for_date: format({ kind: 'date' }, one.for_date, { locale: ctx.locale }),
				net_assets: one.net_assets
			}))
			.reverse()
	);
	/** A stored decimal (a string) for reading: two places, the workspace's grouping. */
	const money = (value: string | null) =>
		value === null
			? '—'
			: Number(value).toLocaleString(ctx.locale, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2
				});
</script>

{#snippet analysis({ value }: { value: ShowProps['value'] })}
	{#if typeof value === 'string'}<div class="line-clamp-3 max-w-md whitespace-normal">
			<ReadonlyMarkdown {value} />
		</div>{/if}
{/snippet}

<AppShell
	title="Dashboard"
	description="The book as the latest report found it. The agent writes a report every morning; run it from Holdings for a fresh one."
	icon="lucide:layout-dashboard"
	variant="full"
>
	<Scroll name="dashboard" size="fill" min_height="24rem">
		{#if !latest}
			<EmptyState
				title="No report yet"
				hint="Add the book's lines under Holdings, then run the agent."
			/>
		{:else}
			<Stack gap="lg">
				<Grid minimum="compact">
					{#each [['Net assets', latest.net_assets], ['Invested', latest.invested], ['Cash', latest.cash], ['Owed', latest.liabilities], ['Change on the day', latest.day_change]] as const as [title, value] (title)}
						<div class="rounded-xl border p-4">
							<p class="text-xs text-muted-foreground">{title}</p>
							<p class="mt-1 text-xl font-semibold">{latest.base_currency} {money(value)}</p>
						</div>
					{/each}
				</Grid>
				<Grid minimum="panel">
					{#if trend.length > 1}<Chart
							{ctx}
							of={trend}
							x="for_date"
							y="net_assets"
							kind="line"
							title="Net assets over time"
						/>{/if}
					<Chart
						{ctx}
						of={latest.allocation ?? []}
						x="label"
						y="value"
						kind="donut"
						title="Allocation"
					/>
				</Grid>
				<Table
					{ctx}
					of={latest.positions ?? []}
					embedded
					controlled
					columns={[
						'instrument',
						'call',
						'weight',
						'change_pct',
						'pnl',
						{ field: 'analysis', label: 'Analysis', cell: analysis }
					]}
				/>
			</Stack>
		{/if}
	</Scroll>
</AppShell>
