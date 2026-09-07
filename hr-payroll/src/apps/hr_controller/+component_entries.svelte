<script lang="ts">
	/**
	 * The Components app is the entry stream of one legal entity: claims, allowances, bonuses,
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
		companyById,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/create-scope.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	/**
	 * The scope the create forms this page opens are drawn against: this entity's own people, and
	 * the catalogue version its jurisdiction lineage has in force. Without it a form opened from
	 * this page offers every employment in the workspace and every version of every catalogue row.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	type EntryRow = WorkspaceRow<'component_entries'> & {
		readonly component_entry_employment?: Pick<
			WorkspaceRow<'employments'>,
			'employee_number'
		> | null;
		readonly component_entry_component_catalogue?: Pick<
			WorkspaceRow<'component_catalogue'>,
			'code'
		> | null;
		readonly payslip_component_entry_input_component_entry?: ReadonlyArray<
			Pick<WorkspaceRow<'payslip_component_entry_inputs'>, 'period'>
		> | null;
	};

	function componentLabel(row: EntryRow): string {
		return row.component_entry_component_catalogue?.code || '—';
	}

	function entryCapture(row: EntryRow): { period: string } | null {
		const capture = row.payslip_component_entry_input_component_entry?.[0] ?? null;
		return capture == null ? null : { period: capture.period };
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
	title="Component entries"
	description="Review pay entries — claims, allowances, bonuses, arrears and corrections — and their payroll linkage"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/component_catalogue-banner.webp"
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
		<p class="text-sm text-muted-foreground">{t('app.component_entries.empty_entries')}</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="component_entries"
				view={`hr_controller:component_catalogue:entries:${selectedCompanyId}`}
				title={t('app.component_entries.tab_entries')}
				description={t('app.component_entries.entries_description')}
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
						component_entry_component_catalogue: { columns: { code: true } },
						payslip_component_entry_input_component_entry: { columns: { period: true } }
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="component_catalogue_id"
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
					<Column name="event_date" label={t('component.date')} />
					<!--
						No payroll-consumption column. Which payslip took a row, and therefore whether it is
						locked, is the row's own restriction badge — `recordMetadata` above computes it from
						the same capture — and a column repeating it in different words spent width on a
						duplicate. `quantity` and `pay_period` are gone for the same reason they left the
						form: nothing prices the first, and the second is an override that is normally unset.
					-->
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}
