<script lang="ts">
	/**
	 * One FX deal: its terms and fixings (the generated form), then where it stands at today's official rate, each
	 * fixing's result worked out from the bank's rate, every open fixing played at one rate (spot ±2/4/6%, the strike,
	 * the knock-out, a rate typed in), and how likely the outcomes are from the pair's own history, with the points to
	 * weigh and a person's view. A proposal is traded into a deal to confirm, and a deal to confirm is confirmed live.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Button,
		Icon,
		RecordShell,
		Table,
		format,
		use_act,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		dealView,
		gainUsd,
		odds,
		pairHistory,
		pointsToWeigh,
		scenarios,
		watch,
		currencies,
		FX_DEAL_READ
	} from '../../../lib/fx.js';
	let { view, ctx }: { view: RecordView<'fx_deal'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const sections: readonly RecordSection[] = [
		{
			name: 'deal',
			icon: 'lucide:arrow-left-right',
			title: t('fx.sections.deal'),
			fields: [
				'bank',
				'bank_reference',
				'structure',
				'structure_as_written',
				'pair',
				'side',
				'trade_date',
				'status'
			]
		},
		{
			name: 'amounts',
			icon: 'lucide:coins',
			title: t('fx.sections.amounts'),
			fields: ['notional_currency', 'notional', 'leveraged_notional', 'strike']
		},
		{
			name: 'barriers',
			icon: 'lucide:shield-alert',
			title: t('fx.sections.barriers'),
			fields: ['knock_out', 'knock_out_type', 'knock_in', 'target', 'target_rule', 'ended_on']
		},
		{
			name: 'quotes',
			icon: 'lucide:quote',
			title: t('fx.sections.quotes'),
			fields: ['spot_reference', 'forward_reference', 'forward_reference_date'],
			default_open: false
		},
		{
			name: 'dci',
			icon: 'lucide:piggy-bank',
			title: t('fx.sections.dci'),
			fields: ['dci_deposit_currency', 'dci_deposit_amount', 'dci_yield_pct'],
			default_open: false
		},
		{
			name: 'fixings',
			icon: 'lucide:calendar-clock',
			title: t('fx.sections.fixings'),
			fields: ['fixings']
		},
		{
			name: 'view',
			icon: 'lucide:eye',
			title: t('fx.sections.view'),
			fields: ['view_direction', 'view_rate', 'view_date'],
			default_open: false
		},
		{
			name: 'evidence',
			icon: 'lucide:paperclip',
			title: t('app.sections.evidence'),
			fields: ['documents', 'proposal', 'terms', 'notes'],
			default_open: false
		}
	];
	const record = $derived(view.mode === 'create' ? null : view.record);
	const pair = $derived(record?.pair ?? null);
	const read = $derived.by(() =>
		record === null || pair === null
			? null
			: ctx.query({
					fx_deal: { ...FX_DEAL_READ.fx_deal, where: { id: { eq: record.id } }, limit: 1 },
					fx_rate: { ...FX_DEAL_READ.fx_rate, where: { currency: { in: currencies(pair) } } }
				})
	);
	const rows = $derived(read?.current?.fx_rate.rows ?? []);
	const deal = $derived(read?.current?.fx_deal.rows[0] ?? null);
	const v = $derived(deal === null ? null : dealView(deal, rows, day.today));
	const num = (n: number | null, scale = 0) =>
		n === null ? '—' : format({ kind: 'decimal', scale }, n.toFixed(scale), { locale: ctx.locale });
	const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(0)}%`);
	const results = $derived(
		deal === null || v === null
			? []
			: [...deal.fixings]
					.sort((a, b) => a.fixing_date.localeCompare(b.fixing_date))
					.map((f) => {
						const r = v.result.get(f.id);
						return {
							fixing_date: f.fixing_date,
							fixing_rate: f.fixing_rate,
							outcome: r?.outcome == null ? t('fx.outcome.open') : t(`fx.outcome.${r.outcome}`),
							auto: r?.auto === false ? t('fx.chosen') : '',
							amount: r?.amount ?? null,
							gain: r?.gain ?? null,
							gain_usd:
								r?.gain == null
									? null
									: gainUsd(deal.pair, r.gain, f.settlement_date ?? f.fixing_date, rows)
						};
					})
	);
	let extra = $state('');
	const table = $derived(
		deal === null || v === null || v.spot === null
			? []
			: scenarios(
					deal,
					v.open,
					v.spot,
					v.worked.target_used,
					v.usdPerQuote,
					extra
						.split(/[\s,]+/)
						.map(Number)
						.filter((n) => n > 0)
				).map((s) => ({
					rate: s.rate.toString(),
					vs_today: `${s.vs_today_pct >= 0 ? '+' : ''}${s.vs_today_pct.toFixed(1)}%`,
					usd: s.usd.toFixed(0),
					settle: `${s.settled} / ${s.of}`,
					what: [
						s.knocked_out ? t('fx.scenario.knocked_out') : '',
						s.target_reached ? t('fx.scenario.target') : '',
						s.unknown ? t('fx.scenario.unclear') : ''
					]
						.filter(Boolean)
						.join(' · ')
				}))
	);
	let showOdds = $state(false);
	const likely = $derived.by(() => {
		if (!showOdds || deal === null || v === null || v.spot === null) return null;
		const history = pairHistory(deal.pair, rows);
		const plain = odds(
			deal,
			v.open,
			history,
			v.spot,
			day.today,
			v.worked.target_used,
			v.usdPerQuote,
			deal.id
		);
		if (typeof plain === 'string') return { plain, view: null };
		const rate =
			record?.view_rate != null
				? Number(record.view_rate)
				: record?.view_direction === 'flat'
					? v.spot
					: null;
		const tilted =
			rate === null
				? null
				: odds(
						deal,
						v.open,
						history,
						v.spot,
						day.today,
						v.worked.target_used,
						v.usdPerQuote,
						deal.id,
						{
							paths: 1500,
							windows: ['long'],
							towards: { rate, by: record?.view_date ?? null }
						}
					);
		return { plain, view: typeof tilted === 'string' ? null : tilted };
	});
	const range = (
		pick: (o: {
			p_pays: number;
			typical: number;
			bad: number;
			p_knock_out: number | null;
			p_target: number | null;
			p_convert: number | null;
		}) => number | null,
		money = false
	) => {
		const all =
			likely === null || typeof likely.plain === 'string'
				? []
				: likely.plain.map(pick).filter((x): x is number => x !== null);
		if (all.length === 0) return '—';
		const [lo, hi] = [Math.min(...all), Math.max(...all)];
		const f = (x: number) => (money ? `USD ${num(x)}` : pct(x));
		return lo === hi ? f(lo) : `${f(lo)} – ${f(hi)}`;
	};
	const act = use_act(ctx);
	const move = (status: 'draft' | 'live') => {
		if (record === null) return;
		act.run(ctx.act({ 'fx_deal.update': [{ target: record, set: { status } }] }));
	};
</script>

{#snippet next()}
	{#if record?.status === 'proposal'}<Button
			variant="outline"
			disabled={act.pending}
			onclick={() => move('draft')}>{t('fx.traded')}</Button
		>{/if}
	{#if record?.status === 'draft'}<Button
			variant="outline"
			disabled={act.pending}
			onclick={() => move('live')}>{t('fx.confirm')}</Button
		>{/if}
{/snippet}

{#snippet today()}
	<Stack gap="md">
		{#if v === null || v.spot === null}
			<p class="text-meta">{t('fx.no_rate')}</p>
		{:else if deal !== null}
			{#each watch(deal, v, day.today) as w (w.key)}
				<Alert.Root variant={w.warn ? 'warning' : 'default'}>
					<Alert.Description>
						<Inline gap="xs" align="center">
							<Icon name={w.warn ? 'lucide:triangle-alert' : 'lucide:info'} class="size-4" />
							<span>{t(w.key, w.values)}</span>
						</Inline>
					</Alert.Description>
				</Alert.Root>
			{/each}
			<Grid minimum="compact">
				{#each [[t('fx.spot'), v.spot.toFixed(4)], [t('fx.state'), t(`fx.state.${v.state}`)], [t('fx.value_today'), v.position?.total_usd == null ? '—' : `USD ${num(v.position.total_usd)}`], [t('fx.ko_distance'), v.position?.ko_distance_pct == null ? '—' : `${v.position.ko_distance_pct.toFixed(2)}%`], [t('fx.target_used'), v.target_used_pct === null ? '—' : `${v.target_used_pct.toFixed(0)}%`], [t('fx.open_fixings'), String(v.open.length)]] as const as [title, value] (title)}
					<div class="rounded-xl border border-border bg-card p-4">
						<Stack gap="xs">
							<p class="text-meta">{title}</p>
							<p class="text-heading tabular-nums">{value}</p>
						</Stack>
					</div>
				{/each}
			</Grid>
			<Table
				{ctx}
				of={(v.position?.fixings ?? []).map((p) => ({
					date: deal.fixings.find((f) => f.id === p.id)?.fixing_date ?? null,
					firm: p.firm ? t('fx.firm') : t('fx.conditional'),
					leveraged: p.leveraged ? t('fx.leveraged_amount') : '',
					usd: p.usd === null ? null : p.usd.toFixed(0)
				}))}
				controlled
				embedded
				columns={[
					{ field: 'date', label: t('fx.fixing'), kind: { kind: 'date' } },
					{ field: 'firm', label: t('fx.kind') },
					{ field: 'leveraged', label: t('fx.amount_used') },
					{ field: 'usd', label: t('fx.usd_today'), kind: { kind: 'decimal', scale: 0 } }
				]}
			/>
		{/if}
	</Stack>
{/snippet}

{#snippet outcomes()}
	<Table
		{ctx}
		of={results}
		controlled
		embedded
		columns={[
			{ field: 'fixing_date', label: t('fx.fixing'), kind: { kind: 'date' } },
			{ field: 'fixing_rate', label: t('fx.fixed_at'), kind: { kind: 'decimal', scale: 4 } },
			{ field: 'outcome', label: t('fx.result') },
			{ field: 'auto', label: t('fx.worked_out') },
			{ field: 'amount', label: t('fx.exchanged'), kind: { kind: 'decimal', scale: 2 } },
			{ field: 'gain', label: t('fx.gain_quote'), kind: { kind: 'decimal', scale: 0 } },
			{ field: 'gain_usd', label: t('fx.gain_usd'), kind: { kind: 'decimal', scale: 0 } }
		]}
	/>
{/snippet}

{#snippet played()}
	<Stack gap="sm">
		<label class="grid gap-1 text-meta"
			>{t('fx.rates_to_try')}<input
				class="rounded-md border border-input bg-background px-2 py-1 text-sm"
				bind:value={extra}
				placeholder="1.3500, 1.2500"
			/></label
		>
		<Table
			{ctx}
			of={table}
			controlled
			embedded
			columns={[
				{ field: 'rate', label: t('fx.rate'), align: 'end' },
				{ field: 'vs_today', label: t('fx.vs_today'), align: 'end' },
				{ field: 'usd', label: t('fx.usd_result'), kind: { kind: 'decimal', scale: 0 } },
				{ field: 'settle', label: t('fx.settle') },
				{ field: 'what', label: t('fx.what_happens') }
			]}
		/>
	</Stack>
{/snippet}

{#snippet chances()}
	<Stack gap="md">
		{#if !showOdds}
			<Button variant="outline" onclick={() => (showOdds = true)}>{t('fx.work_out_odds')}</Button>
		{:else if likely === null}
			<p class="text-meta">{t('fx.no_rate')}</p>
		{:else if typeof likely.plain === 'string'}
			<p class="text-meta">{likely.plain}</p>
		{:else if deal !== null && v !== null && v.spot !== null}
			<Grid minimum="compact">
				{#each [[t('fx.p_knock_out'), range((o) => o.p_knock_out)], [t('fx.p_target'), range((o) => o.p_target)], [t('fx.p_pays'), range((o) => o.p_pays)], [t('fx.typical'), range((o) => o.typical, true)], [t('fx.bad_case'), range((o) => o.bad, true)], [t('fx.p_convert'), range((o) => o.p_convert)]] as const as [title, value] (title)}
					{#if value !== '—'}<div class="rounded-xl border border-border bg-card p-4">
							<Stack gap="xs">
								<p class="text-meta">{title}</p>
								<p class="text-heading tabular-nums">{value}</p>
							</Stack>
						</div>{/if}
				{/each}
			</Grid>
			<p class="text-meta">{t('fx.odds_basis')}</p>
			{#each pointsToWeigh(deal, v.open, v.spot, likely.plain, v.position?.total_usd == null ? null : Math.abs(v.position.total_usd), day.today) as p (p.key)}
				<Alert.Root variant={p.warn ? 'warning' : 'default'}>
					<Alert.Description>
						<Inline gap="xs" align="center">
							<Icon name={p.warn ? 'lucide:triangle-alert' : 'lucide:check'} class="size-4" />
							<span>{t(p.key, p.values)}</span>
						</Inline>
					</Alert.Description>
				</Alert.Root>
			{/each}
			{#if likely.view !== null && likely.view[0] !== undefined}
				{@const o = likely.view[0]}
				<Alert.Root variant={o.typical < 0 ? 'warning' : 'default'}
					><Alert.Description
						>{t(
							o.typical > 0 && o.p_pays < 0.5
								? 'fx.view.fits'
								: o.typical < 0
									? 'fx.view.against'
									: 'fx.view.mixed',
							{ typical: num(o.typical), pays: pct(o.p_pays) }
						)}</Alert.Description
					></Alert.Root
				>
			{/if}
		{/if}
	</Stack>
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="fx_deal"
		{sections}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
	/>
{:else}
	<RecordShell
		{ctx}
		of="fx_deal"
		{sections}
		id={record.id}
		subtitle={['pair', 'structure']}
		footer_actions={next}
		tabs={[
			{ name: 'today', title: t('fx.tab.today'), icon: 'lucide:gauge', body: today },
			{ name: 'results', title: t('fx.tab.results'), icon: 'lucide:list-checks', body: outcomes },
			{
				name: 'scenarios',
				title: t('fx.tab.scenarios'),
				icon: 'lucide:sliders-horizontal',
				body: played
			},
			{ name: 'odds', title: t('fx.tab.odds'), icon: 'lucide:dice-5', body: chances }
		]}
	/>
{/if}
