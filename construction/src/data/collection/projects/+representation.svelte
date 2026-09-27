<script lang="ts">
	/**
	 * A project: its summary, then model and coordination (the IFC model beside the RFI and defect registers), manpower
	 * by work front, and commercial controls (claims by currency, documents, permits in force today). A new project is
	 * one form.
	 */
	import { bolt } from '$bolt';
	import { Field } from '@norbital-ai/ui';
	import { Show } from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Scroll, Split, Stack } from '@norbital-ai/ui/layout';
	import type { Q } from '@norbital-ai/bolt';
	import { RecordShell, Table, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view }: { view: RecordView<'projects'> } = $props();
	/** A read kept live while this view renders; `null` reads nothing. */
	function live<T>(query: () => Q<T> | null) {
		let current = $state<T | undefined>(undefined);
		$effect(() => {
			const q = query();
			if (q == null) return void (current = undefined);
			return bolt.live(q).subscribe((value) => (current = value));
		});
		return {
			get current() {
				return current;
			}
		};
	}
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
	const id = $derived(record?.id);
	const text = (value: unknown, fallback: string) =>
		value == null || value === '' ? fallback : String(value);

	const sites = live(
		() =>
			record &&
			bolt.read('site_locations', {
				where: { project_id: { eq: record.id } },
				select: { location_name: true, location_code: true, location_type: true },
				orderBy: { location_name: 'asc' },
				all: true
			})
	);
	const assignments = live(
		() =>
			record &&
			bolt.read('job_assignments', {
				where: { site_location_id: { is: { project_id: { eq: record.id } } } },
				select: {
					site_location_id: true,
					role: true,
					hours_per_day: true,
					worker_id: { select: { worker_name: true, trade: true } },
					job_id: { select: { job_title: true } }
				},
				orderBy: { updated_at: 'desc' },
				all: true
			})
	);
	const documents = live(
		() =>
			record &&
			bolt.read('asset_documents', {
				where: { project_id: { eq: record.id }, status: { in: ['draft', 'in_review', 'issued'] } },
				select: { title: true, document_type: true, document_url: true },
				orderBy: { updated_at: 'desc' },
				all: true
			})
	);
	/** Claimed and certified per currency: `{ key: { currency }, sum: { claimed_amount, certified_amount } }` rows. */
	const claims = live(
		() =>
			record &&
			bolt.aggregate('payment_claims', {
				where: { project_id: { eq: record.id } },
				by: ['currency'],
				sum: ['claimed_amount', 'certified_amount'],
				all: true
			})
	);
	const ifc = $derived(
		documents.current?.rows.find(
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
</script>

{#snippet summary()}
	{#if record}
		<Stack gap="md" class="border-b pb-5">
			<Cluster align="start" justify="between" gap="sm">
				<p class="min-w-0 text-sm text-muted-foreground">
					{text(record['project_number'], t('component.no_project_number'))} · {text(
						record['client'],
						t('component.no_client')
					)}
				</p>
				<span class="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize">
					{text(record['status'], t('component.status_not_set'))}
				</span>
			</Cluster>
			<Grid minimum="compact" class="text-sm">
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
		</Stack>
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
			<Bound size="standard" clip class="relative rounded-md border bg-muted/30">
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
			<Inline
				align="center"
				justify="center"
				class="h-64 rounded-md border border-dashed bg-muted/20 px-6 text-center text-sm text-muted-foreground"
			>
				{t('component.link_ifc_document')}
			</Inline>
		{/if}
	</Stack>
{/snippet}

{#snippet pulse()}
	<Stack gap="md" class="border-t pt-4">
		<p class="text-overline">{t('component.delivery_pulse')}</p>
		<Stack as="dl" gap="none" divided class="text-sm">
			{#each [['component.work_fronts', sites.current?.rows.length], ['component.allocated_workers', assignments.current?.rows.length], ['component.project_documents', documents.current?.rows.length]] as const as [label, count] (label)}
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
			<Grid minimum="panel">
				<Table
					of="rfis"
					toolbar={{ title: t('component.rfis') }}
					where={{ project_id: { eq: id } }}
					pageSize={25}
					columns={[
						{ field: 'rfi_number', label: t('component.rfi') },
						{ field: 'title', width: 180 },
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
						{ field: 'title', width: 180 },
						'severity',
						'status',
						{ field: 'due_date', label: t('component.due') }
					]}
				/>
			</Grid>
		</Stack>{/if}
{/snippet}

{#snippet manpower()}
	<Stack gap="lg">
		<Stack gap="xs">
			<h3 class="text-heading">{t('component.manpower_allocation')}</h3>
			<p class="max-w-[70ch] text-sm text-muted-foreground">
				{t('component.manpower_allocation_description')}
			</p>
		</Stack>
		{#if (sites.current?.rows.length ?? 0) === 0}
			<div
				class="rounded-md border border-dashed px-6 py-12 text-center text-sm text-muted-foreground"
			>
				{t('component.add_site_location')}
			</div>
		{:else}
			<Bound size="standard" clip>
				<Scroll axis="x" name={t('component.manpower_allocation')} class="pb-2">
					<Inline align="start" gap="md">
						{#each sites.current?.rows ?? [] as site (site.id)}
							{@const allocated = (assignments.current?.rows ?? []).filter(
								(a) => a['site_location_id'] === site.id
							)}
							<Stack as="section" gap="md" class="w-72 rounded-md bg-muted/50 p-3">
								<Inline align="start" justify="between" gap="sm" class="border-b pb-3">
									<Stack gap="xs" class="min-w-0">
										<h4 class="truncate text-sm font-medium">{site['location_name']}</h4>
										<p class="truncate text-meta">
											{text(
												site['location_code'] ?? site['location_type'],
												t('component.work_front')
											)}
										</p>
									</Stack>
									<span class="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums"
										>{allocated.length}</span
									>
								</Inline>
								{#each allocated as assignment (assignment.id)}
									{@const worker = assignment.worker_id}
									<Stack gap="md" class="rounded-md border bg-card p-3 shadow-xs">
										<Stack gap="xs">
											<p class="text-sm font-medium">{text(worker?.worker_name, '—')}</p>
											<p class="text-meta">{text(assignment.job_id?.job_title, '—')}</p>
										</Stack>
										<Inline justify="between" gap="sm" class="text-xs">
											<span
												>{text(
													assignment['role'] ?? worker?.['trade'],
													t('component.site_role')
												)}</span
											>
											<span class="text-muted-foreground tabular-nums"
												>{t('component.hours_per_day', {
													hours: String(assignment['hours_per_day'] ?? 0)
												})}</span
											>
										</Inline>
									</Stack>
								{:else}
									<p class="py-6 text-center text-meta">{t('component.no_allocations')}</p>
								{/each}
							</Stack>
						{/each}
					</Inline>
				</Scroll>
			</Bound>
		{/if}
	</Stack>
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
							{#each claims.current?.rows ?? [] as total, i (i)}
								{@const key = total.key}
								{#if i > 0}
									·
								{/if}<Show kind={money} value={total.sum?.[field] ?? null} row={key ?? {}} />
							{:else}{t('component.no_value')}{/each}
						</p>
					</Stack>
				{/each}
				<Stack class="border-b pb-3" gap="xs">
					<p class="text-meta">{t('component.documents')}</p>
					<p class="text-heading tabular-nums">{documents.current?.rows.length ?? 0}</p>
				</Stack>
			</Grid>
			<Grid minimum="panel">
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
					columns={['title', 'document_number', 'version', 'document_url']}
				/>
			</Grid>
			<Table
				of="permits_to_work"
				toolbar={{ title: t('component.permits_to_work') }}
				where={{ project_id: { eq: id }, validity_range: { contains: { today: '' } } }}
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

{#if record}
	<RecordShell
		of="projects"
		id={record.id}
		subtitle={[record['project_number'], record['client'], record['status']]
			.map((v) => text(v, '—'))
			.join(' · ')}
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
		{@render summary()}
	</RecordShell>
{:else}
	<RecordForm {view}>
		{#each ['project_name', 'project_number', 'client', 'main_contractor', 'status', 'schedule_range', 'currency', 'contract_value', 'project_type', 'address', 'project_manager', 'description'] as name (name)}
			<Field {name} />
		{/each}
	</RecordForm>
{/if}
