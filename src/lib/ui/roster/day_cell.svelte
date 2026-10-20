<!--
	One person-day, drawn the same on the controller's board (`dense`) and the employee's calendar.
	The text is the plan (shift, leave, holiday) over the clock; overtime is the planned
	extra. The fill says the state: muted outside employment, tinted for a holiday or leave, dashed
	while pending, destructive for a reviewed day with nothing worked; a padlock marks a payslip's day.
-->
<script lang="ts">
	import { t } from '../i18n/t.js';
	import { cn, Icon } from '@norbital-ai/ui';
	import { Bound, Imposter, Inline, Stack } from '@norbital-ai/ui/layout';
	import { hoursLabel, isAbsent, workedMinutes, type Day } from './month_board.js';

	let { day, dense = false }: { day: Day; dense?: boolean } = $props();

	const minutes = $derived(day.intervals == null ? null : workedMinutes(day.intervals));
	const absent = $derived(isAbsent(day));
	const open = $derived(day.intervals != null && day.intervals.length > 0 && minutes == null);
	const projected = $derived(
		day.projectedShift ??
			(day.leave != null
				? `${day.leave.code || t('roster.leave')}${day.leave.half ? ' ½' : ''}`
				: day.holiday != null
					? t('roster.public_holiday_mark')
					: '—')
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
		t(day.shiftId == null ? 'roster.projected_progress' : 'roster.actual_progress')
	);
	const progressText = $derived(
		day.completion?.percent == null
			? ''
			: `${progressName}: ${t('roster.completion_details', {
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
	fill
	class={cn(
		'relative rounded-sm tabular-nums',
		dense ? 'px-0.5 text-center' : 'px-2 py-1 text-left',
		!day.employed && 'bg-muted/20 text-muted-foreground/40',
		day.employed && day.holiday != null && 'bg-warning/10',
		day.employed && day.leave != null && 'bg-brand/10',
		absent && 'bg-destructive/15 text-destructive',
		day.locked && 'border-l-2 border-l-brand'
	)}
>
	{#if day.employed}
		<Inline
			data-work-layer="projected"
			gap="xs"
			justify={dense ? 'center' : 'start'}
			class="min-w-0 text-micro leading-3 text-muted-foreground"
		>
			<span class="truncate">{projected}</span>
			{#if day.projectedShift != null && day.leave != null}
				<span class="truncate"
					>{day.leave.code || t('roster.leave')}{day.leave.half ? ' ½' : ''}</span
				>
			{/if}
			{#if day.holiday != null && (day.projectedShift != null || day.leave != null)}
				<span class="shrink-0 text-tiny">{t('roster.public_holiday_mark')}</span>
			{/if}
		</Inline>
		{#if !dense && day.holiday != null}
			<span class="block truncate text-micro leading-3 text-muted-foreground">{day.holiday}</span>
		{/if}
		<Inline
			data-work-layer="planned"
			gap="xs"
			justify={dense ? 'center' : 'start'}
			class="min-w-0 text-xs leading-4"
		>
			<span class="truncate">{day.shift ?? '—'}</span>
			{#if plannedExtra !== ''}<span class="shrink-0 text-micro">{plannedExtra}</span>{/if}
		</Inline>
		<Inline
			data-work-layer="actual"
			gap="xs"
			justify={dense ? 'center' : 'start'}
			class="min-w-0 text-micro leading-3"
		>
			{#if percent != null}
				<Bound grow>
					<svg
						class="h-2 w-full"
						viewBox="0 0 100 8"
						preserveAspectRatio="none"
						role="progressbar"
						aria-label={progressName}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={percent}
						aria-valuetext={progressText}
					>
						<rect x={0} y={0} width={100} height={8} rx={3} class="fill-secondary" />
						{#each credits as credit}
							<rect
								data-credit-interval
								x={credit.left}
								y={0}
								width={credit.width}
								height={8}
								class="fill-primary"
							/>
						{/each}
					</svg>
				</Bound>
				<span class="shrink-0 text-tiny tabular-nums" title={progressText}>{percent}%</span>
			{:else}
				<span
					class="text-muted-foreground"
					aria-label={open ? t('roster.open_punch') : t('roster.progress_unknown')}
				>
					{open ? t('roster.progress_open') : '—'}
				</span>
			{/if}
		</Inline>
		{#if day.locked}
			<Imposter as="span" placement="top-end" layer="under" aria-hidden="true">
				<Icon name="lucide:lock-keyhole" class="size-3 text-brand" />
			</Imposter>
		{/if}
	{/if}
</Stack>
