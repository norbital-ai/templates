<script lang="ts">
	import { bolt } from '$bolt';
	import { type FormState, useKinds } from '@norbital-ai/ui';
	import { currency as currencyCode, Decimal } from '@norbital-ai/std/decimal';
	import { Result } from 'effect';
	import {
		estimateFifoCost,
		floorNetPrice,
		inventoryCost,
		inventoryCostRead,
		purchaseLotCostRead
	} from '../lot-cost.js';

	let {
		form
	}: {
		form: FormState;
	} = $props();
	const kinds = useKinds();
	const clock = bolt.clock('minute');
	const warehouseGroup = $derived(String(form.row.group_code ?? '').trim());
	const basis = $derived.by(() => {
		const product = form.id<'products'>('product'),
			unit = String(form.row.unit ?? ''),
			currency = String(form.row.currency ?? ''),
			price = String(form.row.floor_price ?? '');
		if (!product || !unit || !currency || !price || !kinds.catalog?.stock_snapshots) return null;
		return Result.getOrNull(
			Result.try(() => ({
				product,
				unit,
				currency: currencyCode(currency),
				price: Decimal.of(price),
				tax_inclusive: form.row.tax_inclusive === true,
				tax_rate: Decimal.of(String(form.row.tax_rate ?? '0')),
				quantity: Decimal.of(String(form.row.minimum_quantity ?? '0'))
			}))
		);
	});
	// the product's lots are read once per product; the comparison follows the edited price
	const product = $derived(basis?.product ?? null);
	const lots = $derived(
		product === null ? null : bolt.query(inventoryCostRead(product, warehouseGroup))
	);
	const item = $derived(lots?.current?.products.rows[0]);
	const costs = $derived(
		item && kinds.catalog?.source_lot_costs && basis?.quantity.gt(0) && warehouseGroup
			? bolt.query(purchaseLotCostRead(item.source))
			: null
	);
	const purchase = $derived(costs?.current?.source_lot_costs.rows[0]);
	const fifo = $derived(
		basis &&
			item &&
			purchase &&
			lots?.current &&
			!lots.current.stock_snapshots.next &&
			!lots.current.warehouses.next
			? estimateFifoCost(lots.current.stock_snapshots.rows, purchase, {
					product: basis.product,
					productCode: item.external_code,
					source: item.source,
					warehouses: lots.current.warehouses.rows
						.filter((row) => row.source === item.source)
						.map((row) => row.id),
					quantity: basis.quantity,
					unit: basis.unit,
					currency: basis.currency,
					asOf: clock.now
				})
			: null
	);
	const below = $derived(
		basis !== null && lots?.current ? inventoryCost(lots.current, basis).below : false
	);
</script>

{#if fifo && basis}<p role="status" class="text-sm text-muted-foreground">
		{bolt.t('stock.fifo.title')} · {basis.quantity.toString()}
		{basis.unit} · {basis.currency}
		{fifo.unit_cost.round(4).toString()} / {basis.unit}
		{#if floorNetPrice(basis).lt(fifo.unit_cost)}
			· {bolt.t('stock.fifo.below_floor')}{/if}
	</p>{:else if lots?.error || costs?.error || purchase}<p
		role="status"
		class="text-sm text-muted-foreground"
	>
		{bolt.t('component.inventory_cost_unavailable')}
	</p>{:else if below}<p role="status" class="text-sm text-foreground">
		{bolt.t('component.below_inventory_cost')}
	</p>{/if}
