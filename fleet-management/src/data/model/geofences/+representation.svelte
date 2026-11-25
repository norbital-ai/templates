<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, RecordForm, type RecordView, Section } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'geofences'>; ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<RecordForm {ctx} {view} subtitle={['zone_type', 'radius_m', 'active']}>
	<Section icon="lucide:radar" first name="geofence" title={t('section.geofence_zone')}>
		<Grid minimum="card">
			<Field {ctx} name="code" />
			<Field {ctx} name="name" />
			<Field {ctx} name="zone_type" />
			<Field {ctx} name="radius_m" />
			<Field {ctx} name="speed_limit_kmh" />
			<Field {ctx} name="alert_on_enter" />
			<Field {ctx} name="alert_on_exit" />
			<Field {ctx} name="active" />
			<Column span="all"><Field {ctx} name="center" /></Column>
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
