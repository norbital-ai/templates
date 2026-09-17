<script lang="ts">
	/**
	 * The contract record: the whole contract (`ContractDetail` — stint, terms in force, revisions,
	 * one Edit toggle) and the person's statutory registrations beneath it. Off-boarding and
	 * Change terms open from here and nowhere else: both write the sealed contract's departure or
	 * terms, so they stay beside the contract they settle. A new contract is the same form, empty.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Button } from '@norbital-ai/ui/button';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import Icon from '@iconify/svelte';
	import OffboardingFlow from '../../lib/ui/offboarding/offboarding-flow.svelte';
	import ChangeTermsFlow from '../../lib/ui/offboarding/change-terms-flow.svelte';
	import ContractDetail from '../../lib/ui/contract/contract-detail.svelte';
	import { readRange } from '../payroll_runs/lib/effective.js';
	import { HR_CREATE_SCOPE, hrCreateScope, type HrCreateScope } from '../../lib/ui/create-scope.js';
	import { setContext } from 'svelte';
	import { formatStatutoryFactStatus } from '../../lib/ui/display-formatters.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	/**
	 * The legal entity a contract belongs to is the one the page is scoped to. Offering the picker
	 * lets an operator file a contract into an entity the page is not showing — the table it lands
	 * in then does not contain it. Scoped, the entity is prefilled and not asked for; unscoped, the
	 * form keeps the picker so a contract can still be filed from a finder result or a link.
	 */
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	/**
	 * The scope the forms this record opens read (a statutory fact from the table below): this
	 * contract, its person and its entity, and the lineage the page already resolved.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => record?.id,
		employeeId: () => record?.employee_id,
		companyId: () => record?.company_id ?? scopedCompanyId,
		settingsCode: () => createScope?.settingsCode()
	});
	let offboardOpen = $state(false);
	let changeTermsOpen = $state(false);
	/** A closed range is a departed contract: only comments stay writable, and the flows hide. */
	const departed = $derived(readRange(record?.effective_range)?.end != null);
	const rangeStart = $derived(readRange(record?.effective_range)?.start ?? '');
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/employments-banner.svg"
	/>
</svelte:head>

{#snippet contractActions()}
	{#if !departed}
		<div class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => (changeTermsOpen = true)}>
				<Icon icon="lucide:file-signature" class="size-4" />
				{t('offboarding.change_terms')}
			</Button>
			<Button variant="destructive" size="sm" onclick={() => (offboardOpen = true)}>
				<Icon icon="lucide:log-out" class="size-4" />
				{t('offboarding.open')}
			</Button>
		</div>
	{/if}
{/snippet}

<RecordShell actions={record != null ? contractActions : undefined}>
	<Stack gap="md">
		{#if record != null && !departed}
			<Dialog.Root bind:open={changeTermsOpen}>
				<Dialog.Content class="max-w-2xl">
					<Dialog.Header>
						<Dialog.Title>{t('offboarding.change_terms_title')}</Dialog.Title>
						<Dialog.Description>{t('offboarding.change_terms_description')}</Dialog.Description>
					</Dialog.Header>
					{#if changeTermsOpen}
						<ChangeTermsFlow
							employment={{ id: record.id, company_id: record.company_id }}
							onclose={() => {
								changeTermsOpen = false;
							}}
						/>
					{/if}
				</Dialog.Content>
			</Dialog.Root>
			<Dialog.Root bind:open={offboardOpen}>
				<Dialog.Content class="max-w-2xl">
					<Dialog.Header>
						<Dialog.Title>{t('offboarding.title')}</Dialog.Title>
						<Dialog.Description>{t('offboarding.description')}</Dialog.Description>
					</Dialog.Header>
					{#if offboardOpen}
						<OffboardingFlow
							employment={{
								id: record.id,
								range_start: rangeStart,
								company_id: record.company_id,
								employee_number: record.employee_number
							}}
							onclose={() => {
								offboardOpen = false;
							}}
						/>
					{/if}
				</Dialog.Content>
			</Dialog.Root>
		{/if}
		{#if record != null}
			<ContractDetail {record} {scopedCompanyId} />
			<CollectionTable
				{client}
				collection="employment_statutory_facts"
				view="employments:statutory-facts"
				title={t('component.statutory_registrations')}
				description={t('component.statutory_registrations_description')}
				query={{
					where: { employee_id: { eq: record.employee_id } },
					orderBy: { created_at: 'desc' }
				}}
			>
				{#snippet columns({ Column: TableColumn })}
					<TableColumn
						name="statutory_contribution_id"
						label={t('component.contribution')}
						card="title"
					/>
					<TableColumn
						name="status"
						label={t('component.registration')}
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ value }) => formatStatutoryFactStatus(value, t) }}
					/>
					<TableColumn name="effective_range" label={t('component.effective')} />
				{/snippet}
			</CollectionTable>
		{:else}
			<CollectionForm
				{client}
				collection="employments"
				defaultValues={scopedCompanyId == null ? undefined : { company_id: scopedCompanyId }}
				submitLabel={t('component.create_employment')}
				onAfterSubmit={close}
			>
				{#snippet children({ Field })}
					<Grid gap="md" minimum="panel">
						<Field
							name="employee_id"
							label={t('component.person')}
							relationOptions={{
								label: (person) =>
									person.name != null && person.name !== '' ? String(person.name) : '—',
								orderBy: { name: 'asc' },
								limit: 10_000
							}}
						/>
						{#if scopedCompanyId != null}
							<Field name="company_id" hidden />
						{:else}
							<Field
								name="company_id"
								label={t('component.legal_entity')}
								relationOptions={{
									label: (company) =>
										company.name != null && company.name !== '' ? String(company.name) : '—',
									orderBy: { name: 'asc' },
									limit: 500
								}}
							/>
						{/if}
						<Field name="employee_number" label={t('component.employee_number')} />
						<Column span="all"><Field name="bank" label={t('component.pay_destination')} /></Column>
						<Column span="all">
							<Field name="effective_range" label={t('component.effective_period')} />
						</Column>
						<Field name="exit_reason" hidden />
						<Field name="comments" hidden />
					</Grid>
				{/snippet}
			</CollectionForm>
		{/if}
	</Stack>
</RecordShell>
