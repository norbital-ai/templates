<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { CollectionQueryState } from '@norbital-ai/ui/collection-query';
	import { CollectionActionToolbar } from '@norbital-ai/ui/collection-toolbar';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Button } from '@norbital-ai/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { Badge } from '@norbital-ai/ui/badge';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { Display, type ChartDisplaySpec } from '@norbital-ai/ui/chart';
	import { Bound, Cluster, Cover, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { formatCalendarDate, formatHolidayScope } from '../../lib/ui/display-formatters.js';
	import { runWorkbookImport } from '../../lib/ui/workbook-import.js';
	import { rosterImportPayload } from '../../collections/roster_entries/lib/import-workbook.js';
	import { timeEntryImportPayload } from '../../collections/time_entries/lib/import-workbook.js';
	import {
		calendarDayKey,
		monthKey,
		shiftDayKey,
		shiftMonthKey,
		startOfIsoWeekDate,
		todayKey,
		todayInstant
	} from '../../lib/ui/calendar.js';
	import RosterMonthBoard, { type BoardCell } from '../../lib/ui/roster/roster-month-board.svelte';
	import DaySheet, { type DaySheetChange } from '../../lib/ui/roster/day-sheet.svelte';
	import {
		STATUS_PRESENTATION,
		buildRosterMonth,
		employmentMonthEmptyReason,
		employmentOverlapsMonth,
		holidayNamesByDate,
		lockRung,
		lockRungFreezes,
		lockRungSourceLock,
		monthDays,
		monthProgress,
		type DayFacts,
		type DayStatus,
		type IntervalDraft,
		type MonthDrafting
	} from '../../lib/ui/roster/roster-month.js';
	import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
	import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
	import {
		payrollWindows,
		lockMap,
		sourceLockReason,
		type SettlementClaim
	} from '../../lib/scheduling/lock.js';
	import {
		overlappingWorkShifts,
		validateRosterSchedule,
		type ValidationDay,
		type WorkloadExpectation
	} from '../../collections/rosters/lib/workforce-validation.js';

	const { t } = useI18n<TenantI18nKeys>();

	let companyId = $state<string | null>(null);
	let month = $state<string>(monthKey(todayKey()));
	let publishing = $state(false);
	let creatingDraft = $state(false);
	/**
	 * The day sheet's subject and its transient write state.
	 *
	 * This used to be a `Dialog` with one combobox in it, because a cell owned one fact. A cell now
	 * owns two records and a lock explanation, and a modal that covers the board takes the month away
	 * while the operator decides about one day of it — see `day-sheet.svelte`'s own header for the
	 * rest of that argument. The app keeps only what it has to write with; the drawer owns its
	 * editors.
	 */
	let daySheetOpen = $state(false);
	let daySheetEmploymentId = $state<string | null>(null);
	let daySheetDate = $state<string | null>(null);
	/** The code currently chosen inside the drawer, mirrored back so the overlap check stays live. */
	let daySheetDraftCodeId = $state<string | null>(null);
	let daySheetSaving = $state(false);
	let daySheetError = $state<string | null>(null);
	/** The armed end of a swap. Bound to the board, so a drag and the drawer's button set one thing. */
	let swapSource = $state<BoardCell | null>(null);
	let swapping = $state(false);
	/** Which exception counter the operator drilled into, or null for the whole month. */
	let exceptionFilter = $state<DayStatus | null>(null);
	let activeTab = $state('board');
	/**
	 * Search and filter state in the same model every collection surface uses.
	 *
	 * The board used to keep its own search string and private page cursor, and every handler that
	 * narrowed the set had to remember to reset a private page cursor. The board is already a bounded
	 * two-axis scrollport, so paginating its people axis only hid colleagues behind a second, unrelated
	 * navigation model.
	 */
	const boardQuery = new CollectionQueryState();
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
			with: { employment_employee: { columns: { name: true } } },
			orderBy: { employee_number: 'asc' },
			limit: 1000
		});
	});
	/**
	 * Person-day queries must not start against an empty employment list and then recreate
	 * themselves with an `in` clause — that abort is what left the board on `Loading …`.
	 */
	const employmentsReady = $derived(
		employmentsQuery != null && employmentsQuery.current !== undefined
	);
	const employments = $derived(employmentsQuery?.current ?? []);
	const monthEmployments = $derived(
		employments.filter((employment) => employmentOverlapsMonth(employment, month))
	);
	const emptyEmploymentReason = $derived(employmentMonthEmptyReason(employments, month));
	type EmploymentPerson = WorkspaceRow<'employments'> & {
		readonly employment_employee?: Pick<WorkspaceRow<'employees'>, 'name'> | null;
	};
	function employmentPersonName(row: EmploymentPerson): string {
		return row.employment_employee?.name ?? '—';
	}
	const people = $derived(
		monthEmployments.map((employment) => ({
			id: employment.norbital_id,
			number: employment.employee_number,
			name: employmentPersonName(employment)
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
		if (selectedCompanyId == null || !employmentsReady) return null;
		return client.db.roster_entries.findMany({
			where: {
				...approved,
				work_date: { gte: monthStart, lte: monthEnd },
				...(monthEmployments.length > 0
					? { employment_id: { in: monthEmployments.map((e) => e.norbital_id) } }
					: {
							roster_entry_employment: { ...approved, company_id: { eq: selectedCompanyId } }
						})
			},
			columns: {
				norbital_id: true,
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				assignment_code: true
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
		if (selectedCompanyId == null || !employmentsReady || boardQuery.filters.length === 0)
			return null;
		return client.db.roster_entries.findMany(
			{
				where: {
					...approved,
					work_date: { gte: monthStart, lte: monthEnd },
					...(monthEmployments.length > 0
						? { employment_id: { in: monthEmployments.map((e) => e.norbital_id) } }
						: {
								roster_entry_employment: { ...approved, company_id: { eq: selectedCompanyId } }
							})
				},
				columns: {
					norbital_id: true,
					employment_id: true,
					work_date: true,
					shift_definition_id: true,
					assignment_code: true
				},
				limit: 5000
			},
			boardQuery.queryOptions
		);
	});
	const timeEntriesQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null || !employmentsReady) return null;
		return client.db.time_entries.findMany({
			where: {
				...approved,
				work_date: { gte: monthStart, lte: monthEnd },
				...(monthEmployments.length > 0
					? { employment_id: { in: monthEmployments.map((e) => e.norbital_id) } }
					: {
							time_entry_employment: { ...approved, company_id: { eq: selectedCompanyId } }
						})
			},
			// `norbital_id` and `break_minutes` are what §1.3 of the proposal adds, and both are needed
			// by the same surface: the day sheet updates *this* record rather than creating a second
			// one for the day, and it cannot assess the unpaid break without knowing what it is.
			columns: {
				norbital_id: true,
				employment_id: true,
				work_date: true,
				worked_intervals: true,
				break_minutes: true
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
	/**
	 * Pending leave is drawn on the board as uncommitted coverage: it never reads as a taken day,
	 * but it warns an operator who plans work into it. The roster hook allows the assignment; the
	 * conflict flag makes the approval a decision rather than a silent double-book.
	 */
	const pendingLeaveQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.leave_requests.findMany({
			where: {
				norbital_approval_id: { isNotNull: true },
				leave_request_employment: { ...approved, company_id: { eq: selectedCompanyId } },
				kind: { eq: 'TIME_OFF' },
				from_date: { lte: monthEnd },
				to_date: { gte: monthStart }
			},
			limit: 2000
		});
	});
	/**
	 * Every payroll run the company has, not just this month's: the board's lock stripes come from
	 * whichever run's window covers each day, and a paid window is drawn and enforced everywhere.
	 */
	const payrollRunsQuery = $derived.by(() => {
		void reloadToken;
		if (selectedCompanyId == null) return null;
		return client.db.payroll_runs.findMany({
			where: { ...approved, company_id: { eq: selectedCompanyId } },
			columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
			limit: 500
		});
	});
	/**
	 * The settlement claims held over this month's attendance, which is the third rung of the ladder.
	 *
	 * The board could already say "this day is inside a paid period" — arithmetic over
	 * `payroll_runs` windows. It could not say "a run has taken THIS record", which is the fact the
	 * owner actually asked to see and the only one that is stored. `payslip_sources` answers it,
	 * and `+hr_controller.policy.ts` already grants the read: `settlementLedgerGrants` exists so that
	 * a refusal can be an explanation rather than an access denial.
	 *
	 * Scoped by the entry ids the month's own query returned, so it is at most one row per person-day
	 * and never a scan of every claim the company has ever taken.
	 */
	const settlementsQuery = $derived.by(() => {
		void reloadToken;
		const entryIds = (timeEntriesQuery?.current ?? []).map((entry) => entry.norbital_id);
		if (selectedCompanyId == null || entryIds.length === 0) return null;
		return client.db.payslip_sources.findMany({
			where: {
				...approved,
				source_collection: { eq: 'time_entries' },
				source_record_id: { in: entryIds }
			},
			columns: { source_record_id: true, period: true },
			limit: 5000
		});
	});
	const settlementClaims = $derived(
		new Map<string, SettlementClaim>(
			(settlementsQuery?.current ?? []).map((claim) => [
				claim.source_record_id,
				{ period: claim.period }
			])
		)
	);

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
		{ label: 'pending leave', query: pendingLeaveQuery },
		{ label: 'holidays', query: holidaysQuery },
		{ label: 'employments', query: employmentsQuery },
		{ label: 'employment schedules', query: employmentTermsQuery },
		{ label: 'roster codes', query: shiftsQuery },
		{ label: 'payroll runs', query: payrollRunsQuery },
		{ label: 'settlement claims', query: settlementsQuery }
	]);
	const boardErrors = $derived(
		boardSources.flatMap((source) =>
			source.query?.error ? [`${source.label}: ${source.query.error.message}`] : []
		)
	);
	/**
	 * Only the month-scoped reads the grid cannot draw without. Names, pattern projection and
	 * the filter probe can arrive later — gating on those is what left Published badges on
	 * screen while the body sat on `Loading …`.
	 */
	const boardReadySources = $derived([
		{ label: 'roster entries', query: rosterEntriesQuery },
		{ label: 'attendance', query: timeEntriesQuery },
		{ label: 'leave', query: leaveQuery },
		{ label: 'holidays', query: holidaysQuery },
		{ label: 'employments', query: employmentsQuery },
		{ label: 'roster codes', query: shiftsQuery }
	]);
	const loading = $derived(
		boardErrors.length === 0 &&
			(selectedCompanyId == null ||
				!employmentsReady ||
				boardReadySources.some(
					(source) => source.query != null && source.query.current === undefined
				))
	);

	/** Overlaid onto the board from the company calendar; never a mark stored on a roster entry. */
	const companyHolidays = $derived(holidaysQuery?.current ?? []);
	const holidayNames = $derived(holidayNamesByDate(companyHolidays));

	const facts = $derived(
		buildRosterMonth({
			month,
			employments: monthEmployments,
			employmentTerms: employmentTermsQuery?.current ?? [],
			rosterEntries: rosterEntriesQuery?.current ?? [],
			timeEntries: timeEntriesQuery?.current ?? [],
			leaveRequests: leaveQuery?.current ?? [],
			pendingLeaveRequests: pendingLeaveQuery?.current ?? [],
			holidays: companyHolidays,
			rosterCodesById,
			leaveCodeById,
			cutoff,
			locks: lockMap(payrollWindows(payrollRunsQuery?.current ?? []), monthDays(month)),
			today
		})
	);
	const rosterEntries = $derived(rosterEntriesQuery?.current ?? []);
	const explicitEntryByKey = $derived(
		new Map(
			rosterEntries.map((entry) => [
				`${entry.employment_id}:${calendarDayKey(entry.work_date)}`,
				entry
			])
		)
	);

	const filteredEmploymentIds = $derived(
		new Set((filteredRosterEntriesQuery?.current ?? []).map((entry) => entry.employment_id))
	);
	/**
	 * The people an exception drill-through leaves on the board.
	 *
	 * This is the argument for deleting the raw `time_entries` table rather than moving it. A list of
	 * exceptions beside a board of person-days is two places to read the same month, and the table
	 * half has no idea what a rest day is. Narrowing the board *is* the list — the person-days that
	 * are wrong stay on screen with the plan and the lock still drawn beside them, which is what an
	 * operator needs in order to fix one.
	 *
	 * The month and the search survive it, because they describe a different question.
	 */
	const exceptionEmploymentIds = $derived.by(() => {
		if (exceptionFilter == null) return null;
		const affected = new Set<string>();
		for (const day of facts.values()) {
			if (day.status === exceptionFilter) affected.add(day.employmentId);
		}
		return affected;
	});
	const boardPeople = $derived(
		people.filter((person) => {
			const term = boardQuery.search.toLowerCase();
			if (term !== '' && !`${person.number} ${person.name}`.toLowerCase().includes(term)) {
				return false;
			}
			if (exceptionEmploymentIds != null && !exceptionEmploymentIds.has(person.id)) return false;
			return (
				boardQuery.filters.length === 0 ||
				filteredRosterEntriesQuery?.current === undefined ||
				filteredEmploymentIds.has(person.id)
			);
		})
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
	const boardHelp = $derived(
		progress.drafting === 'NOT_DRAFTED'
			? t('app.scheduling.help_not_drafted')
			: progress.drafting === 'DRAFT'
				? t('app.scheduling.help_draft')
				: t('app.scheduling.help_published')
	);

	function exceptionCopy(status: (typeof progress.exceptions)[number]['status'], count: string) {
		switch (status) {
			case 'ABSENT':
				return t('app.scheduling.exception_absent', { count });
			case 'OPEN':
				return t('app.scheduling.exception_open', { count });
			case 'UNROSTERED':
				return t('app.scheduling.exception_unrostered', { count });
			case 'BEFORE_START':
			case 'EXITED':
			case 'PLANNED':
			case 'ATTENDED':
			case 'ON_LEAVE':
			case 'REST':
			case 'OFF':
				return `${count} ${t(STATUS_PRESENTATION[status].labelKey)}`;
			default: {
				const unhandled: never = status;
				throw new Error(`Unhandled exception status: ${String(unhandled)}`);
			}
		}
	}
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

	async function createDraftMonth(): Promise<void> {
		if (selectedCompanyId == null) return;
		const create = client.db.rosters.create;
		if (create == null) {
			toast.error(t('app.scheduling.toast_draft_not_permitted'));
			return;
		}
		creatingDraft = true;
		try {
			await create({ company_id: selectedCompanyId, month, published_at: null });
			toast.success(t('app.scheduling.toast_draft_created', { month }));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('app.scheduling.toast_draft_failed'));
		} finally {
			creatingDraft = false;
		}
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

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * SCHEDULE FACTS THE SWAP AND THE OVERLAP CHECK BOTH NEED
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	const timeEntryByKey = $derived(
		new Map(
			(timeEntriesQuery?.current ?? []).map((entry) => [
				`${entry.employment_id}:${calendarDayKey(entry.work_date)}`,
				entry
			])
		)
	);

	function claimFor(day: { readonly timeEntryId: string | null }): SettlementClaim | null {
		return day.timeEntryId == null ? null : (settlementClaims.get(day.timeEntryId) ?? null);
	}

	function termCovers(
		term: { readonly effective_range: { start?: string | Date; end?: string | Date } | null },
		date: string
	): boolean {
		if (term.effective_range?.start == null) return false;
		const start = calendarDayKey(term.effective_range.start);
		const end = term.effective_range.end == null ? null : calendarDayKey(term.effective_range.end);
		return date >= start && (end == null || date <= end);
	}

	function activeTermFor(employmentId: string, date: string) {
		return (
			(employmentTermsQuery?.current ?? []).find(
				(term) => term.employment_id === employmentId && termCovers(term, date)
			) ?? null
		);
	}

	/**
	 * The roster code a person-day actually resolves to: the explicit entry, or the pattern's
	 * projection when nobody has assigned the day. The same precedence `buildRosterMonth` uses, and
	 * the same one the publish check uses — a swap that read a different one would move a code that
	 * was never there.
	 */
	function effectiveCodeId(employmentId: string, date: string): string | null {
		const explicit = explicitEntryByKey.get(`${employmentId}:${date}`);
		if (explicit != null) return explicit.shift_definition_id;
		const term = activeTermFor(employmentId, date);
		return term == null ? null : patternRosterCodeId(term.work_pattern, date);
	}

	function validationDay(employmentId: string, date: string, codeId: string | null): ValidationDay {
		const code = codeId == null ? null : rosterCodesById.get(codeId);
		const kind = code == null ? null : rosterCodeKind(code.variant);
		const window = code != null && kind === 'WORK' ? workWindow(code.variant) : null;
		return {
			employment_id: employmentId,
			work_date: date,
			designation: kind,
			shift:
				code == null || window == null
					? null
					: {
							code: code.code,
							start_time: window.start_time,
							end_time: window.end_time,
							break_minutes: window.break_minutes
						}
		};
	}

	/** The day before and the day after, which is where a shift can overrun into another one. */
	function adjacentValidationDays(employmentId: string, date: string): ValidationDay[] {
		return [shiftDayKey(date, -1), shiftDayKey(date, 1)].flatMap((neighbour) => {
			const day = facts.get(`${employmentId}:${neighbour}`);
			return day?.designation === 'WORK' && day.shiftStart != null && day.shiftEnd != null
				? [
						{
							employment_id: day.employmentId,
							work_date: day.date,
							designation: 'WORK' as const,
							shift: {
								code: day.shiftCode ?? 'WORK',
								start_time: day.shiftStart,
								end_time: day.shiftEnd,
								break_minutes: day.shiftBreakMinutes ?? 0
							}
						}
					]
				: [];
		});
	}

	/**
	 * The contractual amount one employment is owed or capped at this month.
	 *
	 * The same three arms `rosters/+hooks.ts` builds at publication, restricted to two people and
	 * one month. It is repeated rather than imported because the hook builds it inside an Effect
	 * over the server's own api and reads columns this browser has not fetched; what is shared is
	 * the thing that matters — `validateRosterSchedule` is the one judge, so a swap the board allows
	 * is a swap the publish check will also allow.
	 */
	function expectationsFor(employmentId: string): WorkloadExpectation[] {
		const expectations: WorkloadExpectation[] = [];
		const days = monthDays(month);
		for (const term of employmentTermsQuery?.current ?? []) {
			if (term.employment_id !== employmentId) continue;
			const activeDates = days.filter((date) => termCovers(term, date));
			if (activeDates.length === 0) continue;
			const start = activeDates[0]!;
			const end = activeDates[activeDates.length - 1]!;
			const pattern = term.work_pattern;
			if (pattern.type === 'PATTERNED') {
				let workDays = 0;
				let paidMinutes = 0;
				for (const date of activeDates) {
					const projected = patternRosterCodeId(pattern, date);
					const code = projected == null ? null : rosterCodesById.get(projected);
					if (code == null || rosterCodeKind(code.variant) !== 'WORK') continue;
					workDays += 1;
					paidMinutes += workWindow(code.variant)?.paid_minutes ?? 0;
				}
				expectations.push({
					employment_id: employmentId,
					start_date: start,
					end_date: end,
					kind: 'EXACT',
					work_days: workDays,
					paid_minutes: paidMinutes
				});
				continue;
			}
			const expectation = pattern.expectation;
			const referenceDays = expectation.period === 'WEEK' ? 7 : days.length;
			const fraction = activeDates.length / referenceDays;
			if (expectation.kind === 'GUARANTEED_SCHEDULE') {
				expectations.push({
					employment_id: employmentId,
					start_date: start,
					end_date: end,
					kind: 'MINIMUM',
					work_days: Math.ceil(expectation.required_work_days * fraction),
					paid_minutes: Math.ceil(expectation.required_paid_minutes * fraction)
				});
			} else if (expectation.maximum_paid_minutes != null) {
				expectations.push({
					employment_id: employmentId,
					start_date: start,
					end_date: end,
					kind: 'MAXIMUM',
					work_days: null,
					paid_minutes: Math.floor(expectation.maximum_paid_minutes * fraction)
				});
			}
		}
		return expectations;
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * THE DAY SHEET
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	function openDaySheet(employmentId: string, date: string): void {
		daySheetEmploymentId = employmentId;
		daySheetDate = date;
		daySheetDraftCodeId = effectiveCodeId(employmentId, date);
		daySheetError = null;
		daySheetOpen = true;
	}

	const daySheetKey = $derived(
		daySheetEmploymentId == null || daySheetDate == null
			? null
			: `${daySheetEmploymentId}:${daySheetDate}`
	);
	const daySheetDay = $derived(daySheetKey == null ? undefined : facts.get(daySheetKey));
	const daySheetPerson = $derived(
		people.find((person) => person.id === daySheetEmploymentId) ?? null
	);
	const daySheetEntry = $derived(
		daySheetKey == null ? null : (timeEntryByKey.get(daySheetKey) ?? null)
	);
	/**
	 * The punches the drawer edits.
	 *
	 * Read off the month's own attendance query rather than re-fetched, so the sheet and the cell
	 * behind it can never be a write apart. `DayFacts` carries totals, not intervals — a grid needs
	 * a glyph — so this is the one place the list itself is needed.
	 */
	const daySheetIntervals = $derived<readonly IntervalDraft[]>(
		(daySheetEntry?.worked_intervals ?? []).map((interval) => ({
			start_at:
				typeof interval.start_at === 'string'
					? interval.start_at
					: new Date(interval.start_at).toISOString(),
			end_at:
				interval.end_at == null
					? null
					: typeof interval.end_at === 'string'
						? interval.end_at
						: new Date(interval.end_at).toISOString()
		}))
	);
	const daySheetHasExplicitEntry = $derived(
		daySheetKey != null && explicitEntryByKey.has(daySheetKey)
	);
	const daySheetNote = $derived(
		daySheetKey == null ? null : (explicitEntryByKey.get(daySheetKey)?.note ?? null)
	);
	const daySheetRung = $derived(
		daySheetDay == null ? 'OPEN' : lockRung(daySheetDay, claimFor(daySheetDay))
	);
	const daySheetLockReason = $derived.by(() => {
		if (daySheetDay == null) return null;
		const lock = lockRungSourceLock(daySheetDay, claimFor(daySheetDay));
		return lock == null ? null : sourceLockReason(lock, t);
	});
	/**
	 * The plan half is frozen by publication, which is a third axis and not part of the lock ladder.
	 *
	 * `roster_entries/+hooks.ts` refuses every write in a published month, and that freeze stays
	 * exactly as it is. §2.4 of the proposal argues for a narrow `AMENDMENT` origin arm that would
	 * open single-cell writes in a published month; it is an unresolved decision that needs an enum
	 * change and a migration, so it is deliberately NOT built. This is the integration point: when
	 * the arm exists, this is the derivation that stops saying "no" and starts offering it.
	 */
	const daySheetPlanLocked = $derived(draftRoster == null);
	const daySheetPlanLockedReason = $derived(
		draftRoster != null
			? null
			: rosters.length === 0
				? t('app.scheduling.blocker_no_draft', { month })
				: t('app.scheduling.blocker_published', { month })
	);

	/** Roster codes effective on the day the drawer is open on. */
	const daySheetCodeOptions = $derived.by(() => {
		const date = daySheetDate;
		return (shiftsQuery?.current ?? [])
			.filter((code) => {
				const start =
					code.effective_range?.start == null ? null : calendarDayKey(code.effective_range.start);
				const end =
					code.effective_range?.end == null ? null : calendarDayKey(code.effective_range.end);
				return date != null && start != null && date >= start && (end == null || date <= end);
			})
			.map((code) => {
				const window = rosterCodeKind(code.variant) === 'WORK' ? workWindow(code.variant) : null;
				return {
					value: code.norbital_id,
					label:
						window == null
							? `${code.code} · ${rosterCodeKind(code.variant)}`
							: `${code.code} · ${window.start_time}–${window.end_time}`,
					search_term: `${code.code} ${code.name} ${window?.start_time ?? ''} ${window?.end_time ?? ''}`
				};
			});
	});

	/**
	 * The overlap the drawer's current choice would create, checked live over the ±1-day window.
	 *
	 * Unchanged in substance from the dialog this replaces — `overlappingWorkShifts` over the day
	 * before, the day itself and the day after — but driven by what the drawer currently has
	 * selected rather than by app state, which is why the drawer mirrors its draft code back.
	 */
	const daySheetOverlap = $derived.by(() => {
		if (daySheetEmploymentId == null || daySheetDate == null || daySheetDraftCodeId == null)
			return null;
		const selected = validationDay(daySheetEmploymentId, daySheetDate, daySheetDraftCodeId);
		return (
			overlappingWorkShifts([
				...adjacentValidationDays(daySheetEmploymentId, daySheetDate),
				selected
			])[0] ?? null
		);
	});
	const daySheetOverlapWarning = $derived(
		daySheetOverlap == null
			? null
			: t('roster.overlapping_shift_description', {
					first: daySheetOverlap.first.shift?.code ?? 'WORK',
					second: daySheetOverlap.second.shift?.code ?? 'WORK'
				})
	);

	async function saveDaySheet(change: DaySheetChange): Promise<void> {
		daySheetSaving = true;
		daySheetError = null;
		try {
			if (change.plan != null) await writePlan(change.employmentId, change.date, change.plan);
			if (change.attendance != null) await writeAttendance(change);
			daySheetOpen = false;
			await reloadBoard();
		} catch (error) {
			// The hooks refuse with the whole reason — the run holding the record, the leave that owns
			// the day, the statutory rule. That sentence is the message worth showing.
			daySheetError = error instanceof Error ? error.message : t('roster.assignment_failed');
		} finally {
			daySheetSaving = false;
		}
	}

	async function writePlan(
		employmentId: string,
		date: string,
		plan: { readonly rosterCodeId: string; readonly note: string | null }
	): Promise<void> {
		if (draftRoster == null) throw new Error(t('roster.assignment_not_permitted'));
		const existing = explicitEntryByKey.get(`${employmentId}:${date}`);
		if (existing != null) {
			const update = client.db.roster_entries.update;
			if (update == null) throw new Error(t('roster.assignment_not_permitted'));
			await update(existing.norbital_id, {
				shift_definition_id: plan.rosterCodeId,
				note: plan.note
			});
			return;
		}
		const create = client.db.roster_entries.create;
		if (create == null) throw new Error(t('roster.assignment_not_permitted'));
		await create({
			employment_id: employmentId,
			work_date: date,
			shift_definition_id: plan.rosterCodeId,
			roster_id: draftRoster.norbital_id,
			assignment_code: null,
			note: plan.note
		});
	}

	/**
	 * The attendance half, written through `client.db.time_entries` so every hook still runs.
	 *
	 * The break the drawer sends has already been clamped by `assessAttendanceDraft`, which is the
	 * same arithmetic `assertWorkedIntervals` uses — so this write cannot be refused for a break
	 * longer than the day, and the operator was told about the clamp before pressing save.
	 */
	async function writeAttendance(change: DaySheetChange): Promise<void> {
		const attendance = change.attendance;
		if (attendance == null) return;
		if (attendance.timeEntryId != null) {
			const update = client.db.time_entries.update;
			if (update == null) throw new Error(t('roster.attendance_not_permitted'));
			await update(attendance.timeEntryId, {
				worked_intervals: [...attendance.intervals],
				break_minutes: attendance.breakMinutes
			});
			return;
		}
		const create = client.db.time_entries.create;
		if (create == null) throw new Error(t('roster.attendance_not_permitted'));
		await create({
			employment_id: change.employmentId,
			work_date: change.date,
			worked_intervals: [...attendance.intervals],
			break_minutes: attendance.breakMinutes
		});
	}

	async function clearDaySheetPlan(): Promise<void> {
		if (draftRoster == null || daySheetKey == null) return;
		const existing = explicitEntryByKey.get(daySheetKey);
		if (existing == null) return;
		daySheetSaving = true;
		daySheetError = null;
		try {
			const remove = client.db.roster_entries.delete;
			if (remove == null) throw new Error(t('roster.assignment_not_permitted'));
			await remove(existing.norbital_id);
			daySheetOpen = false;
			await reloadBoard();
		} catch (error) {
			daySheetError = error instanceof Error ? error.message : t('roster.assignment_failed');
		} finally {
			daySheetSaving = false;
		}
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * THE SWAP — two cells, DRAFT MONTHS ONLY
	 *
	 * Every check below already existed; none of them is new. The overlap check is the one the day
	 * sheet runs for a single cell, over both people's ±1-day windows. The leave check is the client
	 * half of `assertDayNotOwnedByLeave`. `validateRosterSchedule` is the publish gate itself, run
	 * early over the post-swap month — a swap can break a contractual guarantee or a cap even when
	 * neither day looks wrong on its own, and finding that out at publication is finding it out a
	 * month late.
	 *
	 * WHY THIS IS NOT ONE STATEMENT. The collection client writes one record per call; there is no
	 * multi-record transaction at this boundary. So every check runs first, over the complete
	 * post-swap month, and the two writes go out only once nothing can refuse them on their merits.
	 * If the second still fails — a race with another operator, a lock taken in between — the first
	 * is put back and the pair is reported as a pair. That is weaker than a transaction and it is
	 * said out loud here rather than implied by an optimistic comment.
	 *
	 * SCOPED OUT: published months. `roster_entries/+hooks.ts` refuses every write in one and that
	 * freeze is untouched. §2.4's `AMENDMENT` origin arm would open a narrow path through it; it
	 * needs an enum change and a migration and the decision has not been taken, so the gesture is
	 * simply not offered outside a draft month.
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	const swapEnabled = $derived(draftRoster != null);

	/** The sentence a refused swap gets. One per pair — never one per row. */
	function swapRefusal(from: BoardCell, to: BoardCell): string | null {
		const fromDay = facts.get(`${from.employmentId}:${from.date}`);
		const toDay = facts.get(`${to.employmentId}:${to.date}`);
		if (fromDay == null || toDay == null) return t('roster.swap_refused_unknown');

		// 1. Both cells unlocked, by the ladder. One consumed day refuses the swap whole.
		for (const day of [fromDay, toDay]) {
			if (!lockRungFreezes(lockRung(day, claimFor(day)))) continue;
			const lock = lockRungSourceLock(day, claimFor(day));
			return (
				sourceLockReason(lock ?? { kind: 'NONE' }, t) ??
				t('roster.swap_refused_locked', { date: day.date })
			);
		}

		const fromCodeId = effectiveCodeId(from.employmentId, from.date);
		const toCodeId = effectiveCodeId(to.employmentId, to.date);
		if (fromCodeId == null || toCodeId == null) return t('roster.swap_refused_no_code');

		// 2. Approved leave owns a day: a swap must not drop work onto it. The client half of
		//    `assertDayNotOwnedByLeave`, which refuses the write server-side regardless.
		const landing: [ValidationDay, DayFacts][] = [
			[validationDay(from.employmentId, from.date, toCodeId), fromDay],
			[validationDay(to.employmentId, to.date, fromCodeId), toDay]
		];
		for (const [proposed, day] of landing) {
			if (proposed.designation === 'WORK' && day.leaveCode != null) {
				return t('roster.swap_refused_leave', { date: day.date, code: day.leaveCode });
			}
		}

		// 3. Overlapping work shifts, over BOTH people's ±1-day windows — exactly the check the day
		//    sheet runs for a single cell, run twice because a swap moves two.
		for (const [proposed] of landing) {
			const overlap = overlappingWorkShifts([
				...adjacentValidationDays(proposed.employment_id, proposed.work_date),
				proposed
			])[0];
			if (overlap != null) {
				return t('roster.overlapping_shift_description', {
					first: overlap.first.shift?.code ?? 'WORK',
					second: overlap.second.shift?.code ?? 'WORK'
				});
			}
		}

		// 4. The publish gate, run early over the post-swap month for both employments.
		const overrides = new Map<string, string | null>([
			[`${from.employmentId}:${from.date}`, toCodeId],
			[`${to.employmentId}:${to.date}`, fromCodeId]
		]);
		const employmentIds = [...new Set([from.employmentId, to.employmentId])];
		const days: ValidationDay[] = [];
		for (const employmentId of employmentIds) {
			for (const date of monthDays(month)) {
				const day = facts.get(`${employmentId}:${date}`);
				if (day == null || day.employmentState !== 'ACTIVE') continue;
				const codeId =
					overrides.get(`${employmentId}:${date}`) ?? effectiveCodeId(employmentId, date);
				// A ROSTERED month leaves unassigned days genuinely unassigned; the publish check
				// treats those as absent rather than as a missing code, so they are skipped here too.
				if (codeId == null) continue;
				days.push(validationDay(employmentId, date, codeId));
			}
		}
		const violations = validateRosterSchedule({
			days,
			expectations: employmentIds.flatMap((employmentId) => expectationsFor(employmentId))
		});
		return violations[0]?.message ?? null;
	}

	async function performSwap(from: BoardCell, to: BoardCell): Promise<void> {
		if (!swapEnabled || swapping) return;
		const refusal = swapRefusal(from, to);
		if (refusal != null) {
			toast.error(t('roster.swap_failed_pair', { from: from.date, to: to.date }), {
				description: refusal
			});
			return;
		}
		const fromCodeId = effectiveCodeId(from.employmentId, from.date);
		const toCodeId = effectiveCodeId(to.employmentId, to.date);
		if (fromCodeId == null || toCodeId == null) return;

		swapping = true;
		const note = t('roster.swap_note', { from: from.date, to: to.date });
		try {
			const restore = await writeSwapHalf(from, toCodeId, note);
			try {
				await writeSwapHalf(to, fromCodeId, note);
			} catch (second) {
				// Put the first half back. If that fails too, say so — a half-applied swap the
				// operator does not know about is the one outcome worth shouting about.
				await restore().catch(() => {
					toast.error(t('roster.swap_half_applied', { date: from.date }));
				});
				throw second;
			}
			toast.success(t('roster.swap_done', { from: from.date, to: to.date }));
			await reloadBoard();
		} catch (error) {
			toast.error(t('roster.swap_failed_pair', { from: from.date, to: to.date }), {
				description: error instanceof Error ? error.message : undefined
			});
		} finally {
			swapping = false;
		}
	}

	/**
	 * Write one end of a swap, and hand back the undo for it.
	 *
	 * The undo is captured before the write rather than reconstructed after it, because after the
	 * write the board's own query is the only record of what was there and it has not reloaded yet.
	 */
	async function writeSwapHalf(
		cell: BoardCell,
		codeId: string,
		note: string
	): Promise<() => Promise<void>> {
		if (draftRoster == null) throw new Error(t('roster.assignment_not_permitted'));
		const existing = explicitEntryByKey.get(`${cell.employmentId}:${cell.date}`);
		if (existing != null) {
			const update = client.db.roster_entries.update;
			if (update == null) throw new Error(t('roster.assignment_not_permitted'));
			const previousCode = existing.shift_definition_id;
			await update(existing.norbital_id, { shift_definition_id: codeId, note });
			return async () => {
				await update(existing.norbital_id, { shift_definition_id: previousCode, note: null });
			};
		}
		const create = client.db.roster_entries.create;
		if (create == null) throw new Error(t('roster.assignment_not_permitted'));
		const created = await create({
			employment_id: cell.employmentId,
			work_date: cell.date,
			shift_definition_id: codeId,
			roster_id: draftRoster.norbital_id,
			assignment_code: null,
			note
		});
		return async () => {
			const remove = client.db.roster_entries.delete;
			if (remove == null) return;
			await remove(created.norbital_id);
		};
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * ATTENDANCE IMPORT — §5. Built already; it was only reachable from the wrong screen.
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	/**
	 * A month of punches, landed on the board beside the roster import.
	 *
	 * Unlike the roster import this needs NO draft roster, and that is not an oversight: an
	 * assignment belongs to a roster, and attendance belongs to nothing but the day. A month nobody
	 * ever drafted still accepts its punches, which is the common case when a customer is
	 * backfilling history — so there is no `getDisabledReason` here to match the roster import's.
	 *
	 * `expandTimeMonthGrid` collects every problem in the file and throws one `WorkbookImportError`
	 * listing all of them, so a 300-person sheet is corrected once and re-imported once.
	 */
	async function importAttendance(): Promise<void> {
		await runWorkbookImport(
			{
				collectionName: 'time_entries',
				recordLabel: t('component.time_entries'),
				buildPayload: timeEntryImportPayload
			},
			t
		);
		await reloadBoard();
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * EXCEPTIONS — §8.3. The chart that was the whole of the retired Time & Attendance app.
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	const currentWeek = startOfIsoWeekDate(today) ?? today;
	const trendStart = shiftDayKey(currentWeek, -49);
	const attendanceSummaryQuery = $derived(
		selectedCompanyId == null
			? null
			: client.invoke.attendance_summary({
					company_id: selectedCompanyId,
					from: trendStart,
					to: today
				})
	);
	const attendanceChart = $derived({
		kind: 'line',
		loading: attendanceSummaryQuery?.loading ?? false,
		title: t('app.scheduling.exception_chart_title'),
		description: t('app.scheduling.exception_chart_description'),
		data: attendanceSummaryQuery?.current ?? [],
		xKey: 'week',
		series: ['exceptionRate'],
		config: {
			exceptionRate: {
				label: t('app.scheduling.exception_chart_rate'),
				color: 'var(--color-destructive)'
			}
		},
		valueFormat: { style: 'percent', maximumFractionDigits: 1 },
		curve: 'linear'
	} satisfies ChartDisplaySpec);

	/**
	 * Drill through from a counter to the person-days behind it.
	 *
	 * The counter and the board are computed from the same `facts`, so this narrows rather than
	 * queries: no second read, no chance of the list and the grid disagreeing about the month. The
	 * month and the search survive, because they answer a different question than "which days are
	 * wrong".
	 */
	function drillInto(status: DayStatus): void {
		exceptionFilter = exceptionFilter === status ? null : status;
		boardQuery.setPageIndex(0);
		activeTab = 'board';
	}
</script>

<svelte:head>
	<title>Scheduling</title>
	<meta
		name="description"
		content="Plan the monthly roster on a calendar, publish it against the statutory rules, and manage the shifts a day is worked on and the patterns a week is shaped by"
	/>
	<meta name="bolt:icon" content="lucide:calendar-clock" />
	<meta
		name="bolt:thumbnail"
		content="/api/template-seed-assets/hr-payroll/app-media/scheduling-banner.webp"
	/>
	<meta
		name="bolt:banner"
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
		operations={{
			importPipelines: [
				{
					id: 'roster-workbook',
					label: t('app.scheduling.import'),
					description: t('app.scheduling.import_title', { month }),
					icon: 'lucide:upload',
					getDisabledReason: () => rosterImportBlocker,
					run: () => importRoster()
				},
				{
					// No `getDisabledReason`. Attendance belongs to the day, not to a roster, so a month
					// that was never drafted still takes its punches — see `importAttendance`.
					id: 'time-entry-workbook',
					label: t('app.scheduling.import_attendance'),
					description: t('app.scheduling.import_attendance_description', { month }),
					icon: 'lucide:clock-arrow-up',
					run: () => importAttendance()
				}
			],
			refresh: reloadBoard
		}}
	/>
{/snippet}

{#snippet monthStatus()}
	<Cluster gap="sm">
		{#if progress.drafting === 'NOT_DRAFTED'}
			<Badge variant="outline">{t('app.scheduling.not_drafted_for', { month })}</Badge>
			{#if progress.peopleNeedingAssignment > 0}
				<Badge variant="outline">
					{t('app.scheduling.people_need_shifts', {
						count: progress.peopleNeedingAssignment.toLocaleString()
					})}
				</Badge>
			{/if}
			<Button size="sm" disabled={creatingDraft || publishing} onclick={() => createDraftMonth()}>
				{t('app.scheduling.start_planning', { month })}
			</Button>
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
				<Badge variant="outline">
					{t('app.scheduling.days_assigned', {
						rostered: progress.rostered.toLocaleString(),
						total: progress.personDays.toLocaleString()
					})}
				</Badge>
				{#if progress.peopleNeedingAssignment > 0}
					<Badge variant="outline">
						{t('app.scheduling.people_need_shifts', {
							count: progress.peopleNeedingAssignment.toLocaleString()
						})}
					</Badge>
				{/if}
			{/if}
		{/if}
		{#if !loading}
			<!--
				The counters are the exception list. Clicking one narrows the board to the people it
				counts, which is the whole argument for deleting the raw time-entries table: the list of
				exceptions IS the board, with the plan and the lock still drawn beside every day.
			-->
			{#each progress.exceptions as exception (exception.status)}
				<Button
					variant={exceptionFilter === exception.status ? 'default' : 'destructive'}
					size="sm"
					aria-pressed={exceptionFilter === exception.status}
					onclick={() => drillInto(exception.status)}
				>
					{exceptionCopy(exception.status, exception.count.toLocaleString())}
					<IconWrapper name="lucide:arrow-right" class="size-3" />
				</Button>
			{/each}
		{/if}
		{#if exceptionFilter != null}
			<Button size="sm" variant="ghost" onclick={() => (exceptionFilter = null)}>
				<IconWrapper name="lucide:x" class="size-3" />
				{t('app.scheduling.exception_filter_clear', {
					status: t(STATUS_PRESENTATION[exceptionFilter].labelKey)
				})}
			</Button>
		{/if}
		<Tooltip side="bottom" align="start" contentClass="max-w-80">
			{#snippet trigger({ props })}
				<Button {...props} variant="ghost" size="icon" aria-label={t('app.scheduling.board_help')}>
					<IconWrapper name="lucide:info" class="size-4" />
				</Button>
			{/snippet}
			{#snippet content()}
				<p class="text-xs leading-5">{boardHelp}</p>
			{/snippet}
		</Tooltip>
	</Cluster>
{/snippet}

{#snippet boardChrome()}
	<Stack gap="md">
		{@render boardToolbar()}
		{@render monthStatus()}
	</Stack>
{/snippet}

<!--
	The chrome is the `Cover`'s top row and the board is its body,
	which is what gives the board a definite height to fill: `Cover`'s middle track is `minmax(0,1fr)`.
	The board owns the scroll from there, so the tab panel around it never has to — the same division
	`CollectionTable` makes between its toolbar and its rows. The selected month already scopes the
	date axis; every matching person remains in the one bounded board scrollport.
-->
{#snippet board()}
	{#if companiesQuery.loading}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.loading_companies')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_board')}</p>
	{:else}
		<Cover gap="md" top={boardChrome}>
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
			{:else if people.length === 0}
				<p class="text-sm text-muted-foreground">
					{emptyEmploymentReason === 'NONE'
						? t('app.scheduling.no_company_employments')
						: emptyEmploymentReason === 'ENDED'
							? t('app.scheduling.employments_ended_before', { month })
							: emptyEmploymentReason === 'NOT_STARTED'
								? t('app.scheduling.employments_start_after', { month })
								: t('app.scheduling.employments_outside_month', { month })}
				</p>
			{:else}
				<RosterMonthBoard
					{month}
					people={boardPeople}
					{facts}
					{today}
					{holidayNames}
					locks={lockMap(payrollWindows(payrollRunsQuery?.current ?? []), monthDays(month))}
					{settlementClaims}
					{cutoff}
					editable={draftRoster != null}
					swappable={swapEnabled}
					bind:swapSource
					onSwapDays={(from, to) => void performSwap(from, to)}
					onSelectDay={openDaySheet}
				/>
			{/if}
		</Cover>
	{/if}
{/snippet}

<!--
	EXCEPTIONS — the whole of what `+time_attendance.svelte` was, minus the table.

	That app held two things: this chart, and an editable `time_entries` table. The table is deleted
	rather than moved, because a table of punches beside a board of person-days is two places to read
	the same month and only one of them knows what a rest day is. What remains is a trend and a set
	of counters, and neither of those is an app — they are a second view of the month the board is
	already showing, which is why they live here and why the counters below narrow the board rather
	than opening a list of their own.
-->
{#snippet exceptions()}
	<Bound size="full">
		<Scroll name={t('app.scheduling.tab_exceptions')}>
			{#if companiesQuery.loading}
				<p class="text-sm text-muted-foreground">{t('app.scheduling.loading_companies')}</p>
			{:else if selectedCompanyId == null}
				<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_exceptions')}</p>
			{:else}
				<Grid gap="xl" minimum="panel">
					<Stack gap="md">
						<div>
							<h2 class="text-heading">{t('app.scheduling.exceptions_title')}</h2>
							<p class="text-sm text-muted-foreground">
								{t('app.scheduling.exceptions_description')}
							</p>
						</div>
						<Cluster gap="sm">
							{#if loading}
								<p class="text-sm text-muted-foreground">
									{t('app.scheduling.loading_month', { month })}
								</p>
							{:else if progress.exceptions.length === 0}
								<p class="text-sm text-muted-foreground">
									{t('app.scheduling.exceptions_none', { month })}
								</p>
							{:else}
								{#each progress.exceptions as exception (exception.status)}
									<Button
										variant={exceptionFilter === exception.status ? 'default' : 'outline'}
										size="sm"
										aria-pressed={exceptionFilter === exception.status}
										onclick={() => drillInto(exception.status)}
									>
										{exceptionCopy(exception.status, exception.count.toLocaleString())}
										<IconWrapper name="lucide:arrow-right" class="size-3" />
									</Button>
								{/each}
							{/if}
						</Cluster>
					</Stack>
					<Display
						spec={attendanceChart}
						class="min-h-[18rem] rounded-lg border bg-card p-4 shadow-card"
					/>
				</Grid>
			{/if}
		</Scroll>
	</Bound>
{/snippet}

{#snippet shifts()}
	{#if companiesQuery.loading}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.loading_companies')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_shifts')}</p>
	{:else}
		{#snippet shiftIntro()}
			<p class="text-sm text-muted-foreground">{t('app.scheduling.shift_intro')}</p>
		{/snippet}
		<Cover gap="md" top={shiftIntro}>
			{#key `${selectedCompanyId}:${month}`}
				<CollectionTable
					{client}
					collection="shift_definitions"
					view={`hr_controller:scheduling:shifts:${selectedCompanyId}`}
					query={{
						where: { company_id: { eq: selectedCompanyId }, ...activeRange },
						orderBy: { code: 'asc' }
					}}
					class="h-full min-h-0"
				>
					{#snippet columns({ Column })}
						<Column name="code" card="title" />
						<Column name="name" card="subtitle" />
						<Column name="variant" label={t('app.scheduling.roster_code_definition')} />
						<Column name="effective_range" label={t('component.effective')} />
					{/snippet}
				</CollectionTable>
			{/key}
		</Cover>
	{/if}
{/snippet}

{#snippet holidays()}
	{#if companiesQuery.loading}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.loading_companies')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_holidays')}</p>
	{:else}
		{#key `${selectedCompanyId}:${month}`}
			<CollectionTable
				{client}
				collection="company_holidays"
				view={`hr_controller:scheduling:holidays:${selectedCompanyId}`}
				query={{
					where: { company_id: { eq: selectedCompanyId } },
					orderBy: { date: 'desc' }
				}}
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
		{/key}
	{/if}
{/snippet}

<AppHeaderActions>
	{@render companyScopeActions()}
</AppHeaderActions>

<!--
	The day sheet, which replaced the single-select assignment dialog.

	The app owns the writes and the checks; the drawer owns the editors and the explanation. That
	split is what lets Employee Self-Service render the very same component with `mode="employee"`
	over its own single-person month without inheriting a controller's write path.
-->
<DaySheet
	bind:open={daySheetOpen}
	mode="controller"
	person={daySheetPerson}
	date={daySheetDate}
	day={daySheetDay}
	intervals={daySheetIntervals}
	rosterCodeOptions={daySheetCodeOptions}
	rosterCodeId={daySheetDraftCodeId}
	note={daySheetNote}
	hasExplicitEntry={daySheetHasExplicitEntry}
	planLocked={daySheetPlanLocked}
	planLockedReason={daySheetPlanLockedReason}
	lockRung={daySheetRung}
	lockReason={daySheetLockReason}
	overlapWarning={daySheetOverlapWarning}
	canSwap={swapEnabled}
	saving={daySheetSaving || swapping}
	error={daySheetError}
	onPlanDraftChange={(codeId) => (daySheetDraftCodeId = codeId)}
	onSave={(change) => saveDaySheet(change)}
	onClearPlan={() => clearDaySheetPlan()}
	onStartSwap={() => {
		// Arming, not swapping. The board is the surface that knows which second cell is legal, so
		// the drawer hands the gesture back and steps out of the way.
		if (daySheetEmploymentId == null || daySheetDate == null) return;
		swapSource = { employmentId: daySheetEmploymentId, date: daySheetDate };
		daySheetOpen = false;
	}}
/>

<Cover>
	<Tabs
		animate={false}
		bind:value={activeTab}
		config={[
			{
				name: 'board',
				label: t('app.scheduling.tab_board'),
				icon: 'lucide:calendar-range',
				content: board
			},
			{
				name: 'exceptions',
				label: t('app.scheduling.tab_exceptions'),
				icon: 'lucide:chart-no-axes-combined',
				content: exceptions
			},
			{
				name: 'shifts',
				label: t('app.scheduling.tab_shifts'),
				icon: 'lucide:clock-4',
				content: shifts
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
