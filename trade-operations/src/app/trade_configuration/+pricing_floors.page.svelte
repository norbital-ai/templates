<script lang="ts">
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
</script>

<AppShell
	icon="lucide:settings"
	title={bolt.t('models.pricing_floors.label')}
	description={bolt.t('app.trade_configuration.description')}
	variant="full"
	><Table
		of="pricing_floors"
		columns={[
			'product',
			'group_code',
			'effective_on',
			'currency',
			'floor_price',
			'unit',
			'minimum_quantity'
		]}
	/></AppShell
>
