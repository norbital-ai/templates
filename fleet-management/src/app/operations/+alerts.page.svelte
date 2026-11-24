<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:siren"
	title={ctx.t('app.operations.page_alerts')}
	description={ctx.t('app.operations.alerts_description')}
>
	<Table
		{ctx}
		of="fleet_alerts"
		order_by={{ recorded_at: 'desc' }}
		toolbar={{ title: false }}
		columns={[
			'alert_number',
			'recorded_at',
			'vehicle_id',
			'alert_type',
			'severity',
			'status',
			'measured_speed_kmh',
			'limit_kmh',
			'summary'
		]}
	/>
</AppShell>
