<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Split } from '@norbital-ai/ui/layout';
	import { Map, Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

{#snippet geofenceTable()}
	<Table
		{ctx}
		of="geofences"
		key="config-geofences"
		order_by={{ code: 'asc' }}
		toolbar={{ title: t('app.configuration.geofences_list_title') }}
		columns={[
			'code',
			'name',
			'zone_type',
			'radius_m',
			'speed_limit_kmh',
			'alert_on_enter',
			'alert_on_exit',
			'active'
		]}
	/>
{/snippet}

{#snippet geofenceMap()}
	<Map
		{ctx}
		of="geofences"
		at="center"
		label="name"
		status="zone_type"
		badge="radius_m"
		fields={['code', 'speed_limit_kmh', 'active']}
		labels="always"
		toolbar={{ title: t('app.configuration.geofences_map_title'), new: false }}
	/>
{/snippet}

<AppShell
	icon="lucide:radar"
	title={t('app.configuration.page_geofences')}
	description={t('app.configuration.geofences_description')}
>
	<Split
		size="fill"
		ratio="wide"
		collapse="switch"
		start={geofenceTable}
		end={geofenceMap}
		switch_labels={[
			t('app.configuration.geofences_list_title'),
			t('app.configuration.geofences_map_title')
		]}
	/>
</AppShell>
