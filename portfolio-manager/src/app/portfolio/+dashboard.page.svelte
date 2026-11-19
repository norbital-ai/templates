<script lang="ts">
	/**
	 * The book at its latest report: net assets and what they are made of, net assets over the reports, allocation by
	 * class and by currency (with the rate each was valued at), each position's P&L as the agent last filed it, each quoted position's signals (the move over a day, week,
	 * month and year, trend, buying or selling pressure, momentum, distance from the high, volatility) and the calls.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Chart,
		EmptyState,
		ReadonlyMarkdown,
		Table,
		format,
		type ShowProps
	} from '@norbital-ai/ui';
	import { AppShell, Bound, Scroll } from '@norbital-ai/ui/layout';
	import { isPosition } from '../../lib/portfolio/book.ts';
	let { ctx }: { ctx: PageContext } = $props();

	const read = ctx.query({
		report: { order_by: { for_date: 'desc' }, limit: 90 },
		holding: {
			fields: [
				'instrument',
				'symbol',
				'asset_class',
				'pnl_history',
				'price_updated_at',
				'live_change_pct',
				'change_1w_pct',
				'change_1m_pct',
				'change_1y_pct',
				'trend',
				'pressure',
				'money_flow',
				'volume_ratio',
				'rsi',
				'from_high_pct',
				'volatility_pct'
			],
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
	/** Every position the agent priced, with what its year of trading says. */
	const signals = $derived(
		(read.current?.holding.rows ?? [])
			.filter((one) => isPosition(one) && one.price_updated_at !== null)
			.map((one) => ({ ...one, line: one.symbol ?? one.instrument }))
	);
	const money = (value: string | null | undefined) =>
		value == null || latest === undefined
			? '—'
			: format({ kind: 'money' }, value, { locale: ctx.locale, currency: latest.base_currency });
	const signed = (value: string) => `${value.startsWith('-') ? '' : '+'}${money(value)}`;
	const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
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
	<h2>{title}</h2>
	<div class="stack-bar" role="img" aria-label={title}>
		{#each parts as part, index (part.label)}
			<span style:flex-grow={Math.max(0, Number(part.weight))} style:background={color(index)}
			></span>
		{/each}
	</div>
	<div class="class-rows">
		{#each parts as part, index (part.label)}
			<div class="class-row">
				<span class="flex items-center gap-2"
					><i style:background={color(index)}></i>{name(part.label)}</span
				>
				<span class="text-meta tabular-nums">{money(part.value)}</span>
				<span class="font-medium tabular-nums">{part.weight}%</span>
			</div>
		{/each}
	</div>
{/snippet}
{#snippet move({ value }: { value: ShowProps['value'] })}
	{#if typeof value === 'string'}<span
			class="tabular-nums"
			class:gain={!value.startsWith('-')}
			class:loss={value.startsWith('-')}
			>{value.startsWith('-') ? '▼' : '▲'} {value.replace(/^-/, '')}%</span
		>{/if}
{/snippet}
{#snippet direction({ value }: { value: ShowProps['value'] })}
	{#if typeof value === 'string'}<span
			class:gain={value === 'up' || value === 'buying'}
			class:loss={value === 'down' || value === 'selling'}
			>{{
				up: ctx.t('component.dashboard.up'),
				down: ctx.t('component.dashboard.down'),
				sideways: ctx.t('component.dashboard.sideways')
			}[value] ?? label(value)}</span
		>{/if}
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
			<EmptyState title={ctx.t('component.dashboard.loading')} />
		{:else if !latest}
			<EmptyState
				title={ctx.t('component.dashboard.no_report')}
				hint={ctx.t('component.dashboard.no_report_hint')}
			/>
		{:else}
			<div class="dashboard">
				<div class="dashboard-grid">
					<section class="panel summary">
						<div class="panel-heading">
							<h2>{ctx.t('component.dashboard.net_assets')}</h2>
							<span class="text-meta"
								>{format({ kind: 'date' }, latest.for_date, { locale: ctx.locale })}</span
							>
						</div>
						<p class="hero tabular-nums">{money(latest.net_assets)}</p>
						{#if latest.day_change !== null}
							<p
								class="text-meta tabular-nums"
								class:gain={!latest.day_change.startsWith('-')}
								class:loss={latest.day_change.startsWith('-')}
							>
								{ctx.t('component.dashboard.since_last', { change: signed(latest.day_change) })}
							</p>
						{/if}
						<div class="metric-grid">
							{#each [[ctx.t('component.dashboard.invested'), latest.invested], [ctx.t('component.dashboard.cash'), latest.cash], [ctx.t('component.dashboard.owed'), latest.liabilities], [ctx.t('component.dashboard.unrealised'), latest.unrealised_pl]] as const as [title, value] (title)}
								<div>
									<p class="text-meta">{title}</p>
									<p class="metric tabular-nums">{money(value)}</p>
								</div>
							{/each}
						</div>
					</section>
					<section class="panel trend">
						<h2>{ctx.t('component.dashboard.net_assets_over_time')}</h2>
						{#if trend.length > 1}
							<Bound size="fill"
								><Chart
									{ctx}
									of={trend}
									x="date"
									y={['net_assets', 'invested', 'cash']}
									kind="line"
								/></Bound
							>
						{:else}
							<p class="text-meta">{ctx.t('component.dashboard.trend_start')}</p>
						{/if}
					</section>
					<section class="panel allocation">
						{@render shares(
							ctx.t('component.dashboard.allocation'),
							latest.allocation ?? [],
							label
						)}
					</section>
					<section class="panel currencies">
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
					<section class="panel pnl">
						<h2>{ctx.t('component.dashboard.pnl_by_position')}</h2>
						{#if pnl.length > 0}
							<Bound size="fill"
								><Chart
									{ctx}
									of={pnl}
									x="line"
									y="profit_and_loss"
									kind="bar"
									orientation="horizontal"
								/></Bound
							>
						{:else}
							<p class="text-meta">{ctx.t('component.dashboard.pnl_waiting')}</p>
						{/if}
					</section>
					<section class="panel signals">
						<h2>{ctx.t('component.dashboard.signals')}</h2>
						<p class="mb-4 text-meta">{ctx.t('component.dashboard.signals_help')}</p>
						{#if signals.length > 0}
							<Table
								{ctx}
								of={signals}
								embedded
								controlled
								columns={[
									{ field: 'line', label: ctx.t('component.dashboard.position') },
									{ field: 'live_change_pct', label: ctx.t('component.dashboard.day'), cell: move },
									{ field: 'change_1w_pct', label: ctx.t('component.dashboard.week'), cell: move },
									{ field: 'change_1m_pct', label: ctx.t('component.dashboard.month'), cell: move },
									{ field: 'change_1y_pct', label: ctx.t('component.dashboard.year'), cell: move },
									{ field: 'trend', label: ctx.t('component.dashboard.trend'), cell: direction },
									{
										field: 'pressure',
										label: ctx.t('component.dashboard.pressure'),
										cell: direction
									},
									{ field: 'money_flow', label: ctx.t('component.dashboard.money_flow') },
									{ field: 'volume_ratio', label: ctx.t('component.dashboard.volume_average') },
									{ field: 'rsi', label: ctx.t('component.dashboard.rsi') },
									{ field: 'from_high_pct', label: ctx.t('component.dashboard.from_high') },
									{ field: 'volatility_pct', label: ctx.t('component.dashboard.volatility') }
								]}
							/>
						{:else}
							<p class="text-meta">{ctx.t('component.dashboard.signals_waiting')}</p>
						{/if}
					</section>
					<section class="panel calls">
						<h2 class="mb-4">{ctx.t('component.dashboard.positions_calls')}</h2>
						<Table
							{ctx}
							of={latest.positions ?? []}
							embedded
							controlled
							columns={[
								'instrument',
								'call',
								{ field: 'value', label: ctx.t('component.dashboard.value') },
								{ field: 'weight', label: ctx.t('component.dashboard.weight') },
								{ field: 'change_pct', label: ctx.t('component.dashboard.day'), cell: move },
								{ field: 'pnl', label: ctx.t('component.dashboard.pnl') },
								{ field: 'analysis', label: ctx.t('component.dashboard.analysis'), cell: analysis }
							]}
						/>
					</section>
				</div>
			</div>
		{/if}
	</Scroll>
</AppShell>

<style>
	.dashboard {
		container-type: inline-size;
	}
	.dashboard-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}
	.panel {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--card);
		color: var(--card-foreground);
	}
	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	h2 {
		font-size: 0.875rem;
		font-weight: 600;
	}
	.hero {
		font-size: clamp(1.5rem, 2.4vw, 2.25rem);
		font-weight: 650;
		margin-block: 0.75rem 0.25rem;
		overflow-wrap: anywhere;
	}
	.gain {
		color: var(--chart-4);
	}
	.loss {
		color: var(--destructive);
	}
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.25rem 1rem;
		margin-top: 1.25rem;
	}
	.metric {
		font-size: 1.125rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.trend,
	.pnl {
		display: grid;
		grid-template-rows: auto 18rem;
		gap: 1rem;
		align-content: start;
	}
	.stack-bar {
		display: flex;
		height: 0.625rem;
		margin-block: 1rem;
		overflow: hidden;
		border-radius: 0.25rem;
		background: var(--muted);
	}
	.stack-bar span {
		min-width: 0;
		flex-basis: 0;
	}
	.class-rows {
		display: grid;
		gap: 0.75rem;
	}
	.class-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 3.5rem;
		gap: 0.75rem;
		align-items: center;
		font-size: 0.8125rem;
		text-align: end;
	}
	.class-row > :first-child {
		text-align: start;
	}
	.class-row i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 0.125rem;
	}
	@container (min-width: 70rem) {
		.dashboard-grid {
			grid-template-columns: repeat(12, minmax(0, 1fr));
		}
		.summary {
			grid-column: span 5;
		}
		.trend {
			grid-column: span 7;
		}
		.allocation,
		.currencies {
			grid-column: span 6;
		}
		.pnl {
			grid-column: 1 / -1;
		}
		.signals,
		.calls {
			grid-column: 1 / -1;
		}
	}
</style>
