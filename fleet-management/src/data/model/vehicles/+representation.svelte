<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		EmptyState,
		Field,
		Form,
		Map,
		RecordForm,
		RecordShell,
		type RecordView,
		Section,
		Sheet,
		Table
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'vehicles'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);

	let createSheet = $state<'routes' | 'fleet_alerts' | null>(null);

	const overlays = $derived.by(() => {
		if (!record || record.destination_location === null) return [];
		return [
			{
				lat: record.destination_location.lat,
				lng: record.destination_location.lng,
				text: `${record.registration_no} → ${record.destination_label ?? t('vehicle.destination')}`,
				...(record.last_location !== null ? { from: record.last_location } : {})
			}
		];
	});
</script>

{#snippet vehicleSections()}
	<Section icon="lucide:truck" first name="identity" title={t('section.vehicle_identity')}>
		<Grid minimum="card">
			<Field {ctx} name="registration_no" />
			<Field {ctx} name="vehicle_name" />
			<Field {ctx} name="vehicle_type" />
			<Field {ctx} name="transponder_id" />
			<Field {ctx} name="status" />
			<Field {ctx} name="driver_id" />
			<Field {ctx} name="speed_limit_kmh" />
		</Grid>
	</Section>
	<Section icon="lucide:gauge" name="telemetry_snapshot" title={t('section.live_telemetry')}>
		<Grid minimum="card">
			<Field {ctx} name="current_speed_kmh" />
			{#if record !== null}
				<Field {ctx} name="is_overspeed" readonly />
			{/if}
			<Field {ctx} name="heading_deg" />
			<Field {ctx} name="ignition_on" />
			<Field {ctx} name="odometer_km" />
			<Field {ctx} name="fuel_pct" />
			<Field {ctx} name="last_ping_at" />
			<Field {ctx} name="destination_label" />
			<Column span="all"><Field {ctx} name="last_location" /></Column>
			<Column span="all"><Field {ctx} name="destination_location" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:file-text"
		name="notes"
		title={t('section.notes')}
		default_open={false}
		{...record?.notes ? { summary: t('section.has_notes') } : {}}
	>
		<Field {ctx} name="notes" />
	</Section>
{/snippet}

{#if view.mode === 'create' || record === null}
	<RecordForm {ctx} {view} subtitle={['vehicle_type', 'transponder_id', 'status']}>
		{@render vehicleSections()}
	</RecordForm>
{:else}
	{#snippet mapTab()}
		{#if record.last_location === null}
			<EmptyState variant="inset" title={t('vehicle.no_gps_fix')} />
		{:else}
			<Map
				{ctx}
				of="vehicles"
				at="last_location"
				label="registration_no"
				status="status"
				badge="current_speed_kmh"
				fields={['vehicle_name', 'destination_label', 'heading_deg']}
				labels="always"
				{overlays}
				where={{ id: { eq: record.id } }}
				toolbar={{ title: false, new: false }}
			/>
		{/if}
	{/snippet}

	{#snippet telemetryTab()}
		<Table
			{ctx}
			of="telemetry_pings"
			key="vehicle-telemetry"
			where={{ vehicle_id: { eq: record.id } }}
			order_by={{ recorded_at: 'desc' }}
			toolbar={{ title: false, new: false }}
			columns={[
				'recorded_at',
				'speed_kmh',
				'heading_deg',
				'ignition_on',
				'odometer_km',
				'fuel_pct',
				'source',
				'route_id'
			]}
		/>
	{/snippet}

	{#snippet routesTab()}
		<Table
			{ctx}
			of="routes"
			key="vehicle-routes"
			where={{ vehicle_id: { eq: record.id } }}
			order_by={{ planned_departure: 'desc' }}
			toolbar={{
				title: false,
				new: ctx.catalog?.routes?.create ? () => (createSheet = 'routes') : false
			}}
			columns={[
				'route_number',
				'title',
				'status',
				'origin_name',
				'destination_name',
				'planned_distance_km',
				'eta_minutes',
				'max_speed_recorded_kmh'
			]}
		/>
	{/snippet}

	{#snippet alertsTab()}
		<Table
			{ctx}
			of="fleet_alerts"
			key="vehicle-alerts"
			where={{ vehicle_id: { eq: record.id } }}
			order_by={{ recorded_at: 'desc' }}
			toolbar={{
				title: false,
				new: ctx.catalog?.fleet_alerts?.create ? () => (createSheet = 'fleet_alerts') : false
			}}
			columns={[
				'alert_number',
				'recorded_at',
				'alert_type',
				'severity',
				'status',
				'measured_speed_kmh',
				'limit_kmh',
				'summary'
			]}
		/>
	{/snippet}

	<RecordShell
		{ctx}
		of="vehicles"
		mode={view.mode}
		id={record.id}
		subtitle={['transponder_id', 'status', 'current_speed_kmh']}
		tabs={[
			{ name: 'map', title: t('vehicle.tab_map'), icon: 'lucide:map-pin', body: mapTab },
			{
				name: 'telemetry',
				title: t('vehicle.tab_telemetry'),
				icon: 'lucide:radio',
				body: telemetryTab
			},
			{ name: 'routes', title: t('vehicle.tab_routes'), icon: 'lucide:route', body: routesTab },
			{ name: 'alerts', title: t('vehicle.tab_alerts'), icon: 'lucide:siren', body: alertsTab }
		]}
	>
		<Form {ctx} of="vehicles" mode={view.mode} size="content" id={record.id} {record}>
			{@render vehicleSections()}
		</Form>
	</RecordShell>

	<Sheet open={createSheet !== null} on_open_change={(open) => !open && (createSheet = null)}>
		{#if createSheet === 'routes'}
			<RecordShell
				{ctx}
				of="routes"
				mode="create"
				values={{
					vehicle_id: record.id,
					...(record.driver_id !== null ? { driver_id: record.driver_id } : {})
				}}
				on_done={() => (createSheet = null)}
			/>
		{:else if createSheet === 'fleet_alerts'}
			<RecordShell
				{ctx}
				of="fleet_alerts"
				mode="create"
				values={{ vehicle_id: record.id }}
				on_done={() => (createSheet = null)}
			/>
		{/if}
	</Sheet>
{/if}
