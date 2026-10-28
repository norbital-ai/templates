<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'jobs'>;
	} = $props();
	const t = bolt.t;
</script>

<RecordForm {view} subtitle={['job_number', 'status']}>
	<Section first name="job" title={t('section.job')}>
		<Grid minimum="compact">
			<Field name="job_title" />
			<Field name="job_number" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field name="site_location_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.bim_reference_id == null}
				<Field name="bim_reference_id" />
			{/if}
			<Field name="job_type" />
			<Field name="status" />
			<Field name="priority" />
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	</Section>
	<Section name="schedule_and_budget" title={t('section.schedule_and_budget')}>
		<Grid minimum="compact">
			<Field name="schedule_range" />
			<Field name="currency" />
			<Field name="budget" />
		</Grid>
	</Section>
</RecordForm>
