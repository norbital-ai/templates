<script lang="ts">
	import { id_of } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		Form,
		Picker,
		RecordShell,
		Section,
		Sheet,
		Table,
		use_record_controller,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { Option, Schema } from 'effect';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'contracts'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
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

	type ChildSheet =
		| null
		| { kind: 'transaction'; doc_type: 'delivery_order' | 'invoice' | 'progress_claim' }
		| { kind: 'variation' };
	let childSheet = $state<ChildSheet>(null);
	const canCreateTx = $derived(ctx.catalog?.commercial_documents?.create !== undefined);
	const canCreateVo = $derived(ctx.catalog?.contracts?.create !== undefined);
	const txDirection = $derived(record?.direction === 'upstream' ? 'inflow' : 'outflow');
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

{#snippet contractSections()}
	<Section icon="lucide:file-signature" first name="contract" title={t('section.contract')}>
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

	<Section icon="lucide:calculator" name="commercial_terms" title={t('section.commercial_terms')}>
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
		title={t('section.scope_and_docs')}
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
			title={t('project_files.revision_history')}
			default_open={false}
			summary={t('project_files.revision_count', { count: revCount })}
		>
			<Field {ctx} name="revisions" readonly />
		</Section>
	{/if}
{/snippet}

{#snippet transactionsTab()}
	{#if record}
		<Table
			{ctx}
			of="commercial_documents"
			key={`contract:tx:${record.id}`}
			where={{ contract_id: { eq: record.id } }}
			order_by={{ issue_date: 'desc' }}
			toolbar={{
				title: t('commercial.tab_transactions'),
				actions: canCreateTx
					? [
							{
								icon: 'lucide:truck',
								name: t('commercial.new_do'),
								run: () => {
									childSheet = { kind: 'transaction', doc_type: 'delivery_order' };
								}
							},
							{
								icon: 'lucide:receipt',
								name: t('commercial.new_invoice'),
								run: () => {
									childSheet = { kind: 'transaction', doc_type: 'invoice' };
								}
							}
						]
					: [],
				new: canCreateTx
					? () =>
							(childSheet = {
								kind: 'transaction',
								doc_type: record.direction === 'upstream' ? 'progress_claim' : 'invoice'
							})
					: false
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

{#snippet variationsTab()}
	{#if record}
		<Table
			{ctx}
			of="contracts"
			key={`contract:vos:${record.id}`}
			where={{ parent_contract_id: { eq: record.id }, contract_type: { eq: 'variation_order' } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('commercial.tab_vo'),
				new: canCreateVo ? () => (childSheet = { kind: 'variation' }) : false
			}}
			columns={[
				'contract_number',
				'title',
				'trade_specialty',
				'status',
				'contract_value',
				'schedule_impact_days',
				'signed_date'
			]}
		/>
	{/if}
{/snippet}

{#if record}
	<RecordShell
		{ctx}
		of="contracts"
		mode={view.mode}
		id={record.id}
		subtitle={['direction', 'contract_type', 'trade_specialty', 'status']}
		tabs={[
			{
				name: 'transactions',
				title: t('commercial.tab_transactions'),
				icon: 'lucide:receipt',
				body: transactionsTab
			},
			...(record.contract_type !== 'variation_order'
				? [
						{
							name: 'variations',
							title: t('commercial.tab_vo'),
							icon: 'lucide:file-diff',
							body: variationsTab
						}
					]
				: [])
		]}
	>
		<Form {ctx} of="contracts" mode={view.mode} id={record.id} {record} size="content">
			{@render contractSections()}
		</Form>
	</RecordShell>
{:else}
	<RecordForm {ctx} {view} subtitle={['direction', 'contract_type', 'trade_specialty', 'status']}>
		{@render contractSections()}
	</RecordForm>
{/if}

<Sheet open={childSheet !== null} on_open_change={(open) => !open && (childSheet = null)}>
	{#if childSheet?.kind === 'transaction' && record}
		<RecordShell
			{ctx}
			of="commercial_documents"
			mode="create"
			values={{
				project_id: record.project_id,
				contract_id: record.id,
				...(record.contact_id != null ? { contact_id: record.contact_id } : {}),
				direction: txDirection,
				doc_type: childSheet.doc_type,
				currency: record.currency
			}}
			on_done={() => (childSheet = null)}
		/>
	{:else if childSheet?.kind === 'variation' && record}
		<RecordShell
			{ctx}
			of="contracts"
			mode="create"
			values={{
				project_id: record.project_id,
				parent_contract_id: record.id,
				...(record.contact_id != null ? { contact_id: record.contact_id } : {}),
				direction: record.direction,
				contract_type: 'variation_order',
				trade_specialty: record.trade_specialty,
				currency: record.currency
			}}
			on_done={() => (childSheet = null)}
		/>
	{/if}
</Sheet>
