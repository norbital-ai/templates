<script lang="ts">
	/**
	 * Claims raised against the pay catalogue by the people of one legal entity, and the payroll
	 * capture that settled each.
	 *
	 * One live query. The capture rides the claim row through
	 * `payslip_claim_request_input_claim_request`, so the lock state is a column of the row it locks
	 * rather than a second subscription (B12).
	 *
	 * Rows still held under an approval are listed rather than filtered out, and wear the pending
	 * badge `sourceLockRecordMetadata` draws. This is the screen an approver works from — a claim an
	 * employee raised is exactly the row that carries an `approval_id`, and its predecessor hid
	 * every one of them behind an `approval_id: { isNull: true }` clause while computing a pending
	 * badge that could therefore never be shown. Leave requests never filtered them, and this is now
	 * the same page in a different family.
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
	/**
	 * The scope the create form this page opens is drawn against: this entity's own people, and the
	 * catalogue version its jurisdiction lineage has in force. Without it a form opened from here
	 * offers every employment in the workspace and every version of every catalogue row.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	type ClaimRow = WorkspaceRow<'claim_requests'> & {
		readonly claim_request_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly claim_request_component_catalogue?: Pick<
			WorkspaceRow<'component_catalogue'>,
			'code'
		> | null;
		readonly payslip_claim_request_input_claim_request?: ReadonlyArray<
			Pick<WorkspaceRow<'payslip_claim_request_inputs'>, 'period'>
		> | null;
	};

	function claimMetadata(row: ClaimRow) {
		const capture = row.payslip_claim_request_input_claim_request?.[0] ?? null;
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
	icon="lucide:receipt-text"
	title="Claims"
	description="Expenses people paid for and are claiming back, with the payroll capture that settled each"
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
				collection="claim_requests"
				view={`hr_controller:events:claims:${selectedCompanyId}`}
				title={t('app.claims.title')}
				recordMetadata={claimMetadata}
				query={{
					where: {
						claim_request_employment: { some: { company_id: { eq: selectedCompanyId } } }
					},
					orderBy: { incurred_on: 'desc' },
					with: {
						claim_request_employment: { columns: { employee_number: true } },
						claim_request_component_catalogue: { columns: { code: true } },
						payslip_claim_request_input_claim_request: { columns: { period: true } }
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
							format: ({ row }: { row: ClaimRow }) =>
								row.claim_request_component_catalogue?.code ?? '—'
						}}
					/>
					<Column
						name="employment_id"
						label={t('component.person')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: ClaimRow }) =>
								row.claim_request_employment?.employee_number ?? '—'
						}}
					/>
					<Column name="amount" label={t('component.amount')} />
					<Column name="incurred_on" label={t('component.incurred_on')} />
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
