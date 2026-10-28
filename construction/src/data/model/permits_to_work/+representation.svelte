<script lang="ts">
	import { bolt } from '$bolt';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'permits_to_work'>;
	} = $props();
	const t = bolt.t;
</script>

<RecordForm {view} subtitle={['permit_type', 'status']}>
	<Section first name="permit" title={t('section.permit')}>
		<Grid minimum="compact">
			<Field name="permit_number" />
			<Field name="permit_type" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field name="site_location_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.job_id == null}
				<Field name="job_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.worker_id == null}
				<Field name="worker_id" />
			{/if}
			<Field name="status" />
		</Grid>
	</Section>
	<Section name="validity" title={t('section.validity')}>
		<Grid minimum="compact">
			<Field name="requested_date" />
			<Field name="validity_range" />
			<Field name="approved_by" />
		</Grid>
	</Section>
	<Section name="signoff" title={t('section.signoff')}>
		<Field name="signatures" />
	</Section>
</RecordForm>
