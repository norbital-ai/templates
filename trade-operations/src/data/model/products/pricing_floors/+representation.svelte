<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView, FormState } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	import FloorWarning from '../../../../lib/ui/floor-warning.svelte';
	let {
		view,
		ctx
	}: {
		view: RecordView<'pricing_floors'>;
		ctx: PageContext;
	} = $props();
</script>

{#snippet warning(form: FormState)}<FloorWarning {ctx} {form} />{/snippet}
<RecordForm
	{ctx}
	{view}
	subtitle={['product', 'currency', 'unit']}
	sections={[
		{
			name: 'floor',
			// the key fields stay visible after creation, readonly: only the price and its tax change
			fields: [
				'product',
				'currency',
				'group_code',
				'effective_on',
				'unit',
				'floor_price',
				'tax_inclusive',
				'tax_rate',
				'minimum_quantity'
			],
			readonlyFields:
				view.mode === 'create'
					? []
					: ['product', 'currency', 'group_code', 'effective_on', 'unit', 'minimum_quantity']
		}
	]}
	form_actions={warning}
/>
