<!--
	One person-day, drawn the same way on the controller's board and the employee's calendar.

	A slot is one of nine states (`slotState`) and carries one fill (`slotFill`). The state is the
	tint and the code; the fill is a bar that runs along the bottom of the slot to the length of the
	shift and spills past it as the extra, so what the clock did is read against what was planned
	without a key: a full green bar is a day worked to plan, a bar that stops short is a short day,
	a bar with an overflow segment is a long one, a moving bar is a clock still running, and the
	destructive fill is a reviewed work day nobody clocked. The line under the code is the clock
	against the plan to the half hour: `+1h` over, `−0.5h` under, the hours themselves when it met
	the plan. Every state also says itself in the accessible name, so nothing here
	depends on colour alone.

	`dense` is the board: two lines in a 36px cell. Otherwise the calendar tile, with room for the
	date, the punch window and the hours.
-->
<script lang="ts">
	import { cn } from '@norbital-ai/ui/utils';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import {
		halfHoursLabel,
		punchTimeCue,
		signedHalfHoursLabel,
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
	 * The second line of a dense cell is the clock, and only the clock: what actually happened. A
	 * plan alone prints its code and nothing under it — thirty identical shift windows across a
	 * row say nothing the code does not, and the window is in the day sheet.
	 */
	const cue = $derived(
		fill.kind === 'AWOL'
			? t('roster.absent')
			: fill.kind === 'CLOCKED'
				? // Over or under the plan to the half hour, not the punch window: `8:21p–8:30p` does
					// not fit sixty pixels, `+0.5h` does, and the window is in the day sheet. To plan is
					// the hours themselves.
					Math.round(fill.deltaMinutes / 30) === 0
					? halfHoursLabel(fill.workedMinutes)
					: signedHalfHoursLabel(fill.deltaMinutes)
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
	aria-label={t(stateLabelKey[state])}
>
	{#if dense}
		<span class="block truncate text-xs leading-4">{code}</span>
		<span
			class={cn(
				'block truncate text-[0.625rem] leading-3',
				fill.kind === 'NONE' ? 'text-muted-foreground/70' : 'text-foreground',
				fill.kind === 'CLOCKED' && fill.short && 'text-warning',
				fill.kind === 'CLOCKED' && Math.round(fill.deltaMinutes / 30) > 0 && 'text-brand',
				fill.kind === 'AWOL' && 'text-destructive'
			)}
		>
			{cue}
		</span>
	{:else}
		<span class="block truncate text-xs leading-4 font-medium">
			{code}{state === 'EXTRA_WORK' ? ' · OT' : ''}
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
			<span class="block truncate text-micro leading-3 tabular-nums">
				{halfHoursLabel(fill.workedMinutes)}{Math.round(fill.deltaMinutes / 30) === 0
					? ''
					: ` (${signedHalfHoursLabel(fill.deltaMinutes)})`}
			</span>
		{:else if fill.kind === 'OPEN'}
			<span class="block truncate text-micro leading-4 tabular-nums">{fill.since}</span>
			<span class="block truncate text-micro leading-3">{t('roster.attendance_open')}</span>
		{:else if fill.kind === 'AWOL'}
			<span class="block truncate text-micro leading-4">{t('roster.absent')}</span>
		{/if}
	{/if}

	<!--
		THE FILL BAR. One track along the bottom of the slot; the bar is the worked share of the
		planned shift. The extra is drawn as a second segment overlaid from the right so the eye
		reads "full, and then some" rather than a bar that merely reaches the edge. An open clock
		is an indeterminate stripe. Each segment is its own literal class so Tailwind keeps it.
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
			{#if fill.extra > 0.005}
				<span
					class="absolute inset-y-0 right-0 rounded-br-sm bg-brand"
					style={`width:${Math.min(50, Math.round(fill.extra * 100))}%`}
				></span>
			{/if}
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
