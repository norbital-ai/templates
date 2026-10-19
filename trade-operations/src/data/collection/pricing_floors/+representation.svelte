<script lang="ts">
	import { bolt } from '$bolt';
	import type { RecordView, FormState } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import FloorWarning from '../../../lib/ui/floor-warning.svelte';
	let {
		view
	}: {
		view: RecordView<'pricing_floors'>;
	} = $props();
</script>

{#snippet warning(form: FormState)}<FloorWarning {form} />{/snippet}
<RecordForm
	{view}
	subtitle={['product', 'currency', 'unit']}
	sections={[
		{
			name: 'floor',
			fields:
				view.mode === 'create'
					? [
							'product',
							'currency',
							'group_code',
							'effective_on',
							'unit',
							'floor_price',
							'tax_inclusive',
							'tax_rate',
							'minimum_quantity'
						]
					: ['floor_price', 'tax_inclusive', 'tax_rate']
		}
	]}
	formActions={warning}
/>
