<script lang="ts">
	import { id_of } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		type FieldEditor,
		Picker,
		RecordForm,
		type RecordView,
		Section,
		use_record_controller
	} from '@norbital-ai/ui';
	import { Option, Schema } from 'effect';

	let { view, ctx }: { view: RecordView<'tasks'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const linksSummary = $derived(
		record?.bim_express_ids?.length
			? t('tasks.bim_linked_count', { count: record.bim_express_ids.length })
			: undefined
	);

	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const fixedProject = $derived(
		record?.project_id ??
			(view.mode === 'create' && typeof view.values.project_id === 'string'
				? view.values.project_id
				: null)
	);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
	const scopedProject = $derived.by(() => {
		const raw = liveForm?.get('project_id');
		const id = typeof raw === 'string' ? raw : fixedProject;
		if (id === null) return null;
		return Option.getOrNull(Schema.decodeUnknownOption(id_of('projects'))(id));
	});
</script>

{#snippet contractEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="contracts"
		id={field.id}
		{...scopedProject === null ? {} : { where: { project_id: { eq: scopedProject } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet sourceMessageEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="project_messages"
		id={field.id}
		{...scopedProject === null ? {} : { where: { project_id: { eq: scopedProject } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet taskSections()}
	<Section icon="lucide:list-checks" first name="task" title={t('section.task')}>
		<Grid minimum="card">
			<Field {ctx} name="wbs_path" help={t('tasks.wbs_path_help')} />
			<Field {ctx} name="task_code" />
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="is_milestone" />
			<Field {ctx} name="zone" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="subcontractor_id" />
			<Field {ctx} name="contract_id" editor={contractEditor} />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="priority" />
			<Field {ctx} name="progress_pct" />
			<Field {ctx} name="schedule_range" />
			<Field {ctx} name="actual_range" />
			<Field {ctx} name="baseline_range" />
			<Field {ctx} name="last_updated_on" />
			<Column span="all"><Field {ctx} name="latest_update" /></Column>
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:link"
		name="programme"
		title={t('section.programme_and_links')}
		default_open={false}
		{...linksSummary ? { summary: linksSummary } : {}}
	>
		<Grid minimum="card">
			<Field {ctx} name="assignee" />
			<Field {ctx} name="external_id" />
			<Field {ctx} name="bim_express_ids" />
			<Field {ctx} name="source_message_id" editor={sourceMessageEditor} />
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
{/snippet}

<RecordForm {ctx} {view} subtitle={['trade_specialty', 'status', 'priority']}>
	{@render taskSections()}
</RecordForm>
