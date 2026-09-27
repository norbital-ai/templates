<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'products'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => `${r.code} · ${r.active ? 'Active' : 'Inactive'}`}
	fields={[
		['code', 'component.code'],
		'name',
		'external_code',
		['unit', 'component.unit'],
		['unit_price', 'component.unit_price'],
		['tax_rate', 'component.tax_rate'],
		['qty_on_hand', 'component.on_hand'],
		'active',
		['main_supplier_id', 'component.supplier'],
		'description',
		'spec'
	]}
/>
