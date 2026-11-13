<!--
	One person-day on the controller's board. The planned shift, its overtime, leave and holidays sit
	in one cell; a thin bar along the foot is the time worked against the plan. Colours say the state:
	muted outside employment, crossed once they have left, warning for leave/holiday, destructive for a
	due day with no attendance.
-->
<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { cn, Icon } from '@norbital-ai/ui';
	import { Imposter, Inline, Stack } from '@norbital-ai/ui/layout';
	import { hoursLabel, isAbsent, isUnrecorded, type Day } from './month_board.js';

	let { ctx, day }: { ctx: PageContext; day: Day } = $props();

	const open = $derived(day.intervals?.some((interval) => interval.end == null) ?? false);
	const absent = $derived(isAbsent(day));
	const unrecorded = $derived(isUnrecorded(day));
	const leaveLabel = $derived(
		day.leave == null ? '' : `${day.leave.label}${day.leave.half ? ' ½' : ''}`
	);
	const plannedExtra = $derived(
		day.plannedOvertimeMinutes > 0 ? `+${hoursLabel(day.plannedOvertimeMinutes)}` : ''
	);
	const tag = $derived(
		day.shift == null && day.projectedShift == null
			? day.leave != null && day.holiday != null
				? ctx.t('roster.public_holiday_mark')
				: ''
			: [leaveLabel, day.holiday == null ? '' : ctx.t('roster.public_holiday_mark')]
					.filter(Boolean)
					.join(' · ')
	);
	const warning = $derived(day.findings.join('\n'));
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
	{#if day.left != null}
		<Imposter placement="fill">
			<svg
				aria-hidden="true"
				class="size-full text-destructive/50"
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
			>
				<path
					d="M0 0 100 100M100 0 0 100"
					stroke="currentColor"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
		</Imposter>
	{:else if !day.employed}
		<span aria-hidden="true" class="h-px w-3/4 self-center bg-muted-foreground/40"></span>
	{:else}
		{#if day.shift != null}
			<Inline gap="xs" justify="center" class="min-w-0 text-xs leading-5 font-medium sm:text-sm">
				<span class="truncate">{day.shift}</span>
				{#if plannedExtra !== ''}
					<span class="shrink-0 text-micro font-normal text-muted-foreground">{plannedExtra}</span>
				{/if}
			</Inline>
		{:else if day.projectedShift != null}
			<span class="truncate text-xs leading-5 text-muted-foreground sm:text-sm"
				>{day.projectedShift}</span
			>
		{:else if day.leave != null}
			<span class="truncate text-micro leading-5 text-muted-foreground">{leaveLabel}</span>
		{:else if day.holiday != null}
			<span class="truncate text-micro leading-5 text-muted-foreground"
				>{ctx.t('roster.public_holiday_mark')}</span
			>
		{/if}
		{#if tag !== ''}
			<span class="truncate text-micro leading-3 text-muted-foreground">{tag}</span>
		{/if}
		{#if unrecorded}
			<span class="text-micro text-destructive">{ctx.t('roster.attendance_missing')}</span>
		{:else if absent}
			<span class="text-micro text-destructive">{ctx.t('roster.layer_awol')}</span>
		{:else if day.percent != null && day.percent < 100}
			<span class="text-micro text-warning">{day.percent}%</span>
		{/if}
		{#if day.percent != null}
			<span
				class="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-muted-foreground/20"
				role="progressbar"
				aria-label={ctx.t('roster.actual_progress')}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={day.percent}
			>
				<span
					class={cn(
						'block h-full rounded-full',
						day.shiftId == null ? 'bg-muted-foreground/40' : 'bg-primary'
					)}
					style:width={`${day.percent}%`}
				></span>
			</span>
		{:else if open}
			<span class="text-micro leading-3 text-warning">{ctx.t('roster.progress_open')}</span>
		{/if}
		{#if day.findings.length > 0}
			<Imposter as="span" placement="top-start" offset="none" layer="under" class="p-0.5">
				<Icon name="lucide:triangle-alert" class="size-2.5 text-warning" />
			</Imposter>
		{/if}
		{#if day.locked}
			<Imposter as="span" placement="top-end" offset="none" layer="under" class="p-0.5">
				<Icon name="lucide:lock-keyhole" class="size-2.5 text-muted-foreground" />
			</Imposter>
		{/if}
	{/if}
</Stack>
