<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:route"
	title={ctx.t('app.operations.page_routes')}
	description={ctx.t('app.operations.routes_description')}
>
	<Table
		{ctx}
		of="routes"
		order_by={{ planned_departure: 'desc' }}
		toolbar={{ title: false }}
		columns={[
			'route_number',
			'title',
			'vehicle_id',
			'driver_id',
			'status',
			'origin_name',
			'destination_name',
			'planned_distance_km',
			'eta_minutes',
			'max_speed_recorded_kmh'
		]}
	/>
</AppShell>
