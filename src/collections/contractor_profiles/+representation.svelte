<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import { Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<svelte:head>
	<meta
		name="pod:banner"
		content="/api/template-seed-assets/field-operations/record-media/contractor_profiles-banner.svg"
	/>
</svelte:head>

<CollectionForm
	{client}
	collection="contractor_profiles"
	defaultValues={record ?? undefined}
	submitLabel={record ? undefined : t('component.add_contractor')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="panel">
			<Field name="company_name" />
			<Field
				name="user_id"
				label={t('component.portal_user')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'user',
					options: {
						label: (user) => String(user.name || '—'),
						orderBy: { name: 'asc' },
						limit: 500
					}
				}}
			/>
		</Grid>
	{/snippet}
</CollectionForm>
