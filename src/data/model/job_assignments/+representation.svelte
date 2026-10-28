<script lang="ts">
	import { bolt } from '$bolt';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'job_assignments'>;
	} = $props();
	const t = bolt.t;
</script>

<RecordForm {view} subtitle={['role', 'status']}>
	<Section first name="assignment" title={t('section.assignment')}>
		<Grid minimum="compact">
			<Field name="assignment_code" />
			<Field name="status" />
			{#if view.mode !== 'create' || view.values.job_id == null}
				<Field name="job_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.worker_id == null}
				<Field name="worker_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field name="site_location_id" />
			{/if}
			<Field name="role" />
		</Grid>
	</Section>
	<Section name="schedule" title={t('section.schedule')}>
		<Grid minimum="compact">
			<Field name="assignment_range" />
			<Field name="hours_per_day" />
		</Grid>
	</Section>
</RecordForm>
