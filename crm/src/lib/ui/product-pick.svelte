<script lang="ts">
	/**
	 * A line's product: an active one, and picking it fills the catalogue's tax rate (and, on the sell side, its price)
	 * into the form, where the person still sees and may change them before saving.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import type { FormState } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';

	let { form, price }: { form: FormState; price?: 'unit_price' } = $props();
	const chosen = $derived(form.get('product_id'));

	async function pick(id: Id<'products'> | null) {
		form.set('product_id', id);
		if (id === null) return;
		const [p] = (
			await bolt.read('products', {
				select: { unit_price: true, tax_rate: true },
				where: { id: { eq: id } },
				limit: 1
			})
		).rows;
		// a decimal field's draft holds its text
		if (p?.tax_rate != null) form.set('tax_rate', String(p.tax_rate));
		if (price && p?.unit_price != null) form.set(price, String(p.unit_price));
	}
</script>

<Picker
	of="products"
	value={typeof chosen === 'string' ? (chosen as Id<'products'>) : null}
	where={{ active: { eq: true } }}
	onChange={pick}
/>
