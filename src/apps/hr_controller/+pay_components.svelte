<script lang="ts">
	/**
	 * The Pay components app is the entry stream of one legal entity: claims, allowances, bonuses,
	 * arrears and corrections, with the payroll capture that settled each. The catalogue is
	 * configuration and lives in Settings under the same company scope.
	 *
	 * One live query. The capture rides the entry row through
	 * `payslip_component_entry_input_component_entry`, so the lock state is a column of the row it
	 * locks rather than a second subscription (B12).
	 */
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companiesUnknown as companiesUnknownOf,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());

	type EntryRow = WorkspaceRow<'component_entries'> & {
		readonly component_entry_employment?: Pick<
			WorkspaceRow<'employments'>,
			'employee_number'
		> | null;
		readonly component_entry_pay_component?: Pick<WorkspaceRow<'pay_components'>, 'code'> | null;
		readonly payslip_component_entry_input_component_entry?: ReadonlyArray<
			Pick<WorkspaceRow<'payslip_component_entry_inputs'>, 'period'>
		> | null;
	};

	function componentLabel(row: EntryRow): string {
		return row.component_entry_pay_component?.code || '—';
	}

	function entryCapture(row: EntryRow): { period: string } | null {
		const capture = row.payslip_component_entry_input_component_entry?.[0] ?? null;
		return capture == null ? null : { period: capture.period };
	}

	function entryConsumptionLabel(row: EntryRow): string {
		const capture = entryCapture(row);
		if (capture) return t('component.paid_in', { period: capture.period });
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

<AppShell
	icon="lucide:coins"
	title="Pay components"
	description="Review pay entries — claims, allowances, bonuses, arrears and corrections — and their payroll linkage"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/pay_components-banner.webp"
>
	<AppHeaderActions>
		<CompanyScopeCombobox
			value={selectedCompanyId}
			onValueChange={(id) => {
				chosenCompanyId = id;
			}}
		/>
	</AppHeaderActions>

	{@render entries()}
</AppShell>

{#snippet entries()}
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.pay_components.empty_entries')}</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="component_entries"
				view={`hr_controller:pay_components:entries:${selectedCompanyId}`}
				title={t('app.pay_components.tab_entries')}
				description={t('app.pay_components.entries_description')}
				recordMetadata={(row) => sourceLockRecordMetadata(entryRowLock(row), t)}
				query={{
					where: {
						// Loan recoveries are repayments and have their own screen, which can show a
						// recovery position this one has no room for. An entry never names a loan.
						approval_id: { isNull: true },
						component_entry_employment: {
							some: { company_id: { eq: selectedCompanyId } }
						}
					},
					orderBy: { event_date: 'desc' },
					with: {
						component_entry_employment: { columns: { employee_number: true } },
						component_entry_pay_component: { columns: { code: true } },
						payslip_component_entry_input_component_entry: { columns: { period: true } }
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
