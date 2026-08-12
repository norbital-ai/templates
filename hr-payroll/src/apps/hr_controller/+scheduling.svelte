<script lang="ts">
	import { client } from '$pod/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/pod/client/app-header-actions';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { CollectionQueryState } from '@norbital-ai/ui/collection-query';
	import {
		CollectionActionToolbar,
		CollectionPagination
	} from '@norbital-ai/ui/collection-toolbar';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Button } from '@norbital-ai/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { Badge } from '@norbital-ai/ui/badge';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Cluster, Cover, Inline, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { formatCalendarDate, formatHolidayScope } from '../../lib/ui/display-formatters.js';
	import { runWorkbookImport } from '../../lib/ui/workbook-import.js';
	import { rosterImportPayload } from '../../collections/roster_entries/lib/import-workbook.js';
	import {
		calendarDayKey,
		monthKey,
		shiftMonthKey,
		todayKey,
		todayInstant
	} from '../../lib/ui/calendar.js';
	import RosterMonthBoard from '../../lib/ui/roster/roster-month-board.svelte';
	import {
		STATUS_PRESENTATION,
		buildRosterMonth,
		holidayNamesByDate,
		monthProgress,
		type MonthDrafting
	} from '../../lib/ui/roster/roster-month.js';

	const { t } = useI18n<TenantI18nKeys>();

	let companyId = $state<string | null>(null);
	let month = $state<string>(monthKey(todayKey()));
	let publishing = $state(false);
	/**
	 * Search and page, in the model every collection surface uses.
	 *
	 * The board used to keep its own search string and its own `boardPage`, and every handler that
	 * narrowed the set had to remember to write `boardPage = 0` — five of them did, which is five
	 * chances to forget and leave the operator on a page that no longer exists.
	 */
	const boardQuery = new CollectionQueryState({ pageSize: 50 });
	/**
	 * Bumped to remount every board query after a failed load.
	 *
	 * The queries are keyed on the company and the month, so asking for the same month again is not
	 * a change and would rebuild nothing. Each board query reads this token so that bumping it is a
	 * real dependency change, which gives the operator a way out of a failed load without reloading
	 * the page and losing the rest of it.
	 */
	let reloadToken = $state(0);

	const today = todayKey();
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;
	const approved = { norbital_approval_id: { isNull: true } } as const;

	const companiesQuery = client.db.companies.findMany({
		where: { ...approved, ...activeRange },
		orderBy: { name: 'asc' },
		limit: 500
	});
	const companies = $derived(companiesQuery.current ?? []);
	const companyOptions = $derived(
		companies.map((c) => ({
			value: c.norbital_id,
			label: c.name,
			search_term: `${c.name} ${c.registration_number ?? ''}`
		}))
	);
	const selectedCompanyId = $derived(
		companyId != null && companies.some((c) => c.norbital_id === companyId)
			? companyId
			: (companies[0]?.norbital_id ?? null)
	);
	const selectedCompany = $derived(
		companies.find((company) => company.norbital_id === selectedCompanyId) ?? null
	);

	/** The month's calendar bounds, which every dated query below is narrowed to. */
	const monthStart = $derived(`${month}-01`);
	const monthEnd = $derived(
		calendarDayKey(new Date(Date.parse(`${shiftMonthKey(month, 1)}-01T00:00:00.000Z`) - 86_400_000))
	);

	/**
	 * The attendance window the next run will settle.
	 *
	 * Read from the payroll run when one exists, because that is the window the engine actually used.
	 * Only when no run has been opened yet is it derived from the company's cut-off day, which is the
	 * same rule stated in `docs/architecture.md`.
	 */
	const runQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.payroll_runs.findFirst({
					where: { ...approved, company_id: { eq: selectedCompanyId }, period: { eq: month } }
				})
	);
	const cutoff = $derived.by(() => {
		const run = runQuery?.current;
		if (run?.attendance_from != null && run.attendance_to != null) {
			return { start: calendarDayKey(run.attendance_from), end: calendarDayKey(run.attendance_to) };
		}
		const cutoffDay = selectedCompany?.pay_cutoff_day;
		if (cutoffDay == null) return null;
		const day = String(Math.min(Math.max(Number(cutoffDay), 1), 28)).padStart(2, '0');
		return {
			start: `${shiftMonthKey(month, -1)}-${day}`,
			end: calendarDayKey(new Date(Date.parse(`${month}-${day}T00:00:00.000Z`) - 86_400_000))
		};
	});

	const employmentsQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.employments.findMany({
			where: { ...approved, company_id: { eq: selectedCompanyId } },
			orderBy: { employee_number: 'asc' },
			limit: 1000
		});
	});
	const employments = $derived(employmentsQuery?.current ?? []);
	const employmentIds = $derived(employments.map((employment) => employment.norbital_id));
	// One scoped query and a map, rather than a name lookup per row.
	const employeesQuery = client.db.employees.findMany({ where: approved, limit: 1000 });
	const employeeNameById = $derived(
		new Map((employeesQuery.current ?? []).map((employee) => [employee.norbital_id, employee.name]))
	);
	const people = $derived(
		employments.map((employment) => ({
			id: employment.norbital_id,
			number: employment.employee_number,
			name: employeeNameById.get(employment.employee_id) ?? '—'
		}))
	);

	const shiftsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.shift_definitions.findMany({
					where: { ...approved, company_id: { eq: selectedCompanyId } },
					limit: 500
				})
	);
	const rosterCodesById = $derived(
		new Map((shiftsQuery?.current ?? []).map((code) => [code.norbital_id, code]))
	);
	const employmentTermsQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.employment_terms.findMany({
			where: {
				...approved,
				term_employment: { ...approved, company_id: { eq: selectedCompanyId } }
			},
			limit: 3000
		});
	});

	const leaveTypesQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.leave_types.findMany({
					where: { ...approved, company_id: { eq: selectedCompanyId } },
					limit: 200
				})
	);
	const leaveCodeById = $derived(
		new Map((leaveTypesQuery?.current ?? []).map((type) => [type.norbital_id, type.code]))
	);

	const rosterEntriesQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.roster_entries.findMany({
			where: {
				...approved,
				roster_entry_employment: { ...approved, company_id: { eq: selectedCompanyId } },
				work_date: { gte: monthStart, lte: monthEnd }
			},
			limit: 5000
		});
	});
	/**
	 * The shared schema filter builder targets real roster-entry fields. Keep this second query
	 * separate from the board data: it decides which people remain visible without erasing the other
	 * days from their month.
	 */
	const filteredRosterEntriesQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null || boardQuery.filters.length === 0) return null;
		return client.db.roster_entries.findMany(
			{
				where: {
					...approved,
					roster_entry_employment: { ...approved, company_id: { eq: selectedCompanyId } },
					work_date: { gte: monthStart, lte: monthEnd }
				},
				limit: 5000
			},
			boardQuery.queryOptions
		);
	});
	const timeEntriesQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.time_entries.findMany({
			where: {
				...approved,
				time_entry_employment: { ...approved, company_id: { eq: selectedCompanyId } },
				work_date: { gte: monthStart, lte: monthEnd }
			},
			limit: 5000
		});
	});
	/** Requests are stored once at `from_date`, so the window is widened to catch one spanning in. */
	const leaveQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.leave_requests.findMany({
			where: {
				...approved,
				leave_request_employment: { ...approved, company_id: { eq: selectedCompanyId } },
				kind: { eq: 'TIME_OFF' },
				from_date: { lte: monthEnd },
				to_date: { gte: monthStart }
			},
			limit: 2000
		});
	});
	const holidaysQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.company_holidays.findMany({
			where: {
				...approved,
				company_id: { eq: selectedCompanyId },
				date: { gte: monthStart, lte: monthEnd }
			},
			limit: 200
		});
	});

	/**
	 * The five queries the board is assembled from, named so a failure can say which one failed.
	 *
	 * They are listed rather than OR-ed inline because "still loading" is not the only answer this
	 * board needs to be able to give. A gate that only knows `loading` has no terminal state: a query
	 * that errors — or that is aborted and never retried — leaves every flag exactly as it was, and
	 * the board sits on `Loading …` forever with nothing on screen saying why. That is indistinguishable
	 * from a slow month, so nobody reloads, and the surface looks hung rather than broken.
	 */
	const boardSources = $derived([
		{ label: 'roster entries', query: rosterEntriesQuery },
		{ label: 'filtered roster entries', query: filteredRosterEntriesQuery },
		{ label: 'attendance', query: timeEntriesQuery },
		{ label: 'leave', query: leaveQuery },
		{ label: 'holidays', query: holidaysQuery },
		{ label: 'employments', query: employmentsQuery },
		{ label: 'employment schedules', query: employmentTermsQuery }
	]);
	const boardErrors = $derived(
		boardSources.flatMap((source) =>
			source.query?.error ? [`${source.label}: ${source.query.error.message}`] : []
		)
	);
	/**
	 * An error outranks loading. A handle that failed may keep reporting `loading`, and reporting that
	 * in preference to the error is what turns a broken board into a hanging one.
	 */
	const loading = $derived(
		boardErrors.length === 0 && boardSources.some((source) => source.query?.loading === true)
	);

	/** Overlaid onto the board from the company calendar; never a mark stored on a roster entry. */
	const companyHolidays = $derived(holidaysQuery?.current ?? []);
	const holidayNames = $derived(holidayNamesByDate(companyHolidays));

	const facts = $derived(
		buildRosterMonth({
			month,
			employmentIds,
			employmentTerms: employmentTermsQuery?.current ?? [],
			rosterEntries: rosterEntriesQuery?.current ?? [],
			timeEntries: timeEntriesQuery?.current ?? [],
			leaveRequests: leaveQuery?.current ?? [],
			holidays: companyHolidays,
			rosterCodesById,
			leaveCodeById,
			cutoff
		})
	);

	const filteredEmploymentIds = $derived(
		new Set((filteredRosterEntriesQuery?.current ?? []).map((entry) => entry.employment_id))
	);
	const boardPeople = $derived(
		people.filter((person) => {
			const term = boardQuery.search.toLowerCase();
			if (term !== '' && !`${person.number} ${person.name}`.toLowerCase().includes(term)) {
				return false;
			}
			return boardQuery.filters.length === 0 || filteredEmploymentIds.has(person.id);
		})
	);
	const boardPageCount = $derived(Math.max(1, Math.ceil(boardPeople.length / boardQuery.pageSize)));
	const visibleBoardPage = $derived(Math.min(boardQuery.pageIndex, boardPageCount - 1));
	const visibleBoardPeople = $derived(
		boardPeople.slice(
			visibleBoardPage * boardQuery.pageSize,
			(visibleBoardPage + 1) * boardQuery.pageSize
		)
	);

	const rostersQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.rosters.findMany({
					where: { ...approved, company_id: { eq: selectedCompanyId }, month: { eq: month } },
					limit: 50
				})
	);
	const rosters = $derived(rostersQuery?.current ?? []);
	/**
	 * The month's draft roster, which an import lands in.
	 *
	 * A published month is frozen and the pipeline refuses one outright, so the import is offered
	 * only against a draft. The operator is told which state the month is in before they choose a
	 * file, rather than after the file has been read and sent.
	 */
	const draftRoster = $derived(rosters.find((roster) => roster.published_at == null) ?? null);
	/**
	 * How far the month has got, which is the difference between an empty board and a broken one.
	 *
	 * A month nobody has drafted has every person-day unrostered — three hundred people times
	 * thirty-one days — and that tally is what the month is *supposed* to look like before anyone has
	 * touched it. `monthProgress` therefore counts an unrostered day as an exception only once the
	 * month is published and claims to be complete.
	 */
	const drafting = $derived<MonthDrafting>(
		rosters.length === 0 ? 'NOT_DRAFTED' : draftRoster != null ? 'DRAFT' : 'PUBLISHED'
	);
	const progress = $derived(monthProgress(facts, drafting));
	const rosterImportBlocker = $derived(
		draftRoster != null
			? null
			: rosters.length === 0
				? t('app.scheduling.blocker_no_draft', { month })
				: t('app.scheduling.blocker_published', { month })
	);

	async function importRoster(): Promise<void> {
		const rosterId = draftRoster?.norbital_id;
		if (rosterId == null) return;
		// `runWorkbookImport` reports its own refusals: the pipeline answers with the rows the
		// company's records contradict, and that list is the whole message worth showing.
		await runWorkbookImport(
			{
				collectionName: 'roster_entries',
				recordLabel: t('component.roster_rows'),
				buildPayload: (grids) => rosterImportPayload(grids, rosterId)
			},
			t
		);
	}

	function stepMonth(delta: number): void {
		month = shiftMonthKey(month, delta);
		boardQuery.setPageIndex(0);
	}

	/** Rebuilds every board query in place; the month, the search and the filters all survive it. */
	async function reloadBoard(): Promise<void> {
		reloadToken += 1;
	}

	async function publish(rosterId: string): Promise<void> {
		const update = client.db.rosters.update;
		if (update == null) {
			toast.error(t('app.scheduling.toast_publish_not_permitted'));
			return;
		}
		publishing = true;
		try {
			await update(rosterId, { published_at: new Date() });
			toast.success(t('app.scheduling.toast_published', { month }));
		} catch (error) {
			// The publish gate refuses with the statutory reason, which is the whole message.
			toast.error(
				error instanceof Error ? error.message : t('app.scheduling.toast_publish_failed')
			);
		} finally {
			publishing = false;
		}
	}

	async function reopen(rosterId: string): Promise<void> {
		const update = client.db.rosters.update;
		if (update == null) {
			toast.error(t('app.scheduling.toast_reopen_not_permitted'));
			return;
		}
		publishing = true;
		try {
			await update(rosterId, { published_at: null });
			toast.success(t('app.scheduling.toast_reopened', { month }));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('app.scheduling.toast_reopen_failed'));
		} finally {
			publishing = false;
		}
	}
</script>

<svelte:head>
	<title>Scheduling</title>
	<meta
		name="description"
		content="Plan the monthly roster on a calendar, publish it against the statutory rules, and manage the shifts a day is worked on and the patterns a week is shaped by"
	/>
	<meta name="pod:icon" content="lucide:calendar-clock" />
	<meta
		name="pod:thumbnail"
		content="/api/template-seed-assets/hr-payroll/app-media/scheduling-banner.webp"
	/>
	<meta
		name="pod:banner"
		content="/api/template-seed-assets/hr-payroll/app-media/scheduling-banner.webp"
	/>
</svelte:head>

{#snippet companyScopeActions()}
	<Combobox
		ariaLabel={t('component.legal_entity')}
		options={companyOptions}
		value={selectedCompanyId}
		onValueChange={(value) => {
			companyId = typeof value === 'string' ? value : (companies[0]?.norbital_id ?? null);
			boardQuery.setPageIndex(0);
		}}
		emptyPlaceholder={t('component.select_legal_entity')}
		searchPlaceholder={t('component.search_companies')}
		clientConfig={{
			isLoading: companiesQuery.loading,
			error: companiesQuery.error?.message ?? null
		}}
		class="min-w-[16rem]"
	/>
{/snippet}

{#snippet monthNavigation()}
	<Button
		variant="outline"
		size="icon"
		aria-label={t('app.scheduling.previous_month')}
		onclick={() => stepMonth(-1)}>‹</Button
	>
	<span class="min-w-[6rem] text-center text-sm font-medium tabular-nums">{month}</span>
	<Button
		variant="outline"
		size="icon"
		aria-label={t('app.scheduling.next_month')}
		onclick={() => stepMonth(1)}>›</Button
	>
{/snippet}

<!--
	The board's rows are people, while its filters are generated from the roster-entry schema. A
	matching roster entry keeps its person on screen and the board still shows that person's complete
	month, so a filter narrows the roster without stripping away the calendar context.

	Import is an ordinary import pipeline, which is what lets it state its own refusal. A published
	month cannot take one, and saying so belongs next to the action rather than in a `title` nobody
	reads with a keyboard.
-->
{#snippet boardToolbar()}
	<CollectionActionToolbar
		{client}
		collection="roster_entries"
		query={boardQuery}
		navigation={monthNavigation}
		searchPlaceholder={t('app.scheduling.search_people_placeholder')}
		operations={{
			importPipelines: [
				{
					id: 'roster-workbook',
					label: t('app.scheduling.import'),
					description: t('app.scheduling.import_title', { month }),
					icon: 'lucide:upload',
					getDisabledReason: () => rosterImportBlocker,
					run: () => importRoster()
				}
			],
			refresh: reloadBoard
		}}
	/>
{/snippet}

{#snippet monthStatus()}
	<Stack gap="sm">
		<Cluster gap="sm">
			{#if progress.drafting === 'NOT_DRAFTED'}
				<Badge variant="outline">{t('app.scheduling.not_drafted_for', { month })}</Badge>
				<Badge variant="outline">
					{t('app.scheduling.person_days_to_plan', { count: progress.personDays.toLocaleString() })}
				</Badge>
			{:else}
				{#each rosters as roster (roster.norbital_id)}
					<Inline gap="xs">
						<Badge variant={roster.published_at == null ? 'outline' : 'default'}>
							{roster.published_at == null
								? t('app.scheduling.draft')
								: t('app.scheduling.published')}
						</Badge>
						{#if roster.published_at == null}
							<Button size="sm" disabled={publishing} onclick={() => publish(roster.norbital_id)}>
								{t('app.scheduling.publish_month', { month })}
							</Button>
						{:else}
							<Button
								size="sm"
								variant="outline"
								disabled={publishing}
								onclick={() => reopen(roster.norbital_id)}
							>
								{t('app.scheduling.re_open')}
							</Button>
						{/if}
					</Inline>
				{/each}
				{#if progress.drafting === 'DRAFT'}
					<!-- Progress, not a fault: a month is drafted a day at a time and is incomplete for most
					     of the time it is being written. -->
					<Badge variant="outline">
						{t('app.scheduling.person_days_drafted', {
							rostered: progress.rostered.toLocaleString(),
							total: progress.personDays.toLocaleString()
						})}
					</Badge>
				{/if}
			{/if}
			{#each progress.exceptions as exception (exception.status)}
				<Badge variant="destructive">
					{exception.count.toLocaleString()}
					{t(STATUS_PRESENTATION[exception.status].labelKey).toLowerCase()}
				</Badge>
			{/each}
		</Cluster>
		{#if progress.drafting === 'NOT_DRAFTED'}
			<p class="text-sm text-muted-foreground">
				{t('app.scheduling.not_drafted_note', { month })}
			</p>
		{:else if rosterImportBlocker != null}
			<p class="text-sm text-muted-foreground">{rosterImportBlocker}</p>
		{/if}
		<p class="text-sm text-muted-foreground">
			{t('app.scheduling.publishing_note')}
		</p>
	</Stack>
{/snippet}

{#snippet boardChrome()}
	<Stack gap="md">
		{@render boardToolbar()}
		{@render monthStatus()}
	</Stack>
{/snippet}

{#snippet boardPagination()}
	<CollectionPagination query={boardQuery} total={boardPeople.length} />
{/snippet}

<!--
	The chrome is the `Cover`'s top row, the page stepper is its bottom row, and the board is its body,
	which is what gives the board a definite height to fill: `Cover`'s middle track is `minmax(0,1fr)`.
	The board owns the scroll from there, so the tab panel around it never has to — the same division
	`CollectionTable` makes between its toolbar, its rows and its pagination.

	The stepper is withheld while the month is loading or broken, because a page count taken from a
	half-built board is a number that will change under the reader.
-->
{#snippet board()}
	{#if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_board')}</p>
	{:else}
		{@const boardReady = boardErrors.length === 0 && !loading}
		<Cover gap="md" top={boardChrome} bottom={boardReady ? boardPagination : undefined}>
			{#if boardErrors.length > 0}
				<!-- A terminal state, so a board that cannot be built says so instead of pretending to
				     still be loading. Retry rebuilds the queries in place; the month, the search and the
				     filters all survive it. -->
				<Alert variant="destructive">
					<AlertTitle>{t('app.scheduling.board_load_failed', { month })}</AlertTitle>
					<AlertDescription>
						<Stack gap="sm">
							<Stack as="ul" gap="xs" class="list-disc pl-4">
								{#each boardErrors as boardError (boardError)}
									<li>{boardError}</li>
								{/each}
							</Stack>
							<Inline>
								<Button size="sm" variant="outline" onclick={() => void reloadBoard()}>
									<IconWrapper name="lucide:refresh-cw" class="size-4" />
									{t('app.scheduling.retry')}
								</Button>
							</Inline>
						</Stack>
					</AlertDescription>
				</Alert>
			{:else if loading}
				<p class="text-sm text-muted-foreground">{t('app.scheduling.loading_month', { month })}</p>
			{:else if people.length > 0 && boardPeople.length === 0}
				<p class="text-sm text-muted-foreground">{t('app.scheduling.no_matches')}</p>
			{:else}
				<RosterMonthBoard
					{month}
					people={visibleBoardPeople}
					{facts}
					{today}
					{holidayNames}
					{cutoff}
				/>
			{/if}
		</Cover>
	{/if}
{/snippet}

{#snippet shifts()}
	{#if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_shifts')}</p>
	{:else}
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">
				{t('app.scheduling.shift_intro')}
			</p>
			<CollectionTable
				{client}
				collection="shift_definitions"
				view={`hr_controller:scheduling:shifts:${selectedCompanyId}`}
				query={{
					where: { company_id: { eq: selectedCompanyId }, ...activeRange },
					orderBy: { code: 'asc' }
				}}
				searchPlaceholder={t('app.scheduling.search_shifts_placeholder')}
			>
				{#snippet columns({ Column })}
					<Column name="code" card="title" />
					<Column name="name" card="subtitle" />
					<Column name="variant" label={t('app.scheduling.roster_code_definition')} />
					<Column name="effective_range" label={t('component.effective')} />
				{/snippet}
			</CollectionTable>
		</Stack>
	{/if}
{/snippet}

{#snippet patterns()}
	{#if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_patterns')}</p>
	{:else}
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">
				{t('app.scheduling.pattern_intro')}
			</p>
			<CollectionTable
				{client}
				collection="employment_terms"
				view={`hr_controller:scheduling:patterns:${selectedCompanyId}`}
				query={{
					where: {
						term_employment: { company_id: { eq: selectedCompanyId } },
						...approved
					},
					orderBy: { effective_range: 'desc' }
				}}
				searchPlaceholder={t('app.scheduling.search_patterns')}
			>
				{#snippet columns({ Column })}
					<Column name="employment_id" card="title" />
					<Column name="summary" card="subtitle" />
					<Column name="work_pattern" label={t('component.work_pattern')} />
					<Column name="effective_range" label={t('component.effective')} />
				{/snippet}
			</CollectionTable>
		</Stack>
	{/if}
{/snippet}

{#snippet holidays()}
	{#if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_holidays')}</p>
	{:else}
		<CollectionTable
			{client}
			collection="company_holidays"
			view={`hr_controller:scheduling:holidays:${selectedCompanyId}`}
			query={{
				where: { company_id: { eq: selectedCompanyId } },
				orderBy: { date: 'desc' }
			}}
			searchPlaceholder={t('app.scheduling.search_holidays')}
		>
			{#snippet columns({ Column })}
				<Column
					name="date"
					label={t('component.date')}
					card="title"
					render={({ value }) => formatCalendarDate(value)}
				/>
				<Column name="name" card="subtitle" />
				<Column
					name="scope"
					label={t('component.scope')}
					render={({ value }) => formatHolidayScope(value, t)}
				/>
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

<AppHeaderActions>
	{@render companyScopeActions()}
</AppHeaderActions>

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'board',
				label: t('app.scheduling.tab_board'),
				icon: 'lucide:calendar-range',
				content: board
			},
			{
				name: 'shifts',
				label: t('app.scheduling.tab_shifts'),
				icon: 'lucide:clock-4',
				content: shifts
			},
			{
				name: 'patterns',
				label: t('app.scheduling.tab_patterns'),
				icon: 'lucide:calendar-cog',
				content: patterns
			},
			{
				name: 'holidays',
				label: t('app.scheduling.tab_holidays'),
				icon: 'lucide:party-popper',
				content: holidays
			}
		] satisfies TabConfig[]}
	/>
</Cover>
