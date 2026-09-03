<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { relatedPayslipInputs } from '../../lib/payslip-source-query.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import CompanyScopeBanner from './CompanyScopeBanner.svelte';
	import {
		activeCompanyId as activeCompanyIdOf,
		companiesUnknown as companiesUnknownOf
	} from './company-scope.svelte.js';
	import { Bound, Cover, Scroll } from '@norbital-ai/ui/layout';
	import ClaimSeasonality from '../../lib/ui/pay-components/claim-seasonality.svelte';
	import { inForceTodayFilter } from '../../lib/ui/calendar.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();
	const selectedCompanyId = $derived(activeCompanyIdOf());
	const companiesUnknown = $derived(companiesUnknownOf());

	type EntryRow = WorkspaceRow<'component_entries'> & {
		readonly component_entry_employment?: Pick<
			WorkspaceRow<'employments'>,
			'employee_number'
		> | null;
		readonly component_entry_pay_component?: Pick<WorkspaceRow<'pay_components'>, 'code'> | null;
	};

	function componentLabel(row: EntryRow): string {
		const component = row.component_entry_pay_component;
		if (component?.code) return component.code;
		return '—';
	}

	/**
	 * The captured inputs over this entity's entries, in two reads rather than a nested one.
	 *
	 * `payslip_adjustments.input` is a `reference(...)` to the junction, and the junction owns its
	 * source edge, so there is no `many` inverse to nest under an entry. What it costs in a second
	 * read it gives back in depth: the period is a column ON the capture, so the walk through the
	 * payslip to its run is gone entirely — and `period` is one of the fields
	 * `settlementLedgerGrants()` exposes, so this read is the one a rank with no payroll authority
	 * can also make.
	 */
	const entryIdsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.component_entries.findMany({
					where: {
						component_entry_employment: {
							some: {
								approval_id: { isNull: true },
								company_id: { eq: selectedCompanyId }
							}
						}
					},
					columns: { id: true },
					limit: 10_000
				})
	);
	const capturesQuery = $derived(
		relatedPayslipInputs(entryIdsQuery, 'component_entry_id', (query) =>
			client.db.payslip_component_entry_inputs.findMany(query)
		)
	);
	const captureByEntryId = $derived(
		new Map(
			(capturesQuery?.current ?? []).map((capture) => [
				capture.component_entry_id,
				{ period: capture.period }
			])
		)
	);

	function entryCapture(row: EntryRow): { period: string } | null {
		return captureByEntryId.get(row.id) ?? null;
	}

	function entryConsumptionLabel(row: EntryRow): string {
		const capture = entryCapture(row);
		if (capture) {
			return t('component.paid_in', { period: capture.period });
		}
		if (!row.pay_period) return t('component.settled_outside_payroll');
		return '—';
	}

	function entryRowLock(row: EntryRow) {
		return sourceLock({
			existing: true,
			approvalId: row.approval_id,
			dates: [],
			settledBy: entryCapture(row),
			datePassed: 'IS_NOT_A_LOCK'
		});
	}
</script>

<svelte:head>
	<title>Pay components</title>
	<meta
		name="description"
		content="Review pay entries — claims, allowances, bonuses, arrears and corrections — and their payroll linkage"
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
	<CompanyScopeBanner />
{/snippet}

{#snippet overview()}
	<Bound size="full">
		<Scroll name="Pay components overview">
			{#if companiesUnknown}
				<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
			{:else if selectedCompanyId == null}
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
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">
			{t('app.pay_components.empty_entries')}
		</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="component_entries"
				view={`hr_controller:pay_components:entries:${selectedCompanyId}`}
				recordMetadata={(row) => sourceLockRecordMetadata(entryRowLock(row), t)}
				query={{
					where: {
						// Loan recoveries are repayments and have their own screen, which can show a
						// recovery position this one has no room for. An entry never names a loan.
						component_entry_employment: {
							approval_id: { isNull: true },
							company_id: { eq: selectedCompanyId }
						}
					},
					orderBy: { event_date: 'desc' },
					with: {
						component_entry_employment: { columns: { employee_number: true } },
						component_entry_pay_component: { columns: { code: true } }
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
							format: ({ row }: { row: EntryRow }) =>
								row.component_entry_employment?.employee_number ?? '—'
						}}
					/>
					<Column name="amount" label={t('component.amount')} />
					<Column name="quantity" label={t('component.quantity')} />
					<Column name="event_date" label={t('component.date')} />
					<Column name="pay_period" label={t('component.pay_period')} />
					<Column
						name="event"
						label={t('component.payroll_consumption')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ row }) => entryConsumptionLabel(row) }}
					/>
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}

{#snippet catalogue()}
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
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
