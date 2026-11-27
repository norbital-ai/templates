<script lang="ts">
	/**
	 * Project Hub → Programme & Tasks tab (Timeline / Table / Board switcher + WBS cell snippets).
	 */
	import type { Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Alert, Board, CustomView, Icon, Spinner, Table, enum_text } from '@norbital-ai/ui';
	import { Bound, Inline, Scroll } from '@norbital-ai/ui/layout';
	import ProjectTimeline from '../../../lib/ProjectTimeline.svelte';
	import { toNumber } from '../../../services/commercial/decimal.js';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';

	let {
		ctx,
		record,
		today,
		onInspectBim,
		onCreateTask
	}: {
		ctx: PageContext;
		record: Row<'projects'>;
		today: string;
		onInspectBim: (expressIds: readonly number[], label: string) => void;
		onCreateTask: (values: Record<string, unknown>) => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	let tasksView = $state<'timeline' | 'table' | 'board'>('timeline');

	const tasksQuery = $derived(
		ctx.query({
			tasks: {
				where: { project_id: { eq: record.id } },
				fields: [
					'task_code',
					'wbs_path',
					'title',
					'kind',
					'is_milestone',
					'zone',
					'trade_specialty',
					'subcontractor_id',
					'status',
					'priority',
					'progress_pct',
					'schedule_range',
					'bim_express_ids',
					'last_updated_on'
				],
				order_by: { wbs_path: 'asc' },
				limit: 2000
			}
		})
	);

	const viewOptions = $derived([
		{ value: 'timeline' as const, label: t('programme.view_timeline'), icon: 'lucide:gantt-chart' },
		{ value: 'table' as const, label: t('component.view_table'), icon: 'lucide:table-2' },
		{ value: 'board' as const, label: t('component.view_board'), icon: 'lucide:columns-3' }
	]);
</script>

{#snippet tasksViewToggle()}
	<SegmentedToggle
		options={viewOptions}
		value={tasksView}
		onChange={(next) => (tasksView = next)}
		iconOnly
		label={t('programme.view_switcher')}
		control={{ id: 'construction:tasks-view', label: t('programme.view_switcher') }}
	/>
{/snippet}

{#snippet taskBoardCard({
	row
}: {
	row: {
		readonly title?: unknown;
		readonly task_code?: unknown;
		readonly trade_specialty?: unknown;
		readonly subcontractor_id?: unknown;
		readonly priority?: unknown;
		readonly progress_pct?: unknown;
		readonly is_milestone?: unknown;
		readonly last_updated_on?: unknown;
	};
})}
	{@const title = typeof row.title === 'string' ? row.title : ''}
	{@const code = typeof row.task_code === 'string' ? row.task_code : ''}
	{@const trade = typeof row.trade_specialty === 'string' ? row.trade_specialty : ''}
	{@const subconObj =
		row.subcontractor_id && typeof row.subcontractor_id === 'object' ? row.subcontractor_id : null}
	{@const subcon =
		subconObj &&
		'company_name' in subconObj &&
		typeof subconObj.company_name === 'string' &&
		subconObj.company_name.trim()
			? subconObj.company_name.trim()
			: subconObj && 'full_name' in subconObj && typeof subconObj.full_name === 'string'
				? subconObj.full_name.trim()
				: ''}
	{@const priority = typeof row.priority === 'string' ? row.priority : ''}
	{@const isMilestone = row.is_milestone === true}
	{@const pct = Math.round(
		toNumber(
			typeof row.progress_pct === 'string' || typeof row.progress_pct === 'number'
				? row.progress_pct
				: 0
		)
	)}
	{@const updatedOn = typeof row.last_updated_on === 'string' ? row.last_updated_on : ''}
	<div class="flex flex-col gap-1 pr-4">
		<div class="flex items-center gap-1">
			{#if isMilestone}
				<Icon name="lucide:diamond" class="size-2.5 shrink-0 text-tone-warning-text" />
			{:else if priority === 'critical' || priority === 'high'}
				<span
					class="size-1.5 shrink-0 rounded-full {priority === 'critical'
						? 'bg-destructive'
						: 'bg-warning'}"
					title={enum_text(priority, { t: rawT, model: 'tasks', field: 'priority' })}
				></span>
			{/if}
			<p class="min-w-0 flex-1 truncate text-xs font-medium leading-tight text-foreground" {title}>
				{title}
			</p>
			{#if !isMilestone}
				<span class="shrink-0 text-tiny font-medium tabular-nums text-muted-foreground">{pct}%</span
				>
			{/if}
		</div>
		<div class="flex items-center justify-between gap-1.5 text-tiny text-muted-foreground">
			<span class="min-w-0 truncate">
				{#if code}<span class="font-mono">{code}</span>{/if}
				{#if code && (subcon || trade)}
					·
				{/if}
				{#if subcon}{subcon}{:else if trade}{enum_text(trade, {
						t: rawT,
						model: 'tasks',
						field: 'trade_specialty'
					})}{/if}
			</span>
			{#if updatedOn}
				<span class="shrink-0 font-mono tabular-nums">{updatedOn.slice(5)}</span>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet taskTitleCell({
	row
}: {
	row: {
		readonly title: string;
		readonly is_milestone?: boolean | null;
		readonly wbs_path?: string | null;
	};
})}
	<div class="flex min-w-0 items-center gap-1.5">
		{#if row.is_milestone}
			<Icon name="lucide:diamond" class="size-3 shrink-0 text-tone-warning-text" />
		{/if}
		<span class="min-w-0 flex-1 truncate text-foreground" title={row.title}>{row.title}</span>
		{#if row.wbs_path}
			<span class="shrink-0 font-mono text-tiny text-muted-foreground">{row.wbs_path}</span>
		{/if}
	</div>
{/snippet}

{#snippet taskProgressCell({
	row
}: {
	row: {
		readonly progress_pct: string;
		readonly status: string;
		readonly is_milestone?: boolean | null;
	};
})}
	{@const pct = Math.round(toNumber(row.progress_pct))}
	<div class="flex items-center justify-end gap-1.5 tabular-nums">
		{#if !row.is_milestone}
			<div class="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
				<div
					class="h-full rounded-full {row.status === 'done'
						? 'bg-tone-success-text'
						: row.status === 'blocked'
							? 'bg-tone-destructive-text'
							: 'bg-primary'}"
					style={`width: ${pct}%`}
				></div>
			</div>
		{/if}
		<span class="w-7 text-right text-micro">{pct}%</span>
	</div>
{/snippet}

{#if tasksView === 'table'}
	<Table
		{ctx}
		of="tasks"
		key={`project:tasks:${record.id}`}
		where={{ project_id: { eq: record.id } }}
		order_by={{ task_code: 'asc' }}
		page_size={100}
		row_class={(r) => (r.status === 'blocked' ? 'bg-tone-destructive-bg/20' : undefined)}
		toolbar={{
			title: t('programme.tasks_title'),
			trailing: tasksViewToggle,
			context: { project_id: record.id },
			new: ctx.catalog?.tasks?.create ? () => onCreateTask({ project_id: record.id }) : false
		}}
		columns={[
			{ field: 'task_code', width: 88 },
			{ field: 'title', width: 250, cell: taskTitleCell },
			{ field: 'kind', width: 84 },
			{ field: 'subcontractor_id', width: 148 },
			{ field: 'trade_specialty', width: 108 },
			{ field: 'zone', width: 88, hide: 'narrow' },
			{ field: 'status', width: 96 },
			{ field: 'progress_pct', width: 84, align: 'end', cell: taskProgressCell },
			{ field: 'schedule_range', width: 148, hide: 'narrow' }
		]}
	/>
{:else if tasksView === 'board'}
	<Board
		{ctx}
		of="tasks"
		key={`project:tasks:board:${record.id}`}
		where={{ project_id: { eq: record.id } }}
		order_by={{ last_updated_on: 'desc' }}
		by="status"
		lanes={['todo', 'in_progress', 'blocked', 'done']}
		columns={4}
		page_size={50}
		card={taskBoardCard}
		toolbar={{
			title: t('programme.tasks_title'),
			trailing: tasksViewToggle,
			select: false,
			context: { project_id: record.id },
			new: ctx.catalog?.tasks?.create ? () => onCreateTask({ project_id: record.id }) : false
		}}
	/>
{:else if tasksQuery.loading && !tasksQuery.current}
	<Bound size="content" inset>
		<Inline gap="sm" align="center" aria-busy="true">
			<Spinner />
			<span class="text-sm text-muted-foreground">{t('component.loading_programme')}</span>
		</Inline>
	</Bound>
{:else if tasksQuery.error}
	<Bound size="content" inset>
		<Alert.Root variant="destructive">
			<Alert.Title>{tasksQuery.error.message}</Alert.Title>
		</Alert.Root>
	</Bound>
{:else}
	<CustomView
		{ctx}
		model="tasks"
		of={tasksQuery.current?.tasks.rows ?? []}
		fields={['task_code', 'title', 'trade_specialty', 'zone', 'status', 'priority']}
		key={`project:timeline:${record.id}`}
		empty={false}
		toolbar={{
			title: t('programme.tasks_title'),
			trailing: tasksViewToggle,
			context: { project_id: record.id },
			new: ctx.catalog?.tasks?.create ? () => onCreateTask({ project_id: record.id }) : false
		}}
	>
		{#snippet children(shownTasks)}
			<Scroll name={t('programme.tasks_title')} size="fill">
				<ProjectTimeline
					{ctx}
					projectRange={record.schedule_range}
					tasks={shownTasks}
					{today}
					onInspectBim={(expressIds, label) =>
						onInspectBim(expressIds, t('bim.focus_4d', { date: label }))}
				/>
			</Scroll>
		{/snippet}
	</CustomView>
{/if}
