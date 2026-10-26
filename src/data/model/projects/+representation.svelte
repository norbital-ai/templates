<script lang="ts">
	/**
	 * A project: its summary, then model and coordination (the IFC model, then the RFI and defect registers), the allocation register, and commercial controls (claims by currency, documents, permits in force today). A new project is
	 * one form.
	 */
	import { bolt } from '$bolt';
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
	import { Bound, Column, Grid, Inline, Split, Stack } from '@norbital-ai/ui/layout';
	import { inputSchema } from '@norbital-ai/std/kind';
	import { Schema } from 'effect';
	import RecordForm from '../../../lib/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'projects'>;
	} = $props();
	const t = bolt.t;
	/** Permits in force today: re-answers at midnight. */
	const day = bolt.clock('day');
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
	const text = (value: string | null, fallback: string) => value || fallback;
	const sites = $derived(
		record &&
			bolt.query('site_locations', {
				where: { project_id: { eq: record.id } },
				select: { location_name: true, location_code: true, location_type: true },
				orderBy: { location_name: 'asc' },
				all: true
			})
	);
	const assignments = $derived(
		record &&
			bolt.query('job_assignments', {
				where: { site_location_id: { is: { project_id: { eq: record.id } } } },
				select: { id: true },
				orderBy: { updated_at: 'desc' },
				all: true
			})
	);
	const documents = $derived(
		record &&
			bolt.query('asset_documents', {
				where: { project_id: { eq: record.id }, status: { in: ['draft', 'in_review', 'issued'] } },
				select: { title: true, document_type: true, document_url: true },
				orderBy: { updated_at: 'desc' },
				all: true
			})
	);
	/** Claimed and certified per currency: `{ key: { currency }, sum: { claimed_amount, certified_amount } }` rows. */
	const claims = $derived(
		record &&
			bolt.aggregate('payment_claims', {
				where: { project_id: { eq: record.id } },
				by: ['currency'],
				sum: ['claimed_amount', 'certified_amount'],
				all: true
			})
	);
	const ifc = $derived(
		documents?.current?.rows.find(
			(d) =>
				d.document_type === 'ifc_model' ||
				String(d.document_url ?? '')
					.toLowerCase()
					.endsWith('.ifc')
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
	const claimCurrency = Schema.decodeUnknownSync(inputSchema({ kind: 'currency', optional: true }));
</script>

{#snippet summary()}
	{#if record}
		<Grid minimum="compact" class="border-b pb-5 text-sm">
			<Stack gap="xs">
				<p class="text-meta">{t('component.programme')}</p>
				<p class="font-medium">
					{#if record['schedule_range']}<Show
							kind={{ kind: 'period', of: 'date' }}
							value={record['schedule_range']}
						/>{:else}{t('component.not_set')}{/if}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('component.contract_value')}</p>
				<p class="font-medium">
					{#if record['contract_value'] != null}<Show
							kind={money}
							value={record['contract_value']}
							row={record}
						/>{:else}{t('component.not_set')}{/if}
				</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('component.main_contractor')}</p>
				<p class="font-medium">{text(record['main_contractor'], t('component.not_set'))}</p>
			</Stack>
			<Stack gap="xs">
				<p class="text-meta">{t('component.project_manager')}</p>
				<p class="font-medium">{text(record['project_manager'], t('component.not_set'))}</p>
			</Stack>
		</Grid>
	{/if}
{/snippet}

{#snippet model()}
	<Stack gap="sm">
		<div>
			<h3 class="text-heading">{t('component.coordination_model')}</h3>
			<p class="max-w-[70ch] text-sm text-muted-foreground">
				{t('component.coordination_model_description')}
			</p>
		</div>
		{#if ifc && viewer}
			<Bound size="fit" clip class="relative rounded-md border bg-muted/30">
				{#await viewer}
					<Inline align="center" justify="center" fill class="text-sm text-muted-foreground">
						{t('component.loading_viewer')}
					</Inline>
				{:then mod}
					<mod.default
						src={String(ifc['document_url'] ?? '')}
						alt={text(ifc['title'], t('component.current_ifc_model'))}
					/>
				{:catch error}
					<Inline align="center" justify="center" fill class="text-sm text-destructive">
						{String(error)}
					</Inline>
				{/await}
			</Bound>
		{:else}
			<EmptyState
				variant="card"
				icon="file"
				title={t('component.no_ifc_model')}
				hint={t('component.link_ifc_document')}
			/>
		{/if}
	</Stack>
{/snippet}

{#snippet pulse()}
	<Stack gap="md" class="border-t pt-4">
		<p class="text-overline">{t('component.delivery_pulse')}</p>
		<Stack as="dl" gap="none" divided class="text-sm">
			{#each [['component.work_fronts', sites?.current?.rows.length], ['component.allocated_workers', assignments?.current?.rows.length], ['component.project_documents', documents?.current?.rows.length]] as const as [label, count] (label)}
				<Inline as="div" justify="between" class="py-2">
					<dt>{t(label)}</dt>
					<dd class="font-medium tabular-nums">{count ?? 0}</dd>
				</Inline>
			{/each}
		</Stack>
		{#if record?.['description']}
			<p class="text-overline">{t('component.scope')}</p>
			<p class="text-sm leading-normal">{record['description']}</p>
		{/if}
	</Stack>
{/snippet}

{#snippet coordination()}
	{#if id}<Stack gap="lg">
			<Split ratio="wide" collapse="stack" start={model} end={pulse} />
			<Stack gap="lg">
				<Table
					of="rfis"
					toolbar={{ title: t('component.rfis') }}
					where={{ project_id: { eq: id } }}
					pageSize={25}
					columns={[
						{ field: 'rfi_number', label: t('component.rfi') },
						'title',
						'priority',
						'status',
						{ field: 'due_date', label: t('component.due') }
					]}
				/>
				<Table
					of="defects"
					toolbar={{ title: t('component.defects') }}
					where={{ project_id: { eq: id } }}
					pageSize={25}
					columns={[
						{ field: 'defect_number', label: t('component.defect') },
						'title',
						'severity',
						'status',
						{ field: 'due_date', label: t('component.due') }
					]}
				/>
			</Stack>
		</Stack>{/if}
{/snippet}

{#snippet manpower()}
	{#if id}
		<Table
			of="job_assignments"
			key={`construction_project:manpower:${id}`}
			toolbar={{ title: t('component.manpower_allocation') }}
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

{#snippet documentLink({ value }: { value: string | null | undefined })}
	{#if value}<a
			href={value}
			target="_blank"
			rel="noopener noreferrer"
			class="text-primary underline-offset-4 hover:underline">{t('component.open_document')}</a
		>{/if}
{/snippet}

{#snippet controls()}
	{#if id}<Stack gap="lg">
			<Grid minimum="compact">
				<Stack class="border-b pb-3" gap="xs">
					<p class="text-meta">{t('component.contract_value')}</p>
					<p class="text-heading">
						{#if record?.['contract_value'] != null}<Show
								kind={money}
								value={record['contract_value']}
								row={record}
							/>{:else}{t('component.not_set')}{/if}
					</p>
				</Stack>
				{#each [['component.claimed', 'claimed_amount'], ['component.certified', 'certified_amount']] as const as [label, field] (field)}
					<Stack class="border-b pb-3" gap="xs">
						<p class="text-meta">{t(label)}</p>
						<p class="text-heading">
							{#each claims?.current?.rows ?? [] as total, i (i)}
								{@const key = total.key}
								{#if i > 0}
									·
								{/if}<Show
									kind={money}
									value={total.sum?.[field] ?? null}
									row={{ currency: claimCurrency(key?.['currency'] ?? null) }}
								/>
							{:else}{t('component.no_value')}{/each}
						</p>
					</Stack>
				{/each}
				<Stack class="border-b pb-3" gap="xs">
					<p class="text-meta">{t('component.documents')}</p>
					<p class="text-heading tabular-nums">{documents?.current?.rows.length ?? 0}</p>
				</Stack>
			</Grid>
			<Stack gap="lg">
				<Table
					of="payment_claims"
					toolbar={{ title: t('component.payment_claims') }}
					where={{ project_id: { eq: id } }}
					orderBy={{ updated_at: 'desc' }}
					columns={['claim_number', 'claim_type', 'status', 'claimed_amount']}
				/>
				<Table
					of="asset_documents"
					toolbar={{ title: t('component.project_documents') }}
					where={{ project_id: { eq: id }, status: { in: ['draft', 'in_review', 'issued'] } }}
					orderBy={{ updated_at: 'desc' }}
					columns={[
						'title',
						'document_number',
						'version',
						{ field: 'document_url', cell: documentLink }
					]}
				/>
			</Stack>
			<Table
				of="permits_to_work"
				toolbar={{ title: t('component.permits_to_work') }}
				where={{ project_id: { eq: id }, validity_range: { contains: day.today } }}
				pageSize={50}
				columns={[
					{ field: 'permit_number', label: t('component.permit') },
					{ field: 'permit_type', label: t('component.type') },
					'status',
					{ field: 'validity_range', label: t('component.valid') },
					{ field: 'approved_by', label: t('component.approved_by') }
				]}
			/>
		</Stack>{/if}
{/snippet}

{#snippet projectFields()}
	<Section first name="project" title={t('section.project')}>
		<Grid minimum="compact">
			{#each ['project_name', 'project_number', 'client', 'main_contractor', 'status', 'project_type', 'project_manager'] as name (name)}
				<Field {name} />
			{/each}
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	</Section>
	<Section name="schedule_and_value" title={t('section.schedule_and_value')}>
		<Grid minimum="compact">
			<Field name="schedule_range" />
			<Field name="currency" />
			<Field name="contract_value" />
		</Grid>
	</Section>
	<Section
		name="address"
		title={t('section.address')}
		defaultOpen={false}
		summary={addressLine || t('component.not_set')}
	>
		<Field name="address" />
	</Section>
{/snippet}

{#if record}
	<RecordShell
		of="projects"
		id={record.id}
		subtitle={['project_number', 'client', 'status']}
		tabs={[
			{
				name: 'coordination',
				title: t('component.model_and_coordination'),
				icon: 'lucide:box',
				body: coordination
			},
			{
				name: 'manpower',
				title: t('component.manpower_allocation'),
				icon: 'lucide:users',
				body: manpower
			},
			{
				name: 'controls',
				title: t('component.commercial_and_controls'),
				icon: 'lucide:clipboard-check',
				body: controls
			}
		]}
	>
		{#snippet children(shown)}
			{#if shown.mode === 'view'}
				{@render summary()}
			{:else}
				<Form of="projects" mode="update" id={record.id} {record}>
					{@render projectFields()}
				</Form>
			{/if}
		{/snippet}
	</RecordShell>
{:else}
	<RecordForm {view}>
		{@render projectFields()}
	</RecordForm>
{/if}
