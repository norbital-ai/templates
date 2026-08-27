<script lang="ts">
	/**
	 * A job and a work front it takes place on. Both sides are relationships: without this file the
	 * auto `CollectionForm` is two uuid text boxes and nothing else.
	 */
	import { client } from '$bolt/client';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import type { CollectionRelationOptions } from '@norbital-ai/std/collection';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'CollectionForm');

	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	client={workspaceClient}
	collection="jobs_site_locations"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field
				name="job_id"
				label={t('component.job')}
				relationOptions={{
					label: (record) => {
						const code = record.job_number;
						const name = record.job_title;
						if (code && name) return `${code} · ${name}`;
						return name != null && name !== '' ? String(name) : '—';
					},
					orderBy: { job_number: 'asc' },
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
						return name != null && name !== '' ? String(name) : '—';
					},
					orderBy: { location_code: 'asc' },
					limit: 500
				} satisfies CollectionRelationOptions}
			/>
		</Grid>
	{/snippet}
</CollectionForm>
