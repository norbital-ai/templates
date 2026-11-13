<script lang="ts">
	/**
	 * A project: its summary, then model and coordination (the IFC model, then the RFI and defect registers), the allocation register, and commercial controls (claims by currency, documents, permits in force today). A new project is
	 * one form.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Field,
		Form,
		Section,
		Show,
		EmptyState,
		RecordShell,
		Table,
		type RecordView
	} from '@norbital-ai/ui';
	import { Bound, Column, Grid, Inline, Scroll, Split, Stack } from '@norbital-ai/ui/layout';
	import { input_schema } from '@norbital-ai/bolt';
	import { Schema } from 'effect';
	import RecordForm from '../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'projects'>; ctx: PageContext } = $props();
	/** Permits in force today: re-answers at midnight. */
	const day = ctx.clock('day');
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
	const text = (value: string | null, fallback: string) => value || fallback;
	const sites = $derived(
		record &&
			ctx.query({
				site_locations: { where: { project_id: { eq: record.id } }, aggregate: { count: true } }
			})
	);
	const assignments = $derived(
		record &&
			ctx.query({
				job_assignments: {
					where: { site_location_id: { is: { project_id: { eq: record.id } } } },
					aggregate: { count: true }
				}
			})
	);
	const documents = $derived(
		record &&
			ctx.query({
				asset_documents: {
					where: {
						project_id: { eq: record.id },
						status: { in: ['draft', 'in_review', 'issued'] }
					},
					fields: ['title', 'document_type', 'document_file'],
					order_by: { updated_at: 'desc' }
				}
			})
	);
	/** Claimed and certified per currency: `{ key: { currency }, sum: { claimed_amount, certified_amount } }` rows. */
	const claims = $derived(
		record &&
			ctx.aggregate('payment_claims', {
				where: { project_id: { eq: record.id } },
				by: ['currency'],
				sum: ['claimed_amount', 'certified_amount'],
				all: true
			})
	);
	const ifc = $derived(
		documents?.current?.asset_documents.rows.find(
			(d) =>
				d.document_file != null &&
				(d.document_type === 'ifc_model' || d.document_file.name.toLowerCase().endsWith('.ifc'))
		)
	);
	/** The viewer is a heavy WebGL module graph: loaded only when a model is linked. */
	const viewer = $derived(ifc ? import('../../../lib/ifc-viewer/ifc_viewer.svelte') : null);
	const money = { kind: 'money', currency: 'currency' } as const;
	/** The address on one line, for its folded section. */
	const addressLine = $derived(
		[
			record?.address?.line_1,
			record?.address?.line_2,
			record?.address?.city,
			record?.address?.state,
			record?.address?.postal_code,
			record?.address?.country
		]
			.filter(Boolean)
			.join(', ')
	);
	const claimCurrency = Schema.decodeUnknownSync(
		input_schema({ kind: 'currency', optional: true })
	);
</script>

{#snippet summary()}
	{#if record}
		<Grid minimum="compact" class="border-b pb-5 text-sm">
			<Stack gap="xs">
				<p class="text-meta">{ctx.t('component.programme')}</p>
				<p class="font-medium">
					{#if record['schedule_range']}<Show
							{ctx}
							kind={{ kind: 'period', of: 'date' }}
							value={record['schedule_range']}
						/>{:else}{ctx.t('component.not_set')}{/if}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{ctx.t('component.contract_value')}</p>
				<p class="font-medium">
					{#if record['contract_value'] != null}<Show
							{ctx}
							kind={money}
							value={record['contract_value']}
							row={record}
						/>{:else}{ctx.t('component.not_set')}{/if}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{ctx.t('component.main_contractor')}</p>
				<p class="font-medium">{text(record['main_contractor'], ctx.t('component.not_set'))}</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{ctx.t('component.project_manager')}</p>
				<p class="font-medium">{text(record['project_manager'], ctx.t('component.not_set'))}</p>
			</Stack>
		</Grid>
	{/if}
{/snippet}

{#snippet model()}
	<Stack gap="sm">
		<div>
			<h3 class="text-heading">{ctx.t('component.coordination_model')}</h3>
			<p class="max-w-[70ch] text-sm text-muted-foreground">
				{ctx.t('component.coordination_model_description')}
			</p>
		</div>
		{#if ifc && viewer}
			<Bound size="viewport" clip class="relative rounded-md border bg-muted/30">
				{#await viewer}
					<Inline align="center" justify="center" size="fill" class="text-sm text-muted-foreground">
						{ctx.t('component.loading_viewer')}
					</Inline>
				{:then mod}
					<mod.default
						t={ctx.t}
						src={ifc.document_file ? ctx.file_url(ifc.document_file) : ''}
						alt={text(ifc['title'], ctx.t('component.current_ifc_model'))}
					/>
				{:catch error}
					<Inline align="center" justify="center" size="fill" class="text-sm text-destructive">
						{String(error)}
					</Inline>
				{/await}
			</Bound>
		{:else}
			<EmptyState
				variant="card"
				icon="file"
				title={ctx.t('component.no_ifc_model')}
				hint={ctx.t('component.link_ifc_document')}
			/>
		{/if}
	</Stack>
{/snippet}

{#snippet pulse()}
	<Stack gap="md" class="border-t pt-4">
		<p class="text-overline">{ctx.t('component.delivery_pulse')}</p>
		<Stack as="dl" gap="none" divided class="text-sm">
			{#each [['component.work_fronts', sites?.current?.site_locations.count], ['component.allocated_workers', assignments?.current?.job_assignments.count], ['component.project_documents', documents?.current?.asset_documents.rows.length]] as const as [label, count] (label)}
				<Inline as="div" justify="between" class="py-2">
					<dt>{ctx.t(label)}</dt>
					<dd class="font-medium tabular-nums">{count ?? 0}</dd>
				</Inline>
			{/each}
		</Stack>
		{#if record?.['description']}
			<p class="text-overline">{ctx.t('component.scope')}</p>
			<p class="text-sm leading-normal">{record['description']}</p>
		{/if}
	</Stack>
{/snippet}

{#snippet coordination()}
	{#if id}<Scroll name="coordination" size="fill" inset
			><Stack gap="lg">
				<Split ratio="wide" collapse="stack" start={model} end={pulse} />
				<Bound size="viewport"
					><Table
						{ctx}
						of="rfis"
						toolbar={{ title: ctx.t('component.rfis') }}
						where={{ project_id: { eq: id } }}
						page_size={25}
						columns={[
							{ field: 'rfi_number', label: ctx.t('component.rfi') },
							'title',
							'priority',
							'status',
							{ field: 'due_date', label: ctx.t('component.due') }
						]}
					/></Bound
				>
				<Bound size="viewport"
					><Table
						{ctx}
						of="defects"
						toolbar={{ title: ctx.t('component.defects') }}
						where={{ project_id: { eq: id } }}
						page_size={25}
						columns={[
							{ field: 'defect_number', label: ctx.t('component.defect') },
							'title',
							'severity',
							'status',
							{ field: 'due_date', label: ctx.t('component.due') }
						]}
					/></Bound
				>
			</Stack></Scroll
		>{/if}
{/snippet}

{#snippet manpower()}
	{#if id}
		<Table
			{ctx}
			of="job_assignments"
			key={`construction_project:manpower:${id}`}
			toolbar={{ title: ctx.t('component.manpower_allocation') }}
			where={{ site_location_id: { is: { project_id: { eq: id } } } }}
			columns={[
				'worker_id',
				'site_location_id',
				'job_id',
				'role',
				'status',
				'hours_per_day',
				'assignment_range'
			]}
		/>
	{/if}
{/snippet}

{#snippet controls()}
	{#if id}<Scroll name="controls" size="fill" inset
			><Stack gap="lg">
				<Grid minimum="compact">
					<Stack class="border-b pb-3" gap="xs">
						<p class="text-meta">{ctx.t('component.contract_value')}</p>
						<p class="text-heading">
							{#if record?.['contract_value'] != null}<Show
									{ctx}
									kind={money}
									value={record['contract_value']}
									row={record}
								/>{:else}{ctx.t('component.not_set')}{/if}
						</p>
					</Stack>
					{#each [['component.claimed', 'claimed_amount'], ['component.certified', 'certified_amount']] as const as [label, field] (field)}
						<Stack class="border-b pb-3" gap="xs">
							<p class="text-meta">{ctx.t(label)}</p>
							<p class="text-heading">
								{#each claims?.current?.rows ?? [] as total, i (i)}
									{@const key = total.key}
									{#if i > 0}
										·
									{/if}<Show
										{ctx}
										kind={money}
										value={total.sum?.[field] ?? null}
										row={{ currency: claimCurrency(key?.['currency'] ?? null) }}
									/>
								{:else}{ctx.t('component.no_value')}{/each}
							</p>
						</Stack>
					{/each}
					<Stack class="border-b pb-3" gap="xs">
						<p class="text-meta">{ctx.t('component.documents')}</p>
						<p class="text-heading tabular-nums">
							{documents?.current?.asset_documents.rows.length ?? 0}
						</p>
					</Stack>
				</Grid>
				<Bound size="viewport"
					><Table
						{ctx}
						of="payment_claims"
						toolbar={{ title: ctx.t('component.payment_claims') }}
						where={{ project_id: { eq: id } }}
						order_by={{ updated_at: 'desc' }}
						columns={['claim_number', 'claim_type', 'status', 'claimed_amount']}
					/></Bound
				>
				<Bound size="viewport"
					><Table
						{ctx}
						of="asset_documents"
						toolbar={{ title: ctx.t('component.project_documents') }}
						where={{ project_id: { eq: id }, status: { in: ['draft', 'in_review', 'issued'] } }}
						order_by={{ updated_at: 'desc' }}
						columns={['title', 'document_number', 'version']}
					/></Bound
				>
				<Bound size="viewport"
					><Table
						{ctx}
						of="permits_to_work"
						toolbar={{ title: ctx.t('component.permits_to_work') }}
						where={{ project_id: { eq: id }, validity_range: { contains: day.today } }}
						page_size={50}
						columns={[
							{ field: 'permit_number', label: ctx.t('component.permit') },
							{ field: 'permit_type', label: ctx.t('component.type') },
							'status',
							{ field: 'validity_range', label: ctx.t('component.valid') },
							{ field: 'approved_by', label: ctx.t('component.approved_by') }
						]}
					/></Bound
				>
			</Stack></Scroll
		>{/if}
{/snippet}

{#snippet projectFields()}
	<Section icon="lucide:folder-kanban" first name="project" title={ctx.t('section.project')}>
		<Grid minimum="compact">
			{#each ['project_name', 'project_number', 'client', 'main_contractor', 'status', 'project_type', 'project_manager'] as name (name)}
				<Field {ctx} {name} />
			{/each}
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:calendar-days"
		name="schedule_and_value"
		title={ctx.t('section.schedule_and_value')}
	>
		<Grid minimum="compact">
			<Field {ctx} name="schedule_range" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="contract_value" />
		</Grid>
	</Section>
	<Section
		icon="lucide:map-pin"
		name="address"
		title={ctx.t('section.address')}
		default_open={false}
		summary={addressLine || ctx.t('component.not_set')}
	>
		<Field {ctx} name="address" />
	</Section>
{/snippet}

{#if record}
	<RecordShell
		{ctx}
		of="projects"
		id={record.id}
		subtitle={['project_number', 'client', 'status']}
		tabs={[
			{
				name: 'coordination',
				title: ctx.t('component.model_and_coordination'),
				icon: 'lucide:box',
				body: coordination
			},
			{
				name: 'manpower',
				title: ctx.t('component.manpower_allocation'),
				icon: 'lucide:users',
				body: manpower
			},
			{
				name: 'controls',
				title: ctx.t('component.commercial_and_controls'),
				icon: 'lucide:clipboard-check',
				body: controls
			}
		]}
	>
		{#snippet children(shown)}
			{#if shown.mode === 'view'}
				{@render summary()}
			{:else}
				<Form {ctx} of="projects" mode="update" id={record.id} {record}>
					{@render projectFields()}
				</Form>
			{/if}
		{/snippet}
	</RecordShell>
{:else}
	<RecordForm {ctx} {view}>
		{@render projectFields()}
	</RecordForm>
{/if}
