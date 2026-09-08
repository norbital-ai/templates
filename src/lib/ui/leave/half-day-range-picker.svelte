<script lang="ts" module>
	import type { HalfDayRange } from '../../../lib/half-day.js';

	export type { HalfDayRange };

	export type LeaveDayAvailability = {
		readonly eligible: boolean;
		readonly firstHalfAvailable?: boolean;
		readonly secondHalfAvailable?: boolean;
		readonly reason?: string;
		/**
		 * One character drawn on an excluded day so the exclusion reads at a glance: `R` rest,
		 * `O` off, `H` holiday, `L` another leave, `🔒` paid payroll.
		 */
		readonly reasonMark?: string;
		readonly shiftLabel?: string;
		readonly firstHalfLabel?: string;
		readonly secondHalfLabel?: string;
	};
</script>

<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Button } from '@norbital-ai/ui/button';
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import * as Popover from '@norbital-ai/ui/popover';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { cn } from '@norbital-ai/ui/utils';
	import { pointAt, pointNumber, type DayHalf, type HalfDayPoint } from '../../../lib/half-day.js';
	import { leaveCalendarGrid } from '../../leave/calendar-grid.js';
	import { todayKey } from '../calendar.js';
	import { decodeNumber } from '@norbital-ai/std/json';

	type Props = {
		value: HalfDayRange | null;
		availability?:
			Readonly<Record<string, LeaveDayAvailability>> | ((date: string) => LeaveDayAvailability);
		maximumHalfDays?: number | null;
		persistedChargeableDays?: number | null;
		disabled?: boolean;
		disabledReason?: string | null;
		visibleMonth?: string;
		onValueChange: (value: HalfDayRange) => void;
	};

	const today = todayKey();
	let {
		value,
		availability = {},
		maximumHalfDays = null,
		persistedChargeableDays = null,
		disabled = false,
		disabledReason = null,
		visibleMonth = $bindable(today.slice(0, 7)),
		onValueChange
	}: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const DAY_MS = 86_400_000;
	let open = $state(false);
	let anchor = $state<HalfDayPoint | null>(null);
	let dragging = $state(false);

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		resetGesture();
		if (nextOpen) visibleMonth = (value?.start.date ?? today).slice(0, 7);
	}

	function resetGesture(): void {
		dragging = false;
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

	function ordered(a: HalfDayPoint, b: HalfDayPoint): HalfDayRange {
		return pointNumber(a) <= pointNumber(b) ? { start: a, end: b } : { start: b, end: a };
	}

	function isEligible(point: HalfDayPoint): boolean {
		const day = availabilityFor(point.date);
		return (
			day.eligible &&
			(point.half === 'FIRST'
				? day.firstHalfAvailable !== false
				: day.secondHalfAvailable !== false)
		);
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
		const candidate = ordered(anchor ?? to, to);
		if (maximumHalfDays != null && chargeableHalfDays(candidate) > maximumHalfDays) return;
		onValueChange(candidate);
	}

	/**
	 * Two gestures share one anchor. A drag anchors on pointerdown, extends on pointerenter and is
	 * complete on pointerup. A click is a drag that never moved, so its anchor is kept for the
	 * second click that closes the range — re-anchoring on every pointerdown is what made
	 * first-half → second-half of one day land on half a day instead of one.
	 */
	function begin(point: HalfDayPoint): void {
		if (disabled || !isEligible(point)) return;
		if (anchor != null && !dragging) {
			apply(point);
			anchor = null;
			return;
		}
		dragging = true;
		anchor = point;
		apply(point);
	}

	function finish(point: HalfDayPoint): void {
		if (!dragging) return;
		apply(point);
		dragging = false;
		if (anchor != null && pointNumber(point) !== pointNumber(anchor)) anchor = null;
	}

	function clickPoint(point: HalfDayPoint): void {
		if (disabled || !isEligible(point)) return;
		if (anchor == null) {
			anchor = point;
			apply(point);
		} else {
			apply(point);
			anchor = null;
		}
	}

	function shiftMonth(amount: number): void {
		const date = new Date(`${visibleMonth}-01T00:00:00.000Z`);
		date.setUTCMonth(date.getUTCMonth() + amount);
		visibleMonth = date.toISOString().slice(0, 7);
	}

	const days = $derived(leaveCalendarGrid(visibleMonth));
	const monthLabel = $derived(
		new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
			new Date(`${visibleMonth}-01T00:00:00.000Z`)
		)
	);
	const chargeableHalves = $derived(chargeableHalfDays(value));
	/**
	 * An existing request carries the server-normalized charge as its immutable snapshot. Use that
	 * while the saved range is untouched: the schedule queries that support editing arrive
	 * asynchronously and must not make a one-day request flash as zero days. The event editor clears
	 * this value as soon as the range changes, returning the picker to live schedule computation.
	 */
	const chargeableDays = $derived(persistedChargeableDays ?? chargeableHalves / 2);
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
			class="group h-9 w-full rounded-md border border-input bg-background px-3 text-left text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
		>
			<Inline gap="sm" align="center" fill>
				<Icon icon="lucide:calendar-range" class="size-4 shrink-0 text-muted-foreground" />
				<span class={cn('min-w-0 flex-1 truncate', value == null && 'text-muted-foreground')}>
					{triggerLabel}
				</span>
				<Icon
					icon="lucide:chevron-down"
					class="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
				/>
			</Inline>
		</Popover.Trigger>

		<Popover.Content
			align="start"
			sideOffset={6}
			minWidth={336}
			maxWidth={336}
			collisionPadding={16}
			style="width: 336px;"
			class="w-[336px] max-h-[min(34rem,calc(100dvh-5rem))] overflow-hidden p-0"
		>
			<Scroll name={t('component.leave_range')} axis="y" grow>
				<Stack gap="sm" class="w-[336px] p-3">
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

					<Grid
						gap="xs"
						tracks="repeat(7, minmax(0, 1fr))"
						role="group"
						aria-label={t('component.leave_range')}
						onpointerup={() => {
							dragging = false;
						}}
					>
						{#each weekdays as weekday (weekday)}
							<span class="min-w-0 pb-1 text-center text-xs font-medium text-muted-foreground">
								{weekday}
							</span>
						{/each}
						{#each days as date (date)}
							{@const inMonth = date.slice(0, 7) === visibleMonth}
							{@const dayAvailability = availabilityFor(date)}
							<div
								class={cn(
									'relative min-h-14 min-w-0 overflow-hidden rounded-md border',
									date === today ? 'border-primary' : 'border-transparent',
									!inMonth && 'opacity-40'
								)}
							>
								<span
									class="pointer-events-none absolute top-0.5 left-0.5 z-10 rounded-sm bg-background/80 px-0.5 text-[0.625rem] font-semibold tabular-nums"
									>{decodeNumber(date.slice(8))}</span
								>
								{#if dayAvailability.reasonMark}
									<span
										class="pointer-events-none absolute top-0.5 right-0.5 z-10 text-[0.625rem]"
										aria-hidden="true">{dayAvailability.reasonMark}</span
									>
								{/if}
								{#each ['FIRST', 'SECOND'] as half}
									{@const point: HalfDayPoint = { date, half: half === 'FIRST' ? 'FIRST' : 'SECOND' }}
									{@const on = selected(value, point)}
									<button
										type="button"
										disabled={disabled || !inMonth || !isEligible(point)}
										class={cn(
											'block min-h-7 w-full text-[0.625rem] font-medium focus-visible:relative focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40',
											on
												? overLimit
													? 'bg-destructive text-destructive-foreground'
													: 'bg-primary text-primary-foreground'
												: 'bg-muted/30 text-muted-foreground hover:bg-accent'
										)}
										aria-label={`${pointLabel(point)}${dayAvailability.reason ? ` — ${dayAvailability.reason}` : ''}`}
										aria-pressed={on}
										title={dayAvailability.reason ??
											(half === 'FIRST'
												? dayAvailability.firstHalfLabel
												: dayAvailability.secondHalfLabel) ??
											dayAvailability.shiftLabel}
										onpointerdown={(event) => {
											event.preventDefault();
											event.currentTarget.focus();
											begin(point);
										}}
										onpointerenter={() => dragging && apply(point)}
										onpointerup={() => finish(point)}
										onclick={(event) => {
											if (event.detail === 0) clickPoint(point);
										}}
									>
										{half === 'FIRST' ? '1' : '2'}
									</button>
								{/each}
							</div>
						{/each}
					</Grid>

					<p class="line-clamp-2 min-h-8 text-meta">{t('component.leave_half_hint')}</p>

					<div
						class={cn(
							'h-[4.25rem] overflow-hidden rounded-md px-3 py-2 text-xs',
							overLimit ? 'bg-destructive/10 ring-1 ring-destructive' : 'bg-muted/60'
						)}
						aria-live="polite"
					>
						{#if remainingDays != null}
							<p class="truncate font-medium">
								{t('component.leave_days_remaining', { days: remainingDays })}
							</p>
						{/if}
						{#if value == null}
							<p class="text-meta">{t('component.leave_pick_range_first')}</p>
						{:else}
							<p class="truncate font-medium">
								{pointLabel(value.start)} → {pointLabel(value.end)}
							</p>
							{#if overLimit && remainingDays != null}
								<p class="truncate text-destructive" role="alert">
									{t('component.leave_balance_limit_reached', { days: remainingDays })}
								</p>
							{:else if chargeableDays === 0}
								<p class="truncate text-destructive">{t('component.leave_no_chargeable_days')}</p>
							{:else}
								<p
									class={cn(
										'truncate',
										overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'
									)}
								>
									{t('component.chargeable_leave_days', { days: chargeableDays })}
									{#if excludedInside > 0}
										· {t('component.excluded_non_work_days', { count: excludedInside })}
									{/if}
								</p>
							{/if}
						{/if}
					</div>
				</Stack>
			</Scroll>
		</Popover.Content>
	</Popover.Root>
	{#if disabled && disabledReason}
		<p class="text-meta">{disabledReason}</p>
	{:else if remainingDays != null}
		<p class={cn('text-xs', overLimit ? 'font-medium text-destructive' : 'text-muted-foreground')}>
			{t('component.leave_days_remaining', { days: remainingDays })}
			{#if value != null}
				· {t('component.chargeable_leave_days', { days: chargeableDays })}
			{/if}
		</p>
	{/if}
</Stack>
