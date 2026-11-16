<script lang="ts">
	/**
	 * Where should an invoice go? The calculator ranks every bank by all-in cost (interest at the bank's recent rate
	 * plus its charges from the fee rules) and flags the banks that cannot take it: no room, supplier not accepted, tenor
	 * too long, no rate history. The comparison and the monthly rates are for negotiations. USD trade financing only.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, EmptyState, Input, Table } from '@norbital-ai/ui';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	import { PRODUCTS, PRODUCT_CODES, type Product } from '../../lib/products.js';
	import {
		FACILITY_FIELDS,
		LINE_FIELDS,
		bankSummary,
		chargesSummary,
		compareInvoice,
		rateByMonth
	} from '../../lib/treasury.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	let report = $state('calculator');
	const read = ctx.query({
		facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
		drawdown: {
			where: { status: { in: ['earmarked', 'applied', 'active', 'settled', 'unclear'] } },
			fields: [...LINE_FIELDS, 'charge_rate_pct', 'supplier'],
			charges: { fields: ['amount', 'fx_rate_to_usd', 'charge_type', 'stage'] }
		},
		facility_fee: {
			fields: [
				'facility',
				'fee_type',
				'product',
				'stage',
				'method',
				'currency',
				'rate_pct',
				'amount',
				'minimum_amount',
				'minimum_currency',
				'include_in_estimates'
			]
		},
		fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] },
		sub_limit: { fields: ['facility', 'name', 'product', 'supplier', 'limit'] },
		business_partner: {
			where: { is_active: { eq: true } },
			fields: ['name'],
			eligible_banks: { fields: ['bank'], bank: { fields: ['code'] } }
		}
	});
	const facilities = $derived(read.current?.facility.rows ?? []);
	const incomplete = $derived(Object.values(read.current ?? {}).some((page) => page.next != null));
	const lines = $derived(read.current?.drawdown.rows ?? []);
	const banks = $derived(new Map(facilities.map((f) => [f.id, f.bank?.code ?? '—'])));

	let amount = $state('500000');
	let tenor = $state('150');
	let product = $state<Product>('if');
	let supplier = $state<string | null>(null);
	const chosen = $derived(read.current?.business_partner.rows.find((s) => s.id === supplier));
	const eligible = $derived(
		chosen === undefined ? null : new Set(chosen.eligible_banks.map((e) => e.bank?.code ?? ''))
	);
	const quotes = $derived(
		Number(amount) > 0 && Number(tenor) > 0
			? compareInvoice(
					{
						amount: String(Number(amount)),
						tenor: Number(tenor),
						product,
						eligible,
						supplier,
						as_of: day.today
					},
					facilities,
					lines,
					read.current?.facility_fee.rows ?? [],
					read.current?.fx_rate.rows ?? [],
					read.current?.sub_limit.rows ?? []
				).map((q) => ({
					...q,
					notes: q.notes.map((n) => t(NOTES[n as keyof typeof NOTES])).join(' · ')
				}))
			: []
	);
	const NOTES = {
		supplier: 'app.costs.note_supplier',
		room: 'app.costs.note_room',
		tenor: 'app.costs.note_tenor',
		rate: 'app.costs.note_rate',
		fx: 'app.costs.note_fx'
	} as const;
	const summary = $derived(
		bankSummary(
			facilities,
			lines,
			day.today,
			chargesSummary(
				lines,
				banks,
				read.current?.facility_fee.rows ?? [],
				read.current?.fx_rate.rows ?? [],
				day.today
			)
		)
	);
	const heat = $derived<Record<string, string | null>[]>(rateByMonth(lines, banks, day.today));
	const months = $derived(Object.keys(heat[0] ?? {}).filter((k) => k !== 'bank'));
</script>

{#snippet calculator()}
	<Stack gap="md">
		<Cluster gap="sm">
			<Input type="number" class="w-40" aria-label={t('app.costs.amount')} bind:value={amount} />
			<Input type="number" class="w-28" aria-label={t('app.costs.tenor')} bind:value={tenor} />
			<Combobox
				class="w-56"
				aria-label={t('app.costs.product')}
				options={PRODUCT_CODES.filter((p) => PRODUCTS[p].trade).map((p) => ({
					value: p,
					label: t(`models.drawdown.fields.product.${p}`)
				}))}
				value={product}
				on_change={(v) => (product = v ?? 'if')}
			/>
			<Combobox
				class="w-56"
				aria-label={t('app.costs.supplier')}
				placeholder={t('app.costs.any_supplier')}
				clearable
				options={(read.current?.business_partner.rows ?? []).map((s) => ({
					value: s.id,
					label: s.name
				}))}
				value={supplier}
				on_change={(v) => (supplier = v)}
			/>
		</Cluster>
		<Table
			{ctx}
			of={quotes}
			controlled
			embedded
			columns={[
				{ field: 'bank', label: t('app.line.bank') },
				{ field: 'rate', label: t('app.costs.rate'), align: 'end' },
				{
					field: 'interest',
					label: t('app.dashboard.interest'),
					kind: { kind: 'decimal', scale: 2 }
				},
				{ field: 'charges', label: t('app.costs.charges'), kind: { kind: 'decimal', scale: 2 } },
				{ field: 'total', label: t('app.costs.total'), kind: { kind: 'decimal', scale: 2 } },
				{ field: 'all_in_pct', label: t('app.costs.all_in'), align: 'end' },
				{ field: 'notes', label: t('app.costs.notes') }
			]}
		/>
	</Stack>
{/snippet}
{#snippet comparison()}
	<Table
		{ctx}
		of={summary}
		controlled
		columns={[
			{ field: 'rank', label: t('app.costs.rank') },
			{ field: 'bank', label: t('app.line.bank') },
			{ field: 'latest_rate', label: t('app.costs.latest_rate'), align: 'end' },
			{ field: 'recent_rate', label: t('app.costs.recent_rate'), align: 'end' },
			{ field: 'spread_bps', label: t('app.costs.spread') },
			{ field: 'book_rate', label: t('app.costs.book_rate'), align: 'end' },
			{ field: 'charges_pct', label: t('app.charges.pct_of_amount'), align: 'end' },
			{ field: 'charges_pa', label: t('app.charges.pct_per_annum'), align: 'end' },
			{ field: 'all_in_pct', label: t('app.costs.all_in'), align: 'end' },
			{ field: 'margin_pct', label: t('app.costs.margin'), align: 'end' },
			{ field: 'available', label: t('app.line.available'), kind: { kind: 'decimal', scale: 2 } }
		]}
		toolbar={{ title: t('app.costs.comparison') }}
	/>
{/snippet}
{#snippet rates()}
	<Table
		{ctx}
		of={heat}
		controlled
		layout="grid"
		columns={[
			{ field: 'bank', label: t('app.line.bank') },
			...months.map((m) => ({ field: m, label: m, align: 'end' as const }))
		]}
		toolbar={{ title: t('app.costs.by_month') }}
	/>
{/snippet}

<AppShell
	icon="lucide:percent"
	title={t('app.costs.title')}
	description={t('app.costs.description')}
>
	{#if read.error}
		<EmptyState title={t('app.dashboard.error')} hint={read.error.message} />
	{:else if read.current === undefined}
		<EmptyState title={t('app.dashboard.loading')} />
	{:else if incomplete}
		<EmptyState title={t('app.dashboard.error')} hint={t('reports.incomplete')} />
	{:else}
		<Stack gap="md">
			<Combobox
				class="w-56"
				aria-label={t('app.costs.report')}
				options={[
					{ value: 'calculator', label: t('app.costs.calculator') },
					{ value: 'comparison', label: t('app.costs.comparison') },
					{ value: 'rates', label: t('app.costs.by_month') }
				]}
				value={report}
				on_change={(value) => (report = value ?? 'calculator')}
			/>
			{#if report === 'calculator'}{@render calculator()}
			{:else if report === 'comparison'}{@render comparison()}
			{:else}{@render rates()}{/if}
		</Stack>
	{/if}
</AppShell>
