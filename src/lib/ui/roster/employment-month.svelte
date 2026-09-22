<!--
	One employment's month, as one derivation over every source that has an opinion about it.

	This is the assembly Employee Self-Service used to carry inline. It was extracted whole — every
	query, `buildRosterMonth`, the record-axis lock rail, the punch windows and the reportable set —
	because the employee's own app and the employee record's Work tab must draw the *same* month from
	the same facts. Two assemblies would be two answers to "was I rostered on the 5th", which is the
	failure mode `roster-month.ts` and the calendar's header note both exist to remove.

	── THE TWO CONSUMERS ───────────────────────────────────────────────────────────────────────────
	`+hr_employee.svelte` hands `employmentId` (the reader's active contract) and `selfService`, and
	keeps its intro chrome and report-missing-punch dialog here: an employee's own month is the one
	surface where a punch can be reported, so the actions live with the facts. A day with a stored
	row opens the collection's own record sheet, which is the same surface the controller's board
	opens; only the create case is local to this template.

	The employee record's Work tab hands `employmentId` (the contract in force today) and nothing
	else. Without `selfService` the calendar is read-only: no stretched day button, no report chip.
	The framework's record scope is deliberately not read here — the mounting surface already knows
	the person and resolves the contract, which keeps this component a component rather than a
	second resolver.

	── WHAT THE CALLER STILL OWNS ──────────────────────────────────────────────────────────────────
	The bounded height. `RosterMonthCalendar` is a `Cover` whose body is the scrollport, so it needs
	a definite ancestor; both callers give it one, and the layout note in `+hr_employee.svelte`
	records why a fixed viewport-derived height is not the way to do that.
-->
<script lang="ts">
	import { isSettledId } from '../../iso-day.js';
	import { resolveEmployment } from '../../employment-contract.js';
	import { settingsInForce } from '../../jurisdiction_settings.js';
	import { PATTERN_WITH } from '../../scheduling/work-pattern.js';
	import { HOLIDAY_QUERY_LIMIT, holidayView } from '../holiday-calendar.js';
	import { onLineage } from '../settings-scope.js';
	import { client } from '../../workspace-client.js';
	import { Effect, Number as EffectNumber } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import {
		CollectionForm,
		type CollectionFormController,
		type CollectionFormSemantic
	} from '@norbital-ai/ui/collection-form';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		createCollectionRouteKey,
		getCollectionNavigationContext
	} from '@norbital-ai/ui/collection-navigation';
	import RosterMonthCalendar from './roster-month-calendar.svelte';
	import { employeeMissingPunchReportable } from './employee-reportability.js';
	import { formatCalendarDate, formatDurationHours } from '../display-formatters.js';
	import {
		PAYROLL_TIME_ZONE,
		monthWorkDateInstantBounds,
		shiftMonthKey,
		todayKey,
		workDateCalendarKey
	} from '../calendar.js';
	import { formatDateISO } from '@norbital-ai/std/date';
	import { decodeNumber } from '@norbital-ai/std/json';
	import {
		ATTENDANCE_DRAFT_PROBLEM_KEY,
		DAY_MINUTES,
		assessAttendanceDraft,
		buildRosterMonth,
		clockToDayMinutes,
		dayMinutesToClock,
		holidaysByDate,
		instantFromDayStart,
		minutesFromDayStart,
		monthDays,
		type DayFacts,
		type IntervalDraft
	} from './roster-month.js';
	import { attendanceBoundary } from '../../attendance.js';
	import { sourceLock, type DayLock, type SourceLock } from '../../scheduling/lock.js';

	/** Every catalogue read on these surfaces skips rows still held under an approval request. */
	const approved = { approval_id: { isNull: true } } as const;

	/**
	 * NO `payroll_runs` QUERY LIVES HERE, AND NONE MAY BE ADDED.
	 *
	 * An employee has no `read` grant on `payroll_runs` — see `src/access/policies/+employee.ts` —
	 * and that is the owner's ruling, not an oversight: only the HR controller, the HR manager and
	 * the L1 manager see the runs. Employee Self-Service used to ask anyway and build
	 * `payrollWindows` from the result. The result was always empty, and an empty window list is
	 * indistinguishable from "this company has never run payroll", so every window-derived lock on
	 * that screen quietly answered `NONE` while looking like a working lock. A lock that can never
	 * engage is worse than no lock: it reads as "nothing is holding this day" to the one person who
	 * most needs to be told otherwise.
	 *
	 * So the window axis is gone from this surface entirely, and every `sourceLock` call below
	 * passes `windows: []` as a stated fact rather than as an accident of an unreadable query. What
	 * an employee can honestly know about a lock is exactly two things, and both are readable:
	 *
	 *   - PENDING  — `approval_id` on their own row. The platform's own stamp.
	 *   - CONSUMED — the row's own `payslip_id`, naming the payslip that took the record. Granted by
	 *                `settlementLedgerGrants()`, exact, stored, per-record. It is strictly better
	 *                than the window inference it replaces: the window guessed from a date, this
	 *                names the period.
	 *
	 * The day-axis rungs the board draws — "in a draft run", "paid" — are not computable here and
	 * are not drawn; see the ladder note in `roster-month-calendar.svelte`.
	 *
	 * The record's read-only use of this component is HR reading the same record axis; the ruling
	 * above is about the surface's grants, and HR sees no more here than the employee does.
	 */
	/** No window means no day lock on this surface: it is stated once instead of mapped over the month. */
	const NO_DAY_LOCKS: ReadonlyMap<string, DayLock> = new Map();

	const { t } = useI18n<TenantI18nKeys>();

	let {
		employmentId,
		selfService = false
	}: {
		/** The contract the month is drawn for. Null or undefined draws nothing: there is no month to scope. */
		employmentId: string | null | undefined;
		/** Offer the day record sheet and the report-missing-punch flow (Employee Self-Service only). */
		selfService?: boolean;
	} = $props();

	const today = todayKey();

	/* ──────────────────────────────────────────────────────────────────────────────────────────────
	 * THE CONTRACT THE MONTH IS DRAWN FOR
	 *
	 * Read here rather than handed over whole, so both callers name the same thing — an employment
	 * id — and this component resolves the entity's own calendar settings and pay cut-off from the
	 * one row. A by-id read is scoped by the reader's own policy: the employee sees their contract,
	 * HR sees the one they opened.
	 * ────────────────────────────────────────────────────────────────────────────────────────────── */
	const employmentQuery = $derived(
		employmentId == null
			? null
			: client.db.employments.findFirst({
					where: { ...approved, id: { eq: employmentId } }
				})
	);
	const activeEmployment = $derived(
		employmentQuery?.current == null ? null : resolveEmployment(employmentQuery.current)
	);
	const companyQuery = $derived(
		activeEmployment == null
			? null
			: client.db.companies.findFirst({
					where: { id: { eq: activeEmployment.company_id } }
				})
	);

	/* ──────────────────────────────────────────────────────────────────────────────────────────────
	 * THE MONTH
	 *
	 * The controller's board and this calendar are one derived fact table drawn at two densities.
	 * Every query below is the board's query with `company_id` swapped for `employment_id`, which is
	 * why they are roughly 1/300th of its size and why none of them needed a policy change: the
	 * `employee` policy already scopes `work_days`, `leave_entries` and
	 * `employment_terms` to the reader's own employments, and `employeeReferenceGrants` already hands
	 * them the company-wide calendars — holidays and shift definitions — that a personal
	 * schedule is meaningless without.
	 *
	 * ONE THING IS DELIBERATELY ABSENT, and it is a ruling rather than a gap: `payroll_runs` is not
	 * readable by an employee, so this calendar has no day axis at all. It draws the record axis —
	 * pending, and consumed-by-payslip from the row's own `payslip_id` — and nothing else. See the note above
	 * `NO_DAY_LOCKS`, and the ladder note in `roster-month-calendar.svelte` for why a rung that
	 * could never light was removed instead of being left dark.
	 * ────────────────────────────────────────────────────────────────────────────────────────────── */

	let scheduleMonth = $state(todayKey().slice(0, 7));
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
	 * the most important state on this screen.
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
			: client.db.leave_entries.findMany({
					where: {
						...approved,
						employment_id: { eq: employmentId },
						// Time off is the activity whose charges are its dated days.
						charges: { ne: [] },
						leave_original_reversals: { none: { approval_id: { isNull: true } } },
						from_date: { lte: scheduleWorkDateBounds.end },
						to_date: { gte: scheduleWorkDateBounds.start }
					},
					with: { leave_entry_leave_catalogue: { columns: { code: true } } },
					limit: 200
				})
	);
	const schedulePendingLeaveQuery = $derived(
		employmentId == null
			? null
			: client.db.leave_entries.findMany({
					where: {
						approval_id: { isNotNull: true },
						employment_id: { eq: employmentId },
						charges: { ne: [] },
						leave_original_reversals: { none: { approval_id: { isNull: true } } },
						from_date: { lte: scheduleWorkDateBounds.end },
						to_date: { gte: scheduleWorkDateBounds.start }
					},
					with: { leave_entry_leave_catalogue: { columns: { code: true } } },
					limit: 200
				})
	);
	/** The leave codes the calendar labels, carried by the request rows themselves. */
	type LabelledRequest = WorkspaceRow<'leave_entries'> & {
		readonly leave_entry_leave_catalogue?: Pick<WorkspaceRow<'leave_catalogue'>, 'code'> | null;
	};
	const leaveCodeById = $derived(
		new Map(
			[
				...((scheduleLeaveQuery?.current ?? []) as LabelledRequest[]),
				...((schedulePendingLeaveQuery?.current ?? []) as LabelledRequest[])
			].flatMap((request) =>
				request.leave_entry_leave_catalogue == null
					? []
					: [[request.catalogue_id, request.leave_entry_leave_catalogue.code] as const]
			)
		)
	);
	const activeSettingsCode = $derived(companyQuery?.current?.settings_code ?? null);
	const scheduleCalendarSettingsQuery = $derived(
		activeSettingsCode == null
			? null
			: client.db.jurisdiction_settings.findMany({
					where: onLineage(activeSettingsCode),
					limit: HOLIDAY_QUERY_LIMIT
				})
	);
	// The calendar is the employing entity's, which the active employment already names — not the
	// settings lineage's, which cannot tell two entities of one country apart.
	const scheduleCalendarCompanyId = $derived(activeEmployment?.company_id ?? null);
	const scheduleHolidaysQuery = $derived(
		scheduleCalendarCompanyId == null
			? null
			: client.db.jurisdiction_holidays.findMany({
					where: {
						...approved,
						company_id: { eq: scheduleCalendarCompanyId },
						date: { gte: scheduleWorkDateBounds.start, lte: scheduleWorkDateBounds.end },
						published_at: { isNotNull: true }
					},
					limit: HOLIDAY_QUERY_LIMIT
				})
	);
	const scheduleCalendarResolution = $derived(
		holidayView({
			settingsCount: scheduleCalendarSettingsQuery?.current?.length,
			jurisdiction: scheduleCalendarCompanyId,
			rows: scheduleHolidaysQuery?.current,
			start: scheduleMonthStart,
			end: scheduleMonthEnd,
			noJurisdiction: t('holiday_calendar.no_jurisdiction'),
			truncated: t('holiday_calendar.truncated')
		})
	);

	const scheduleShiftsQuery = $derived(
		scheduleCalendarCompanyId == null
			? null
			: client.db.shift_definitions.findMany({
					where: { ...approved, company_id: { eq: scheduleCalendarCompanyId } },
					limit: 500
				})
	);
	const scheduleTermsQuery = $derived(
		employmentId == null
			? null
			: client.db.employment_terms.findMany({
					where: { ...approved, employment_id: { eq: employmentId } },
					// The base rides the terms read: the named pattern, through the row, no second query.
					with: { term_shift_pattern: PATTERN_WITH },
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
			// A pending submission's clock is masked, not deleted: NULL is the honest "no attendance
			// visible" value.
			row.approval_id == null ? { ...row } : { ...row, worked_intervals: null }
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
		const ids = scheduleWorkDays.map((row) => row.id).filter(isSettledId);
		if (ids.length === 0) return null;
		return client.db.work_days.findMany({
			where: { id: { in: ids }, payslip_id: { isNull: false } },
			columns: { id: true, payslip_id: true },
			limit: 200
		});
	});
	const settlementByWorkDayId = $derived(
		new Map((scheduleSettlementsQuery?.current ?? []).map((row) => [row.id, { period: '' }]))
	);

	const scheduleHolidays = $derived(scheduleCalendarResolution.holidays);
	const scheduleHolidayNames = $derived(holidaysByDate(scheduleHolidays));
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
		const cutoffDay = companyQuery?.current?.pay_cutoff_day;
		if (cutoffDay == null) return null;
		const day = String(
			EffectNumber.clamp({ minimum: 1, maximum: 28 })(decodeNumber(cutoffDay))
		).padStart(2, '0');
		return {
			start: `${shiftMonthKey(scheduleMonth, -1)}-${day}`,
			end: formatDateISO(new Date(Date.parse(`${scheduleMonth}-${day}T00:00:00.000Z`) - 86_400_000))
		};
	});

	/** The employing entity's clock: the version in force's payroll timezone, else the default. */
	const scheduleTimeZone = $derived.by(() => {
		if (activeSettingsCode == null) return PAYROLL_TIME_ZONE;
		try {
			return (
				settingsInForce(
					scheduleCalendarSettingsQuery?.current ?? [],
					activeSettingsCode,
					scheduleMonthStart
				)?.payroll.timezone ?? PAYROLL_TIME_ZONE
			);
		} catch {
			return PAYROLL_TIME_ZONE;
		}
	});
	const scheduleFacts = $derived(
		buildRosterMonth({
			month: scheduleMonth,
			timeZone: scheduleTimeZone,
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

	/**
	 * What holds one attendance record — and, deliberately, nothing about what day it falls on.
	 *
	 * This is the §2.2/§8.4 correction, and it is the same call `work_days/+collection.ts` makes on
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
						: dayMinutesToClock(minutesFromDayStart(first, date, scheduleTimeZone)),
				last:
					last == null ? null : dayMinutesToClock(minutesFromDayStart(last, date, scheduleTimeZone))
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
	 *                           still reportable, because the transform only refuses full coverage
	 *
	 * A roster-only person-day is deliberately NOT a blocker. The employee `mutate.existing` grant is
	 * scoped to their own employment and masked to `worked_intervals`, so a report
	 * changes the clock on that row while leaving the plan intact. A day with no row uses `mutate.new`.
	 *
	 * ONE REFUSAL IS DELIBERATELY NOT PRE-CHECKED HERE, AND MUST NOT BE ADDED.
	 *
	 * `assertNotSettled` in `work_days/+collection.ts` refuses a punch reported on a day a
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
		{ label: t('component.employment'), query: employmentQuery },
		{ label: t('component.company'), query: companyQuery },
		{ label: t('app.hr_employee.source_person_days'), query: scheduleWorkDaysQuery },
		{ label: t('app.hr_employee.source_leave'), query: scheduleLeaveQuery },
		{ label: t('holiday_calendar.jurisdiction'), query: scheduleCalendarSettingsQuery },
		{ label: t('app.hr_employee.source_holidays'), query: scheduleHolidaysQuery },
		{ label: t('app.hr_employee.source_shifts'), query: scheduleShiftsQuery },
		{ label: t('app.hr_employee.source_terms'), query: scheduleTermsQuery }
	]);
	/**
	 * Named sources rather than an OR of `loading` flags, for the reason the board records: a gate
	 * that only knows "loading" has no terminal state, so a query that errors leaves the surface on a
	 * skeleton forever with nothing on screen saying why.
	 */
	const scheduleErrors = $derived([
		...(scheduleCalendarResolution.error == null ? [] : [scheduleCalendarResolution.error]),
		...scheduleSources.flatMap((source) =>
			source.query?.error ? [`${source.label}: ${source.query.error.message}`] : []
		)
	]);
	const scheduleLoading = $derived(
		scheduleErrors.length === 0 &&
			scheduleSources.some((source) => source.query != null && source.query.current === undefined)
	);

	/* ── The day detail, and the one write this surface offers ─────────────────────────────────── */

	/** The frame this surface opens records in, so its sheet reads through this surface's client. */
	const scheduleRouteKey = createCollectionRouteKey({ view: 'schedule' });
	/**
	 * Captured at initialisation, like every context read. A click handler runs long after the
	 * component mounted, and `getContext` outside initialisation throws rather than answering.
	 */
	const detailNavigation = getCollectionNavigationContext();

	/**
	 * A day with a stored row opens the workspace's own record sidesheet for it — the same surface
	 * every collection table opens, rendering `work_days/+representation.svelte` and carrying the
	 * lock seal in its header. A day with no row has nothing to open: the report chip beside it is
	 * the one write an employee has there, and it creates the row through its own dialog.
	 */
	function openDaySheet(_employmentId: string, date: string): void {
		const stored = scheduleFactWorkDays.find((row) => workDateCalendarKey(row.work_date) === date);
		const recordId = stored?.id;
		if (recordId == null || !isSettledId(recordId)) return;
		detailNavigation?.open({
			collectionName: 'work_days',
			recordId,
			routeKey: scheduleRouteKey
		});
	}

	/**
	 * The report dialog's write: a day with no row is created through the same transform every
	 * other attendance write crosses. It is immediately held under `approval_id`, which the
	 * platform's mutation boundary presents rather than letting this component invent a second
	 * result state.
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
	 * What a report would actually write, assessed by the same function the day record's interval
	 * editor uses and against the same rules `work_days/+collection.ts` enforces. The break is
	 * derived from the punches against the shift's granted break, and the preview states it so a
	 * short call-in is not a surprise on the payslip.
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
				start: instantFromDayStart(date, start, scheduleTimeZone),
				end: instantFromDayStart(date, crossesMidnight ? end + DAY_MINUTES : end, scheduleTimeZone)
			}
		];
		return {
			date,
			intervals,
			crossesMidnight,
			assessment: assessAttendanceDraft(intervals, scheduleDay(date)?.shiftBreakMinutes)
		};
	});
	const reportProblem = $derived.by(() => {
		if (reportDraft == null) return t('app.hr_employee.report_punch_needs_times');
		const problem = reportDraft.assessment.problem;
		return problem == null ? null : t(ATTENDANCE_DRAFT_PROBLEM_KEY[problem]);
	});

	/**
	 * Update the stored row when one exists, create it when none does. Minimal like the day
	 * sheet's: only the routing is seeded, and the draft is pushed via `setValues` as the clocks
	 * are typed, so an untouched dialog cannot submit anything.
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

	/** Mirror the draft into the form; the time inputs are custom composition. */
	function presetReport(form: CollectionFormController): void {
		const draft = reportDraft;
		if (draft == null || employmentId == null) return;
		form.setValues({
			employment_id: employmentId,
			work_date: draft.date,
			worked_intervals: draft.intervals.map((interval) => ({
				start: interval.start,
				end: interval.end
			}))
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
				report.date == null ? null : scheduleDay(report.date)?.shiftBreakMinutes
			).problem;
			if (problem != null) return [{ message: t(ATTENDANCE_DRAFT_PROBLEM_KEY[problem]) }];
			return;
		});
</script>

{#if employmentId != null}
	{#if scheduleErrors.length > 0}
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
			onSelectDay={selfService ? openDaySheet : undefined}
			onReportDay={selfService ? openReport : undefined}
			onMonthChange={selectScheduleMonth}
		/>
	{/if}
{/if}

{#if selfService}
	<!--
		The report chip's dialog. The day detail itself is the workspace's record sidesheet — the same
		surface the controller's board opens, rendering the collection's own representation — so there
		is nothing to mount here for it. This dialog is the one write a day with no row has: it creates
		the person-day and holds it for review through the same transform every other attendance write
		crosses.
	-->
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
					}}
				>
					{#snippet children({ Field, form })}
						<Field name="employment_id" hidden />
						<Field name="work_date" hidden />
						<Field name="shift_definition_id" hidden />
						<Field name="worked_intervals" hidden />
						<Stack gap="sm">
							<Inline gap="sm" align="end">
								<label class="flex-1 text-sm font-medium">
									<Stack gap="xs">
										{t('app.hr_employee.report_punch_start')}
										<Input
											type="time"
											value={report.startClock}
											disabled={client.collection.work_days.pending > 0}
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
											disabled={client.collection.work_days.pending > 0}
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
								refusal. The break line is the one that earns this panel: it is derived from the
								reported interval, and a break nobody could see would leave somebody wondering why
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
		</Dialog.Content>
	</Dialog.Root>
{/if}
