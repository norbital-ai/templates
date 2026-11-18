<script lang="ts">
	/**
	 * A job. Its Record is the scope of work and decisions extracted from its activities (images and voice notes
	 * included) and documents: each item says whether it was extracted or edited and which activities it came from;
	 * editing makes it manual, which re-extraction keeps. The Documents tab renders the job's catalogue documents (the SOW)
	 * from those values; Activities is where meetings are recorded.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import * as Predicate from 'effect/Predicate';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import {
		Button,
		EmptyState,
		Field,
		Form,
		ReadonlyMarkdown,
		RecordShell,
		RunStatus,
		Section,
		Sheet,
		Table,
		use_act
	} from '@norbital-ai/ui';
	import { Grid, Scroll } from '@norbital-ai/ui/layout';
	import ActivityTimeline from '../../../../lib/ActivityTimeline.svelte';
	import DocumentTab from '../../../../lib/DocumentTab.svelte';
	let { view, ctx }: { view: RecordView<'projects'>; ctx: PageContext } = $props();
	const t = ctx.t;
	let creating = $state(false);
	const sowFields = [
		'overview',
		'definitions',
		'implementation_scope',
		'data_migration',
		'milestones',
		'uat_tests',
		'fees',
		'decisions'
	] as const;
	/** The job's own facts; its customer is picked on create only (the update refuses moving a job). */
	const jobFields = ['name', 'lead_contact_id', 'signatory', 'status', 'target_on'] as const;
	const createFields = ['company_id', ...jobFields] as const;
	const fields = [...jobFields, 'capture_rules', ...sowFields] as const;
	const jobSection: RecordSection = {
		name: 'job',
		icon: 'lucide:briefcase',
		title: t('models.projects.singular'),
		fields: [...jobFields]
	};
	const captureSection: RecordSection = {
		name: 'capture',
		icon: 'lucide:scan-line',
		title: t('jobs.capture'),
		fields: ['capture_rules'],
		default_open: false
	};
	const sections: RecordSection[] = [
		jobSection,
		{
			name: 'sow',
			icon: 'lucide:file-text',
			title: t('jobs.sow_content'),
			hint: t('jobs.generate_help'),
			fields: [...sowFields]
		},
		captureSection
	];
	let run = $state<string | null>(null);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	// Citations name the job's activities and documents by subject and title.
	const cited = $derived(
		record
			? ctx.query({
					activities: { where: { project_id: { eq: record.id } }, fields: ['subject'] }
				})
			: null
	);
	const files = $derived(
		record
			? ctx.query({
					project_documents: { where: { project_id: { eq: record.id } }, fields: ['title'] }
				})
			: null
	);
	const names = $derived(
		new Map<string, string>([
			...(cited?.current?.activities.rows ?? []).map((r): [string, string] => [r.id, r.subject]),
			...(files?.current?.project_documents.rows ?? []).map((r): [string, string] => [
				r.id,
				r.title
			])
		])
	);
	type Cited = { origin?: 'generated' | 'manual' | null; sources?: readonly string[] | null };
	const join = (values: readonly string[] | null | undefined) => (values ?? []).join(' · ');
	/** Each scope-of-work list as its table: the columns a reader scans, in reading order, and each item's cells. */
	const sowLists = $derived(
		record === null
			? []
			: [
					{
						field: 'definitions' as const,
						columns: ['term', 'meaning'] as const,
						rows: (record.definitions ?? []).map((i) => ({ item: i, cells: [i.term, i.meaning] }))
					},
					{
						field: 'implementation_scope' as const,
						columns: ['feature', 'included', 'dependencies'] as const,
						rows: (record.implementation_scope ?? []).map((i) => ({
							item: i,
							cells: [i.feature, join(i.included), join(i.dependencies)]
						}))
					},
					{
						field: 'data_migration' as const,
						columns: ['data', 'included', 'format'] as const,
						rows: (record.data_migration ?? []).map((i) => ({
							item: i,
							cells: [i.data, join(i.included), i.format]
						}))
					},
					{
						field: 'milestones' as const,
						columns: ['timeline', 'milestone', 'due_on', 'client_review'] as const,
						rows: (record.milestones ?? []).map((i) => ({
							item: i,
							cells: [i.timeline, i.milestone, i.due_on ?? '', i.client_review ?? '']
						}))
					},
					{
						field: 'uat_tests' as const,
						columns: ['ref', 'name', 'objective', 'expected_result'] as const,
						rows: (record.uat_tests ?? []).map((i) => ({
							item: i,
							cells: [i.ref, i.name, i.objective, i.expected_result]
						}))
					},
					{
						field: 'fees' as const,
						columns: ['item', 'includes', 'fee'] as const,
						rows: (record.fees ?? []).map((i) => ({ item: i, cells: [i.item, i.includes, i.fee] }))
					},
					{
						field: 'decisions' as const,
						columns: ['decision', 'decided_on'] as const,
						rows: (record.decisions ?? []).map((i) => ({
							item: i,
							cells: [i.decision, i.decided_on ?? '']
						}))
					}
				]
	);
	const cites = (item: Cited) =>
		(item.sources ?? []).map((source) => names.get(source)).filter((name) => name !== undefined);
	const act = use_act(ctx);
	const extract = () => {
		if (record === null) return;
		const handle = ctx.run('update_requirements', { project: record.id });
		run = handle.id;
		act.run(handle);
	};
</script>

{#snippet header()}
	<Button variant="outline" onclick={extract}>{t('jobs.generate')}</Button>
	{#if run}<RunStatus {ctx} automation="update_requirements" {run} />{/if}
{/snippet}
{#snippet origin(manual: boolean)}
	<span class="text-meta">{t(manual ? 'jobs.origin.manual' : 'jobs.origin.generated')}</span>
{/snippet}
{#snippet sowTable({ name }: { name: string })}
	{@const list = sowLists.find((one) => one.field === name)}
	{#if list === undefined || list.rows.length === 0}
		<p class="text-meta">—</p>
	{:else}
		<Scroll name="sow-{name}" axis="x" class="rounded-md border">
			<table class="w-full text-sm">
				<thead class="bg-muted/50 text-left text-muted-foreground">
					<tr>
						{#each list.columns as column (column)}
							<th class="px-3 py-2 font-medium">{t(`jobs.column.${column}`)}</th>
						{/each}
						<th class="px-3 py-2 font-medium">{t('jobs.sources')}</th>
					</tr>
				</thead>
				<tbody>
					{#each list.rows as row, i (i)}
						<tr class="border-t align-top">
							{#each row.cells as cell, c (c)}
								<td class="px-3 py-2" class:font-medium={c === 0}>{cell || '—'}</td>
							{/each}
							<td class="px-3 py-2">
								{@render origin(row.item.origin === 'manual')}
								{#if cites(row.item).length > 0}<p class="text-meta">
										{cites(row.item).join('; ')}
									</p>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	{/if}
{/snippet}
{#snippet overviewView({ value }: { value: unknown })}
	{#if Predicate.isString(value) && value !== ''}
		{@render origin(record?.manual_fields?.includes('overview') ?? false)}
		<ReadonlyMarkdown {value} />
	{:else}<p class="text-meta">—</p>{/if}
{/snippet}
{#snippet body(shown: RecordView)}
	{#if record !== null}
		<!-- one form either way: read, every scope-of-work list is its table; editing, the same lists edit as tables -->
		<Form
			{ctx}
			of="projects"
			mode="update"
			id={record.id}
			{record}
			{fields}
			readonly={shown.mode !== 'edit'}
		>
			{#snippet children()}
				<Section icon="lucide:briefcase" first name="job" title={t('models.projects.singular')}>
					<Grid minimum="card">
						{#each jobFields as name (name)}<Field {ctx} {name} />{/each}
					</Grid>
				</Section>
				<Section
					icon="lucide:file-text"
					name="sow"
					title={t('jobs.sow_content')}
					hint={t('jobs.generate_help')}
				>
					{#if record.generation_error}
						<p role="alert" class="text-sm text-destructive">{record.generation_error}</p>
					{/if}
					{#if shown.mode !== 'edit' && !record.overview && sowLists.every((list) => list.rows.length === 0)}
						<EmptyState variant="inset" title={t('jobs.outputs_empty')} />
					{:else}
						<Field {ctx} name="overview" view={overviewView} />
						{#each sowLists as list (list.field)}
							<Field {ctx} name={list.field} view={sowTable} />
						{/each}
					{/if}
				</Section>
				<Section
					icon="lucide:scan-line"
					name="capture"
					title={t('jobs.capture')}
					default_open={false}
				>
					<Field {ctx} name="capture_rules" />
				</Section>
			{/snippet}
		</Form>
	{/if}
{/snippet}
{#snippet activities()}
	{#if record?.company_id}{#key record.id}<ActivityTimeline
				{ctx}
				company={record.company_id}
				project={record.id}
			/>{/key}{/if}
{/snippet}
{#snippet job_documents()}
	{#if record?.company_id}{#key record.id}<DocumentTab
				{ctx}
				company={record.company_id}
				project={record.id}
			/>{/key}{/if}
{/snippet}
{#snippet documents()}
	{#if record}<Table
			{ctx}
			of="project_documents"
			key="job-documents"
			toolbar={{ new: () => (creating = true) }}
			where={{ project_id: { eq: record.id } }}
			columns={['title', 'kind', 'received_on']}
		/>{/if}
{/snippet}
{#if record === null}
	<RecordShell
		{ctx}
		of="projects"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		fields={[...createFields, 'capture_rules']}
		sections={[{ ...jobSection, fields: [...createFields] }, captureSection]}
	/>
{:else}
	<RecordShell
		{ctx}
		of="projects"
		id={record.id}
		subtitle={['company_id']}
		{fields}
		{sections}
		actions={header}
		tabs={[
			{
				name: 'activities',
				title: t('crm.section.activities'),
				icon: 'lucide:activity',
				body: activities
			},
			{
				name: 'job_documents',
				title: t('customer.documents'),
				icon: 'lucide:file-signature',
				body: job_documents
			},
			{
				name: 'documents',
				title: t('crm.section.documents'),
				icon: 'lucide:file-text',
				body: documents
			}
		]}
		children={body}
	/>
{/if}

<Sheet
	open={creating}
	on_open_change={(open) => {
		if (!open) creating = false;
	}}
	title={t('crm.section.documents')}
>
	{#if record?.company_id && creating}
		<RecordShell
			{ctx}
			of="project_documents"
			mode="create"
			values={{ company: record.company_id, project_id: record.id }}
			fields={['title', 'kind', 'project_id', 'attachment', 'markdown_body', 'received_on']}
			on_done={() => (creating = false)}
		/>
	{/if}
</Sheet>
