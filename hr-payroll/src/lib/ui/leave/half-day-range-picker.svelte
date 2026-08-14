<script lang="ts" module>
	export type DayHalf = 'FIRST' | 'SECOND';
	export type HalfDayPoint = { readonly date: string; readonly half: DayHalf };
	export type HalfDayRange = { readonly start: HalfDayPoint; readonly end: HalfDayPoint };
	export type LeaveDayAvailability = {
		readonly eligible: boolean;
		readonly reason?: string;
		readonly shiftLabel?: string;
		readonly firstHalfLabel?: string;
		readonly secondHalfLabel?: string;
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
		disabledReason?: string | null;
		onValueChange: (value: HalfDayRange) => void;
	};

	let {
		value,
		availability = {},
		maximumHalfDays = null,
		disabled = false,
		disabledReason = null,
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

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		resetGesture();
		if (nextOpen) visibleMonth = (value?.start.date ?? today).slice(0, 7);
	}

	function resetGesture(): void {
		dragging = false;
		ignoreNextClick = false;
		anchor = null;
	}

	const weekdays = $derived([
		t('component.weekday_mon_short'),
		t('component.weekday_tue_short'),
		t('component.weekday_wed_short'),
		t('component.weekday_thu_short'),
		t('component.weekday_fri_short'),
		t('component.weekday_sat_short'),
		t('component.weekday_sun_short')
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

	function halfFromEvent(event: PointerEvent, date: string): HalfDayPoint {
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return { date, half: 'FIRST' };
		const rect = target.getBoundingClientRect();
		return {
			date,
			half: event.clientY >= rect.top + rect.height / 2 ? 'SECOND' : 'FIRST'
		};
	}

	function apply(to: HalfDayPoint): void {
		if (disabled || !isEligible(to)) return;
		onValueChange(ordered(anchor ?? to, to));
	}

	function begin(point: HalfDayPoint): void {
		if (disabled || !isEligible(point)) return;
		ignoreNextClick = true;
		dragging = true;
		if (point.half === 'SECOND') {
			anchor = { date: point.date, half: 'FIRST' };
			apply(point);
			return;
		}
		anchor = point;
		apply(point);
	}

	function finish(point: HalfDayPoint): void {
		if (!dragging) return;
		apply(point);
		dragging = false;
		anchor = null;
		ignoreNextClick = true;
	}

	function clickPoint(point: HalfDayPoint): void {
		if (ignoreNextClick) {
			ignoreNextClick = false;
			return;
		}
		if (disabled || !isEligible(point)) return;
		if (anchor == null) {
			if (point.half === 'SECOND') {
				onValueChange({
					start: { date: point.date, half: 'FIRST' },
					end: { date: point.date, half: 'SECOND' }
				});
				return;
			}
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
	const chargeableHalves = $derived(chargeableHalfDays(value));
	const chargeableDays = $derived(chargeableHalves / 2);
	const remainingDays = $derived(maximumHalfDays == null ? null : maximumHalfDays / 2);
	const overLimit = $derived(maximumHalfDays != null && chargeableHalves > maximumHalfDays);
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

<svelte:window
	onpointerup={() => {
		dragging = false;
		ignoreNextClick = false;
	}}
/>

<Stack gap="xs">
	<Popover.Root {open} onOpenChange={handleOpenChange}>
		<Popover.Trigger
			type="button"
			{disabled}
			aria-label={t('component.leave_range')}
			aria-disabled={disabled}
			title={disabled ? (disabledReason ?? undefined) : undefined}
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

		<Popover.Content align="start" sideOffset={6} class="w-[min(calc(100vw-2rem),24rem)] p-0">
			<Stack gap="sm" class="p-3">
				<Inline justify="between" align="center">
					<Button
						type="button"
						variant="ghost"
						size="icon"
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
					onpointerup={() => {
						dragging = false;
					}}
				>
					{#each weekdays as weekday (weekday)}
						<span class="pb-1 text-center text-xs font-medium text-muted-foreground">
							{weekday}
						</span>
					{/each}
					{#each days as date (date)}
						{@const inMonth = date.slice(0, 7) === visibleMonth}
						{@const dayAvailability = availabilityFor(date)}
						{@const firstOn = selected(value, { date, half: 'FIRST' })}
						{@const secondOn = selected(value, { date, half: 'SECOND' })}
						<button
							type="button"
							class={cn(
								'relative flex min-h-14 min-w-0 flex-col overflow-hidden rounded-md border text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
								date === today && 'border-primary',
								date !== today && 'border-transparent',
								!inMonth && 'pointer-events-none opacity-25',
								dayAvailability.eligible === false &&
									'cursor-not-allowed bg-muted/60 text-muted-foreground',
								dayAvailability.eligible !== false && 'text-foreground hover:bg-accent/60',
								overLimit && (firstOn || secondOn) && 'ring-1 ring-destructive'
							)}
							disabled={disabled || dayAvailability.eligible === false || !inMonth}
							aria-label={`${date}${dayAvailability.shiftLabel ? ` · ${dayAvailability.shiftLabel}` : ''}${dayAvailability.reason ? ` — ${dayAvailability.reason}` : ''}`}
							title={dayAvailability.reason ??
								(dayAvailability.firstHalfLabel != null && dayAvailability.secondHalfLabel != null
									? `${t('component.first_half')}: ${dayAvailability.firstHalfLabel} · ${t('component.second_half')}: ${dayAvailability.secondHalfLabel}`
									: dayAvailability.shiftLabel)}
							onpointerdown={(event) => {
								event.preventDefault();
								begin(halfFromEvent(event, date));
							}}
							onpointerenter={(event) => dragging && apply(halfFromEvent(event, date))}
							onpointerup={(event) => finish(halfFromEvent(event, date))}
							onclick={(event) => clickPoint(halfFromEvent(event, date))}
						>
							<span class="px-0.5 pt-1 text-center text-xs font-semibold tabular-nums">
								{Number(date.slice(8))}
							</span>
							{#if dayAvailability.shiftLabel}
								<span
									class="truncate px-0.5 text-center text-[0.5625rem] leading-3 text-muted-foreground"
								>
									{dayAvailability.shiftLabel}
								</span>
							{/if}
							<span class="mt-auto grid min-h-6 grid-cols-1 grid-rows-2">
								<span
									class={cn(
										'flex items-center justify-center text-[0.625rem] font-semibold',
										firstOn && !overLimit && 'bg-primary text-primary-foreground',
										firstOn && overLimit && 'bg-destructive text-destructive-foreground',
										!firstOn && 'text-muted-foreground'
									)}
								>
									1
								</span>
								<span
									class={cn(
										'flex items-center justify-center text-[0.625rem] font-semibold',
										secondOn && !overLimit && 'bg-primary text-primary-foreground',
										secondOn && overLimit && 'bg-destructive text-destructive-foreground',
										!secondOn && 'text-muted-foreground'
									)}
								>
									2
								</span>
							</span>
						</button>
					{/each}
				</div>

				<p class="text-xs text-muted-foreground">{t('component.leave_half_hint')}</p>

				{#if remainingDays != null}
					<p class="text-xs font-medium" aria-live="polite">
						{t('component.leave_days_remaining', { days: remainingDays })}
					</p>
				{/if}

				{#if value == null}
					<p class="text-xs text-muted-foreground">{t('component.leave_pick_range_first')}</p>
				{:else}
					<div
						class={cn(
							'rounded-md px-3 py-2 text-xs',
							overLimit ? 'bg-destructive/10 ring-1 ring-destructive' : 'bg-muted/60'
						)}
						aria-live="polite"
					>
						<p class="font-medium">{pointLabel(value.start)} → {pointLabel(value.end)}</p>
						{#if chargeableDays === 0}
							<p class="text-destructive">{t('component.leave_no_chargeable_days')}</p>
						{:else}
							<p class={overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'}>
								{t('component.chargeable_leave_days', { days: chargeableDays })}
								{#if excludedInside > 0}
									· {t('component.excluded_non_work_days', { count: excludedInside })}
								{/if}
							</p>
						{/if}
					</div>
				{/if}
				{#if overLimit && remainingDays != null}
					<p class="text-xs text-destructive" role="alert">
						{t('component.leave_balance_limit_reached', { days: remainingDays })}
					</p>
				{/if}
			</Stack>
		</Popover.Content>
	</Popover.Root>
	{#if disabled && disabledReason}
		<p class="text-xs text-muted-foreground">{disabledReason}</p>
	{:else if remainingDays != null}
		<p class={cn('text-xs', overLimit ? 'font-medium text-destructive' : 'text-muted-foreground')}>
			{t('component.leave_days_remaining', { days: remainingDays })}
			{#if value != null}
				· {t('component.chargeable_leave_days', { days: chargeableDays })}
			{/if}
		</p>
	{/if}
</Stack>
