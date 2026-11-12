<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'job_assignments'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['role', 'status']}>
	<Section icon="lucide:hard-hat" first name="assignment" title={ctx.t('section.assignment')}>
		<Grid minimum="compact">
			<Field {ctx} name="assignment_code" />
			<Field {ctx} name="status" />
			{#if view.mode !== 'create' || view.values.job_id == null}
				<Field {ctx} name="job_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.worker_id == null}
				<Field {ctx} name="worker_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field {ctx} name="site_location_id" />
			{/if}
			<Field {ctx} name="role" />
		</Grid>
	</Section>
	<Section icon="lucide:calendar-days" name="schedule" title={ctx.t('section.schedule')}>
		<Grid minimum="compact">
			<Field {ctx} name="assignment_range" />
			<Field {ctx} name="hours_per_day" />
		</Grid>
	</Section>
</RecordForm>
