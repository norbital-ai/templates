<!--
	The month at a glance: one row per person, one narrow column per day.

	This mirrors the shape operators already keep their rosters in — a wide grid of people against
	dates — so the board reads like the spreadsheet it replaces rather than like a database table. It
	is deliberately not a `ResourceScheduler`: that component's month view is the right axis, but its
	day cells carry a button, a chip row and a 156px minimum width each, which at roster density
	turns thirty-one days into several screens of chrome. Here a day is a glyph.

	Planned and actual are shown in the same cell on purpose. Kept apart they are two screens nobody
	cross-references, which is how a rostered shift with nobody clocked onto it survives until payroll.

	── SCROLL ────────────────────────────────────────────────────────────────────────────────────────
	The board is a scrollport, built the way `CollectionTable` builds one: a `Cover` whose middle row
	is `minmax(0,1fr)` gives a definite height, and a single `Scroll` inside it fills that height and
	scrolls when the content exceeds it (see `packages/ui/src/collection-table/internal/collection-grid.svelte`,
	which nests exactly this pair). So the board grows to the space it is given and stops there,
	instead of growing the page — which also means it, and not the tab panel, is the one scroll owner
	on this ancestor chain.

	It scrolls on BOTH axes, because it is people by days: `axis="both"` rather than the `axis="x"`
	reel this used to be. The person cells remain sticky on `x`; the day header is shell chrome outside
	the scrollport, and its inner track follows the body's `scrollLeft`. That is the same "header fixed,
	body scrolls" contract `CollectionTable` uses, including for virtualised rows whose header cannot
	live inside their scrollport.
-->
<script lang="ts" module>
	/**
	 * One end of a swap: the person-day a cell stands for.
	 *
	 * Exported so `+scheduling.svelte` can hold the armed source in its own state and hand it back
	 * through `swapSource` — the board draws the gesture, the app performs the transaction.
	 */
	export type BoardCell = { readonly employmentId: string; readonly date: string };
</script>

<script lang="ts">
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Number as EffectNumber } from 'effect';
	import { Cluster, Cover, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Skeleton } from '@norbital-ai/ui/skeleton';
	import { cn } from '@norbital-ai/ui/utils';
	import { createVirtualizer } from '@norbital-ai/ui/utils/virtualizer.svelte';
	import {
		CONFLICT_PRESENTATION,
		DAY_MARK_KEY,
		HOLIDAY_PRESENTATION,
		LOCK_RAIL_PRESENTATION,
		STATUS_PRESENTATION,
		actualMark,
		actualMarkClass,
		describeDay,
		lockRung,
		lockRungFreezes,
		lockRungSourceLock,
		monthDays,
		personDayKey,
		planGlyph,
		shiftTimeCue,
		unrosteredReason,
		type DayFacts,
		type LockRung
	} from './roster-month.js';
	import { scrollBodyByWheel, syncHeaderTrack } from './header-scroll.js';
	import { sourceLockReason, type SettlementClaim } from '../../scheduling/lock.js';
	import { decodeNumber } from '@norbital-ai/std/json';

	type Person = { readonly id: string; readonly number: string; readonly name: string };

	const { t } = useI18n<TenantI18nKeys>();

	let {
		month,
		people,
		facts,
		today,
		holidayNames,
		loading = false,
		locks = new Map(),
		settlementClaims = new Map(),
		cutoff = null,
		onSelectDay,
		editable = false,
		swappable = false,
		swapSource = $bindable(null),
		onSwapDays
	}: {
		month: string;
		people: readonly Person[];
		facts: ReadonlyMap<string, DayFacts>;
		today: string;
		/** Preserve the board shell while the selected month's live queries settle. */
		loading?: boolean;
		/**
		 * The company calendar, keyed by date. Public holidays are drawn as a column of the board
		 * rather than as a mark on each person's day, because that is where they come from: the
		 * calendar, not the roster.
		 */
		holidayNames: ReadonlyMap<string, string>;
		/** One lock per date, derived from the company's payroll runs. */
		locks?: ReadonlyMap<string, import('../../scheduling/lock.js').DayLock>;
		/**
		 * The settlement claims held over this month's attendance records, keyed by time-entry id.
		 *
		 * This is the difference between "the day sits in a paid period" and "a run took this
		 * record", and the whole reason the lock ladder has four rungs rather than three. A board
		 * given no claims degrades to the window arithmetic alone, which is what it drew before —
		 * so the map is optional and an empty one is not a bug.
		 */
		settlementClaims?: ReadonlyMap<string, SettlementClaim>;
		cutoff?: { readonly start: string; readonly end: string } | null;
		/**
		 * Open the day sheet on a cell. Called for EVERY active person-day, including locked ones and
		 * months with no draft roster — the sheet is the only surface that can say why a day refuses a
		 * write, so a board that withheld it on locked days withheld the explanation as well.
		 */
		onSelectDay?: (employmentId: string, date: string) => void;
		/**
		 * Whether the PLAN may be written in this month — a draft roster exists.
		 *
		 * It gates the swap gesture and the sheet's roster-code picker, and nothing else. It does not
		 * gate opening a cell: see the note beside `cellOpenable` below.
		 */
		editable?: boolean;
		/**
		 * Whether the swap gesture is offered. Draft months only: a swap is two writes to
		 * `work_days`, and `work_days/+hooks.ts` refuses every one of them in a published month.
		 * Offering a gesture the write path will refuse is worse than not offering it.
		 */
		swappable?: boolean;
		/** The armed end of a swap, bindable so the day sheet's own Swap button can arm it. */
		swapSource?: BoardCell | null;
		onSwapDays?: (from: BoardCell, to: BoardCell) => void;
	} = $props();

	const days = $derived(monthDays(month));
	const PERSON_TRACK_REM = 10;
	const DAY_TRACK_REM = 3.75;
	const boardTrackWidth = $derived(`${PERSON_TRACK_REM + days.length * DAY_TRACK_REM}rem`);
	let boardElement: HTMLElement | null = $state(null);
	let boardHeaderTrack: HTMLElement | null = $state(null);
	let requestedCellKey = $state('');

	/** Keep the fixed day header horizontally aligned with the internally scrolling rows. */
	function syncBoardHeader(): void {
		syncHeaderTrack(boardElement, boardHeaderTrack);
	}

	/** Wheel input over the fixed header controls the body it labels. */
	function handleBoardHeaderWheel(event: WheelEvent): void {
		scrollBodyByWheel(boardElement, event);
	}
	const rowVirtualizer = createVirtualizer({
		count: () => people.length,
		scrollElement: () => boardElement,
		estimateSize: () => 45,
		overscan: 4,
		getItemKey: (index) => people[index]?.id ?? index
	});
	const virtualRows = $derived(rowVirtualizer.virtualItems);
	const topSpacer = $derived(virtualRows[0]?.start ?? 0);
	const bottomSpacer = $derived(
		Math.max(0, rowVirtualizer.totalSize - (virtualRows.at(-1)?.end ?? 0))
	);

	const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

	function isWeekend(date: string): boolean {
		const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
		return day === 0 || day === 6;
	}

	/** Draw a boundary only when the real cut-off starts in this month; never clamp it to day one. */
	const cutoffStartsAt = $derived(
		cutoff != null && days.includes(cutoff.start) ? cutoff.start : null
	);

	/** The ladder in climbing order, so the legend and the rail cannot fall out of step. */
	const lockRungs: readonly LockRung[] = ['OPEN', 'IN_DRAFT_RUN', 'CONSUMED', 'PAID'];

	/** Whether the glyph key under the legend is expanded. Collapsed is the resting state. */
	let marksOpen = $state(false);

	/**
	 * A past day is loud only when something is wrong with it. Days that already ended with their
	 * plan fulfilled, their leave granted, or their conflict flagged stay fully legible; only a
	 * quietly finished day is dimmed, so past does not read as failure everywhere at once.
	 *
	 * The two ATTENTION statuses are excluded outright, and that is a fix rather than a refinement.
	 * An absence satisfies every other condition here — it is past, nobody clocked, there is no leave
	 * and no conflict — so every one of the 725 missed clock-ins in a month was being drawn at 70%
	 * opacity. The board was fading out precisely the cells it exists to surface, and washing the
	 * ATTENTION fill towards the neutral it has to be told apart from.
	 */
	function quietPast(day: DayFacts | undefined): boolean {
		return (
			day?.past === true &&
			day.status !== 'ABSENT' &&
			day.status !== 'OPEN' &&
			!day.clockedIn &&
			day.leaveCode == null &&
			!day.pendingLeave &&
			day.conflicts.length === 0
		);
	}

	/**
	 * The rung a cell sits on, and the sentence that goes with it.
	 *
	 * Both go through the shared module rather than being decided here, because the day sheet and
	 * (once it lands) the employee's calendar draw the same ladder, and a board that disagreed with
	 * the drawer about why a day is locked would be worse than one that said nothing.
	 */
	function rungOf(day: DayFacts | undefined): LockRung {
		if (day == null) return 'OPEN';
		return lockRung(
			day,
			(day.workDayId == null ? null : settlementClaims.get(day.workDayId)) ?? null
		);
	}

	/**
	 * Why this day refuses a write, in the operator's words — `sourceLockReason` composes it.
	 *
	 * No new sentences are written here. `SETTLED` names the period holding the record and says
	 * both ways out of it; `PAID_DAY` says the day is inside a paid period and corrections are
	 * adjustments. The advisory draft-window rung has no refusal to explain, so it borrows the note
	 * the cell already carried.
	 */
	function lockNote(day: DayFacts | undefined): string | null {
		if (day == null) return null;
		const claim = day.workDayId == null ? null : (settlementClaims.get(day.workDayId) ?? null);
		const lock = lockRungSourceLock(day, claim);
		return lock == null ? null : sourceLockReason(lock, t);
	}

	/* ── THE SWAP GESTURE ──────────────────────────────────────────────────────────────────────
		Two cells, one transaction. A cell is armed — by dragging it, or by pressing `x` on it, or by
		the day sheet's own Swap button writing `swapSource` — and the second cell completes the pair.

		Arming is a state rather than a pure drag for one reason: drag-and-drop is a pointer gesture
		and this board is fully keyboard-navigable, with arrow keys already moving a roving tabindex
		across nine thousand cells. A swap that could only be performed with a mouse would be the one
		operation on this surface a keyboard user could not reach.

		The pair is constrained to a row or a column because those are the two swaps that mean
		something: same person on two dates is a date-for-date swap, and two people on one date is a
		person-for-person swap. A diagonal pair is four changes described as one, and nobody asked
		for it. The board proposes the pair; the app checks payroll locks and submits both writes
		in one transaction. The workday hooks enforce the authoritative schedule and leave checks.
	*/

	/** Same row or same column, and not the cell itself. */
	function swapPairAllowed(from: BoardCell, to: BoardCell): boolean {
		if (from.employmentId === to.employmentId && from.date === to.date) return false;
		return from.employmentId === to.employmentId || from.date === to.date;
	}

	function armSwap(cell: BoardCell): void {
		swapSource = cell;
	}

	function completeSwap(target: BoardCell): void {
		const from = swapSource;
		if (from == null || !swapPairAllowed(from, target)) return;
		swapSource = null;
		onSwapDays?.(from, target);
	}

	const swapPerson = $derived(
		swapSource == null
			? null
			: (people.find((person) => person.id === swapSource?.employmentId) ?? null)
	);

	const activeCellKey = $derived.by(() => {
		if (requestedCellKey) {
			const [personId, date] = requestedCellKey.split(':');
			if (people.some((person) => person.id === personId) && days.includes(date ?? '')) {
				return requestedCellKey;
			}
		}
		return people[0] == null || days[0] == null ? '' : personDayKey(people[0].id, days[0]);
	});

	function focusCell(personIndex: number, dayIndex: number): void {
		const nextPerson = EffectNumber.clamp({ minimum: 0, maximum: people.length - 1 })(personIndex);
		const nextDay = EffectNumber.clamp({ minimum: 0, maximum: days.length - 1 })(dayIndex);
		const person = people[nextPerson];
		const date = days[nextDay];
		if (person == null || date == null) return;
		requestedCellKey = personDayKey(person.id, date);
		rowVirtualizer.scrollToIndex(nextPerson, { align: 'auto' });
		requestAnimationFrame(() => {
			boardElement
				?.querySelector<HTMLElement>(`[data-roster-cell="${nextPerson}:${nextDay}"]`)
				?.focus();
		});
	}

	/** The two-cell arrow gesture a keyboard can express, or null when the key moves nothing. */
	function arrowMovement(key: string): readonly [number, number] | null {
		switch (key) {
			case 'ArrowLeft':
				return [0, -1];
			case 'ArrowRight':
				return [0, 1];
			case 'ArrowUp':
				return [-1, 0];
			case 'ArrowDown':
				return [1, 0];
			default:
				return null;
		}
	}

	function handleCellKeydown(event: KeyboardEvent, personIndex: number, dayIndex: number): void {
		// Escape always disarms, whether or not the swap gesture is on offer, so a half-started
		// gesture can never strand the board in a mode the operator cannot see a way out of.
		if (event.key === 'Escape' && swapSource != null) {
			event.preventDefault();
			swapSource = null;
			return;
		}
		const movement = arrowMovement(event.key);
		if (movement == null) return;
		event.preventDefault();
		focusCell(personIndex + movement[0], dayIndex + movement[1]);
	}

	function scheduleSummary(day: DayFacts): string {
		if (day.status === 'UNROSTERED') return unrosteredReason(day, t);
		if (day.shiftCode == null || day.shiftStart == null || day.shiftEnd == null) {
			return t(STATUS_PRESENTATION[day.status].labelKey);
		}
		return `${t('roster.shift_code', { code: day.shiftCode })} · ${t('roster.shift_window', {
			start: day.shiftStart,
			end: day.shiftEnd,
			break: (day.shiftBreakMinutes ?? 0) / 60
		})}`;
	}

	function attendanceSummary(day: DayFacts): string {
		if (day.attendanceState === 'OPEN') return t('roster.attendance_open');
		if (day.workedIntervalCount > 0) {
			const intervals = t('roster.attendance_intervals', { count: day.workedIntervalCount });
			return day.withinCutoff ? `${intervals} · ${t('roster.in_pay_period')}` : intervals;
		}
		return day.withinCutoff ? t('roster.no_attendance_in_pay_period') : t('roster.no_attendance');
	}

	/**
	 * Everything else worth saying about a day, as one line.
	 *
	 * This used to end with `component.lock_date_passed` on every past day that was not settled,
	 * which said a day was locked for having gone by. That was never true of attendance and is the
	 * exact false refusal §2 of `docs/scheduling-leave-proposal.md` set out to remove — a past
	 * day is the *normal* day to be correcting a punch on. The lock line now comes from the ladder,
	 * which answers the same question from the payroll runs rather than from the calendar.
	 */
	function dayNotes(day: DayFacts): string | null {
		const rung = rungOf(day);
		const notes = [
			day.holidayName == null ? null : `${t(HOLIDAY_PRESENTATION.labelKey)}: ${day.holidayName}`,
			day.leaveCode == null
				? null
				: `${day.leaveCode}${day.halfDayLeave ? ` (${t('roster.half_day')})` : ''}`,
			day.pendingLeave ? t('roster.pending_leave') : null,
			day.plannedOT ? t('roster.planned_ot') : null,
			day.plannedOrigin == null
				? null
				: day.plannedOrigin === 'IMPORT'
					? t('roster.origin_import')
					: t('roster.origin_manual'),
			...day.conflicts.map((conflict) => t(CONFLICT_PRESENTATION[conflict].labelKey)),
			// The refusal sentence when there is one; otherwise the draft window's advisory note.
			lockNote(day) ??
				(rung === 'IN_DRAFT_RUN' && day.lock.kind === 'IN_WINDOW'
					? t('roster.in_payroll_window', { period: day.lock.period })
					: null),
			// `component.hours_short` already exists and reads "{hours} hr" — a second key saying the
			// same thing in the same place is one more string to translate and keep in step.
			day.workedMinutes == null
				? null
				: t('component.hours_short', { hours: (day.workedMinutes / 60).toFixed(2) })
		].filter((part): part is string => part != null);
		return notes.length === 0 ? null : notes.join(' · ');
	}
</script>

{#snippet legend()}
	<Cluster gap="sm" shrink={false} class="text-xs leading-5 text-muted-foreground">
		<!--
			The armed-swap announcement. A live region rather than a toast: it describes a mode the
			board is currently in, and it has to stay on screen for as long as that mode lasts. It
			sits in the legend row because that row is already the board's explanatory strip, and
			because `Cover` gives it a place that does not steal height from the scrollport.
		-->
		{#if swapSource != null}
			<Inline gap="xs" aria-live="polite" class="font-medium text-brand">
				<IconWrapper name="lucide:arrow-left-right" class="size-3" />
				<span>
					{t('roster.swap_armed', {
						person: swapPerson?.number ?? swapSource.employmentId,
						date: swapSource.date
					})}
				</span>
				<button type="button" class="underline" onclick={() => (swapSource = null)}>
					{t('roster.swap_cancel')}
				</button>
			</Inline>
		{:else if swappable}
			<Inline gap="xs">
				<IconWrapper name="lucide:arrow-left-right" class="size-3" />
				<span>{t('roster.swap_hint')}</span>
			</Inline>
		{/if}
		<!--
			THE COLOUR KEY — four swatches, one per hue the board actually spends.

			It used to be seventeen: ten status fills, a holiday tint, an OT glyph, a pending-leave
			glyph, a conflict swatch and three rungs of the lock ladder, wrapped over three lines. That
			is not a key, it is a lookup table, and a board you have to look away from to read is a
			board you cannot read. The identity of a day now travels on its glyph and on one neutral at
			three densities — see the colour-budget note in `roster-month.ts` — so the only things left
			to name here are the three hues and the one shape.
		-->
		<Inline gap="xs">
			<span class="inline-block size-2.5 rounded-sm bg-warning/25"></span>
			<span>{t('roster.legend_attention')}</span>
		</Inline>
		<Inline gap="xs">
			<span
				class="inline-block size-2.5 rounded-sm outline-1 outline-dashed outline-offset-[-1px] outline-muted-foreground/50"
			></span>
			<span>{t('roster.unrostered')}</span>
		</Inline>
		<Inline gap="xs">
			<span class={cn('inline-block size-2.5 rounded-sm', HOLIDAY_PRESENTATION.headerClassName)}
			></span>
			<span>{t('roster.holiday_from_calendar', { label: t(HOLIDAY_PRESENTATION.labelKey) })}</span>
		</Inline>
		<!--
			The lock ladder collapses to ONE entry. Its four rungs are still four distinct rails on the
			cells — that is what the ladder is for — but a reader does not need three swatches to learn
			that a rail means payroll: the padlock says a day refuses a write, and the day sheet's LOCK
			panel names the run and what would release it. The rungs are listed in the marks key below.
		-->
		<Inline gap="xs">
			<span class="inline-block h-2.5 w-1 rounded-sm bg-brand"></span>
			<span aria-hidden="true">🔒</span>
			<span>{t('roster.legend_locked')}</span>
		</Inline>
		{#if cutoff != null}
			<Inline gap="xs">
				<IconWrapper name="lucide:scissors" class="size-3" />
				<span>{t('roster.cutoff_range', { start: cutoff.start, end: cutoff.end })}</span>
			</Inline>
		{/if}
		<!--
			The glyph key, collapsed by default. `R`, `O`, `L` and a shift code are mnemonic enough that
			most readers never open it, which is the test a key should pass; it is here for the handful
			that are not (`⧗`, `⚑`) and for a first visit.
		-->
		<button
			type="button"
			class="underline underline-offset-2"
			aria-expanded={marksOpen}
			onclick={() => (marksOpen = !marksOpen)}
		>
			<Inline as="span" gap="xs" align="center">
				<IconWrapper
					name={marksOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
					class="size-3"
				/>
				{t('roster.legend_marks')}
			</Inline>
		</button>
	</Cluster>
	{#if marksOpen}
		<Cluster gap="sm" shrink={false} class="pt-1 text-xs leading-5 text-muted-foreground">
			{#each DAY_MARK_KEY as entry (entry.mark)}
				<Inline gap="xs">
					<span class="inline-block w-4 text-center font-medium text-foreground">{entry.mark}</span>
					<span>{t(entry.labelKey)}</span>
				</Inline>
			{/each}
			{#each lockRungs as rung (rung)}
				{#if LOCK_RAIL_PRESENTATION[rung].railClassName !== ''}
					<Inline gap="xs">
						<span
							class={cn(
								'inline-block h-3 w-1 rounded-sm',
								rung === 'IN_DRAFT_RUN' && 'bg-brand/40',
								rung === 'CONSUMED' && 'bg-brand/70',
								rung === 'PAID' && 'bg-brand'
							)}
						></span>
						<span>{t(LOCK_RAIL_PRESENTATION[rung].labelKey)}</span>
					</Inline>
				{/if}
			{/each}
		</Cluster>
	{/if}
{/snippet}

{#snippet boardHeader()}
	<!-- The header viewport clips; the rows below remain the one scroll owner on both axes. -->
	<div
		class="relative h-10 overflow-hidden border-b bg-card text-xs"
		aria-hidden="true"
		onwheel={handleBoardHeaderWheel}
	>
		<div
			class="absolute inset-y-0 left-0 z-20 flex w-40 items-center border-r bg-card px-3 font-semibold"
		>
			{t('roster.person')}
		</div>
		<div class="absolute inset-y-0 right-0 left-40 overflow-hidden">
			<div bind:this={boardHeaderTrack} class="flex h-full w-max will-change-transform">
				{#each days as date (date)}
					{@const holiday = holidayNames.get(date)}
					{@const settled = !loading && locks.get(date)?.kind === 'SETTLED'}
					<div
						title={holiday == null ? undefined : `${t(HOLIDAY_PRESENTATION.labelKey)}: ${holiday}`}
						class={cn(
							'flex h-10 w-15 min-w-15 max-w-15 flex-col items-center justify-center bg-card text-center font-medium',
							isWeekend(date) && 'bg-muted',
							holiday != null && HOLIDAY_PRESENTATION.headerClassName,
							date === today && 'font-semibold ring-2 ring-inset ring-brand',
							date === cutoffStartsAt && 'border-l-2 border-l-brand',
							settled && 'border-r-2 border-r-brand/60',
							date < today && !settled && 'text-muted-foreground'
						)}
					>
						<span class="block text-meta">
							{settled
								? '🔒'
								: holiday == null
									? WEEKDAY_LETTERS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!
									: HOLIDAY_PRESENTATION.mark}
						</span>
						<span class="block tabular-nums">{decodeNumber(date.slice(8, 10))}</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/snippet}

{#snippet boardColumns()}
	<col style:width={`${PERSON_TRACK_REM}rem`} />
	{#each days as date (date)}
		<col style:width={`${DAY_TRACK_REM}rem`} />
	{/each}
{/snippet}

{#snippet boardLoadingSkeleton()}
	<!-- repository-health:allow UI3 -- the skeleton is the same person-by-day cross-tab as the board below, not one collection's rows. -->
	<table
		class="table-fixed border-separate border-spacing-0 text-left text-xs"
		style:width={boardTrackWidth}
		aria-hidden="true"
	>
		<colgroup>{@render boardColumns()}</colgroup>
		<tbody>
			{#each Array(16) as _, rowIndex (rowIndex)}
				<tr>
					<th
						class="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-r border-b bg-card px-3 py-1.5"
					>
						<Stack gap="xs">
							<Skeleton class="h-3 w-16" />
							<Skeleton class="h-2.5 w-24" />
						</Stack>
					</th>
					{#each days as date (date)}
						<td class="w-15 min-w-15 max-w-15 border-b p-1">
							<Skeleton class="h-9 w-full rounded-sm" />
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

{#if people.length === 0 && !loading}
	<p class="text-sm text-muted-foreground">
		{t('roster.no_employments')}
	</p>
{:else}
	<Cover as="div" gap="sm" bottom={legend} aria-busy={loading}>
		{#if loading}
			<span class="sr-only" role="status">{t('app.scheduling.loading_month', { month })}</span>
		{/if}
		<Cover as="div" gap="none" top={boardHeader} class="rounded-lg border bg-card">
			<Scroll
				bind:ref={boardElement}
				axis="both"
				name={t('roster.board_scroll_name')}
				class="relative bg-card"
				onscroll={syncBoardHeader}
			>
				{#if loading}
					{@render boardLoadingSkeleton()}
				{:else}
					<!-- repository-health:allow UI3 -- a person-by-day board is a derived cross-tab of four collections, not one collection's rows. -->
					<table
						class="table-fixed border-separate border-spacing-0 text-left text-xs"
						style:width={boardTrackWidth}
					>
						<colgroup>{@render boardColumns()}</colgroup>
						<tbody>
							{#if topSpacer > 0}
								<tr aria-hidden="true"
									><td colspan={days.length + 1} style:height={`${topSpacer}px`}></td></tr
								>
							{/if}
							{#each virtualRows as virtualRow (virtualRow.key)}
								{@const personIndex = virtualRow.index}
								{@const person = people[personIndex]!}
								<tr data-index={personIndex}>
									<th
										scope="row"
										class="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-r border-b bg-card px-3 py-1.5 text-left font-normal"
									>
										<span class="block truncate font-mono tabular-nums">{person.number}</span>
										<span class="block truncate text-micro text-muted-foreground"
											>{person.name}</span
										>
									</th>
									{#each days as date, dayIndex (date)}
										{@const day = facts.get(personDayKey(person.id, date))}
										{@const rung = rungOf(day)}
										<!--
									`day.past !== true` used to be a fourth condition here, and deleting it is
									§2's correctness fix. A day that has already happened is the *normal* day to
									be editing attendance on — a punch is keyed in after the shift, not before it
									— and freezing every past cell made the board useless for the one job it was
									being asked to do. What locks a day is a payroll run's claim over it, which
									is what `rung` reads, and nothing about the calendar.
								-->
										{@const cellEditable =
											editable && day?.employmentState === 'ACTIVE' && !lockRungFreezes(rung)}
										<!--
									OPENING A DAY IS NOT EDITING IT, and conflating the two is what made this board
									feel dead. `cellEditable` gates the WRITES — it is false in a month with no draft
									roster, and false on a day payroll has taken — and it used to gate `onSelectDay`
									as well. So on the months an operator most needs to look at (a published one, a
									settled one, the current month before anyone has opened it for planning) every
									cell answered a click with nothing at all, and the day sheet was unreachable on
									the very days whose lock it exists to explain.

									A cell opens whenever there is a person-day behind it. The sheet then decides for
									itself what may be changed: `planEditable` needs a draft month, `attendanceEditable`
									needs an unfrozen day — and attendance is writable in a month that was never
									drafted, because a punch belongs to the day and not to a roster, which is the same
									rule `importAttendance` already follows. On a frozen day the sheet is a reader, and
									its LOCK panel is the answer to "why can't I change this".
								-->
										{@const cellOpenable = day != null && day.employmentState === 'ACTIVE'}
										{@const armed =
											swapSource != null &&
											swapSource.employmentId === person.id &&
											swapSource.date === date}
										{@const swapTarget =
											swappable &&
											cellEditable &&
											swapSource != null &&
											swapPairAllowed(swapSource, { employmentId: person.id, date })}
										{@const firstConflict = day?.conflicts[0] ?? null}
										<td
											class={cn(
												'w-15 min-w-15 max-w-15 border-b p-0.5 text-center',
												holidayNames.has(date) && HOLIDAY_PRESENTATION.className,
												date === cutoffStartsAt && 'border-l-2 border-l-brand',
												day?.lock.kind === 'SETTLED' && 'border-r-2 border-r-brand/60'
											)}
										>
											<Tooltip side="top" sideOffset={4} contentClass="max-w-80">
												{#snippet trigger({ props })}
													<button
														{...props}
														type="button"
														aria-label={describeDay(day, `${person.name} · ${date}`, t)}
														aria-haspopup={cellOpenable ? 'dialog' : undefined}
														tabindex={activeCellKey === personDayKey(person.id, date) ? 0 : -1}
														data-roster-cell={`${personIndex}:${dayIndex}`}
														draggable={swappable && cellEditable}
														class={cn(
															'relative grid h-9 w-full min-w-12 content-center rounded-sm px-0.5 text-center tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
															day == null
																? 'bg-muted/20'
																: STATUS_PRESENTATION[day.status].className,
															// The lock rail: a channel of its own, drawn as an inset left border so it
															// composes with the status fill and the holiday tint instead of replacing
															// either. Every class is a literal variant in LOCK_RAIL_PRESENTATION.
															LOCK_RAIL_PRESENTATION[rung].railClassName,
															cellOpenable
																? 'cursor-pointer hover:ring-1 hover:ring-ring'
																: 'cursor-default',
															// Two literal variants, not one assembled from a condition: the armed cell
															// is the loud one and a legal partner is the quiet one, and both have to
															// survive Tailwind's source scan.
															armed && 'ring-2 ring-brand ring-offset-2',
															swapTarget && 'ring-2 ring-brand/50',
															// Planned extra work is the `OT` glyph and a heavier weight, not a
															// colour. It used to borrow the warning hue, which now means "somebody
															// must act on this day" — and a shift the roster deliberately planned
															// over a rest day is the opposite of a fault.
															day?.plannedOT === true && 'font-semibold',
															quietPast(day) && 'opacity-70'
														)}
														onclick={() => {
															// An armed swap consumes the next compatible click; the day sheet is
															// still one click away, on any cell that is not a legal partner.
															if (swapTarget) {
																completeSwap({ employmentId: person.id, date });
																return;
															}
															if (armed) {
																swapSource = null;
																return;
															}
															if (cellOpenable) onSelectDay?.(person.id, date);
														}}
														onfocus={() => (requestedCellKey = personDayKey(person.id, date))}
														onkeydown={(event) => {
															if (
																swappable &&
																cellEditable &&
																(event.key === 'x' || event.key === 'X')
															) {
																event.preventDefault();
																if (swapTarget) completeSwap({ employmentId: person.id, date });
																else if (armed) swapSource = null;
																else armSwap({ employmentId: person.id, date });
																return;
															}
															handleCellKeydown(event, personIndex, dayIndex);
														}}
														ondragstart={(event) => {
															if (!swappable || !cellEditable) return;
															armSwap({ employmentId: person.id, date });
															// Firefox refuses to start a drag without payload; the pair is read
															// from `swapSource`, so the value itself is only ever a marker.
															event.dataTransfer?.setData(
																'text/plain',
																personDayKey(person.id, date)
															);
														}}
														ondragover={(event) => {
															if (swapTarget) event.preventDefault();
														}}
														ondrop={(event) => {
															if (!swapTarget) return;
															event.preventDefault();
															completeSwap({ employmentId: person.id, date });
														}}
														ondragend={() => {
															// Only clear an arming this drag created. A `swapSource` set from the
															// day sheet survives, because the operator armed it deliberately.
															if (armed) swapSource = null;
														}}
													>
														{#if firstConflict != null}
															<span
																class={cn(
																	'absolute top-0.5 right-0.5 size-1.5 rounded-full',
																	CONFLICT_PRESENTATION[firstConflict].className
																)}
																title={t(CONFLICT_PRESENTATION[firstConflict].labelKey)}
															></span>
														{/if}
														{#if LOCK_RAIL_PRESENTATION[rung].padlock !== ''}
															<!--
														The padlock is a second, redundant channel for the two rungs that
														actually refuse a write. Colour alone is not an accessible way to say
														"locked", and the rail is four values on one narrow strip.
													-->
															<span
																class="absolute top-0.5 left-0.5 text-[0.5rem] leading-none"
																aria-hidden="true"
																title={t(LOCK_RAIL_PRESENTATION[rung].labelKey)}
															>
																{LOCK_RAIL_PRESENTATION[rung].padlock}
															</span>
														{/if}
														<span class="block truncate text-xs leading-4">
															{day == null ? '' : planGlyph(day)}
														</span>
														<span
															class={cn(
																'block truncate text-[0.625rem] leading-3',
																day == null
																	? 'text-muted-foreground/50'
																	: day.past
																		? actualMarkClass(day)
																		: 'text-muted-foreground/70'
															)}
														>
															{day == null
																? ''
																: day.past
																	? actualMark(day)
																	: (shiftTimeCue(day) ?? actualMark(day))}
														</span>
													</button>
												{/snippet}
												{#snippet content()}
													{#if day != null}
														<Stack gap="sm" class="min-w-64 max-w-80 text-xs">
															<div class="border-b border-primary-foreground/15 pb-2">
																<p class="font-semibold">{person.name}</p>
																<p class="font-mono text-micro text-primary-foreground/65">
																	{person.number} · {date}
																</p>
															</div>
															<Stack
																gap="md"
																class="relative pl-5 before:absolute before:top-1 before:bottom-1 before:left-1.5 before:w-px before:bg-primary-foreground/20"
															>
																<div class="relative">
																	<span
																		class="absolute top-1 -left-[1.125rem] size-2 rounded-full bg-brand"
																	></span>
																	<p class="text-overline text-primary-foreground/55">
																		{t('roster.timeline_schedule')}
																	</p>
																	<p class="leading-4">{scheduleSummary(day)}</p>
																</div>
																<div class="relative">
																	<span
																		class="absolute top-1 -left-[1.125rem] size-2 rounded-full bg-success"
																	></span>
																	<p class="text-overline text-primary-foreground/55">
																		{t('roster.timeline_attendance')}
																	</p>
																	<p class="leading-4">{attendanceSummary(day)}</p>
																</div>
																{#if dayNotes(day) != null}
																	<div class="relative">
																		<span
																			class="absolute top-1 -left-[1.125rem] size-2 rounded-full bg-info"
																		></span>
																		<p class="text-overline text-primary-foreground/55">
																			{t('roster.timeline_notes')}
																		</p>
																		<p class="leading-4">{dayNotes(day)}</p>
																	</div>
																{/if}
															</Stack>
														</Stack>
													{/if}
												{/snippet}
											</Tooltip>
										</td>
									{/each}
								</tr>
							{/each}
							{#if bottomSpacer > 0}
								<tr aria-hidden="true"
									><td colspan={days.length + 1} style:height={`${bottomSpacer}px`}></td></tr
								>
							{/if}
						</tbody>
					</table>
				{/if}
			</Scroll>
		</Cover>
	</Cover>
{/if}
