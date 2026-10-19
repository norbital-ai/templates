<script lang="ts">
	import { run } from '$bolt';
	import { selectOrderProduct } from './order-product-defaults.js';
	import { Field, Picker, MoneyInput, type FormState } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let {
		form
	}: {
		form: FormState;
	} = $props();
	let chosenCurrency = $state<string | undefined>(undefined);
</script>

<Grid tracks="2" gap="md">
	<Field name="product"
		>{#snippet editor(field)}<Picker
				of="products"
				id={field.id}
				value={form.id<'products'>('product')}
				where={{ active: { eq: true } }}
				disabled={field.disabled}
				invalid={Boolean(field.error)}
				onChange={(id) =>
					void run(
						selectOrderProduct(form, field, id, (value) => {
							chosenCurrency = value;
						})
					)}
			/>{/snippet}</Field
	>
	<Field name="quantity" />
	<Field name="unit_price"
		>{#snippet editor(field)}<MoneyInput
				id={field.id}
				value={field.value}
				onChange={field.onChange}
				{...chosenCurrency ? { currency: chosenCurrency } : {}}
				scale={4}
				disabled={field.disabled}
				invalid={Boolean(field.error)}
			/>{/snippet}</Field
	>
	<Field name="discount_pct" /><Field name="tax_rate" />
</Grid>
