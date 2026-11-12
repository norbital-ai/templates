<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'rfis'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['rfi_number', 'status']}>
	<Section icon="lucide:file-question" first name="rfi" title={ctx.t('section.rfi')}>
		<Grid minimum="compact">
			<Field {ctx} name="rfi_number" />
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="status" />
			<Field {ctx} name="priority" />
			<Field {ctx} name="asked_by" />
			<Field {ctx} name="assigned_to" />
			<Field {ctx} name="due_date" />
		</Grid>
	</Section>
	<Section
		icon="lucide:message-circle-question"
		name="question_and_answer"
		title={ctx.t('section.question_and_answer')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field {ctx} name="question" /></Column>
			<Column span="all"><Field {ctx} name="answer" /></Column>
		</Grid>
	</Section>
</RecordForm>
