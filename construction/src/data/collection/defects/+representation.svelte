<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'defects'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['defect_number', 'status']}>
	<Section first name="defect" title={t('section.defect')}>
		<Grid minimum="compact">
			<Field name="defect_number" />
			<Field name="title" />
			<RefField name="project_id" ref="project" />
			<RefField name="site_location_id" ref="site" />
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
		</Grid>
	</Section>
	<Section
		name="resolution_notes"
		title={t('section.resolution_notes')}
		defaultOpen={false}
		summary={record?.['resolution_notes'] || t('section.no_notes')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field name="resolution_notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
