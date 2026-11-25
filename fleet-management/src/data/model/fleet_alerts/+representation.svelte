<script lang="ts">
	import { id_of } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		type FieldEditor,
		Picker,
		RecordForm,
		type RecordView,
		Section,
		use_record_controller
	} from '@norbital-ai/ui';
	import { Option, Schema } from 'effect';

	let { view, ctx }: { view: RecordView<'fleet_alerts'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);

	const fixedVehicle = $derived(
		record?.vehicle_id ??
			(view.mode === 'create' && typeof view.values.vehicle_id === 'string'
				? view.values.vehicle_id
				: null)
	);
	const hideVehicle = $derived(view.mode === 'create' && view.values.vehicle_id != null);
	const scopedVehicle = $derived.by(() => {
		const raw = liveForm?.get('vehicle_id');
		const id = typeof raw === 'string' ? raw : fixedVehicle;
		if (id === null) return null;
		return Option.getOrNull(Schema.decodeUnknownOption(id_of('vehicles'))(id));
	});
</script>

{#snippet routeEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="routes"
		id={field.id}
		{...scopedVehicle === null ? {} : { where: { vehicle_id: { eq: scopedVehicle } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

<RecordForm {ctx} {view} subtitle={['alert_type', 'severity', 'status']}>
	<Section icon="lucide:siren" first name="alert" title={t('section.alert_details')}>
		<Grid minimum="card">
			{#if !hideVehicle}
				<Field {ctx} name="vehicle_id" />
			{/if}
			<Field {ctx} name="route_id" editor={routeEditor} />
			<Field {ctx} name="geofence_id" />
			<Field {ctx} name="alert_type" />
			<Field {ctx} name="severity" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="recorded_at" />
			<Field {ctx} name="measured_speed_kmh" />
			<Field {ctx} name="limit_kmh" />
			<Column span="all"><Field {ctx} name="summary" /></Column>
			<Column span="all"><Field {ctx} name="location" /></Column>
		</Grid>
	</Section>
	<Section icon="lucide:check-circle-2" name="resolution" title={t('section.alert_resolution')}>
		<Grid minimum="card">
			{#if record?.resolved_at != null}
				<Field {ctx} name="resolved_at" readonly />
			{/if}
			<Column span="all"><Field {ctx} name="resolution_notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
