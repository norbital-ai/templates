<script lang="ts">
	/**
	 * The book at its latest report: net assets and what they are made of, net assets over the reports, allocation by
	 * class and by currency (with the rate each was valued at), each position's P&L as the agent last filed it, and the calls.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Chart,
		EmptyState,
		Icon,
		ReadonlyMarkdown,
		Table,
		TableSkeleton,
		format,
		type BadgeVariant,
		type Kind,
		type ShowProps
	} from '@norbital-ai/ui';
	import { AppShell, Bound, Columns, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { isPosition } from '../../lib/portfolio/book.ts';
	let { ctx }: { ctx: PageContext } = $props();

	const read = ctx.query({
		report: { order_by: { for_date: 'desc' }, limit: 90 },
		holding: {
			fields: ['instrument', 'symbol', 'asset_class', 'pnl_history'],
			limit: 200
		}
	});
	const rows = $derived(read.current?.report.rows ?? []);
	const latest = $derived(rows[0]);
	const day = new Intl.DateTimeFormat(ctx.locale, {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});
	const trend = $derived(
		rows
			.map((one) => ({
				date: day.format(new Date(`${one.for_date}T00:00:00Z`)),
				net_assets: Number(one.net_assets),
				invested: Number(one.invested),
				cash: Number(one.cash)
			}))
			.reverse()
	);
	/** Each position's P&L on the last day the agent filed it. */
	const pnl = $derived(
		(read.current?.holding.rows ?? [])
			.filter(isPosition)
			.flatMap((one) => {
				const last = one.pnl_history?.at(-1);
				return last
					? [{ line: one.symbol ?? one.instrument, profit_and_loss: Number(last.pnl) }]
					: [];
			})
			.sort((a, b) => b.profit_and_loss - a.profit_and_loss)
	);
	const baseMoneyKind = $derived<Kind>({
		kind: 'money',
		...(latest ? { currency: latest.base_currency } : {}),
		optional: true
	});
	const money = (value: string | null | undefined) =>
		value == null || latest === undefined
			? '—'
			: format({ kind: 'money' }, value, { locale: ctx.locale, currency: latest.base_currency });
	const signed = (value: string) => `${value.startsWith('-') ? '' : '+'}${money(value)}`;
	const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
	const callVariant = (value: string): BadgeVariant =>
		value === 'buy'
			? 'success'
			: value === 'sell'
				? 'destructive'
				: value === 'watch'
					? 'warning'
					: 'outline';
	const COLORS = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-3)',
		'var(--chart-4)',
		'var(--chart-5)'
	];
	const color = (index: number) => COLORS[index % COLORS.length];
</script>

<!-- parts of total assets: a stacked bar of the positive ones, then each with its value and share (a negative one, an
accumulator's mark, keeps its row) -->
{#snippet shares(
	title: string,
	parts: readonly { readonly label: string; readonly value: string; readonly weight: string }[],
	name: (label: string) => string
)}
	<Stack gap="md">
		<h2 class="text-label">{title}</h2>
		<div class="flex h-2.5 overflow-hidden rounded-sm bg-muted" role="img" aria-label={title}>
			{#each parts as part, index (part.label)}
				<span
					class="min-w-0 basis-0"
					style:flex-grow={Math.max(0, Number(part.weight))}
					style:background={color(index)}
				></span>
			{/each}
		</div>
		<Stack gap="sm">
			{#each parts as part, index (part.label)}
				<Grid tracks="minmax(0,1fr) auto 3.5rem" gap="sm" align="center" class="text-sm">
					<Inline as="span" gap="sm" align="center">
						<span class="size-2 shrink-0 rounded-xs" style:background={color(index)}></span>
						<span class="truncate">{name(part.label)}</span>
					</Inline>
					<span class="text-meta text-right tabular-nums">{money(part.value)}</span>
					<span class="text-right font-medium tabular-nums">{part.weight}%</span>
				</Grid>
			{/each}
		</Stack>
	</Stack>
{/snippet}
{#snippet move({ value }: { value: ShowProps['value'] })}
	{#if typeof value === 'string'}
		{@const down = value.startsWith('-')}
		<Inline
			as="span"
			gap="xs"
			align="center"
			justify="end"
			class={['tabular-nums', down ? 'text-destructive' : 'text-success']}
		>
			<Icon name={down ? 'lucide:arrow-down' : 'lucide:arrow-up'} class="size-3.5 shrink-0" />
			<span>{value.replace(/^-/, '')}%</span>
		</Inline>
	{/if}
{/snippet}
{#snippet callBadge({ value }: { value: ShowProps['value'] })}
	{#if typeof value === 'string'}
		<Badge variant={callVariant(value)}>{label(value)}</Badge>
	{/if}
{/snippet}
{#snippet analysis({ value }: { value: ShowProps['value'] })}
	{#if typeof value === 'string'}<div class="line-clamp-3 max-w-md whitespace-normal">
			<ReadonlyMarkdown {value} />
		</div>{/if}
{/snippet}

<AppShell
	title={ctx.t('component.dashboard.title')}
	description={ctx.t('component.dashboard.description')}
	icon="lucide:layout-dashboard"
	variant="full"
>
	<Scroll name="dashboard" size="fill" min_height="24rem" inset>
		{#if read.error}
			<EmptyState title={ctx.t('component.dashboard.read_failed')} hint={String(read.error)} />
		{:else if read.current === undefined}
			<Stack
				gap="md"
				role="status"
				aria-busy="true"
				aria-label={ctx.t('component.dashboard.loading')}
			>
				<Grid minimum="panel" gap="md">
					<div
						class="h-64 animate-pulse rounded-md border border-border bg-card p-5 motion-reduce:animate-none"
					></div>
					<div
						class="h-64 animate-pulse rounded-md border border-border bg-card p-5 motion-reduce:animate-none"
					></div>
				</Grid>
				<TableSkeleton />
			</Stack>
		{:else if !latest}
			<EmptyState
				title={ctx.t('component.dashboard.no_report')}
				hint={ctx.t('component.dashboard.no_report_hint')}
			/>
		{:else}
			<Stack gap="md">
				<Grid minimum="panel" gap="md">
					<Stack
						as="section"
						gap="md"
						class="rounded-md border border-border bg-card p-5 text-card-foreground"
					>
						<Inline justify="between" align="center" gap="sm">
							<h2 class="text-label">{ctx.t('component.dashboard.net_assets')}</h2>
							<span class="text-meta"
								>{format({ kind: 'date' }, latest.for_date, { locale: ctx.locale })}</span
							>
						</Inline>
						<Stack gap="xs">
							<p class="text-title tabular-nums wrap-anywhere">{money(latest.net_assets)}</p>
							{#if latest.day_change !== null}
								<p
									class={[
										'text-meta tabular-nums',
										latest.day_change.startsWith('-') ? 'text-destructive' : 'text-success'
									]}
								>
									{ctx.t('component.dashboard.since_last', { change: signed(latest.day_change) })}
								</p>
							{/if}
						</Stack>
						<Columns count={2} gap="md" collapse="none">
							{#each [[ctx.t('component.dashboard.invested'), latest.invested], [ctx.t('component.dashboard.cash'), latest.cash], [ctx.t('component.dashboard.owed'), latest.liabilities], [ctx.t('component.dashboard.unrealised'), latest.unrealised_pl]] as const as [title, value] (title)}
								<Stack gap="xs">
									<p class="text-meta">{title}</p>
									<p class="text-heading tabular-nums whitespace-nowrap">{money(value)}</p>
								</Stack>
							{/each}
						</Columns>
					</Stack>
					<Stack
						as="section"
						gap="md"
						class="rounded-md border border-border bg-card p-5 text-card-foreground"
					>
						<h2 class="text-label">{ctx.t('component.dashboard.net_assets_over_time')}</h2>
						{#if trend.length > 1}
							<Bound height="18rem">
								<Chart
									{ctx}
									of={trend}
									x="date"
									y={['net_assets', 'invested', 'cash']}
									kind="line"
								/>
							</Bound>
						{:else}
							<p class="text-meta">{ctx.t('component.dashboard.trend_start')}</p>
						{/if}
					</Stack>
				</Grid>
				<Grid minimum="panel" gap="md">
					<section class="rounded-md border border-border bg-card p-5 text-card-foreground">
						{@render shares(
							ctx.t('component.dashboard.allocation'),
							latest.allocation ?? [],
							label
						)}
					</section>
					<section class="rounded-md border border-border bg-card p-5 text-card-foreground">
						{@render shares(
							ctx.t('component.dashboard.currencies'),
							(latest.exposure ?? []).map((one) => ({ ...one, label: one.currency })),
							(code) => {
								const rate = latest.fx_used?.find(
									(one) => one.pair === `${code}/${latest.base_currency}`
								);
								return code === latest.base_currency || rate === undefined
									? code
									: `${code} · ${rate.rate}`;
							}
						)}
					</section>
				</Grid>
				<Stack
					as="section"
					gap="md"
					class="rounded-md border border-border bg-card p-5 text-card-foreground"
				>
					<h2 class="text-label">{ctx.t('component.dashboard.pnl_by_position')}</h2>
					{#if pnl.length > 0}
						<Bound height="18rem">
							<Chart
								{ctx}
								of={pnl}
								x="line"
								y="profit_and_loss"
								kind="bar"
								orientation="horizontal"
							/>
						</Bound>
					{:else}
						<p class="text-meta">{ctx.t('component.dashboard.pnl_waiting')}</p>
					{/if}
				</Stack>
				<Stack
					as="section"
					gap="md"
					class="rounded-md border border-border bg-card p-5 text-card-foreground"
				>
					<h2 class="text-label">{ctx.t('component.dashboard.positions_calls')}</h2>
					<Table
						{ctx}
						of={latest.positions ?? []}
						embedded
						controlled
						columns={[
							{ field: 'instrument', label: ctx.t('component.report_instrument') },
							{ field: 'call', label: ctx.t('component.report_call'), cell: callBadge },
							{
								field: 'value',
								label: ctx.t('component.dashboard.value'),
								kind: baseMoneyKind,
								align: 'end'
							},
							{
								field: 'weight',
								label: ctx.t('component.dashboard.weight'),
								kind: { kind: 'decimal', scale: 2, optional: true },
								align: 'end'
							},
							{
								field: 'change_pct',
								label: ctx.t('component.dashboard.day'),
								cell: move,
								align: 'end'
							},
							{
								field: 'pnl',
								label: ctx.t('component.dashboard.pnl'),
								kind: baseMoneyKind,
								align: 'end'
							},
							{ field: 'analysis', label: ctx.t('component.dashboard.analysis'), cell: analysis }
						]}
					/>
				</Stack>
			</Stack>
		{/if}
	</Scroll>
</AppShell>
