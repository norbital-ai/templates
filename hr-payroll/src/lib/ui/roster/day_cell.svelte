<!--
	One person-day on the controller's board. The label is the planned shift (with planned overtime),
	or the projected one in muted text until a shift is planned; leave and holidays tag it, a thin bar
	along the foot is the time credited against the plan, and a corner padlock marks a payslip's day.
	The fill says the state: muted outside employment, tinted for a holiday or leave, destructive for a
	reviewed day with nothing worked. The board's button title carries every detail in words.
-->
<script lang="ts">
	import { bolt } from '$bolt';
	import { cn, Icon } from '@norbital-ai/ui';
	import { Imposter, Inline, Stack } from '@norbital-ai/ui/layout';
	import { hoursLabel, isAbsent, workedMinutes, type Day } from './month_board.js';

	let { day }: { day: Day } = $props();

	const minutes = $derived(day.intervals == null ? null : workedMinutes(day.intervals));
	const absent = $derived(isAbsent(day));
	const open = $derived(day.intervals != null && day.intervals.length > 0 && minutes == null);
	const leaveLabel = $derived(
		day.leave == null
			? ''
			: `${day.leave.code || bolt.t('roster.leave')}${day.leave.half ? ' ½' : ''}`
	);
	const projected = $derived(
		day.projectedShift ??
			(leaveLabel || (day.holiday != null ? bolt.t('roster.public_holiday_mark') : ''))
	);
	const tag = $derived(
		day.shift == null && day.projectedShift == null
			? day.leave != null && day.holiday != null
				? bolt.t('roster.public_holiday_mark')
				: ''
			: [leaveLabel, day.holiday == null ? '' : bolt.t('roster.public_holiday_mark')]
					.filter(Boolean)
					.join(' · ')
	);
	const plannedExtra = $derived(
		day.plannedOvertime != null && day.plannedOvertime > 0
			? `+${hoursLabel(day.plannedOvertime * 60)}`
			: ''
	);
	const percent = $derived(
		day.completion?.percent == null ? null : Math.floor(day.completion.percent)
	);
	const progressName = $derived(
		bolt.t(day.shiftId == null ? 'roster.projected_progress' : 'roster.actual_progress')
	);
	const progressText = $derived(
		day.completion?.percent == null
			? ''
			: `${progressName}: ${bolt.t('roster.completion_details', {
					percent: percent ?? 0,
					credited: hoursLabel(day.completion.credited_hours * 60),
					target: hoursLabel(day.completion.target_hours * 60)
				})}`
	);
	const credits = $derived.by(() => {
		const completion = day.completion;
		if (completion == null || completion.target_hours <= 0) return [];
		return completion.segments.flatMap((segment) =>
			segment.credited_intervals.map((interval) => ({
				left:
					(100 * (segment.offset_hours + (interval.start - segment.start) / 3_600_000)) /
					completion.target_hours,
				width: (100 * (interval.end - interval.start)) / 3_600_000 / completion.target_hours
			}))
		);
	});
</script>

<Stack
	gap="none"
	justify="center"
	size="fill"
	class={cn(
		'relative rounded-sm px-1 pt-0.5 pb-1.5 text-center tabular-nums',
		!day.employed && 'bg-muted/20 text-muted-foreground/40',
		day.employed && day.holiday != null && 'bg-warning/10',
		day.employed && day.leave != null && 'bg-brand/10',
		absent && 'bg-destructive/15 text-destructive'
	)}
>
	{#if day.employed}
		{#if day.shift != null}
			<Inline
				data-work-layer="planned"
				gap="xs"
				justify="center"
				class="min-w-0 text-sm leading-5 font-medium"
			>
				<span class="truncate">{day.shift}</span>
				{#if plannedExtra !== ''}
					<span class="shrink-0 text-micro font-normal text-muted-foreground">{plannedExtra}</span>
				{/if}
			</Inline>
			{#if day.projectedShift != null && day.projectedShift !== day.shift}
				<span
					data-work-layer="projected"
					class="truncate text-micro leading-3 text-muted-foreground line-through"
					>{day.projectedShift}</span
				>
			{/if}
		{:else if projected !== ''}
			<span data-work-layer="projected" class="truncate text-sm leading-5 text-muted-foreground"
				>{projected}</span
			>
		{/if}
		{#if tag !== ''}
			<span class="truncate text-micro leading-3 text-muted-foreground">{tag}</span>
		{/if}
		{#if percent != null}
			<!-- a thin bar along the cell's foot: the credited time over the plan; the cell's title has the detail -->
			<Imposter
				as="span"
				data-work-layer="actual"
				placement="bottom"
				layer="under"
				class="px-1 pb-1"
			>
				<svg
					class="block h-1 w-full"
					viewBox="0 0 100 4"
					preserveAspectRatio="none"
					role="progressbar"
					aria-label={progressName}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={percent}
					aria-valuetext={progressText}
				>
					<rect x={0} y={0} width={100} height={4} rx={2} class="fill-muted-foreground/20" />
					{#each credits as credit}
						<rect
							data-credit-interval
							x={credit.left}
							y={0}
							width={credit.width}
							height={4}
							class="fill-primary"
						/>
					{/each}
				</svg>
				<span class="sr-only">{percent}%</span>
			</Imposter>
		{:else if open}
			<span
				data-work-layer="actual"
				class="text-micro leading-3 text-warning"
				aria-label={bolt.t('roster.open_punch')}>{bolt.t('roster.progress_open')}</span
			>
		{/if}
		{#if day.locked}
			<Imposter as="span" placement="top-end" offset="none" layer="under" class="p-0.5">
				<Icon name="lucide:lock-keyhole" class="size-2.5 text-muted-foreground" />
			</Imposter>
		{/if}
	{/if}
</Stack>
