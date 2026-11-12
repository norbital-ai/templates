<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'jobs'>; ctx: PageContext } = $props();
</script>

<RecordForm {view} subtitle={['job_number', 'status']}>
	<Section icon="lucide:briefcase" first name="job" title={ctx.t('section.job')}>
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
	<Section
		icon="lucide:calendar-days"
		name="schedule_and_budget"
		title={ctx.t('section.schedule_and_budget')}
	>
		<Grid minimum="compact">
			<Field name="schedule_range" />
			<Field name="currency" />
			<Field name="budget" />
		</Grid>
	</Section>
</RecordForm>
