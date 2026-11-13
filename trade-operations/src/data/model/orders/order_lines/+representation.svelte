<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { run } from '@norbital-ai/ui/effect';
	import { selectOrderProduct } from '../../../../lib/ui/order-product-defaults.js';
	import {
		Picker,
		MoneyInput,
		type RecordView,
		type FormState,
		type FieldEditor
	} from '@norbital-ai/ui';
	import PrintDetails from '../../../../lib/ui/print-details.svelte';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	import { createValues } from '../../../../lib/ui/create-values.js';
	let {
		view,
		ctx
	}: {
		view: RecordView<'order_lines'>;
		ctx: PageContext;
	} = $props();
	// a new line is opened from its order (`openCreate`)
	const preset = createValues<'order_lines'>();
	const parent = $derived(
		view.mode !== 'create' ? view.record.order : (view.values.order ?? preset.order)
	);
	const order = $derived(
		parent ? ctx.query({ orders: { where: { id: { eq: parent } }, limit: 1 } }) : null
	);
	const header = $derived(order?.current?.orders.rows[0]);
	let chosenCurrency = $state<string | undefined>(undefined);
	const currency = $derived(
		view.mode !== 'create' ? view.record.currency : (header?.currency ?? chosenCurrency)
	);
</script>

{#snippet product(form: FormState, field: FieldEditor)}
	<Picker
		{ctx}
		of="products"
		id={field.id}
		value={form.id<'products'>('product')}
		where={{ active: { eq: true } }}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		on_change={(id) =>
			void run(
				selectOrderProduct(
					ctx,
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
		{ctx}
		id={field.id}
		value={field.value}
		on_change={field.on_change}
		{...currency ? { currency } : {}}
		scale={4}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
	/>
{/snippet}
{#snippet printDetails(_form: FormState, field: FieldEditor)}
	<PrintDetails
		{ctx}
		layout={header?.document_template}
		scope="line"
		value={field.value}
		on_change={field.on_change}
		id={field.id}
		disabled={field.disabled}
	/>
{/snippet}
{#snippet printDetailsView(form: FormState)}
	<PrintDetails
		{ctx}
		layout={header?.document_template}
		scope="line"
		value={form.get('print_values')}
	/>
{/snippet}
<RecordForm
	{ctx}
	{view}
	readonly={header?.status !== 'draft' || Boolean(header?.archived || header?.draft_setup)}
	readonly_reason={ctx.t(
		header?.archived
			? 'component.order_archived'
			: header?.draft_setup
				? 'errors.contract_setup'
				: 'component.sealed'
	)}
	editors={{ product, unit_price: unitPrice, print_values: printDetails }}
	viewers={{ print_values: printDetailsView }}
	sections={[
		{
			name: 'line',
			icon: 'lucide:list',
			title: ctx.t('section.lines'),
			fields: [
				'product',
				'quantity',
				'unit_price',
				'discount_pct',
				'tax_rate',
				...(header?.document_template ? ['print_values'] : [])
			],
			wide: ['print_values']
		}
	]}
/>
