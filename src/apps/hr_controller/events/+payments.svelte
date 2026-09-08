<script lang="ts">
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
	import { payRequestRecordMetadata, settledClaims } from '../../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	type PaymentRow = WorkspaceRow<'payment_requests'> & {
		readonly payment_request_employment?: Pick<
			WorkspaceRow<'employments'>,
			'employee_number'
		> | null;
		readonly payment_request_payment_catalogue?: Pick<
			WorkspaceRow<'payment_catalogue'>,
			'code'
		> | null;
	};
</script>

<AppShell
	icon="lucide:wallet"
	title="Adhoc"
	description="Entered one-off earnings, deductions and corrections against employment contracts"
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
				collection="payment_requests"
				view={`hr_controller:events:payments:${selectedCompanyId}`}
				title={t('app.payments.title')}
				recordMetadata={(row: PaymentRow) =>
					payRequestRecordMetadata(row.approval_id, settledClaims(row), t)}
				query={{
					where: {
						payment_request_employment: { some: { company_id: { eq: selectedCompanyId } } }
					},
					orderBy: { effective_on: 'desc' },
					with: {
						payment_request_employment: { columns: { employee_number: true } },
						payment_request_payment_catalogue: { columns: { code: true } }
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="payment_catalogue_id"
						label={t('component.component')}
						card="title"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: PaymentRow }) =>
								row.payment_request_payment_catalogue?.code ?? '—'
						}}
					/>
					<Column
						name="employment_id"
						label={t('component.person')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: PaymentRow }) =>
								row.payment_request_employment?.employee_number ?? '—'
						}}
					/>
					<Column name="amount" label={t('component.amount')} />
					<Column name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
					<Column name="effective_on" label={t('component.effective_on')} />
					<Column name="reason" label={t('component.payment_reason')} />
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
</AppShell>
