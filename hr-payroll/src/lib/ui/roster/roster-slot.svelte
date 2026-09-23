<!--
	One person-day, drawn the same way on the controller's board and the employee's calendar.

	A slot is one of nine states (`slotState`) and carries one fill (`slotFill`). The text is the
	PLAN: the shift code and, when the day carries them, its planned overtime and incentive hours
	(`+2h OT · +1h inc`) — entries keyed on the day with the shift, never derived from the clock.
	The fill is ATTENDANCE, a presence check against that plan: a bar along the bottom to the share
	of the planned hours the clock covered. A full green bar is present, a bar that stops short is a
	partial day, a moving bar is a clock still running, and the destructive fill is a reviewed work
	day nobody clocked. Clock time past the plan is not drawn: it is not overtime and it is not
	paid. Every state also says itself in the accessible name, so nothing here depends on colour
	alone.

	`dense` is the board: two lines in a 36px cell — the code, then the planned overtime or, when
	none is planned, the presence cue. Otherwise the calendar tile, with room for the date, the punch
	window and the presence.
-->
<script lang="ts">
	import { cn } from '@norbital-ai/ui/utils';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import {
		halfHoursLabel,
		plannedExtraLabel,
		punchTimeCue,
		slotCode,
		slotFill,
		slotState,
		type DayFacts,
		type SlotState
	} from './roster-month.js';

	let { day, dense = true }: { day: DayFacts | undefined; dense?: boolean } = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const state = $derived(slotState(day));
	const fill = $derived(slotFill(day));
	const code = $derived(slotCode(day, dense));
	/** The overtime and incentive hours planned on the day, `+2h OT · +1h inc`, or null when none. */
	const plannedOvertime = $derived(plannedExtraLabel(day));

	/**
	 * The state's tint. Work is the plain card; everything that is not work is quieter, and a
	 * planned extra day is the only heavier weight. Leave carries its own tint so a month reads as
	 * work / rest / away at a glance; a pending request is the same tint, dashed.
	 */
	const STATE_CLASS: Record<SlotState, string> = {
		EMPTY: 'bg-muted/20 text-muted-foreground/40',
		UNROSTERED: 'text-muted-foreground/60',
		REST: 'bg-muted/60 text-muted-foreground',
		OFF: 'bg-muted/60 text-muted-foreground',
		LEAVE: 'bg-brand/10 text-foreground',
		HALF_LEAVE: 'bg-brand/10 text-foreground',
		PENDING_LEAVE:
			'bg-brand/5 text-muted-foreground outline-1 outline-dashed outline-offset-[-2px] outline-brand/40',
		WORK: 'text-foreground',
		EXTRA_WORK: 'font-semibold text-foreground'
	};
	const stateLabelKey: Record<SlotState, TenantI18nKeys> = {
		EMPTY: 'roster.before_employment',
		UNROSTERED: 'roster.unrostered',
		REST: 'roster.rest_day',
		OFF: 'roster.off_day',
		LEAVE: 'roster.leave',
		HALF_LEAVE: 'roster.half_day',
		PENDING_LEAVE: 'roster.pending_leave',
		WORK: 'roster.planned',
		EXTRA_WORK: 'roster.planned'
	};
	/**
	 * Presence against the plan, in words: attended, partial (short of shift plus planned overtime),
	 * absent, or a clock still running. Null when attendance has nothing to say yet.
	 */
	const presence = $derived(
		fill.kind === 'AWOL'
			? t('roster.absent')
			: fill.kind === 'OPEN'
				? t('roster.open_punch')
				: fill.kind === 'CLOCKED'
					? fill.short
						? t('roster.partial_attendance')
						: t('roster.attended')
					: null
	);
	/**
	 * The dense cell's presence cue: `✓`, the shortfall to the half hour, or the open punch. A plan
	 * alone prints nothing under its code.
	 */
	const cue = $derived(
		fill.kind === 'AWOL'
			? t('roster.absent')
			: fill.kind === 'CLOCKED'
				? fill.short
					? `−${halfHoursLabel(fill.shortMinutes)}`
					: '✓'
				: fill.kind === 'OPEN'
					? (punchTimeCue(day) ?? '')
					: ''
	);
</script>

<div
	class={cn(
		'relative grid h-full w-full content-center overflow-hidden rounded-sm text-center tabular-nums',
		STATE_CLASS[state],
		fill.kind === 'AWOL' && 'bg-destructive/20 font-semibold text-destructive',
		dense ? 'px-0.5' : 'px-2 py-1.5 text-left'
	)}
	data-slot-state={state}
	data-slot-fill={fill.kind}
	aria-label={[t(stateLabelKey[state]), plannedOvertime, presence]
		.filter((part) => part != null)
		.join(' · ')}
>
	{#if dense}
		<span class="block truncate text-xs leading-4">{code}</span>
		<span
			class={cn(
				'block truncate text-[0.625rem] leading-3',
				fill.kind === 'NONE' && plannedOvertime == null
					? 'text-muted-foreground/70'
					: 'text-foreground',
				plannedOvertime != null && 'font-medium text-brand',
				fill.kind === 'CLOCKED' && fill.short && 'text-warning',
				fill.kind === 'AWOL' && 'text-destructive'
			)}
			data-slot-planned-ot={plannedOvertime}
		>
			{plannedOvertime ?? cue}
		</span>
	{:else}
		<span class="block truncate text-xs leading-4 font-medium">
			{code}{plannedOvertime == null ? '' : ` ${plannedOvertime}`}
		</span>
		{#if (state === 'WORK' || state === 'EXTRA_WORK') && day?.shiftStart != null && day.shiftEnd != null}
			<!-- The tile has the room the board does not: the window in full, not `8a–6p`. -->
			<span class="block truncate text-micro leading-3 opacity-80">
				{day.shiftStart.slice(0, 5)}–{day.shiftEnd.slice(0, 5)}
			</span>
		{/if}
		{#if fill.kind === 'CLOCKED'}
			<span class="block truncate text-micro leading-4 tabular-nums">
				{fill.first}–{fill.last}
			</span>
			<span class={cn('block truncate text-micro leading-3', fill.short && 'text-warning')}>
				{presence}{fill.short ? ` −${halfHoursLabel(fill.shortMinutes)}` : ''}
			</span>
		{:else if fill.kind === 'OPEN'}
			<span class="block truncate text-micro leading-4 tabular-nums">{fill.since}</span>
			<span class="block truncate text-micro leading-3">{t('roster.attendance_open')}</span>
		{:else if fill.kind === 'AWOL'}
			<span class="block truncate text-micro leading-4">{t('roster.absent')}</span>
		{/if}
	{/if}

	<!--
		THE FILL BAR. One track along the bottom of the slot; the bar is the share of the plan — shift
		plus planned overtime — the clock covered. Nothing is drawn past it: time beyond the plan is
		not overtime. An open clock is an indeterminate stripe. Each segment is its own literal class
		so Tailwind keeps it.
	-->
	{#if fill.kind === 'CLOCKED'}
		<span
			class={cn(
				'absolute inset-x-0 bottom-0 h-1 rounded-b-sm',
				dense ? 'bg-foreground/10' : 'h-1.5 bg-foreground/10'
			)}
			aria-hidden="true"
		>
			<span
				class={cn(
					'absolute inset-y-0 left-0 rounded-bl-sm',
					fill.short ? 'bg-warning' : 'bg-success'
				)}
				style={`width:${Math.round(fill.ratio * 100)}%`}
			></span>
		</span>
	{:else if fill.kind === 'OPEN'}
		<span
			class="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-sm bg-warning/25"
			aria-hidden="true"
		>
			<span class="absolute inset-y-0 w-1/3 animate-pulse bg-warning"></span>
		</span>
	{/if}
</div>
