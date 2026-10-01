<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'jobs'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['job_number', 'status']}>
	<Section first name="job" title={t('section.job')}>
		<Grid minimum="compact">
			<Field name="job_title" />
			<Field name="job_number" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<RefField name="project_id" ref="project" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<RefField name="site_location_id" ref="site" />
			{/if}
			{#if view.mode !== 'create' || view.values.bim_reference_id == null}
				<RefField name="bim_reference_id" ref="bim" />
			{/if}
			<Field name="job_type" />
			<Field name="status" />
			<Field name="priority" />
		</Grid>
	</Section>
	<Section name="schedule_and_budget" title={t('section.schedule_and_budget')}>
		<Grid minimum="compact">
			<Field name="schedule_range" />
			<Field name="currency" />
			<Field name="budget" />
		</Grid>
	</Section>
	<Section
		name="description"
		title={t('section.description')}
		defaultOpen={false}
		summary={record?.['description'] || t('section.no_description')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	</Section>
</RecordForm>
