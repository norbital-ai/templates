<script lang="ts">
	import { client } from '$bolt/client';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import type { CollectionRelationOptions } from '@norbital-ai/std/collection';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'CollectionForm');

	const { t } = useI18n<TenantI18nKeys>();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/construction/record-media/jobs-banner.svg"
	/>
</svelte:head>

<CollectionForm
	client={workspaceClient}
	collection="jobs"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field name="job_title" />
			<Field name="job_number" />
			<Field
				name="project_id"
				label={t('component.project')}
				relationOptions={{
					label: (record) => {
						const number = record.project_number;
						const name = record.project_name;
						if (number && name) return `${number} · ${name}`;
						const v = record.project_name;
						return v != null && v !== '' ? String(v) : '—';
					},
					orderBy: { project_number: 'asc' },
					limit: 500
				} satisfies CollectionRelationOptions}
			/>
			<Field
				name="site_location_id"
				label={t('component.site_location')}
				relationOptions={{
					label: (record) => {
						const code = record.location_code;
						const name = record.location_name;
						if (code && name) return `${code} · ${name}`;
						const v = record.location_name;
						return v != null && v !== '' ? String(v) : '—';
					},
					orderBy: { location_code: 'asc' },
					limit: 500
				} satisfies CollectionRelationOptions}
			/>
			<Field
				name="bim_reference_id"
				label={t('component.bim_reference')}
				relationOptions={{
					label: (record) => {
						const v = record.reference_name;
						return v != null && v !== '' ? String(v) : '—';
					},
					orderBy: { reference_name: 'asc' },
					limit: 500
				} satisfies CollectionRelationOptions}
			/>
			<Field name="job_type" />
			<Field name="status" />
			<Field name="priority" />
			<Field name="schedule_range" />
			<Field name="budget" />
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
