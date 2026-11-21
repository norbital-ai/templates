<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'tasks'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const linksSummary = $derived(
		record?.bim_express_ids?.length
			? ctx.t('tasks.bim_linked_count', { count: record.bim_express_ids.length })
			: undefined
	);
</script>

<RecordForm {ctx} {view} subtitle={['task_code', 'trade', 'status', 'priority']}>
	<Section icon="lucide:list-checks" first name="task" title={ctx.t('section.task')}>
		<Grid minimum="compact">
			<Field {ctx} name="task_code" />
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="is_milestone" />
			<Field {ctx} name="zone" />
			<Field {ctx} name="trade" />
			<Field {ctx} name="status" />
			<Field {ctx} name="priority" />
			<Field {ctx} name="progress_pct" />
			<Field {ctx} name="schedule_range" />
			<Field {ctx} name="actual_range" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:link"
		name="programme"
		title={ctx.t('section.programme_and_links')}
		default_open={false}
		{...linksSummary ? { summary: linksSummary } : {}}
	>
		<Grid minimum="compact">
			<Field {ctx} name="parent_task_id" />
			<Field {ctx} name="cost_item_id" />
			<Field {ctx} name="assignee" />
			<Field {ctx} name="subcontractor_id" />
			<Field {ctx} name="bim_express_ids" />
			<Field {ctx} name="source_message_id" />
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
</RecordForm>
