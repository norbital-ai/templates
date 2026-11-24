<script lang="ts">
	import { id_of } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		Picker,
		Section,
		use_record_controller,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { Option, Schema } from 'effect';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'commercial_documents'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
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

{#snippet parentDocEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="commercial_documents"
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

<RecordForm {ctx} {view} subtitle={['doc_type', 'direction', 'status']}>
	<Section
		icon="lucide:banknote"
		first
		name="document"
		title={ctx.t('section.commercial_document')}
	>
		<Grid minimum="card">
			<Field {ctx} name="doc_type" />
			<Field {ctx} name="direction" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="external_reference" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="contract_id" editor={contractEditor} />
			<Field {ctx} name="contact_id" />
			<Field {ctx} name="parent_document_id" editor={parentDocEditor} />
			<Field {ctx} name="issue_date" />
			<Field {ctx} name="delivery_date" />
			<Field {ctx} name="due_date" />
			<Field {ctx} name="paid_date" />
		</Grid>
	</Section>

	<Section icon="lucide:receipt" name="amounts" title={ctx.t('section.amounts_and_matching')}>
		<Grid minimum="card">
			<Field {ctx} name="currency" />
			<Field {ctx} name="subtotal" />
			<Field {ctx} name="tax_rate" />
			{#if record}
				<Field {ctx} name="tax_amount" readonly />
				<Field {ctx} name="total_amount" readonly />
			{/if}
			<Field {ctx} name="retention_amount" />
			<Field {ctx} name="certified_amount" />
			{#if record}
				<Field {ctx} name="net_amount" readonly />
				<Field {ctx} name="match_status" readonly />
				{#if record.match_notes}
					<Column span="all"><Field {ctx} name="match_notes" readonly /></Column>
				{/if}
			{/if}
			<Column span="all"><Field {ctx} name="lines" /></Column>
		</Grid>
	</Section>

	<Section
		icon="lucide:paperclip"
		name="supporting"
		title={ctx.t('section.supporting_docs')}
		default_open={false}
	>
		<Grid minimum="card">
			<Field {ctx} name="source_message_id" editor={sourceMessageEditor} />
			<Column span="all"><Field {ctx} name="description" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
</RecordForm>
