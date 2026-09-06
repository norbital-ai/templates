<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../lib/workspace-client.js';
	import { Effect, Number as EffectNumber } from 'effect';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import {
		CollectionForm,
		type CollectionFormController,
		type CollectionFormSemantic
	} from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { Bound, Cluster, Cover, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import RosterMonthCalendar from '../lib/ui/roster/roster-month-calendar.svelte';
	import { employeeMissingPunchReportable } from '../lib/ui/roster/employee-reportability.js';
	import DaySheet, { type DaySheetPerson } from '../lib/ui/roster/day-sheet.svelte';
	import {
		formatCalendarDate,
		formatDurationHours,
		formatLeaveRange,
		formatNumeric
	} from '../lib/ui/display-formatters.js';
	import { leaveAccountSummary } from '../lib/leave/ledger.js';
	import { describeExit, describeYearEnd } from '../lib/leave/rules.js';
	import { measuredLeaveRequestDays } from '../lib/leave/pending.js';
	import {
		PAYROLL_TIME_ZONE,
		daysBetweenKeys,
		inForceTodayFilter,
		monthKey,
		monthWorkDateInstantBounds,
		payDateFor,
		shiftMonthKey,
		todayKey,
		workDateCalendarKey,
		todayInstant
	} from '../lib/ui/calendar.js';
	import { inForceOnDay } from '../lib/effective_range.js';
	import { formatDateISO } from '@norbital-ai/std/date';
	import { getErrorMessage } from '@norbital-ai/std';
	import { decodeNumber } from '@norbital-ai/std/json';
	import {
		ATTENDANCE_DRAFT_PROBLEM_KEY,
		DAY_MINUTES,
		assessAttendanceDraft,
		buildRosterMonth,
		clockToDayMinutes,
		dayMinutesToClock,
		holidayNamesByDate,
		instantFromDayStart,
		intervalDrafts,
		minutesFromDayStart,
		monthDays,
		type DayFacts,
		type IntervalDraft,
		type LockRung
	} from '../lib/ui/roster/roster-month.js';
	import { attendanceBoundary } from '../lib/attendance.js';
	import {
		sourceLock,
		sourceLockReason,
		sourceLockRecordMetadata,
		type DayLock,
		type SourceLock
	} from '../lib/scheduling/lock.js';
	import { setContext } from 'svelte';
	import {
		LEAVE_REQUEST_CREATE_SCOPE,
		type LeaveRequestCreateScope
	} from '../lib/ui/leave-request-create-scope.js';

	const user = getPlatformStateContext()().user;
	const today = todayKey();

	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * Source id → the period that holds its capture, from one junction read.
	 *
	 * The three settlement lookups on this screen — attendance, leave, entries — share one shape,
	 * so the index is built once here and each junction read stays a one-expression query.
	 */
	function capturesBySource(
		rows: readonly { readonly period: string }[] | undefined,
		sourceColumn: string
	): Map<string, { readonly period: string }> {
		const byId = new Map<string, { readonly period: string }>();
		if (rows == null) return byId;
		for (const row of rows)
			byId.set(String(Reflect.get(row, sourceColumn)), { period: row.period });
		return byId;
	}

	/** Every catalogue read on this page skips rows still held under an approval request. */
	const approved = { approval_id: { isNull: true } } as const;

	/**
	 * My loans opens on the agreements still being repaid today, as a filter chip the reader can drop
	 * to see settled ones.
	 */
	const employeeQuery = $derived(
		client.db.employees.findFirst({ where: { email: { eq: user.email } } })
	);
	const employeeId = $derived(employeeQuery.current?.id);
	const companiesQuery = $derived(
		client.db.companies.findMany({
			where: { approval_id: { isNull: true } },
			limit: 500
		})
	);
	const companyById = $derived(
		new Map((companiesQuery.current ?? []).map((company) => [company.id, company]))
	);
	const employmentsQuery = $derived(
		employeeId
			? client.db.employments.findMany({
					where: { employee_id: { eq: employeeId }, approval_id: { isNull: true } },
					limit: 10
				})
			: null
	);
	const activeEmployments = $derived(
		(employmentsQuery?.current ?? []).filter((employment) =>
			inForceOnDay(employment.effective_range, today)
		)
	);
	let selectedEmploymentId = $state<string | null>(null);
	const employmentOptions = $derived(
		activeEmployments.map((employment) => ({
			value: employment.id,
			label: `${companyById.get(employment.company_id)?.name ?? t('app.hr_employee.company_fallback')}${t('app.hr_employee.employment_affiliation', { number: employment.employee_number })}`,
			search_term: `${companyById.get(employment.company_id)?.name ?? ''} ${employment.employee_number}`
		}))
	);
	const selectedEmployment = $derived(
		activeEmployments.find((employment) => employment.id === selectedEmploymentId)
	);
	const employmentId = $derived(
		activeEmployments.length === 1 ? activeEmployments[0]?.id : selectedEmployment?.id
	);
	const activeEmployment = $derived(
		activeEmployments.find((employment) => employment.id === employmentId)
	);
	setContext<LeaveRequestCreateScope>(LEAVE_REQUEST_CREATE_SCOPE, {
		employmentId: () => employmentId,
		companyId: () => activeEmployment?.company_id
	});
	const needsEmploymentChoice = $derived(activeEmployments.length > 1 && !employmentId);
	/**
	 * Every surface on this page is scoped by `employmentId` — the four tables, and now the schedule
	 * calendar — so a reader with no active employment has nothing to scope to and each table is
	 * handed `disabled`. That disables the create button along with search, filter and refresh — and
	 * on its own it renders as a dead page whose greyed `New Leave Request` reads as "you are not
	 * allowed to do this", which is the one thing it does not mean. An employee who *does* hold an
	 * employment may create here; the create is gated on their direct manager, and a gated create is
	 * still a create.
	 *
	 * The calendar takes the same gate for the same reason and expresses it differently: it draws
	 * nothing at all rather than an empty month, because a month grid with no facts in it looks like
	 * a person who is rostered nothing, and that is a different and much more alarming claim than
	 * "HR has not opened your employment yet".
	 *
	 * The gate below states the real reason instead. It is held false while either query is still in
	 * flight so the explanation cannot flash before the rows that would contradict it. A resolved
	 * employee with no `employments` row and no employee row at all land in the same place, and
	 * correctly so: neither can be scoped to an employment, and both are fixed by HR, not by the
	 * reader.
	 */
	const employmentContextResolved = $derived(
		!employeeQuery.loading && !(employmentsQuery?.loading ?? false)
	);
	const hasNoActiveEmployment = $derived(
		employmentContextResolved && activeEmployments.length === 0
	);
	const company = $derived(
		activeEmployment ? companyById.get(activeEmployment.company_id) : undefined
	);
	const leavePlansQuery = $derived(
		company == null
			? null
			: client.db.leave_plans.findMany({
					where: {
						company_id: { eq: company.id },
						lifecycle: { eq: 'ACTIVE' },
						effective_range: { contains_date: todayInstant() },
						approval_id: { isNull: true }
					},
					limit: 20
				})
	);
	const activeLeavePlanIds = $derived((leavePlansQuery?.current ?? []).map((plan) => plan.id));
	const leaveTypesQuery = $derived(
		activeLeavePlanIds.length === 0
			? null
			: client.db.leave_types.findMany({
					where: {
						leave_plan_id: { in: activeLeavePlanIds },
						approval_id: { isNull: true }
					},
					limit: 200
				})
	);
	/** The same plan catalogue labels the employee calendar and controller board. */
	const leaveCodeById = $derived(
		new Map((leaveTypesQuery?.current ?? []).map((leaveType) => [leaveType.id, leaveType.code]))
	);
	/**
	 * NO `payroll_runs` QUERY LIVES ON THIS PAGE, AND NONE MAY BE ADDED.
	 *
	 * An employee has no `read` grant on `payroll_runs` — see `src/access/policies/+employee.ts` —
	 * and that is the owner's ruling, not an oversight: only the HR controller, the HR manager and
	 * the L1 manager see the runs. This page used to ask anyway and build `payrollWindows` from the
	 * result. The result was always empty, and an empty window list is indistinguishable from "this
	 * company has never run payroll", so every window-derived lock on this screen quietly answered
	 * `NONE` while looking like a working lock. A lock that can never engage is worse than no lock:
	 * it reads as "nothing is holding this day" to the one person who most needs to be told
	 * otherwise.
	 *
	 * So the window axis is gone from this app entirely, and every `sourceLock` call below passes
	 * `windows: []` as a stated fact rather than as an accident of an unreadable query. What an
	 * employee can honestly know about a lock is exactly two things, and both are readable:
	 *
	 *   - PENDING  — `approval_id` on their own row. The platform's own stamp.
	 *   - CONSUMED — a `payslip_adjustments` row naming the payslip that took the record. Granted by
	 *                `settlementLedgerGrants()`, exact, stored, per-record. It is strictly better
	 *                than the window inference it replaces: the window guessed from a date, this
	 *                names the period.
	 *
	 * The day-axis rungs the board draws — "in a draft run", "paid" — are not computable here and
	 * are not drawn; see the ladder note in `roster-month-calendar.svelte`.
	 */
	/** No window means no day lock on this page: it is stated once instead of mapped over the month. */
	const NO_DAY_LOCKS: ReadonlyMap<string, DayLock> = new Map();

	type ClaimRow = WorkspaceRow<'component_entries'>;
	type PayslipRow = WorkspaceRow<'payslips'> & {
		readonly payslip_payroll_run?: Pick<WorkspaceRow<'payroll_runs'>, 'period'> | null;
	};

	function leaveRowLock(row: WorkspaceRow<'leave_requests'>) {
		return sourceLock({
			existing: true,
			approvalId: row.approval_id,
			dates: [],
			settledBy: leaveSettlementByRequestId.get(row.id) ?? null,
			datePassed: 'IS_NOT_A_LOCK'
		});
	}

	/**
	 * What holds one attendance record — and, deliberately, nothing about what day it falls on.
	 *
	 * This is the §2.2/§8.4 correction, and it is the same call `work_days/+hooks.ts` makes on
	 * its update and delete paths, argument for argument, so the screen and the write path cannot
	 * disagree about a row:
	 *
	 *   - `datePassed: 'IS_NOT_A_LOCK'` — this used to pass `today`, which meant `DATE_PASSED` fired
	 *     on every historical row. On an employee's own calendar that greys out every day they have
	 *     actually worked, which is every day worth looking at. A passed date never protected
	 *     anything: consumption by payroll is what protects a record, and consumption is stored.
	 *   - `dates: []` — with no date-shaped lock asked for, there is no date-shaped question left.
	 *
	 * What is left is the settlement claim and `PENDING_APPROVAL` — which is the whole point on this
	 * screen. An employee's reported punch carries `approval_id` until a manager settles it,
	 * and that is the rung the calendar draws as "waiting on your manager".
	 */
	function attendanceRowLock(row: WorkspaceRow<'work_days'>): SourceLock {
		return sourceLock({
			existing: true,
			approvalId: row.approval_id,
			dates: [],
			settledBy: settlementByWorkDayId.get(row.id) ?? null,
			datePassed: 'IS_NOT_A_LOCK'
		});
	}

	function claimRowLock(row: ClaimRow) {
		return sourceLock({
			existing: true,
			approvalId: row.approval_id,
			dates: [],
			settledBy: claimSettlementByEntryId.get(row.id) ?? null,
			datePassed: 'IS_NOT_A_LOCK'
		});
	}
	/** The next occurrence of the company's pay day — a calendar reading, not a payroll decision. */
	const nextPayDate = $derived.by(() => {
		if (!company) return null;
		const thisMonth = payDateFor(monthKey(today), company.pay_day);
		return thisMonth >= today
			? thisMonth
			: payDateFor(shiftMonthKey(monthKey(today), 1), company.pay_day);
	});
	const daysToPayday = $derived(
		nextPayDate ? Math.max(0, daysBetweenKeys(today, nextPayDate)) : null
	);

	function payrollRunPeriod(row: PayslipRow): string {
		return row.payslip_payroll_run?.period ?? '—';
	}

	/** Fill width for a leave meter — empty when the track has no length. */
	function leaveMeterWidth(value: number, total: number): string {
		return `${EffectNumber.clamp({ minimum: 0, maximum: 100 })(total <= 0 ? 0 : (value / total) * 100)}%`;
	}

	/* ──────────────────────────────────────────────────────────────────────────────────────────────
	 * MY SCHEDULE
	 *
	 * The controller's board and this calendar are one derived fact table drawn at two densities.
	 * Every query below is the board's query with `company_id` swapped for `employment_id`, which is
	 * why they are roughly 1/300th of its size and why none of them needed a policy change: the
	 * `employee` policy already scopes `work_days`, `leave_requests` and
	 * `employment_terms` to the reader's own employments, and `employeeReferenceGrants` already hands
	 * them the company-wide calendars — holidays and shift definitions — that a personal
	 * schedule is meaningless without.
	 *
	 * ONE THING IS DELIBERATELY ABSENT, and it is a ruling rather than a gap: `payroll_runs` is not
	 * readable by an employee, so this calendar has no day axis at all. It draws the record axis —
	 * pending, and consumed-by-payslip from `payslip_adjustments` — and nothing else. See the note above
	 * `NO_DAY_LOCKS`, and the ladder note in `roster-month-calendar.svelte` for why a rung that
	 * could never light was removed instead of being left dark.
	 * ────────────────────────────────────────────────────────────────────────────────────────────── */

	let scheduleMonth = $state(monthKey(todayKey()));
	const scheduleMonthStart = $derived(`${scheduleMonth}-01`);
	const scheduleMonthEnd = $derived(
		formatDateISO(
			new Date(Date.parse(`${shiftMonthKey(scheduleMonth, 1)}-01T00:00:00.000Z`) - 86_400_000)
		)
	);
	const scheduleWorkDateBounds = $derived(monthWorkDateInstantBounds(scheduleMonth));

	function selectScheduleMonth(nextMonth: string): void {
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth)) return;
		scheduleMonth = nextMonth;
	}

	/**
	 * A month for one person is at most thirty-one rows per collection, so none of these narrow their
	 * columns. The board narrows its own because it asks for three hundred people at once; here a
	 * column list would only be a second place to forget a field when `DayFacts` grows one.
	 */
	/**
	 * Deliberately NOT filtered to approved rows, which is the one place this query differs from the
	 * board's.
	 *
	 * A punch the reader reported themselves carries `approval_id` until a manager settles it, and
	 * it is invisible to every approved-only query — including the one that feeds `buildRosterMonth`.
	 * Filtering here would hide the employee's own submission from the employee, which is precisely
	 * the state §8.2 calls the most important one on this screen.
	 *
	 * The plan and the punch were two queries and are one, because they are one row. What the split
	 * used to do — approved rows become facts, pending ones become the PENDING rung — is done by
	 * `scheduleFactWorkDays` below, on the CLOCK rather than on the row: a pending submission must
	 * not read as attendance, and the plan on that same row must not disappear with it.
	 */
	const scheduleWorkDaysQuery = $derived(
		employmentId == null
			? null
			: client.db.work_days.findMany({
					where: {
						employment_id: { eq: employmentId },
						work_date: { gte: scheduleWorkDateBounds.start, lte: scheduleWorkDateBounds.end }
					},
					limit: 200
				})
	);
	/** Requests are stored once at `from_date`, so the window is widened to catch one spanning in. */
	const scheduleLeaveQuery = $derived(
		employmentId == null
			? null
			: client.db.leave_requests.findMany({
					where: {
						...approved,
						employment_id: { eq: employmentId },
						kind: { eq: 'TIME_OFF' },
						from_date: { lte: scheduleMonthEnd },
						to_date: { gte: scheduleMonthStart }
					},
					limit: 200
				})
	);
	const schedulePendingLeaveQuery = $derived(
		employmentId == null
			? null
			: client.db.leave_requests.findMany({
					where: {
						approval_id: { isNotNull: true },
						employment_id: { eq: employmentId },
						kind: { eq: 'TIME_OFF' },
						from_date: { lte: scheduleMonthEnd },
						to_date: { gte: scheduleMonthStart }
					},
					limit: 200
				})
	);
	const scheduleHolidaysQuery = $derived(
		activeEmployment == null
			? null
			: client.db.company_holidays.findMany({
					where: {
						...approved,
						company_id: { eq: activeEmployment.company_id },
						date: { gte: scheduleMonthStart, lte: scheduleMonthEnd }
					},
					limit: 200
				})
	);
	const scheduleShiftsQuery = $derived(
		activeEmployment == null
			? null
			: client.db.shift_definitions.findMany({
					where: { ...approved, company_id: { eq: activeEmployment.company_id } },
					limit: 500
				})
	);
	const scheduleTermsQuery = $derived(
		employmentId == null
			? null
			: client.db.employment_terms.findMany({
					where: { ...approved, employment_id: { eq: employmentId } },
					limit: 100
				})
	);

	const scheduleWorkDays = $derived(scheduleWorkDaysQuery?.current ?? []);
	/**
	 * The month as FACTS, with an unapproved clock masked out of it.
	 *
	 * A pending submission is not yet attendance, and it used to be excluded by dropping the whole
	 * row — which was correct while the row was nothing but the punch. It is not correct now: the
	 * same row carries the roster assignment, and dropping it would erase the plan from the calendar
	 * of the one person who reported against that plan. So the mask is on the two clock columns and
	 * on nothing else.
	 *
	 * Every row is rebuilt rather than passed through, because a projection that returns some of its
	 * inputs by reference gives a downstream `$state` assignment nothing to notice.
	 */
	const scheduleFactWorkDays = $derived(
		scheduleWorkDays.map((row) =>
			// A pending submission's clock is masked, not deleted. `worked_intervals` is nullable and
			// NULL is the honest "no attendance visible" value; `break_minutes` is NOT NULL with a
			// default of 0, so 0 is its masked form — a null there would state a value the column
			// cannot hold.
			row.approval_id == null ? { ...row } : { ...row, worked_intervals: null, break_minutes: 0 }
		)
	);
	const schedulePendingDates = $derived(
		new Set(
			scheduleWorkDays
				.filter((row) => row.approval_id != null)
				.map((row) => workDateCalendarKey(row.work_date))
		)
	);

	/**
	 * The settlement ledger, which is why a refusal on a settled day is an EXPLANATION here rather
	 * than an access denial. `settlementLedgerGrants()` puts this read on the `employee` policy
	 * deliberately — see `src/lib/policy_grants.ts`.
	 */
	const scheduleSettlementsQuery = $derived.by(() => {
		const ids = scheduleWorkDays.map((row) => row.id);
		if (ids.length === 0) return null;
		return client.db.payslip_work_day_inputs.findMany({
			where: { work_day_id: { in: ids } },
			columns: { work_day_id: true, period: true },
			limit: 200
		});
	});
	/**
	 * The same capture lookup for the leave table and the claims table below, scoped by the rows
	 * each self-contained table renders. `settlementLedgerGrants()` exposes exactly the source-id +
	 * period pair, so the walk through payslip and run the predecessor needed is gone and so is
	 * every level of it an employee had no grant to make.
	 */
	const myLeaveIdsQuery = $derived(
		employmentId == null
			? null
			: client.db.leave_requests.findMany({
					where: { employment_id: { eq: employmentId } },
					columns: { id: true },
					limit: 500
				})
	);
	const myEntryIdsQuery = $derived(
		employmentId == null
			? null
			: client.db.component_entries.findMany({
					where: { employment_id: { eq: employmentId } },
					columns: { id: true },
					limit: 500
				})
	);
	const PENDING_LEAVE_LIMIT = 2_000;
	/** Track both committed rows and visible proposals, including requests HR raises on this employee's behalf. */
	const myLeavePendingQuery = $derived(
		employmentId == null
			? null
			: client.pending.findMany('leave_requests', {
					where: { employment_id: { eq: employmentId } },
					limit: PENDING_LEAVE_LIMIT
				})
	);
	const leaveAccountsQuery = $derived(
		employmentId == null
			? null
			: client.db.leave_accounts.findMany({
					where: { employment_id: { eq: employmentId }, approval_id: { isNull: true } },
					orderBy: { starts_on: 'desc' },
					limit: 500
				})
	);
	const currentLeaveAccounts = $derived(
		(leaveAccountsQuery?.current ?? []).filter(
			(account) =>
				account.status === 'OPEN' &&
				today >= String(account.starts_on).slice(0, 10) &&
				today <= String(account.ends_on).slice(0, 10)
		)
	);
	const leaveAccountIds = $derived(currentLeaveAccounts.map((account) => account.id));
	const leaveEntriesQuery = $derived(
		leaveAccountIds.length === 0
			? null
			: client.db.leave_entries.findMany({
					where: {
						leave_account_id: { in: leaveAccountIds },
						approval_id: { isNull: true }
					},
					orderBy: { effective_on: 'desc' },
					limit: 5_000
				})
	);
	const myLeaveCapturesQuery = $derived(
		employmentId == null
			? null
			: client.db.payslip_leave_request_inputs.findMany({
					where: {
						leave_request_id: { in: (myLeaveIdsQuery?.current ?? []).map((row) => row.id) }
					},
					columns: { leave_request_id: true, period: true },
					limit: 500
				})
	);
	const myEntryCapturesQuery = $derived(
		employmentId == null
			? null
			: client.db.payslip_component_entry_inputs.findMany({
					where: {
						component_entry_id: { in: (myEntryIdsQuery?.current ?? []).map((row) => row.id) }
					},
					columns: { component_entry_id: true, period: true },
					limit: 500
				})
	);
	const leaveSettlementByRequestId = $derived(
		capturesBySource(myLeaveCapturesQuery?.current, 'leave_request_id')
	);
	const claimSettlementByEntryId = $derived(
		capturesBySource(myEntryCapturesQuery?.current, 'component_entry_id')
	);
	const settlementByWorkDayId = $derived(
		capturesBySource(scheduleSettlementsQuery?.current, 'work_day_id')
	);

	/** One sealed account receipt plus its posted ledger and held applications. */
	const leaveBalanceRowsResult = $derived.by(() => {
		try {
			if (myLeavePendingQuery?.error) throw myLeavePendingQuery.error;
			if (leaveAccountsQuery?.error) throw leaveAccountsQuery.error;
			if (leaveEntriesQuery?.error) throw leaveEntriesQuery.error;
			if ((myLeavePendingQuery?.current ?? []).length >= PENDING_LEAVE_LIMIT)
				throw new Error(t('app.hr_employee.leave_balances_pending_ceiling'));
			return {
				rows: currentLeaveAccounts.map((account) => {
					const accountEntries = (leaveEntriesQuery?.current ?? []).filter(
						(entry) => entry.leave_account_id === account.id
					);
					const pending = (myLeavePendingQuery?.current ?? [])
						.filter(
							(request) => request.leave_account_id === account.id && request.approval_id != null
						)
						.reduce((total, request) => total + measuredLeaveRequestDays(request), 0);
					return {
						account,
						carryExpiresOn:
							accountEntries.find(
								(entry) => entry.kind === 'CARRY_FORWARD' && entry.expires_on != null
							)?.expires_on ?? null,
						summary: leaveAccountSummary({
							account,
							entries: accountEntries,
							pendingDays: pending,
							asOf: today
						})
					};
				}),
				error: null
			};
		} catch (cause) {
			return { rows: [], error: getErrorMessage(cause) };
		}
	});
	const leaveBalanceRows = $derived(leaveBalanceRowsResult.rows);

	const scheduleHolidays = $derived(scheduleHolidaysQuery?.current ?? []);
	const scheduleHolidayNames = $derived(holidayNamesByDate(scheduleHolidays));
	const scheduleRosterCodesById = $derived(
		new Map((scheduleShiftsQuery?.current ?? []).map((code) => [code.id, code]))
	);

	/**
	 * The attendance window past which a silent working day reads as `ABSENT` rather than `PLANNED`.
	 *
	 * The board takes this from the month's `payroll_runs` row when one has been opened, and falls
	 * back to the company's cut-off day when none has. This app only ever had the fallback: the run
	 * lookup it used to attempt could not resolve, so the branch that read `attendance_from` /
	 * `attendance_to` was dead and every reader already landed here. Only the fallback is written
	 * now, because a branch that cannot be taken is not a rule — it is a claim that the two surfaces
	 * agree, made by code that never runs.
	 *
	 * `pay_cutoff_day` is on `companies`, which `employeeReferenceGrants` does grant, so this is
	 * readable — and it is the same arithmetic the board applies to the same column, which is what
	 * actually keeps the two from disagreeing about which days are exceptions.
	 */
	const scheduleCutoff = $derived.by(() => {
		const cutoffDay = company?.pay_cutoff_day;
		if (cutoffDay == null) return null;
		const day = String(
			EffectNumber.clamp({ minimum: 1, maximum: 28 })(decodeNumber(cutoffDay))
		).padStart(2, '0');
		return {
			start: `${shiftMonthKey(scheduleMonth, -1)}-${day}`,
			end: formatDateISO(new Date(Date.parse(`${scheduleMonth}-${day}T00:00:00.000Z`) - 86_400_000))
		};
	});

	const scheduleFacts = $derived(
		buildRosterMonth({
			month: scheduleMonth,
			employments: activeEmployment == null ? [] : [activeEmployment],
			employmentTerms: scheduleTermsQuery?.current ?? [],
			workDays: scheduleFactWorkDays,
			leaveRequests: scheduleLeaveQuery?.current ?? [],
			pendingLeaveRequests: schedulePendingLeaveQuery?.current ?? [],
			holidays: scheduleHolidays,
			rosterCodesById: scheduleRosterCodesById,
			leaveCodeById,
			cutoff: scheduleCutoff,
			locks: NO_DAY_LOCKS,
			today
		})
	);

	function scheduleDay(date: string): DayFacts | null {
		if (employmentId == null) return null;
		return scheduleFacts.get(`${employmentId}:${date}`) ?? null;
	}

	/** The record axis of the lock rail: one `SourceLock` per date that carries an entry at all. */
	const scheduleEntryLocks = $derived(
		new Map(
			scheduleWorkDays.map(
				(row) => [workDateCalendarKey(row.work_date), attendanceRowLock(row)] as const
			)
		)
	);

	/**
	 * First clock-in and last clock-out per day, as wall-clock readings in the payroll timezone.
	 *
	 * `minutesFromDayStart` measures from the instant the work date begins in that zone rather than
	 * converting through the browser, so a punch does not change day for a reader whose laptop is
	 * set to another country. Pending rows are included: showing somebody the times they submitted,
	 * under a rail that says the submission is still with their manager, is the whole point.
	 */
	const schedulePunchWindows = $derived.by(() => {
		const windows = new Map<string, { first: string | null; last: string | null }>();
		for (const row of scheduleWorkDays) {
			const date = workDateCalendarKey(row.work_date);
			const intervals = row.worked_intervals ?? [];
			const first = attendanceBoundary(intervals, 'FIRST');
			const last = attendanceBoundary(intervals, 'LAST');
			windows.set(date, {
				first:
					first == null
						? null
						: dayMinutesToClock(minutesFromDayStart(first, date, PAYROLL_TIME_ZONE)),
				last:
					last == null
						? null
						: dayMinutesToClock(minutesFromDayStart(last, date, PAYROLL_TIME_ZONE))
			});
		}
		return windows;
	});

	/**
	 * Where "report a missing punch" is offered, which is exactly where the write path would accept
	 * it. Each clause names a refusal that already exists rather than inventing a rule:
	 *
	 *   - not `ACTIVE`        — the day is outside the employment; there is nothing to report about it
	 *   - in the future       — a punch that has not happened yet is not a missing punch
	 *   - attendance exists    — a second report would overwrite an answer already recorded
	 *   - already pending     — the platform holds their first report; a second would queue behind it
	 *   - already settled     — the readable settlement claim says payroll consumed this exact row
	 *   - full-day leave      — `assertDayNotOwnedByLeave`: one writer wins the day. A HALF day is
	 *                           still reportable, because the hook only refuses full coverage
	 *
	 * A roster-only person-day is deliberately NOT a blocker. The employee `mutate.existing` grant is
	 * scoped to their own employment and masked to `worked_intervals` / `break_minutes`, so a report
	 * changes the clock on that row while leaving the plan intact. A day with no row uses `mutate.new`.
	 *
	 * ONE REFUSAL IS DELIBERATELY NOT PRE-CHECKED HERE, AND MUST NOT BE ADDED.
	 *
	 * `assertDayHasNoPaidSilence` in `work_days/+hooks.ts` refuses a punch reported on a day a
	 * paid run has already priced as silence. Deciding that on the client needs the run's window,
	 * and an employee has no `read` grant on `payroll_runs` — by ruling, not by omission. There is no
	 * honest way to pre-disable this button, and every dishonest way is worse than not trying:
	 * inferring the period from a payslip guesses, and greying the day out on a stale or absent fact
	 * tells somebody they may not do a thing they may in fact do.
	 *
	 * So the write goes to the server and the server refuses it. That refusal is a sentence already
	 * written for a human — it names the period and says to ask for an adjustment entry — and
	 * `submit` surfaces it verbatim. Attempt-and-explain is the correct pattern whenever the
	 * client is not permitted to hold the data the decision needs; the cost is one round trip on a
	 * rare day, and the alternative is a lie drawn in the UI.
	 *
	 * A rest day with no punch stays reportable on purpose: being called in and forgetting to clock
	 * is the ordinary case for one, and the table this screen replaces let an employee file it.
	 */
	function scheduleReportable(day: DayFacts): boolean {
		return employeeMissingPunchReportable(day, today, schedulePendingDates, settlementByWorkDayId);
	}
	const scheduleReportableDates = $derived(
		new Set(
			monthDays(scheduleMonth).filter((date) => {
				const day = scheduleDay(date);
				return day != null && scheduleReportable(day);
			})
		)
	);

	const scheduleSources = $derived([
		{ label: t('app.hr_employee.source_person_days'), query: scheduleWorkDaysQuery },
		{ label: t('app.hr_employee.source_leave'), query: scheduleLeaveQuery },
		{ label: t('app.hr_employee.source_holidays'), query: scheduleHolidaysQuery },
		{ label: t('app.hr_employee.source_shifts'), query: scheduleShiftsQuery },
		{ label: t('app.hr_employee.source_terms'), query: scheduleTermsQuery }
	]);
	/**
	 * Named sources rather than an OR of `loading` flags, for the reason the board records: a gate
	 * that only knows "loading" has no terminal state, so a query that errors leaves the surface on a
	 * skeleton forever with nothing on screen saying why.
	 */
	const scheduleErrors = $derived(
		scheduleSources.flatMap((source) =>
			source.query?.error ? [`${source.label}: ${source.query.error.message}`] : []
		)
	);
	const scheduleLoading = $derived(
		scheduleErrors.length === 0 &&
			scheduleSources.some((source) => source.query != null && source.query.current === undefined)
	);

	/* ── The day detail, and the one write this app offers ─────────────────────────────────────── */

	let daySheetOpen = $state(false);
	let daySheetDate = $state<string | null>(null);
	const daySheetDay = $derived(
		daySheetDate == null ? undefined : (scheduleDay(daySheetDate) ?? undefined)
	);

	/**
	 * The day the drawer opened, in the drawer's own vocabulary.
	 *
	 * Employee mode renders the same component the board does, so the same props are owed: the
	 * person-day (from this page's own month facts, so the sheet and the tile behind it can never
	 * be a write apart), the stored punches (read off the same attendance query the calendar drew
	 * with), and the lock rung. The rung is the record axis only — the employee has no `payroll_runs`
	 * read grant, so `IN_DRAFT_RUN` and `PAID` cannot be computed here and are never passed; a
	 * claimed entry reads `CONSUMED` and everything else reads `OPEN`, with the refusal sentence
	 * supplied through `lockReason` exactly as the tile's hover composes it.
	 */
	const daySheetPerson = $derived<DaySheetPerson | null>(
		activeEmployment == null
			? null
			: {
					id: activeEmployment.id,
					number: activeEmployment.employee_number,
					name: employeeQuery.current?.name ?? ''
				}
	);
	const daySheetEntry = $derived(
		daySheetDate == null
			? null
			: (scheduleFactWorkDays.find((row) => workDateCalendarKey(row.work_date) === daySheetDate) ??
					null)
	);
	const daySheetIntervals = $derived<readonly IntervalDraft[]>(
		intervalDrafts(daySheetEntry?.worked_intervals)
	);
	const daySheetEntryLock = $derived(
		daySheetEntry == null ? null : attendanceRowLock(daySheetEntry)
	);
	const daySheetRung = $derived<LockRung>(
		daySheetEntryLock?.kind === 'SETTLED' ? 'CONSUMED' : 'OPEN'
	);
	const daySheetLockReason = $derived(
		daySheetEntryLock == null ? null : sourceLockReason(daySheetEntryLock, t)
	);

	function openDaySheet(_employmentId: string, date: string): void {
		daySheetDate = date;
		daySheetOpen = true;
	}

	/**
	 * Employee mode's one write, handed back from the drawer's Save.
	 *
	 * The sheet assessed the draft already (the clamp is stated on its face), so this only carries
	 * the create or update across the same hooks every other attendance write crosses. A roster-only
	 * day carries its existing id and is updated; a day with no row carries employment and date and
	 * is created. Either write is immediately held under `approval_id`, which the platform's mutation
	 * boundary presents rather than letting this component invent a second result state.
	 */
	const report = $state<{
		open: boolean;
		date: string | null;
		startClock: string;
		endClock: string;
	}>({
		open: false,
		date: null,
		startClock: '',
		endClock: ''
	});

	function openReport(_employmentId: string, date: string): void {
		const day = scheduleDay(date);
		report.date = date;
		// Seeded from the roster's own window so the common case is one confirmation, and editable
		// because a missing punch is often exactly the day somebody did NOT work their shift. A day
		// with no planned window seeds empty rather than guessing one.
		report.startClock = day?.shiftStart?.slice(0, 5) ?? '';
		report.endClock = day?.shiftEnd?.slice(0, 5) ?? '';
		report.open = true;
	}

	/**
	 * What a report would actually write, assessed by the same function the day sheet uses and
	 * against the same rules `work_days/+hooks.ts` enforces.
	 *
	 * The break is the part that matters and the reason this is not a one-click submit. A reported
	 * punch is frequently SHORT — twenty minutes on a day somebody stepped in — and carrying the
	 * roster code's scheduled sixty-minute break across to it produces `unpaidBreak >= closedMinutes`,
	 * which `assertWorkedIntervals` refuses. Four rows in the seed bank were exactly that shape. An
	 * employee cannot debug that refusal, so the break is clamped by `assessAttendanceDraft` before
	 * the write, the clamp is stated on the confirmation rather than performed quietly, and a draft
	 * that still cannot be saved disables the button instead of offering a round trip to a sentence
	 * about unpaid breaks.
	 */
	const reportDraft = $derived.by(() => {
		const date = report.date;
		if (date == null) return null;
		const start = clockToDayMinutes(report.startClock, 0);
		const end = clockToDayMinutes(report.endClock, 0);
		if (start == null || end == null) return null;
		// An end at or before the start belongs to the next morning — the same way a roster code's
		// own window models a night shift, so the plan band and this draft count in one unit.
		const crossesMidnight = end <= start;
		const intervals: readonly IntervalDraft[] = [
			{
				start: instantFromDayStart(date, start, PAYROLL_TIME_ZONE),
				end: instantFromDayStart(date, crossesMidnight ? end + DAY_MINUTES : end, PAYROLL_TIME_ZONE)
			}
		];
		const requestedBreak = scheduleDay(date)?.shiftBreakMinutes ?? 0;
		return {
			date,
			intervals,
			crossesMidnight,
			requestedBreak,
			assessment: assessAttendanceDraft(intervals, requestedBreak)
		};
	});
	const reportProblem = $derived.by(() => {
		if (reportDraft == null) return t('app.hr_employee.report_punch_needs_times');
		const problem = reportDraft.assessment.problem;
		return problem == null ? null : t(ATTENDANCE_DRAFT_PROBLEM_KEY[problem]);
	});

	/**
	 * Update the stored row when one exists, create it when none does. Minimal like the day
	 * sheet's: only the routing is seeded, and the clamped draft is pushed via `setValues` as
	 * the clocks are typed, so an untouched dialog cannot submit anything.
	 */
	const reportWorkDayId = $derived(
		report.date == null ? null : (scheduleDay(report.date)?.workDayId ?? null)
	);
	const reportDefaults = $derived(
		employmentId == null || report.date == null
			? undefined
			: reportWorkDayId == null
				? { employment_id: employmentId, work_date: report.date }
				: { id: reportWorkDayId }
	);

	/** Mirror the clamped draft into the form; the time inputs are custom composition. */
	function presetReport(form: CollectionFormController): void {
		const draft = reportDraft;
		if (draft == null || employmentId == null) return;
		form.setValues({
			employment_id: employmentId,
			work_date: draft.date,
			worked_intervals: draft.intervals.map((interval) => ({
				start: interval.start,
				end: interval.end
			})),
			break_minutes: draft.assessment.breakMinutes
		});
	}

	/**
	 * The same assessment the dialog previews, re-run over the form values at submit time, so the
	 * framework Save beside the custom one cannot land a draft the preview refused.
	 */
	const reportSemantic: CollectionFormSemantic = (values) =>
		Effect.sync(() => {
			const intervals = values.worked_intervals;
			if (!Array.isArray(intervals))
				return [{ message: t('app.hr_employee.report_punch_needs_times') }];
			const problem = assessAttendanceDraft(
				intervals as { start: string; end: string | null }[],
				typeof values.break_minutes === 'number' ? values.break_minutes : 0
			).problem;
			if (problem != null) return [{ message: t(ATTENDANCE_DRAFT_PROBLEM_KEY[problem]) }];
			return;
		});
</script>

<svelte:head>
	<title>Employee Self-Service</title>
	<meta
		name="description"
		content="View your schedule, leave, pay components, loans, payslips, and profile"
	/>
	<meta name="bolt:icon" content="lucide:user-round" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/hr_employee-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/hr_employee-banner.webp"
	/>
</svelte:head>

{#snippet contextGate()}
	{#if hasNoActiveEmployment}
		<Stack gap="none" class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-sm font-medium">{t('app.hr_employee.no_active_employment')}</p>
			<p class="text-sm text-muted-foreground">
				{t('app.hr_employee.no_active_employment_description')}
			</p>
		</Stack>
	{:else if needsEmploymentChoice}
		<Stack gap="sm" class="rounded-xl border bg-card p-4 shadow-sm">
			<Stack gap="none">
				<p class="text-sm font-medium">{t('app.hr_employee.choose_employment')}</p>
				<p class="text-sm text-muted-foreground">
					{t('app.hr_employee.choose_employment_description')}
				</p>
			</Stack>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('app.hr_employee.working_as')}
					<Combobox
						options={employmentOptions}
						bind:value={selectedEmploymentId}
						searchPlaceholder={t('app.hr_employee.search_employment')}
						emptyPlaceholder={t('app.hr_employee.no_matching_employment')}
					/>
				</Stack>
			</label>
		</Stack>
	{:else if activeEmployments.length > 1 && selectedEmployment}
		<Cluster class="rounded-xl border bg-card p-4 shadow-sm" gap="md" align="end" justify="between">
			<Stack gap="none">
				<p class="text-sm font-medium">{t('app.hr_employee.working_in')}</p>
				<p class="text-sm text-muted-foreground">
					{companyById.get(selectedEmployment.company_id)?.name ??
						t('app.hr_employee.company_fallback')}
					{t('app.hr_employee.employment_affiliation', {
						number: selectedEmployment.employee_number
					})}
				</p>
			</Stack>
			<label class="w-full text-sm font-medium">
				<Stack gap="xs">
					{t('app.hr_employee.switch_employment')}
					<Combobox
						options={employmentOptions}
						bind:value={selectedEmploymentId}
						searchPlaceholder={t('app.hr_employee.search_employment')}
						emptyPlaceholder={t('app.hr_employee.no_matching_employment')}
					/>
				</Stack>
			</label>
		</Cluster>
	{/if}
{/snippet}

{#snippet home()}
	<Bound size="full">
		<Scroll name={t('app.hr_employee.tab_home')}>
			<Stack gap="md">
				{@render contextGate()}
				{#if employeeQuery.loading}
					<div
						class="h-56 animate-pulse rounded-lg bg-muted/40"
						aria-label={t('component.loading_profile')}
					></div>
				{:else if employeeQuery.current}
					<section
						class="rounded-lg border bg-card shadow-card"
						aria-labelledby="my-profile-heading"
					>
						<Cluster
							align="start"
							justify="between"
							gap="md"
							class="border-b bg-muted/30 px-5 py-4"
						>
							<Stack gap="none">
								<p class="text-overline">
									{t('app.hr_employee.my_profile')}
								</p>
								<h2 id="my-profile-heading" class="text-heading">
									{employeeQuery.current.name}
								</h2>
								<p class="text-sm text-muted-foreground">
									{company?.name ?? t('app.hr_employee.no_active_company')}{activeEmployment
										? t('app.hr_employee.employee_of', {
												number: activeEmployment.employee_number
											})
										: ''}
								</p>
							</Stack>
							{#if nextPayDate && daysToPayday != null}
								<Stack gap="none" class="text-right">
									<p class="text-xs font-medium text-muted-foreground">
										{t('app.hr_employee.next_payday')}
									</p>
									<p class="text-heading tabular-nums">
										{daysToPayday === 0
											? t('app.hr_employee.today')
											: t('app.hr_employee.days_until', { days: daysToPayday })}
									</p>
									<p class="text-meta">
										{formatCalendarDate(nextPayDate)}
									</p>
								</Stack>
							{/if}
						</Cluster>
						<!-- repository-health:allow UI10 -- 1px hairline gutters via bg-border are not on the gap scale -->
						<Grid class="gap-px bg-border" gap="none" minimum="compact">
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">{t('component.email')}</p>
								<p class="truncate text-sm font-medium">{employeeQuery.current.email}</p>
							</Stack>
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">{t('component.phone')}</p>
								<p class="text-sm font-medium">
									{employeeQuery.current.phone ?? t('app.hr_employee.not_provided')}
								</p>
							</Stack>
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">
									{t('component.nationality')}
								</p>
								<p class="text-sm font-medium">
									{employeeQuery.current.nationality ?? t('app.hr_employee.not_provided')}
								</p>
							</Stack>
						</Grid>
					</section>
				{/if}
			</Stack>
		</Scroll>
	</Bound>
{/snippet}

{#snippet scheduleIntro()}
	<Stack gap="md">
		{@render contextGate()}
		<Stack gap="none">
			<h2 class="text-heading">{t('app.hr_employee.my_schedule_title')}</h2>
			<p class="text-sm text-muted-foreground">{t('app.hr_employee.my_schedule_description')}</p>
		</Stack>
	</Stack>
{/snippet}

<!--
	THE CALENDAR IS THE BODY OF A `Cover`, and that is what stops it running off the screen.

	This tab used to be one `Stack`: heading, then a calendar roughly 700px tall. The tab panel around
	it is `h-full min-h-0 overflow-clip`, so on a 720px viewport the panel measured 552px, the content
	measured 871px, and the difference was not scrolled — it was CLIPPED. The last two weeks of every
	month and the whole legend were unreachable, with no scroll owner anywhere on the ancestor chain.

	`Cover` puts the chrome in an `auto` row and gives its body `minmax(0,1fr)`, which is the definite
	height the calendar's own `Scroll` needs to fill and stop at. The bound comes from the ancestor
	rather than from a `max-h-[100dvh-…]` on the calendar itself, which is the trap this codebase has
	already recorded: a fixed viewport-derived height rides up and clips itself at the page foot.

	`contextGate` inside the chrome has already explained a missing employment, in the words it chose
	for exactly this reason: a reader with no employment row is looking at missing HR data, not at a
	restriction on their access. Nothing further is drawn below, because there is no employment to
	scope a month to and a second empty state would only contradict the first.
-->
{#snippet schedule()}
	<Cover gap="md" top={scheduleIntro}>
		{#if employmentId == null}
			<span></span>
		{:else if scheduleErrors.length > 0}
			<Alert variant="destructive">
				<AlertTitle>{t('app.hr_employee.schedule_failed')}</AlertTitle>
				<AlertDescription>{scheduleErrors.join(' · ')}</AlertDescription>
			</Alert>
		{:else}
			<RosterMonthCalendar
				month={scheduleMonth}
				{employmentId}
				loading={scheduleLoading}
				facts={scheduleFacts}
				{today}
				holidayNames={scheduleHolidayNames}
				entryLocks={scheduleEntryLocks}
				punchWindows={schedulePunchWindows}
				reportableDates={scheduleReportableDates}
				onSelectDay={openDaySheet}
				onReportDay={openReport}
				onMonthChange={selectScheduleMonth}
			/>
		{/if}
	</Cover>
{/snippet}

{#snippet leave()}
	<Cover gap="md" top={contextGate}>
		{#if employmentId != null}
			<section
				class="overflow-hidden rounded-xl border bg-card shadow-sm"
				aria-labelledby="my-leave-balances-heading"
			>
				<Stack class="px-4 py-3 sm:px-5" gap="xs">
					<h3 id="my-leave-balances-heading" class="text-heading">
						{t('app.hr_employee.leave_balances')}
					</h3>
					<p class="max-w-prose text-sm text-muted-foreground">
						{t('app.hr_employee.leave_balances_description', {
							date: formatCalendarDate(today)
						})}
					</p>
				</Stack>
				{#if leaveBalanceRowsResult.error != null}
					<Alert variant="destructive"
						><AlertDescription>{leaveBalanceRowsResult.error}</AlertDescription></Alert
					>
				{:else if leaveBalanceRows.length === 0}
					<p class="border-t px-4 py-3 text-sm text-muted-foreground">
						{t('app.hr_employee.leave_balances_empty')}
					</p>
				{:else}
					{#each leaveBalanceRows as balance (balance.account.id)}
						{@const summary = balance.summary}
						<div class="border-t px-4 py-3 sm:px-5">
							<div
								class="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(20rem,2fr)_7rem] lg:items-center"
							>
								<div class="min-w-0">
									<p class="truncate text-sm font-medium" title={balance.account.leave_name}>
										{balance.account.leave_name}
									</p>
									<p class="text-meta">
										{balance.account.leave_code} · {balance.account.account_kind === 'EVENT'
											? balance.account.event_reference
											: balance.account.leave_year}
									</p>
									{#if balance.account.account_kind !== 'EVENT'}
										<p class="text-meta" data-leave-rule="year-end">
											{describeYearEnd(
												balance.account.settlement,
												balance.account.settlement_source
											)}
										</p>
										<p class="text-meta" data-leave-rule="exit">
											{describeExit(
												balance.account.exit_settlement,
												balance.account.exit_settlement_source
											)}
										</p>
									{/if}
								</div>
								<Stack gap="xs">
									<dl class="grid grid-cols-5 gap-3">
										<div>
											<dt class="text-meta">{t('app.hr_employee.leave_entitlement')}</dt>
											<dd class="text-sm font-medium tabular-nums">
												{formatNumeric(summary.entitlement)}
											</dd>
										</div>
										<div>
											<dt class="text-meta">{t('app.hr_employee.leave_earned')}</dt>
											<dd class="text-sm font-medium tabular-nums">
												{formatNumeric(summary.earned + summary.carried)}
											</dd>
										</div>
										<div>
											<dt class="text-meta">{t('app.hr_employee.leave_taken')}</dt>
											<dd class="text-sm font-medium tabular-nums">
												{formatNumeric(summary.taken)}
											</dd>
										</div>
										<div>
											<dt class="text-meta">{t('app.hr_employee.leave_pending')}</dt>
											<dd class="text-sm font-medium tabular-nums">
												{formatNumeric(summary.pending)}
											</dd>
										</div>
										<div>
											<dt class="text-meta">{t('app.hr_employee.leave_adjustments')}</dt>
											<dd class="text-sm font-medium tabular-nums">
												{formatNumeric(summary.adjusted)}
											</dd>
										</div>
									</dl>
									{#if balance.account.accrual_kind !== 'UNLIMITED'}
										<div
											class="flex h-2 overflow-hidden rounded-sm bg-muted"
											role="meter"
											aria-valuemin={0}
											aria-valuemax={Math.max(summary.earned + summary.carried, 1)}
											aria-valuenow={summary.taken + summary.pending}
											aria-label={`${formatNumeric(summary.taken)} used, ${formatNumeric(summary.pending)} pending`}
										>
											<div
												class="h-full bg-primary"
												style:width={leaveMeterWidth(
													summary.taken,
													summary.earned + summary.carried
												)}
											></div>
											<div
												class="h-full bg-brand"
												style:width={leaveMeterWidth(
													summary.pending,
													summary.earned + summary.carried
												)}
											></div>
										</div>
									{/if}
									{#if summary.carried > 0}
										<p class="text-meta">
											{t('app.hr_employee.leave_carried')}
											{formatNumeric(summary.carried)}
											{#if balance.carryExpiresOn != null}
												· {t('app.hr_employee.leave_carry_use_by', {
													date: formatCalendarDate(balance.carryExpiresOn)
												})}
											{/if}
										</p>
									{/if}
								</Stack>
								<div class="lg:text-right">
									<p class="text-meta">{t('app.hr_employee.leave_available')}</p>
									<p class="text-xl font-semibold tabular-nums text-foreground">
										{balance.account.accrual_kind === 'UNLIMITED'
											? t('component.accrual_unlimited')
											: formatNumeric(summary.available)}
										<span class="text-sm font-normal text-muted-foreground"
											>{t('component.days')}</span
										>
									</p>
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</section>
		{/if}
		<CollectionTable
			{client}
			collection="leave_requests"
			title={t('app.hr_employee.my_leave_title')}
			description={t('app.hr_employee.my_leave_description')}
			disabled={!employmentId}
			recordMetadata={(row) => sourceLockRecordMetadata(leaveRowLock(row), t)}
			query={{
				where: { employment_id: employmentId ? { eq: employmentId } : undefined },
				orderBy: { from_date: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="leave_type_id" label={t('component.leave_type')} />
				<Column
					name="event"
					label={t('component.leave_range')}
					card="title"
					renderer={FormattedValueRenderer}
					rendererProps={{ format: ({ row }) => formatLeaveRange(row.event, t) }}
				/>
				<Column name="days" label={t('component.days')} />
			{/snippet}
		</CollectionTable>
	</Cover>
{/snippet}

{#snippet claims()}
	<Cover gap="md" top={contextGate}>
		<CollectionTable
			{client}
			collection="component_entries"
			view="hr_employee:claims"
			title={t('app.hr_employee.my_components_title')}
			description={t('app.hr_employee.my_components_description')}
			disabled={!employmentId}
			recordMetadata={(row) => sourceLockRecordMetadata(claimRowLock(row), t)}
			query={{
				where: {
					employment_id: employmentId ? { eq: employmentId } : undefined
				},
				orderBy: { event_date: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="pay_component_id" label={t('component.component')} card="title" />
				<Column name="amount" label={t('component.amount')} />
				<Column name="event_date" label={t('component.date')} />
				<Column name="event" card="subtitle" />
			{/snippet}
		</CollectionTable>
	</Cover>
{/snippet}

{#snippet loans()}
	<Cover gap="md" top={contextGate}>
		<CollectionTable
			{client}
			collection="loans"
			view="hr_employee:loans"
			features={{ create: false }}
			title={t('app.hr_employee.my_loans_title')}
			description={t('app.hr_employee.my_loans_description')}
			disabled={!employmentId}
			initialFilters={inForceTodayFilter()}
			query={{
				where: {
					employment_id: employmentId ? { eq: employmentId } : undefined
				},
				orderBy: { effective_from: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="reference" card="title" />
				<Column name="principal" label={t('component.principal')} />
				<Column name="effective_range" />
			{/snippet}
		</CollectionTable>
	</Cover>
{/snippet}

{#snippet payslips()}
	<Cover gap="md" top={contextGate}>
		<CollectionTable
			{client}
			collection="payslips"
			features={{ create: false }}
			title={t('app.hr_employee.my_payslips_title')}
			description={t('app.hr_employee.my_payslips_description')}
			disabled={!employmentId}
			query={{
				where: { employment_id: employmentId ? { eq: employmentId } : undefined },
				orderBy: { created_at: 'desc' },
				with: { payslip_payroll_run: { columns: { period: true } } }
			}}
		>
			{#snippet columns({ Column })}
				<Column
					name="payroll_run_id"
					label={t('app.hr_employee.pay_run')}
					renderer={FormattedValueRenderer}
					rendererProps={{ format: ({ row }) => payrollRunPeriod(row) }}
				/>
				<Column name="gross" label={t('component.gross')} />
				<Column name="total_deductions" label={t('component.deductions')} />
				<Column name="net" label={t('component.net')} />
				<Column name="currency" />
			{/snippet}
			{#snippet ListCard(payslip)}
				<Stack gap="xs">
					<p class="truncate font-medium">{payrollRunPeriod(payslip)}</p>
					<p class="text-sm text-muted-foreground">
						{payslip.currency}
						{formatNumeric(payslip.net)}
					</p>
				</Stack>
			{/snippet}
		</CollectionTable>
	</Cover>
{/snippet}

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'home',
				label: t('app.hr_employee.tab_home'),
				icon: 'lucide:user-round',
				content: home
			},
			{
				name: 'schedule',
				label: t('app.hr_employee.tab_schedule'),
				icon: 'lucide:calendar-clock',
				content: schedule
			},
			{
				name: 'leave',
				label: t('app.hr_employee.tab_leave'),
				icon: 'lucide:calendar-check',
				content: leave
			},
			{
				name: 'claims',
				label: t('app.hr_employee.tab_claims'),
				icon: 'lucide:receipt',
				content: claims
			},
			{
				name: 'loans',
				label: t('app.hr_employee.tab_loans'),
				icon: 'lucide:hand-coins',
				content: loans
			},
			{
				name: 'payslips',
				label: t('app.hr_employee.tab_payslips'),
				icon: 'lucide:badge-dollar-sign',
				content: payslips
			}
		] satisfies TabConfig[]}
	/>
</Cover>

<!--
 	The day detail, shared with the controller's board and told which audience it has.

 	`mode="employee"` is the whole difference: the roster-code picker and the interval editor are the
 		controller's affordances and an employee has neither grant behind them — `mutate.new` and
 		`mutate.existing` on `work_days` are scoped to their own employment and masked to the clock fields,
 		with no delete.
 		The sheet carries its own person-day write; the tile's report chip opens the preview
 		dialog below, which writes the same row shape.
 -->
<DaySheet
	bind:open={daySheetOpen}
	mode="employee"
	person={daySheetPerson}
	date={daySheetDate}
	day={daySheetDay}
	intervals={daySheetIntervals}
	lockRung={daySheetRung}
	lockReason={daySheetLockReason}
/>

<Dialog.Root bind:open={report.open}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t('app.hr_employee.report_punch_title')}</Dialog.Title>
			<Dialog.Description>
				{t('app.hr_employee.report_punch_description', {
					date: formatCalendarDate(report.date)
				})}
			</Dialog.Description>
		</Dialog.Header>
		{#key report.date}
			<CollectionForm
				{client}
				collection="work_days"
				defaultValues={reportDefaults}
				submitLabel={t('app.hr_employee.report_punch_submit')}
				semantic={reportSemantic}
				onAfterSubmit={() => {
					report.open = false;
					daySheetOpen = false;
				}}
			>
				{#snippet children({ Field, form })}
					<Field name="employment_id" hidden />
					<Field name="work_date" hidden />
					<Field name="shift_definition_id" hidden />
					<Field name="assignment_code" hidden />
					<Field name="planned_origin" hidden />
					<Field name="planned_note" hidden />
					<Field name="worked_intervals" hidden />
					<Field name="break_minutes" hidden />
					<Stack gap="sm">
						<Inline gap="sm" align="end">
							<label class="flex-1 text-sm font-medium">
								<Stack gap="xs">
									{t('app.hr_employee.report_punch_start')}
									<Input
										type="time"
										value={report.startClock}
										disabled={client.db.work_days.pending > 0}
										oninput={(event) => {
											report.startClock = event.currentTarget.value;
											presetReport(form);
										}}
									/>
								</Stack>
							</label>
							<label class="flex-1 text-sm font-medium">
								<Stack gap="xs">
									{t('app.hr_employee.report_punch_end')}
									<Input
										type="time"
										value={report.endClock}
										disabled={client.db.work_days.pending > 0}
										oninput={(event) => {
											report.endClock = event.currentTarget.value;
											presetReport(form);
										}}
									/>
								</Stack>
							</label>
						</Inline>

						<!--
 							What will actually be recorded, spelled out before the submit rather than after the
 							refusal. The break line is the one that earns this panel: it is clamped to fit the
 							reported interval, and a clamp that happened silently would leave somebody wondering why
 							a twenty-minute call-in was paid as nothing.
 						-->
						{#if reportDraft != null}
							<Stack gap="none" class="rounded-md border bg-muted/20 p-3 text-sm">
								<p class="font-medium">{t('app.hr_employee.report_punch_preview')}</p>
								<p>
									{t('app.hr_employee.report_punch_preview_worked', {
										hours: formatDurationHours(reportDraft.assessment.workedMinutes ?? 0, t)
									})}
								</p>
								<p>
									{t('app.hr_employee.report_punch_preview_break', {
										minutes: reportDraft.assessment.breakMinutes
									})}
								</p>
								{#if reportDraft.crossesMidnight}
									<p class="text-muted-foreground">
										{t('app.hr_employee.report_punch_crosses_midnight')}
									</p>
								{/if}
								{#if reportDraft.assessment.breakClamped}
									<p class="text-warning-foreground">
										{reportDraft.assessment.breakMinutes === 0
											? t('app.hr_employee.report_punch_break_zeroed', {
													scheduled: reportDraft.requestedBreak
												})
											: t('app.hr_employee.report_punch_break_clamped', {
													scheduled: reportDraft.requestedBreak,
													recorded: reportDraft.assessment.breakMinutes
												})}
									</p>
								{/if}
							</Stack>
						{/if}

						{#if reportProblem != null}
							<p class="text-sm text-destructive">{reportProblem}</p>
						{/if}
						<p class="text-meta">{t('app.hr_employee.report_punch_approval_note')}</p>
						<!--
 							The submit stays disabled on the preview's own refusal, with the sentence
 							beside it. The draft is pushed on every keystroke, so this native submit
 							carries current values; the preset is belt-and-braces for the same reason.
 							The framework footer below offers the same submit as framework chrome, and
 							the semantic gate refuses it there with the same sentence.
 						-->
						<Button
							type="submit"
							disabled={reportProblem != null}
							onclick={() => {
								presetReport(form);
							}}
						>
							{t('app.hr_employee.report_punch_submit')}
						</Button>
					</Stack>
				{/snippet}
			</CollectionForm>
		{/key}
		<Dialog.Footer>
			<Dialog.Close>{t('roster.cancel')}</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
