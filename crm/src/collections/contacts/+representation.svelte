<script lang="ts">
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

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/crm/record-media/contacts-banner.svg"
	/>
</svelte:head>

<CollectionForm
	client={workspaceClient}
	collection="contacts"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="compact">
			<Field
				name="account_id"
				label={t('component.account')}
				relationOptions={{
					label: (record) =>
						record.name != null && record.name !== '' ? String(record.name) : '—',
					orderBy: { name: 'asc' },
					limit: 5000
				} satisfies CollectionRelationOptions}
			/>
			<Field name="first_name" label={t('component.first_name')} />
			<Field name="last_name" label={t('component.last_name')} />
			<Field name="email" />
			<Field name="title" />
			<Field name="department" />
			<Field name="active" />
		</Grid>
	{/snippet}
</CollectionForm>
