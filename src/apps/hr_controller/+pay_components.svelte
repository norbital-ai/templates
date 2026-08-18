<script lang="ts">
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
	import {
		formatCalendarDate,
		formatEntryOrigin,
		formatNumeric
	} from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayInstant, todayKey } from '../../lib/ui/calendar.js';
	import {
		payrollWindows,
		sourceLock,
		sourceLockFrozen,
		sourceLockReason
	} from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();

	let companyId = $state<string | null>(null);
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;

	/**
	 * The catalogue opens on the components in force today, as a filter chip the operator can drop to
	 * reach superseded versions. The legal-entity selector keeps `activeRange` in its own query: it is
	 * the page's scope picker, not a listing, and it has to default to an entity that still exists.
	 */
	const companiesQuery = client.db.companies.findMany({
		where: { norbital_approval_id: { isNull: true }, ...activeRange },
		orderBy: { name: 'asc' },
		limit: 500
	});
	const companies = $derived(companiesQuery.current ?? []);
	const companyOptions = $derived(
		companies.map((c) => ({
			value: c.norbital_id,
			label: c.name,
			search_term: `${c.name} ${c.registration_number ?? ''}`
		}))
	);
	const selectedCompanyId = $derived(
		companyId != null && companies.some((c) => c.norbital_id === companyId)
			? companyId
			: (companies[0]?.norbital_id ?? null)
	);
	const payrollRunsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.payroll_runs.findMany({
					where: { company_id: { eq: selectedCompanyId } },
					columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
					limit: 500
				})
	);
	const payrollLockWindows = $derived(payrollWindows(payrollRunsQuery?.current ?? []));

	type ComponentEntryRow = WorkspaceRow<'component_entries'> & {
		readonly entry_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly entry_pay_component?: Pick<WorkspaceRow<'pay_components'>, 'code'> | null;
		readonly entry_payslip_lines?: readonly {
			readonly payslip_line_payslip?: {
				readonly payslip_payroll_run?: Pick<WorkspaceRow<'payroll_runs'>, 'period'> | null;
			} | null;
		}[] | null;
	};

	function employmentLabel(row: ComponentEntryRow): string {
		return row.entry_employment?.employee_number ?? '—';
	}

	function componentLabel(row: ComponentEntryRow): string {
		const component = row.entry_pay_component;
		if (component?.code) return component.code;
		return '—';
	}

	function entryConsumptionLabel(row: ComponentEntryRow): string {
		const source = row.entry_payslip_lines?.[0];
		if (source) {
			const period = source.payslip_line_payslip?.payslip_payroll_run?.period;
			return t('component.paid_in', { period: period ?? t('component.a_payroll_run') });
		}
		if (!row.pay_period) return t('component.settled_outside_payroll');
		return '—';
	}

	function entryRowLock(row: ComponentEntryRow) {
		return sourceLock({
			existing: true,
			approvalId: row.norbital_approval_id,
			dates: [row.event_date],
			today: todayKey(),
			windows: payrollLockWindows,
			consumedByPayslip: (row.entry_payslip_lines?.length ?? 0) > 0,
			freezeWhenLive: row.origin?.kind === 'CLAIM'
		});
	}
</script>

<svelte:head>
	<title>Pay components</title>
	<meta
		name="description"
		content="Review pay-component entries — allowances, claims, arrears, reversals, and loan instalments — and their payroll linkage"
	/>
	<meta name="bolt:icon" content="lucide:coins" />
	<meta
		name="bolt:thumbnail"
		content="/api/template-seed-assets/hr-payroll/app-media/pay_components-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/api/template-seed-assets/hr-payroll/app-media/pay_components-banner.webp"
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
			companyId = companies[0]?.norbital_id ?? null;
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
				collection="component_entries"
				view={`hr_controller:pay_components:entries:${selectedCompanyId}`}
				isRowLocked={(row) => sourceLockFrozen(entryRowLock(row))}
				rowLockReason={(row) => sourceLockReason(entryRowLock(row), t)}
				query={{
					where: {
						repayment_agreement_id: { isNull: true },
						entry_employment: {
							norbital_approval_id: { isNull: true },
							company_id: { eq: selectedCompanyId }
						}
					},
					orderBy: { event_date: 'desc' },
					with: {
						entry_employment: { columns: { employee_number: true } },
						entry_pay_component: { columns: { code: true } },
						entry_payslip_lines: {
							columns: { norbital_id: true },
							with: {
								payslip_line_payslip: {
									columns: { norbital_id: true },
									with: {
										payslip_payroll_run: { columns: { period: true } }
									}
								}
							}
						}
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="pay_component_id"
						label={t('component.component')}
						card="title"
						render={({ row }) => componentLabel(row)}
					/>
					<Column
						name="employment_id"
						label={t('component.employment')}
						render={({ row }) => employmentLabel(row)}
					/>
					<Column
						name="amount"
						label={t('component.amount')}
						render={({ value }) => formatNumeric(value)}
					/>
					<Column name="quantity" label={t('component.quantity')} />
					<Column
						name="event_date"
						label={t('component.date')}
						render={({ value }) => formatCalendarDate(value)}
					/>
					<Column name="pay_period" label={t('component.pay_period')} />
					<Column
						name="repayment_agreement_id"
						label={t('component.payroll_consumption')}
						sortable={false}
						render={({ row }) => entryConsumptionLabel(row)}
					/>
					<Column name="usage_mode" label={t('app.pay_components.payslip_usage')} card="badge" />
					<Column name="description" />
					<Column
						name="origin"
						label={t('component.origin')}
						card="subtitle"
						render={({ value }) => formatEntryOrigin(value, t)}
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
