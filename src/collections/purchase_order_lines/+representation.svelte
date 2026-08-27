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

<CollectionForm
	client={workspaceClient}
	collection="purchase_order_lines"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Field name="net" hidden />
		<Field name="tax" hidden />
		<Grid minimum="compact">
			<Field
				name="purchase_order_id"
				label={t('component.purchase_order')}
				relationOptions={{
					label: (record) =>
						record.doc_no != null && record.doc_no !== '' ? String(record.doc_no) : '—',
					orderBy: { doc_no: 'desc' },
					limit: 5000
				} satisfies CollectionRelationOptions}
			/>
			<Field
				name="product_id"
				label={t('component.product')}
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
			<Field name="product_code" label={t('component.code')} />
			<Field name="product_name" label={t('component.product_name')} />
			<Field name="product_unit" label={t('component.unit')} />
			<Field name="quantity" />
			<Field name="unit_cost" label={t('component.unit_cost')} />
			<Field name="tax_rate" label={t('component.tax_rate')} />
			<Field name="line_total" label={t('component.line_total')} />
		</Grid>
	{/snippet}
</CollectionForm>
