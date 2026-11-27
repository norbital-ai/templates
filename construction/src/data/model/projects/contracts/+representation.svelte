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
	import ActivityTimeline from '../../../../lib/ActivityTimeline.svelte';
	import CatalogLinesEditor from '../../../../lib/CatalogLinesEditor.svelte';
	import { decodePricedLines } from '../../../../services/commercial/lines.js';

	let { view, ctx }: { view: RecordView<'contracts'>; ctx: PageContext } = $props();
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
	const scopedParentContract = $derived.by(() => {
		const raw = liveForm?.get('parent_contract_id');
		const id =
			typeof raw === 'string'
				? raw
				: (record?.parent_contract_id ??
					(view.mode === 'create' && typeof view.values.parent_contract_id === 'string'
						? view.values.parent_contract_id
						: null));
		if (id === null) return null;
		return Option.getOrNull(Schema.decodeUnknownOption(id_of('contracts'))(id));
	});

	type ChildSheet =
		| null
		| { kind: 'transaction'; doc_type: 'delivery_order' | 'invoice' | 'progress_claim' }
		| { kind: 'variation' };
	let childSheet = $state<ChildSheet>(null);
	const canCreateTx = $derived(ctx.catalog?.commercial_documents?.create !== undefined);
	const canCreateVo = $derived(ctx.catalog?.contracts?.create !== undefined);
	const txDirection = $derived(record?.direction === 'upstream' ? 'inflow' : 'outflow');
	const activeContractType = $derived(
		String(liveForm?.get('contract_type') ?? record?.contract_type ?? 'subcontract')
	);
	const isVariation = $derived(activeContractType === 'variation_order');
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

{#snippet catalogLinesEditor(field: FieldEditor)}
	<CatalogLinesEditor
		{ctx}
		value={decodePricedLines(field.value)}
		disabled={field.disabled}
		projectId={scopedProject}
		parentContractId={scopedParentContract}
		onChange={(next) => field.on_change(next ? [...next] : null)}
	/>
{/snippet}

{#snippet contractSections()}
	<Section icon="lucide:file-signature" first name="contract" title={t('section.contract')}>
		<Grid minimum="compact">
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="direction" />
			<Field {ctx} name="contract_type" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="contact_id" />
			{#if isVariation || record?.parent_contract_id != null}
				<Field {ctx} name="parent_contract_id" editor={parentContractEditor} />
			{/if}
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="contract_period" />
			<Field {ctx} name="signed_date" />
			{#if isVariation || (record?.schedule_impact_days ?? 0) !== 0}
				<Field {ctx} name="schedule_impact_days" />
			{/if}
		</Grid>
	</Section>

	<Section icon="lucide:calculator" name="commercial_terms" title={t('section.commercial_terms')}>
		<Grid minimum="compact">
			<Field {ctx} name="currency" />
			<Field {ctx} name="contract_value" />
			<Field {ctx} name="tax_rate" />
			<Field {ctx} name="retention_rate" />
			<Field {ctx} name="retention_cap_rate" />
			<Field {ctx} name="payment_terms_days" />
			<Field {ctx} name="dlp_months" />
			<Field {ctx} name="bond_amount" />
			<Field {ctx} name="insurance_expiry" />
			<Column span="all"><Field {ctx} name="lines" editor={catalogLinesEditor} /></Column>
		</Grid>
	</Section>

	<Section
		icon="lucide:file-text"
		name="scope"
		title={t('section.scope_and_docs')}
		default_open={false}
	>
		<Grid minimum="compact">
			{#if record?.source_message_id != null}
				<Field {ctx} name="source_message_id" readonly />
			{/if}
			<Column span="all"><Field {ctx} name="scope_notes" /></Column>
			{#if record?.bim_pin != null}
				<Column span="all"><Field {ctx} name="bim_pin" readonly /></Column>
			{/if}
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
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
							},
							...(record.direction === 'upstream'
								? [
										{
											icon: 'lucide:file-plus-2',
											name: t('commercial.draft_claim'),
											description: t('commercial.draft_claim_desc'),
											run: () =>
												ctx.run('generate_payment_claim', { project_id: record.project_id })
										}
									]
								: [])
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

{#snippet activityTab()}
	{#if record}
		<ActivityTimeline {ctx} about={{ model: 'contracts', id: record.id }} />
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
				: []),
			{
				name: 'activity',
				title: t('tasks.tab_activity'),
				icon: 'lucide:activity',
				body: activityTab
			}
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
