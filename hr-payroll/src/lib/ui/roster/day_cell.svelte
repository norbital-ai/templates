<!--
	One person-day, drawn the same on the controller's board (`dense`) and the employee's calendar.
	The text is the plan (shift, leave, holiday) over the clock; overtime and incentive are the planned
	extras. The fill says the state: muted outside employment, tinted for a holiday or leave, dashed
	while pending, destructive for a reviewed day with nothing worked; a padlock marks a payslip's day.
-->
<script lang="ts">
	import { t } from '../i18n/t.js';
	import { cn, Icon } from '@norbital-ai/ui';
	import { Imposter, Stack } from '@norbital-ai/ui/layout';
	import { clockWindow, hoursLabel, workedMinutes, type Day } from './month_board.js';

	let { day, timeZone, dense = false }: { day: Day; timeZone: string; dense?: boolean } = $props();

	const minutes = $derived(day.intervals == null ? null : workedMinutes(day.intervals));
	const absent = $derived(day.intervals?.length === 0);
	const open = $derived(day.intervals != null && day.intervals.length > 0 && minutes == null);
	const plan = $derived(
		day.leave != null
			? `${day.leave.code || t('roster.leave')}${day.leave.half ? ' ½' : ''}`
			: (day.shift ?? (day.holiday != null ? t('roster.public_holiday_mark') : '—'))
	);
	const clock = $derived(
		day.intervals == null || day.intervals.length === 0 ? '' : clockWindow(day.intervals, timeZone)
	);
	const extra = $derived(
		[day.overtime, day.incentive].some((hours) => hours != null && hours > 0)
			? `+${(day.overtime ?? 0) + (day.incentive ?? 0)}h`
			: ''
	);
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
		day.pending && 'outline-1 outline-dashed outline-offset-[-2px] outline-brand/40',
		absent && 'bg-destructive/15 text-destructive',
		day.locked && 'border-l-2 border-l-brand'
	)}
>
	{#if day.employed}
		<span class={cn('block truncate text-xs leading-4', !dense && 'font-medium')}>{plan}</span>
		{#if !dense && day.holiday != null}
			<span class="block truncate text-micro leading-3 text-muted-foreground">{day.holiday}</span>
		{/if}
		<span class="block truncate text-micro leading-3 text-muted-foreground">
			{absent ? t('roster.absent') : clock}
		</span>
		<span
			class={cn(
				'block truncate text-micro leading-3',
				open ? 'text-warning' : 'text-muted-foreground',
				extra !== '' && 'font-medium text-brand'
			)}
		>
			{open
				? t('roster.open_punch')
				: minutes != null && minutes > 0
					? hoursLabel(minutes)
					: ''}{extra === '' ? '' : ` ${extra}`}
		</span>
		{#if day.locked}
			<Imposter as="span" placement="top-end" layer="under" aria-hidden="true">
				<Icon name="lucide:lock-keyhole" class="size-3 text-brand" />
			</Imposter>
		{/if}
	{/if}
</Stack>
