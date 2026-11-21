<!-- @component Interactive 4D construction programme timeline with date-axis scrubber, Gantt work packages, variation/EOT markers, and progress snapshot. -->
<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Button, EmptyState, Icon, open_record } from '@norbital-ai/ui';
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';

	import { toNumber, type DecimalLike } from './claims.js';

	type TimelineTask = {
		readonly id: string;
		readonly task_code: string | null;
		readonly title: string;
		readonly trade: string | null;
		readonly is_milestone?: boolean | null;
		readonly status: string;
		readonly priority: string;
		readonly progress_pct: DecimalLike;
		readonly schedule_range: { readonly from: string; readonly to: string | null } | null;
		readonly bim_express_ids: readonly number[] | null;
	};

	type TimelineChange = {
		readonly id: string;
		readonly change_number: string | null;
		readonly title: string;
		readonly status: string;
		readonly schedule_impact_days: number | null;
		readonly effective_date: string | null;
	};

	type TimelineUpdate = {
		readonly id: string;
		readonly title: string;
		readonly update_date: string;
		readonly category: string;
		readonly reported_progress_pct: DecimalLike;
	};

	let {
		ctx,
		projectRange,
		tasks,
		changes,
		updates,
		today,
		onInspectBim
	}: {
		ctx: PageContext;
		projectRange: { readonly from: string; readonly to: string | null } | null;
		tasks: readonly TimelineTask[];
		changes: readonly TimelineChange[];
		updates: readonly TimelineUpdate[];
		today: string;
		onInspectBim?: (expressIds: readonly number[], label: string) => void;
	} = $props();

	const t = ctx.t;
	const DAY_MS = 86_400_000;
	const toMs = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
	const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

	const bounds = $derived.by(() => {
		const dates: number[] = [];
		if (projectRange?.from) dates.push(toMs(projectRange.from));
		if (projectRange?.to) dates.push(toMs(projectRange.to));
		for (const item of tasks) {
			if (item.schedule_range?.from) dates.push(toMs(item.schedule_range.from));
			if (item.schedule_range?.to) dates.push(toMs(item.schedule_range.to));
		}
		for (const vo of changes) {
			if (vo.effective_date) dates.push(toMs(vo.effective_date));
		}
		for (const u of updates) {
			if (u.update_date) dates.push(toMs(u.update_date));
		}
		if (dates.length === 0) {
			const base = toMs(today);
			return { start: base - 30 * DAY_MS, end: base + 120 * DAY_MS };
		}
		const min = Math.min(...dates);
		const max = Math.max(...dates);
		const span = Math.max(max - min, 30 * DAY_MS);
		return { start: min, end: min + span };
	});

	const totalDays = $derived(Math.max(1, Math.round((bounds.end - bounds.start) / DAY_MS)));
	const todayOffset = $derived(
		Math.min(totalDays, Math.max(0, Math.round((toMs(today) - bounds.start) / DAY_MS)))
	);

	let scrubDay = $state<number | null>(null);
	const currentDay = $derived(scrubDay ?? todayOffset);
	const currentMs = $derived(bounds.start + currentDay * DAY_MS);
	const currentIso = $derived(toIso(currentMs));
	const scrubPct = $derived((currentDay / totalDays) * 100);
	const todayPct = $derived((todayOffset / totalDays) * 100);

	const monthTicks = $derived.by(() => {
		const ticks: { label: string; pct: number }[] = [];
		const start = new Date(bounds.start);
		const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
		while (cursor.getTime() <= bounds.end) {
			const ms = cursor.getTime();
			if (ms >= bounds.start) {
				const pct = ((ms - bounds.start) / (bounds.end - bounds.start)) * 100;
				const label = cursor.toLocaleDateString(ctx.locale, {
					month: 'short',
					year: '2-digit',
					timeZone: 'UTC'
				});
				ticks.push({ label, pct });
			}
			cursor.setUTCMonth(cursor.getUTCMonth() + 1);
		}
		return ticks;
	});

	const positionOf = (from: string, to: string | null) => {
		const s = toMs(from);
		const e = to ? Math.max(toMs(to), s + DAY_MS) : s + 14 * DAY_MS;
		const left = Math.max(
			0,
			Math.min(100, ((s - bounds.start) / (bounds.end - bounds.start)) * 100)
		);
		const right = Math.max(
			left + 1.5,
			Math.min(100, ((e - bounds.start) / (bounds.end - bounds.start)) * 100)
		);
		return { left, width: Math.max(1.5, right - left), startMs: s, endMs: e };
	};

	const plannedPctAt = (startMs: number, endMs: number, atMs: number): number => {
		if (atMs <= startMs) return 0;
		if (atMs >= endMs) return 100;
		return Math.round(((atMs - startMs) / Math.max(DAY_MS, endMs - startMs)) * 100);
	};

	const snapshot = $derived.by(() => {
		let active = 0;
		let plannedComplete = 0;
		let milestonesHit = 0;
		let totalMilestones = 0;
		const activeBimIds = new Set<number>();
		for (const task of tasks) {
			if (task.is_milestone === true) {
				totalMilestones += 1;
				if (task.status === 'done') milestonesHit += 1;
			}
			if (!task.schedule_range?.from) continue;
			const s = toMs(task.schedule_range.from);
			const e = task.schedule_range.to
				? toMs(task.schedule_range.to)
				: s + (task.is_milestone ? 0 : 14 * DAY_MS);
			if (currentMs >= s && currentMs <= e) {
				active += 1;
				for (const id of task.bim_express_ids ?? []) activeBimIds.add(id);
			} else if (currentMs > e) {
				plannedComplete += 1;
			}
		}
		const eotDays = changes
			.filter(
				(vo) =>
					vo.status === 'approved' &&
					(vo.effective_date == null || toMs(vo.effective_date) <= currentMs)
			)
			.reduce((sum, vo) => sum + (vo.schedule_impact_days ?? 0), 0);
		const loggedUpdates = updates.filter((u) => toMs(u.update_date) <= currentMs).length;
		return {
			active,
			plannedComplete,
			milestonesHit,
			totalMilestones,
			eotDays,
			loggedUpdates,
			activeBimIds: [...activeBimIds]
		};
	});

	const changeMarkers = $derived(
		changes.flatMap((vo) => {
			if (!vo.effective_date) return [];
			const ms = toMs(vo.effective_date);
			if (ms < bounds.start || ms > bounds.end) return [];
			const pct = ((ms - bounds.start) / (bounds.end - bounds.start)) * 100;
			return [{ ...vo, pct, passed: ms <= currentMs }];
		})
	);

	const barTone = (status: string) =>
		status === 'done'
			? 'bg-emerald-500/20 border-emerald-500/60'
			: status === 'blocked'
				? 'bg-destructive/15 border-destructive/60'
				: status === 'in_progress'
					? 'bg-primary/15 border-primary/60'
					: 'bg-muted border-border';

	const fillTone = (status: string) =>
		status === 'done'
			? 'bg-emerald-500/50'
			: status === 'blocked'
				? 'bg-destructive/40'
				: 'bg-primary/45';
</script>

<Stack gap="md">
	<Stack gap="sm" class="rounded-lg border border-border bg-card p-4">
		<Inline align="center" justify="between" gap="sm" class="flex-wrap">
			<Stack gap="xs">
				<p class="text-overline">{t('timeline.scrubber_label')}</p>
				<Inline align="center" gap="sm">
					<span class="text-heading tabular-nums">{currentIso}</span>
					{#if currentIso === today}
						<Badge variant="info">{t('timeline.today')}</Badge>
					{/if}
					{#if snapshot.eotDays !== 0}
						<Badge variant="outline">
							{t('timeline.eot_days', { days: snapshot.eotDays })}
						</Badge>
					{/if}
				</Inline>
			</Stack>
			<Inline align="center" gap="xs">
				<Button
					variant="outline"
					disabled={scrubDay === null || currentDay === todayOffset}
					onclick={() => (scrubDay = null)}
				>
					<Icon name="lucide:calendar-clock" class="size-3.5" />
					{t('timeline.jump_today')}
				</Button>
				{#if onInspectBim && snapshot.activeBimIds.length > 0}
					<Button
						variant="secondary"
						onclick={() => onInspectBim?.(snapshot.activeBimIds, currentIso)}
					>
						<Icon name="lucide:box" class="size-3.5" />
						{t('timeline.highlight_bim_active', { count: snapshot.activeBimIds.length })}
					</Button>
				{/if}
			</Inline>
		</Inline>

		<div class="pt-1">
			<input
				type="range"
				min="0"
				max={totalDays}
				step="1"
				aria-label={t('timeline.scrubber_label')}
				value={currentDay}
				oninput={(event) => (scrubDay = Number(event.currentTarget.value))}
				class="accent-primary h-2 w-full cursor-pointer"
			/>
			<Inline justify="between" class="pt-1 text-micro tabular-nums text-muted-foreground">
				<span>{toIso(bounds.start)}</span>
				<span>{t('timeline.scrub_hint')}</span>
				<span>{toIso(bounds.end)}</span>
			</Inline>
		</div>

		<Grid minimum="compact" class="border-t border-border pt-3 text-sm">
			<Stack gap="xs">
				<span class="text-meta">{t('timeline.active_on_date')}</span>
				<span class="font-medium tabular-nums">{snapshot.active}</span>
			</Stack>
			<Stack gap="xs">
				<span class="text-meta">{t('timeline.planned_complete')}</span>
				<span class="font-medium tabular-nums"
					>{t('timeline.ratio_pair', { done: snapshot.plannedComplete, total: tasks.length })}</span
				>
			</Stack>
			<Stack gap="xs">
				<span class="text-meta">{t('timeline.milestones_hit')}</span>
				<span class="font-medium tabular-nums"
					>{t('timeline.ratio_pair', {
						done: snapshot.milestonesHit,
						total: snapshot.totalMilestones
					})}</span
				>
			</Stack>
			<Stack gap="xs">
				<span class="text-meta">{t('timeline.updates_logged')}</span>
				<span class="font-medium tabular-nums">{snapshot.loggedUpdates}</span>
			</Stack>
			<Stack gap="xs">
				<span class="text-meta">{t('timeline.approved_eot')}</span>
				<span class="font-medium tabular-nums"
					>{t('timeline.eot_short', { days: snapshot.eotDays })}</span
				>
			</Stack>
		</Grid>
	</Stack>

	{#if tasks.length === 0}
		<EmptyState
			variant="card"
			icon="file"
			title={t('timeline.empty_title')}
			hint={t('timeline.empty_hint')}
		/>
	{:else}
		<Scroll
			axis="x"
			name={t('timeline.programme_axis')}
			class="rounded-lg border border-border bg-card"
		>
			<div class="min-w-[44rem] p-4">
				<!-- Month axis header -->
				<div class="grid grid-cols-[15rem_1fr] items-end gap-4 border-b border-border pb-2">
					<span class="text-overline">{t('timeline.work_package')}</span>
					<div class="relative h-6">
						{#each monthTicks as tick (tick.label + tick.pct)}
							<span
								class="absolute bottom-0 -translate-x-1/2 text-micro tabular-nums text-muted-foreground"
								style={`left: ${tick.pct}%`}
							>
								{tick.label}
							</span>
						{/each}
					</div>
				</div>

				<!-- Change-order / VO markers row -->
				{#if changeMarkers.length > 0}
					<div class="grid grid-cols-[15rem_1fr] items-center gap-4 border-b border-border/70 py-2">
						<span class="text-micro text-muted-foreground">{t('timeline.change_markers')}</span>
						<div class="relative h-6">
							<div
								class="pointer-events-none absolute inset-y-0 w-px bg-primary/80"
								style={`left: ${scrubPct}%`}
							></div>
							{#each changeMarkers as vo (vo.id)}
								<button
									type="button"
									title={`${vo.change_number ?? ''} ${vo.title} (${vo.effective_date})`}
									class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-opacity {vo.passed
										? 'border-amber-500/80 bg-amber-500/20 text-foreground'
										: 'border-border bg-muted text-muted-foreground opacity-70'}"
									style={`left: ${vo.pct}%`}
									onclick={() => open_record('change_orders', vo.id)}
								>
									{vo.change_number ?? t('timeline.vo_fallback')}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Task Gantt rows -->
				<Stack gap="none" divided>
					{#each tasks as task (task.id)}
						{@const pos = task.schedule_range?.from
							? positionOf(task.schedule_range.from, task.schedule_range.to)
							: null}
						{@const actualPct = Math.round(toNumber(task.progress_pct))}
						{@const plannedPct = pos ? plannedPctAt(pos.startMs, pos.endMs, currentMs) : 0}
						{@const behind = plannedPct - actualPct >= 15 && task.status !== 'done'}
						<div class="grid grid-cols-[15rem_1fr] items-center gap-4 py-2.5">
							<button
								type="button"
								class="min-w-0 text-left hover:underline"
								onclick={() => open_record('tasks', task.id)}
							>
								<span class="block truncate text-sm font-medium text-foreground">
									{#if task.is_milestone}
										<Icon name="lucide:diamond" class="mr-1 inline size-3 text-amber-500" />
									{/if}
									{#if task.task_code}{`${task.task_code} · `}{/if}{task.title}
								</span>
								<Inline gap="xs" class="text-micro text-muted-foreground">
									{#if task.is_milestone}
										<span class="text-amber-600 dark:text-amber-400"
											>{t('timeline.milestone_badge')}</span
										>
										<span aria-hidden="true">·</span>
									{/if}
									{#if task.trade}<span>{task.trade}</span><span aria-hidden="true">·</span>{/if}
									<span class="tabular-nums">{actualPct}%</span>
									{#if behind}
										<span class="text-destructive"
											>{t('timeline.behind_plan', { planned: plannedPct })}</span
										>
									{/if}
								</Inline>
							</button>

							<div class="relative h-7">
								<!-- Month gridlines -->
								{#each monthTicks as tick (tick.label + tick.pct)}
									<div
										class="pointer-events-none absolute inset-y-0 w-px bg-border/40"
										style={`left: ${tick.pct}%`}
									></div>
								{/each}
								<!-- Today line -->
								<div
									class="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-muted-foreground/50"
									style={`left: ${todayPct}%`}
								></div>
								<!-- Active scrubber cursor -->
								<div
									class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-primary"
									style={`left: ${scrubPct}%`}
								></div>

								{#if pos}
									{#if task.is_milestone}
										<button
											type="button"
											title={`${task.title} (${task.schedule_range?.from ?? ''})`}
											class="absolute top-1/2 z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 transition-transform hover:scale-125 {task.status ===
											'done'
												? 'border-emerald-600 bg-emerald-500'
												: 'border-amber-600 bg-amber-400'}"
											style={`left: ${pos.left}%`}
											onclick={() => open_record('tasks', task.id)}
										></button>
									{:else}
										<button
											type="button"
											class="absolute top-1 h-5 overflow-hidden rounded border text-left transition-colors hover:brightness-95 {barTone(
												task.status
											)}"
											style={`left: ${pos.left}%; width: ${pos.width}%`}
											onclick={() => open_record('tasks', task.id)}
										>
											<div
												class="h-full {fillTone(task.status)}"
												style={`width: ${actualPct}%`}
											></div>
										</button>
									{/if}
								{:else}
									<span class="text-micro text-muted-foreground">{t('timeline.unscheduled')}</span>
								{/if}
							</div>
						</div>
					{/each}
				</Stack>
			</div>
		</Scroll>
	{/if}
</Stack>
