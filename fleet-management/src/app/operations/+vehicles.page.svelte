<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:truck"
	title={ctx.t('app.operations.page_vehicles')}
	description={ctx.t('app.operations.vehicles_description')}
>
	<Table
		{ctx}
		of="vehicles"
		order_by={{ registration_no: 'asc' }}
		toolbar={{ title: false }}
		columns={[
			'registration_no',
			'vehicle_name',
			'transponder_id',
			'status',
			'driver_id',
			'current_speed_kmh',
			'speed_limit_kmh',
			'destination_label',
			'fuel_pct',
			'last_ping_at'
		]}
	/>
</AppShell>
