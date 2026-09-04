<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { Cover } from '@norbital-ai/ui/layout';

	const { t } = useI18n<TenantI18nKeys>();

	type CompanyRow = WorkspaceRow<'companies'> & {
		readonly company_jurisdiction?: Pick<WorkspaceRow<'jurisdictions'>, 'id' | 'name'> | null;
	};
</script>

<svelte:head>
	<title>Entities</title>
	<meta name="description" content={t('app.hr_controller.entities_description')} />
	<meta name="bolt:icon" content="lucide:building-2" />
</svelte:head>

<Cover>
	<CollectionTable
		{client}
		collection="companies"
		view="hr_controller:entities"
		title={t('app.hr_controller.entities_title')}
		description={t('app.hr_controller.entities_description')}
		query={{
			orderBy: { name: 'asc' },
			with: { company_jurisdiction: { columns: { id: true, name: true } } }
		}}
	>
		{#snippet columns({ Column })}
			<Column name="name" card="title" />
			<Column name="registration_number" card="subtitle" />
			<Column
				name="jurisdiction_id"
				label={t('app.settings.jurisdiction')}
				renderer={FormattedValueRenderer}
				rendererProps={{
					format: ({ row }: { row: CompanyRow }) => row.company_jurisdiction?.name ?? '—'
				}}
			/>
			<Column name="pay_day" label={t('app.settings.pay_day')} />
			<Column name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
</Cover>
