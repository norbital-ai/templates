<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'job_assignments'>; ctx: PageContext } = $props();
</script>

<RecordForm {view} subtitle={['role', 'status']}>
	<Section icon="lucide:hard-hat" first name="assignment" title={ctx.t('section.assignment')}>
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
	<Section icon="lucide:calendar-days" name="schedule" title={ctx.t('section.schedule')}>
		<Grid minimum="compact">
			<Field name="assignment_range" />
			<Field name="hours_per_day" />
		</Grid>
	</Section>
</RecordForm>
