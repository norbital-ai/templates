<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'sustainability_logs'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
</script>

<RecordForm {ctx} {view} subtitle={['project_id']}>
	<Section
		icon="lucide:zap"
		first
		name="energy_emissions"
		title={t('section.site_energy_emissions')}
	>
		<Grid minimum="compact">
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="reporting_period" />
			<Field {ctx} name="electricity_kwh" />
			<Field {ctx} name="diesel_litres" />
			<Field {ctx} name="transport_tco2e" />
		</Grid>
	</Section>
	<Section icon="lucide:droplets" name="water_waste" title={t('section.site_water_waste')}>
		<Grid minimum="compact">
			<Field {ctx} name="water_m3" />
			<Field {ctx} name="newater_m3" />
			<Field {ctx} name="waste_generated_t" />
			<Field {ctx} name="waste_diverted_t" />
			<Field {ctx} name="waste_hazardous_t" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
