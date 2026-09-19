<script lang="ts">
	/**
	 * Ad hoc payments — bonus, back pay, ex-gratia, separation pay, claw-backs — raised for the
	 * people of one legal entity, and the payroll capture that settled each. The claims page in a
	 * different family: one live query, the capture riding the row's own `payslip_id`, rows held
	 * under an approval listed with the pending badge (off-boarding's separation payments arrive
	 * here that way).
	 */
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import CompanyScopeCombobox from '../CompanyScopeCombobox.svelte';
	import {
		companiesUnknown as companiesUnknownOf,
		companyById,
		resolveCompanyId
	} from '../company-scope.svelte.js';
	import { setContext } from 'svelte';
	import {
		componentLabel,
		EMPLOYMENT_LABEL_WITH,
		employmentLabel,
		HR_CREATE_SCOPE,
		type HrCreateScope
	} from '../../../lib/ui/create-scope.js';
	import { payRequestRecordMetadata } from '../../../lib/scheduling/lock.js';
	import MonthPeriodPicker from '../../../lib/ui/month-period-picker.svelte';
	import { createPayPeriodScope } from '../../../lib/ui/pay-period-scope.svelte.js';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	/** The pay period the one-off entries are stepped by, in the entity's own grammar. */
	const pay = createPayPeriodScope(() => companyById(selectedCompanyId));
	/**
	 * The scope the create form this page opens is drawn against: this entity's own people, and the
	 * catalogue version its jurisdiction lineage has in force. Without it a form opened from here
	 * offers every employment in the workspace and every version of every catalogue row.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	type AdhocRow = WorkspaceRow<'adhoc_requests'> & {
		readonly adhoc_request_employment?:
			| (Pick<WorkspaceRow<'employments'>, 'employee_number'> & {
					readonly employment_employee?: { readonly name: string } | null;
			  })
			| null;
		readonly adhoc_request_adhoc_catalogue?: Pick<
			WorkspaceRow<'adhoc_catalogue'>,
			'code' | 'name'
		> | null;
	};
</script>

<AppShell
	icon="lucide:hand-coins"
	title="Ad hoc"
	description="One-off payments and deductions — bonus, back pay, separation pay, claw-backs — with the payroll capture that settled each"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/requests-banner.webp"
>
	<AppHeaderActions>
		<CompanyScopeCombobox
			value={selectedCompanyId}
			onValueChange={(id) => {
				chosenCompanyId = id;
			}}
		/>
	</AppHeaderActions>

	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.events.empty_scope')}</p>
	{:else if pay.bounds != null}
		{#key `${selectedCompanyId}:${pay.period}`}
			<CollectionTable
				{client}
				collection="adhoc_requests"
				view={`hr_controller:events:adhoc:${selectedCompanyId}:${pay.period}`}
				navigation={periodNavigation}
				title={t('app.adhoc.title')}
				recordMetadata={(row: AdhocRow) =>
					payRequestRecordMetadata(
						row.approval_id,
						row.payslip_id == null ? [] : [{ period: row.pay_period ?? '' }],
						t
					)}
				query={{
					where: {
						adhoc_request_employment: { some: { company_id: { eq: selectedCompanyId } } },
						// The period's entries: dated by the cutoff rule, or pinned to it outright.
						OR: [
							{ pay_period: { eq: pay.period } },
							{
								pay_period: { isNull: true },
								event_date: { gte: pay.bounds.start, lt: pay.bounds.end }
							}
						]
					},
					orderBy: { event_date: 'desc' },
					with: {
						adhoc_request_employment: EMPLOYMENT_LABEL_WITH,
						adhoc_request_adhoc_catalogue: { columns: { code: true, name: true } }
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="catalogue_id"
						label={t('component.component')}
						card="title"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: AdhocRow }) =>
								componentLabel(row.adhoc_request_adhoc_catalogue)
						}}
					/>
					<Column
						name="employment_id"
						label={t('component.person')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: AdhocRow }) => employmentLabel(row.adhoc_request_employment)
						}}
					/>
					<Column name="amount" label={t('component.amount')} />
					<!--
						Whether this one settles against its component's declared direction. It is the whole
						of what a correction is now, so it is a column rather than a fact you open a row to
						find: the family that used to carry it had its own page.
					-->
					<Column name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
					<Column name="event_date" label={t('component.adhoc_event_date')} />
					<Column name="evidence_file" label={t('component.evidence_file')} />
					<!--
						No payroll-consumption column. Which payslip took a row, and therefore whether it is
						locked, is the row's own restriction badge — `recordMetadata` above computes it from
						the same capture — and a column repeating it in different words spent width on a
						duplicate.
					-->
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
