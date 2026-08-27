<script lang="ts">
	import { client } from '$bolt/client';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import type { RepresentationProps } from './$types.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import type { CollectionRelationOptions } from '@norbital-ai/std/collection';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'CollectionForm');

	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	client={workspaceClient}
	collection="sales_invoice_lines"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Field name="product_code" hidden />
		<Field name="product_name" hidden />
		<Field name="product_unit" hidden />
		<Field name="net" hidden />
		<Field name="tax" hidden />
		<Grid minimum="compact">
			<Field
				name="sales_invoice_id"
				label={t('component.sales_invoice')}
				relationOptions={{
					label: (record) =>
						record.doc_no != null && record.doc_no !== '' ? String(record.doc_no) : '—',
					orderBy: { doc_no: 'desc' },
					limit: 5000
				} satisfies CollectionRelationOptions}
			/>
			<Field
				name="quote_line_id"
				label={t('component.quote_line')}
				relationOptions={{
					label: (record) => {
						const name = record.product_name;
						const quantity = record.quantity;
						if (name && quantity != null) return `${name} × ${quantity}`;
						return name != null && name !== '' ? String(name) : '—';
					},
					orderBy: { product_name: 'asc' },
					limit: 5000
				} satisfies CollectionRelationOptions}
			/>
			<Field name="quantity" />
			<Field name="unit_price" label={t('component.unit_price')} />
			<Field name="tax_rate" label={t('component.tax_rate')} />
			<Field name="line_total" label={t('component.line_total')} />
		</Grid>
	{/snippet}
</CollectionForm>
