<script lang="ts">
	/**
	 * Where should an invoice go? The calculator ranks every bank by all-in cost (interest at the bank's recent rate
	 * plus its charges from the fee rules) and flags the banks that cannot take it: no room, supplier not accepted, tenor
	 * too long, no rate history. The comparison and the monthly rates are for negotiations. USD trade financing only.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Combobox,
		EmptyState,
		Input,
		Label,
		Table,
		TableSkeleton,
		Tabs,
		format
	} from '@norbital-ai/ui';
	import { AppShell, Cluster, Cover, Grid, Stack } from '@norbital-ai/ui/layout';
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
			fields: ['name'],
			eligible_banks: { fields: ['bank'], bank: { fields: ['code'] } }
		}
	});
	const facilities = $derived(read.current?.facility.rows ?? []);
	const facilityNames = $derived(new Map<string, string>(facilities.map((f) => [f.id, f.name])));
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
	const NOTES = {
		supplier: 'app.costs.note_supplier',
		room: 'app.costs.note_room',
		tenor: 'app.costs.note_tenor',
		rate: 'app.costs.note_rate',
		fx: 'app.costs.note_fx'
	} as const;
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
					facility_name: facilityNames.get(q.facility) ?? '—',
					notes: q.notes.map((n) => t(NOTES[n])).join(' · ')
				}))
			: []
	);
	const best = $derived(quotes.find((q) => q.ok));
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
		).map((row) => ({
			...row,
			facility_name: facilityNames.get(row.facility) ?? '—'
		}))
	);
	const heat = $derived<Record<string, string | null>[]>(
		rateByMonth(lines, banks, day.today).map((row) => ({
			...row,
			bank: row.bank === 'all' ? t('app.dashboard.all_banks') : row.bank
		}))
	);
	const months = $derived(Object.keys(heat[0] ?? {}).filter((k) => k !== 'bank'));
	const usd = (value: string | null) =>
		value === null
			? '—'
			: format({ kind: 'money' }, value, { locale: ctx.locale, currency: 'USD' });
</script>

{#snippet eligibilityCell({ value }: { value: boolean | undefined })}
	<Badge variant={value ? 'success' : 'warning'}>
		{value ? t('app.costs.eligible') : t('app.costs.ineligible')}
	</Badge>
{/snippet}

{#snippet calculatorTop()}
	<Stack gap="sm">
		<div class="rounded-md border border-border bg-card p-4">
			<Grid minimum="compact" gap="sm">
				<Stack gap="xs">
					<Label for="costs-amount">{t('app.costs.amount')}</Label>
					<Input id="costs-amount" type="number" bind:value={amount} />
				</Stack>
				<Stack gap="xs">
					<Label for="costs-tenor">{t('app.costs.tenor')}</Label>
					<Input id="costs-tenor" type="number" bind:value={tenor} />
				</Stack>
				<Stack gap="xs">
					<Label for="costs-product">{t('app.costs.product')}</Label>
					<Combobox
						id="costs-product"
						options={PRODUCT_CODES.filter((p) => PRODUCTS[p].trade).map((p) => ({
							value: p,
							label: t(`models.drawdown.fields.product.${p}`)
						}))}
						value={product}
						on_change={(v) => (product = v ?? 'if')}
					/>
				</Stack>
				<Stack gap="xs">
					<Label for="costs-supplier">{t('app.costs.supplier')}</Label>
					<Combobox
						id="costs-supplier"
						placeholder={t('app.costs.any_supplier')}
						clearable
						options={(read.current?.business_partner.rows ?? []).map((s) => ({
							value: s.id,
							label: s.name
						}))}
						value={supplier}
						on_change={(v) => (supplier = v)}
					/>
				</Stack>
			</Grid>
		</div>
		{#if quotes.length > 0}
			<Cluster
				gap="sm"
				align="center"
				class="rounded-md border border-border bg-card px-4 py-2.5 text-sm"
			>
				{#if best}
					<Badge variant="success">{t('app.costs.eligible')}</Badge>
					<span class="tabular-nums">
						{t('app.costs.best_option', {
							bank: best.bank,
							facility: best.facility_name,
							rate: best.all_in_pct === null ? '—' : Number(best.all_in_pct).toFixed(2),
							total: usd(best.total)
						})}
					</span>
				{:else}
					<Badge variant="warning">{t('app.costs.ineligible')}</Badge>
					<span class="text-muted-foreground">{t('app.costs.no_eligible')}</span>
				{/if}
			</Cluster>
		{/if}
	</Stack>
{/snippet}

{#snippet calculator()}
	{#if read.error}
		<EmptyState title={t('app.dashboard.error')} hint={read.error.message} />
	{:else if read.current === undefined}
		<div aria-busy="true"><TableSkeleton /></div>
	{:else if incomplete}
		<EmptyState title={t('app.dashboard.error')} hint={t('reports.incomplete')} />
	{:else}
		<Cover size="fill" gap="md" top={calculatorTop}>
			<Table
				{ctx}
				of={quotes}
				controlled
				toolbar={{ title: false }}
				columns={[
					{ field: 'bank', label: t('app.line.bank') },
					{ field: 'facility_name', label: t('app.line.facility') },
					{ field: 'ok', label: t('app.costs.eligibility'), cell: eligibilityCell },
					{
						field: 'rate',
						label: t('app.costs.rate'),
						kind: { kind: 'decimal', scale: 2 },
						align: 'end'
					},
					{
						field: 'interest',
						label: t('app.dashboard.interest'),
						kind: { kind: 'money', currency: 'USD' },
						align: 'end'
					},
					{
						field: 'charges',
						label: t('app.costs.charges'),
						kind: { kind: 'money', currency: 'USD' },
						align: 'end'
					},
					{
						field: 'total',
						label: t('app.costs.total'),
						kind: { kind: 'money', currency: 'USD' },
						align: 'end'
					},
					{
						field: 'all_in_pct',
						label: t('app.costs.all_in'),
						kind: { kind: 'decimal', scale: 2 },
						align: 'end'
					},
					{ field: 'notes', label: t('app.costs.notes') }
				]}
			/>
		</Cover>
	{/if}
{/snippet}

{#snippet comparison()}
	{#if read.error}
		<EmptyState title={t('app.dashboard.error')} hint={read.error.message} />
	{:else if read.current === undefined}
		<div aria-busy="true"><TableSkeleton /></div>
	{:else if incomplete}
		<EmptyState title={t('app.dashboard.error')} hint={t('reports.incomplete')} />
	{:else}
		<Table
			{ctx}
			of={summary}
			controlled
			toolbar={{ title: false }}
			columns={[
				{ field: 'rank', label: t('app.costs.rank'), kind: { kind: 'int' }, align: 'end' },
				{ field: 'bank', label: t('app.line.bank') },
				{ field: 'facility_name', label: t('app.line.facility') },
				{
					field: 'latest_rate',
					label: t('app.costs.latest_rate'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{
					field: 'recent_rate',
					label: t('app.costs.recent_rate'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{ field: 'spread_bps', label: t('app.costs.spread'), kind: { kind: 'int' }, align: 'end' },
				{
					field: 'book_rate',
					label: t('app.costs.book_rate'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{
					field: 'charges_pct',
					label: t('app.charges.pct_of_amount'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{
					field: 'charges_pa',
					label: t('app.charges.pct_per_annum'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{
					field: 'all_in_pct',
					label: t('app.costs.all_in'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{
					field: 'margin_pct',
					label: t('app.costs.margin'),
					kind: { kind: 'decimal', scale: 2 },
					align: 'end'
				},
				{
					field: 'available',
					label: t('app.line.available'),
					kind: { kind: 'money', currency: 'USD' },
					align: 'end'
				}
			]}
		/>
	{/if}
{/snippet}

{#snippet rates()}
	{#if read.error}
		<EmptyState title={t('app.dashboard.error')} hint={read.error.message} />
	{:else if read.current === undefined}
		<div aria-busy="true"><TableSkeleton /></div>
	{:else if incomplete}
		<EmptyState title={t('app.dashboard.error')} hint={t('reports.incomplete')} />
	{:else}
		<Table
			{ctx}
			of={heat}
			controlled
			layout="grid"
			toolbar={{ title: false }}
			columns={[
				{ field: 'bank', label: t('app.line.bank') },
				...months.map((m) => ({
					field: m,
					label: m,
					kind: { kind: 'decimal', scale: 2 } as const,
					align: 'end' as const
				}))
			]}
		/>
	{/if}
{/snippet}

<AppShell
	icon="lucide:percent"
	title={t('app.costs.title')}
	description={t('app.costs.description')}
	variant="full"
>
	<Tabs
		value={report}
		on_value_change={(value) => (report = value)}
		tabs={[
			{ name: 'calculator', title: t('app.costs.calculator'), body: calculator },
			{ name: 'comparison', title: t('app.costs.comparison'), body: comparison },
			{ name: 'rates', title: t('app.costs.by_month'), body: rates }
		]}
	/>
</AppShell>
