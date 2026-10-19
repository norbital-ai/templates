<script lang="ts">
	import CreateTable from '../../../lib/ui/create-table.svelte';
	import { bolt } from '$bolt';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

{#snippet products()}<CreateTable
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
{#snippet warehouses()}<CreateTable
		of="warehouses"
		columns={['external_code', 'name', 'group_code', 'active']}
	/>{/snippet}
<AppShell description="" icon="lucide:package" title={bolt.t('component.stock')} variant="full"
	><Tabs
		tabs={[
			{ name: 'products', title: bolt.t('models.products.label'), body: products },
			{ name: 'stock', title: bolt.t('models.stock_snapshots.label'), body: stock },
			{ name: 'warehouses', title: bolt.t('models.warehouses.label'), body: warehouses }
		]}
	/></AppShell
>
