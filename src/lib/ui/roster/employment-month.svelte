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
	import Labelled from '../components/Labelled.svelte';
	import { t } from '../i18n/t.js';
	import { everyField } from '../../every-field.js';
	import { isSettledId, dateKey } from '../../payroll_engine/foundation/time.js';
	import { resolveEmployment } from '../../employment-contract.js';
	import { settingsInForce } from '../../jurisdiction_settings.js';
	import { patternAnchor, termPatternRow } from '../../scheduling/work-pattern.js';
	import { observedHolidays } from '../../scheduling/work-limits.js';
	import { coversDate } from '../../../lib/payroll/run/effective.js';
	import { Number as EffectNumber } from 'effect';
	import { bolt } from '$bolt';
	import { Alert, Button, Dialog, TimeRangeInput, type TimeRange } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { openRecord } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { live, liveRows } from '../state/live.svelte.js';
	import { captureClaims } from './capture-claims.js';
	import { monthSources } from './month-sources.svelte.js';
	import RosterMonthCalendar from './roster-month-calendar.svelte';
	import { employeeMissingPunchReportable } from './employee-reportability.js';
	import { formatCalendarDate, formatDurationHours } from '../format/display-formatters.js';
	import { todayKey } from '../format/calendar.js';
	import { addDays, monthBounds, shiftPeriod } from '../../../lib/payroll/run/dates.js';
	import { decodeNumber } from '../../payroll_engine/foundation/primitives.js';
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

	/**
	 * This calendar uses individual source captures, without a run-wide paid window. The employee's
	 * payroll-run grant exposes period and attendance bounds, not payment state. `sourceLock` gets
	 * `windows: []`; the record axis is PENDING or an individually paid, funded or allocated capture.
	 */
	/** No window means no day lock on this surface: it is stated once instead of mapped over the month. */
	const NO_DAY_LOCKS: ReadonlyMap<string, DayLock> = new Map();

	let {
		employmentId,
		selfService = false
	}: {
		/** The contract the month is drawn for. Null or undefined draws nothing: there is no month to scope. */
		employmentId: Id<'employments'> | null | undefined;
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
	const employmentQuery = live(() =>
		employmentId == null ? null : bolt.get('employments', employmentId, everyField('employments'))
	);
	const activeEmployment = $derived(
		employmentQuery.current == null || employmentQuery.current.approval_id != null
			? null
			: resolveEmployment(employmentQuery.current)
	);
	const companyQuery = live(() =>
		activeEmployment == null
			? null
			: bolt.get('companies', activeEmployment.company_id, everyField('companies'))
	);

	/*
	 * The month: the controller board's queries with `company_id` swapped for `employment_id`, scoped
	 * by the employee policy. `NO_DAY_LOCKS` leaves this calendar's record axis pending or protected
	 * by an individual capture, independent of another person's payment.
	 */

	let scheduleMonth = $state(todayKey().slice(0, 7));
	const scheduleMonthStart = $derived(PlainDate(`${scheduleMonth}-01`));
	const scheduleMonthEnd = $derived(PlainDate(monthBounds(scheduleMonth).end));

	function selectScheduleMonth(nextMonth: string): void {
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth)) return;
		scheduleMonth = nextMonth;
	}

	const activeSettingsCode = $derived(companyQuery.current?.settings_code ?? null);
	// The calendar is the employing entity's, which the active employment already names.
	const scheduleCalendarCompanyId = $derived(activeEmployment?.company_id ?? null);
	/**
	 * The board's reads, scoped to this one contract. Person-days held under an approval are read too: a punch the reader
	 * reported themselves carries `approval_id` until a manager settles it, and hiding it would hide the employee's own
	 * submission from the employee, which is the most important state on this screen. The plan and the punch are one row;
	 * what the split used to do is done by `scheduleFactWorkDays` below, on the CLOCK rather than on the row.
	 */
	const reads = monthSources({
		companyId: () => scheduleCalendarCompanyId,
		settingsCode: () => activeSettingsCode,
		employmentIds: () => (employmentId == null ? [] : [employmentId]),
		start: () => scheduleMonthStart,
		end: () => scheduleMonthEnd,
		rosterPeriods: () => [
			shiftPeriod(scheduleMonth, -1),
			scheduleMonth,
			shiftPeriod(scheduleMonth, 1)
		],
		held: true
	});
	const leaveCodeById = $derived(reads.leaveCodeById);

	const scheduleWorkDays = $derived(reads.workDays.current ?? []);
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
			scheduleWorkDays.filter((row) => row.approval_id != null).map((row) => dateKey(row.work_date))
		)
	);

	const captureSlipIds = $derived([
		...new Set(scheduleWorkDays.flatMap((day) => (day.payslip_id == null ? [] : [day.payslip_id])))
	]);
	const captureSlips = liveRows(() =>
		captureSlipIds.length === 0
			? null
			: bolt.read('payslips', {
					where: { id: { in: captureSlipIds } },
					select: {
						paid_at: true,
						funding_received: true,
						funding_received_on: true,
						funding_reference: true
					},
					all: true
				})
	);
	const captureTranches = liveRows(() =>
		captureSlipIds.length === 0
			? null
			: bolt.read('payable_tranches', {
					where: { settlement: { payslips: { in: captureSlipIds } } },
					select: { settlement: true },
					all: true
				})
	);
	const captureTrancheIds = $derived((captureTranches.current ?? []).map((row) => row.id));
	const captureAllocations = liveRows(() =>
		captureTrancheIds.length === 0
			? null
			: bolt.read('payment_allocations', {
					where: { payable_tranche_id: { in: captureTrancheIds } },
					select: { payable_tranche_id: true },
					all: true
				})
	);
	const captureReady = $derived(
		captureSlipIds.length === 0 ||
			(captureSlips.current !== undefined &&
				captureSlips.current.length === captureSlipIds.length &&
				!captureSlips.loading &&
				captureSlips.error == null &&
				captureTranches.current !== undefined &&
				!captureTranches.loading &&
				captureTranches.error == null &&
				(captureTrancheIds.length === 0 ||
					(captureAllocations.current !== undefined &&
						!captureAllocations.loading &&
						captureAllocations.error == null)))
	);
	const allocatedSlipIds = $derived.by(() => {
		const allocated = new Set(
			(captureAllocations.current ?? []).map((row) => row.payable_tranche_id)
		);
		return new Set(
			(captureTranches.current ?? [])
				.filter((row) => allocated.has(row.id))
				.map((row) => String(row.settlement.id))
		);
	});
	const settlementByWorkDayId = $derived(
		captureReady
			? captureClaims(scheduleWorkDays, captureSlips.current ?? [], allocatedSlipIds)
			: new Map(
					scheduleWorkDays
						.filter((day) => day.payslip_id != null)
						.map((day) => [day.id, { period: '' }])
				)
	);

	const scheduleHolidays = $derived(reads.calendar.holidays);
	const scheduleHolidayNames = $derived(holidaysByDate(scheduleHolidays));

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
		const cutoffDay = companyQuery.current?.pay_cutoff_day;
		if (cutoffDay == null) return null;
		const day = String(
			EffectNumber.clamp({ minimum: 1, maximum: 28 })(decodeNumber(cutoffDay))
		).padStart(2, '0');
		return {
			start: `${shiftPeriod(scheduleMonth, -1)}-${day}`,
			end: addDays(`${scheduleMonth}-${day}`, -1)
		};
	});

	/**
	 * The person's observed holidays, as payroll resolves them (`observedHolidays`): a SUBSTITUTE
	 * carry lands on their next working day and a rest-day precedence keeps the rest day. Read only
	 * where the viewer can read the plan it rests on — the rosters of record; a viewer who cannot
	 * (self-service masks the plan) keeps the calendar overlay rather than a half-resolved answer.
	 */
	const scheduleObservedHolidays = $derived.by(() => {
		const company = companyQuery.current;
		if (
			employmentId == null ||
			company == null ||
			activeSettingsCode == null ||
			reads.rosters.error != null ||
			reads.rosters.current === undefined
		)
			return undefined;
		try {
			const terms = reads.terms;
			const observed = observedHolidays({
				dates: monthDays(scheduleMonth),
				cutoffDay: decodeNumber(company.pay_cutoff_day ?? 1),
				companyId: company.id,
				holidays: reads.holidays.current ?? [],
				codes: reads.shifts.current ?? [],
				work: settingsInForce(reads.settings.current ?? [], activeSettingsCode, scheduleMonthStart)
					?.work_rules,
				plans: scheduleWorkDays.map((day) => ({
					work_date: dateKey(day.work_date),
					shift_definition_id: day.shift_definition_id ?? null
				})),
				rosterPeriods: reads.rosters.current.map((row) => row.period),
				patternOn: (date) => {
					const term = terms.find((row) => coversDate(row.effective_range, date));
					const row = term == null ? null : termPatternRow(term);
					return row == null ? null : { pattern: row.pattern, anchor: patternAnchor(row) };
				},
				worksiteOn: (date) => terms.find((row) => coversDate(row.effective_range, date))?.worksite
			});
			return new Map([[employmentId, observed]]);
		} catch {
			return undefined;
		}
	});
	const scheduleFacts = $derived(
		buildRosterMonth({
			month: scheduleMonth,
			timeZone: reads.timeZone,
			employments: activeEmployment == null ? [] : [activeEmployment],
			employmentTerms: reads.terms,
			workDays: scheduleFactWorkDays,
			leaveRequests: (reads.leave.current ?? []).filter((row) => row.approval_id == null),
			pendingLeaveRequests: (reads.leave.current ?? []).filter((row) => row.approval_id != null),
			holidays: scheduleHolidays,
			rosterCodesById: reads.shiftsById,
			leaveCodeById,
			cutoff: scheduleCutoff,
			locks: NO_DAY_LOCKS,
			today,
			...(scheduleObservedHolidays == null ? {} : { observedHolidays: scheduleObservedHolidays })
		})
	);

	function scheduleDay(date: string): DayFacts | null {
		if (employmentId == null) return null;
		return scheduleFacts.get(`${employmentId}:${date}`) ?? null;
	}

	/**
	 * What holds one attendance record, never its date — the same call the `work_days` write path makes
	 * (§2.2/§8.4): `datePassed: 'IS_NOT_A_LOCK'` and `dates: []`, leaving the settlement claim and
	 * PENDING_APPROVAL ("waiting on your manager").
	 */
	function attendanceRowLock(row: (typeof scheduleWorkDays)[number]): SourceLock {
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
			scheduleWorkDays.map((row) => [dateKey(row.work_date), attendanceRowLock(row)] as const)
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
			const date = dateKey(row.work_date);
			const intervals = row.worked_intervals ?? [];
			const first = attendanceBoundary(intervals, 'FIRST');
			const last = attendanceBoundary(intervals, 'LAST');
			windows.set(date, {
				first:
					first == null
						? null
						: dayMinutesToClock(minutesFromDayStart(first, date, reads.timeZone)),
				last:
					last == null ? null : dayMinutesToClock(minutesFromDayStart(last, date, reads.timeZone))
			});
		}
		return windows;
	});

	/**
	 * Where "report a missing punch" is offered: exactly where the write path would accept it — an
	 * ACTIVE, past day with no attendance, no pending report, no settlement claim and no full-day leave
	 * (a half day stays reportable). A roster-only day is reportable (the grant masks the report to
	 * `worked_intervals`), and so is an unpunched rest day.
	 *
	 * The paid-window refusal (`assertNotSettled`) is not pre-checked: an employee cannot read
	 * `payroll_runs` (by ruling), so the server refuses and `submit` shows its sentence verbatim.
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
		{ label: t('app.hr_employee.source_person_days'), query: reads.workDays },
		{ label: t('app.hr_employee.source_leave'), query: reads.leave },
		{ label: t('holiday_calendar.jurisdiction'), query: reads.settings },
		{ label: t('app.hr_employee.source_holidays'), query: reads.holidays },
		{ label: t('app.hr_employee.source_shifts'), query: reads.shifts },
		{ label: t('app.hr_employee.source_terms'), query: reads.termRows },
		{ label: t('component.work_day_capture_status_unavailable'), query: captureSlips },
		{ label: t('component.work_day_capture_status_unavailable'), query: captureTranches },
		{ label: t('component.work_day_capture_status_unavailable'), query: captureAllocations }
	]);
	/**
	 * Named sources rather than an OR of `loading` flags, for the reason the board records: a gate
	 * that only knows "loading" has no terminal state, so a query that errors leaves the surface on a
	 * skeleton forever with nothing on screen saying why.
	 */
	const scheduleErrors = $derived([
		...(reads.calendar.error == null ? [] : [reads.calendar.error]),
		...scheduleSources.flatMap((source) =>
			source.query.error ? [`${source.label}: ${source.query.error}`] : []
		)
	]);
	const scheduleLoading = $derived(
		scheduleErrors.length === 0 && scheduleSources.some((source) => source.query.loading)
	);

	/* ── The day detail, and the one write this surface offers ─────────────────────────────────── */

	/**
	 * A day with a stored row opens the workspace's own record sheet for it — the same surface every collection table
	 * opens. A day with no row has nothing to open: the report chip beside it is the one write an employee has there.
	 */
	function openDaySheet(_employmentId: string, date: string): void {
		const stored = scheduleFactWorkDays.find((row) => dateKey(row.work_date) === date);
		if (stored?.id != null && isSettledId(stored.id)) openRecord('work_days', stored.id);
	}

	/**
	 * The report dialog's write: a day with no row is created through the same transform every
	 * other attendance write crosses. It is immediately held under `approval_id`, which the
	 * platform's mutation boundary presents rather than letting this component invent a second
	 * result state.
	 */
	const report = $state<{
		open: boolean;
		date: PlainDate | null;
		clock: TimeRange;
	}>({
		open: false,
		date: null,
		clock: { start: null, end: null }
	});

	function openReport(_employmentId: string, date: string): void {
		const day = scheduleDay(date);
		report.date = PlainDate(date);
		// Seeded from the roster's own window so the common case is one confirmation, and editable
		// because a missing punch is often exactly the day somebody did NOT work their shift. A day
		// with no planned window seeds empty rather than guessing one.
		report.clock = {
			start: day?.shiftStart?.slice(0, 5) ?? null,
			end: day?.shiftEnd?.slice(0, 5) ?? null
		};
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
		const start = clockToDayMinutes(report.clock.start ?? '', 0);
		const end = clockToDayMinutes(report.clock.end ?? '', 0);
		if (start == null || end == null) return null;
		// An end at or before the start belongs to the next morning — the same way a roster code's
		// own window models a night shift, so the plan band and this draft count in one unit.
		const crossesMidnight = end <= start;
		const intervals: readonly IntervalDraft[] = [
			{
				start: instantFromDayStart(date, start, reads.timeZone),
				end: instantFromDayStart(date, crossesMidnight ? end + DAY_MINUTES : end, reads.timeZone)
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
	 * The report's write: the stored row's clock is updated when the day has a row, else the person-day is created. Either
	 * is held under `approval_id` by the grant's approval route; a refusal (a paid period, full-day leave) is the
	 * server's sentence, shown verbatim.
	 */
	const reportWorkDayId = $derived(
		scheduleWorkDays.find((row) => report.date != null && dateKey(row.work_date) === report.date)
			?.id ?? null
	);
	let reportRefusal = $state<string | null>(null);
	let reportPending = $state(false);
	async function submitReport(): Promise<void> {
		const draft = reportDraft;
		if (draft == null || employmentId == null || reportProblem != null) return;
		const worked_intervals = draft.intervals.map((interval) => ({
			start: Instant(interval.start),
			end: interval.end == null ? null : Instant(interval.end)
		}));
		reportPending = true;
		const outcome =
			reportWorkDayId == null
				? await bolt.act('work_days.create', {
						employment_id: employmentId,
						work_date: draft.date,
						worked_intervals
					})
				: await bolt.act('work_days.update', {
						target: reportWorkDayId,
						set: { worked_intervals }
					});
		reportPending = false;
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
			reportRefusal = null;
			report.open = false;
		} else reportRefusal = outcome.kind === 'refused' ? outcome.message : t('component.error');
	}
</script>

{#if employmentId != null}
	{#if scheduleErrors.length > 0}
		<Alert.Root variant="destructive">
			<Alert.Title>{t('app.hr_employee.schedule_failed')}</Alert.Title>
			<Alert.Description>{scheduleErrors.join(' · ')}</Alert.Description>
		</Alert.Root>
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
			{...selfService ? { onSelectDay: openDaySheet, onReportDay: openReport } : {}}
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
				<Stack gap="sm">
					<Labelled
						label={`${t('app.hr_employee.report_punch_start')} – ${t('app.hr_employee.report_punch_end')}`}
						class="text-sm font-medium"
					>
						<TimeRangeInput
							value={report.clock}
							disabled={reportPending}
							onChange={(clock) => (report.clock = clock)}
						/>
					</Labelled>

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
					{#if reportRefusal != null}<p class="text-sm text-destructive" role="alert">
							{reportRefusal}
						</p>{/if}
					<Button disabled={reportProblem != null || reportPending} onclick={submitReport}>
						{t('app.hr_employee.report_punch_submit')}
					</Button>
				</Stack>
			{/key}
		</Dialog.Content>
	</Dialog.Root>
{/if}
