<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'products'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={['code']}
	fields={[
		'code',
		'name',
		'external_code',
		'unit',
		'currency',
		'unit_price',
		'tax_rate',
		'qty_on_hand',
		'active',
		'main_supplier_id',
		'description',
		'spec'
	]}
/>
