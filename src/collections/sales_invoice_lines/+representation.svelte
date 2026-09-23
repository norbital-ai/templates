<script lang="ts">
	import { client } from '$bolt/client';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import type { RepresentationProps } from './$types.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
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
		<RecordShell
			subtitle={record
				? `Unit price ${record.unit_price} · Total ${record.line_total ?? '—'}`
				: undefined}
		>
			<Grid minimum="compact">
				{#if !record}
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
				{/if}
				<Field name="quantity" />
				{#if record}
					<Field name="unit_price" label={t('component.unit_price')} />
				{/if}
				<Field name="tax_rate" label={t('component.tax_rate')} />
			</Grid>
		</RecordShell>
	{/snippet}
</CollectionForm>
