<script lang="ts">
	import { bolt } from '$bolt';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

{#snippet products()}<Table
		of="products"
		columns={['external_code', 'name', 'unit', 'unit_price', 'active']}
	/>{/snippet}
{#snippet stock()}<Table
		layout="grid"
		of="stock_snapshots"
		columns={[
			'product',
			'warehouse',
			'lot_number',
			'unit',
			'on_hand',
			'currency',
			'unit_cost',
			'as_of'
		]}
		toolbar={{ new: false, export: true }}
	/>{/snippet}
{#snippet warehouses()}<Table
		of="warehouses"
		columns={['external_code', 'name', 'group_code', 'active']}
	/>{/snippet}
<AppShell
	description={bolt.t('app.warehouse.description')}
	icon="lucide:package"
	title={bolt.t('component.stock')}
	variant="full"
	><Tabs
		tabs={[
			{ name: 'products', title: bolt.t('models.products.label'), body: products },
			{ name: 'stock', title: bolt.t('models.stock_snapshots.label'), body: stock },
			{ name: 'warehouses', title: bolt.t('models.warehouses.label'), body: warehouses }
		]}
	/></AppShell
>
