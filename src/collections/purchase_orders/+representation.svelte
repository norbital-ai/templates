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
		content="/__bolt/request/api/template-seed-assets/crm/record-media/purchase_orders-banner.svg"
	/>
</svelte:head>

<CollectionForm
	client={workspaceClient}
	collection="purchase_orders"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Field name="supplier_code" hidden />
		<Field name="supplier_name" hidden />
		<Field name="net" hidden />
		<Field name="tax" hidden />
		<Field name="gross" hidden />
		<Field name="confirmed_at" hidden />
		<Field name="cancelled_at" hidden />
		<Field name="cancel_reason" hidden />
		<Grid minimum="compact">
			<Field name="doc_no" label={t('component.doc_no')} />
			<Field
				name="supplier_id"
				label={t('component.supplier')}
				relationOptions={{
					label: (record) => {
						const code = record.code;
						const name = record.name;
						if (code && name) return `${code} · ${name}`;
						return name != null && name !== '' ? String(name) : '—';
					},
					orderBy: { name: 'asc' },
					limit: 5000
				} satisfies CollectionRelationOptions}
			/>
			<Field name="status" />
			<Field name="currency" />
			<Field name="tax_inclusive" label={t('component.tax_inclusive')} />
			<Field name="expected_date" label={t('component.expected_date')} />
			<Field
				name="owner_id"
				label={t('component.owner')}
				relationOptions={{
					label: (record) =>
						record.name != null && record.name !== '' ? String(record.name) : '—',
					orderBy: { name: 'asc' },
					limit: 500
				} satisfies CollectionRelationOptions}
			/>
		</Grid>
	{/snippet}
</CollectionForm>
