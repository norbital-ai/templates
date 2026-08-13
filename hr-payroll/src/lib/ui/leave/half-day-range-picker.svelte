<script lang="ts" module>
	export type DayHalf = 'FIRST' | 'SECOND';
	export type HalfDayPoint = { readonly date: string; readonly half: DayHalf };
	export type HalfDayRange = { readonly start: HalfDayPoint; readonly end: HalfDayPoint };
	export type LeaveDayAvailability = {
		readonly eligible: boolean;
		readonly reason?: string;
	};
</script>

<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Button } from '@norbital-ai/ui/button';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import * as Popover from '@norbital-ai/ui/popover';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { cn } from '@norbital-ai/ui/utils';
	import { todayKey } from '../calendar.js';

	type Props = {
		value: HalfDayRange | null;
		availability?:
			Readonly<Record<string, LeaveDayAvailability>> | ((date: string) => LeaveDayAvailability);
		maximumHalfDays?: number | null;
		disabled?: boolean;
		onValueChange: (value: HalfDayRange) => void;
	};

	let {
		value,
		availability = {},
		maximumHalfDays = null,
		disabled = false,
		onValueChange
	}: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const DAY_MS = 86_400_000;
	const today = todayKey();
	let visibleMonth = $state(today.slice(0, 7));
	let open = $state(false);
	let anchor = $state<HalfDayPoint | null>(null);
	let dragging = $state(false);
	let ignoreNextClick = false;
	let limitReached = $state(false);

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (nextOpen) visibleMonth = (value?.start.date ?? today).slice(0, 7);
	}

	const weekdays = $derived([
		t('component.weekday_mon'),
		t('component.weekday_tue'),
		t('component.weekday_wed'),
		t('component.weekday_thu'),
		t('component.weekday_fri'),
		t('component.weekday_sat'),
		t('component.weekday_sun')
	]);

	function dayNumber(date: string): number {
		return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
	}

	function pointNumber(point: HalfDayPoint): number {
		return dayNumber(point.date) * 2 + (point.half === 'SECOND' ? 1 : 0);
	}

	function pointAt(number: number): HalfDayPoint {
		const day = Math.floor(number / 2);
		return {
			date: new Date(day * DAY_MS).toISOString().slice(0, 10),
			half: number % 2 === 0 ? 'FIRST' : 'SECOND'
		};
	}

	function ordered(a: HalfDayPoint, b: HalfDayPoint): HalfDayRange {
		return pointNumber(a) <= pointNumber(b) ? { start: a, end: b } : { start: b, end: a };
	}

	function isEligible(point: HalfDayPoint): boolean {
		return availabilityFor(point.date).eligible !== false;
	}

	function availabilityFor(date: string): LeaveDayAvailability {
		return typeof availability === 'function'
			? availability(date)
			: (availability[date] ?? { eligible: true });
	}

	function selected(range: HalfDayRange | null, point: HalfDayPoint): boolean {
		if (range == null || !isEligible(point)) return false;
		const number = pointNumber(point);
		return number >= pointNumber(range.start) && number <= pointNumber(range.end);
	}

	function chargeableHalfDays(range: HalfDayRange | null): number {
		if (range == null) return 0;
		let count = 0;
		for (let step = pointNumber(range.start); step <= pointNumber(range.end); step += 1) {
			if (isEligible(pointAt(step))) count += 1;
		}
		return count;
	}

	function apply(to: HalfDayPoint): void {
		if (disabled || !isEligible(to)) return;
		const next = ordered(anchor ?? to, to);
		const charge = chargeableHalfDays(next);
		if (maximumHalfDays != null && charge > maximumHalfDays) {
			limitReached = true;
			return;
		}
		limitReached = false;
		onValueChange(next);
	}

	function begin(point: HalfDayPoint): void {
		if (disabled || !isEligible(point)) return;
		ignoreNextClick = true;
		anchor = point;
		dragging = true;
		apply(point);
	}

	function finish(point: HalfDayPoint): void {
		if (!dragging) return;
		apply(point);
		dragging = false;
		anchor = null;
	}

	function clickPoint(point: HalfDayPoint): void {
		if (ignoreNextClick) {
			ignoreNextClick = false;
			return;
		}
		if (disabled || !isEligible(point)) return;
		if (anchor == null) {
			anchor = point;
			apply(point);
			return;
		}
		apply(point);
		anchor = null;
	}

	function addDays(date: string, amount: number): string {
		return new Date((dayNumber(date) + amount) * DAY_MS).toISOString().slice(0, 10);
	}

	function monthDays(month: string): string[] {
		const first = `${month}-01`;
		const weekday = new Date(`${first}T00:00:00.000Z`).getUTCDay();
		const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
		const gridStart = addDays(first, mondayOffset);
		return Array.from({ length: 42 }, (_unused, index) => addDays(gridStart, index));
	}

	function shiftMonth(amount: number): void {
		const date = new Date(`${visibleMonth}-01T00:00:00.000Z`);
		date.setUTCMonth(date.getUTCMonth() + amount);
		visibleMonth = date.toISOString().slice(0, 7);
	}

	const days = $derived(monthDays(visibleMonth));
	const monthLabel = $derived(
		new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
			new Date(`${visibleMonth}-01T00:00:00.000Z`)
		)
	);
	const chargeableDays = $derived(chargeableHalfDays(value) / 2);
	const excludedInside = $derived.by(() => {
		if (value == null) return 0;
		let count = 0;
		for (let day = dayNumber(value.start.date); day <= dayNumber(value.end.date); day += 1) {
			const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
			if (availabilityFor(date).eligible === false) count += 1;
		}
		return count;
	});

	function halfLabel(half: DayHalf): string {
		return half === 'FIRST' ? t('component.first_half') : t('component.second_half');
	}

	function pointLabel(point: HalfDayPoint): string {
		return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
			new Date(`${point.date}T00:00:00.000Z`)
		)}, ${halfLabel(point.half)}`;
	}

	const triggerLabel = $derived(
		value == null
			? t('component.leave_range')
			: `${pointLabel(value.start)} → ${pointLabel(value.end)}`
	);
</script>

<svelte:window onpointerup={() => (dragging = false)} />

<Popover.Root {open} onOpenChange={handleOpenChange}>
	<Popover.Trigger
		type="button"
		{disabled}
		aria-label={t('component.leave_range')}
		class="group flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
	>
		<Icon icon="lucide:calendar-range" class="size-4 shrink-0 text-muted-foreground" />
		<span class={cn('min-w-0 flex-1 truncate', value == null && 'text-muted-foreground')}>
			{triggerLabel}
		</span>
		<Icon
			icon="lucide:chevron-down"
			class="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
		/>
	</Popover.Trigger>

	<Popover.Content align="start" sideOffset={6} class="w-[min(calc(100vw-2rem),23rem)] p-0">
		<Stack gap="sm" class="p-3">
			<Inline justify="between" align="center">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					{disabled}
					aria-label={t('component.previous_month')}
					onclick={() => shiftMonth(-1)}
				>
					<Icon icon="lucide:chevron-left" class="size-4" />
				</Button>
				<p class="text-sm font-semibold" aria-live="polite">{monthLabel}</p>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					{disabled}
					aria-label={t('component.next_month')}
					onclick={() => shiftMonth(1)}
				>
					<Icon icon="lucide:chevron-right" class="size-4" />
				</Button>
			</Inline>

			<div
				class="grid grid-cols-7 gap-1"
				role="group"
				aria-label={t('component.leave_range')}
				onpointerup={() => (dragging = false)}
			>
				{#each weekdays as weekday (weekday)}
					<span class="pb-1 text-center text-[0.6875rem] font-medium text-muted-foreground">
						{weekday}
					</span>
				{/each}
				{#each days as date (date)}
					{@const inMonth = date.slice(0, 7) === visibleMonth}
					{@const dayAvailability = availabilityFor(date)}
					<div
						class={cn(
							'relative min-w-0 overflow-hidden rounded-md border border-transparent',
							date === today && 'border-primary/60',
							!inMonth && 'pointer-events-none opacity-25',
							dayAvailability.eligible === false && 'bg-muted/50'
						)}
						title={dayAvailability.reason}
					>
						<span class="block pt-1 text-center text-xs font-medium tabular-nums">
							{Number(date.slice(8))}
						</span>
						<div class="grid grid-cols-2 p-0.5">
							{#each ['FIRST', 'SECOND'] as half (half)}
								{@const point = { date, half: half as DayHalf }}
								<button
									type="button"
									class={cn(
										'h-5 rounded-sm text-[0.5625rem] font-semibold tracking-wide text-muted-foreground transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
										selected(value, point) && 'bg-primary text-primary-foreground',
										dayAvailability.eligible === false &&
											'cursor-not-allowed text-muted-foreground/50 line-through'
									)}
									disabled={disabled || dayAvailability.eligible === false || !inMonth}
									aria-pressed={selected(value, point)}
									aria-label={`${pointLabel(point)}${dayAvailability.reason ? ` — ${dayAvailability.reason}` : ''}`}
									onpointerdown={(event) => {
										event.preventDefault();
										begin(point);
									}}
									onpointerenter={() => dragging && apply(point)}
									onpointerup={() => finish(point)}
									onclick={() => clickPoint(point)}
								>
									{half === 'FIRST' ? 'AM' : 'PM'}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<p class="text-xs text-muted-foreground">{t('component.drag_to_select')}</p>

			{#if value == null}
				<p class="text-xs text-muted-foreground">{t('component.leave_pick_range_first')}</p>
			{:else}
				<div class="rounded-md bg-muted/60 px-3 py-2 text-xs" aria-live="polite">
					<p class="font-medium">{pointLabel(value.start)} → {pointLabel(value.end)}</p>
					{#if chargeableDays === 0}
						<p class="text-destructive">{t('component.leave_no_chargeable_days')}</p>
					{:else}
						<p class="text-muted-foreground">
							{t('component.chargeable_leave_days', { days: chargeableDays })}
							{#if excludedInside > 0}
								· {t('component.excluded_non_work_days', { count: excludedInside })}
							{/if}
						</p>
					{/if}
				</div>
			{/if}
			{#if limitReached}
				<p class="text-xs text-destructive" role="alert">
					{t('component.leave_balance_limit_reached', { days: (maximumHalfDays ?? 0) / 2 })}
				</p>
			{/if}
		</Stack>
	</Popover.Content>
</Popover.Root>
