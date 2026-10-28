<script lang="ts">
	import { run, bolt } from '$bolt';
	import { selectOrderProduct } from '../../../lib/ui/order-product-defaults.js';
	import {
		Picker,
		MoneyInput,
		type RecordView,
		type FormState,
		type FieldEditor
	} from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { createValues } from '../../../lib/ui/create-values.js';
	let {
		view
	}: {
		view: RecordView<'order_lines'>;
	} = $props();
	// a new line is opened from its order (`openCreate`)
	const preset = createValues<'order_lines'>();
	const parent = $derived(
		view.mode !== 'create' ? view.record.order : (view.values.order ?? preset.order)
	);
	const order = $derived(
		parent ? bolt.query({ orders: { where: { id: { eq: parent } }, limit: 1 } }) : null
	);
	const header = $derived(order?.current?.orders.rows[0]);
	let chosenCurrency = $state<string | undefined>(undefined);
	const currency = $derived(
		view.mode !== 'create' ? view.record.currency : (header?.currency ?? chosenCurrency)
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
	readonly={header?.status !== 'draft' || Boolean(header?.archived || header?.draft_setup)}
	readonlyReason={bolt.t(
		header?.archived
			? 'component.order_archived'
			: header?.draft_setup
				? 'errors.contract_setup'
				: 'component.sealed'
	)}
	subtitle={['order']}
	editors={{ product, unit_price: unitPrice }}
	sections={[
		{
			name: 'line',
			title: bolt.t('section.lines'),
			fields: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate']
		}
	]}
/>
