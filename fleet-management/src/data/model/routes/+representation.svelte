<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'routes'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const hideVehicle = $derived(view.mode === 'create' && view.values.vehicle_id != null);
</script>

<RecordForm {ctx} {view} subtitle={['vehicle_id', 'status', 'eta_minutes']}>
	<Section icon="lucide:route" first name="dispatch" title={t('section.route_dispatch')}>
		<Grid minimum="card">
			<Field {ctx} name="title" />
			{#if !hideVehicle}
				<Field {ctx} name="vehicle_id" />
			{/if}
			<Field {ctx} name="driver_id" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="planned_departure" />
			<Field {ctx} name="planned_arrival" />
			{#if record?.actual_departure != null}
				<Field {ctx} name="actual_departure" readonly />
			{/if}
			{#if record?.actual_arrival != null}
				<Field {ctx} name="actual_arrival" readonly />
			{/if}
		</Grid>
	</Section>
	<Section icon="lucide:map-pin" name="locations" title={t('section.route_locations')}>
		<Grid minimum="card">
			<Field {ctx} name="origin_name" />
			<Field {ctx} name="destination_name" />
			<Column span="all"><Field {ctx} name="origin_location" /></Column>
			<Column span="all"><Field {ctx} name="destination_location" /></Column>
			<Column span="all"><Field {ctx} name="waypoints" /></Column>
		</Grid>
	</Section>
	<Section icon="lucide:gauge" name="metrics" title={t('section.route_metrics')}>
		<Grid minimum="card">
			{#if record !== null}
				<Field {ctx} name="planned_distance_km" readonly />
				<Field {ctx} name="actual_distance_km" />
			{/if}
			<Field {ctx} name="eta_minutes" />
			{#if record?.max_speed_recorded_kmh != null}
				<Field {ctx} name="max_speed_recorded_kmh" readonly />
			{/if}
			<Column span="all"><Field {ctx} name="cargo_notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
