<!--
	The period at a glance: one row per roster, one narrow column per day. A cell opens the day's
	roster entry, or creates one for that roster and date.
-->
<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { cn, openRecord, RecordShell, Sheet } from '@norbital-ai/ui';
	import DayCell from './day_cell.svelte';
	import {
		buildDays,
		datesBetween,
		dayKey,
		describeDay,
		isWeekend,
		type Day,
		type Person
	} from './month_board.js';

	type BoardEntry = {
		readonly id: string;
		readonly employment_id: string;
		readonly payroll_run_id?: string | null;
		readonly work_date: string;
		readonly shift_definition_id?: string | null;
		readonly planned_overtime_intervals?: unknown;
		readonly actual_worked_intervals?: unknown;
		readonly findings?: unknown;
	};
	type BoardPerson = Person & {
		readonly number: string;
		readonly name: string;
		readonly locked: boolean;
		readonly entries: readonly BoardEntry[];
	};

	let {
		companyId,
		from,
		to,
		today
	}: {
		companyId: Id<'entity'>;
		/** The first and last day shown, both inclusive. */
		from: string;
		to: string;
		today: string;
	} = $props();

	const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
	const PERSON_REM = 10;
	const DAY_REM = 4.5;

	let creating = $state<{ employmentId: Id<'employee_contract'>; date: string } | null>(null);

	const dates = $derived(datesBetween(from, to));
	const contracts = $derived(
		bolt.query({
			employee_contract: {
				where: { entity_id: { eq: companyId }, status: { eq: 'SEALED' } },
				fields: ['employee_id', 'employee_number', 'employee_name', 'effective_range', 'terms'],
				orderBy: { employee_number: 'asc' },
				limit: 10000
			}
		})
	);
	const ids = $derived((contracts.current?.employee_contract.rows ?? []).map((row) => row.id));
	const data = $derived.by(() =>
		ids.length === 0
			? null
			: bolt.query({
					roster_entry: {
						where: {
							employment_id: { in: [...ids] },
							work_date: { gte: PlainDate(from), lte: PlainDate(to) }
						},
						fields: [
							'employment_id',
							'work_date',
							'shift_definition_id',
							'planned_overtime_intervals',
							'actual_worked_intervals',
							'findings',
							'payroll_run_id'
						],
						limit: 10000
					},
					shift_definition: {
						where: { entity_id: { eq: companyId } },
						fields: ['code', 'variant'],
						limit: 10000
					},
					shift_pattern: {
						where: { entity_id: { eq: companyId } },
						fields: ['pattern', 'effective_range'],
						limit: 10000
					},
					holiday: {
						where: {
							entity_id: { eq: companyId },
							published_at: { isNull: false },
							date: { gte: PlainDate(from), lte: PlainDate(to) }
						},
						fields: ['date', 'name'],
						limit: 10000
					},
					leave_catalog_entry: {
						where: { employment_id: { in: [...ids] } },
						fields: ['employment_id', 'days', 'catalog_id', 'is_reversal'],
						limit: 10000
					},
					'leave_catalog_entry.catalog_id': { fields: ['code', 'name'] }
				})
	);
	const versions = $derived(
		bolt.query({
			entity_profile_version: {
				where: { entity_id: { eq: companyId }, status: { eq: 'SEALED' } },
				fields: ['effective_range', 'time_zone'],
				limit: 10000
			}
		})
	);
	const contractById = $derived(
		new Map((contracts.current?.employee_contract.rows ?? []).map((row) => [String(row.id), row]))
	);
	const entriesByEmployment = $derived.by(() => {
		const grouped = new Map<string, BoardEntry[]>();
		for (const entry of data?.current?.roster_entry.rows ?? []) {
			const employment = String(entry.employment_id);
			const list = grouped.get(employment) ?? [];
			list.push({
				id: entry.id,
				employment_id: employment,
				payroll_run_id: entry.payroll_run_id,
				work_date: String(entry.work_date),
				shift_definition_id: entry.shift_definition_id,
				planned_overtime_intervals: entry.planned_overtime_intervals,
				actual_worked_intervals: entry.actual_worked_intervals,
				findings: entry.findings
			});
			grouped.set(employment, list);
		}
		return grouped;
	});
	const covers = (range: { readonly from: string; readonly to: string | null }, date: string) =>
		String(range.from) <= date && (range.to == null || date <= String(range.to));
	const people = $derived.by(() => {
		const byPerson = new Map<
			string,
			NonNullable<typeof contracts.current>['employee_contract']['rows'][number][]
		>();
		for (const contract of contracts.current?.employee_contract.rows ?? []) {
			const range = contract.effective_range;
			// nobody stays on the board past the month they left
			if (String(range.from) > to || (range.to != null && String(range.to) < from)) continue;
			const employee = String(contract.employee_id);
			byPerson.set(employee, [...(byPerson.get(employee) ?? []), contract]);
		}
		return [...byPerson]
			.map(([employee, rows]): BoardPerson => {
				const ordered = rows.toSorted((left, right) =>
					String(left.effective_range.from).localeCompare(String(right.effective_range.from))
				);
				const latest = ordered.at(-1) ?? rows[0]!;
				const spells = ordered.map((contract) => ({
					id: String(contract.id),
					from: String(contract.effective_range.from),
					to: contract.effective_range.to == null ? null : String(contract.effective_range.to),
					patternId:
						contract.terms?.shift_pattern_id == null
							? null
							: String(contract.terms.shift_pattern_id),
					patternStart:
						contract.terms?.shift_pattern_start == null
							? null
							: String(contract.terms.shift_pattern_start)
				}));
				const entries = spells.flatMap(({ id }) => entriesByEmployment.get(id) ?? []);
				return {
					...spells.at(-1)!,
					id: employee,
					employee,
					contracts: spells,
					number: latest.employee_number,
					name: latest.employee_name ?? '',
					locked: entries.some((entry) => entry.payroll_run_id != null),
					entries
				};
			})
			.toSorted(
				(left, right) =>
					left.number.localeCompare(right.number) || left.name.localeCompare(right.name)
			);
	});
	const entries = $derived(people.flatMap((person) => person.entries));
	const locked = $derived(new Set(people.filter((person) => person.locked).map((p) => p.id)));
	const zoneOn = (date: string): string | null =>
		(versions.current?.entity_profile_version.rows ?? []).find((row) =>
			covers(
				{
					from: String(row.effective_range.from),
					to: row.effective_range.to == null ? null : String(row.effective_range.to)
				},
				date
			)
		)?.time_zone ?? null;
	const timeZone = $derived(
		zoneOn(from) ?? zoneOn(to) ?? Intl.DateTimeFormat().resolvedOptions().timeZone
	);
	const holidayByDate = $derived(
		new Map(
			(data?.current?.holiday.rows ?? []).map((row) => [String(row.date).slice(0, 10), row.name])
		)
	);
	const days = $derived(
		buildDays({
			dates,
			people,
			entries,
			shifts: data?.current?.shift_definition.rows ?? [],
			patterns: data?.current?.shift_pattern.rows ?? [],
			holidays: data?.current?.holiday.rows ?? [],
			leave: (data?.current?.leave_catalog_entry.rows ?? []).map((row) => ({
				...row,
				employee: String(contractById.get(String(row.employment_id))?.employee_id)
			})),
			locked,
			today
		})
	);
	const loading = $derived(
		contracts.current === undefined || (ids.length > 0 && data?.current === undefined)
	);
	const error = $derived(contracts.error?.message ?? data?.error?.message);

	function openDay(day: Day, person: BoardPerson) {
		if (!day.employed) return;
		if (day.entryId != null) {
			openRecord('roster_entry', day.entryId);
			return;
		}
		if (person.locked) return;
		if (day.employmentId == null) return;
		creating = { employmentId: day.employmentId as Id<'employee_contract'>, date: day.date };
	}
</script>

{#if error != null}
	<p class="text-sm text-destructive" role="alert">{error}</p>
{:else if !loading && people.length === 0}
	<p class="text-sm text-muted-foreground">{bolt.t('v2.no_rosters')}</p>
{:else}
	<div class="max-h-[70vh] overflow-auto rounded-lg border bg-card">
		<table
			class="table-fixed border-separate border-spacing-0 text-left text-xs"
			style:width={`${PERSON_REM + dates.length * DAY_REM}rem`}
			aria-busy={loading}
			aria-label={bolt.t('roster.board_scroll_name')}
		>
			<colgroup>
				<col style:width={`${PERSON_REM}rem`} />
				{#each dates as date (date)}<col style:width={`${DAY_REM}rem`} />{/each}
			</colgroup>
			<thead>
				<tr>
					<th
						scope="col"
						class="sticky top-0 left-0 z-30 border-r border-b bg-card px-3 py-1.5 text-left"
					>
						<span class="block font-semibold">{bolt.t('roster.person')}</span>
						<span class="block text-micro text-muted-foreground">
							{bolt.t('roster.plan_recorded')} · {bolt.t('component.work_day_actual')}
						</span>
					</th>
					{#each dates as date (date)}
						{@const holiday = holidayByDate.get(date)}
						<th
							scope="col"
							title={holiday}
							class={cn(
								'sticky top-0 z-20 h-10 border-b text-center font-medium',
								isWeekend(date) && 'bg-muted',
								holiday != null && 'bg-warning/10',
								date === today && 'bg-brand/10',
								date < today && 'text-muted-foreground'
							)}
						>
							<span class="block text-meta">
								{holiday == null
									? WEEKDAY_LETTERS[new Date(`${date}T00:00:00Z`).getUTCDay()]
									: bolt.t('roster.public_holiday_mark')}
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
						{#each dates as date (date)}
							{@const day = days.get(dayKey(person.id, date))}
							<td class={cn('border-b p-0.5', date === today && 'bg-brand/5')}>
								{#if loading || day == null}
									<span class="block h-14 w-full animate-pulse rounded-sm bg-muted"></span>
								{:else}
									{@const label = describeDay(day, `${person.name} · ${date}`, timeZone, bolt.t)}
									<button
										type="button"
										class={cn(
											'block h-14 w-full rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
											day.employed
												? 'cursor-pointer hover:ring-1 hover:ring-ring'
												: day.left != null
													? 'cursor-help'
													: 'cursor-default'
										)}
										aria-label={label}
										title={label}
										aria-haspopup={day.employed && !(day.entryId == null && person.locked)
											? 'dialog'
											: undefined}
										disabled={!day.employed || (day.entryId == null && person.locked)}
										onclick={() => openDay(day, person)}
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
	</div>
{/if}

{#if creating != null}
	<Sheet
		open
		onOpenChange={(open) => !open && (creating = null)}
		title={bolt.t('models.roster_entry.singular')}
	>
		<RecordShell
			of="roster_entry"
			mode="create"
			fields={[
				'work_date',
				'shift_definition_id',
				'planned_overtime_intervals',
				'actual_worked_intervals'
			]}
			values={{
				employment_id: creating.employmentId,
				work_date: PlainDate(creating.date)
			}}
			onDone={() => (creating = null)}
		/>
	</Sheet>
{/if}
