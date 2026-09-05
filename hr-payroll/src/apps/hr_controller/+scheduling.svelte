<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { Effect, Number as EffectNumber } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { CollectionQueryState } from '@norbital-ai/ui/collection-query';
	import { CollectionActionToolbar } from '@norbital-ai/ui/collection-toolbar';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companyById,
		companiesUnknown as companiesUnknownOf,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { Badge } from '@norbital-ai/ui/badge';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { Cluster, Cover, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { formatHolidayScope } from '../../lib/ui/display-formatters.js';
	import { runWorkbookImport } from '../../lib/ui/workbook-import.js';
	import {
		attendanceImportPayload,
		rosterImportPayload
	} from '../../collections/work_days/lib/import-workbook.js';
	import {
		monthKey,
		monthWorkDateInstantBounds,
		shiftDayKey,
		shiftMonthKey,
		todayKey,
		todayInstant
	} from '../../lib/ui/calendar.js';
	import { getErrorMessage } from '@norbital-ai/std';
	import { formatDateISO } from '@norbital-ai/std/date';
	import { decodeNumber } from '@norbital-ai/std/json';
	import MonthPeriodPicker from '../../lib/ui/month-period-picker.svelte';
	import RosterMonthBoard, { type BoardCell } from '../../lib/ui/roster/roster-month-board.svelte';
	import DaySheet from '../../lib/ui/roster/day-sheet.svelte';
	import {
		STATUS_PRESENTATION,
		buildRosterMonth,
		employmentMonthEmptyReason,
		employmentOverlapsMonth,
		holidayNamesByDate,
		indexWorkDaysByPersonDay,
		lockRung,
		lockRungFreezes,
		intervalDrafts,
		lockRungSourceLock,
		monthDays,
		monthProgress,
		personDayKey,
		type DayFacts,
		type IntervalDraft,
		type MonthDrafting
	} from '../../lib/ui/roster/roster-month.js';
	import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
	import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
	import { unresolvedClockOutEmploymentIds as openClockOutEmploymentIds } from '../../lib/ui/roster/roster-month-board-filter.js';
	import {
		MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS,
		MONTH_BOARD_QUERY_LIMITS,
		MONTH_BOARD_WORK_DAY_COLUMNS,
		monthBoardQueryReceipt
	} from '../../lib/ui/roster/month-board-query.js';
	import {
		payrollWindows,
		lockMap,
		sourceLockReason,
		type SettlementClaim
	} from '../../lib/scheduling/lock.js';
	import {
		overlappingWorkShifts,
		type ValidationDay
	} from '../../lib/scheduling/workforce-validation.js';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const selectedCompany = $derived(companyById(selectedCompanyId));
	let month = $state<string>(monthKey(todayKey()));
	/**
	 * The day sheet's subject. Nothing else: the drawer owns its editors and its write, and the
	 * app holds only which cell is open.
	 */
	const daySheet = $state({
		open: false,
		employmentId: null as string | null,
		date: null as string | null
	});
	/**
	 * The armed end of a swap, and whether one is in flight.
	 *
	 * The source is bound to the board, so a drag and the drawer's button set one thing; the flag
	 * guards the two writes of the pair.
	 */
	const swap = $state({ source: null as BoardCell | null });
	/** Local-only eye filter: it narrows the already-loaded month facts and never issues a query. */
	let unresolvedClockOutsOnly = $state(false);
	/**
	 * Search and filter state in the same model every collection surface uses.
	 *
	 * The board used to keep its own search string and private page cursor, and every handler that
	 * narrowed the set had to remember to reset a private page cursor. The board is already a bounded
	 * two-axis scrollport, so paginating its people axis only hid colleagues behind a second, unrelated
	 * navigation model.
	 */
	const boardQuery = new CollectionQueryState();

	const today = todayKey();
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;
	const approved = { approval_id: { isNull: true } } as const;
	const companiesUnknown = $derived(companiesUnknownOf());

	/** The month's calendar bounds, which every dated query below is narrowed to. */
	const monthStart = $derived(`${month}-01`);
	const monthEnd = $derived(
		formatDateISO(new Date(Date.parse(`${shiftMonthKey(month, 1)}-01T00:00:00.000Z`) - 86_400_000))
	);
	/** Day-precision instants: a calendar `gte` on UTC midnight misses the first local work date. */
	const monthWorkDateBounds = $derived(monthWorkDateInstantBounds(month));
	const monthDateKeys = $derived(monthDays(month));

	/**
	 * Every payroll run the company has, not just this month's: the board's lock stripes come from
	 * whichever run's window covers each day, and a paid window is drawn and enforced everywhere.
	 * The current-period cutoff is projected from this same bounded read rather than issuing a
	 * duplicate `findFirst` for the selected month.
	 */
	const payrollRunsQuery = $derived.by(() => {
		if (selectedCompanyId == null) return null;
		return client.db.payroll_runs.findMany({
			where: { ...approved, company_id: { eq: selectedCompanyId } },
			columns: {
				id: true,
				period: true,
				lifecycle: true,
				attendance_from: true,
				attendance_to: true
			},
			limit: MONTH_BOARD_QUERY_LIMITS.payrollRuns
		});
	});
	const payrollRunWindows = $derived(payrollWindows(payrollRunsQuery?.current ?? []));
	const monthLocks = $derived(lockMap(payrollRunWindows, monthDateKeys));

	/**
	 * The attendance window the next run will settle.
	 *
	 * Read from the payroll run when one exists, because that is the window the engine actually used.
	 * Only when no run has been opened yet is it derived from the company's cut-off day, which is the
	 * same rule stated in `docs/architecture.md`.
	 */
	const cutoff = $derived.by(() => {
		const run = (payrollRunsQuery?.current ?? []).find((candidate) => candidate.period === month);
		if (run?.attendance_from != null && run.attendance_to != null) {
			return { start: formatDateISO(run.attendance_from), end: formatDateISO(run.attendance_to) };
		}
		const cutoffDay = selectedCompany?.pay_cutoff_day;
		if (cutoffDay == null) return null;
		const day = String(
			EffectNumber.clamp({ minimum: 1, maximum: 28 })(decodeNumber(cutoffDay))
		).padStart(2, '0');
		return {
			start: `${shiftMonthKey(month, -1)}-${day}`,
			end: formatDateISO(new Date(Date.parse(`${month}-${day}T00:00:00.000Z`) - 86_400_000))
		};
	});

	const employmentsQuery = $derived.by(() => {
		if (selectedCompanyId == null) return null;
		return client.db.employments.findMany({
			where: { ...approved, company_id: { eq: selectedCompanyId } },
			orderBy: { employee_number: 'asc' },
			limit: MONTH_BOARD_QUERY_LIMITS.employments
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
	const monthEmploymentIds = $derived(monthEmployments.map((employment) => employment.id));
	const monthEmployeeIds = $derived(monthEmployments.map((employment) => employment.employee_id));
	const employeesQuery = $derived(
		monthEmployeeIds.length === 0
			? null
			: client.db.employees.findMany({
					where: { ...approved, id: { in: monthEmployeeIds } },
					columns: { id: true, name: true },
					limit: MONTH_BOARD_QUERY_LIMITS.employees
				})
	);
	const employeeNamesById = $derived(
		new Map((employeesQuery?.current ?? []).map((employee) => [employee.id, employee.name]))
	);
	const emptyEmploymentReason = $derived(employmentMonthEmptyReason(employments, month));
	const people = $derived(
		monthEmployments.map((employment) => ({
			id: employment.id,
			number: employment.employee_number,
			name: employeeNamesById.get(employment.employee_id) ?? '—'
		}))
	);

	const shiftsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.shift_definitions.findMany({
					where: { ...approved, company_id: { eq: selectedCompanyId } },
					limit: MONTH_BOARD_QUERY_LIMITS.rosterCodes
				})
	);
	const rosterCodesById = $derived(
		new Map((shiftsQuery?.current ?? []).map((code) => [code.id, code]))
	);
	const employmentTermsQuery = $derived.by(() => {
		if (!employmentsReady || monthEmploymentIds.length === 0) return null;
		return client.db.employment_terms.findMany({
			where: { ...approved, employment_id: { in: monthEmploymentIds } },
			columns: { id: true, employment_id: true, work_pattern: true, effective_range: true },
			limit: MONTH_BOARD_QUERY_LIMITS.employmentTerms
		});
	});
	const employmentTerms = $derived(employmentTermsQuery?.current ?? []);
	const employmentTermsByEmploymentId = $derived.by(() => {
		const grouped: Record<string, Array<(typeof employmentTerms)[number]>> = {};
		for (const term of employmentTerms) {
			(grouped[term.employment_id] ??= []).push(term);
		}
		return new Map(Object.entries(grouped));
	});

	const leavePlansQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.leave_plans.findMany({
					where: {
						...approved,
						company_id: { eq: selectedCompanyId },
						lifecycle: { eq: 'ACTIVE' },
						effective_range: { contains_date: todayInstant() }
					},
					columns: { id: true },
					limit: 20
				})
	);
	const activeLeavePlanIds = $derived((leavePlansQuery?.current ?? []).map((plan) => plan.id));
	const leaveTypesQuery = $derived(
		activeLeavePlanIds.length === 0
			? null
			: client.db.leave_types.findMany({
					where: { ...approved, leave_plan_id: { in: activeLeavePlanIds } },
					limit: MONTH_BOARD_QUERY_LIMITS.leaveTypes
				})
	);
	const leaveCodeById = $derived(
		new Map((leaveTypesQuery?.current ?? []).map((type) => [type.id, type.code]))
	);

	/**
	 * The month's person-days: ONE query where there were two.
	 *
	 * The board used to read the roster's own relationship for the plan and a month-scoped
	 * attendance query for the clock, then put the two together per cell. They are one row now, so
	 * the read is one query scoped the way the board is scoped — this month, these employments —
	 * and the plan and the clock arrive together or not at all.
	 *
	 * The roster-relationship machinery that stood here is gone with it: a count query, a page-size
	 * derived from that count, a completeness gate and a whole-row round-trip. Every plan write
	 * below is a write to its own row.
	 */
	const workDaysQuery = $derived.by(() => {
		if (!employmentsReady || monthEmploymentIds.length === 0) return null;
		return client.db.work_days.findMany({
			where: {
				...approved,
				work_date: { gte: monthWorkDateBounds.start, lte: monthWorkDateBounds.end },
				employment_id: { in: monthEmploymentIds }
			},
			// `id`, `row_version`, and `break_minutes` are needed by the same surface: the day
			// sheet updates *this* row (mutate needs the whole-row base version in client
			// state), and it cannot assess the unpaid break without knowing what it is.
			columns: MONTH_BOARD_WORK_DAY_COLUMNS,
			limit: MONTH_BOARD_QUERY_LIMITS.workDays
		});
	});
	const workDays = $derived(workDaysQuery?.current ?? []);
	const workDayIndexes = $derived.by(() => {
		const ids: string[] = [];
		for (const day of workDays) ids.push(day.id);
		return { ids, byPersonDay: indexWorkDaysByPersonDay(workDays) };
	});
	const workDayIds = $derived(workDayIndexes.ids);
	const workDayByKey = $derived(workDayIndexes.byPersonDay);
	const workDaysError = $derived(workDaysQuery?.error ?? null);
	const matrixMutationReady = $derived(
		workDaysQuery?.current !== undefined && workDaysError == null
	);

	/**
	 * The shared schema filter builder targets real `work_days` fields. Keep this second query
	 * separate from the board data: it decides which people remain visible without erasing the other
	 * days from their month.
	 */
	const filteredWorkDaysQuery = $derived.by(() => {
		if (monthEmploymentIds.length === 0 || boardQuery.filters.length === 0) return null;
		return client.db.work_days.findMany(
			{
				where: {
					work_date: { gte: monthWorkDateBounds.start, lte: monthWorkDateBounds.end },
					employment_id: { in: monthEmploymentIds }
				},
				columns: MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS,
				limit: MONTH_BOARD_QUERY_LIMITS.filteredWorkDays
			},
			boardQuery.queryOptions
		);
	});
	/**
	 * All leave states needed by the board, in one month-scoped read.
	 *
	 * Approved and pending requests differ only by `approval_id`; issuing two otherwise identical
	 * relationship-filtered queries made the board pay for the same company/employment join twice.
	 * The board already knows the exact employments it can render, so query those ids directly and
	 * split the narrow result locally. Requests are stored once at `from_date`, so the window remains
	 * widened to catch one spanning into the month.
	 */
	const leaveQuery = $derived.by(() => {
		if (!employmentsReady || monthEmploymentIds.length === 0) return null;
		return client.db.leave_requests.findMany({
			where: {
				employment_id: { in: monthEmploymentIds },
				kind: { eq: 'TIME_OFF' },
				from_date: { lte: monthEnd },
				to_date: { gte: monthStart }
			},
			columns: {
				id: true,
				approval_id: true,
				employment_id: true,
				leave_type_id: true,
				kind: true,
				from_date: true,
				to_date: true,
				half_day_start: true,
				half_day_end: true
			},
			limit: MONTH_BOARD_QUERY_LIMITS.leaveRequests
		});
	});
	/**
	 * Pending leave is drawn on the board as uncommitted coverage: it never reads as a taken day,
	 * but it warns an operator who plans work into it. The roster hook allows the assignment; the
	 * conflict flag makes the approval a decision rather than a silent double-book.
	 */
	const leaveRequests = $derived(leaveQuery?.current ?? []);
	const leavePartitions = $derived.by(() => {
		const approvedRequests: (typeof leaveRequests)[number][] = [];
		const pendingRequests: (typeof leaveRequests)[number][] = [];
		for (const request of leaveRequests) {
			if (request.approval_id == null) approvedRequests.push(request);
			else pendingRequests.push(request);
		}
		return { approvedRequests, pendingRequests };
	});
	const approvedLeaveRequests = $derived(leavePartitions.approvedRequests);
	const pendingLeaveRequests = $derived(leavePartitions.pendingRequests);
	/**
	 * The settlement claims held over this month's attendance, which is the third rung of the ladder.
	 *
	 * The board could already say "this day is inside a paid period" — arithmetic over
	 * `payroll_runs` windows. It could not say "a run has taken THIS record", which is the fact the
	 * owner actually asked to see and the only one that is stored. `payslip_adjustments` answers it,
	 * and `+hr_controller.ts` already grants the read: `settlementLedgerGrants` exists so that
	 * a refusal can be an explanation rather than an access denial. A run that read a day and priced
	 * it at nothing wrote a row here with amount 0, and that row is still the claim.
	 *
	 * Scoped by the person-day ids the month's own query returned, so it is at most one row per
	 * person-day and never a scan of every claim the company has ever taken.
	 */
	const settlementsQuery = $derived.by(() => {
		if (selectedCompanyId == null || workDayIds.length === 0) return null;
		return client.db.payslip_work_day_inputs.findMany({
			where: { ...approved, work_day_id: { in: workDayIds } },
			columns: { id: true, work_day_id: true, period: true },
			limit: MONTH_BOARD_QUERY_LIMITS.settlementClaims
		});
	});
	const settlementClaims = $derived(
		new Map<string, SettlementClaim>(
			(settlementsQuery?.current ?? []).map((capture) => [
				capture.work_day_id,
				{ period: capture.period }
			])
		)
	);

	const holidaysQuery = $derived.by(() => {
		if (selectedCompanyId == null) return null;
		return client.db.company_holidays.findMany({
			where: {
				...approved,
				company_id: { eq: selectedCompanyId },
				date: { gte: monthStart, lte: monthEnd }
			},
			columns: { id: true, date: true, name: true },
			limit: MONTH_BOARD_QUERY_LIMITS.holidays
		});
	});

	/**
	 * The bounded query graph the board is assembled from, named so a failure can say which one failed.
	 *
	 * They are listed rather than OR-ed inline because "still loading" is not the only answer this
	 * board needs to be able to give. A gate that only knows `loading` has no terminal state: a query
	 * that errors — or that is aborted and never retried — leaves every flag exactly as it was, and
	 * the board sits on `Loading …` forever with nothing on screen saying why. That is indistinguishable
	 * from a slow month, so nobody reloads, and the surface looks hung rather than broken.
	 */
	const boardSources = $derived([
		{ label: 'person-days', query: workDaysQuery },
		{ label: 'filtered person-days', query: filteredWorkDaysQuery },
		{ label: 'leave', query: leaveQuery },
		{ label: 'holidays', query: holidaysQuery },
		{ label: 'employments', query: employmentsQuery },
		{ label: 'employees', query: employeesQuery },
		{ label: 'employment schedules', query: employmentTermsQuery },
		{ label: 'roster codes', query: shiftsQuery },
		{ label: 'leave plans', query: leavePlansQuery },
		{ label: 'leave types', query: leaveTypesQuery },
		{ label: 'payroll runs', query: payrollRunsQuery },
		{ label: 'settlement claims', query: settlementsQuery }
	]);
	const boardErrors = $derived(
		boardSources.flatMap((source) =>
			source.query?.error ? [`${source.label}: ${source.query.error.message}`] : []
		)
	);
	/**
	 * The matrix paints when its identity is known: employments and the month's person-days.
	 * Overlay reads (names, leave, holidays, locks) fill in without holding every cell as a
	 * skeleton — a flapping name query used to hide 2,000 openable days behind 16 grey rows.
	 */
	const matrixReady = $derived(
		employmentsReady &&
			(monthEmploymentIds.length === 0 ||
				(workDaysQuery != null && workDaysQuery.current !== undefined))
	);
	const loading = $derived(boardErrors.length === 0 && (selectedCompanyId == null || !matrixReady));

	/** Overlaid onto the board from the company calendar; never a mark stored on a roster entry. */
	const companyHolidays = $derived(holidaysQuery?.current ?? []);
	const holidayNames = $derived(holidayNamesByDate(companyHolidays));

	const facts = $derived(
		buildRosterMonth({
			month,
			employments: monthEmployments,
			employmentTerms,
			workDays,
			leaveRequests: approvedLeaveRequests,
			pendingLeaveRequests,
			holidays: companyHolidays,
			rosterCodesById,
			leaveCodeById,
			cutoff,
			locks: monthLocks,
			today
		})
	);
	const boardLoadReceipt = $derived(
		monthBoardQueryReceipt({
			companySelected: selectedCompanyId != null,
			employmentsLoaded: employmentsReady,
			activeEmploymentCount: monthEmploymentIds.length,
			workDayCount: workDays.length,
			daysInMonth: monthDateKeys.length,
			schemaFilterActive: boardQuery.filters.length > 0,
			unresolvedClockOutsOnly,
			loadedRows: {
				employments: employments.length,
				employees: employeesQuery?.current?.length ?? 0,
				rosterCodes: shiftsQuery?.current?.length ?? 0,
				employmentTerms: employmentTerms.length,
				leaveTypes: leaveTypesQuery?.current?.length ?? 0,
				workDays: workDays.length,
				leaveRequests: leaveRequests.length,
				payrollRuns: payrollRunsQuery?.current?.length ?? 0,
				settlementClaims: settlementsQuery?.current?.length ?? 0,
				holidays: companyHolidays.length,
				filteredWorkDays: filteredWorkDaysQuery?.current?.length ?? 0
			}
		})
	);

	const filteredEmploymentIds = $derived(
		new Set((filteredWorkDaysQuery?.current ?? []).map((day) => day.employment_id))
	);
	/**
	 * The people the unresolved-clock-out eye filter leaves on the board.
	 *
	 * This is the argument for deleting the raw attendance table rather than moving it. A list of
	 * exceptions beside a board of person-days is two places to read the same month, and the table
	 * half has no idea what a rest day is. Narrowing the board *is* the list — the person-days that
	 * are wrong stay on screen with the plan and the lock still drawn beside them, which is what an
	 * operator needs in order to fix one.
	 *
	 * The month and the search survive it, because they describe a different question. No query is
	 * created for this filter; it is derived from the same `facts` map the cells render.
	 */
	const unresolvedClockOutEmploymentIds = $derived.by(() => {
		if (!unresolvedClockOutsOnly) return null;
		return openClockOutEmploymentIds(facts.values());
	});
	const boardPeople = $derived(
		people.filter((person) => {
			const term = boardQuery.search.toLowerCase();
			if (term !== '' && !`${person.number} ${person.name}`.toLowerCase().includes(term)) {
				return false;
			}
			if (
				unresolvedClockOutEmploymentIds != null &&
				!unresolvedClockOutEmploymentIds.has(person.id)
			)
				return false;
			return (
				boardQuery.filters.length === 0 ||
				filteredWorkDaysQuery?.current === undefined ||
				filteredEmploymentIds.has(person.id)
			);
		})
	);
	/**
	 * How far the month has got. There is no draft state and no publication: a roster row is an
	 * override of the work pattern, the board projects patterned days straight from the pattern,
	 * and an unrostered day counts as work still to assign. Consumed and paid days stay read-only
	 * through the payroll lock, which is the real freeze.
	 *
	 * TODO(RFC hr-payroll-leave-and-attendance): acceptance row H1 names "Open {month} for
	 * planning" and the draft/published ceremony retired here; it needs the owner's amendment.
	 */
	const drafting = $derived<MonthDrafting>('PUBLISHED');
	const progress = $derived(monthProgress(facts, drafting));
	const boardHelp = $derived(t('app.scheduling.help_published'));

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
	function importRoster() {
		// No draft roster to land in: an assignment belongs to the company and the day, and the
		// file states both on its Settings sheet. The pipeline refuses a file that does not.
		return runWorkbookImport(
			{
				collectionName: 'work_days',
				recordLabel: t('component.roster_rows'),
				buildPayload: (grids) => rosterImportPayload(grids)
			},
			t
		);
	}

	function selectMonth(nextMonth: string): void {
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth)) return;
		month = nextMonth;
		boardQuery.setPageIndex(0);
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * SCHEDULE FACTS THE SWAP AND THE OVERLAP CHECK BOTH NEED
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	function claimFor(day: { readonly workDayId: string | null }): SettlementClaim | null {
		return day.workDayId == null ? null : (settlementClaims.get(day.workDayId) ?? null);
	}

	function termCovers(
		term: {
			readonly effective_range: {
				start?: string;
				end?: string | null;
			} | null;
		},
		date: string
	): boolean {
		if (term.effective_range?.start == null) return false;
		const start = formatDateISO(term.effective_range.start);
		const end = term.effective_range.end == null ? null : formatDateISO(term.effective_range.end);
		return date >= start && (end == null || date <= end);
	}

	function activeTermFor(employmentId: string, date: string) {
		return (
			(employmentTermsByEmploymentId.get(employmentId) ?? []).find((term) =>
				termCovers(term, date)
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
		// A row exists as soon as EITHER half of the day does, so "is this day assigned" is a
		// question about `shift_definition_id` and not about the row being there.
		const explicit = workDayByKey.get(personDayKey(employmentId, date))?.shift_definition_id;
		if (explicit != null) return explicit;
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
			const day = facts.get(personDayKey(employmentId, neighbour));
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

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * THE DAY SHEET
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	function openDaySheet(employmentId: string, date: string): void {
		daySheet.employmentId = employmentId;
		daySheet.date = date;
		daySheet.open = true;
	}

	const daySheetKey = $derived(
		daySheet.employmentId == null || daySheet.date == null
			? null
			: personDayKey(daySheet.employmentId, daySheet.date)
	);
	const daySheetDay = $derived(daySheetKey == null ? undefined : facts.get(daySheetKey));
	const daySheetPerson = $derived(
		people.find((person) => person.id === daySheet.employmentId) ?? null
	);
	/** The code the day carries when the drawer opens; the drawer seeds its picker from it. */
	const daySheetRosterCodeId = $derived(
		daySheet.employmentId == null || daySheet.date == null
			? null
			: effectiveCodeId(daySheet.employmentId, daySheet.date)
	);
	const daySheetEntry = $derived(
		daySheetKey == null ? null : (workDayByKey.get(daySheetKey) ?? null)
	);
	/**
	 * The punches the drawer edits.
	 *
	 * Read off the month's own attendance query rather than re-fetched, so the sheet and the cell
	 * behind it can never be a write apart. `DayFacts` carries totals, not intervals — a grid needs
	 * a glyph — so this is the one place the list itself is needed.
	 */
	const daySheetIntervals = $derived<readonly IntervalDraft[]>(
		intervalDrafts(daySheetEntry?.worked_intervals)
	);
	/**
	 * Whether this day carries an explicit plan.
	 *
	 * A row may exist purely because somebody punched on it, and a row with no
	 * `shift_definition_id` is a day with no assignment to clear.
	 */
	const daySheetHasExplicitEntry = $derived.by(() => {
		if (daySheetKey == null) return false;
		const stored = workDayByKey.get(daySheetKey);
		return stored?.shift_definition_id != null;
	});
	const daySheetNote = $derived(
		daySheetKey == null ? null : (workDayByKey.get(daySheetKey)?.planned_note ?? null)
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
	 * The plan half is editable on any day the payroll lock does not hold. There is no draft month
	 * and no publication freeze: a plan write must leave the month's WORK-day count and paid
	 * minutes equal to what the work pattern projects, and `work_days/+hooks.ts` refuses one that
	 * does not. Consumed and paid days stay read-only through the payroll lock.
	 */
	const daySheetPlanLocked = $derived(!matrixMutationReady);
	const daySheetPlanLockedReason = $derived(
		workDaysError?.message ?? (workDaysQuery?.current === undefined ? t('component.loading') : null)
	);

	/** Roster codes effective on the day the drawer is open on. */
	const daySheetCodeOptions = $derived.by(() => {
		const date = daySheet.date;
		return (shiftsQuery?.current ?? [])
			.filter((code) => {
				const start =
					code.effective_range?.start == null ? null : formatDateISO(code.effective_range.start);
				const end =
					code.effective_range?.end == null ? null : formatDateISO(code.effective_range.end);
				return date != null && start != null && date >= start && (end == null || date <= end);
			})
			.map((code) => {
				const window = rosterCodeKind(code.variant) === 'WORK' ? workWindow(code.variant) : null;
				return {
					value: code.id,
					label:
						window == null
							? `${code.code} · ${rosterCodeKind(code.variant)}`
							: `${code.code} · ${window.start_time}–${window.end_time}`,
					search_term: `${code.code} ${code.name} ${window?.start_time ?? ''} ${window?.end_time ?? ''}`
				};
			});
	});

	/**
	 * The overlap a chosen code would create, over the ±1-day window.
	 *
	 * Handed to the drawer as `resolveOverlap`: the drawer owns its draft and asks this question
	 * whenever its choice changes. The whole month lives here, so the judge lives here too —
	 * `overlappingWorkShifts` over the day before, the day itself and the day after.
	 */
	function overlapSentenceFor(
		employmentId: string,
		date: string,
		codeId: string | null
	): string | null {
		if (codeId == null) return null;
		const selected = validationDay(employmentId, date, codeId);
		const overlap = overlappingWorkShifts([
			...adjacentValidationDays(employmentId, date),
			selected
		])[0];
		return overlap == null
			? null
			: t('roster.overlapping_shift_description', {
					first: overlap.first.shift?.code ?? 'WORK',
					second: overlap.second.shift?.code ?? 'WORK'
				});
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * THE SWAP — two cells, one mutation, and the server is the judge
	 *
	 * The board checks exactly one thing before arming a swap: the payroll lock, because a frozen
	 * day is a fact the board has already drawn and the gesture should not exist there. Everything
	 * else — leave ownership, shift overlap, the month's pattern conformance — is the write hook's
	 * to refuse. Running those checks here too was a second copy of the server's judgement that
	 * could drift from it; the server's refusal names its cause in the failure toast, and the
	 * single two-row mutation is what lets the server see the pair whole.
	 *
	 * SCOPED OUT: consumed days. A day a payroll run has taken into account is frozen by the
	 * settlement lock, and the gesture is simply not offered there.
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	/** The one sentence the board itself can say: which run holds the day. */
	function swapRefusal(from: BoardCell, to: BoardCell): string | null {
		for (const cell of [from, to]) {
			const day = facts.get(personDayKey(cell.employmentId, cell.date));
			if (day == null) return t('roster.swap_refused_unknown');
			if (!lockRungFreezes(lockRung(day, claimFor(day)))) continue;
			const lock = lockRungSourceLock(day, claimFor(day));
			return (
				sourceLockReason(lock ?? { kind: 'NONE' }, t) ??
				t('roster.swap_refused_locked', { date: day.date })
			);
		}
		return null;
	}

	const swapEnabled = $derived(matrixMutationReady);

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
	 *
	 * Both imports name the same collection, because both sheets describe the same person-day. The
	 * pipeline dispatches on the payload's own `sheet` tag, and a punch landing on a day the roster
	 * import already wrote is an update of that day rather than a refusal.
	 */
	function importAttendance() {
		return runWorkbookImport(
			{
				collectionName: 'work_days',
				recordLabel: t('component.work_days'),
				buildPayload: attendanceImportPayload
			},
			t
		);
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
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/scheduling-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/scheduling-banner.webp"
	/>
</svelte:head>

{#snippet companyScopeActions()}
	<CompanyScopeCombobox
		value={selectedCompanyId}
		onValueChange={(id) => {
			chosenCompanyId = id;
		}}
	/>
{/snippet}

{#snippet monthNavigation()}
	<MonthPeriodPicker {month} onMonthChange={selectMonth} />
{/snippet}

<!--
	The board's rows are people, while its filters are generated from the `work_days` schema. A
	matching person-day keeps its person on screen and the board still shows that person's complete
	month, so a filter narrows the roster without stripping away the calendar context.

	Import is an ordinary import pipeline, which is what lets it state its own refusal. A roster
	file states its legal entity and month on its Settings sheet; an attendance file states its
	timezone the same way.
-->
{#snippet boardToolbar()}
	<CollectionActionToolbar
		{client}
		collection="work_days"
		query={boardQuery}
		navigation={monthNavigation}
		operations={{
			importPipelines: [
				{
					id: 'roster-workbook',
					label: t('app.scheduling.import'),
					description: t('app.scheduling.import_title', { month }),
					icon: 'lucide:upload',
					run: importRoster
				},
				{
					// No `getDisabledReason`. Attendance belongs to the day, not to a roster, so a month
					// that was never drafted still takes its punches — see `importAttendance`.
					id: 'attendance-workbook',
					label: t('app.scheduling.import_attendance'),
					description: t('app.scheduling.import_attendance_description', { month }),
					icon: 'lucide:clock-arrow-up',
					run: importAttendance
				}
			]
		}}
	/>
{/snippet}

{#snippet monthStatus()}
	<Cluster gap="sm">
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
		{#if !loading}
			<!--
				The counters explain the marks already drawn in the board. The eye control is deliberately
				narrower: it filters only unresolved clock-outs from these loaded facts, without a query.
			-->
			{#each progress.exceptions as exception (exception.status)}
				<Badge variant="outline">
					{exceptionCopy(exception.status, exception.count.toLocaleString())}
				</Badge>
			{/each}
		{/if}
		<Button
			size="sm"
			variant={unresolvedClockOutsOnly ? 'default' : 'outline'}
			aria-pressed={unresolvedClockOutsOnly}
			onclick={() => (unresolvedClockOutsOnly = !unresolvedClockOutsOnly)}
		>
			<IconWrapper
				name={unresolvedClockOutsOnly ? 'lucide:eye-off' : 'lucide:eye'}
				class="size-3.5"
			/>
			{unresolvedClockOutsOnly
				? t('app.scheduling.show_all_people')
				: t('app.scheduling.show_unresolved_clock_outs')}
		</Button>
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
		<span
			hidden
			aria-hidden="true"
			data-month-board-query-count={boardLoadReceipt.queryCount}
			data-month-board-row-bound={boardLoadReceipt.rowBound}
			data-month-board-query-ceiling={boardLoadReceipt.normalQueryCeiling}
			data-month-board-row-ceiling={boardLoadReceipt.normalRowBound}
			data-month-board-interactive-query-ceiling={boardLoadReceipt.interactiveQueryCeiling}
			data-month-board-interactive-row-ceiling={boardLoadReceipt.interactiveRowBound}
			data-month-board-loaded-rows={boardLoadReceipt.loadedRowCount}
			data-month-board-matrix-cells={boardLoadReceipt.matrixCellCount}
			data-month-board-eye-filter-queries={boardLoadReceipt.eyeFilterAdditionalQueries}
		></span>
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
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.scheduling.empty_board')}</p>
	{:else}
		<Cover gap="md" top={boardChrome}>
			{#if boardErrors.length > 0}
				<!-- A terminal state, so a board that cannot be built says so instead of pretending to
				     still be loading. -->
				<Alert variant="destructive">
					<AlertTitle>{t('app.scheduling.board_load_failed', { month })}</AlertTitle>
					<AlertDescription>
						<Stack as="ul" gap="xs" class="list-disc pl-4">
							{#each boardErrors as boardError (boardError)}
								<li>{boardError}</li>
							{/each}
						</Stack>
					</AlertDescription>
				</Alert>
			{:else if !loading && people.length > 0 && boardPeople.length === 0}
				<p class="text-sm text-muted-foreground">
					{unresolvedClockOutsOnly
						? t('app.scheduling.no_unresolved_clock_outs', { month })
						: t('app.scheduling.no_matches')}
				</p>
			{:else if !loading && people.length === 0}
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
					{loading}
					{facts}
					{today}
					{holidayNames}
					locks={monthLocks}
					{settlementClaims}
					{cutoff}
					editable={matrixMutationReady}
					swappable={swapEnabled}
					bind:swapSource={swap.source}
					onSwapDays={(from, to) => {
						if (!swapEnabled) return;
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

						const note = t('roster.swap_note', { from: from.date, to: to.date });
						const fromExisting = workDayByKey.get(personDayKey(from.employmentId, from.date));
						const toExisting = workDayByKey.get(personDayKey(to.employmentId, to.date));
						Effect.runFork(
							submitCollectionMutation(() =>
								client.db.work_days.mutate([
									{
										...(fromExisting == null
											? { employment_id: from.employmentId, work_date: from.date }
											: { id: fromExisting.id }),
										shift_definition_id: toCodeId,
										planned_origin: 'MANUAL',
										planned_note: note
									},
									{
										...(toExisting == null
											? { employment_id: to.employmentId, work_date: to.date }
											: { id: toExisting.id }),
										shift_definition_id: fromCodeId,
										planned_origin: 'MANUAL',
										planned_note: note
									}
								])
							).pipe(
								Effect.tap((submission) =>
									Effect.sync(() => {
										swap.source = null;
										if (submission.kind === 'pendingApproval') {
											toast.success(t('roster.day_sheet_pending_approval'));
											return;
										}
										toast.success(t('roster.swap_done'));
									})
								),
								Effect.catch((cause) =>
									Effect.sync(() =>
										toast.error(t('roster.swap_failed_pair', { from: from.date, to: to.date }), {
											description: getErrorMessage(cause)
										})
									)
								)
							)
						);
					}}
					onSelectDay={openDaySheet}
				/>
			{/if}
		</Cover>
	{/if}
{/snippet}

{#snippet shifts()}
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
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
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
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
					<Column name="date" label={t('component.date')} card="title" />
					<Column name="name" card="subtitle" />
					<Column
						name="scope"
						label={t('component.scope')}
						renderer={FormattedValueRenderer}
						rendererProps={{ format: ({ value }) => formatHolidayScope(value, t) }}
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

 	The drawer owns its editors and its person-day write (an internal `CollectionForm`); the app
 	owns the checks around it — the live overlap sentence, the locks, the swap pair. That split is
 	what lets Employee Self-Service render the very same component with `mode="employee"` over its
 	own single-person month without inheriting a controller's checks.
 -->
<DaySheet
	bind:open={daySheet.open}
	mode="controller"
	person={daySheetPerson}
	date={daySheet.date}
	day={daySheetDay}
	intervals={daySheetIntervals}
	rosterCodeOptions={daySheetCodeOptions}
	rosterCodeId={daySheetRosterCodeId}
	note={daySheetNote}
	hasExplicitEntry={daySheetHasExplicitEntry}
	planLocked={daySheetPlanLocked}
	planLockedReason={daySheetPlanLockedReason}
	lockRung={daySheetRung}
	lockReason={daySheetLockReason}
	canSwap={swapEnabled}
	resolveOverlap={(codeId) =>
		daySheet.employmentId == null || daySheet.date == null
			? null
			: overlapSentenceFor(daySheet.employmentId, daySheet.date, codeId)}
	onStartSwap={() => {
		// Arming, not swapping. The board is the surface that knows which second cell is legal, so
		// the drawer hands the gesture back and steps out of the way.
		if (daySheet.employmentId == null || daySheet.date == null) return;
		swap.source = { employmentId: daySheet.employmentId, date: daySheet.date };
		daySheet.open = false;
	}}
/>

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
				name: 'holidays',
				label: t('app.scheduling.tab_holidays'),
				icon: 'lucide:party-popper',
				content: holidays
			}
		] satisfies TabConfig[]}
	/>
</Cover>
