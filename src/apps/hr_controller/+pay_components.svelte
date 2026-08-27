<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Bound, Cover, Scroll } from '@norbital-ai/ui/layout';
	import ClaimSeasonality from '../../lib/ui/pay-components/claim-seasonality.svelte';
	import { formatObligationTerms } from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayInstant } from '../../lib/ui/calendar.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();

	let companyId = $state<string | null>(null);
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;

	/**
	 * The catalogue opens on the components in force today, as a filter chip the operator can drop to
	 * reach superseded versions. The legal-entity selector keeps `activeRange` in its own query: it is
	 * the page's scope picker, not a listing, and it has to default to an entity that still exists.
	 */
	const companiesQuery = $derived(
		client.db.companies.findMany({
			where: { approval_id: { isNull: true }, ...activeRange },
			orderBy: { name: 'asc' },
			limit: 500
		})
	);
	const companies = $derived(companiesQuery.current ?? []);
	const companyOptions = $derived(
		companies.map((c) => ({
			value: c.id,
			label: c.name,
			search_term: `${c.name} ${c.registration_number ?? ''}`
		}))
	);
	const selectedCompanyId = $derived(
		companyId != null && companies.some((c) => c.id === companyId)
			? companyId
			: (companies[0]?.id ?? null)
	);

	type ObligationRow = WorkspaceRow<'obligations'> & {
		readonly obligation_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly obligation_pay_component?: Pick<WorkspaceRow<'pay_components'>, 'code'> | null;
	};

	function componentLabel(row: ObligationRow): string {
		const component = row.obligation_pay_component;
		if (component?.code) return component.code;
		return '—';
	}

	/**
	 * The settlement claims over this entity's obligations, in two reads rather than a nested one.
	 *
	 * `payslip_adjustments.source` is a `reference(...)`, and a reference owns its own target edges,
	 * so there is no `many` inverse to nest under an obligation the way `entry_payslip_lines` was
	 * nested under a component entry. What it costs in a second read it gives back in depth: the
	 * period is a column ON the claim now, so the walk through the payslip to its run is gone
	 * entirely — and `period` is one of the four fields `settlementLedgerGrants()` exposes, so this
	 * read is the one a rank with no payroll authority can also make.
	 */
	const obligationIdsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.obligations.findMany({
					where: {
						terms: { ne: 'SCHEDULED' },
						obligation_employment: {
							approval_id: { isNull: true },
							company_id: { eq: selectedCompanyId }
						}
					},
					columns: { id: true },
					limit: 5000
				})
	);
	const settlementsQuery = $derived.by(() => {
		const ids = (obligationIdsQuery?.current ?? []).map((row) => row.id);
		if (ids.length === 0) return null;
		return client.db.payslip_adjustments.findMany({
			where: { source: { in: ids.map((id) => ({ kind: 'OBLIGATION' as const, id })) } },
			columns: { source: true, period: true },
			limit: 20_000
		});
	});
	const settlementByObligationId = $derived(
		new Map(
			(settlementsQuery?.current ?? []).flatMap((claim) =>
				claim.source.kind !== 'OBLIGATION'
					? []
					: [[claim.source.id, { period: claim.period }] as const]
			)
		)
	);

	function obligationSettlement(row: ObligationRow): { period: string } | null {
		return settlementByObligationId.get(row.id) ?? null;
	}

	function obligationConsumptionLabel(row: ObligationRow): string {
		const claim = obligationSettlement(row);
		if (claim) {
			return t('component.paid_in', { period: claim.period });
		}
		if (!row.pay_period) return t('component.settled_outside_payroll');
		return '—';
	}

	function obligationRowLock(row: ObligationRow) {
		return sourceLock({
			existing: true,
			approvalId: row.approval_id,
			dates: [],
			settledBy: obligationSettlement(row),
			datePassed: 'IS_NOT_A_LOCK'
		});
	}
</script>

<svelte:head>
	<title>Pay components</title>
	<meta
		name="description"
		content="Review obligations — allowances, claims, arrears and reversals — and their payroll linkage"
	/>
	<meta name="bolt:icon" content="lucide:coins" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/pay_components-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/pay_components-banner.webp"
	/>
</svelte:head>

{#snippet companyScopeActions()}
	<Combobox
		ariaLabel={t('component.legal_entity')}
		options={companyOptions}
		value={selectedCompanyId}
		onValueChange={(value) => {
			if (typeof value === 'string') {
				companyId = value;
				return;
			}
			companyId = companies[0]?.id ?? null;
		}}
		emptyPlaceholder={t('component.select_legal_entity')}
		searchPlaceholder={t('component.search_companies')}
		clientConfig={{
			isLoading: companiesQuery.loading,
			error: companiesQuery.error?.message ?? null
		}}
		class="min-w-[16rem]"
	/>
{/snippet}

{#snippet overview()}
	<Bound size="full">
		<Scroll name="Pay components overview">
			{#if selectedCompanyId == null}
				<p class="text-sm text-muted-foreground">{t('app.pay_components.empty_overview')}</p>
			{:else}
				{#key selectedCompanyId}
					<ClaimSeasonality companyId={selectedCompanyId} />
				{/key}
			{/if}
		</Scroll>
	</Bound>
{/snippet}

{#snippet entries()}
	{#if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">
			{t('app.pay_components.empty_entries')}
		</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="obligations"
				view={`hr_controller:pay_components:entries:${selectedCompanyId}`}
				recordMetadata={(row) => sourceLockRecordMetadata(obligationRowLock(row), t)}
				query={{
					where: {
						// SCHEDULED obligations are loans and have their own screen, which can show a
						// recovery position this one has no room for. The predecessor said the same thing
						// as `repayment_agreement_id IS NULL`, back when a loan's instalments were copied
						// into this table as rows of their own.
						terms: { ne: 'SCHEDULED' },
						obligation_employment: {
							approval_id: { isNull: true },
							company_id: { eq: selectedCompanyId }
						}
					},
					orderBy: { event_date: 'desc' },
					with: {
						obligation_employment: { columns: { employee_number: true } },
						obligation_pay_component: { columns: { code: true } }
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="pay_component_id"
						label={t('component.component')}
						card="title"
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ row }) => componentLabel(row) }}
					/>
					<Column
						name="employment_id"
						label={t('component.employment')}
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: ObligationRow }) =>
								row.obligation_employment?.employee_number ?? '—'
						}}
					/>
					<Column name="amount" label={t('component.amount')} />
					<Column name="quantity" label={t('component.quantity')} />
					<Column name="event_date" label={t('component.date')} />
					<Column name="pay_period" label={t('component.pay_period')} />
					<Column
						name="reference"
						label={t('component.payroll_consumption')}
						sortable={false}
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ row }) => obligationConsumptionLabel(row) }}
					/>
					<Column name="description" />
					<Column
						name="terms"
						label={t('component.obligation_terms')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ row }) => formatObligationTerms(row, t) }}
					/>
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}

{#snippet catalogue()}
	{#if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">
			{t('app.pay_components.empty_catalogue')}
		</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="pay_components"
				view={`hr_controller:pay_components:catalogue:${selectedCompanyId}`}
				initialFilters={inForceTodayFilter()}
				query={{
					where: {
						company_id: { eq: selectedCompanyId }
					},
					orderBy: { code: 'asc' }
				}}
			>
				{#snippet columns({ Column })}
					<Column name="code" card="title" />
					<Column name="nature" card="badge" />
					<Column name="policy" label={t('app.pay_components.settlement_policy')} />
					<Column name="definition" label={t('app.pay_components.calculation')} />
					<Column name="sequence" label={t('app.pay_components.order')} />
					<Column name="effective_range" label={t('component.effective')} />
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}

<AppHeaderActions>
	{@render companyScopeActions()}
</AppHeaderActions>

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'overview',
				label: t('component.tab_overview'),
				icon: 'lucide:chart-no-axes-combined',
				content: overview
			},
			{
				name: 'entries',
				label: t('app.pay_components.tab_entries'),
				icon: 'lucide:receipt-text',
				content: entries
			},
			{
				name: 'catalogue',
				label: t('app.pay_components.tab_catalogue'),
				icon: 'lucide:list-tree',
				content: catalogue
			}
		] satisfies TabConfig[]}
	/>
</Cover>
