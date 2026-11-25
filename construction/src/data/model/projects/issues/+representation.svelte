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

	let { view, ctx }: { view: RecordView<'issues'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const bimSummary = $derived(record?.bim_pin?.element_name ?? undefined);
	const followUpSummary = $derived(record?.due_date ?? undefined);

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

{#snippet taskEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="tasks"
		id={field.id}
		{...scopedProject === null ? {} : { where: { project_id: { eq: scopedProject } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

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

<RecordForm {ctx} {view} subtitle={['kind', 'trade_specialty', 'severity', 'status']}>
	<Section icon="lucide:triangle-alert" first name="issue" title={ctx.t('section.issue')}>
		<Grid minimum="card">
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="kind" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="severity" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="zone" />
			<Field {ctx} name="task_id" editor={taskEditor} />
			<Field {ctx} name="contract_id" editor={contractEditor} />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section icon="lucide:camera" name="photos" title={ctx.t('section.photos_and_evidence')}>
		<Grid minimum="card">
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
		<Grid minimum="card">
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
		<Grid minimum="card">
			<Field {ctx} name="assignee" />
			<Field {ctx} name="party" />
			<Field {ctx} name="reported_date" />
			<Field {ctx} name="due_date" />
			<Field {ctx} name="closed_date" />
			<Field {ctx} name="source_message_id" editor={sourceMessageEditor} />
			<Column span="all"><Field {ctx} name="resolution_notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
