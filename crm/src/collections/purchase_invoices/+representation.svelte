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
	collection="purchase_invoices"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Field name="supplier_id" hidden />
		<Field name="supplier_code" hidden />
		<Field name="supplier_name" hidden />
		<Field name="currency" hidden />
		<Field name="tax_inclusive" hidden />
		<Field name="net" hidden />
		<Field name="tax" hidden />
		<Field name="gross" hidden />
		<Field name="confirmed_at" hidden />
		<Field name="cancelled_at" hidden />
		<Field name="cancel_reason" hidden />
		<Grid minimum="compact">
			<Field name="doc_no" label={t('component.doc_no')} />
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
			<Field name="invoice_reference" label={t('component.supplier_invoice_no')} />
			<Field name="invoice_date" label={t('component.invoice_date')} />
			<Field name="status" />
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
