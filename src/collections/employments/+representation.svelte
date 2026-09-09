<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Button } from '@norbital-ai/ui/button';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import Icon from '@iconify/svelte';
	import OffboardingFlow from '../../lib/ui/offboarding/offboarding-flow.svelte';
	import ChangeTermsFlow from '../../lib/ui/offboarding/change-terms-flow.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	/**
	 * Off-boarding and contract changes open from here and nowhere else: both write the sealed
	 * contract's departure or terms, so they stay beside the departure section they settle.
	 */
	let offboardOpen = $state(false);
	let changeTermsOpen = $state(false);
	// A contract is sealed by the rows that reference it; the hook is the guard, this is the hint.
	const consumers = $derived(
		record == null
			? []
			: [
					client.db.employment_terms,
					client.db.employment_statutory_facts,
					client.db.claim_requests,
					client.db.allowance_requests,
					client.db.payment_requests,
					client.db.loans,
					client.db.loan_repayments,
					client.db.leave_entries,
					client.db.work_days,
					client.db.payslips
				].map((collection) =>
					collection.findFirst({
						where: { employment_id: { eq: record.id } },
						columns: { id: true }
					})
				)
	);
	const sealed = $derived(consumers.some((query) => query.current != null));
	const sealQuery = $derived(consumers.find((query) => query.loading) ?? null);
	const departed = $derived(record?.exit_date != null);
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/employments-banner.svg"
	/>
</svelte:head>

<RecordShell title={record?.employee_number ?? t('component.create_employment')}>
	<Stack gap="md">
		{#if sealed}<p class="text-sm text-muted-foreground">{t('component.employment_sealed')}</p>{/if}
		{#if record != null && record.exit_date == null}
			<div class="flex gap-2">
				<Button variant="secondary" onclick={() => (changeTermsOpen = true)}>
					<Icon icon="lucide:file-signature" class="size-4" />
					{t('offboarding.change_terms')}
				</Button>
				<Button variant="destructive" onclick={() => (offboardOpen = true)}>
					<Icon icon="lucide:log-out" class="size-4" />
					{t('offboarding.open')}
				</Button>
			</div>
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
								hire_date: record.hire_date,
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
		<CollectionForm
			{client}
			collection="employments"
			disabled={(sealed && departed) || (sealQuery?.loading ?? false)}
			defaultValues={record ?? undefined}
			submitLabel={record ? t('component.save_employment') : t('component.create_employment')}
			onAfterSubmit={record ? undefined : close}
		>
			{#snippet children({ Field })}
				<Grid gap="md" minimum="panel">
					<Field
						name="employee_id"
						label={t('component.person')}
						disabled={sealed}
						relationOptions={{
							label: (person) =>
								person.name != null && person.name !== '' ? String(person.name) : '—',
							orderBy: { name: 'asc' },
							limit: 10_000
						}}
					/>
					<Field
						name="company_id"
						label={t('component.legal_entity')}
						disabled={sealed}
						relationOptions={{
							label: (company) =>
								company.name != null && company.name !== '' ? String(company.name) : '—',
							orderBy: { name: 'asc' },
							limit: 500
						}}
					/>
					<Field name="employee_number" label={t('component.employee_number')} disabled={sealed} />
					<Field name="hire_date" label={t('component.hired')} disabled={sealed} />
					<Column span="all"
						><Field name="bank" label={t('component.pay_destination')} disabled={sealed} /></Column
					>
					<Column span="all"
						><Field
							name="effective_range"
							label={t('component.effective_period')}
							disabled={sealed}
						/></Column
					>
					<Column span="all">
						<h3 class="text-sm font-medium">{t('component.departure')}</h3>
						<p class="text-sm text-muted-foreground">{t('component.departure_description')}</p>
					</Column>
					<Field name="exit_date" label={t('component.exited')} disabled={departed} />
					<Field name="exit_reason" label={t('component.exit_reason')} disabled={departed} />
					<Column span="all"><Field name="exit_note" disabled={departed} /></Column>
					<Column span="all"><Field name="children" label={t('employee_children.title')} /></Column>
				</Grid>
			{/snippet}
		</CollectionForm>
	</Stack>
</RecordShell>
