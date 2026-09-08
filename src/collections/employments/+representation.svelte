<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
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
			disabled={sealed || (sealQuery?.loading ?? false)}
			defaultValues={record ?? undefined}
			submitLabel={record ? t('component.save_employment') : t('component.create_employment')}
			onAfterSubmit={record ? undefined : close}
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
					<Field name="employee_number" label={t('component.employee_number')} />
					<Field name="hire_date" label={t('component.hired')} />
					<Column span="all"><Field name="bank" label={t('component.pay_destination')} /></Column>
					<Column span="all"
						><Field name="effective_range" label={t('component.effective_period')} /></Column
					>
				</Grid>
			{/snippet}
		</CollectionForm>
		{#if record}
			<CollectionTable
				{client}
				collection="employment_departures"
				view="employments:departure"
				title={t('component.departure')}
				description={t('component.departure_description')}
				query={{ where: { employment_id: { eq: record.id } } }}
			>
				{#snippet columns({ Column: TableColumn })}
					<TableColumn name="exit_date" label={t('component.exited')} card="title" />
					<TableColumn name="exit_reason" label={t('component.exit_reason')} card="subtitle" />
					<TableColumn name="note" />
				{/snippet}
			</CollectionTable>
		{/if}
	</Stack>
</RecordShell>
