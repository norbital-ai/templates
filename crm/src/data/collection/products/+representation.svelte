<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'products'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm
	{view}
	subtitle={['code']}
	sections={[
		{
			name: 'product',
			title: t('section.product'),
			fields: ['code', 'name', 'external_code', 'unit', 'active', 'main_supplier_id']
		},
		{
			name: 'pricing_and_stock',
			title: t('section.pricing_and_stock'),
			fields: ['currency', 'unit_price', 'tax_rate', 'qty_on_hand']
		},
		{
			name: 'description',
			title: t('section.description'),
			fields: ['description', 'spec'],
			closed: record?.['description'] || record?.['spec'] || t('section.no_description')
		}
	]}
/>
