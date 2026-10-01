<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'rfis'> } = $props();
	const t = bolt.t;
</script>

<RecordForm {view} subtitle={['rfi_number', 'status']}>
	<Section first name="rfi" title={t('section.rfi')}>
		<Grid minimum="compact">
			<Field name="rfi_number" />
			<Field name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<RefField name="project_id" ref="project" />
			{/if}
			<Field name="status" />
			<Field name="priority" />
			<Field name="asked_by" />
			<Field name="assigned_to" />
			<Field name="due_date" />
		</Grid>
	</Section>
	<Section name="question_and_answer" title={t('section.question_and_answer')}>
		<Grid minimum="compact">
			<Column span="all"><Field name="question" /></Column>
			<Column span="all"><Field name="answer" /></Column>
		</Grid>
	</Section>
</RecordForm>
