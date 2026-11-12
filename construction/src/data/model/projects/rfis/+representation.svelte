<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'rfis'>; ctx: PageContext } = $props();
</script>

<RecordForm {view} subtitle={['rfi_number', 'status']}>
	<Section icon="lucide:file-question" first name="rfi" title={ctx.t('section.rfi')}>
		<Grid minimum="compact">
			<Field name="rfi_number" />
			<Field name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field name="project_id" />
			{/if}
			<Field name="status" />
			<Field name="priority" />
			<Field name="asked_by" />
			<Field name="assigned_to" />
			<Field name="due_date" />
		</Grid>
	</Section>
	<Section
		icon="lucide:message-circle-question"
		name="question_and_answer"
		title={ctx.t('section.question_and_answer')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field name="question" /></Column>
			<Column span="all"><Field name="answer" /></Column>
		</Grid>
	</Section>
</RecordForm>
