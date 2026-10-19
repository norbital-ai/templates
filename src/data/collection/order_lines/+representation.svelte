<script lang="ts">
	import { live, run, bolt } from '$bolt';
	import { selectOrderProduct } from '../../../lib/ui/order-product-defaults.js';
	import {
		Picker,
		MoneyInput,
		type RecordView,
		type FormState,
		type FieldEditor
	} from '@norbital-ai/ui';
	import { liveState } from '../../../lib/ui/live-state.js';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'order_lines'>;
	} = $props();
	const parent = $derived(view.mode !== 'create' ? view.record.order : view.values.order);
	const header = liveState(live(() => (parent ? bolt.live(bolt.get('orders', parent)) : null)));
	let chosenCurrency = $state<string | undefined>(undefined);
	const currency = $derived(
		view.mode !== 'create' ? view.record.currency : ($header.value?.currency ?? chosenCurrency)
	);
</script>

{#snippet product(form: FormState, field: FieldEditor)}
	<Picker
		of="products"
		id={field.id}
		value={form.id<'products'>('product')}
		where={{ active: { eq: true } }}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		onChange={(id) =>
			void run(
				selectOrderProduct(
					form,
					field,
					id,
					(value) => {
						chosenCurrency = value;
					},
					view.mode === 'create'
				)
			)}
	/>
{/snippet}
{#snippet unitPrice(_form: FormState, field: FieldEditor)}
	<MoneyInput
		id={field.id}
		value={field.value}
		onChange={field.onChange}
		{...currency ? { currency } : {}}
		scale={4}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
	/>
{/snippet}
<RecordForm
	{view}
	subtitle={['order']}
	editors={{ product, unit_price: unitPrice }}
	sections={[
		{
			name: 'line',
			title: bolt.t('section.lines'),
			fields: ['order', 'product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate']
		}
	]}
/>
