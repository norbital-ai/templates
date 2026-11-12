<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'defects'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['defect_number', 'status']}>
	<Section icon="lucide:triangle-alert" first name="defect" title={ctx.t('section.defect')}>
		<Grid minimum="compact">
			<Field {ctx} name="defect_number" />
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field {ctx} name="site_location_id" />
			{/if}
			<Field {ctx} name="category" />
			<Field {ctx} name="severity" />
			<Field {ctx} name="status" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section icon="lucide:calendar-check" name="follow_up" title={ctx.t('section.follow_up')}>
		<Grid minimum="compact">
			<Field {ctx} name="assigned_to" />
			<Field {ctx} name="due_date" />
			<Field {ctx} name="closed_date" />
			<Column span="all"><Field {ctx} name="resolution_notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
