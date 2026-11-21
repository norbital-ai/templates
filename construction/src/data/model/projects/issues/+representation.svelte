<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'issues'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const bimSummary = $derived(record?.bim_pin?.element_name ?? undefined);
	const followUpSummary = $derived(
		[record?.due_date, record?.reported_by].filter(Boolean).join(' · ') || undefined
	);
</script>

<RecordForm {ctx} {view} subtitle={['issue_number', 'kind', 'severity', 'status']}>
	<Section icon="lucide:triangle-alert" first name="issue" title={ctx.t('section.issue')}>
		<Grid minimum="compact">
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="kind" />
			<Field {ctx} name="severity" />
			<Field {ctx} name="status" />
			<Field {ctx} name="zone" />
			<Field {ctx} name="task_id" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section icon="lucide:camera" name="photos" title={ctx.t('section.photos_and_evidence')}>
		<Grid minimum="compact">
			<Column span="all"><Field {ctx} name="photos" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:box"
		name="bim"
		title={ctx.t('section.bim_tag')}
		default_open={view.mode === 'create' || record?.bim_pin != null}
		{...bimSummary ? { summary: bimSummary } : {}}
	>
		<Grid minimum="compact">
			<Field {ctx} name="bim_file_id" />
			<Column span="all"><Field {ctx} name="bim_pin" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:user-check"
		name="follow_up"
		title={ctx.t('section.follow_up')}
		default_open={false}
		{...followUpSummary ? { summary: followUpSummary } : {}}
	>
		<Grid minimum="compact">
			<Field {ctx} name="reported_by" />
			<Field {ctx} name="assignee" />
			<Field {ctx} name="party" />
			<Field {ctx} name="reported_date" />
			<Field {ctx} name="due_date" />
			<Field {ctx} name="closed_date" />
			<Field {ctx} name="source_message_id" />
			<Column span="all"><Field {ctx} name="resolution_notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
