<!--
	The period at a glance: one row per person, one narrow column per day, plan and clock in the same
	cell (`day_cell.svelte`). A cell opens the day's clock (`day_dialog.svelte`).

	The rows are the one scroll owner, on both axes; the person column is sticky on x and the day
	header is chrome outside the scrollport whose track follows the body's `scrollLeft`.
-->
<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import { Bound, Cover, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { cn } from '@norbital-ai/ui';
	import { t } from '../i18n/t.js';
	import { liveRows } from '../state/live.svelte.js';
	import Skeleton from '../components/skeleton.svelte';
	import DayCell from './day_cell.svelte';
	import DayDialog from './day_dialog.svelte';
	import {
		buildDays,
		datesBetween,
		dayKey,
		describeDay,
		entryRead,
		holidayRead,
		isWeekend,
		leaveRead,
		type Day
	} from './month_board.js';

	type Person = {
		readonly id: Id<'employment_contract'>;
		readonly number: string;
		readonly name: string;
		readonly from: string;
		readonly to: string | null;
	};

	let {
		people,
		companyId,
		from,
		to,
		timeZone,
		today
	}: {
		people: readonly Person[];
		companyId: Id<'entity'>;
		/** The first and last day shown, both inclusive. */
		from: string;
		to: string;
		timeZone: string;
		today: string;
	} = $props();

	const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
	const PERSON_REM = 10;
	const DAY_REM = 3.75;

	const dates = $derived(datesBetween(from, to));
	const ids = $derived(people.map((person) => person.id));
	const entries = liveRows(() => (ids.length === 0 ? null : entryRead(ids, from, to)));
	const holidays = liveRows(() => holidayRead(companyId, from, to));
	const leave = liveRows(() => (ids.length === 0 ? null : leaveRead(ids, from, to)));
	const loading = $derived(entries.current === undefined && ids.length > 0);
	const holidayByDate = $derived(
		new Map((holidays.current ?? []).map((row) => [String(row.date).slice(0, 10), row.name]))
	);
	const days = $derived(
		buildDays({
			dates,
			people,
			entries: entries.current ?? [],
			holidays: holidays.current ?? [],
			leave: leave.current ?? []
		})
	);
	const error = $derived(entries.error ?? holidays.error ?? leave.error);

	let body: HTMLElement | null = $state(null);
	let track: HTMLElement | null = $state(null);
	let editing = $state<{
		employmentId: Id<'employment_contract'>;
		person: string;
		day: Day;
	} | null>(null);
	const syncHeader = () => {
		if (body != null && track != null) track.style.transform = `translateX(${-body.scrollLeft}px)`;
	};
	/** Wheel over the fixed header scrolls the rows it labels. */
	const forwardWheel = (event: WheelEvent) => {
		if (body == null) return;
		const [left, top] = [body.scrollLeft, body.scrollTop];
		body.scrollLeft += event.deltaX;
		body.scrollTop += event.deltaY;
		if (body.scrollLeft !== left || body.scrollTop !== top) event.preventDefault();
	};
</script>

{#snippet header()}
	<Inline
		gap="none"
		align="stretch"
		class="h-10 border-b bg-card text-xs"
		aria-hidden="true"
		onwheel={forwardWheel}
	>
		<Inline gap="none" shrink={false} class="w-40 border-r bg-card px-3 font-semibold"
			>{t('roster.person')}</Inline
		>
		<Bound size="full" clip grow>
			<div bind:this={track} class="h-full w-max will-change-transform">
				<Inline gap="none" align="stretch" fill>
					{#each dates as date (date)}
						{@const holiday = holidayByDate.get(date)}
						<Stack
							gap="none"
							align="center"
							justify="center"
							shrink={false}
							title={holiday}
							class={cn(
								'h-10 w-15 min-w-15 max-w-15 bg-card text-center font-medium',
								isWeekend(date) && 'bg-muted',
								holiday != null && 'bg-warning/10',
								date === today && 'font-semibold ring-2 ring-inset ring-brand',
								date < today && 'text-muted-foreground'
							)}
						>
							<span class="block text-meta">
								{holiday == null
									? WEEKDAY_LETTERS[new Date(`${date}T00:00:00Z`).getUTCDay()]
									: t('roster.public_holiday_mark')}
							</span>
							<span class="block tabular-nums">{Number(date.slice(8, 10))}</span>
						</Stack>
					{/each}
				</Inline>
			</div>
		</Bound>
	</Inline>
{/snippet}

{#if error != null}
	<p class="text-sm text-destructive" role="alert">{error}</p>
{:else if people.length === 0}
	<p class="text-sm text-muted-foreground">{t('roster.no_employments')}</p>
{:else}
	<Cover as="div" gap="none" top={header} class="rounded-lg border bg-card" aria-busy={loading}>
		<Scroll
			bind:ref={body}
			axis="both"
			name={t('roster.board_scroll_name')}
			class="relative bg-card"
			onscroll={syncHeader}
		>
			<!-- repository-health:allow UI3 -- a person-by-day board is a cross-tab of four collections, not one collection's rows. -->
			<table
				class="table-fixed border-separate border-spacing-0 text-left text-xs"
				style:width={`${PERSON_REM + dates.length * DAY_REM}rem`}
			>
				<colgroup>
					<col style:width={`${PERSON_REM}rem`} />
					{#each dates as date (date)}<col style:width={`${DAY_REM}rem`} />{/each}
				</colgroup>
				<tbody>
					{#each people as person (person.id)}
						<tr>
							<th
								scope="row"
								// repository-health:allow UI19 -- sticky person column of the board table; Imposter position="sticky" cannot render as a `th`
								class="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-r border-b bg-card px-3 py-1.5 text-left font-normal"
							>
								<span class="block truncate font-mono tabular-nums">{person.number}</span>
								<span class="block truncate text-micro text-muted-foreground">{person.name}</span>
							</th>
							{#each dates as date (date)}
								{@const day = days.get(dayKey(person.id, date))}
								<td class="w-15 min-w-15 max-w-15 border-b p-0.5">
									{#if loading || day == null}
										<Skeleton class="h-12 w-full rounded-sm" />
									{:else}
										{@const label = describeDay(day, `${person.name} · ${date}`, timeZone)}
										<button
											type="button"
											class={cn(
												'block h-12 w-full rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
												day.employed
													? 'cursor-pointer hover:ring-1 hover:ring-ring'
													: 'cursor-default',
												date === today && 'ring-1 ring-brand'
											)}
											aria-label={label}
											title={label}
											aria-haspopup={day.employed ? 'dialog' : undefined}
											disabled={!day.employed}
											onclick={() =>
												(editing = { employmentId: person.id, person: person.name, day })}
										>
											<DayCell {day} {timeZone} dense />
										</button>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	</Cover>
{/if}

<DayDialog open={editing} {timeZone} onClose={() => (editing = null)} />
