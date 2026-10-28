<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'defects'>;
	} = $props();
	const t = bolt.t;
</script>

<RecordForm {view} subtitle={['defect_number', 'status']}>
	<Section first name="defect" title={t('section.defect')}>
		<Grid minimum="compact">
			<Field name="defect_number" />
			<Field name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field name="site_location_id" />
			{/if}
			<Field name="category" />
			<Field name="severity" />
			<Field name="status" />
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	</Section>
	<Section name="follow_up" title={t('section.follow_up')}>
		<Grid minimum="compact">
			<Field name="assigned_to" />
			<Field name="due_date" />
			<Field name="closed_date" />
			<Column span="all"><Field name="resolution_notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
