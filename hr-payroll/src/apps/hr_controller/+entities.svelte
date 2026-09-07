<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';

	const { t } = useI18n<TenantI18nKeys>();
</script>

<AppShell
	icon="lucide:building-2"
	title="Entities"
	description={t('app.hr_controller.entities_description')}
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/entities-banner.webp"
>
	<CollectionTable
		{client}
		collection="companies"
		view="hr_controller:entities"
		title={t('app.hr_controller.entities_title')}
		description={t('app.hr_controller.entities_description')}
		query={{ orderBy: { name: 'asc' } }}
	>
		{#snippet columns({ Column })}
			<Column name="name" card="title" />
			<Column name="registration_number" card="subtitle" />
			<Column name="settings_code" label={t('component.settings_lineage')} />
			<Column name="pay_cutoff_day" label={t('app.settings.cutoff_day')} />
			<Column name="pay_frequency" label={t('component.pay_frequency')} />
			<Column name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
</AppShell>
