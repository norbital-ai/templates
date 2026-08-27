<script lang="ts">
	/**
	 * A permit and a worker named on it. Both sides are relationships: without this file the auto
	 * `CollectionForm` is two uuid text boxes and nothing else.
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
	collection="permits_to_work_workers"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field
				name="permits_to_work_id"
				label={t('component.permit_to_work')}
				relationOptions={{
					label: (record) =>
						record.permit_number != null && record.permit_number !== ''
							? String(record.permit_number)
							: '—',
					orderBy: { permit_number: 'asc' },
					limit: 500
				} satisfies CollectionRelationOptions}
			/>
			<Field
				name="worker_id"
				label={t('component.worker')}
				relationOptions={{
					label: (record) => {
						const code = record.worker_number;
						const name = record.worker_name;
						if (code && name) return `${code} · ${name}`;
						return name != null && name !== '' ? String(name) : '—';
					},
					orderBy: { worker_number: 'asc' },
					limit: 500
				} satisfies CollectionRelationOptions}
			/>
		</Grid>
	{/snippet}
</CollectionForm>
