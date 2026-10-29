<!--
	The period at a glance: one row per person, one narrow column per day, plan and clock in the same
	cell (`day_cell.svelte`). A cell opens the day's `roster_entry` record, or a new one for a day only projected.

	The rows are the one scroll owner, on both axes; the person column is sticky on x and the day
	header is chrome outside the scrollport whose track follows the body's `scrollLeft`.
-->
<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import { Bound, Cover, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { cn, openRecord } from '@norbital-ai/ui';
	import { PlainDate } from '@norbital-ai/std/date';
	import Skeleton from '../components/skeleton.svelte';
	import DayCell from './day_cell.svelte';
	import { openCreate } from '../scopes/create_values.js';
	import { plannedShiftOf } from './shift_code.js';
	import { bolt } from '$bolt';
	import {
		buildDays,
		datesBetween,
		dayKey,
		describeDay,
		entryRead,
		holidayRead,
		isWeekend,
		leaveRead,
		patternRead,
		shiftRead
	} from './month_board.js';
	import type { AttendancePolicy } from '../../payroll_engine/payslip/context.js';

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
		policy,
		today
	}: {
		people: readonly Person[];
		companyId: Id<'entity'>;
		/** The first and last day shown, both inclusive. */
		from: string;
		to: string;
		timeZone: string;
		/** The governing version's `payroll.attendance`. */
		policy: AttendancePolicy | null;
		today: string;
	} = $props();

	const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
	const PERSON_REM = 10;
	const DAY_REM = 4.5;

	const dates = $derived(datesBetween(from, to));
	const ids = $derived(people.map((person) => person.id));
	const entries = $derived.by(() => (ids.length === 0 ? null : entryRead(ids, from, to)));
	const holidays = $derived.by(() => holidayRead(companyId, from, to));
	const leave = $derived.by(() => (ids.length === 0 ? null : leaveRead(ids, from, to)));
	/** What plans a day without a roster shift: the person's terms' pattern, and the entity's shifts by code. */
	const plans = $derived.by(() =>
		ids.length === 0
			? null
			: bolt.query({ employment_contract: { where: { id: { in: [...ids] } }, fields: ['facts'] } })
	);
	const shifts = $derived.by(() => shiftRead(companyId));
	const patterns = $derived.by(() => patternRead(companyId));
	const shiftOf = $derived(
		plannedShiftOf({
			contracts: plans?.current?.employment_contract.rows ?? [],
			definitions: shifts?.current?.shift_definition.rows ?? [],
			patterns: patterns?.current?.shift_pattern.rows ?? []
		})
	);
	const loading = $derived(entries?.current === undefined && ids.length > 0);
	const holidayByDate = $derived(
		new Map(
			(holidays?.current?.holiday.rows ?? []).map((row) => [
				String(row.date).slice(0, 10),
				row.name
			])
		)
	);
	const days = $derived(
		buildDays({
			dates,
			people,
			entries: entries?.current?.roster_entry.rows ?? [],
			holidays: holidays?.current?.holiday.rows ?? [],
			leave: leave?.current?.leave_catalog_entry.rows ?? [],
			timeZone,
			policy,
			shiftOf
		})
	);
	const error = $derived(
		entries?.error?.message ?? holidays?.error?.message ?? leave?.error?.message
	);

	let body: HTMLElement | null = $state(null);
	let track: HTMLElement | null = $state(null);
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
		<Stack gap="none" justify="center" class="w-40 border-r bg-card px-3">
			<span class="font-semibold">{bolt.t('roster.person')}</span>
			<span class="text-tiny text-muted-foreground">
				{bolt.t('roster.plan_recorded')} · {bolt.t('component.work_day_actual')}
			</span>
		</Stack>
		<Bound size="fill" clip>
			<div bind:this={track} class="h-full w-max will-change-transform">
				<Inline gap="none" align="stretch" size="fill">
					{#each dates as date (date)}
						{@const holiday = holidayByDate.get(date)}
						<Stack
							gap="none"
							align="center"
							justify="center"
							title={holiday}
							class={cn(
								'h-10 w-18 min-w-18 max-w-18 bg-card text-center font-medium',
								isWeekend(date) && 'bg-muted',
								holiday != null && 'bg-warning/10',
								date === today && 'font-semibold ring-2 ring-inset ring-brand',
								date < today && 'text-muted-foreground'
							)}
						>
							<span class="block text-meta">
								{holiday == null
									? WEEKDAY_LETTERS[new Date(`${date}T00:00:00Z`).getUTCDay()]
									: bolt.t('roster.public_holiday_mark')}
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
	<p class="text-sm text-muted-foreground">{bolt.t('roster.no_employments')}</p>
{:else}
	<Cover
		as="div"
		gap="none"
		size="fill"
		top={header}
		class="rounded-lg border bg-card"
		aria-busy={loading}
	>
		<Scroll
			bind:ref={body}
			axis="both"
			size="fill"
			name={bolt.t('roster.board_scroll_name')}
			class="relative bg-card"
			onscroll={syncHeader}
		>
			<!-- repository-health:allow UI3 -- a person-by-day board is a cross-tab of four models, not one model's rows. -->
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
								<td class="w-18 min-w-18 max-w-18 border-b p-0.5">
									{#if loading || day == null}
										<Skeleton class="h-14 w-full rounded-sm" />
									{:else}
										{@const label = describeDay(day, `${person.name} · ${date}`, timeZone)}
										<button
											type="button"
											class={cn(
												'block h-14 w-full rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
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
												day.entryId == null
													? openCreate('roster_entry', {
															employment_id: person.id,
															work_date: PlainDate(date)
														})
													: openRecord('roster_entry', day.entryId)}
										>
											<DayCell {day} />
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
