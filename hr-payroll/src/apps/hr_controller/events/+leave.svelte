<script lang="ts">
	import { client } from '../../../lib/workspace-client.js';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import type { WorkspaceRow } from '$bolt/types.js';
	import CompanyScopeCombobox from '../CompanyScopeCombobox.svelte';
	import {
		companiesError as companiesErrorOf,
		companyById,
		resolveCompanyId
	} from '../company-scope.svelte.js';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../../lib/ui/create-scope.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import MonthPeriodPicker from '../../../lib/ui/month-period-picker.svelte';
	import { formatLeaveSummary } from '../../../lib/ui/display-formatters.js';
	import { createPayPeriodScope } from '../../../lib/ui/pay-period-scope.svelte.js';
	import { leavePeriodWhere } from '../../../lib/leave/activity-fields.js';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesError = $derived(companiesErrorOf());
	/** The pay period the leave events are stepped by, in the entity's own grammar. */
	const pay = createPayPeriodScope(() => companyById(selectedCompanyId));
	/**
	 * The scope the create forms this page opens are drawn against: this entity's own people, and
	 * the catalogue version its jurisdiction lineage has in force. Without it a form opened from
	 * this page offers every employment in the workspace and every version of every catalogue row.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	type Request = WorkspaceRow<'leave_entries'> & {
		readonly leave_entry_employment?: {
			readonly employee_number: string;
			readonly employment_employee?: { readonly name: string } | null;
		} | null;
	};

	function person(row: Request): string {
		const employment = row.leave_entry_employment;
		return employment?.employment_employee?.name ?? employment?.employee_number ?? '—';
	}
</script>

<AppShell
	icon="lucide:calendar-check-2"
	title="Leave"
	description="Manual leave activities and their payroll settlement"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/leave-banner.webp"
>
	<AppHeaderActions>
		<CompanyScopeCombobox
			value={selectedCompanyId}
			onValueChange={(id) => {
				chosenCompanyId = id;
			}}
		/>
	</AppHeaderActions>

	{#if companiesError != null}
		<p class="text-sm text-destructive">{companiesError.message}</p>
	{:else if selectedCompanyId != null && pay.bounds != null}
		{#key pay.period}
			<CollectionTable
				navigation={periodNavigation}
				{client}
				collection="leave_entries"
				view={`hr_controller:events:leave:${selectedCompanyId}`}
				title={t('app.leave.requests_title')}
				description={t('app.leave.requests_description')}
				recordMetadata={() => [
					{ kind: 'restriction', operations: ['update', 'delete'], reason: t('leave.immutable') }
				]}
				query={{
					where: {
						leave_entry_employment: { some: { company_id: { eq: selectedCompanyId } } },
						...leavePeriodWhere(pay.bounds)
					},
					orderBy: { effective_on: 'desc' },
					with: {
						leave_entry_employment: {
							columns: { employee_number: true },
							with: { employment_employee: { columns: { name: true } } }
						}
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="employment_id"
						label={t('component.person')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ row }: { row: Request }) => person(row) }}
					/>
					<Column name="catalogue_id" label={t('component.catalogue_leave')} card="title" />
					<Column
						name="summary"
						label={t('leave.activity')}
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: Request }) => formatLeaveSummary(row.summary, t)
						}}
					/>
					<Column name="days" label={t('component.days')} />
					<Column name="reference" label={t('component.reference')} />
					<Column name="certificate_file" label={t('component.certificate')} />
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
</AppShell>

{#snippet periodNavigation()}
	<MonthPeriodPicker
		month={pay.period}
		halves={pay.halves}
		weeks={pay.weeks}
		ariaLabel={t('app.events.pay_period')}
		onMonthChange={(next) => pay.select(next)}
	/>
{/snippet}
