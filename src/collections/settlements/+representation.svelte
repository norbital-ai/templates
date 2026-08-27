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
	collection="settlements"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field, form })}
		{@const values = form.values()}
		<Grid minimum="compact">
			<Field name="regarding_type" label={t('component.document_type')} />
			{#key values.regarding_type}
				{#if values.regarding_type === 'purchase_orders'}
					<Field
						name="regarding_id"
						label={t('component.purchase_order')}
						relationOptions={{
							label: (record) =>
								record.doc_no != null && record.doc_no !== '' ? String(record.doc_no) : '—',
							orderBy: { doc_no: 'desc' },
							limit: 5000
						} satisfies CollectionRelationOptions}
					/>
				{:else if values.regarding_type === 'purchase_invoices'}
					<Field
						name="regarding_id"
						label={t('component.purchase_invoice')}
						relationOptions={{
							label: (record) =>
								record.doc_no != null && record.doc_no !== '' ? String(record.doc_no) : '—',
							orderBy: { doc_no: 'desc' },
							limit: 5000
						} satisfies CollectionRelationOptions}
					/>
				{:else}
					<Field
						name="regarding_id"
						label={t('component.quote')}
						relationOptions={{
							label: (record) => {
								const docNo = record.doc_no;
								const title = record.title;
								if (docNo && title) return `${docNo}: ${title}`;
								return docNo != null && docNo !== '' ? String(docNo) : '—';
							},
							orderBy: { doc_no: 'desc' },
							limit: 5000
						} satisfies CollectionRelationOptions}
					/>
				{/if}
			{/key}
			<Field name="amount" />
			<Field name="currency" />
			<Field name="settled_on" label={t('component.settled_on')} />
			<Field name="reference" />
			<Field
				name="owner_id"
				label={t('component.recorded_by')}
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
