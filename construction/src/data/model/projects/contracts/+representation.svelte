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

	let { view, ctx }: { view: RecordView<'contracts'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const revCount = $derived(record?.revisions?.length ?? 0);
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

{#snippet parentContractEditor(field: FieldEditor)}
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

<RecordForm {ctx} {view} subtitle={['direction', 'contract_type', 'trade_specialty', 'status']}>
	<Section icon="lucide:file-signature" first name="contract" title={ctx.t('section.contract')}>
		<Grid minimum="card">
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="direction" />
			<Field {ctx} name="contract_type" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="contact_id" />
			<Field {ctx} name="parent_contract_id" editor={parentContractEditor} />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="contract_period" />
			<Field {ctx} name="signed_date" />
			<Field {ctx} name="schedule_impact_days" />
		</Grid>
	</Section>

	<Section
		icon="lucide:calculator"
		name="commercial_terms"
		title={ctx.t('section.commercial_terms')}
	>
		<Grid minimum="card">
			<Field {ctx} name="currency" />
			<Field {ctx} name="contract_value" />
			<Field {ctx} name="tax_rate" />
			<Field {ctx} name="retention_rate" />
			<Field {ctx} name="retention_cap_rate" />
			<Field {ctx} name="payment_terms_days" />
			<Field {ctx} name="dlp_months" />
			<Field {ctx} name="bond_amount" />
			<Field {ctx} name="insurance_expiry" />
			<Column span="all"><Field {ctx} name="lines" /></Column>
		</Grid>
	</Section>

	<Section
		icon="lucide:file-text"
		name="scope"
		title={ctx.t('section.scope_and_docs')}
		default_open={false}
	>
		<Grid minimum="card">
			<Field {ctx} name="source_message_id" editor={sourceMessageEditor} />
			<Column span="all"><Field {ctx} name="scope_notes" /></Column>
			<Column span="all"><Field {ctx} name="bim_pin" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>

	{#if record && revCount > 0}
		<Section
			icon="lucide:history"
			name="revisions"
			title={ctx.t('project_files.revision_history')}
			default_open={false}
			summary={ctx.t('project_files.revision_count', { count: revCount })}
		>
			<Field {ctx} name="revisions" readonly />
		</Section>
	{/if}
</RecordForm>
