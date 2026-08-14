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
	reel this used to be. The two headings stay put with `position: sticky` — the day header on `y`,
	the person column on `x`, and the corner cell on both — which is the same "header sticky, body
	scrolls" contract the layout guide records for `CollectionTable`. `CollectionTable` reaches it by
	hoisting its header out of the scrollport and translating it, because its rows are virtualised and
	absolutely positioned; a real `<table>` gets there with sticky cells and no synchronisation code.
-->
<script lang="ts">
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { Cluster, Cover, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { cn } from '@norbital-ai/ui/utils';
	import { createVirtualizer } from '@norbital-ai/ui/utils/virtualizer.svelte';
	import {
		HOLIDAY_PRESENTATION,
		STATUS_PRESENTATION,
		describeDay,
		monthDays,
		shiftTimeCue,
		statusGlyph,
		type DayFacts,
		type DayStatus
	} from './roster-month.js';

	type Person = { readonly id: string; readonly number: string; readonly name: string };

	const { t } = useI18n<TenantI18nKeys>();

	let {
		month,
		people,
		facts,
		today,
		holidayNames,
		cutoff = null,
		onSelectDay,
		editable = false
	}: {
		month: string;
		people: readonly Person[];
		facts: ReadonlyMap<string, DayFacts>;
		today: string;
		/**
		 * The company calendar, keyed by date. Public holidays are drawn as a column of the board
		 * rather than as a mark on each person's day, because that is where they come from: the
		 * calendar, not the roster.
		 */
		holidayNames: ReadonlyMap<string, string>;
		cutoff?: { readonly start: string; readonly end: string } | null;
		onSelectDay?: (employmentId: string, date: string) => void;
		editable?: boolean;
	} = $props();

	const days = $derived(monthDays(month));
	let boardElement: HTMLElement | null = $state(null);
	let requestedCellKey = $state('');
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

	function weekdayLetter(date: string): string {
		return WEEKDAY_LETTERS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!;
	}

	function isWeekend(date: string): boolean {
		const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
		return day === 0 || day === 6;
	}

	/** Draw a boundary only when the real cut-off starts in this month; never clamp it to day one. */
	const cutoffStartsAt = $derived(
		cutoff != null && days.includes(cutoff.start) ? cutoff.start : null
	);

	const legendStatuses = $derived(
		Object.entries(STATUS_PRESENTATION) as [
			DayStatus,
			{ labelKey: TenantI18nKeys; className: string }
		][]
	);

	const activeCellKey = $derived.by(() => {
		if (requestedCellKey) {
			const [personId, date] = requestedCellKey.split(':');
			if (people.some((person) => person.id === personId) && days.includes(date ?? '')) {
				return requestedCellKey;
			}
		}
		return people[0] == null || days[0] == null ? '' : `${people[0].id}:${days[0]}`;
	});

	function focusCell(personIndex: number, dayIndex: number): void {
		const nextPerson = Math.min(Math.max(personIndex, 0), people.length - 1);
		const nextDay = Math.min(Math.max(dayIndex, 0), days.length - 1);
		const person = people[nextPerson];
		const date = days[nextDay];
		if (person == null || date == null) return;
		requestedCellKey = `${person.id}:${date}`;
		rowVirtualizer.scrollToIndex(nextPerson, { align: 'auto' });
		requestAnimationFrame(() => {
			boardElement
				?.querySelector<HTMLElement>(`[data-roster-cell="${nextPerson}:${nextDay}"]`)
				?.focus();
		});
	}

	function handleCellKeydown(event: KeyboardEvent, personIndex: number, dayIndex: number): void {
		const movement =
			event.key === 'ArrowLeft'
				? [0, -1]
				: event.key === 'ArrowRight'
					? [0, 1]
					: event.key === 'ArrowUp'
						? [-1, 0]
						: event.key === 'ArrowDown'
							? [1, 0]
							: null;
		if (movement == null) return;
		event.preventDefault();
		focusCell(personIndex + movement[0]!, dayIndex + movement[1]!);
	}

	function scheduleSummary(day: DayFacts): string {
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
			return t('roster.attendance_intervals', { count: day.workedIntervalCount });
		}
		return t('roster.no_attendance');
	}

	function contextSummary(day: DayFacts): string {
		const context = [
			day.holidayName == null ? null : `${t(HOLIDAY_PRESENTATION.labelKey)}: ${day.holidayName}`,
			day.leaveCode == null
				? null
				: `${day.leaveCode}${day.halfDayLeave ? ` (${t('roster.half_day')})` : ''}`,
			day.withinCutoff ? t('roster.inside_cutoff') : null
		].filter((part): part is string => part != null);
		return context.join(' · ') || t('roster.no_day_exception');
	}
</script>

{#snippet legend()}
	<Cluster gap="sm" class="shrink-0 text-xs leading-5 text-muted-foreground">
		{#each legendStatuses as [status, presentation] (status)}
			<Inline gap="xs">
				<span class={cn('inline-block size-2.5 rounded-sm', presentation.className)}></span>
				<span>{t(presentation.labelKey)}</span>
			</Inline>
		{/each}
		<Inline gap="xs">
			<span class={cn('inline-block size-2.5 rounded-sm', HOLIDAY_PRESENTATION.headerClassName)}
			></span>
			<span>{t('roster.holiday_from_calendar', { label: t(HOLIDAY_PRESENTATION.labelKey) })}</span>
		</Inline>
		{#if cutoff != null}
			<Inline gap="xs">
				<IconWrapper name="lucide:scissors" class="size-3" />
				<span>{t('roster.cutoff_range', { start: cutoff.start, end: cutoff.end })}</span>
			</Inline>
		{/if}
	</Cluster>
{/snippet}

{#if people.length === 0}
	<p class="text-sm text-muted-foreground">
		{t('roster.no_employments')}
	</p>
{:else}
	<Cover as="div" gap="sm" bottom={legend}>
		<Scroll
			bind:ref={boardElement}
			axis="both"
			name={t('roster.board_scroll_name')}
			class="rounded-lg border bg-card"
		>
			<!-- stupidity:allow UI3 -- a person-by-day board is a derived cross-tab of four collections, not one collection's rows. -->
			<table class="border-separate border-spacing-0 text-left text-xs">
				<thead>
					<tr>
						<th
							scope="col"
							class="sticky top-0 left-0 z-30 min-w-[10rem] border-r border-b bg-card px-3 py-2 text-xs font-semibold"
						>
							{t('roster.person')}
						</th>
						{#each days as date (date)}
							{@const holiday = holidayNames.get(date)}
							<th
								scope="col"
								title={holiday == null
									? undefined
									: `${t(HOLIDAY_PRESENTATION.labelKey)}: ${holiday}`}
								class={cn(
									'sticky top-0 z-20 w-13 min-w-13 border-b bg-card px-0 py-1 text-center font-medium',
									// Every fill here is opaque: see HOLIDAY_PRESENTATION.headerClassName. `today` is
									// a ring rather than a fill so it composes with the date fills instead of
									// replacing one — a public holiday that happens to be today is still both.
									isWeekend(date) && 'bg-muted',
									holiday != null && HOLIDAY_PRESENTATION.headerClassName,
									date === today && 'font-semibold ring-2 ring-inset ring-brand',
									date === cutoffStartsAt && 'border-l-2 border-l-brand'
								)}
							>
								<span class="block text-xs text-muted-foreground">
									{holiday == null ? weekdayLetter(date) : HOLIDAY_PRESENTATION.mark}
								</span>
								<span class="block tabular-nums">{Number(date.slice(8, 10))}</span>
							</th>
						{/each}
					</tr>
				</thead>
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
								class="sticky left-0 z-10 border-r border-b bg-card px-3 py-1.5 text-left font-normal"
							>
								<span class="block truncate font-mono tabular-nums">{person.number}</span>
								<span class="block truncate text-micro text-muted-foreground">{person.name}</span>
							</th>
							{#each days as date, dayIndex (date)}
								{@const day = facts.get(`${person.id}:${date}`)}
								{@const cellEditable = editable && day?.employmentState === 'ACTIVE'}
								<td
									class={cn(
										'border-b p-0.5 text-center',
										holidayNames.has(date) && HOLIDAY_PRESENTATION.className,
										date === cutoffStartsAt && 'border-l-2 border-l-brand'
									)}
								>
									<Tooltip side="top" sideOffset={4} contentClass="max-w-80">
										{#snippet trigger({ props })}
											<button
												{...props}
												type="button"
												aria-label={describeDay(day, `${person.name} · ${date}`, t)}
												aria-haspopup={cellEditable ? 'dialog' : undefined}
												tabindex={activeCellKey === `${person.id}:${date}` ? 0 : -1}
												data-roster-cell={`${personIndex}:${dayIndex}`}
												class={cn(
													'grid h-9 w-full min-w-12 content-center rounded-sm px-0.5 text-center tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
													day == null ? 'bg-muted/20' : STATUS_PRESENTATION[day.status].className,
													cellEditable
														? 'cursor-pointer hover:ring-1 hover:ring-ring'
														: 'cursor-default'
												)}
												onclick={() => cellEditable && onSelectDay?.(person.id, date)}
												onfocus={() => (requestedCellKey = `${person.id}:${date}`)}
												onkeydown={(event) => handleCellKeydown(event, personIndex, dayIndex)}
											>
												<span class="block truncate text-xs font-semibold leading-4">
													{day == null ? '' : statusGlyph(day)}
												</span>
												{#if shiftTimeCue(day) != null}
													<span class="block truncate text-micro leading-3 opacity-80">
														{shiftTimeCue(day)}
													</span>
												{/if}
											</button>
										{/snippet}
										{#snippet content()}
											{#if day != null}
												<Stack gap="sm" class="min-w-64 max-w-80 text-xs">
													<div class="border-b border-white/15 pb-2">
														<p class="font-semibold text-white">{person.name}</p>
														<p class="font-mono text-micro text-white/65">
															{person.number} · {date}
														</p>
													</div>
													<div
														class="relative space-y-3 pl-5 before:absolute before:top-1 before:bottom-1 before:left-1.5 before:w-px before:bg-white/20"
													>
														<div class="relative">
															<span
																class="absolute top-1 -left-[1.125rem] size-2 rounded-full bg-brand"
															></span>
															<p
																class="text-micro font-semibold tracking-wide text-white/55 uppercase"
															>
																{t('roster.timeline_schedule')}
															</p>
															<p class="leading-4">{scheduleSummary(day)}</p>
														</div>
														<div class="relative">
															<span
																class="absolute top-1 -left-[1.125rem] size-2 rounded-full bg-success"
															></span>
															<p
																class="text-micro font-semibold tracking-wide text-white/55 uppercase"
															>
																{t('roster.timeline_attendance')}
															</p>
															<p class="leading-4">{attendanceSummary(day)}</p>
														</div>
														<div class="relative">
															<span
																class="absolute top-1 -left-[1.125rem] size-2 rounded-full bg-info"
															></span>
															<p
																class="text-micro font-semibold tracking-wide text-white/55 uppercase"
															>
																{t('roster.timeline_context')}
															</p>
															<p class="leading-4">{contextSummary(day)}</p>
														</div>
													</div>
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
		</Scroll>
	</Cover>
{/if}
