<!--
	One person's month, drawn as weeks × weekdays.

	This is the second renderer over `buildRosterMonth`, not a second derivation. The controller's
	board and this calendar read the *same* `DayFacts` map — `buildRosterMonth` already takes
	`employments[]`, and one person is simply the n = 1 case — so `STATUS_PRESENTATION`,
	`HOLIDAY_PRESENTATION`, `planGlyph`, `actualMark` and `describeDay` are imported and used
	verbatim. A day that is amber for the controller is amber for the employee, and an employee who
	asks "why does HR think I was absent on the 5th" is looking at the same fact the controller is
	looking at, drawn larger. Forking any of that here would produce two answers to one question,
	which is the failure mode this whole surface exists to remove.

	── WHY A CALENDAR AND NOT THE TABLE IT REPLACES ───────────────────────────────────────────────
	The ESS "My time" tab was a `time_entries` table. It showed punches and nothing about what the
	person was *supposed* to work — no shift, no rest day, no holiday, no leave — so it could not
	answer "am I on tomorrow?", which is the single most common question self-service exists to
	answer. A punch on its own is only half a day.

	── THE THREE BANDS ────────────────────────────────────────────────────────────────────────────
	A tile carries the same three bands as a board cell, with room to spell them out instead of
	glyphing them:

	    ┌─ 5 ─────┐
	    │ A       │  plan   — planGlyph + the scheduled window, or the leave / holiday that owns it
	    │ 08–17   │
	    │ ⚠ no    │  actual — actualMark spelled out, the punch window, and the hours worked
	    │   punch │
	    │ [report]│
	    └─────────┘
	     ▲
	     └ lock — a left rail, one channel, three rungs. It is a rail rather than a fill because the
	       fill is already spent on STATUS_PRESENTATION and the holiday overlay tints the tile.

	── THE LOCK LADDER HERE IS THE RECORD AXIS ONLY, AND THAT IS THE POINT ────────────────────────
	The board draws two axes. `day.lock` is a `DayLock`: window arithmetic over `payroll_runs`, about
	a *day*. `entryLocks` is a `SourceLock` per date: the claim held over the *record* on that day,
	computed by the caller with the same `sourceLock` call the write hook makes.

	This calendar draws only the second one, because its reader is an employee and an employee has no
	`read` grant on `payroll_runs` — that is the owner's ruling, not a gap. The day axis therefore
	cannot be computed on this surface at all, and `day.lock` reaches it as `NONE` on every date.

	The rungs it once carried, `IN_DRAFT_RUN` and a window-derived `PAID`, are removed rather than
	left dark, and this is the part worth not undoing. A rung whose condition can never be true does
	not render as "unknown"; it renders as its absence, which reads as *nothing is holding this day*.
	That is a false statement made in the most confident way a UI can make one, to the exact person
	who most needs the opposite. A ladder that can only ever say OPEN is worse than no ladder.

	What survives is what an employee can actually be told, and both are readable by them:

	    PENDING  — `norbital_approval_id` on their own row: the platform holds this submission.
	    CONSUMED — a `payslip_sources` row: a payslip took this record, and the row names which
	               period. `settlementLedgerGrants()` grants this deliberately, so the claim is
	               exact, stored and per-record rather than inferred from a date landing in a window.

	CONSUMED does not split into "draft run" and "paid" here, and must not be made to: a source
	row carries a payslip id and a period and no lifecycle, so telling those apart needs the run —
	which is the read this reader does not have. The tile says a payslip took the record; the hover
	text carries `sourceLockReason`, which names the period and says what would release it.

	`PENDING` outranks `CONSUMED` in `lockRung` below, inverting the ladder's own permanence order on
	purpose. `gather.ts` never consumes a row still under approval, so the two cannot both hold one
	record today; the ordering is stated anyway, because if that ever changes, "waiting on your
	manager" is the state this reader can act on and the one they opened the calendar for.
-->
<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Cluster, Cover, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Skeleton } from '@norbital-ai/ui/skeleton';
	import { cn } from '@norbital-ai/ui/utils';
	import { formatDurationHours } from '../display-formatters.js';
	import { sourceLockReason, type SourceLock } from '../../scheduling/lock.js';
	import {
		HOLIDAY_PRESENTATION,
		STATUS_PRESENTATION,
		actualMark,
		beyondScheduleMinutes,
		describeDay,
		monthDays,
		planGlyph,
		type DayFacts
	} from './roster-month.js';

	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * The clock boundaries of a day's punches, as the caller read them off the stored intervals.
	 *
	 * Not exported: a type exported from a `.svelte` file has to live in a `<script module>` block,
	 * and the caller builds this map from object literals which match structurally anyway.
	 */
	type PunchWindow = {
		readonly first: string | null;
		readonly last: string | null;
	};

	let {
		month,
		employmentId,
		facts,
		today,
		holidayNames,
		loading = false,
		entryLocks = new Map(),
		punchWindows = new Map(),
		reportableDates = new Set(),
		onSelectDay,
		onReportDay,
		onStepMonth
	}: {
		month: string;
		employmentId: string;
		/** The shared fact table, keyed `employmentId:date` exactly as the board keys it. */
		facts: ReadonlyMap<string, DayFacts>;
		today: string;
		holidayNames: ReadonlyMap<string, string>;
		/** Keep the calendar shell mounted while a new month's live queries settle. */
		loading?: boolean;
		/**
		 * The record-axis lock, keyed by date: what holds the *time entry* on that day.
		 *
		 * Computed by the caller rather than here, because the only honest way to compute it is the
		 * `sourceLock` call `time_entries/+hooks.ts` makes — same inputs, same answer — and the rows
		 * and settlement claims it needs are the caller's queries, not this component's.
		 */
		entryLocks?: ReadonlyMap<string, SourceLock>;
		/** First clock-in and last clock-out per date, `HH:mm` in the payroll timezone. */
		punchWindows?: ReadonlyMap<string, PunchWindow>;
		/**
		 * The days on which "report a missing punch" is genuinely submittable.
		 *
		 * Also the caller's decision, and for a stronger reason than convenience: the write path
		 * refuses an unpaid break that meets or exceeds the recorded worked time, and an employee
		 * cannot debug a refusal. The set is computed where the create payload is built, so this
		 * component can never draw an affordance the write path will reject.
		 */
		reportableDates?: ReadonlySet<string>;
		onSelectDay?: (employmentId: string, date: string) => void;
		onReportDay?: (employmentId: string, date: string) => void;
		onStepMonth?: (delta: number) => void;
	} = $props();

	const days = $derived(monthDays(month));
	let calendarScrollElement: HTMLElement | null = $state(null);
	let calendarHeaderTrack: HTMLElement | null = $state(null);

	/** The weekday row is shell chrome; only its horizontal position follows the body. */
	function syncCalendarHeader(): void {
		if (calendarScrollElement == null || calendarHeaderTrack == null) return;
		calendarHeaderTrack.style.transform = `translateX(${-calendarScrollElement.scrollLeft}px)`;
	}

	/** Wheel input over the fixed header still moves the body it labels. */
	function handleCalendarHeaderWheel(event: WheelEvent): void {
		if (calendarScrollElement == null || (event.deltaX === 0 && event.deltaY === 0)) return;
		const beforeLeft = calendarScrollElement.scrollLeft;
		const beforeTop = calendarScrollElement.scrollTop;
		calendarScrollElement.scrollLeft += event.deltaX;
		calendarScrollElement.scrollTop += event.deltaY;
		// Preserve scroll chaining when the body has already reached the edge in this direction.
		if (
			calendarScrollElement.scrollLeft !== beforeLeft ||
			calendarScrollElement.scrollTop !== beforeTop
		) {
			event.preventDefault();
		}
	}

	/**
	 * Monday-first weeks, with the leading and trailing blanks a calendar needs.
	 *
	 * A plain `grid-cols-7` rather than the `Grid` layout primitive: `Grid` auto-fits its columns to
	 * a minimum width, and a week is exactly seven columns wide whether or not the seventh is a
	 * blank. Layout primitives also win the display class, so a `grid-cols-7` handed to `Grid` would
	 * be overwritten by its own template.
	 */
	const WEEKDAY_KEYS = [
		'roster.weekday_mon',
		'roster.weekday_tue',
		'roster.weekday_wed',
		'roster.weekday_thu',
		'roster.weekday_fri',
		'roster.weekday_sat',
		'roster.weekday_sun'
	] as const satisfies readonly TenantI18nKeys[];

	/** Monday = 0 … Sunday = 6, from a `YYYY-MM-DD` key read as a UTC calendar day. */
	function mondayIndex(date: string): number {
		return (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
	}

	const weeks = $derived.by(() => {
		const first = days[0];
		if (first == null) return [] as (string | null)[][];
		const cells: (string | null)[] = [
			...Array.from({ length: mondayIndex(first) }, () => null),
			...days
		];
		while (cells.length % 7 !== 0) cells.push(null);
		const rows: (string | null)[][] = [];
		for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));
		return rows;
	});

	function dayOf(date: string): DayFacts | undefined {
		return facts.get(`${employmentId}:${date}`);
	}

	/**
	 * Worked time past the plan, floored at zero for display.
	 *
	 * `beyondScheduleMinutes` is imported rather than recomputed, and it deliberately returns a
	 * signed number and `null` — negative for a short day, null while a punch is open — because the
	 * day sheet has room to say "under by 40 minutes" and this tile does not. Only the overshoot is
	 * drawn here, as the `↑` the legend names; a short day is not a fault worth a mark of its own on
	 * a month view, and the day sheet is one click away for the whole sentence.
	 */
	function overshootMinutes(day: DayFacts): number {
		return Math.max(0, beyondScheduleMinutes(day) ?? 0);
	}

	const monthDaysForPerson = $derived(
		days.flatMap((date) => {
			const day = dayOf(date);
			return day == null ? [] : [day];
		})
	);
	const workedMinutesTotal = $derived(
		monthDaysForPerson.reduce((total, day) => total + (day.workedMinutes ?? 0), 0)
	);
	const beyondScheduleTotal = $derived(
		monthDaysForPerson.reduce((total, day) => total + overshootMinutes(day), 0)
	);

	/**
	 * The three rungs of the ladder, on one channel, with nothing else drawn on it — so "why can't I
	 * change this" has exactly one place to look.
	 *
	 * Three rather than the board's five, and every one of them computable by the reader looking at
	 * it. See the header note: the two missing rungs are the day-axis ones, and drawing a rung an
	 * employee's grants cannot light would say "nothing holds this day" on days something does.
	 */
	type LockRung = 'OPEN' | 'PENDING' | 'CONSUMED';

	const RUNG_PRESENTATION: Record<
		LockRung,
		{ readonly labelKey: TenantI18nKeys; readonly railClass: string; readonly padlock: boolean }
	> = {
		OPEN: { labelKey: 'roster.rung_open', railClass: 'bg-transparent', padlock: false },
		PENDING: { labelKey: 'roster.rung_pending', railClass: 'bg-warning', padlock: false },
		// Full `bg-brand` rather than the board's `bg-brand/70`: with no `PAID` rung above it there is
		// no darker sibling left for this to be read against, and a tint that exists only to be the
		// lighter of a pair is just a weaker version of the strongest thing on the ladder.
		CONSUMED: { labelKey: 'roster.rung_consumed', railClass: 'bg-brand', padlock: true }
	};

	/**
	 * `day` is not consulted. The parameter is kept out of the signature entirely rather than passed
	 * and ignored, because a `DayFacts` in scope here is exactly the invitation to reach for
	 * `day.lock` again — which on this surface is `NONE` on every date and would silently reinstate
	 * the always-dark rungs the header note explains.
	 */
	function lockRung(entryLock: SourceLock | undefined): LockRung {
		// See the header note: pending is drawn out of ladder order on purpose.
		if (entryLock?.kind === 'PENDING_APPROVAL') return 'PENDING';
		if (entryLock?.kind === 'SETTLED') return 'CONSUMED';
		return 'OPEN';
	}

	/**
	 * The sentence under the lock rail, for the rung the reader can act on.
	 *
	 * `CONSUMED` is the only one with anything to say: the claim names the period that holds the
	 * punch and the two ways out of it. `PENDING` renders its own label above, and `OPEN` has no
	 * refusal to explain — returning null keeps the tile from printing a second line for either.
	 */
	function rungDetail(entryLock: SourceLock | undefined): string | null {
		return entryLock == null ? null : sourceLockReason(entryLock, t);
	}

	/**
	 * What the plan line says under the glyph.
	 *
	 * Leave and holidays get their own words rather than a code, because this reader is the person
	 * whose leave it is: `ANNUAL` above `approved` is what they filed, and a holiday is named.
	 */
	function planDetail(day: DayFacts): string | null {
		if (day.leaveCode != null) {
			return day.halfDayLeave ? t('roster.half_day') : t('roster.leave_approved');
		}
		if (day.pendingLeave) return t('roster.pending_leave');
		if (day.holidayName != null) return day.holidayName;
		// A slice rather than `shiftTimeCue`: the dense board compresses `08:00–17:00` to `8a–5p`
		// because it has 52px to spend, and this tile does not have to.
		if (day.shiftStart != null && day.shiftEnd != null) {
			return `${day.shiftStart.slice(0, 5)}–${day.shiftEnd.slice(0, 5)}`;
		}
		return null;
	}

	/** The evidence line, spelled out. `actualMark` still decides *which* of these it is. */
	function actualLabel(day: DayFacts): string | null {
		const mark = actualMark(day);
		if (mark === '⧗') return t('roster.attendance_open');
		if (mark === '!') return t('roster.calendar_no_punch');
		if (mark === '✓') return null;
		return null;
	}

	/**
	 * Everything known about the day, in one string, for the hover text and the accessible name.
	 *
	 * `describeDay` composes the shared sentence — status, shift, leave, holiday, conflicts, the day's
	 * own payroll window — and the record-level refusal is appended after it. Both are needed: the
	 * table this screen replaces put `rowLockReason` on every locked row, and that sentence is the
	 * only one that can name the run holding a punch and say what would release it. Dropping it would
	 * turn an explanation the employee could act on back into a greyed-out control.
	 */
	function tileLabel(day: DayFacts, date: string, entryLock: SourceLock | undefined): string {
		const reason = entryLock == null ? null : sourceLockReason(entryLock, t);
		return [describeDay(day, date, t), reason].filter((part) => part != null).join(' — ');
	}
</script>

{#snippet chrome()}
	<Cluster gap="md" align="center" justify="between" class="flex-wrap">
		<Inline gap="xs">
			<Button
				variant="outline"
				size="icon"
				aria-label={t('roster.calendar_previous_month')}
				disabled={loading || onStepMonth == null}
				onclick={() => onStepMonth?.(-1)}
			>
				<IconWrapper name="lucide:chevron-left" class="size-4" />
			</Button>
			<span class="text-heading tabular-nums">{month}</span>
			<Button
				variant="outline"
				size="icon"
				aria-label={t('roster.calendar_next_month')}
				disabled={loading || onStepMonth == null}
				onclick={() => onStepMonth?.(1)}
			>
				<IconWrapper name="lucide:chevron-right" class="size-4" />
			</Button>
		</Inline>
		{#if loading}
			<Inline gap="md" aria-hidden="true">
				<Skeleton class="h-4 w-24" />
				<Skeleton class="h-4 w-36" />
			</Inline>
		{:else}
			<Inline gap="md" class="text-sm text-muted-foreground">
				<span>
					{t('roster.calendar_worked_total', {
						hours: formatDurationHours(workedMinutesTotal, t)
					})}
				</span>
				<span>
					{t('roster.calendar_beyond_total', {
						hours: formatDurationHours(beyondScheduleTotal, t)
					})}
				</span>
			</Inline>
		{/if}
	</Cluster>
{/snippet}

{#snippet weekdayHeader()}
	<!-- The clip belongs to the fixed header viewport; the body below is the sole scroll owner. -->
	<div class="overflow-hidden border-b bg-card" onwheel={handleCalendarHeaderWheel}>
		<div bind:this={calendarHeaderTrack} class="min-w-[38rem] px-2 pt-2 pb-1.5">
			<Grid tracks="repeat(7, minmax(0, 1fr))" gap="sm">
				{#each WEEKDAY_KEYS as weekdayKey (weekdayKey)}
					<span class="text-center text-micro font-medium text-muted-foreground">
						{t(weekdayKey)}
					</span>
				{/each}
			</Grid>
		</div>
	</div>
{/snippet}

<!--
	THREE ENTRIES, because the tile says the rest of it out loud.

	This strip carried six: two lock rails, a holiday tint, `↑`, `!`, and an invisible `bg-transparent`
	swatch for the OPEN rung that rendered as a gap with a label beside it. The two rails and the `!`
	are all spelled out in the tile itself — "Waiting on your manager", the `sourceLockReason`
	sentence, "No clock-in recorded" — so naming them again down here was asking the reader to learn a
	code for something already written in words a centimetre away.

	What is left is the one thing a tile cannot spell out (its own fill), the one overlay that is a
	property of the calendar rather than of the day, and the one mark that is genuinely a symbol.
-->
{#snippet legend()}
	<Cluster gap="sm" class="text-xs leading-5 text-muted-foreground">
		<Inline gap="xs">
			<span class="inline-block size-2.5 rounded-sm bg-warning/25"></span>
			<span>{t('roster.legend_attention')}</span>
		</Inline>
		<Inline gap="xs">
			<span class="inline-block size-2.5 rounded-sm {HOLIDAY_PRESENTATION.headerClassName}"></span>
			<span>{t(HOLIDAY_PRESENTATION.labelKey)}</span>
		</Inline>
		<Inline gap="xs">
			<span class="inline-block w-3 text-center">↑</span>
			<span>{t('roster.calendar_beyond_schedule')}</span>
		</Inline>
	</Cluster>
{/snippet}

<!--
	stupidity:allow UI3 -- a month of person-days is a derived join of six collections, not one
	collection's rows, and there is no table shape that carries weeks × weekdays.

	── WHY THE MONTH IS A SCROLLPORT AND NOT A COLUMN OF WEEKS ────────────────────────────────────
	This used to be a `Stack` whose middle child was a `div.overflow-x-auto` — bounded on x, unbounded
	on y. Six weeks of 96px tiles plus the chrome is about 700px, and the app shell clips its tab panel
	with `overflow: clip` rather than scrolling it, so on a 720px viewport the last two weeks and the
	whole legend were not merely below the fold: they were CUT OFF, with no scroll anywhere on the
	ancestor chain to reach them. A month view that cannot show the end of the month is not a month
	view.

	The fix is the pair `CollectionTable` and the controller's board already use: a `Cover` whose middle
	track is `minmax(0,1fr)` gives a definite height, and a single `Scroll` inside it fills that height
	and scrolls when the content exceeds it. So this component grows to the space its caller gives it
	and stops there, and it is the one scroll owner on this chain.

	NOT a `max-h-[...]` on the scroller: `Scroll` and `Cover` both end their own `cn()` with `h-full
	max-h-full`, which tailwind-merge resolves in their favour over anything a caller passes. The
	height has to come from a bounded ancestor, which is what `+hr_employee.svelte` now provides.

	It scrolls on BOTH axes. The week keeps its seven columns on every viewport and the calendar scrolls
	sideways rather than compressing: seven tiles across a phone is 45px each, at which point the plan
	glyph is the only band that still fits and the calendar stops being able to say the thing it exists
	to say. The narrow-screen reader scrolls one week horizontally, or opens a day for the full
	sentence — and the page body never scrolls sideways, because this region owns that overflow.
-->
<Cover gap="sm" top={chrome} bottom={legend} aria-busy={loading}>
	{#if loading}
		<span class="sr-only" role="status">{t('app.hr_employee.schedule_loading')}</span>
	{/if}
	<Cover as="div" gap="none" top={weekdayHeader} class="rounded-lg border bg-card">
		<Scroll
			bind:ref={calendarScrollElement}
			axis="both"
			name={t('roster.calendar_scroll_name')}
			class="relative bg-card"
			onscroll={syncCalendarHeader}
		>
			<div class="min-w-[38rem] px-2 pb-2 pt-1.5">
				{#each weeks as week, weekIndex (weekIndex)}
					<Grid tracks="repeat(7, minmax(0, 1fr))" gap="sm" class="pb-1.5">
						{#each week as date, dayIndex (date ?? `blank-${weekIndex}-${dayIndex}`)}
							{#if loading}
								<Stack
									gap="sm"
									class="min-h-24 rounded-md border bg-card px-2.5 py-2"
									aria-hidden="true"
								>
									<Skeleton class="h-4 w-6" />
									<Skeleton class="h-3 w-3/4" />
									<Skeleton class="h-3 w-full" />
								</Stack>
							{:else if date == null}
								<div class="min-h-24 rounded-md bg-muted/20" aria-hidden="true"></div>
							{:else}
								{@const day = dayOf(date)}
								{@const holiday = holidayNames.get(date)}
								{@const entryLock = entryLocks.get(date)}
								{@const rung = day == null ? 'OPEN' : lockRung(entryLock)}
								{@const rail = RUNG_PRESENTATION[rung]}
								{@const reportable = reportableDates.has(date)}
								<!--
								The tile is a container, not a button, because it holds a second action. The day
								detail is opened by a stretched overlay button; the report chip sits above it on
								the stacking order. A button nested inside a button is invalid markup and the
								inner one is unreachable by keyboard in several browsers.
							-->
								<Stack
									gap="none"
									class={cn(
										'relative min-h-24 overflow-hidden rounded-md border text-left',
										day == null ? 'bg-muted/20' : STATUS_PRESENTATION[day.status].className,
										holiday != null && HOLIDAY_PRESENTATION.className,
										date === today && 'ring-2 ring-brand ring-inset'
									)}
								>
									<span
										class={cn('absolute inset-y-0 left-0 w-1', rail.railClass)}
										aria-hidden="true"
									></span>

									{#if day != null && onSelectDay != null}
										<button
											type="button"
											class="absolute inset-0 z-0 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
											aria-haspopup="dialog"
											aria-label={tileLabel(day, date, entryLock)}
											title={tileLabel(day, date, entryLock)}
											onclick={() => onSelectDay(employmentId, date)}
										></button>
									{/if}

									<Stack
										gap="none"
										grow
										class="pointer-events-none relative z-0 py-1 pr-1.5 pl-2.5"
									>
										<Inline align="baseline" justify="between" gap="xs">
											<span class="text-sm font-semibold tabular-nums">
												{Number(date.slice(8, 10))}
											</span>
											<Inline as="span" gap="xs" class="text-micro">
												{#if holiday != null}
													<span class="font-semibold">{HOLIDAY_PRESENTATION.mark}</span>
												{/if}
												{#if rail.padlock}
													<span title={t(rail.labelKey)}>🔒</span>
												{/if}
											</Inline>
										</Inline>

										{#if day != null}
											<!-- PLAN -->
											<span class="truncate text-xs leading-4 font-medium">{planGlyph(day)}</span>
											{#if planDetail(day) != null}
												<span class="truncate text-micro leading-3 opacity-80"
													>{planDetail(day)}</span
												>
											{/if}

											<!-- ACTUAL -->
											{@const punch = punchWindows.get(date)}
											{#if punch?.first != null}
												<span class="truncate text-micro leading-4 tabular-nums">{punch.first}</span
												>
												{#if punch.last != null}
													<span class="truncate text-micro leading-3 tabular-nums">
														↳ {punch.last}
													</span>
												{:else}
													<!--
													A first punch with no last one is a clock still running. Without this arm the tile
													would print a lone start time and say nothing about it, which is the one attendance
													state the table this screen replaces named outright in its `state` column.
												-->
													<span class="truncate text-micro leading-3">
														{t('roster.attendance_open')}
													</span>
												{/if}
											{:else if actualLabel(day) != null}
												<span class="truncate text-micro leading-4">{actualLabel(day)}</span>
											{/if}
											{#if day.workedMinutes != null && day.workedMinutes > 0}
												<span class="truncate text-micro leading-3 tabular-nums">
													{formatDurationHours(day.workedMinutes, t)}{overshootMinutes(day) > 0
														? ' ↑'
														: ''}
												</span>
											{/if}

											<!-- LOCK, when it is a rung the employee can be told something about -->
											{#if rung === 'PENDING'}
												<span class="truncate text-micro leading-3 font-medium">
													{t(RUNG_PRESENTATION.PENDING.labelKey)}
												</span>
											{:else if rungDetail(entryLock) != null}
												<span class="truncate text-micro leading-3 opacity-70">
													{rungDetail(entryLock)}
												</span>
											{/if}
										{/if}
									</Stack>

									{#if reportable && onReportDay != null}
										<div class="relative z-10 px-1.5 pb-1.5">
											<Button
												variant="outline"
												size="sm"
												class="h-6 w-full px-1 text-micro"
												onclick={() => onReportDay(employmentId, date)}
											>
												{t('roster.calendar_report_punch')}
											</Button>
										</div>
									{/if}
								</Stack>
							{/if}
						{/each}
					</Grid>
				{/each}
			</div>
		</Scroll>
	</Cover>
</Cover>
