<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Cover } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { inForceTodayFilter } from '../../lib/ui/calendar.js';

	const { t } = useI18n<TenantI18nKeys>();
</script>

<svelte:head>
	<title>Statutory profile</title>
	<meta
		name="description"
		content="The regime every payroll is calculated against: jurisdictions with the schemes, rates, overtime rules and limits configured inside them, and the companies bound to each"
	/>
	<meta name="bolt:icon" content="lucide:scale" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp"
	/>
</svelte:head>

{#snippet jurisdictions()}
	<CollectionTable
		{client}
		collection="jurisdictions"
		view="hr_controller:settings:jurisdictions"
		title={t('app.settings.jurisdictions_title')}
		description={t('app.settings.jurisdictions_description')}
		initialFilters={inForceTodayFilter()}
		query={{ orderBy: { code: 'asc' } }}
	>
		{#snippet columns({ Column })}
			<Column name="code" card="title" />
			<Column name="name" card="subtitle" />
			<Column name="currency" />
			<Column name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet companies()}
	<CollectionTable
		{client}
		collection="companies"
		view="hr_controller:settings:companies"
		title={t('app.settings.companies_title')}
		description={t('app.settings.companies_description')}
		initialFilters={inForceTodayFilter()}
		query={{ orderBy: { name: 'asc' } }}
	>
		{#snippet columns({ Column })}
			<Column name="name" card="title" />
			<Column name="registration_number" card="subtitle" />
			<Column name="jurisdiction_id" label={t('app.settings.jurisdiction')} />
			<Column name="pay_day" label={t('app.settings.pay_day')} />
			<Column name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
{/snippet}

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'jurisdictions',
				label: t('app.settings.jurisdictions_title'),
				icon: 'lucide:globe',
				content: jurisdictions
			},
			{
				name: 'companies',
				label: t('app.settings.tab_companies'),
				icon: 'lucide:building-2',
				content: companies
			}
		] satisfies TabConfig[]}
	/>
</Cover>
