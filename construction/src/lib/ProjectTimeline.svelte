<!-- @component High-density virtualized 4D construction programme timeline built for hundreds of subcontractors and daily updates, with WBS/Subcontractor/Trade/Zone grouping, quick filters, and inline 4D date scrubber. -->
<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		EmptyState,
		Icon,
		Surface,
		enum_text,
		open_record,
		virtual_list
	} from '@norbital-ai/ui';
	import { create_slider, create_toggle_group, register_control } from '@norbital-ai/ui/behaviors';
	import { Scroll } from '@norbital-ai/ui/layout';
	import { DateTime, Option } from 'effect';
	import { toNumber, type DecimalLike } from './commercial.js';
	import { addCalendarDays, diffCalendarDays, parseIsoDate } from './dates.js';

	type SubcontractorRef =
		| string
		| {
				readonly id: string;
				readonly company_name?: string | null;
				readonly full_name?: string | null;
		  }
		| null
		| undefined;

	type TimelineTask = {
		readonly id: string;
		readonly task_code: string | null;
		readonly wbs_path?: string | null;
		readonly parent_task_id?: string | { readonly id: string } | null;
		readonly title: string;
		readonly zone?: string | null;
		readonly trade_specialty: string | null;
		readonly subcontractor_id?: SubcontractorRef;
		readonly is_milestone?: boolean | null;
		readonly status: string;
		readonly priority: string;
		readonly progress_pct: DecimalLike;
		readonly schedule_range: { readonly from: string; readonly to: string | null } | null;
		readonly bim_express_ids: readonly number[] | null;
		readonly latest_update?: string | null;
		readonly last_updated_on?: string | null;
	};

	type GroupMode = 'wbs' | 'subcontractor' | 'trade' | 'zone';
	type QuickFilter = 'all' | 'blocked' | 'behind' | 'updated' | 'milestones';

	type DisplayRow =
		| {
				readonly kind: 'group';
				readonly key: string;
				readonly label: string;
				readonly count: number;
				readonly blockedCount: number;
				readonly updatedCount: number;
				readonly effectiveRange: { readonly from: string; readonly to: string | null } | null;
				readonly effectiveProgress: number;
		  }
		| {
				readonly kind: 'task';
				readonly key: string;
				readonly task: TimelineTask;
				readonly depth: number;
				readonly childCount: number;
				readonly effectiveRange: { readonly from: string; readonly to: string | null } | null;
				readonly effectiveProgress: number;
		  };

	let {
		ctx,
		projectRange,
		tasks,
		today,
		onInspectBim
	}: {
		ctx: PageContext;
		projectRange: { readonly from: string; readonly to: string | null } | null;
		tasks: readonly TimelineTask[];
		today: string;
		onInspectBim?: (expressIds: readonly number[], label: string) => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	function parentIdOf(task: TimelineTask): string | null {
		const raw = task.parent_task_id;
		if (raw == null) return null;
		return typeof raw === 'string' ? raw : raw.id;
	}

	function subconLabelOf(task: TimelineTask): string {
		const raw = task.subcontractor_id;
		if (raw == null) return '';
		if (typeof raw === 'string') return '';
		return raw.company_name?.trim() || raw.full_name?.trim() || '';
	}

	function tradeLabelOf(trade: string | null): string {
		if (!trade) return '';
		return enum_text(trade, { t: rawT, model: 'tasks', field: 'trade_specialty' });
	}

	function compareWbs(a: TimelineTask, b: TimelineTask): number {
		const keyA = a.wbs_path?.trim() || a.task_code?.trim() || a.title;
		const keyB = b.wbs_path?.trim() || b.task_code?.trim() || b.title;
		return keyA.localeCompare(keyB, undefined, { numeric: true, sensitivity: 'base' });
	}

	let groupMode = $state<GroupMode>('wbs');
	let quickFilter = $state<QuickFilter>('all');
	let collapsed = $state<Readonly<Record<string, boolean>>>({});

	const bounds = $derived.by(() => {
		const dates: string[] = [];
		const pushDate = (raw: string | null | undefined) => {
			const parsed = parseIsoDate(raw);
			if (parsed !== null) dates.push(parsed);
		};
		pushDate(projectRange?.from);
		pushDate(projectRange?.to);
		for (const item of tasks) {
			pushDate(item.schedule_range?.from);
			pushDate(item.schedule_range?.to);
		}
		if (dates.length === 0) {
			return {
				startIso: addCalendarDays(today, -30),
				endIso: addCalendarDays(today, 120)
			};
		}
		dates.sort();
		const minIso = dates[0] ?? today;
		const maxIso = dates[dates.length - 1] ?? today;
		const spanDays = Math.max(30, diffCalendarDays(minIso, maxIso));
		return {
			startIso: minIso,
			endIso: addCalendarDays(minIso, spanDays)
		};
	});

	const totalDays = $derived(Math.max(1, diffCalendarDays(bounds.startIso, bounds.endIso)));
	const todayOffset = $derived(
		Math.min(totalDays, Math.max(0, diffCalendarDays(bounds.startIso, today)))
	);

	let scrubDay = $state<number | null>(null);
	const currentDay = $derived(Math.min(totalDays, Math.max(0, scrubDay ?? todayOffset)));
	const currentIso = $derived(addCalendarDays(bounds.startIso, currentDay));
	const scrubPct = $derived((currentDay / totalDays) * 100);
	const todayPct = $derived((todayOffset / totalDays) * 100);

	const positionOf = (from: string, to: string | null) => {
		const sDay = diffCalendarDays(bounds.startIso, from);
		const eDay = to ? Math.max(diffCalendarDays(bounds.startIso, to), sDay + 1) : sDay + 14;
		const left = Math.max(0, Math.min(100, (sDay / totalDays) * 100));
		const right = Math.max(left + 1.2, Math.min(100, (eDay / totalDays) * 100));
		return { left, width: Math.max(1.2, right - left), startDay: sDay, endDay: eDay };
	};

	const plannedPctAt = (startDay: number, endDay: number, atDay: number): number => {
		if (atDay <= startDay) return 0;
		if (atDay >= endDay) return 100;
		return Math.round(((atDay - startDay) / Math.max(1, endDay - startDay)) * 100);
	};

	const recentCutoff = $derived(addCalendarDays(today, -2));

	function isTaskBehind(task: TimelineTask): boolean {
		if (task.status === 'done' || task.status === 'cancelled') return false;
		const from = parseIsoDate(task.schedule_range?.from);
		if (!from) return false;
		const pos = positionOf(from, parseIsoDate(task.schedule_range?.to));
		const planned = plannedPctAt(pos.startDay, pos.endDay, todayOffset);
		return planned - Math.round(toNumber(task.progress_pct)) >= 15;
	}

	function isTaskRecentlyUpdated(task: TimelineTask): boolean {
		const updated = parseIsoDate(task.last_updated_on);
		if (updated !== null && updated >= recentCutoff) return true;
		return Boolean(task.latest_update && task.latest_update.trim().length > 0 && updated === null);
	}

	const filterCounts = $derived.by(() => {
		let blocked = 0;
		let behind = 0;
		let updated = 0;
		let milestones = 0;
		for (const task of tasks) {
			if (task.status === 'blocked') blocked += 1;
			if (isTaskBehind(task)) behind += 1;
			if (isTaskRecentlyUpdated(task)) updated += 1;
			if (task.is_milestone === true) milestones += 1;
		}
		return { blocked, behind, updated, milestones };
	});

	const filteredTasks = $derived.by<readonly TimelineTask[]>(() => {
		if (quickFilter === 'all') return tasks;
		const matched = new Set<string>();
		const byId = new Map(tasks.map((item) => [item.id, item] as const));
		for (const task of tasks) {
			const hit =
				(quickFilter === 'blocked' && task.status === 'blocked') ||
				(quickFilter === 'behind' && isTaskBehind(task)) ||
				(quickFilter === 'updated' && isTaskRecentlyUpdated(task)) ||
				(quickFilter === 'milestones' && task.is_milestone === true);
			if (!hit) continue;
			matched.add(task.id);
			if (groupMode === 'wbs') {
				let pid = parentIdOf(task);
				let guard = 0;
				while (pid !== null && guard < 12) {
					matched.add(pid);
					const parent = byId.get(pid);
					pid = parent ? parentIdOf(parent) : null;
					guard += 1;
				}
			}
		}
		return tasks.filter((item) => matched.has(item.id));
	});

	const builtRows = $derived.by(() => {
		const source = filteredTasks;
		const groupKeys: string[] = [];

		if (groupMode === 'wbs') {
			const byId = new Map(source.map((task) => [task.id, task] as const));
			const childrenMap = new Map<string, TimelineTask[]>();
			const roots: TimelineTask[] = [];
			for (const task of source) {
				const pid = parentIdOf(task);
				if (pid !== null && pid !== task.id && byId.has(pid)) {
					const list = childrenMap.get(pid);
					if (list !== undefined) list.push(task);
					else childrenMap.set(pid, [task]);
				} else {
					roots.push(task);
				}
			}
			roots.sort(compareWbs);
			for (const list of childrenMap.values()) list.sort(compareWbs);

			const rollupCache = new Map<
				string,
				{ readonly from: string | null; readonly to: string | null; readonly progress: number }
			>();
			function computeRollup(task: TimelineTask, visiting: Set<string>) {
				const cached = rollupCache.get(task.id);
				if (cached !== undefined) return cached;
				const ownFrom = parseIsoDate(task.schedule_range?.from);
				const ownTo = parseIsoDate(task.schedule_range?.to) ?? ownFrom;
				const ownPct = Math.round(toNumber(task.progress_pct));
				const kids = childrenMap.get(task.id) ?? [];
				if (kids.length === 0 || visiting.has(task.id)) {
					const leaf = { from: ownFrom, to: ownTo, progress: ownPct };
					rollupCache.set(task.id, leaf);
					return leaf;
				}
				visiting.add(task.id);
				let minFrom = ownFrom;
				let maxTo = ownTo;
				let sumPct = 0;
				for (const kid of kids) {
					const r = computeRollup(kid, visiting);
					if (r.from !== null && (minFrom === null || r.from < minFrom)) minFrom = r.from;
					if (r.to !== null && (maxTo === null || r.to > maxTo)) maxTo = r.to;
					sumPct += r.progress;
				}
				visiting.delete(task.id);
				const rolledPct = ownPct > 0 ? ownPct : Math.round(sumPct / Math.max(1, kids.length));
				const res = { from: minFrom, to: maxTo, progress: rolledPct };
				rollupCache.set(task.id, res);
				return res;
			}

			const rows: DisplayRow[] = [];
			const visited = new Set<string>();
			function walk(task: TimelineTask, depth: number) {
				if (visited.has(task.id)) return;
				visited.add(task.id);
				const rollup = computeRollup(task, new Set());
				const kids = childrenMap.get(task.id) ?? [];
				const key = `wbs:${task.id}`;
				if (kids.length > 0) groupKeys.push(key);
				rows.push({
					kind: 'task',
					key,
					task,
					depth,
					childCount: kids.length,
					effectiveRange:
						rollup.from !== null ? { from: rollup.from, to: rollup.to } : task.schedule_range,
					effectiveProgress: rollup.progress
				});
				if (kids.length > 0 && !collapsed[key]) {
					for (const kid of kids) walk(kid, depth + 1);
				}
			}
			for (const root of roots) walk(root, 0);
			for (const task of source) {
				if (!visited.has(task.id)) walk(task, 0);
			}
			return { rows, groupKeys };
		}

		// Grouped mode: Subcontractor / Trade / Zone (built for 100s of subcontractors)
		const buckets = new Map<string, { label: string; items: TimelineTask[] }>();
		const unassigned = t('timeline.unassigned_group');
		for (const task of source) {
			let label = unassigned;
			if (groupMode === 'subcontractor') {
				label = subconLabelOf(task) || unassigned;
			} else if (groupMode === 'trade') {
				label = tradeLabelOf(task.trade_specialty) || unassigned;
			} else if (groupMode === 'zone') {
				label = task.zone?.trim() || unassigned;
			}
			const key = `${groupMode}:${label}`;
			const existing = buckets.get(key);
			if (existing !== undefined) existing.items.push(task);
			else buckets.set(key, { label, items: [task] });
		}

		const sortedBuckets = [...buckets.entries()].sort(([, a], [, b]) => {
			if (a.label === unassigned) return 1;
			if (b.label === unassigned) return -1;
			return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
		});

		const rows: DisplayRow[] = [];
		for (const [key, bucket] of sortedBuckets) {
			bucket.items.sort(compareWbs);
			let minFrom: string | null = null;
			let maxTo: string | null = null;
			let sumPct = 0;
			let blockedCount = 0;
			let updatedCount = 0;
			for (const item of bucket.items) {
				const f = parseIsoDate(item.schedule_range?.from);
				const e = parseIsoDate(item.schedule_range?.to) ?? f;
				if (f !== null && (minFrom === null || f < minFrom)) minFrom = f;
				if (e !== null && (maxTo === null || e > maxTo)) maxTo = e;
				sumPct += Math.round(toNumber(item.progress_pct));
				if (item.status === 'blocked') blockedCount += 1;
				if (isTaskRecentlyUpdated(item)) updatedCount += 1;
			}
			groupKeys.push(key);
			rows.push({
				kind: 'group',
				key,
				label: bucket.label,
				count: bucket.items.length,
				blockedCount,
				updatedCount,
				effectiveRange: minFrom !== null ? { from: minFrom, to: maxTo } : null,
				effectiveProgress: Math.round(sumPct / Math.max(1, bucket.items.length))
			});
			if (!collapsed[key]) {
				for (const item of bucket.items) {
					rows.push({
						kind: 'task',
						key: `task:${item.id}`,
						task: item,
						depth: 1,
						childCount: 0,
						effectiveRange: item.schedule_range,
						effectiveProgress: Math.round(toNumber(item.progress_pct))
					});
				}
			}
		}
		return { rows, groupKeys };
	});

	const allCollapsed = $derived(
		builtRows.groupKeys.length > 0 && builtRows.groupKeys.every((k) => Boolean(collapsed[k]))
	);

	function toggleGroup(key: string): void {
		collapsed = { ...collapsed, [key]: !collapsed[key] };
	}

	function expandAll(): void {
		collapsed = {};
	}

	function collapseAll(): void {
		const next: Record<string, boolean> = {};
		for (const key of builtRows.groupKeys) next[key] = true;
		collapsed = next;
	}

	const rowWin = virtual_list({
		count: () => builtRows.rows.length,
		key: (i) => builtRows.rows[i]?.key ?? String(i),
		estimate: 30,
		threshold: 25,
		overscan: 12
	});

	const dateSlider = $derived(
		create_slider({
			min: 0,
			max: totalDays,
			step: 1,
			value: () => currentDay,
			on_change: (next) => {
				scrubDay = next;
			},
			label: t('timeline.scrubber_label')
		})
	);

	const monthFormatter = $derived(
		new Intl.DateTimeFormat(ctx.locale, {
			month: 'short',
			year: '2-digit',
			timeZone: 'UTC'
		})
	);

	const monthTicks = $derived.by(() => {
		const ticks: { label: string; pct: number }[] = [];
		const startOpt = DateTime.make(`${bounds.startIso}T00:00:00Z`);
		const endOpt = DateTime.make(`${bounds.endIso}T00:00:00Z`);
		if (Option.isNone(startOpt) || Option.isNone(endOpt)) return ticks;
		const startParts = DateTime.toPartsUtc(startOpt.value);
		const firstMonthIso = `${String(startParts.year).padStart(4, '0')}-${String(startParts.month).padStart(2, '0')}-01`;
		const cursorOpt = DateTime.make(`${firstMonthIso}T00:00:00Z`);
		if (Option.isNone(cursorOpt)) return ticks;
		let cursor = cursorOpt.value;
		for (let i = 0; i < 120 && DateTime.isLessThanOrEqualTo(cursor, endOpt.value); i++) {
			const iso = DateTime.formatIsoDateUtc(cursor);
			if (iso >= bounds.startIso) {
				const offset = diffCalendarDays(bounds.startIso, iso);
				const pct = (offset / totalDays) * 100;
				const label = monthFormatter.format(DateTime.toEpochMillis(cursor));
				ticks.push({ label, pct });
			}
			cursor = DateTime.add(cursor, { months: 1 });
		}
		return ticks;
	});

	const snapshot = $derived.by(() => {
		let active = 0;
		let done = 0;
		const activeBimIds = new Set<number>();
		for (const task of tasks) {
			if (task.status === 'done') done += 1;
			const from = parseIsoDate(task.schedule_range?.from);
			if (!from) continue;
			const to =
				parseIsoDate(task.schedule_range?.to) ?? addCalendarDays(from, task.is_milestone ? 0 : 14);
			if (currentIso >= from && currentIso <= to) {
				active += 1;
				for (const id of task.bim_express_ids ?? []) activeBimIds.add(id);
			}
		}
		return {
			active,
			done,
			activeBimIds: [...activeBimIds]
		};
	});

	$effect(() =>
		register_control({
			id: 'construction:programme-timeline',
			kind: 'slider',
			label: t('timeline.scrubber_label'),
			state: () => ({
				date: currentIso,
				day: currentDay,
				total_days: totalDays,
				active_tasks: snapshot.active,
				group_mode: groupMode,
				quick_filter: quickFilter
			}),
			actions: {
				set_date: (iso) => {
					if (typeof iso !== 'string') return;
					const parsed = parseIsoDate(iso);
					if (parsed === null) return;
					scrubDay = Math.min(totalDays, Math.max(0, diffCalendarDays(bounds.startIso, parsed)));
				},
				jump_today: () => {
					scrubDay = null;
				},
				set_group_mode: (mode) => {
					if (mode === 'wbs' || mode === 'subcontractor' || mode === 'trade' || mode === 'zone') {
						groupMode = mode;
						collapsed = {};
					}
				},
				set_quick_filter: (filter) => {
					if (
						filter === 'all' ||
						filter === 'blocked' ||
						filter === 'behind' ||
						filter === 'updated' ||
						filter === 'milestones'
					) {
						quickFilter = filter;
					}
				}
			}
		})
	);

	const barTone = (status: string) =>
		status === 'done'
			? 'bg-tone-success-bg border-tone-success-border'
			: status === 'blocked'
				? 'bg-tone-destructive-bg border-tone-destructive-border'
				: status === 'in_progress'
					? 'bg-tone-info-bg border-tone-info-border'
					: 'bg-muted border-border';

	const fillTone = (status: string) =>
		status === 'done'
			? 'bg-tone-success-text'
			: status === 'blocked'
				? 'bg-tone-destructive-text'
				: 'bg-primary';

	const groupOptions: readonly { readonly id: GroupMode; readonly label: () => string }[] = [
		{ id: 'wbs', label: () => t('timeline.group_wbs') },
		{ id: 'subcontractor', label: () => t('timeline.group_subcontractor') },
		{ id: 'trade', label: () => t('timeline.group_trade') },
		{ id: 'zone', label: () => t('timeline.group_zone') }
	];

	const filterOptions: readonly {
		readonly id: QuickFilter;
		readonly label: () => string;
		readonly count: () => number | null;
		readonly tone?: 'destructive' | 'warning';
	}[] = [
		{ id: 'all', label: () => t('timeline.filter_all'), count: () => tasks.length },
		{
			id: 'blocked',
			label: () => t('timeline.filter_blocked'),
			count: () => filterCounts.blocked,
			tone: 'destructive'
		},
		{
			id: 'behind',
			label: () => t('timeline.filter_behind'),
			count: () => filterCounts.behind,
			tone: 'warning'
		},
		{
			id: 'updated',
			label: () => t('timeline.filter_updated'),
			count: () => filterCounts.updated
		},
		{
			id: 'milestones',
			label: () => t('timeline.filter_milestones'),
			count: () => filterCounts.milestones
		}
	];

	const visibleFilterOptions = $derived(
		filterOptions.filter((opt) => {
			const count = opt.count();
			return opt.id === 'all' || (count !== null && count > 0) || quickFilter === opt.id;
		})
	);

	const groupToggle = create_toggle_group({
		items: () => groupOptions.map((opt) => opt.id),
		mode: 'single',
		value: () => [groupMode],
		on_change: (values) => {
			const next = values[0];
			if (next === 'wbs' || next === 'subcontractor' || next === 'trade' || next === 'zone') {
				groupMode = next;
				collapsed = {};
			}
		},
		label: t('timeline.group_by'),
		control: { id: 'construction:timeline-group', label: t('timeline.group_by') }
	});

	const filterToggle = create_toggle_group({
		items: () => visibleFilterOptions.map((opt) => opt.id),
		mode: 'single',
		value: () => [quickFilter],
		on_change: (values) => {
			const next = values[0];
			if (
				next === 'all' ||
				next === 'blocked' ||
				next === 'behind' ||
				next === 'updated' ||
				next === 'milestones'
			) {
				quickFilter = next;
			} else {
				quickFilter = 'all';
			}
		},
		label: t('timeline.quick_filter'),
		control: { id: 'construction:timeline-filter', label: t('timeline.quick_filter') }
	});
</script>

{#if tasks.length === 0}
	<EmptyState
		variant="card"
		icon="file"
		title={t('timeline.empty_title')}
		hint={t('timeline.empty_hint')}
	/>
{:else}
	<Surface tone="card" padding="none" radius="control" class="overflow-hidden">
		<!-- Compact 2-strip command & 4D scrubber bar (minimal vertical overhead) -->
		<div class="flex flex-col gap-1 border-b border-border bg-muted/20 px-2.5 py-1.5">
			<div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<!-- Group-by segmented pill -->
					<div
						class="inline-flex items-center rounded-control border border-border bg-background p-0.5"
						{...groupToggle.root_attrs()}
					>
						{#each groupOptions as opt (opt.id)}
							<button
								{...groupToggle.item_attrs(opt.id)}
								{@attach groupToggle.item(opt.id)}
								class="rounded-inset px-2 py-0.5 text-micro font-medium transition-colors {groupMode ===
								opt.id
									? 'bg-secondary text-foreground'
									: 'text-muted-foreground hover:text-foreground'}"
							>
								{opt.label()}
							</button>
						{/each}
					</div>

					<!-- Instant filter pills -->
					<div class="inline-flex flex-wrap items-center gap-1" {...filterToggle.root_attrs()}>
						{#each visibleFilterOptions as opt (opt.id)}
							{@const count = opt.count()}
							<button
								{...filterToggle.item_attrs(opt.id)}
								{@attach filterToggle.item(opt.id)}
								class="inline-flex items-center gap-1 rounded-control border px-1.5 py-0.5 text-micro tabular-nums transition-colors {quickFilter ===
								opt.id
									? 'border-primary/60 bg-primary/10 font-medium text-foreground'
									: 'border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground'}"
							>
								{#if opt.tone === 'destructive' && count && count > 0}
									<span class="size-1.5 rounded-full bg-destructive"></span>
								{:else if opt.tone === 'warning' && count && count > 0}
									<span class="size-1.5 rounded-full bg-warning"></span>
								{/if}
								<span>{opt.label()}</span>
								{#if count !== null}
									<span class="text-tiny text-muted-foreground">{count}</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex items-center gap-1.5 text-micro tabular-nums text-muted-foreground">
					<span class="hidden sm:inline">
						{t('timeline.summary_compact', {
							active: snapshot.active,
							done: snapshot.done,
							total: tasks.length
						})}
					</span>
					{#if builtRows.groupKeys.length > 0}
						<Button
							size="icon"
							variant="ghost"
							class="size-6"
							aria-label={allCollapsed ? t('timeline.expand_all') : t('timeline.collapse_all')}
							hint={allCollapsed ? t('timeline.expand_all') : t('timeline.collapse_all')}
							onclick={() => (allCollapsed ? expandAll() : collapseAll())}
						>
							<Icon
								name={allCollapsed ? 'lucide:chevrons-up-down' : 'lucide:chevrons-down-up'}
								class="size-3.5"
							/>
						</Button>
					{/if}
					{#if onInspectBim && snapshot.activeBimIds.length > 0}
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-control border border-border bg-background px-2 py-0.5 text-micro font-medium text-foreground transition-colors hover:bg-muted"
							onclick={() => onInspectBim?.(snapshot.activeBimIds, currentIso)}
						>
							<Icon name="lucide:box" class="size-3" />
							{t('timeline.bim_short', { count: snapshot.activeBimIds.length })}
						</button>
					{/if}
					<button
						type="button"
						disabled={scrubDay === null || currentDay === todayOffset}
						class="inline-flex items-center gap-1 rounded-control border border-border bg-background px-2 py-0.5 text-micro font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
						onclick={() => (scrubDay = null)}
					>
						{t('timeline.today')}
					</button>
				</div>
			</div>

			<!-- Inline 4D date scrubber strip -->
			<div class="flex items-center gap-2 text-micro tabular-nums">
				<span class="shrink-0 font-mono text-tiny text-muted-foreground">{bounds.startIso}</span>
				<div
					class="relative flex h-4 min-w-24 flex-1 cursor-pointer items-center"
					{@attach dateSlider.track}
				>
					<div class="h-1 w-full rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary"
							style={`width: ${dateSlider.percent}%`}
						></div>
					</div>
					<div
						class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						style={`left: ${dateSlider.percent}%`}
						{...dateSlider.thumb_attrs()}
					></div>
				</div>
				<span
					class="shrink-0 rounded-inset px-1.5 py-0.5 font-mono text-micro font-medium {currentIso ===
					today
						? 'bg-primary/15 text-primary'
						: 'bg-muted text-foreground'}"
				>
					{currentIso}
				</span>
				<span class="shrink-0 font-mono text-tiny text-muted-foreground">{bounds.endIso}</span>
			</div>
		</div>

		{#if builtRows.rows.length === 0}
			<div class="flex items-center justify-between px-3 py-4 text-xs text-muted-foreground">
				<span>{t('timeline.filter_empty')}</span>
				<Button variant="ghost" onclick={() => (quickFilter = 'all')}>
					{t('timeline.clear_filter')}
				</Button>
			</div>
		{:else}
			<Scroll axis="x" name={t('timeline.programme_axis')}>
				<div class="min-w-[52rem]">
					<!-- Sticky compact axis header -->
					<div
						class="grid grid-cols-[22rem_minmax(28rem,1fr)] items-center border-b border-border bg-muted/30 text-micro font-medium text-muted-foreground"
					>
						<div class="flex items-center justify-between border-r border-border px-2.5 py-1">
							<span>{t('timeline.work_package')}</span>
							<span class="text-tiny tabular-nums">{builtRows.rows.length}</span>
						</div>
						<div class="relative h-6 overflow-hidden">
							{#each monthTicks as tick (tick.label + tick.pct)}
								<span
									class="absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-tiny tabular-nums text-muted-foreground"
									style={`left: ${tick.pct}%`}
								>
									{tick.label}
								</span>
							{/each}
						</div>
					</div>

					<!-- Single shared vertical gridlines + Today + 4D Scrubber overlay (O(1) DOM regardless of row count) -->
					<div class="relative">
						<div
							aria-hidden="true"
							class="pointer-events-none absolute inset-y-0 right-0 left-[22rem] overflow-hidden"
						>
							{#each monthTicks as tick (tick.label + tick.pct)}
								<div
									class="absolute inset-y-0 w-px bg-border/60"
									style={`left: ${tick.pct}%`}
								></div>
							{/each}
							<div
								class="absolute inset-y-0 w-px border-l border-dashed border-muted-foreground/70"
								style={`left: ${todayPct}%`}
							></div>
							<div
								class="absolute inset-y-0 z-10 w-0.5 bg-primary/80"
								style={`left: ${scrubPct}%`}
							></div>
						</div>

						<div class="divide-y divide-border/60">
							{#if rowWin.on}
								<div
									aria-hidden="true"
									class="border-t-0!"
									{@attach rowWin.anchor}
									style:height="{rowWin.before}px"
								></div>
							{/if}

							{#each rowWin.slice(builtRows.rows) as row (row.key)}
								{#if row.kind === 'group'}
									{@const isExpanded = !collapsed[row.key]}
									{@const pos = row.effectiveRange?.from
										? positionOf(row.effectiveRange.from, row.effectiveRange.to)
										: null}
									<div
										class="grid h-[30px] grid-cols-[22rem_minmax(28rem,1fr)] items-center bg-muted/25 hover:bg-muted/45"
										{@attach rowWin.measure(row.key)}
									>
										<button
											type="button"
											class="flex h-full min-w-0 items-center gap-1.5 border-r border-border px-2 text-left"
											aria-expanded={isExpanded}
											onclick={() => toggleGroup(row.key)}
										>
											<Icon
												name={isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
												class="size-3.5 shrink-0 text-muted-foreground"
											/>
											<span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
												{row.label}
											</span>
											<span
												class="inline-flex shrink-0 items-center gap-1.5 text-tiny tabular-nums text-muted-foreground"
											>
												{#if row.blockedCount > 0}
													<span class="font-medium text-destructive">
														{t('timeline.blocked_short', { count: row.blockedCount })}
													</span>
												{/if}
												{#if row.updatedCount > 0}
													<span class="size-1.5 rounded-full bg-tone-success-text"></span>
												{/if}
												<span>({row.count})</span>
												<span class="w-7 text-right text-foreground">{row.effectiveProgress}%</span>
											</span>
										</button>
										<div class="relative h-full">
											{#if pos}
												<button
													type="button"
													aria-label={`${row.label} (${row.effectiveProgress}%)`}
													class="absolute top-1/2 h-2 -translate-y-1/2 rounded-xs border border-primary/50 bg-primary/15"
													style={`left: ${pos.left}%; width: ${pos.width}%`}
													onclick={() => toggleGroup(row.key)}
												>
													<div
														class="h-full rounded-xs bg-primary/70"
														style={`width: ${row.effectiveProgress}%`}
													></div>
												</button>
											{/if}
										</div>
									</div>
								{:else}
									{@const task = row.task}
									{@const isSummary = row.childCount > 0}
									{@const isExpanded = !collapsed[row.key]}
									{@const pos = row.effectiveRange?.from
										? positionOf(row.effectiveRange.from, row.effectiveRange.to)
										: null}
									{@const actualPct = row.effectiveProgress}
									{@const plannedPct = pos ? plannedPctAt(pos.startDay, pos.endDay, currentDay) : 0}
									{@const behind = plannedPct - actualPct >= 15 && task.status !== 'done'}
									{@const subcon = subconLabelOf(task)}
									{@const secondaryTag =
										groupMode === 'subcontractor'
											? tradeLabelOf(task.trade_specialty)
											: subcon || tradeLabelOf(task.trade_specialty)}
									{@const hasUpdate = Boolean(
										task.latest_update && task.latest_update.trim().length > 0
									)}
									{@const barTip = [
										task.task_code ? `${task.task_code} · ${task.title}` : task.title,
										subcon || tradeLabelOf(task.trade_specialty),
										`${actualPct}%`,
										row.effectiveRange?.from
											? `${row.effectiveRange.from}${row.effectiveRange.to ? ` → ${row.effectiveRange.to}` : ''}`
											: '',
										hasUpdate
											? `${task.last_updated_on ? `[${task.last_updated_on}] ` : ''}${task.latest_update}`
											: ''
									]
										.filter(Boolean)
										.join(' · ')}
									<div
										class="grid h-[30px] grid-cols-[22rem_minmax(28rem,1fr)] items-center transition-colors hover:bg-muted/35 {task.status ===
										'blocked'
											? 'bg-tone-destructive-bg/20'
											: ''}"
										{@attach rowWin.measure(row.key)}
									>
										<div
											class="flex h-full min-w-0 items-center gap-1 border-r border-border pr-2"
											style={`padding-left: ${0.4 + row.depth * 0.85}rem`}
										>
											{#if isSummary}
												<button
													type="button"
													aria-label={isExpanded ? 'Collapse' : 'Expand'}
													aria-expanded={isExpanded}
													class="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
													onclick={() => toggleGroup(row.key)}
												>
													<Icon
														name={isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
														class="size-3"
													/>
												</button>
											{:else if row.depth > 0}
												<span class="size-3 shrink-0" aria-hidden="true"></span>
											{/if}

											<button
												type="button"
												class="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
												title={barTip}
												onclick={() => open_record('tasks', task.id)}
											>
												{#if task.is_milestone}
													<Icon
														name="lucide:diamond"
														class="size-2.5 shrink-0 text-tone-warning-text"
													/>
												{:else if task.status === 'blocked'}
													<span class="size-1.5 shrink-0 rounded-full bg-destructive"></span>
												{:else if task.priority === 'critical'}
													<span class="size-1.5 shrink-0 rounded-full bg-destructive"></span>
												{:else if task.priority === 'high'}
													<span class="size-1.5 shrink-0 rounded-full bg-warning"></span>
												{/if}

												{#if task.task_code}
													<span class="shrink-0 font-mono text-tiny text-muted-foreground">
														{task.task_code}
													</span>
												{/if}

												<span
													class="min-w-0 flex-1 truncate text-xs {isSummary
														? 'font-medium text-foreground'
														: 'text-foreground'}"
												>
													{task.title}
												</span>
											</button>

											<div
												class="flex shrink-0 items-center gap-1 text-tiny tabular-nums text-muted-foreground"
											>
												{#if secondaryTag}
													<span class="max-w-20 truncate" title={secondaryTag}>{secondaryTag}</span>
												{/if}
												{#if hasUpdate}
													<span
														class="size-1.5 shrink-0 rounded-full bg-tone-success-text"
														title={`${task.last_updated_on ? `${task.last_updated_on}: ` : ''}${task.latest_update ?? ''}`}
													></span>
												{/if}
												{#if behind}
													<span
														class="font-medium text-destructive"
														title={t('timeline.behind_plan', { planned: plannedPct })}
													>
														!
													</span>
												{/if}
												<span class="w-7 text-right text-foreground">{actualPct}%</span>
											</div>
										</div>

										<div class="relative h-full">
											{#if pos}
												{#if task.is_milestone}
													<button
														type="button"
														aria-label={barTip}
														title={barTip}
														class="absolute top-1/2 z-20 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-inset border transition-transform hover:scale-125 {task.status ===
														'done'
															? 'border-tone-success-border bg-tone-success-text'
															: 'border-tone-warning-border bg-tone-warning-text'}"
														style={`left: ${pos.left}%`}
														onclick={() => open_record('tasks', task.id)}
													></button>
												{:else if isSummary}
													<button
														type="button"
														aria-label={barTip}
														title={barTip}
														class="absolute top-1/2 h-2 -translate-y-1/2 rounded-xs border border-primary/50 bg-primary/15 text-left transition-colors hover:brightness-95"
														style={`left: ${pos.left}%; width: ${pos.width}%`}
														onclick={() => open_record('tasks', task.id)}
													>
														<div
															class="h-full rounded-xs bg-primary/70"
															style={`width: ${actualPct}%`}
														></div>
													</button>
												{:else}
													<button
														type="button"
														aria-label={barTip}
														title={barTip}
														class="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-inset border text-left transition-colors hover:brightness-95 {barTone(
															task.status
														)}"
														style={`left: ${pos.left}%; width: ${pos.width}%`}
														onclick={() => open_record('tasks', task.id)}
													>
														<div
															class="h-full rounded-inset {fillTone(task.status)}"
															style={`width: ${actualPct}%`}
														></div>
													</button>
												{/if}
											{:else}
												<span class="px-2 text-tiny leading-[30px] text-muted-foreground">
													{t('timeline.unscheduled')}
												</span>
											{/if}
										</div>
									</div>
								{/if}
							{/each}

							{#if rowWin.on && rowWin.after > 0}
								<div aria-hidden="true" class="border-t-0!" style:height="{rowWin.after}px"></div>
							{/if}
						</div>
					</div>
				</div>
			</Scroll>
		{/if}
	</Surface>
{/if}
