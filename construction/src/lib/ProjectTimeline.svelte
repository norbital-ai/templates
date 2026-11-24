<!-- @component Interactive 4D construction programme timeline with date-axis scrubber, Gantt work packages, milestone diamonds, EOT/variation markers, and BIM highlights. -->
<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		EmptyState,
		Icon,
		Surface,
		enum_text,
		open_record
	} from '@norbital-ai/ui';
	import { create_slider, register_control } from '@norbital-ai/ui/behaviors';
	import { Cluster, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { DateTime, Option } from 'effect';
	import { toNumber, type DecimalLike } from './commercial.js';
	import { addCalendarDays, diffCalendarDays, parseIsoDate } from './dates.js';

	type TimelineTask = {
		readonly id: string;
		readonly task_code: string | null;
		readonly title: string;
		readonly trade_specialty: string | null;
		readonly is_milestone?: boolean | null;
		readonly status: string;
		readonly priority: string;
		readonly progress_pct: DecimalLike;
		readonly schedule_range: { readonly from: string; readonly to: string | null } | null;
		readonly bim_express_ids: readonly number[] | null;
	};

	type TimelineVariation = {
		readonly id: string;
		readonly contract_number: string | null;
		readonly title: string;
		readonly status: string;
		readonly schedule_impact_days: number | null;
		readonly signed_date: string | null;
	};

	let {
		ctx,
		projectRange,
		tasks,
		variations,
		today,
		onInspectBim
	}: {
		ctx: PageContext;
		projectRange: { readonly from: string; readonly to: string | null } | null;
		tasks: readonly TimelineTask[];
		variations: readonly TimelineVariation[];
		today: string;
		onInspectBim?: (expressIds: readonly number[], label: string) => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

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
		for (const vo of variations) {
			pushDate(vo.signed_date);
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

	const positionOf = (from: string, to: string | null) => {
		const sDay = diffCalendarDays(bounds.startIso, from);
		const eDay = to ? Math.max(diffCalendarDays(bounds.startIso, to), sDay + 1) : sDay + 14;
		const left = Math.max(0, Math.min(100, (sDay / totalDays) * 100));
		const right = Math.max(left + 1.5, Math.min(100, (eDay / totalDays) * 100));
		return { left, width: Math.max(1.5, right - left), startDay: sDay, endDay: eDay };
	};

	const plannedPctAt = (startDay: number, endDay: number, atDay: number): number => {
		if (atDay <= startDay) return 0;
		if (atDay >= endDay) return 100;
		return Math.round(((atDay - startDay) / Math.max(1, endDay - startDay)) * 100);
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
			const from = parseIsoDate(task.schedule_range?.from);
			if (!from) continue;
			const to =
				parseIsoDate(task.schedule_range?.to) ?? addCalendarDays(from, task.is_milestone ? 0 : 14);
			if (currentIso >= from && currentIso <= to) {
				active += 1;
				for (const id of task.bim_express_ids ?? []) activeBimIds.add(id);
			} else if (currentIso > to) {
				plannedComplete += 1;
			}
		}
		const eotDays = variations
			.filter(
				(vo) =>
					(vo.status === 'active' || vo.status === 'completed') &&
					(vo.signed_date == null || vo.signed_date <= currentIso)
			)
			.reduce((sum, vo) => sum + (vo.schedule_impact_days ?? 0), 0);
		return {
			active,
			plannedComplete,
			milestonesHit,
			totalMilestones,
			eotDays,
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
				eot_days: snapshot.eotDays
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
				}
			}
		})
	);

	const changeMarkers = $derived(
		variations.flatMap((vo) => {
			const signed = parseIsoDate(vo.signed_date);
			if (!signed || signed < bounds.startIso || signed > bounds.endIso) return [];
			const offset = diffCalendarDays(bounds.startIso, signed);
			const pct = (offset / totalDays) * 100;
			return [{ ...vo, pct, passed: signed <= currentIso }];
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
</script>

<Stack gap="md">
	<Surface tone="card" padding="md" radius="control">
		<Stack gap="md">
			<Cluster align="center" justify="between" gap="sm">
				<Stack gap="xs">
					<p class="text-overline">{t('timeline.scrubber_label')}</p>
					<Inline align="center" gap="sm">
						<span class="text-heading tabular-nums">{currentIso}</span>
						{#if currentIso === today}
							<Badge variant="info">{t('timeline.today')}</Badge>
						{/if}
					</Inline>
				</Stack>
				<Cluster align="center" gap="xs">
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
				</Cluster>
			</Cluster>

			<Stack gap="xs">
				<div
					class="relative flex h-6 w-full cursor-pointer items-center"
					{@attach dateSlider.track}
				>
					<div class="h-1.5 w-full rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary"
							style={`width: ${dateSlider.percent}%`}
						></div>
					</div>
					<div
						class="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						style={`left: ${dateSlider.percent}%`}
						{...dateSlider.thumb_attrs()}
					></div>
				</div>
				<Cluster justify="between" gap="xs" class="text-micro tabular-nums text-muted-foreground">
					<span>{bounds.startIso}</span>
					<span>{t('timeline.scrub_hint')}</span>
					<span>{bounds.endIso}</span>
				</Cluster>
			</Stack>

			{#if snapshot.active > 0 || snapshot.plannedComplete > 0 || snapshot.totalMilestones > 0 || snapshot.eotDays !== 0}
				<Grid minimum="card" gap="md">
					{#if snapshot.active > 0}
						<Stack gap="xs">
							<span class="text-meta">{t('timeline.active_on_date')}</span>
							<span class="text-label tabular-nums">{snapshot.active}</span>
						</Stack>
					{/if}
					{#if snapshot.plannedComplete > 0}
						<Stack gap="xs">
							<span class="text-meta">{t('timeline.planned_complete')}</span>
							<span class="text-label tabular-nums">
								{t('timeline.ratio_pair', { done: snapshot.plannedComplete, total: tasks.length })}
							</span>
						</Stack>
					{/if}
					{#if snapshot.totalMilestones > 0}
						<Stack gap="xs">
							<span class="text-meta">{t('timeline.milestones_hit')}</span>
							<span class="text-label tabular-nums">
								{t('timeline.ratio_pair', {
									done: snapshot.milestonesHit,
									total: snapshot.totalMilestones
								})}
							</span>
						</Stack>
					{/if}
					{#if snapshot.eotDays !== 0}
						<Stack gap="xs">
							<span class="text-meta">{t('timeline.approved_eot')}</span>
							<span class="text-label tabular-nums">
								{t('timeline.eot_short', { days: snapshot.eotDays })}
							</span>
						</Stack>
					{/if}
				</Grid>
			{/if}
		</Stack>
	</Surface>

	{#if tasks.length === 0}
		<EmptyState
			variant="card"
			icon="file"
			title={t('timeline.empty_title')}
			hint={t('timeline.empty_hint')}
		/>
	{:else}
		<Surface tone="card" padding="md" radius="control">
			<Scroll axis="x" name={t('timeline.programme_axis')}>
				<Stack gap="sm" divided>
					<Grid tracks="15rem minmax(28rem, 1fr)" gap="md" align="end">
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
					</Grid>

					{#if changeMarkers.length > 0}
						<Grid tracks="15rem minmax(28rem, 1fr)" gap="md" align="center">
							<span class="text-micro text-muted-foreground">{t('timeline.change_markers')}</span>
							<div class="relative h-6">
								<div
									class="pointer-events-none absolute inset-y-0 w-px bg-primary"
									style={`left: ${scrubPct}%`}
								></div>
								{#each changeMarkers as vo (vo.id)}
									<button
										type="button"
										title={`${vo.contract_number ?? ''} ${vo.title} (${vo.signed_date})`}
										class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border px-1.5 py-0.5 text-micro {vo.passed
											? 'border-tone-warning-border bg-tone-warning-bg text-tone-warning-text'
											: 'border-border bg-muted text-muted-foreground'}"
										style={`left: ${vo.pct}%`}
										onclick={() => open_record('contracts', vo.id)}
									>
										{vo.contract_number ?? t('timeline.vo_fallback')}
									</button>
								{/each}
							</div>
						</Grid>
					{/if}

					{#each tasks as task (task.id)}
						{@const pos = task.schedule_range?.from
							? positionOf(task.schedule_range.from, task.schedule_range.to)
							: null}
						{@const actualPct = Math.round(toNumber(task.progress_pct))}
						{@const plannedPct = pos ? plannedPctAt(pos.startDay, pos.endDay, currentDay) : 0}
						{@const behind = plannedPct - actualPct >= 15 && task.status !== 'done'}
						{@const barLabel = `${task.task_code ? `${task.task_code} · ` : ''}${task.title} (${actualPct}%)`}
						<Grid tracks="15rem minmax(28rem, 1fr)" gap="md" align="center">
							<button
								type="button"
								class="min-w-0 text-left hover:underline"
								onclick={() => open_record('tasks', task.id)}
							>
								<Stack gap="xs">
									<Inline gap="xs" align="center">
										{#if task.is_milestone}
											<Icon name="lucide:diamond" class="size-3 text-tone-warning-text" />
										{/if}
										<span class="truncate text-label">
											{#if task.task_code}{`${task.task_code} · `}{/if}{task.title}
										</span>
									</Inline>
									<Inline gap="xs" class="text-micro text-muted-foreground">
										{#if task.is_milestone}
											<span class="text-tone-warning-text">{t('timeline.milestone_badge')}</span>
											<span aria-hidden="true">·</span>
										{/if}
										{#if task.trade_specialty}
											<span>
												{enum_text(task.trade_specialty, {
													t: rawT,
													model: 'tasks',
													field: 'trade_specialty'
												})}
											</span>
											<span aria-hidden="true">·</span>
										{/if}
										<span class="tabular-nums">{actualPct}%</span>
										{#if behind}
											<span class="text-destructive">
												{t('timeline.behind_plan', { planned: plannedPct })}
											</span>
										{/if}
									</Inline>
								</Stack>
							</button>

							<div class="relative h-7">
								{#each monthTicks as tick (tick.label + tick.pct)}
									<div
										class="pointer-events-none absolute inset-y-0 w-px bg-border"
										style={`left: ${tick.pct}%`}
									></div>
								{/each}
								<div
									class="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-muted-foreground"
									style={`left: ${todayPct}%`}
								></div>
								<div
									class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-primary"
									style={`left: ${scrubPct}%`}
								></div>

								{#if pos}
									{#if task.is_milestone}
										<button
											type="button"
											aria-label={barLabel}
											title={`${task.title} (${task.schedule_range?.from ?? ''})`}
											class="absolute top-1/2 z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-inset border-2 transition-transform hover:scale-125 {task.status ===
											'done'
												? 'border-tone-success-border bg-tone-success-text'
												: 'border-tone-warning-border bg-tone-warning-text'}"
											style={`left: ${pos.left}%`}
											onclick={() => open_record('tasks', task.id)}
										></button>
									{:else}
										<button
											type="button"
											aria-label={barLabel}
											class="absolute top-1 h-5 rounded-control border text-left transition-colors hover:brightness-95 {barTone(
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
									<span class="text-micro text-muted-foreground">{t('timeline.unscheduled')}</span>
								{/if}
							</div>
						</Grid>
					{/each}
				</Stack>
			</Scroll>
		</Surface>
	{/if}
</Stack>
