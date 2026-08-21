<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import { Column, Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const formDefaults = $derived(record ?? { status: 'unassigned' as const });
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/field-operations/record-media/jobs-banner.svg"
	/>
</svelte:head>

<CollectionForm
	{client}
	collection="jobs"
	defaultValues={formDefaults}
	submitLabel={record ? undefined : t('component.create_job')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="panel">
			<Field
				name="site_id"
				label={t('component.site')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'sites',
					options: {
						label: (site) => String(site.name || '—'),
						orderBy: { name: 'asc' },
						limit: 500
					}
				}}
			/>
			<Field name="title" label={t('component.job_title')} />
			<Field name="nature" label={t('component.job_nature')} />
			<Field name="scheduled_for" label={t('component.scheduled_date')} />
			<Column span="all">
				<Field name="description" label={t('component.job_description_scope')} />
			</Column>
		</Grid>
	{/snippet}
</CollectionForm>
