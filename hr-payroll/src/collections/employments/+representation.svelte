<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const sealQuery = $derived(
		record == null
			? null
			: client.db.employment_contract_inputs.findFirst({
					where: { employment_id: { eq: record.id } },
					columns: { id: true }
				})
	);
	const sealed = $derived(sealQuery?.current != null);
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
