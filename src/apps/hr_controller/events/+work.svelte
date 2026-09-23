<script lang="ts">
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../../lib/ui/create-scope.js';
	import { resolveEmployment } from '../../../lib/employment-contract.js';
	import { dateKey, dayInstant, isSettledId, PAYROLL_TIME_ZONE } from '../../../lib/iso-day.js';
	import { HOLIDAY_QUERY_LIMIT, holidayView } from '../../../lib/ui/holiday-calendar.js';
	import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
	import { client } from '../../../lib/workspace-client.js';
	import { Effect } from 'effect';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionQueryState } from '@norbital-ai/ui/collection-query';
	import { CollectionActionToolbar } from '@norbital-ai/ui/collection-toolbar';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import CompanyScopeCombobox from '../CompanyScopeCombobox.svelte';
	import {
		companyById,
		companiesUnknown as companiesUnknownOf,
		resolveCompanyId
	} from '../company-scope.svelte.js';
	import { onLineage } from '../../../lib/ui/settings-scope.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { Cluster, Cover, Scroll, Stack } from '@norbital-ai/ui/layout';
	import * as Sheet from '@norbital-ai/ui/sheet';
	import {
		createCollectionRouteKey,
		getCollectionNavigationContext
	} from '@norbital-ai/ui/collection-navigation';
	import {
		getCollectionSurfaceRuntime,
		resolveCollectionSurface
	} from '@norbital-ai/ui/collection-runtime';
	import { setDayDraftContext } from '../../../lib/ui/roster/day-draft.js';
	import { toast } from 'svelte-sonner';
	import { runWorkbookImport } from '../../../lib/ui/workbook-import.js';
	import {
		holidayWorkedRows,
		schedulingImportDays,
		schedulingImportPayload
	} from '../../../collections/work_days/lib/import-workbook.js';
	import { observedHolidayDates, overtimeEntitled } from '../../../lib/scheduling/work-limits.js';
	import {
		schedulingTemplateWorkbook,
		XLSX_MEDIA_TYPE
	} from '../../../collections/work_days/lib/import-template.js';
	import { saveBlob } from '../../../lib/ui/export-download.js';
	import {
		monthWorkDateInstantBounds,
		periodInCompanyGrammar,
		todayKey
	} from '../../../lib/ui/calendar.js';
	import {
		addDays,
		monthBounds,
		periodMonth
	} from '../../../collections/payroll_runs/lib/dates.js';
	import { getErrorMessage, toError } from '@norbital-ai/std';
	import { formatDateISO } from '@norbital-ai/std/date';
	import { decodeNumber } from '@norbital-ai/std/json';
	import MonthPeriodPicker from '../../../lib/ui/month-period-picker.svelte';
	import type { CollectionToolbarComposition } from '@norbital-ai/ui/collection-toolbar';
	import { resolveWindow } from '../../../collections/payroll_runs/lib/period.js';
	import RosterMonthBoard, {
		type BoardCell
	} from '../../../lib/ui/roster/roster-month-board.svelte';
	import {
		buildRosterMonth,
		employmentMonthEmptyReason,
		employmentOverlapsMonth,
		holidaysByDate,
		indexWorkDaysByPersonDay,
		lockRung,
		lockRungFreezes,
		lockRungSourceLock,
		monthDays,
		personDayKey,
		termCovers
	} from '../../../lib/ui/roster/roster-month.js';
	import {
		PATTERN_WITH,
		patternAnchor,
		patternRosterCodeId,
		termPatternRow
	} from '../../../lib/scheduling/work-pattern.js';
	import { unresolvedClockOutEmploymentIds as openClockOutEmploymentIds } from '../../../lib/ui/roster/roster-month-board-filter.js';
	import {
		MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS,
		MONTH_BOARD_QUERY_LIMITS,
		MONTH_BOARD_WORK_DAY_COLUMNS,
		monthBoardQueryReceipt
	} from '../../../lib/ui/roster/month-board-query.js';
	import {
		payrollWindows,
		lockMap,
		sourceLockReason,
		type SettlementClaim
	} from '../../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const selectedCompany = $derived(companyById(selectedCompanyId));
	// The fallback person-day form opened from this page narrows its people to this entity.
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => selectedCompany?.settings_code ?? undefined
	});
	let month = $state<string>(todayKey().slice(0, 7));
	/**
	 * The board's period, in the entity's own pay grammar: a whole month at a monthly company, one
	 * half at a semi-monthly one. Every day list, lock and run lookup below reads this, and the
	 * calendar month only scopes the queries that fetch a superset.
	 */
	const period = $derived(
		periodInCompanyGrammar(month, selectedCompany?.pay_frequency, todayKey())
	);
	const calendarMonth = $derived(periodMonth(period));
	/**
	 * The cell the operator is looking at, if it has no stored person-day yet.
	 *
	 * A cell with a row opens the standard record sidesheet for it; a cell without one is a create,
	 * and this is the identity the create sheet is handed. Nothing else about the sheet lives here —
	 * the representation owns its editors and its write, and the record sheet owns its own read.
	 */
	const dayCreate = $state({
		open: false,
		employmentId: null as string | null,
		date: null as string | null
	});
	setDayDraftContext({
		employmentId: () => dayCreate.employmentId,
		date: () => dayCreate.date
	});
	/**
	 * The armed end of a swap, and whether one is in flight.
	 *
	 * The source is bound to the board, so a drag and the keyboard arm one thing; the flag guards
	 * the two writes of the pair.
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
	const approved = { approval_id: { isNull: true } } as const;
	const companiesUnknown = $derived(companiesUnknownOf());

	/** The month's calendar bounds, which every dated query below is narrowed to. */
	const monthStart = $derived(`${calendarMonth}-01`);
	const monthEnd = $derived(monthBounds(calendarMonth).end);
	/** Day-precision instants, as stored: a bare calendar day is read at the replica's own zone. */
	const monthWorkDateBounds = $derived(monthWorkDateInstantBounds(calendarMonth));
	const monthDateKeys = $derived(monthDays(period));

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
				attendance_from: true,
				attendance_to: true
			},
			limit: MONTH_BOARD_QUERY_LIMITS.payrollRuns
		});
	});
	/**
	 * The payslips inside those runs, because the lock is the payslip's and not the run's.
	 *
	 * A run is the container; whether a person's January is closed is whether *their* January
	 * payslip has been paid. So the board's stripes are per person-day, and the map they read is
	 * keyed by both.
	 */
	const payrollPayslipsQuery = $derived.by(() => {
		const runIds = (payrollRunsQuery?.current ?? []).map((run) => run.id);
		if (runIds.length === 0) return null;
		return client.db.payslips.findMany({
			where: { payroll_run_id: { in: runIds } },
			columns: { payroll_run_id: true, employment_id: true, paid_at: true },
			limit: MONTH_BOARD_QUERY_LIMITS.payslips
		});
	});
	const payrollRunWindows = $derived(
		payrollWindows(payrollRunsQuery?.current ?? [], payrollPayslipsQuery?.current ?? [])
	);

	/**
	 * The attendance window the next run will settle.
	 *
	 * Read from the payroll run when one exists, because that is the window the engine actually used.
	 * Only when no run has been opened yet is it derived from the company's cut-off day, which is the
	 * same rule stated in `docs/architecture.md`.
	 */
	const cutoff = $derived.by(() => {
		const run = (payrollRunsQuery?.current ?? []).find((candidate) => candidate.period === period);
		if (run?.attendance_from != null && run.attendance_to != null) {
			return { start: formatDateISO(run.attendance_from), end: formatDateISO(run.attendance_to) };
		}
		if (selectedCompany?.pay_cutoff_day == null) return null;
		// The engine's own window for this period at this company: the cutoff window of a month, or
		// the half of a semi-monthly month.
		try {
			return resolveWindow(period, {
				pay_cutoff_day: decodeNumber(selectedCompany.pay_cutoff_day),
				pay_frequency: selectedCompany.pay_frequency
			}).attendance;
		} catch {
			return null;
		}
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
	const employments = $derived((employmentsQuery?.current ?? []).map(resolveEmployment));
	const monthEmployments = $derived(
		employments.filter((employment) => employmentOverlapsMonth(employment, period))
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
	const emptyEmploymentReason = $derived(employmentMonthEmptyReason(employments, period));
	const people = $derived(
		monthEmployments.map((employment) => ({
			id: employment.id,
			number: employment.employee_number,
			name: employeeNamesById.get(employment.employee_id) ?? '—'
		}))
	);

	const monthLocks = $derived(
		lockMap(
			payrollRunWindows,
			monthDateKeys,
			people.map((person) => person.id)
		)
	);

	const employmentTermsQuery = $derived.by(() => {
		if (!employmentsReady || monthEmploymentIds.length === 0) return null;
		return client.db.employment_terms.findMany({
			where: { ...approved, employment_id: { in: monthEmploymentIds } },
			columns: {
				id: true,
				employment_id: true,
				shift_pattern_id: true,
				effective_range: true,
				// The overtime rule's facts, for the import's holiday warning.
				employment_type: true,
				work_classification: true,
				base_salary: true,
				statutory_work_category: true,
				pay_frequency: true
			},
			// The base rides the terms read (HR20: one live query per source, no `shift_patterns`
			// query of its own): every term arrives with the named pattern it points at.
			with: { term_shift_pattern: PATTERN_WITH },
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

	// Every version of the entity's lineage: a request may cite the row an earlier version's
	// entitlement was sealed with, and the board only needs the code behind an id.
	const selectedSettingsCode = $derived(companyById(selectedCompanyId)?.settings_code ?? null);

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
	const leaveCatalogueQuery = $derived(
		selectedSettingsCode == null
			? null
			: client.db.leave_catalogue.findMany({
					where: {
						...approved,
						leave_catalogue_settings: { some: onLineage(selectedSettingsCode) }
					},
					columns: { id: true, code: true },
					limit: MONTH_BOARD_QUERY_LIMITS.catalogueLeaves
				})
	);
	const leaveCodeById = $derived(
		new Map((leaveCatalogueQuery?.current ?? []).map((type) => [type.id, type.code]))
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
			// `id` and `row_version` are needed by the same surface: the day sheet updates *this*
			// row, and mutate needs the whole-row base version in client state.
			columns: MONTH_BOARD_WORK_DAY_COLUMNS,
			limit: MONTH_BOARD_QUERY_LIMITS.workDays
		});
	});
	const workDays = $derived(workDaysQuery?.current ?? []);
	const workDayIndexes = $derived.by(() => {
		// A write still in flight is overlaid with a provisional id; only settled ids are asked about.
		const ids: string[] = [];
		for (const day of workDays) if (isSettledId(day.id)) ids.push(day.id);
		return { ids, byPersonDay: indexWorkDaysByPersonDay(workDays) };
	});
	const workDayIds = $derived(workDayIndexes.ids);
	const workDayByKey = $derived(workDayIndexes.byPersonDay);
	const matrixMutationReady = $derived(
		workDaysQuery?.current !== undefined && workDaysQuery?.error == null
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
		return client.db.leave_entries.findMany({
			where: {
				employment_id: { in: monthEmploymentIds },
				// Time off is the activity whose charges are its dated days.
				charges: { ne: [] },
				leave_original_reversals: { none: { approval_id: { isNull: true } } },
				from_date: { lte: monthWorkDateBounds.end },
				to_date: { gte: monthWorkDateBounds.start }
			},
			columns: {
				id: true,
				approval_id: true,
				employment_id: true,
				catalogue_id: true,
				from_date: true,
				to_date: true,
				half_day_start: true,
				half_day_end: true,
				charges: true
			},
			limit: MONTH_BOARD_QUERY_LIMITS.leaveRequests
		});
	});
	/**
	 * Pending leave is drawn on the board as uncommitted coverage: it never reads as a taken day,
	 * but it warns an operator who plans work into it. The roster transform allows the assignment; the
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
	 * owner actually asked to see and the only one that is stored. The day's own `payslip_id` answers it,
	 * and `+hr_controller.ts` already grants the read: `settlementLedgerGrants` exists so that
	 * a refusal can be an explanation rather than an access denial. A run that read a day and priced
	 * it at nothing wrote a row here with amount 0, and that row is still the claim.
	 *
	 * Scoped by the person-day ids the month's own query returned, so it is at most one row per
	 * person-day and never a scan of every claim the company has ever taken.
	 */
	const settlementsQuery = $derived.by(() => {
		if (selectedCompanyId == null || workDayIds.length === 0) return null;
		return client.db.work_days.findMany({
			where: { ...approved, id: { in: workDayIds }, payslip_id: { isNull: false } },
			columns: { id: true, payslip_id: true },
			limit: MONTH_BOARD_QUERY_LIMITS.settlementClaims
		});
	});
	const settlementClaims = $derived(
		new Map<string, SettlementClaim>(
			(settlementsQuery?.current ?? []).map((capture) => [capture.id, { period: '' }])
		)
	);

	const calendarSettingsQuery = $derived(
		selectedSettingsCode == null
			? null
			: client.db.jurisdiction_settings.findMany({
					where: onLineage(selectedSettingsCode),
					limit: HOLIDAY_QUERY_LIMIT
				})
	);
	// The calendar is the entity's. The settings lineage no longer decides which holidays a roster
	// month shows — it could not tell two entities of one country apart — so the scope is the entity
	// the page is already on.
	const holidaysQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.jurisdiction_holidays.findMany({
					where: {
						...approved,
						company_id: { eq: selectedCompanyId },
						// A month either side: payroll resolves each assessment window whole, and a
						// holiday before the month can carry into it (`observedHolidayDates`).
						date: {
							gte: dayInstant(addDays(monthStart, -31)),
							lte: dayInstant(addDays(monthEnd, 31))
						},
						published_at: { isNotNull: true }
					},
					limit: HOLIDAY_QUERY_LIMIT
				})
	);
	const calendarResolution = $derived(
		holidayView({
			settingsCount: calendarSettingsQuery?.current?.length,
			jurisdiction: selectedCompanyId,
			rows: holidaysQuery?.current,
			start: monthStart,
			end: monthEnd,
			noJurisdiction: t('holiday_calendar.no_jurisdiction'),
			truncated: t('holiday_calendar.truncated')
		})
	);

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
		{ label: 'holiday calendar settings', query: calendarSettingsQuery },
		{ label: 'holidays', query: holidaysQuery },
		{ label: 'employments', query: employmentsQuery },
		{ label: 'employees', query: employeesQuery },
		{ label: 'employment schedules', query: employmentTermsQuery },
		{ label: 'roster codes', query: shiftsQuery },
		{ label: 'leave catalogue entries', query: leaveCatalogueQuery },
		{ label: 'payroll runs', query: payrollRunsQuery },
		{ label: 'settlement claims', query: settlementsQuery }
	]);
	const boardErrors = $derived([
		...(calendarResolution.error == null ? [] : [calendarResolution.error]),
		...boardSources.flatMap((source) =>
			source.query?.error ? [`${source.label}: ${source.query.error.message}`] : []
		)
	]);
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

	/** Overlaid onto the board from the published jurisdiction calendar; never a mark stored on a roster entry. */
	const jurisdictionHolidays = $derived(calendarResolution.holidays);
	const holidayNames = $derived(holidaysByDate(jurisdictionHolidays));

	/** The entity's clock: the version in force's payroll timezone, else the payroll default. */
	const boardTimeZone = $derived.by(() => {
		if (selectedSettingsCode == null) return PAYROLL_TIME_ZONE;
		const versions = calendarSettingsQuery?.current ?? [];
		try {
			return (
				settingsInForce(versions, selectedSettingsCode, monthStart)?.payroll.timezone ??
				PAYROLL_TIME_ZONE
			);
		} catch {
			return PAYROLL_TIME_ZONE;
		}
	});
	const facts = $derived(
		buildRosterMonth({
			month: period,
			timeZone: boardTimeZone,
			employments: monthEmployments,
			employmentTerms,
			workDays,
			leaveRequests: approvedLeaveRequests,
			pendingLeaveRequests,
			holidays: jurisdictionHolidays,
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
				catalogueLeaves: leaveCatalogueQuery?.current?.length ?? 0,
				workDays: workDays.length,
				leaveRequests: leaveRequests.length,
				payrollRuns: payrollRunsQuery?.current?.length ?? 0,
				settlementClaims: settlementsQuery?.current?.length ?? 0,
				holidays: jurisdictionHolidays.length,
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
	const boardHelp = $derived(t('app.scheduling.help_published'));

	/**
	 * The import writes a company holiday worked by someone the overtime rule does not cover, and
	 * says so here: no overtime is paid for it, so HR grants an off-in-lieu day. Read on the board's
	 * own data and payroll's own calendar (`observedHolidayDates`); a run states it again.
	 */
	function warnHolidaysWithoutOvertime(payload: ReturnType<typeof schedulingImportPayload>): void {
		const company = selectedCompany;
		if (company == null || selectedCompanyId == null || selectedSettingsCode == null) return;
		const version = settingsInForce(
			calendarSettingsQuery?.current ?? [],
			selectedSettingsCode,
			monthStart
		);
		const byNumber = new Map(people.map((person) => [person.number, person]));
		const codeIdByCode = new Map((shiftsQuery?.current ?? []).map((code) => [code.code, code.id]));
		const termOn = (employmentId: string, date: string) =>
			(employmentTermsByEmploymentId.get(employmentId) ?? []).find((term) =>
				termCovers(term, date)
			) ?? null;
		const rows = holidayWorkedRows(
			payload,
			(number) => {
				const person = byNumber.get(number);
				if (person == null) return new Set();
				const filed = (payload.roster ?? []).filter((row) => row.employee_number === number);
				try {
					return observedHolidayDates({
						dates: monthDays(calendarMonth),
						cutoffDay: decodeNumber(company.pay_cutoff_day ?? 1),
						companyId: selectedCompanyId,
						holidays: holidaysQuery?.current ?? [],
						codes: shiftsQuery?.current ?? [],
						precedence: version?.work_rules?.holiday_rest_precedence,
						plans:
							payload.roster === undefined
								? workDays
										.filter((day) => day.employment_id === person.id)
										.map((day) => ({
											work_date: dateKey(day.work_date),
											shift_definition_id: day.shift_definition_id ?? null
										}))
								: filed.map((row) => ({
										work_date: row.work_date,
										shift_definition_id: codeIdByCode.get(row.shift_code) ?? null
									})),
						rosterPeriods: filed.length > 0 ? [calendarMonth] : [],
						patternOn: (date) => {
							const term = termOn(person.id, date);
							const row = term == null ? null : termPatternRow(term);
							return row == null ? null : { pattern: row.pattern, anchor: patternAnchor(row) };
						}
					});
				} catch {
					return new Set();
				}
			},
			(number, date) => {
				const person = byNumber.get(number);
				return (
					person == null ||
					overtimeEntitled(version?.work_rules?.overtime_when, {
						employee: null,
						employment: { service_start: '' },
						terms: termOn(person.id, date),
						company: { region: company.region, facts: company.facts },
						asOf: date
					})
				);
			}
		);
		if (rows.length === 0) return;
		toast.warning(t('app.scheduling.import_holiday_without_overtime', { count: rows.length }), {
			description: rows
				.map((row) =>
					t('roster.day_sheet_holiday_without_overtime', {
						person: [row.employee_number, byNumber.get(row.employee_number)?.name]
							.filter(Boolean)
							.join(' '),
						date: row.work_date
					})
				)
				.join('\n'),
			descriptionClass: 'whitespace-pre-line',
			duration: Number.POSITIVE_INFINITY
		});
	}

	function importWorkbook() {
		// One file, two sheets: the roster and the time entries of one legal entity's month, stated on
		// its Settings sheet. There is no draft roster to land in; the pipeline refuses a file that
		// does not name its entity and month.
		return runWorkbookImport(
			{
				collectionName: 'work_days',
				recordLabel: t('component.work_days'),
				buildPayload: schedulingImportPayload,
				importedCount: schedulingImportDays,
				afterImport: warnHolidaysWithoutOvertime
			},
			t
		);
	}

	/**
	 * The sheet the import expects, built here and saved as a file: the entity and the month the
	 * board is on, prefilled, with a Roster grid and a Time entries table the reader accepts.
	 */
	function downloadImportTemplate() {
		return Effect.gen(function* () {
			const company = selectedCompany;
			if (company == null) return;
			const workbook = schedulingTemplateWorkbook({
				legalEntity: String(company.name ?? ''),
				month: calendarMonth,
				timezone: PAYROLL_TIME_ZONE
			});
			const buffer = yield* Effect.tryPromise({
				try: () => workbook.xlsx.writeBuffer(),
				catch: toError
			});
			saveBlob(new Blob([buffer], { type: XLSX_MEDIA_TYPE }), `scheduling-${calendarMonth}.xlsx`);
		});
	}

	function selectMonth(nextMonth: string): void {
		if (!/^\d{4}-(0[1-9]|1[0-2])(-[12])?$/.test(nextMonth)) return;
		month = nextMonth;
		boardQuery.setPageIndex(0);
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * SCHEDULE FACTS THE SWAP AND THE OVERLAP CHECK BOTH NEED
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	function claimFor(day: { readonly workDayId: string | null }): SettlementClaim | null {
		return day.workDayId == null ? null : (settlementClaims.get(day.workDayId) ?? null);
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
		const patternRow = term == null ? null : termPatternRow(term);
		return patternRosterCodeId(patternRow?.pattern ?? null, date, patternAnchor(patternRow));
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * OPENING A DAY — the record sheet, or the create sheet when there is no record yet
	 *
	 * A cell with a stored row opens the workspace's own record sidesheet for that `work_days`
	 * record: the URL stack, the collection's `+representation.svelte`, the lock seal in the header.
	 * That is the same surface every collection table opens, and it reads the record through the
	 * collection client rather than through this page.
	 *
	 * A cell with no row has no record to open — pattern-projected days are the normal case — so it
	 * opens the create sheet instead, rendering the very same representation with the person and the
	 * day this cell already knows. Nothing is written until the operator saves.
	 * ──────────────────────────────────────────────────────────────────────────────────────────── */

	const dayRouteKey = createCollectionRouteKey({ view: 'work' });
	/**
	 * Captured at initialisation, like every context read. A click handler runs long after the
	 * component mounted, and `getContext` outside initialisation throws rather than answering.
	 */
	const detailNavigation = getCollectionNavigationContext();
	const collectionSurfaceRuntime = getCollectionSurfaceRuntime();
	const workDaysSurface = $derived(
		resolveCollectionSurface(collectionSurfaceRuntime?.surfaces, 'work_days')
	);

	function openDaySheet(employmentId: string, date: string): void {
		const stored = workDayByKey.get(personDayKey(employmentId, date));
		const recordId = stored?.id;
		if (recordId != null && isSettledId(recordId)) {
			detailNavigation?.open({
				collectionName: 'work_days',
				recordId,
				routeKey: dayRouteKey
			});
			return;
		}
		dayCreate.employmentId = employmentId;
		dayCreate.date = date;
		dayCreate.open = true;
	}

	/* ────────────────────────────────────────────────────────────────────────────────────────────
	 * THE SWAP — two cells, one mutation, and the server is the judge
	 *
	 * The board checks exactly one thing before arming a swap: the payroll lock, because a frozen
	 * day is a fact the board has already drawn and the gesture should not exist there. Everything
	 * else — leave ownership, shift overlap, the month's pattern conformance — is the transform's
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
</script>

{#snippet companyScopeActions()}
	<CompanyScopeCombobox
		value={selectedCompanyId}
		onValueChange={(id) => {
			chosenCompanyId = id;
		}}
	/>
{/snippet}

{#snippet monthNavigation()}
	<MonthPeriodPicker
		month={period}
		halves={selectedCompany?.pay_frequency === 'SEMI_MONTHLY'}
		weeks={selectedCompany?.pay_frequency === 'WEEKLY'}
		onMonthChange={selectMonth}
	/>
{/snippet}

<AppShell
	icon="lucide:calendar-clock"
	title="Work"
	description="Plan the monthly roster on a calendar, publish it against the statutory rules, and manage the shifts a day is worked on and the patterns a week is shaped by"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/scheduling-banner.webp"
>
	<AppHeaderActions>
		{@render companyScopeActions()}
	</AppHeaderActions>

	<!--
		No tab strip: the board is the app's only surface now, so nothing carries the app inset —
		the shell's default `page` variant does, which is what aligns the board with the hero icon.
		Its `Bound size="full"` still hands the board its height, and the board's `Cover` reads it,
		so the board still owns its own scrollport.
	-->
	{@render board()}
</AppShell>

<!--
	The board's rows are people, while its filters are generated from the `work_days` schema. A
	matching person-day keeps its person on screen and the board still shows that person's complete
	month, so a filter narrows the roster without stripping away the calendar context.

	Import is an ordinary import pipeline, which is what lets it state its own refusal. The one
	workbook carries the roster and the time entries as two sheets; its Settings sheet states the
	legal entity, the month and the timezone.
-->
{#snippet boardToolbar()}
	<CollectionActionToolbar
		{client}
		collection="work_days"
		query={boardQuery}
		navigation={monthNavigation}
		actions={monthStatus}
		operations={{
			importPipelines: [
				{
					id: 'scheduling-workbook',
					label: t('app.scheduling.import'),
					description: t('app.scheduling.import_title', { month: calendarMonth }),
					icon: 'lucide:upload',
					run: importWorkbook
				}
			],
			exportPipelines: [
				{
					id: 'scheduling-template',
					label: t('app.scheduling.import_template'),
					description: t('app.scheduling.import_template_description', { month: calendarMonth }),
					icon: 'lucide:file-down',
					run: downloadImportTemplate
				}
			]
		}}
	/>
{/snippet}

<!-- The eye filter and the board help ride the toolbar row, after its actions: one row of chrome. -->
{#snippet monthStatus(_composition: CollectionToolbarComposition<Record<string, unknown>>)}
	<Cluster gap="sm">
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
					<AlertTitle>{t('app.scheduling.board_load_failed', { month: period })}</AlertTitle>
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
						? t('app.scheduling.no_unresolved_clock_outs', { month: period })
						: t('app.scheduling.no_matches')}
				</p>
			{:else if !loading && people.length === 0}
				<p class="text-sm text-muted-foreground">
					{emptyEmploymentReason === 'NONE'
						? t('app.scheduling.no_company_employments')
						: emptyEmploymentReason === 'ENDED'
							? t('app.scheduling.employments_ended_before', { month: period })
							: emptyEmploymentReason === 'NOT_STARTED'
								? t('app.scheduling.employments_start_after', { month: period })
								: t('app.scheduling.employments_outside_month', { month: period })}
				</p>
			{:else}
				<RosterMonthBoard
					month={period}
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

						const fromExisting = workDayByKey.get(personDayKey(from.employmentId, from.date));
						const toExisting = workDayByKey.get(personDayKey(to.employmentId, to.date));
						// One batch when both cells are rows, or neither: the month is judged whole. A
						// mixed pair is two writes, so a WORK/REST swap onto a missing cell is judged one
						// cell at a time and may be refused by the month rule.
						// ponytail: a mixed pair is two batches; one write needs a create+update graph
						const swaps = [
							{
								existing: fromExisting,
								employmentId: from.employmentId,
								date: from.date,
								code: toCodeId
							},
							{
								existing: toExisting,
								employmentId: to.employmentId,
								date: to.date,
								code: fromCodeId
							}
						];
						const creates = swaps
							.filter((cell) => cell.existing == null)
							.map((cell) => ({
								employment_id: cell.employmentId,
								work_date: cell.date,
								shift_definition_id: cell.code
							}));
						const updates = swaps
							.filter((cell) => cell.existing != null)
							.map((cell) => ({ id: cell.existing!.id, shift_definition_id: cell.code }));
						Effect.runFork(
							submitCollectionMutation(() =>
								creates.length === 0
									? client.collection.work_days.updateMany(updates)
									: updates.length === 0
										? client.collection.work_days.createMany(creates)
										: client.collection.work_days
												.createMany(creates)
												.then(() => client.collection.work_days.updateMany(updates))
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

<!--
	The create sheet: a cell with no stored person-day opens the collection's own representation,
	exactly as the record sidesheet renders it, with the person and the day this cell names. The
	representation owns its editors and its write; this sheet owns only the chrome and the identity.
-->
<Sheet.Root bind:open={dayCreate.open}>
	<Sheet.Content flush class="sm:max-w-xl">
		<Sheet.Header class="shrink-0 border-b px-5 py-4">
			<Sheet.Title>{t('component.create_work_day')}</Sheet.Title>
			<Sheet.Description class="sr-only">
				{t('component.work_day_planned_description')}
			</Sheet.Description>
		</Sheet.Header>
		<!-- The create sheet owns the vertical axis, exactly as the record sheet's tabs do. -->
		<Scroll name={t('component.create_work_day')} class="p-5">
			{#if workDaysSurface?.representation}
				{@const Representation = workDaysSurface.representation}
				<Representation
					record={null}
					close={() => {
						dayCreate.open = false;
					}}
				/>
			{:else if workDaysSurface?.representationLoading}
				<p class="text-sm text-muted-foreground" role="status">{t('component.loading')}</p>
			{:else}
				<p class="text-sm text-muted-foreground" role="alert">{t('table.noCustomViewDesc')}</p>
			{/if}
		</Scroll>
	</Sheet.Content>
</Sheet.Root>
