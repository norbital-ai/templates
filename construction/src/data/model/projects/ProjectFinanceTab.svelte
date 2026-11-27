<script lang="ts">
	/**
	 * Project Hub → Finance tab: Overview KPIs & cashflow chart, Catalog Cashflow Ledger,
	 * Client Contracts, Subcontracts, and Ad-hoc Costs.
	 */
	import type { Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Alert, Badge, Chart, Show, Spinner, Surface, Table, Tabs } from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import {
		computeCatalogCashflowBreakdown,
		computeProjectCashflow,
		computeProjectCommercial
	} from '../../../services/commercial/analytics.js';
	import { toNumber } from '../../../services/commercial/decimal.js';

	let {
		ctx,
		record,
		today,
		onCreateContract,
		onCreateAdhocCost
	}: {
		ctx: PageContext;
		record: Row<'projects'>;
		today: string;
		onCreateContract: (
			direction: 'upstream' | 'downstream',
			contract_type: 'main_contract' | 'subcontract'
		) => void;
		onCreateAdhocCost: () => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const money = { kind: 'money', currency: 'currency' } as const;

	const financeQuery = $derived(
		ctx.query({
			contracts: {
				where: { project_id: { eq: record.id } },
				fields: [
					'contract_number',
					'title',
					'direction',
					'contract_type',
					'status',
					'contract_value',
					'retention_rate',
					'retention_cap_rate',
					'tax_rate',
					'lines',
					'schedule_impact_days',
					'signed_date'
				],
				order_by: { created_at: 'asc' },
				limit: 300
			},
			commercial_documents: {
				where: { project_id: { eq: record.id } },
				fields: [
					'doc_type',
					'direction',
					'status',
					'lines',
					'total_amount',
					'certified_amount',
					'net_amount',
					'issue_date',
					'due_date',
					'paid_date'
				],
				order_by: { issue_date: 'asc' },
				limit: 500
			},
			adhoc_costs: {
				where: { project_id: { eq: record.id } },
				fields: ['status', 'title', 'unit', 'qty', 'amount', 'catalog_item_id'],
				limit: 300
			},
			item_matrix: { fields: ['code', 'name'], limit: 500 },
			tasks: {
				where: { project_id: { eq: record.id } },
				fields: ['status', 'progress_pct', 'is_milestone'],
				limit: 2000
			},
			cost_estimates: {
				where: { project_id: { eq: record.id } },
				fields: ['status', 'bim_assets'],
				limit: 1
			}
		})
	);

	const commercial = $derived(
		financeQuery.current
			? computeProjectCommercial({
					contracts: financeQuery.current.contracts.rows,
					tasks: financeQuery.current.tasks.rows,
					documents: financeQuery.current.commercial_documents.rows
				})
			: null
	);
	const cashflow = $derived(
		financeQuery.current
			? computeProjectCashflow(financeQuery.current.commercial_documents.rows, today)
			: null
	);
	const cashflowMonths = $derived(
		(cashflow?.months ?? []).map((m) => ({
			month: m.month,
			[t('cashflow.series_in')]: m.inflow,
			[t('cashflow.series_out')]: m.outflow
		}))
	);
	const catalogLedgerRows = $derived.by(() => {
		const data = financeQuery.current;
		if (!data) return [];
		const est = data.cost_estimates.rows[0];
		const bimAssets = est && est.status !== 'void' ? (est.bim_assets ?? []) : [];
		const matrixById = new Map(data.item_matrix.rows.map((m) => [m.id, m] as const));
		const breakdown = computeCatalogCashflowBreakdown({
			bim_assets: bimAssets,
			adhoc_costs: data.adhoc_costs.rows.map((c) => {
				const cat = matrixById.get(c.catalog_item_id);
				return {
					status: c.status,
					catalog_code: cat?.code ?? null,
					catalog_name: cat?.name ?? null,
					title: c.title,
					unit: c.unit,
					amount: c.amount
				};
			}),
			contracts: data.contracts.rows,
			documents: data.commercial_documents.rows
		});
		return breakdown.rows.map((r) => ({
			...r,
			id: r.code,
			source_label:
				r.source === 'adhoc_catalog'
					? t('priced_lines.badge_catalog')
					: t('priced_lines.badge_bim'),
			currency: record.currency ?? 'SGD'
		}));
	});
	const hasAnyKpi = $derived(
		commercial !== null &&
			cashflow !== null &&
			(toNumber(commercial.revised_contract_sum) !== 0 ||
				toNumber(commercial.committed_downstream) !== 0 ||
				toNumber(cashflow.net_projected_cashflow) !== 0 ||
				toNumber(commercial.projected_margin_pct) !== 0 ||
				toNumber(commercial.overall_progress_pct) !== 0)
	);
</script>

{#snippet financeOverviewTab()}
	<Scroll name={t('finance.overview')} size="fill" inset>
		<Surface tone="card" padding="md" radius="control">
			<Stack gap="md" divided>
				<Cluster align="center" justify="end" gap="sm">
					<Cluster gap="xs">
						{#if cashflow && toNumber(cashflow.overdue_receivables) > 0}
							<Badge variant="warning"
								>{t('cashflow.overdue_in', { amount: cashflow.overdue_receivables })}</Badge
							>
						{/if}
						{#if cashflow && toNumber(cashflow.overdue_payables) > 0}
							<Badge variant="destructive"
								>{t('cashflow.overdue_out', { amount: cashflow.overdue_payables })}</Badge
							>
						{/if}
						{#if (record.open_task_count ?? 0) > 0}
							<Badge variant="outline">
								{t('component.open_tasks_count', { tasks: record.open_task_count ?? 0 })}
							</Badge>
						{/if}
					</Cluster>
				</Cluster>

				{#if financeQuery.loading && !financeQuery.current}
					<Inline gap="sm" align="center" aria-busy="true">
						<Spinner />
						<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
					</Inline>
				{:else if financeQuery.error}
					<Alert.Root variant="destructive"
						><Alert.Title>{financeQuery.error.message}</Alert.Title></Alert.Root
					>
				{:else if commercial && cashflow && hasAnyKpi}
					<Grid minimum="card" gap="md">
						{#if toNumber(commercial.revised_contract_sum) !== 0}
							<Stack gap="xs">
								<Inline gap="xs" align="center">
									<Badge variant="success">{t('cashflow.side_in')}</Badge>
									<span class="text-meta">{t('commercial.revised_contract_sum')}</span>
								</Inline>
								<span class="text-label tabular-nums">
									<Show
										{ctx}
										kind={money}
										value={commercial.revised_contract_sum}
										row={{ currency: record.currency }}
									/>
								</span>
							</Stack>
						{/if}
						{#if toNumber(commercial.committed_downstream) !== 0}
							<Stack gap="xs">
								<Inline gap="xs" align="center">
									<Badge variant="warning">{t('cashflow.side_out')}</Badge>
									<span class="text-meta">{t('commercial.committed_subcon')}</span>
								</Inline>
								<span class="text-label tabular-nums">
									<Show
										{ctx}
										kind={money}
										value={commercial.committed_downstream}
										row={{ currency: record.currency }}
									/>
								</span>
							</Stack>
						{/if}
						{#if toNumber(cashflow.net_projected_cashflow) !== 0}
							<Stack gap="xs">
								<Inline gap="xs" align="center">
									<Badge variant="outline">{t('cashflow.side_net')}</Badge>
									<span class="text-meta">{t('cashflow.net_projected')}</span>
								</Inline>
								<span class="text-label tabular-nums">
									<Show
										{ctx}
										kind={money}
										value={cashflow.net_projected_cashflow}
										row={{ currency: record.currency }}
									/>
								</span>
							</Stack>
						{/if}
						{#if toNumber(commercial.projected_margin_pct) !== 0}
							<Stack gap="xs">
								<Inline gap="xs" align="center">
									<Badge variant="outline">{t('cashflow.side_net')}</Badge>
									<span class="text-meta">{t('commercial.projected_margin')}</span>
								</Inline>
								<span class="text-label tabular-nums">
									{t('commercial.margin_pct_value', { pct: commercial.projected_margin_pct })}
								</span>
							</Stack>
						{/if}
						{#if toNumber(commercial.overall_progress_pct) !== 0}
							<Stack gap="xs">
								<span class="text-meta">{t('commercial.overall_progress')}</span>
								<span class="text-sm font-medium tabular-nums text-primary"
									>{commercial.overall_progress_pct}%</span
								>
							</Stack>
						{/if}
					</Grid>
				{/if}

				<Bound height="18rem">
					<Chart
						{ctx}
						of={cashflowMonths}
						x="month"
						y={[t('cashflow.series_in'), t('cashflow.series_out')]}
						kind="bar"
						title={t('cashflow.ledger_chart')}
					/>
				</Bound>
			</Stack>
		</Surface>
	</Scroll>
{/snippet}

{#snippet cashflowLedgerTab()}
	{#if financeQuery.loading && !financeQuery.current}
		<Bound size="content" inset>
			<Inline gap="sm" align="center" aria-busy="true">
				<Spinner />
				<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
			</Inline>
		</Bound>
	{:else}
		<Table
			{ctx}
			of={catalogLedgerRows}
			key={`project:cashflow-ledger:${record.id}`}
			toolbar={{
				title: t('commercial.tab_cashflow_ledger'),
				description: t('cashflow.ledger_description'),
				export: true,
				select: false,
				new: false
			}}
			columns={[
				{ field: 'code', label: t('commercial.col_code') },
				{ field: 'name', label: t('commercial.col_item') },
				{ field: 'source_label', label: t('priced_lines.col_source') },
				{ field: 'so_value', label: t('commercial.col_so'), kind: money, align: 'end' },
				{ field: 'estimated_budget', label: t('commercial.col_budget'), kind: money, align: 'end' },
				{ field: 'po_committed', label: t('commercial.col_po'), kind: money, align: 'end' },
				{
					field: 'delivered_value',
					label: t('commercial.col_delivered'),
					kind: money,
					align: 'end'
				},
				{
					field: 'invoiced_outflow',
					label: t('commercial.col_invoiced'),
					kind: money,
					align: 'end'
				},
				{ field: 'paid_outflow', label: t('commercial.col_paid'), kind: money, align: 'end' },
				{
					field: 'budget_variance',
					label: t('commercial.col_variance'),
					kind: money,
					align: 'end'
				},
				{ field: 'net', label: t('commercial.col_net'), kind: money, align: 'end' }
			]}
		/>
	{/if}
{/snippet}

{#snippet salesOrdersTab()}
	<Table
		{ctx}
		of="contracts"
		key={`project:so:${record.id}`}
		where={{
			project_id: { eq: record.id },
			direction: { eq: 'upstream' },
			contract_type: { ne: 'variation_order' }
		}}
		order_by={{ updated_at: 'desc' }}
		toolbar={{
			title: t('commercial.tab_so'),
			actions:
				ctx.catalog?.commercial_documents?.create !== undefined
					? [
							{
								icon: 'lucide:file-plus-2',
								name: t('commercial.draft_claim'),
								description: t('commercial.draft_claim_desc'),
								run: () => ctx.run('generate_payment_claim', { project_id: record.id })
							}
						]
					: [],
			new: ctx.catalog?.contracts?.create
				? () => onCreateContract('upstream', 'main_contract')
				: false
		}}
		columns={[
			'contract_number',
			'title',
			'contract_type',
			'contact_id',
			'status',
			'contract_value',
			'signed_date'
		]}
	/>
{/snippet}

{#snippet purchaseOrdersTab()}
	<Table
		{ctx}
		of="contracts"
		key={`project:po:${record.id}`}
		where={{
			project_id: { eq: record.id },
			direction: { eq: 'downstream' },
			contract_type: { ne: 'variation_order' }
		}}
		order_by={{ updated_at: 'desc' }}
		toolbar={{
			title: t('commercial.tab_po'),
			new: ctx.catalog?.contracts?.create
				? () => onCreateContract('downstream', 'subcontract')
				: false
		}}
		columns={[
			'contract_number',
			'title',
			'contract_type',
			'trade_specialty',
			'contact_id',
			'status',
			'contract_value',
			'signed_date'
		]}
	/>
{/snippet}

{#snippet adhocCostsTab()}
	<Table
		{ctx}
		of="adhoc_costs"
		key={`project:adhoc:${record.id}`}
		where={{ project_id: { eq: record.id } }}
		order_by={{ updated_at: 'desc' }}
		toolbar={{
			title: t('commercial.tab_adhoc'),
			new: ctx.catalog?.adhoc_costs?.create ? onCreateAdhocCost : false
		}}
		columns={[
			'cost_number',
			'catalog_item_id',
			'title',
			'contact_id',
			'status',
			'qty',
			'unit',
			'unit_rate',
			'amount',
			'incurred_date'
		]}
	/>
{/snippet}

<Tabs
	level={2}
	tabs={[
		{
			name: 'overview',
			title: t('finance.overview'),
			icon: 'lucide:layout-dashboard',
			body: financeOverviewTab
		},
		{
			name: 'ledger',
			title: t('commercial.tab_cashflow_ledger'),
			icon: 'lucide:bar-chart-3',
			body: cashflowLedgerTab
		},
		{
			name: 'client_contracts',
			title: t('commercial.tab_so'),
			icon: 'lucide:arrow-down-left',
			body: salesOrdersTab
		},
		{
			name: 'subcontracts',
			title: t('commercial.tab_po'),
			icon: 'lucide:arrow-up-right',
			body: purchaseOrdersTab
		},
		{
			name: 'adhoc',
			title: t('commercial.tab_adhoc'),
			icon: 'lucide:receipt-text',
			body: adhocCostsTab
		}
	]}
/>
