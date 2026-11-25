<script lang="ts">
	import { id_of } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		type FieldEditor,
		Form,
		Picker,
		RecordForm,
		RecordShell,
		type RecordView,
		Section,
		Sheet,
		Table,
		use_record_controller
	} from '@norbital-ai/ui';
	import { Option, Schema } from 'effect';
	import CatalogLinesEditor from '../../../../lib/CatalogLinesEditor.svelte';
	import { decodePricedLines } from '../../../../lib/commercial.js';

	let { view, ctx }: { view: RecordView<'commercial_documents'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
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
	const scopedContract = $derived.by(() => {
		const raw = liveForm?.get('contract_id');
		const id =
			typeof raw === 'string'
				? raw
				: (record?.contract_id ??
					(view.mode === 'create' && typeof view.values.contract_id === 'string'
						? view.values.contract_id
						: null));
		if (id === null) return null;
		return Option.getOrNull(Schema.decodeUnknownOption(id_of('contracts'))(id));
	});
	const scopedParentDoc = $derived.by(() => {
		const raw = liveForm?.get('parent_document_id');
		const id =
			typeof raw === 'string'
				? raw
				: (record?.parent_document_id ??
					(view.mode === 'create' && typeof view.values.parent_document_id === 'string'
						? view.values.parent_document_id
						: null));
		if (id === null) return null;
		return Option.getOrNull(Schema.decodeUnknownOption(id_of('commercial_documents'))(id));
	});

	let createLinkedType = $state<'delivery_order' | 'invoice' | null>(null);
	const canCreateTx = $derived(ctx.catalog?.commercial_documents?.create !== undefined);
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

{#snippet catalogLinesEditor(field: FieldEditor)}
	<CatalogLinesEditor
		{ctx}
		value={decodePricedLines(field.value)}
		disabled={field.disabled}
		projectId={scopedProject}
		parentContractId={scopedContract}
		parentDocumentId={scopedParentDoc}
		onChange={(next) => field.on_change(next ? [...next] : null)}
	/>
{/snippet}

{#snippet docSections()}
	<Section icon="lucide:banknote" first name="document" title={t('section.commercial_document')}>
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

	<Section icon="lucide:receipt" name="amounts" title={t('section.amounts_and_matching')}>
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
			<Column span="all"><Field {ctx} name="lines" editor={catalogLinesEditor} /></Column>
		</Grid>
	</Section>

	<Section
		icon="lucide:paperclip"
		name="supporting"
		title={t('section.supporting_docs')}
		default_open={false}
	>
		<Grid minimum="card">
			<Field {ctx} name="source_message_id" editor={sourceMessageEditor} />
			<Column span="all"><Field {ctx} name="description" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
{/snippet}

{#snippet linkedTransactionsTab()}
	{#if record}
		<Table
			{ctx}
			of="commercial_documents"
			key={`doc:linked:${record.id}`}
			where={{ parent_document_id: { eq: record.id } }}
			order_by={{ issue_date: 'desc' }}
			toolbar={{
				title: t('commercial.tab_transactions'),
				actions: canCreateTx
					? [
							{
								icon: 'lucide:truck',
								name: t('commercial.new_do'),
								run: () => {
									createLinkedType = 'delivery_order';
								}
							},
							{
								icon: 'lucide:receipt',
								name: t('commercial.new_invoice'),
								run: () => {
									createLinkedType = 'invoice';
								}
							}
						]
					: [],
				new: false
			}}
			columns={[
				'document_number',
				'doc_type',
				'external_reference',
				'status',
				'match_status',
				'total_amount',
				'net_amount',
				'delivery_date',
				'due_date'
			]}
		/>
	{/if}
{/snippet}

{#if record && record.doc_type === 'purchase_order'}
	<RecordShell
		{ctx}
		of="commercial_documents"
		mode={view.mode}
		id={record.id}
		subtitle={['doc_type', 'direction', 'status']}
		tabs={[
			{
				name: 'linked',
				title: t('commercial.tab_transactions'),
				icon: 'lucide:receipt',
				body: linkedTransactionsTab
			}
		]}
	>
		<Form {ctx} of="commercial_documents" mode={view.mode} id={record.id} {record} size="content">
			{@render docSections()}
		</Form>
	</RecordShell>
{:else}
	<RecordForm {ctx} {view} subtitle={['doc_type', 'direction', 'status']}>
		{@render docSections()}
	</RecordForm>
{/if}

<Sheet
	open={createLinkedType !== null}
	on_open_change={(open) => !open && (createLinkedType = null)}
>
	{#if createLinkedType !== null && record}
		<RecordShell
			{ctx}
			of="commercial_documents"
			mode="create"
			values={{
				project_id: record.project_id,
				...(record.contract_id != null ? { contract_id: record.contract_id } : {}),
				...(record.contact_id != null ? { contact_id: record.contact_id } : {}),
				parent_document_id: record.id,
				direction: record.direction,
				doc_type: createLinkedType,
				currency: record.currency
			}}
			on_done={() => (createLinkedType = null)}
		/>
	{/if}
</Sheet>
