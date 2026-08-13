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
	import { Cluster, Cover, Inline, Scroll } from '@norbital-ai/ui/layout';
	import { cn } from '@norbital-ai/ui/utils';
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
</script>

{#snippet legend()}
	<Cluster gap="sm" class="text-xs leading-5 text-muted-foreground">
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
		<Scroll axis="both" name={t('roster.board_scroll_name')} class="rounded-lg border bg-card">
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
					{#each people as person (person.id)}
						<tr>
							<th
								scope="row"
								class="sticky left-0 z-10 border-r border-b bg-card px-3 py-1.5 text-left font-normal"
							>
								<span class="block truncate font-mono tabular-nums">{person.number}</span>
								<span class="block truncate text-micro text-muted-foreground">{person.name}</span>
							</th>
							{#each days as date (date)}
								{@const day = facts.get(`${person.id}:${date}`)}
								{@const cellEditable = editable && day?.employmentState === 'ACTIVE'}
								<td
									class={cn(
										'border-b p-0.5 text-center',
										holidayNames.has(date) && HOLIDAY_PRESENTATION.className,
										date === cutoffStartsAt && 'border-l-2 border-l-brand'
									)}
								>
									<Tooltip
										side="top"
										sideOffset={4}
										contentClass="max-w-80"
										text={describeDay(day, `${person.name} · ${person.number} · ${date}`, t)}
									>
										{#snippet trigger({ props })}
											<button
												{...props}
												type="button"
												aria-label={describeDay(day, `${person.name} · ${date}`, t)}
												aria-disabled={!cellEditable}
												class={cn(
													'grid h-9 w-full min-w-12 content-center rounded-sm px-0.5 text-center tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
													day == null ? 'bg-muted/20' : STATUS_PRESENTATION[day.status].className,
													cellEditable
														? 'cursor-pointer hover:ring-1 hover:ring-ring'
														: 'cursor-default'
												)}
												onclick={() => cellEditable && onSelectDay?.(person.id, date)}
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
									</Tooltip>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	</Cover>
{/if}
