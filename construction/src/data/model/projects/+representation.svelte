<script lang="ts">
	/**
	 * Project Hub shell: Record form + tabs composed from focused co-located tab components
	 * (`ProjectProgrammeTab`, `ProjectBimTab`, `ProjectFinanceTab`, `ProjectSustainabilityTab`).
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Field,
		Form,
		RecordForm,
		RecordShell,
		Section,
		Sheet,
		Table,
		type RecordView
	} from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import type { IFCViewerFocus } from '../../../services/viewer/types.js';
	import ProjectBimTab from './ProjectBimTab.svelte';
	import ProjectFinanceTab from './ProjectFinanceTab.svelte';
	import ProjectProgrammeTab from './ProjectProgrammeTab.svelte';
	import ProjectSustainabilityTab from './ProjectSustainabilityTab.svelte';

	let { view, ctx }: { view: RecordView<'projects'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const day = ctx.clock('day');
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);

	type CreateSheet =
		| null
		| { kind: 'file' }
		| { kind: 'task'; values: Record<string, unknown> }
		| {
				kind: 'contract';
				direction: 'upstream' | 'downstream';
				contract_type: 'main_contract' | 'subcontract';
		  }
		| { kind: 'adhoc_cost' };

	let createSheet = $state<CreateSheet>(null);
	let focus = $state<(IFCViewerFocus & { readonly task?: string }) | null>(null);

	const siteSummary = $derived(
		[
			record?.address,
			record?.zones?.length ? t('zones.count_summary', { count: record.zones.length }) : ''
		]
			.filter(Boolean)
			.join(' · ') || undefined
	);
</script>

{#snippet projectSections()}
	<Section icon="lucide:building-2" first name="project" title={t('section.project')}>
		<Grid minimum="compact">
			<Field {ctx} name="project_name" />
			<Field {ctx} name="project_number" />
			<Field {ctx} name="project_role" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="client_id" />
			<Field {ctx} name="project_manager" />
			<Field {ctx} name="schedule_range" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="autodesk_project_id" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:map-pin"
		name="site"
		title={t('section.site')}
		default_open={false}
		{...siteSummary ? { summary: siteSummary } : {}}
	>
		<Grid minimum="compact">
			<Column span="all"><Field {ctx} name="location" address="address" /></Column>
			<Column span="all"><Field {ctx} name="zones" /></Column>
		</Grid>
	</Section>
{/snippet}

{#snippet programmeTab()}
	{#if record}
		<ProjectProgrammeTab
			{ctx}
			{record}
			today={day.today}
			onInspectBim={(expressIds, label) => (focus = { label, expressIds: [...expressIds] })}
			onCreateTask={(values) => (createSheet = { kind: 'task', values })}
		/>
	{/if}
{/snippet}

{#snippet bimTab()}
	{#if record && view.mode !== 'create'}
		<ProjectBimTab
			{ctx}
			{record}
			mode={view.mode}
			{focus}
			onFocusChange={(next) => (focus = next)}
			onCreateTask={(values) => (createSheet = { kind: 'task', values })}
		/>
	{/if}
{/snippet}

{#snippet financeTab()}
	{#if record}
		<ProjectFinanceTab
			{ctx}
			{record}
			today={day.today}
			onCreateContract={(direction, contract_type) =>
				(createSheet = { kind: 'contract', direction, contract_type })}
			onCreateAdhocCost={() => (createSheet = { kind: 'adhoc_cost' })}
		/>
	{/if}
{/snippet}

{#snippet sustainabilityTab()}
	{#if record}
		<ProjectSustainabilityTab {ctx} {record} />
	{/if}
{/snippet}

{#snippet documentsTab()}
	{#if id}
		<Table
			{ctx}
			of="project_files"
			key={`project:files:${id}`}
			where={{ project_id: { eq: id } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{
				title: t('project_files.register_title'),
				new: ctx.catalog?.project_files?.create ? () => (createSheet = { kind: 'file' }) : false
			}}
			columns={[
				'document_number',
				'title',
				'kind',
				'discipline',
				'current_version',
				'status',
				'zone'
			]}
		/>
	{/if}
{/snippet}

{#if record}
	<RecordShell
		{ctx}
		of="projects"
		mode={view.mode}
		id={record.id}
		subtitle={['project_role', 'client_id', 'status']}
		tabs={[
			{
				name: 'programme',
				title: t('programme.tasks_title'),
				icon: 'lucide:gantt-chart',
				body: programmeTab
			},
			{
				name: 'bim',
				title: t('project.tab_bim'),
				icon: 'lucide:box',
				keep_alive: true,
				body: bimTab
			},
			{
				name: 'finance',
				title: t('project.tab_finance'),
				icon: 'lucide:banknote',
				body: financeTab
			},
			{
				name: 'sustainability',
				title: t('project.tab_sustainability'),
				icon: 'lucide:leaf',
				body: sustainabilityTab
			},
			{
				name: 'documents',
				title: t('project_files.register_title'),
				icon: 'lucide:file-text',
				body: documentsTab
			}
		]}
	>
		<Form {ctx} of="projects" mode={view.mode} id={record.id} {record} size="content">
			{@render projectSections()}
		</Form>
	</RecordShell>
{:else}
	<RecordForm {ctx} {view} subtitle={['project_role', 'client_id', 'status']}>
		{@render projectSections()}
	</RecordForm>
{/if}

<Sheet open={createSheet !== null} on_open_change={(open) => !open && (createSheet = null)}>
	{#if createSheet?.kind === 'file' && id}
		<RecordShell
			{ctx}
			of="project_files"
			mode="create"
			values={{ project_id: id }}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'task'}
		<RecordShell
			{ctx}
			of="tasks"
			mode="create"
			values={createSheet.values}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'contract' && id}
		<RecordShell
			{ctx}
			of="contracts"
			mode="create"
			values={{
				project_id: id,
				direction: createSheet.direction,
				contract_type: createSheet.contract_type,
				currency: record?.currency ?? 'SGD'
			}}
			on_done={() => (createSheet = null)}
		/>
	{:else if createSheet?.kind === 'adhoc_cost' && id}
		<RecordShell
			{ctx}
			of="adhoc_costs"
			mode="create"
			values={{ project_id: id, currency: record?.currency ?? 'SGD' }}
			on_done={() => (createSheet = null)}
		/>
	{/if}
</Sheet>
