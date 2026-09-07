<script lang="ts">
	/**
	 * Arrears settlements of one legal entity: money owed for periods already run, the periods each
	 * makes good, and why it was owed.
	 *
	 * `covers_periods` is a column here rather than a summary string inside a blob, so the periods a
	 * settlement makes good are readable from the list without opening a row — which matters,
	 * because in 726 seeded entries this arm was used zero times and everything that should have
	 * been arrears was filed as a bonus that never had to say what it settled.
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

	type ArrearsRow = WorkspaceRow<'arrears_requests'> & {
		readonly arrears_request_employment?: Pick<
			WorkspaceRow<'employments'>,
			'employee_number'
		> | null;
		readonly arrears_request_component_catalogue?: Pick<
			WorkspaceRow<'component_catalogue'>,
			'code'
		> | null;
		readonly payslip_arrears_request_input_arrears_request?: ReadonlyArray<
			Pick<WorkspaceRow<'payslip_arrears_request_inputs'>, 'period'>
		> | null;
	};

	function rowMetadata(row: ArrearsRow) {
		const capture = row.payslip_arrears_request_input_arrears_request?.[0] ?? null;
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
	icon="lucide:history"
	title="Arrears"
	description="Money owed for pay periods already run, naming the periods it makes good and why"
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
				collection="arrears_requests"
				view={`hr_controller:events:arrears:${selectedCompanyId}`}
				title={t('app.arrears.title')}
				recordMetadata={rowMetadata}
				query={{
					where: {
						arrears_request_employment: { some: { company_id: { eq: selectedCompanyId } } }
					},
					orderBy: { settled_on: 'desc' },
					with: {
						arrears_request_employment: { columns: { employee_number: true } },
						arrears_request_component_catalogue: { columns: { code: true } },
						payslip_arrears_request_input_arrears_request: { columns: { period: true } }
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
							format: ({ row }: { row: ArrearsRow }) =>
								row.arrears_request_component_catalogue?.code ?? '—'
						}}
					/>
					<Column
						name="employment_id"
						label={t('component.person')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: ArrearsRow }) =>
								row.arrears_request_employment?.employee_number ?? '—'
						}}
					/>
					<Column name="amount" label={t('component.amount')} />
					<Column name="settled_on" label={t('component.settled_on')} />
					<Column name="covers_periods" label={t('component.covers_periods')} />
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
</AppShell>
