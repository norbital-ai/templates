<!--
	The period at a glance: one row per roster, one narrow column per day. A cell opens the day's
	roster entry, or creates one for that roster and date.
-->
<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		cn,
		CustomView,
		open_record,
		RecordShell,
		Sheet,
		toast,
		virtual_grid
	} from '@norbital-ai/ui';
	import { Scroll } from '@norbital-ai/ui/layout';
	import { fork, observe_once } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { isJsonObject, jsonObject } from '../../foundation.js';
	import { idOf } from '../../reads.js';
	import { employmentOn, segmentsOf } from '../../../data/model/employee_profile/service/person.js';
	import { exportMonthOvertimeReport } from '../../../data/model/payroll_run/service/exports/overtime_report_download.js';
	import { downloadRosterWorkbook, runRosterImport } from '../workbook/roster_import.js';
	import DayCell from './day_cell.svelte';
	import {
		briefDayLabel,
		buildDays,
		createBoardIndex,
		datesBetween,
		dayKey,
		describeDay,
		intervalsOf,
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
		readonly overtime_as_time_off?: boolean;
		readonly actual_worked_intervals?: unknown;
		readonly findings?: unknown;
		readonly consent?: unknown;
	};
	type BoardPerson = Person & {
		readonly number: string;
		readonly name: string;
		readonly locked: boolean;
		readonly entries: readonly BoardEntry[];
	};

	let {
		ctx,
		company,
		from,
		to,
		today
	}: {
		ctx: PageContext;
		company: {
			readonly id: Id<'entity'>;
			readonly name: string;
			readonly settings_code: string;
			readonly time_zone?: string | null;
		};
		/** The first and last day shown, both inclusive. */
		from: string;
		to: string;
		today: string;
	} = $props();

	const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
	const PERSON_REM = 10;
	const DAY_REM = 4.5;
	const ROW_REM = 3.75; // h-14 (3.5rem) + p-0.5 (0.25rem) + 1px bottom border
	const ROSTER_FIELDS = [
		'employment_id',
		'work_date',
		'shift_definition_id',
		'planned_overtime_intervals',
		'overtime_as_time_off',
		'actual_worked_intervals',
		'findings',
		'consent',
		'payroll_run_id'
	] as const;

	let creating = $state<{ employmentId: Id<'employment'>; date: string } | null>(null);

	const companyId = $derived(company.id);
	const dates = $derived(datesBetween(from, to));
	const remPx = $derived(
		typeof document !== 'undefined'
			? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
			: 16
	);
	const rowPx = $derived(Math.round(remPx * ROW_REM + 1));
	const dayPx = $derived(remPx * DAY_REM);

	// Keyed by company only so month changes hit the live cache and never refetch stints or shift definitions.
	const companyData = $derived(
		ctx.query({
			employment: {
				where: { entity_id: { eq: companyId } },
				fields: ['employee_id', 'employee_number', 'effective_range'],
				order_by: { employee_number: 'asc' },
				limit: 10000,
				employee_id: { fields: ['name'] },
				terms: { fields: ['effective_from', 'shift_pattern_id', 'clears'], limit: 10000 }
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
			}
		})
	);
	// Keyed by company + month; fires in parallel with companyData (no waterfall) and bounds leave to the visible month.
	const monthData = $derived(
		ctx.query({
			roster_entry: {
				where: {
					employment_id: { is: { entity_id: { eq: companyId } } },
					work_date: { gte: from, lte: to }
				},
				fields: [...ROSTER_FIELDS],
				limit: 10000
			},
			holiday: {
				where: {
					entity_id: { eq: companyId },
					published_at: { is_null: false },
					employee_id: { is_null: true },
					date: { gte: from, lte: to }
				},
				fields: ['date', 'name'],
				limit: 10000
			},
			leave_catalog_entry: {
				where: {
					entity_id: { eq: companyId },
					leave_catalog_entry_day: { some: { incurred_on: { gte: from, lte: to } } }
				},
				fields: ['employment_id', 'catalog_code'],
				limit: 10000,
				leave_catalog_entry_day: {
					where: { incurred_on: { gte: from, lte: to } },
					fields: ['incurred_on', 'part'],
					limit: 10000
				}
			}
		})
	);

	// Automatically page past 10,000 roster entries (>~320 employees × 31 days) so large companies never truncate silently.
	const extraRosterEntries = observe_once(() => {
		const firstNext = monthData.current?.roster_entry.next;
		if (firstNext == null) return null;
		const scopeCompany = companyId;
		const scopeFrom = from;
		const scopeTo = to;
		const readRosterPage = (after: typeof firstNext) =>
			ctx.query({
				roster_entry: {
					where: {
						employment_id: { is: { entity_id: { eq: scopeCompany } } },
						work_date: { gte: scopeFrom, lte: scopeTo }
					},
					fields: [...ROSTER_FIELDS],
					limit: 10000,
					after
				}
			});
		type RosterPage = NonNullable<typeof monthData.current>['roster_entry'];
		return Effect.gen(function* () {
			const extra: BoardEntry[] = [];
			let cursor: typeof firstNext | null = firstNext;
			while (cursor !== null) {
				const answer: { readonly roster_entry: RosterPage } = yield* readRosterPage(cursor);
				for (const entry of answer.roster_entry.rows) {
					extra.push({
						id: entry.id,
						employment_id: String(entry.employment_id),
						payroll_run_id: entry.payroll_run_id,
						work_date: String(entry.work_date),
						shift_definition_id: entry.shift_definition_id,
						planned_overtime_intervals: entry.planned_overtime_intervals,
						overtime_as_time_off: entry.overtime_as_time_off,
						actual_worked_intervals: entry.actual_worked_intervals,
						findings: entry.findings,
						consent: entry.consent
					});
				}
				cursor = answer.roster_entry.next;
			}
			return extra;
		});
	});

	const truncated = $derived(
		companyData.current?.employment.next != null ||
			companyData.current?.shift_definition.next != null ||
			companyData.current?.shift_pattern.next != null ||
			monthData.current?.holiday.next != null ||
			monthData.current?.leave_catalog_entry.next != null
	);

	const stintById = $derived(
		new Map((companyData.current?.employment.rows ?? []).map((row) => [String(row.id), row]))
	);
	const entriesByEmployment = $derived.by(() => {
		const grouped = new Map<string, BoardEntry[]>();
		const push = (entry: BoardEntry) => {
			const list = grouped.get(entry.employment_id) ?? [];
			list.push(entry);
			grouped.set(entry.employment_id, list);
		};
		for (const entry of monthData.current?.roster_entry.rows ?? []) {
			push({
				id: entry.id,
				employment_id: String(entry.employment_id),
				payroll_run_id: entry.payroll_run_id,
				work_date: String(entry.work_date),
				shift_definition_id: entry.shift_definition_id,
				planned_overtime_intervals: entry.planned_overtime_intervals,
				overtime_as_time_off: entry.overtime_as_time_off,
				actual_worked_intervals: entry.actual_worked_intervals,
				findings: entry.findings,
				consent: entry.consent
			});
		}
		for (const entry of extraRosterEntries.current ?? []) push(entry);
		return grouped;
	});
	const people = $derived.by(() => {
		const byPerson = new Map<
			string,
			NonNullable<typeof companyData.current>['employment']['rows'][number][]
		>();
		for (const stint of companyData.current?.employment.rows ?? []) {
			const range = stint.effective_range;
			// nobody stays on the board past the month they left
			if (String(range.from) > to || (range.to != null && String(range.to) < from)) continue;
			const employee = String(stint.employee_id?.id);
			byPerson.set(employee, [...(byPerson.get(employee) ?? []), stint]);
		}
		return [...byPerson]
			.flatMap(([employee, rows]): BoardPerson[] => {
				const ordered = rows.toSorted((left, right) =>
					String(left.effective_range.from).localeCompare(String(right.effective_range.from))
				);
				// a stint runs one shift pattern between its changes of terms
				const spells = ordered.flatMap((stint) => {
					const parts = {
						stint: jsonObject({ id: stint.id, effective_range: stint.effective_range }),
						terms: (stint.terms ?? []).map(jsonObject),
						parameters: [],
						profile: {},
						dependants: []
					};
					return segmentsOf(parts).map((segment) => {
						const agreed = employmentOn(parts, segment.from).terms;
						const pattern = isJsonObject(agreed) ? agreed.shift_pattern_id : null;
						return {
							id: String(stint.id),
							from: segment.from,
							to: segment.to,
							patternId: typeof pattern === 'string' ? pattern : null
						};
					});
				});
				const latest = ordered.at(-1);
				const current = spells.at(-1);
				// a stint with no day in it has nothing to draw
				if (latest === undefined || current === undefined) return [];
				const entries = spells.flatMap(({ id }) => entriesByEmployment.get(id) ?? []);
				return [
					{
						...current,
						id: employee,
						employee,
						contracts: spells,
						number: latest.employee_number,
						name: latest.employee_id?.name ?? '',
						locked: entries.some((entry) => entry.payroll_run_id != null),
						entries
					}
				];
			})
			.toSorted(
				(left, right) =>
					left.number.localeCompare(right.number) || left.name.localeCompare(right.name)
			);
	});
	const byId = $derived(new Map(people.map((person) => [person.id, person])));
	const entries = $derived(people.flatMap((person) => person.entries));
	const locked = $derived(new Set(people.filter((person) => person.locked).map((p) => p.id)));
	const timeZone = $derived(company.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
	const holidayByDate = $derived(
		new Map(
			(monthData.current?.holiday.rows ?? []).map((row) => [
				String(row.date).slice(0, 10),
				row.name
			])
		)
	);
	const leaveRows = $derived(
		(monthData.current?.leave_catalog_entry.rows ?? []).map((row) => ({
			...row,
			days: (row.leave_catalog_entry_day ?? []).map((child) => ({
				date: String(child.incurred_on),
				part: String(child.part)
			})),
			employee: String(stintById.get(String(row.employment_id))?.employee_id?.id)
		}))
	);
	// Lazy memoized cell builder: only computes `Day` objects for the visible virtual slice.
	const boardIndex = $derived(
		createBoardIndex({
			dates,
			entries,
			shifts: companyData.current?.shift_definition.rows ?? [],
			patterns: companyData.current?.shift_pattern.rows ?? [],
			holidays: monthData.current?.holiday.rows ?? [],
			leave: leaveRows,
			locked,
			today
		})
	);
	const loading = $derived(
		companyData.current === undefined ||
			monthData.current === undefined ||
			extraRosterEntries.loading
	);
	const error = $derived(
		companyData.error?.message ?? monthData.error?.message ?? extraRosterEntries.error?.message
	);

	let filteredIds = $state.raw<readonly string[] | null>(null);
	const activeRows = $derived(
		filteredIds === null ? people : filteredIds.flatMap((id) => byId.get(id) ?? [])
	);

	// 2D fixed-stride virtualizer: O(1) math on both rows and day columns, zero per-row ResizeObserver.
	const grid = virtual_grid({
		rows: {
			count: () => activeRows.length,
			key: (i) => activeRows[i]?.id ?? String(i),
			size: () => rowPx,
			threshold: 15,
			overscan: 8
		},
		cols: {
			count: () => dates.length,
			key: (i) => dates[i] ?? String(i),
			size: () => dayPx,
			threshold: 14,
			overscan: 4,
			max_overscan: 8
		}
	});

	const visibleDates = $derived(grid.cols.slice(dates));
	const visibleColSpan = $derived(
		1 + (grid.cols.on ? 1 : 0) + visibleDates.length + (grid.cols.on && grid.cols.after > 0 ? 1 : 0)
	);

	// Lazily hydrate full cell tooltip & aria-label on hover/focus so fast scrolling never formats Intl strings.
	const fullDescriptions = new WeakMap<Day, string>();
	function hydrateTip(button: HTMLButtonElement, day: Day, person: BoardPerson, date: string) {
		let text = fullDescriptions.get(day);
		if (text === undefined) {
			text = describeDay(day, `${person.name} · ${date}`, timeZone, ctx.t);
			fullDescriptions.set(day, text);
		}
		if (button.title !== text) {
			button.title = text;
			button.setAttribute('aria-label', text);
		}
	}

	function syncShown(shown: readonly { readonly id: unknown }[]) {
		return () => {
			const sameAsAll =
				shown.length === people.length &&
				shown.every((row, index) => String(row.id) === people[index]?.id);
			const next = sameAsAll ? null : shown.map((row) => String(row.id));
			const unchanged =
				next === filteredIds ||
				(next !== null &&
					filteredIds !== null &&
					next.length === filteredIds.length &&
					next.every((id, index) => id === filteredIds?.[index]));
			if (!unchanged) {
				filteredIds = next;
				grid.rows.reset();
			}
		};
	}

	function openDay(day: Day, person: BoardPerson) {
		if (!day.employed) return;
		if (day.entryId != null) {
			open_record('roster_entry', day.entryId);
			return;
		}
		if (person.locked) return;
		if (day.employmentId == null) return;
		creating = { employmentId: idOf('employment', day.employmentId), date: day.date };
	}

	let importing = $state(false);
	function importRoster() {
		importing = true;
		fork(
			runRosterImport(ctx, {
				entity_id: company.id,
				entity_name: company.name,
				settings_code: company.settings_code
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						importing = false;
					})
				)
			)
		);
	}
	let exportingOvertime = $state(false);
	function downloadOvertimeReport() {
		exportingOvertime = true;
		fork(
			exportMonthOvertimeReport(ctx, company.id, from.slice(0, 7)).pipe(
				Effect.catch((err) =>
					Effect.sync(() =>
						toast.error(err instanceof Error ? err.message : ctx.t('component.error'))
					)
				),
				Effect.ensuring(
					Effect.sync(() => {
						exportingOvertime = false;
					})
				)
			)
		);
	}
	function downloadRoster() {
		const days = buildDays({
			dates,
			people,
			entries,
			shifts: companyData.current?.shift_definition.rows ?? [],
			patterns: companyData.current?.shift_pattern.rows ?? [],
			holidays: monthData.current?.holiday.rows ?? [],
			leave: leaveRows,
			locked,
			today
		});
		const rows = people.flatMap((person) =>
			dates.flatMap((date) => {
				const day = days.get(dayKey(person.id, date));
				if (day?.employed !== true) return [];
				const entry = person.entries.find((row) => row.id === day.entryId);
				const closed = (intervals: ReturnType<typeof intervalsOf>) => {
					const first = intervals?.[0];
					return first?.end == null ? null : { start: first.start, end: first.end };
				};
				return [
					{
						number: person.number,
						name: person.name,
						date,
						shift: day.shift ?? day.projectedShift,
						planned: closed(intervalsOf(entry?.planned_overtime_intervals)),
						time_off: entry?.overtime_as_time_off === true,
						worked: closed(day.intervals === null ? null : [...day.intervals])
					}
				];
			})
		);
		fork(Effect.promise(() => downloadRosterWorkbook(from.slice(0, 7), rows, timeZone)));
	}
</script>

{#if error != null}
	<p class="text-sm text-destructive" role="alert">{error}</p>
{:else}
	{#if truncated}
		<p class="text-xs text-warning" role="status">{ctx.t('app.hr_employee.calendar_incomplete')}</p>
	{/if}
	<CustomView
		{ctx}
		of={people.map(({ id, number, name }) => ({ id, number, name }))}
		fields={[
			{ field: 'number', label: ctx.t('models.employment.fields.employee_number') },
			{ field: 'name', label: ctx.t('roster.person') }
		]}
		key="roster-board"
		model="roster_entry"
		toolbar={{
			new: false,
			actions: [
				{
					run: importRoster,
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('holiday_calendar.import_spreadsheet'),
					disabled: () => (importing || loading ? ctx.t('component.loading') : null)
				},
				{
					run: downloadRoster,
					icon: 'lucide:download',
					name: ctx.t('roster.download_workbook'),
					disabled: () => (loading ? ctx.t('component.loading') : null)
				},
				{
					run: downloadOvertimeReport,
					icon: 'lucide:clock',
					name: ctx.t('roster.export_overtime'),
					disabled: () => (exportingOvertime || loading ? ctx.t('component.loading') : null)
				}
			]
		}}
	>
		{#snippet children(shown)}
			<div class="contents" {@attach syncShown(shown)}></div>
			{@render board(activeRows)}
		{/snippet}
		{#snippet empty()}
			{#if !loading}<p class="text-sm text-muted-foreground">{ctx.t('v2.no_rosters')}</p>{/if}
		{/snippet}
	</CustomView>
{/if}

{#snippet board(rows: readonly BoardPerson[])}
	<Scroll
		name={ctx.t('roster.board_scroll_name')}
		axis="both"
		size="fill"
		fade={false}
		class="rounded-lg border bg-card [overflow-anchor:none]"
	>
		<table
			class="table-fixed border-separate border-spacing-0 text-left text-xs"
			style:width={`${PERSON_REM + dates.length * DAY_REM}rem`}
			aria-busy={loading}
			aria-label={ctx.t('roster.board_scroll_name')}
		>
			<colgroup>
				<col style:width={`${PERSON_REM}rem`} />
				{#if grid.cols.on}<col style:width={`${grid.cols.before}px`} />{/if}
				{#each visibleDates as date (date)}<col style:width={`${DAY_REM}rem`} />{/each}
				{#if grid.cols.on && grid.cols.after > 0}<col style:width={`${grid.cols.after}px`} />{/if}
			</colgroup>
			<thead>
				<tr>
					<th
						scope="col"
						class="sticky top-0 left-0 z-30 border-r border-b bg-card px-3 py-1.5 text-left"
					>
						<span class="block font-medium">{ctx.t('roster.person')}</span>
						<span class="block text-micro text-muted-foreground">
							{ctx.t('roster.plan_recorded')} · {ctx.t('component.work_day_actual')}
						</span>
					</th>
					{#if grid.cols.on}
						<th
							aria-hidden="true"
							class="border-0! p-0!"
							style:width={`${grid.cols.before}px`}
							{@attach grid.cols.anchor}
						></th>
					{/if}
					{#each visibleDates as date (date)}
						{@const holiday = holidayByDate.get(date)}
						{@const wd = boardIndex.weekday(date)}
						<th
							scope="col"
							title={holiday}
							class={cn(
								'sticky top-0 z-20 h-10 border-b bg-card text-center font-medium',
								(wd === 0 || wd === 6) && 'bg-muted',
								// a tint is an image over the solid colour: rows scroll beneath this header
								(holiday != null || date === today) && 'bg-linear-to-b',
								holiday != null && 'from-warning/10 to-warning/10',
								date === today && 'from-brand/10 to-brand/10',
								date < today && 'text-muted-foreground'
							)}
						>
							<span class="block text-meta">
								{holiday == null ? WEEKDAY_LETTERS[wd] : ctx.t('roster.public_holiday_mark')}
							</span>
							<span class="block tabular-nums">{Number(date.slice(8, 10))}</span>
						</th>
					{/each}
					{#if grid.cols.on && grid.cols.after > 0}
						<th aria-hidden="true" class="border-0! p-0!" style:width={`${grid.cols.after}px`}></th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#if grid.rows.on}
					<tr aria-hidden="true" {@attach grid.rows.anchor}>
						<td
							colspan={visibleColSpan}
							class="border-0! p-0! leading-none"
							style:height={`${grid.rows.before}px`}
						></td>
					</tr>
				{/if}
				{#each grid.rows.slice(rows) as person (person.id)}
					<tr>
						<th
							scope="row"
							class="sticky left-0 z-10 border-r border-b bg-card px-3 py-1.5 text-left font-normal"
						>
							<span class="block truncate font-mono tabular-nums">{person.number}</span>
							<span class="block truncate text-micro text-muted-foreground">{person.name}</span>
						</th>
						{#if grid.cols.on}
							<td aria-hidden="true" class="border-0! p-0!"></td>
						{/if}
						{#each visibleDates as date (date)}
							{@const day = loading ? null : boardIndex.day(person, date)}
							<td class={cn('border-b p-0.5', date === today && 'bg-brand/5')}>
								{#if day == null}
									<span class="block h-14 w-full animate-pulse rounded-sm bg-muted"></span>
								{:else}
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
										aria-label={briefDayLabel(day, `${person.name} · ${date}`)}
										aria-haspopup={day.employed && !(day.entryId == null && person.locked)
											? 'dialog'
											: undefined}
										disabled={!day.employed || (day.entryId == null && person.locked)}
										onpointerenter={(e) => hydrateTip(e.currentTarget, day, person, date)}
										onfocus={(e) => hydrateTip(e.currentTarget, day, person, date)}
										onclick={() => openDay(day, person)}
									>
										<DayCell {ctx} {day} />
									</button>
								{/if}
							</td>
						{/each}
						{#if grid.cols.on && grid.cols.after > 0}
							<td aria-hidden="true" class="border-0! p-0!"></td>
						{/if}
					</tr>
				{/each}
				{#if grid.rows.on && grid.rows.after > 0}
					<tr aria-hidden="true">
						<td
							colspan={visibleColSpan}
							class="border-0! p-0! leading-none"
							style:height={`${grid.rows.after}px`}
						></td>
					</tr>
				{/if}
			</tbody>
		</table>
	</Scroll>
{/snippet}

{#if creating != null}
	<Sheet
		open
		on_open_change={(open) => !open && (creating = null)}
		title={ctx.t('models.roster_entry.singular')}
	>
		<RecordShell
			{ctx}
			of="roster_entry"
			mode="create"
			values={{
				employment_id: creating.employmentId,
				work_date: creating.date
			}}
			on_done={() => (creating = null)}
		/>
	</Sheet>
{/if}
