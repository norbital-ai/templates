<script lang="ts">
	import { bolt } from '$bolt';
	import { type FormState, useKinds } from '@norbital-ai/ui';
	import { currency as currencyCode, Decimal } from '@norbital-ai/std/decimal';
	import { Result } from 'effect';

	let {
		form
	}: {
		form: FormState;
	} = $props();
	const kinds = useKinds();
	const basis = $derived.by(() => {
		const product = form.id<'products'>('product'),
			unit = String(form.row.unit ?? ''),
			currency = String(form.row.currency ?? ''),
			price = String(form.row.floor_price ?? '');
		if (
			!product ||
			!unit ||
			!currency ||
			!price ||
			!kinds.catalog?.pricing_floors?.queries?.inventory_cost
		)
			return null;
		return Result.getOrNull(
			Result.try(() => ({
				product,
				unit,
				currency: currencyCode(currency),
				price: Decimal.of(price),
				tax_inclusive: form.row.tax_inclusive === true,
				tax_rate: Decimal.of(String(form.row.tax_rate ?? '0'))
			}))
		);
	});
	const result = $derived(
		basis === null ? null : bolt.query('pricing_floors.inventory_cost', basis)
	);
</script>

{#if result?.error}<p role="status" class="text-sm text-muted-foreground">
		{bolt.t('component.inventory_cost_unavailable')}
	</p>{:else if result?.current?.below}<p role="status" class="text-sm text-foreground">
		{bolt.t('component.below_inventory_cost')}
	</p>{/if}
