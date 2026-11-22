<script lang="ts">
	/**
	 * A banker's proposal: pasted text or its file, then its alternatives side by side at today's official rate —
	 * strike against today, knock-out distance, target, fixings left, the largest amount on one fixing, how likely a
	 * knock-out, the target or a payment is, the bad case, and every open fixing at spot ±2/4/6%. Open an alternative
	 * to weigh it alone or mark it traded.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		RecordShell,
		Table,
		open_record,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { dealView, odds, pairHistory, play, type FxDealRow } from '../../../lib/fx.js';
	let { view, ctx }: { view: RecordView<'fx_proposal'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const sections: readonly RecordSection[] = [
		{
			name: 'proposal',
			icon: 'lucide:lightbulb',
			title: t('fx.proposal'),
			fields: ['title', 'bank', 'text', 'file']
		},
		{
			name: 'reading',
			icon: 'lucide:scan-text',
			title: t('fx.reading'),
			fields: ['read_status', 'read_note'],
			default_open: false
		}
	];
	const record = $derived(view.mode === 'create' ? null : view.record);
	const read = $derived.by(() =>
		record === null
			? null
			: ctx.query({
					fx_deal: {
						where: { proposal: { eq: record.id } },
						fields: [
							'pair',
							'status',
							'structure',
							'side',
							'notional_currency',
							'notional',
							'leveraged_notional',
							'strike',
							'knock_out',
							'knock_out_type',
							'knock_in',
							'target',
							'target_rule',
							'dci_deposit_currency',
							'dci_deposit_amount',
							'dci_yield_pct',
							'ended_on',
							'trade_date',
							'spot_reference',
							'forward_reference',
							'forward_reference_date',
							'notes'
						],
						fixings: {
							fields: [
								'fixing_date',
								'settlement_date',
								'notional',
								'leveraged_notional',
								'strike',
								'firm',
								'condition',
								'condition_side',
								'condition_level',
								'fixing_rate',
								'outcome',
								'settled_amount'
							]
						}
					},
					fx_rate: {
						fields: ['currency', 'rate_date', 'usd_per_unit'],
						order_by: { rate_date: 'asc' },
						limit: 10000
					}
				})
	);
	const deals = $derived<readonly (FxDealRow & { readonly notes: string | null })[]>(
		read?.current?.fx_deal.rows ?? []
	);
	const rates = $derived(read?.current?.fx_rate.rows ?? []);
	let compare = $state(false);
	const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(0)}%`);
	const span = (all: readonly (number | null)[], f: (n: number) => string) => {
		const xs = all.filter((x): x is number => x !== null);
		if (xs.length === 0) return '—';
		const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
		return lo === hi ? f(lo) : `${f(lo)} – ${f(hi)}`;
	};
	const columns = $derived.by(() => {
		if (!compare) return [];
		return deals.map((d) => {
			const v = dealView(d, rates, day.today);
			const o =
				v.spot === null
					? 'No rate'
					: odds(
							d,
							v.open,
							pairHistory(d.pair, rates),
							v.spot,
							day.today,
							v.worked.target_used,
							v.usdPerQuote,
							d.id
						);
			const list = typeof o === 'string' ? [] : o;
			const largest = Math.max(
				0,
				...v.open.map((f) =>
					Number(f.leveraged_notional ?? d.leveraged_notional ?? f.notional ?? d.notional ?? 0)
				)
			);
			const strike = d.strike === null ? null : Number(d.strike);
			const at = (p: number) =>
				v.spot === null
					? '—'
					: play(
							d,
							v.open,
							() => (v.spot ?? 0) * (1 + p / 100),
							v.worked.target_used,
							v.usdPerQuote
						).usd.toFixed(0);
			return {
				id: d.id,
				name: d.notes ?? `${d.pair} ${d.structure}`,
				rows: new Map<string, string>(
					Object.entries({
						structure: t(`models.fx_deal.fields.structure.${d.structure}`),
						side: d.side ?? '—',
						strike:
							strike === null
								? '—'
								: `${strike}${v.spot === null ? '' : ` (${((strike / v.spot - 1) * 100).toFixed(2)}%)`}`,
						knock_out:
							d.knock_out === null
								? '—'
								: `${d.knock_out} (${v.position?.ko_distance_pct?.toFixed(1) ?? '—'}%)`,
						target: d.target ?? '—',
						left: String(v.open.length),
						largest: largest.toLocaleString(ctx.locale),
						p_knock_out: span(
							list.map((x) => x.p_knock_out),
							pct
						),
						p_target: span(
							list.map((x) => x.p_target),
							pct
						),
						p_pays: span(
							list.map((x) => x.p_pays),
							pct
						),
						bad: span(
							list.map((x) => x.bad),
							(n) => `USD ${n.toFixed(0)}`
						),
						...Object.fromEntries([-6, -4, -2, 0, 2, 4, 6].map((p) => [`at_${p}`, at(p)]))
					})
				)
			};
		});
	});
	const LABELS = [
		['structure', t('fx.compare.structure')],
		['side', t('fx.compare.side')],
		['strike', t('fx.compare.strike')],
		['knock_out', t('fx.compare.knock_out')],
		['target', t('fx.compare.target')],
		['left', t('fx.compare.left')],
		['largest', t('fx.compare.largest')],
		['p_knock_out', t('fx.compare.p_knock_out')],
		['p_target', t('fx.compare.p_target')],
		['p_pays', t('fx.compare.p_pays')],
		['bad', t('fx.compare.bad')],
		...[-6, -4, -2, 0, 2, 4, 6].map((p) => [
			`at_${p}`,
			t('fx.compare.at', { pct: p > 0 ? `+${p}` : String(p) })
		])
	] as const;
</script>

{#snippet alternatives()}
	<Stack gap="md">
		<Table
			{ctx}
			of={deals.map((d) => ({
				id: d.id,
				name: d.notes ?? '—',
				pair: d.pair,
				structure: t(`models.fx_deal.fields.structure.${d.structure}`),
				strike: d.strike,
				knock_out: d.knock_out,
				target: d.target,
				status: t(`models.fx_deal.fields.status.${d.status}`)
			}))}
			controlled
			embedded
			columns={[
				{ field: 'name', label: t('fx.alternative') },
				{ field: 'pair', label: t('fx.pair') },
				{ field: 'structure', label: t('fx.structure') },
				{ field: 'strike', label: t('fx.strike') },
				{ field: 'knock_out', label: t('fx.knock_out') },
				{ field: 'target', label: t('fx.target') },
				{ field: 'status', label: t('fx.status') }
			]}
			on_open={(row) => open_record('fx_deal', row.id)}
		/>
		{#if !compare}
			<Button variant="outline" onclick={() => (compare = true)}>{t('fx.compare')}</Button>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr>
							<th></th>
							{#each columns as c (c.id)}<th class="px-2 py-1 text-left text-label">{c.name}</th
								>{/each}
						</tr>
					</thead>
					<tbody>
						{#each LABELS as [key, label] (key)}
							<tr class="border-t border-border">
								<td class="px-2 py-1 text-meta">{label}</td>
								{#each columns as c (c.id)}<td class="px-2 py-1 tabular-nums"
										>{c.rows.get(key) ?? '—'}</td
									>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Stack>
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="fx_proposal"
		{sections}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		fields={['text', 'file', 'bank']}
		footer={t('fx.proposal_hint')}
	/>
{:else}
	<RecordShell
		{ctx}
		of="fx_proposal"
		{sections}
		id={record.id}
		subtitle={['bank', 'read_status']}
		tabs={[
			{
				name: 'alternatives',
				title: t('fx.alternatives'),
				icon: 'lucide:git-compare',
				body: alternatives
			}
		]}
	/>
{/if}
