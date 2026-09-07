<script lang="ts">
	/**
	 * Bonuses awarded to the people of one legal entity, dated by the day of the award.
	 *
	 * This is the family that used to swallow the others — as the only arm of the old union that
	 * required no payload, it carried 623 of 726 seeded entries, including 150 transport allowances
	 * and 84 rows of income tax. What is listed here now is bonuses, because a row can only reach
	 * this collection through a component whose `entry_kind` is BONUS.
	 *
	 * One live query, and the same shape as its four siblings in this group: the entity's own rows,
	 * each carrying its employment, its component and the payroll capture that may lock it. Rows
	 * held under an approval are listed and wear the pending badge rather than being filtered away
	 * — see `+claims.svelte` for why that clause is gone.
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
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../../lib/ui/create-scope.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	/** The scope the create form this page opens is drawn against. See `+claims.svelte`. */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	type BonusRow = WorkspaceRow<'bonus_requests'> & {
		readonly bonus_request_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly bonus_request_component_catalogue?: Pick<
			WorkspaceRow<'component_catalogue'>,
			'code'
		> | null;
		readonly payslip_bonus_request_input_bonus_request?: ReadonlyArray<
			Pick<WorkspaceRow<'payslip_bonus_request_inputs'>, 'period'>
		> | null;
	};

	function rowMetadata(row: BonusRow) {
		const capture = row.payslip_bonus_request_input_bonus_request?.[0] ?? null;
		return sourceLockRecordMetadata(
			sourceLock({
				existing: true,
				approvalId: row.approval_id,
				dates: [],
				settledBy: capture == null ? null : { period: capture.period },
				datePassed: 'IS_NOT_A_LOCK'
			}),
			t
		);
	}
</script>

<AppShell
	icon="lucide:gift"
	title="Bonuses"
	description="One-off payments awarded to people, dated by the day of the award"
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

	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.events.empty_scope')}</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="bonus_requests"
				view={`hr_controller:events:bonuses:${selectedCompanyId}`}
				title={t('app.bonuses.title')}
				recordMetadata={rowMetadata}
				query={{
					where: {
						bonus_request_employment: { some: { company_id: { eq: selectedCompanyId } } }
					},
					orderBy: { awarded_on: 'desc' },
					with: {
						bonus_request_employment: { columns: { employee_number: true } },
						bonus_request_component_catalogue: { columns: { code: true } },
						payslip_bonus_request_input_bonus_request: { columns: { period: true } }
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="component_catalogue_id"
						label={t('component.component')}
						card="title"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: BonusRow }) =>
								row.bonus_request_component_catalogue?.code ?? '—'
						}}
					/>
					<Column
						name="employment_id"
						label={t('component.person')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: BonusRow }) =>
								row.bonus_request_employment?.employee_number ?? '—'
						}}
					/>
					<Column name="amount" label={t('component.amount')} />
					<Column name="awarded_on" label={t('component.awarded_on')} />
					<Column name="note" label={t('component.bonus_note')} />
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
</AppShell>
