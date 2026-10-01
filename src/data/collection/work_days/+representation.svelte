<script lang="ts">
	import CodeSelect from '../../../lib/ui/code-select.svelte';
	import { t } from '../../../lib/ui/t.js';
	import { everyField } from '../../../lib/every-field.js';
	/**
	 * One person-day: the plan and the actual, on the collection's own record surface.
	 *
	 * A board cell that has a stored row opens this for it; a cell that has none opens it as a create, the person and
	 * the day carried in the view's values. Every write crosses `work_days` and
	 * its transform: `work_days.create` / `work_days.update`, the halves the operator changed and nothing else.
	 *
	 * The record freezes when its captured payslip is paid, funded or actually allocated; an unpaid pin can
	 * be corrected and is rebuilt by recalculation. The plan half is the controller's: whether this caller may write `shift_definition_id` is read
	 * from the collection's exposure (the grant's allowlist), never a query for a grant. Self-service reads the plan
	 * and reports a missing punch.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import {
		Alert,
		Button,
		Combobox,
		DateInput,
		Icon,
		Input,
		Picker,
		RecordShell,
		Tabs,
		TimeRangeInput,
		openRecord,
		useKinds,
		type RecordView
	} from '@norbital-ai/ui';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { capturedWorkDayFrozen } from '../../../lib/ui/roster/capture-claims.js';
	import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { employmentPicker, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import { dateKey, isUtcIsoInstant, PAYROLL_TIME_ZONE } from '../../../lib/iso-day.js';
	import { settingsInForce, stableJson } from '../../../lib/jurisdiction_settings.js';
	import EntityFactsRenderer from '../../custom_field/entity_facts/+renderer.svelte';
	import { onLineage } from '../../../lib/ui/settings-scope.js';
	import { formatDurationHours } from '../../../lib/ui/display-formatters.js';
	import { live, liveRows } from '../../../lib/ui/live.svelte.js';
	import {
		attendanceChanged,
		daySaveIntent,
		daySaveLabelKey,
		type AttendanceValue
	} from '../../../lib/ui/roster/controller-attendance-state.js';
	import {
		ATTENDANCE_DRAFT_PROBLEM_KEY,
		DAY_MINUTES,
		assessAttendanceDraft,
		beyondPlanMinutes,
		clockToDayMinutes,
		dayMinutesOffsetDays,
		dayMinutesToClock,
		instantFromDayStart,
		minutesFromDayStart,
		plannedMinutes,
		storedHours
	} from '../../../lib/ui/roster/roster-month.js';
	import {
		applicableLimits,
		assessmentWindow,
		observedDays,
		overtimeEntitled,
		rosterCodeFacts,
		type ObservedDays,
		type RosterCodeFacts
	} from '../../../lib/scheduling/work-limits.js';
	import {
		patternAnchor,
		patternRosterCodeId,
		termPatternRow,
		type ShiftPatternLike
	} from '../../../lib/scheduling/work-pattern.js';
	import { windowOvertime } from '../../../lib/ui/roster/day-overtime.js';
	import { coversDate } from '../../../lib/payroll/run/effective.js';
	import { personContext } from '../../../lib/payroll/run/eligibility.js';
	import { decodeNumber } from '../../../lib/wire.js';

	let { view }: { view: RecordView<'work_days'> } = $props();
	const scope = hrCreateScope();
	const kinds = useKinds();

	const record = $derived(view.mode === 'update' ? view.record : null);
	/** What a create sheet was opened with: a board cell names the person and the day. */
	const opened = $derived(view.mode === 'create' ? view.values : {});

	/** The controller holds the plan grant; self-service has the clock and nothing else. */
	const maySetSchedule = $derived(
		(
			kinds.catalog?.['work_days']?.[view.mode === 'update' ? 'update' : 'create']?.columns ?? []
		).includes('shift_definition_id')
	);
	const mode = $derived<'controller' | 'employee'>(maySetSchedule ? 'controller' : 'employee');

	/* ── IDENTITY, AND THE ENTITY'S CLOCK ── */

	/** A create opened with no cell names the person and the day here. */
	let pickedEmployment = $state<Id<'employments'> | null>(null);
	let pickedDate = $state<string | null>(null);
	const employmentId = $derived(record?.employment_id ?? opened.employment_id ?? pickedEmployment);
	const workDate = $derived.by(() => {
		const day = record?.work_date ?? opened.work_date ?? pickedDate;
		return day == null || day === '' ? null : PlainDate(day);
	});

	const employmentQuery = live(() =>
		employmentId == null
			? null
			: bolt.get('employments', employmentId, {
					employee_number: true,
					employee_id: { select: { name: true } },
					company_id: {
						select: { settings_code: true, region: true, facts: true, pay_cutoff_day: true }
					}
				})
	);
	const employment = $derived(employmentQuery.current);
	const entity = $derived(employment?.company_id ?? null);
	const personLabel = $derived(
		[employment?.employee_number, employment?.employee_id?.name]
			.filter((part) => part != null && part !== '')
			.join(' ')
	);
	const companyId = $derived(entity?.id ?? null);
	const settingsCode = $derived(entity?.settings_code ?? null);
	const settings = liveRows(() =>
		settingsCode == null
			? null
			: bolt.read('jurisdiction_settings', {
					// the version in force's clock and work rules only: whole rows run to megabytes, past a live view
					select: {
						code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						payroll: true,
						work_rules: true,
						work_day_facts: true
					},
					where: onLineage(settingsCode),
					limit: 200
				})
	);
	/** The editors are seeded from instants, so they wait for the entity's zone. */
	const identityResolved = $derived(
		employmentId == null ||
			(employmentQuery.current !== undefined &&
				(settingsCode == null || settings.current !== undefined))
	);
	const settingsVersion = $derived.by(() => {
		if (settingsCode == null) return null;
		try {
			return settingsInForce(settings.current ?? [], settingsCode, workDate ?? todayKey());
		} catch {
			return null;
		}
	});
	const timeZone = $derived(settingsVersion?.payroll?.timezone ?? PAYROLL_TIME_ZONE);

	/* ── THE ROSTER VOCABULARY ── */

	const shifts = liveRows(() =>
		companyId == null
			? null
			: bolt.read('shift_definitions', {
					select: everyField('shift_definitions'),
					where: { company_id: { eq: companyId } },
					orderBy: 'code',
					limit: 500
				})
	);
	// keyed by text: a pattern's days name their codes in its `json` value
	const shiftsById = $derived(
		new Map<string, NonNullable<typeof shifts.current>[number]>(
			(shifts.current ?? []).map((code) => [code.id, code])
		)
	);
	/** The picker offers the entity's codes effective on this day. */
	const codeWhere = $derived(
		companyId == null
			? {}
			: {
					where: {
						company_id: { eq: companyId },
						...(workDate == null ? {} : { effective_range: { contains: workDate } })
					}
				}
	);

	/* ── THE PLAN ── */

	let draftCodeId = $state<Id<'shift_definitions'> | null>(null);
	let baselineCodeId = $state<Id<'shift_definitions'> | null>(null);

	/** The terms carry their pattern row, so a projection never waits on a second read. */
	const terms = liveRows(() =>
		employmentId == null
			? null
			: bolt.read('employment_terms', {
					where: { employment_id: { eq: employmentId } },
					select: {
						effective_range: true,
						shift_pattern_id: { select: { code: true, pattern: true, effective_range: true } },
						employment_type: true,
						work_classification: true,
						worksite: true,
						base_salary: true,
						statutory_work_category: true,
						pay_frequency: true,
						allowances: true
					},
					limit: 100
				})
	);
	const termRows = $derived(
		(terms.current ?? []).map((term) => ({
			...term,
			shift_pattern_id: term.shift_pattern_id?.id ?? null,
			// the declared `work_pattern` kind spells each member optional; the scheduling schema reads the shapes whole
			term_shift_pattern: term.shift_pattern_id as ShiftPatternLike | null
		}))
	);
	const termOn = (date: string) => termRows.find((term) => coversDate(term.effective_range, date));
	const patternOn = (day: string) => {
		const term = termOn(day);
		const row = term == null ? null : termPatternRow(term);
		return row == null ? null : { pattern: row.pattern, anchor: patternAnchor(row) };
	};
	/** What the work pattern projects on this day; the plan the day follows without an override. */
	const patternCodeId = $derived.by(() => {
		if (workDate == null) return null;
		const row = patternOn(workDate);
		try {
			return row == null ? null : patternRosterCodeId(row.pattern, workDate, row.anchor);
		} catch {
			return null;
		}
	});
	const codeLabel = (id: string | null) => {
		const code = id == null ? null : shiftsById.get(id);
		if (code == null) return '';
		const window = rosterCodeKind(code.variant) === 'WORK' ? workWindow(code.variant) : null;
		return window == null
			? `${code.code} · ${rosterCodeKind(code.variant)}`
			: `${code.code} · ${t('roster.shift_window', { start: window.start_time, end: window.end_time, break: window.break_minutes / 60 })}`;
	};
	/** The code the day is planned on: its own override, else the pattern's. */
	const effectiveCodeId = $derived(draftCodeId ?? patternCodeId);
	const effectiveKind = $derived.by(() => {
		const code = effectiveCodeId == null ? null : shiftsById.get(effectiveCodeId);
		return code == null ? null : rosterCodeKind(code.variant);
	});
	const selectedWindow = $derived.by(() => {
		const code = effectiveCodeId == null ? null : shiftsById.get(effectiveCodeId);
		return code == null || rosterCodeKind(code.variant) !== 'WORK'
			? null
			: workWindow(code.variant);
	});
	/** Always an object, so the totals below read a day with no plan as a planned zero, not a gap. */
	const plannedShift = $derived({
		shiftStart: selectedWindow?.start_time ?? null,
		shiftEnd: selectedWindow?.end_time ?? null,
		shiftBreakMinutes: selectedWindow?.break_minutes ?? null
	});

	const capturedSlipId = $derived(record?.payslip_id ?? null);
	const capturedSlip = live(() =>
		capturedSlipId == null
			? null
			: bolt.get('payslips', capturedSlipId, {
					payroll_run_id: true,
					paid_at: true,
					funding_received: true,
					funding_received_on: true,
					funding_reference: true
				})
	);
	const captureTranches = liveRows(() =>
		mode !== 'controller' || capturedSlipId == null
			? null
			: bolt.read('payable_tranches', {
					where: { settlement: { payslips: { eq: capturedSlipId } } },
					select: { settlement: true },
					all: true
				})
	);
	const captureTrancheIds = $derived((captureTranches.current ?? []).map((row) => row.id));
	const captureAllocations = liveRows(() =>
		mode !== 'controller' || captureTrancheIds.length === 0
			? null
			: bolt.read('payment_allocations', {
					where: { payable_tranche_id: { in: captureTrancheIds } },
					select: { payable_tranche_id: true },
					all: true
				})
	);
	const allocatedTrancheIds = $derived(
		new Set((captureAllocations.current ?? []).map((row) => row.payable_tranche_id))
	);
	const allocatedSlipIds = $derived(
		new Set(
			(captureTranches.current ?? [])
				.filter((row) => allocatedTrancheIds.has(row.id))
				.map((row) => String(row.settlement.id))
		)
	);
	const captureRun = live(() =>
		mode !== 'controller' || capturedSlip.current == null
			? null
			: bolt.get('payroll_runs', capturedSlip.current.payroll_run_id, { period: true })
	);
	const captureError = $derived(
		capturedSlip.error ?? captureTranches.error ?? captureAllocations.error ?? captureRun.error
	);
	const captureReady = $derived(
		mode === 'controller' &&
			capturedSlip.current != null &&
			!capturedSlip.loading &&
			captureError == null &&
			captureTranches.current !== undefined &&
			!captureTranches.loading &&
			(captureTrancheIds.length === 0 ||
				(captureAllocations.current !== undefined && !captureAllocations.loading))
	);
	const frozen = $derived(
		capturedWorkDayFrozen(
			record,
			capturedSlip.current == null ? [] : [capturedSlip.current],
			allocatedSlipIds,
			captureReady
		)
	);
	const lockHint = $derived(
		!frozen
			? undefined
			: (captureError ??
					(mode === 'controller' &&
					(capturedSlip.loading ||
						captureTranches.loading ||
						captureAllocations.loading ||
						captureRun.loading)
						? t('component.loading')
						: captureReady && captureRun.current != null
							? t('component.work_day_capture_locked', { period: captureRun.current.period })
							: t('component.work_day_capture_status_unavailable')))
	);

	const planWritable = $derived(mode === 'controller' && !frozen);
	/** Choosing the pattern clears the override: a change like any other, saved with the sheet. */
	const planTouched = $derived(planWritable && draftCodeId !== baselineCodeId);

	/* ── THE ACTUAL ── */

	/** An interval while it is being edited: minutes from the start of the work date, never instants. */
	type EditableInterval = { startMinutes: number | null; endMinutes: number | null };

	let draftIntervals = $state<EditableInterval[]>([]);
	let draftAttendanceRecorded = $state(false);
	let baselineAttendance = $state<AttendanceValue>({ intervals: null });
	/** The day's planned overtime as ONE figure; the statute splits it (approved within the headroom, incentive beyond). */
	let draftOvertime = $state<number | null>(null);
	let draftConsent = $state('');
	/** Self-service only: the operator has asked to report a punch on a day that has none. */
	let reporting = $state(false);
	/** The statutory flags the version's bands read. */
	let requestedBy = $state<'EMPLOYER' | 'EMPLOYEE' | null>(null);
	let emergency = $state(false);
	let timeOffInLieu = $state(false);
	let draftWorksite = $state('');
	let draftPieceUnits = $state<number | null>(null);
	let draftPieceUnitRate = $state<number | null>(null);
	/** The day's declared jurisdiction inputs (`work_day_facts`). */
	let draftFacts = $state<{ readonly [key: string]: string | number | boolean }>({});
	let saving = $state(false);
	let notice = $state<{ tone: 'destructive' | 'default'; text: string } | null>(null);

	/** The identity of the sheet, so a new person-day re-seeds the editors. */
	const sheetKey = $derived(`${employmentId ?? ''}:${workDate ?? ''}`);

	/** Seed the editors from the record. Runs on mount, and again whenever the keyed block remounts. */
	function seedSheet(): void {
		reporting = false;
		notice = null;
		draftCodeId = record?.shift_definition_id ?? null;
		baselineCodeId = record?.shift_definition_id ?? null;
		const storedApproved = storedHours(record?.approved_overtime_hours);
		const storedIncentive = storedHours(record?.incentive_hours);
		draftOvertime =
			storedApproved == null && storedIncentive == null
				? null
				: (storedApproved ?? 0) + (storedIncentive ?? 0);
		draftConsent =
			record?.overtime_consented_at == null ? '' : String(record.overtime_consented_at);
		draftAttendanceRecorded = record?.worked_intervals != null;
		baselineAttendance = {
			intervals:
				record?.worked_intervals == null
					? null
					: record.worked_intervals.map((interval) => ({
							start: interval.start,
							end: interval.end
						}))
		};
		requestedBy = record?.requested_by ?? null;
		emergency = record?.emergency_cause === true;
		timeOffInLieu = record?.time_off_in_lieu === true;
		draftWorksite = record?.worksite ?? '';
		draftPieceUnits = storedHours(record?.piece_units);
		draftPieceUnitRate = storedHours(record?.piece_unit_rate);
		draftFacts = { ...(record?.facts ?? {}) };
		const day = workDate;
		draftIntervals =
			day == null
				? []
				: (record?.worked_intervals ?? []).map((interval) => ({
						startMinutes: minutesFromDayStart(interval.start, day, timeZone),
						endMinutes:
							interval.end == null ? null : minutesFromDayStart(interval.end, day, timeZone)
					}));
	}

	const draftIntervalValues = $derived(
		workDate == null
			? []
			: draftIntervals.map((interval) => ({
					start:
						interval.startMinutes == null
							? ''
							: instantFromDayStart(workDate, interval.startMinutes, timeZone),
					end:
						interval.endMinutes == null
							? null
							: instantFromDayStart(workDate, interval.endMinutes, timeZone)
				}))
	);
	const assessment = $derived(
		assessAttendanceDraft(draftIntervalValues, selectedWindow?.break_minutes)
	);
	const missingIntervalStart = $derived(
		draftAttendanceRecorded && draftIntervals.some((interval) => interval.startMinutes == null)
	);
	const draftAttendance = $derived<AttendanceValue>({
		intervals: draftAttendanceRecorded ? draftIntervalValues : null
	});
	const attendanceWritable = $derived(!frozen && (mode === 'controller' || reporting));
	const attendanceTouched = $derived(
		attendanceWritable && attendanceChanged(baselineAttendance, draftAttendance)
	);

	/**
	 * Self-service's one affordance: a rostered day with nothing recorded, on a day that is not locked. A base day is
	 * read-only for the employee until HR writes a row for it.
	 */
	const canReportMissingPunch = $derived(
		mode === 'employee' &&
			!frozen &&
			!reporting &&
			record != null &&
			record.worked_intervals == null &&
			record.shift_definition_id != null &&
			workDate != null &&
			workDate < todayKey()
	);

	/* ── THE ASSESSMENT WINDOW: what the headroom reads, for the plan's writer only ── */

	const overtimeWindow = $derived(
		!planWritable || workDate == null || entity == null
			? null
			: assessmentWindow(workDate, entity.pay_cutoff_day ?? 1)
	);
	const windowDays = liveRows(() =>
		overtimeWindow == null || employmentId == null
			? null
			: bolt.read('work_days', {
					where: {
						employment_id: { eq: employmentId },
						work_date: { gte: PlainDate(overtimeWindow.start), lte: PlainDate(overtimeWindow.end) }
					},
					select: {
						work_date: true,
						shift_definition_id: true,
						approved_overtime_hours: true,
						emergency_cause: true
					},
					limit: 62
				})
	);
	const rosters = liveRows(() =>
		overtimeWindow == null || employmentId == null
			? null
			: bolt.read('rosters', {
					where: {
						employment_id: { eq: employmentId },
						period: {
							in: [...new Set([overtimeWindow.start, overtimeWindow.end])].map((date) =>
								date.slice(0, 7)
							)
						}
					},
					select: { period: true },
					limit: 12
				})
	);
	/** The classes of the allowances the terms list: each counts toward the overtime rule's wage as payroll counts it. */
	const listedAllowanceIds = $derived([
		...new Set(
			// the allowance lines are the terms' `json` value: each class id is asserted where it enters
			termRows.flatMap((term) =>
				term.allowances.map((row) => row.catalogue_id as Id<'allowance_catalogue'>)
			)
		)
	]);
	const allowanceClasses = liveRows(() =>
		listedAllowanceIds.length === 0
			? null
			: bolt.read('allowance_catalogue', {
					where: { id: { in: listedAllowanceIds } },
					select: { destination: true, direction: true, counts_toward: true },
					limit: 100
				})
	);
	const holidays = liveRows(() =>
		overtimeWindow == null || companyId == null
			? null
			: bolt.read('jurisdiction_holidays', {
					where: {
						company_id: { eq: companyId },
						date: { gte: PlainDate(overtimeWindow.start), lte: PlainDate(overtimeWindow.end) },
						published_at: { isNull: false },
						approval_id: { isNull: true }
					},
					select: {
						company_id: true,
						date: true,
						name: true,
						kind: true,
						replaces: true,
						given_to: true,
						worksite: true,
						published_at: true
					},
					limit: 62
				})
	);

	/**
	 * The most approved overtime this day can hold, and whether the person is owed overtime pay for it: the
	 * transform's own headroom over the assessment window (`windowOvertime`), on the holidays payroll observes.
	 */
	const overtimeHeadroom = $derived.by(() => {
		const rules = settingsVersion?.work_rules;
		const person = (date: string) => ({
			employee: null,
			employment: { service_start: '' },
			terms: termOn(date) ?? null,
			company: entity == null ? null : { region: entity.region, facts: entity.facts },
			asOf: date
		});
		const limits = applicableLimits(
			rules?.limits ?? [],
			workDate == null ? null : personContext(person(workDate))
		);
		const codeById = new Map<string, RosterCodeFacts>();
		for (const code of shiftsById.values()) {
			try {
				const facts = rosterCodeFacts(code.variant);
				if (facts != null) codeById.set(code.id, facts);
			} catch {
				continue;
			}
		}
		const stored = (windowDays.current ?? []).map((row) => ({
			date: dateKey(row.work_date),
			shift_definition_id: row.shift_definition_id ?? null,
			approved: storedHours(row.approved_overtime_hours) ?? 0,
			emergency: row.emergency_cause === true
		}));
		const date = workDate ?? '';
		const window = overtimeWindow ?? { start: date, end: date };
		const cutoffDay = entity?.pay_cutoff_day ?? 1;
		let observed: ObservedDays = { holidays: new Set(), offDays: new Set() };
		try {
			observed = observedDays({
				dates: [date],
				cutoffDay,
				companyId: companyId ?? '',
				holidays: holidays.current ?? [],
				codes: [...shiftsById.values()],
				work: rules,
				plans: [
					...stored
						.filter((day) => day.date !== date)
						.map((day) => ({ work_date: day.date, shift_definition_id: day.shift_definition_id })),
					{ work_date: date, shift_definition_id: draftCodeId }
				],
				rosterPeriods: (rosters.current ?? []).map((row) => row.period),
				patternOn,
				worksiteOn: (day) => termOn(day)?.worksite
			});
		} catch {
			// A plan the schedule cannot resolve observes nothing here; the save is judged by the transform.
		}
		return {
			maximum: windowOvertime({
				window,
				date,
				draft: { codeId: draftCodeId, emergency: record?.emergency_cause === true },
				stored,
				projected: (day) => {
					const row = patternOn(day);
					return row == null ? null : patternRosterCodeId(row.pattern, day, row.anchor);
				},
				codeById,
				observed,
				limits,
				cutoffDay,
				unitHours: rules?.overtime_unit_hours
			}),
			holiday: observed.holidays.has(date),
			entitled:
				workDate == null ||
				overtimeEntitled(rules?.overtime_when, person(workDate), (id) =>
					(allowanceClasses.current ?? []).find((row) => row.id === id)
				)
		};
	});
	/** The planned figure, split at the day's headroom; no limit keeps every hour approved. */
	const draftApproved = $derived.by(() => {
		if (draftOvertime == null) return null;
		const maximum = overtimeHeadroom.maximum?.hours;
		return maximum == null ? draftOvertime : Math.min(draftOvertime, maximum);
	});
	const draftIncentive = $derived(
		draftOvertime == null || draftApproved == null || draftOvertime === draftApproved
			? null
			: draftOvertime - draftApproved
	);
	/** Null and zero are one statement to payroll: no approved hours. */
	const overtimeTouched = $derived(
		planWritable &&
			((draftApproved ?? 0) !== (storedHours(record?.approved_overtime_hours) ?? 0) ||
				(draftIncentive ?? 0) !== (storedHours(record?.incentive_hours) ?? 0))
	);
	/** A company holiday worked by a person the overtime rule does not cover: HR grants an off-in-lieu day, never here. */
	const holidayWithoutOvertime = $derived(
		overtimeHeadroom.holiday &&
			!overtimeHeadroom.entitled &&
			((draftApproved ?? 0) + (draftIncentive ?? 0) > 0 ||
				draftIntervals.some((interval) => interval.startMinutes != null))
	);
	const planned = $derived(
		plannedMinutes({
			...plannedShift,
			approvedOvertimeHours: draftApproved,
			incentiveHours: draftIncentive
		})
	);
	/** Clock time past the plan: unplanned, and not paid. */
	const unplanned = $derived(
		Math.max(
			0,
			beyondPlanMinutes({
				...plannedShift,
				approvedOvertimeHours: draftApproved,
				incentiveHours: draftIncentive,
				workedMinutes: assessment.workedMinutes
			}) ?? 0
		)
	);
	/** The refusal to show, or null; silent while the editor is empty. */
	const problemMessage = $derived(
		missingIntervalStart
			? t('roster.day_sheet_problem_missing_start')
			: assessment.problem == null || draftIntervals.length === 0
				? null
				: t(ATTENDANCE_DRAFT_PROBLEM_KEY[assessment.problem])
	);
	const saveIntent = $derived(daySaveIntent(planTouched, attendanceTouched, overtimeTouched));

	/** What the day reads as, from its own row: the person, and the state of the plan and the clock. */
	const subtitle = $derived.by(() => {
		if (record == null)
			return (
				[personLabel, workDate].filter((part) => part != null && part !== '').join(' · ') ||
				undefined
			);
		const code =
			record.shift_definition_id == null
				? null
				: (shiftsById.get(record.shift_definition_id) ?? null);
		const kind = code == null ? null : rosterCodeKind(code.variant);
		const intervals = record.worked_intervals;
		const state =
			intervals == null
				? kind == null
					? patternCodeId == null
						? t('roster.plan_missing')
						: t('roster.plan_projected')
					: kind === 'WORK'
						? t('roster.plan_recorded')
						: kind === 'REST'
							? t('roster.rest_day')
							: t('roster.off_day')
				: intervals.length === 0
					? t('roster.actual_empty')
					: intervals.some((interval) => interval.end == null)
						? t('roster.open_punch')
						: t('roster.attended');
		return personLabel === '' ? state : `${personLabel} · ${state}`;
	});

	/** The statutory flags exist for the jurisdictions whose overtime bands read them; others are not asked. */
	const bandText = $derived(
		(settingsVersion?.work_rules?.bands ?? [])
			.flatMap((band) => [band.when ?? '', band.take_hours, band.price_amount])
			.join('\n')
	);
	const bandsRead = (name: string) => new RegExp(`\\b${name}\\b`).test(bandText);
	const showRequestedBy = $derived(bandsRead('requested_by') && effectiveKind === 'REST');
	const showEmergency = $derived(bandsRead('emergency_cause'));
	const showTimeOffInLieu = $derived(bandsRead('time_off_in_lieu'));
	const flagsTouched = $derived(
		attendanceWritable &&
			(requestedBy !== (record?.requested_by ?? null) ||
				emergency !== (record?.emergency_cause === true) ||
				timeOffInLieu !== (record?.time_off_in_lieu === true))
	);
	/** The version asks each overtime occasion for the worker's prior consent (`work_rules.overtime_consent`). */
	const consentRequired = $derived(settingsVersion?.work_rules?.overtime_consent != null);
	const consentTouched = $derived(
		planWritable &&
			consentRequired &&
			draftConsent !==
				(record?.overtime_consented_at == null ? '' : String(record.overtime_consented_at))
	);
	const wageDayWritable = $derived(mode === 'controller' && !frozen);
	const wageDayTouched = $derived(
		wageDayWritable &&
			(draftWorksite !== (record?.worksite ?? '') ||
				draftPieceUnits !== storedHours(record?.piece_units) ||
				draftPieceUnitRate !== storedHours(record?.piece_unit_rate))
	);
	const factsTouched = $derived(
		wageDayWritable && stableJson(draftFacts) !== stableJson(record?.facts ?? {})
	);
	const dayDeclarations = $derived(settingsVersion?.work_day_facts ?? []);

	/**
	 * The guards the write path will apply, before it is asked: nothing changed is no save (a board's create sheet must
	 * not land an empty person-day), and a punch the assessment refuses is named here.
	 */
	const saveProblem = $derived(
		!planTouched &&
			!attendanceTouched &&
			!overtimeTouched &&
			!flagsTouched &&
			!consentTouched &&
			!wageDayTouched &&
			!factsTouched
			? t('roster.day_sheet_cannot_save')
			: consentTouched && draftConsent !== '' && !isUtcIsoInstant(draftConsent)
				? 'Worker consent requires a UTC instant (YYYY-MM-DDTHH:mm:ss.sssZ).'
				: attendanceTouched &&
					  (missingIntervalStart || (draftIntervals.length > 0 && assessment.problem != null))
					? (problemMessage ?? t('roster.day_sheet_cannot_save'))
					: null
	);

	/** The halves this sheet changed, and nothing else. */
	async function save(): Promise<void> {
		if (saveProblem != null || employmentId == null || workDate == null) return;
		const set = {
			...(planTouched ? { shift_definition_id: draftCodeId } : {}),
			...(attendanceTouched
				? {
						worked_intervals: draftAttendanceRecorded
							? draftIntervalValues.map((interval) => ({
									start: Instant(interval.start),
									end: interval.end == null ? null : Instant(interval.end)
								}))
							: null
					}
				: {}),
			...(overtimeTouched
				? { approved_overtime_hours: draftApproved, incentive_hours: draftIncentive }
				: {}),
			...(consentTouched
				? { overtime_consented_at: draftConsent === '' ? null : Instant(draftConsent) }
				: {}),
			...(flagsTouched
				? { requested_by: requestedBy, emergency_cause: emergency, time_off_in_lieu: timeOffInLieu }
				: {}),
			...(wageDayTouched
				? {
						worksite: draftWorksite || null,
						piece_units: draftPieceUnits,
						piece_unit_rate: draftPieceUnitRate
					}
				: {}),
			...(factsTouched ? { facts: draftFacts } : {})
		};
		saving = true;
		notice = null;
		const outcome =
			record == null
				? await bolt.act('work_days.create', {
						employment_id: employmentId,
						work_date: workDate,
						...set
					})
				: await bolt.act('work_days.update', { target: record.id, set });
		saving = false;
		if (outcome.kind === 'refused')
			notice = {
				tone: 'destructive',
				text: `${t('roster.day_sheet_save_failed')} ${outcome.message}`
			};
		else if (outcome.kind === 'conflict')
			notice = { tone: 'destructive', text: t('roster.day_sheet_save_failed') };
		else if (outcome.kind === 'pendingApproval')
			notice = { tone: 'default', text: t('roster.day_sheet_pending_approval') };
		if ((outcome.kind === 'committed' || outcome.kind === 'pendingApproval') && record == null) {
			const created = outcome.records.find((row) => row.collection === 'work_days');
			if (created != null) openRecord('work_days', created.id);
		}
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
			baselineCodeId = draftCodeId;
			baselineAttendance = draftAttendance;
		}
	}

	function hoursValue(value: string): number | null | undefined {
		if (value.trim() === '') return null;
		const parsed = decodeNumber(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	const clockValue = (minutes: number | null) =>
		minutes == null ? null : dayMinutesToClock(minutes);

	function setStart(index: number, clock: string): void {
		const interval = draftIntervals[index];
		if (interval == null) return;
		const minutes =
			clock === ''
				? null
				: clockToDayMinutes(clock, dayMinutesOffsetDays(interval.startMinutes ?? 0));
		if (clock !== '' && minutes == null) return;
		// A fresh array: `$state` ignores a mutation-in-place that leaves the reference identical.
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index ? { ...entry, startMinutes: minutes } : entry
		);
	}
	function setEnd(index: number, clock: string): void {
		const interval = draftIntervals[index];
		if (interval == null) return;
		const offset = dayMinutesOffsetDays(interval.endMinutes ?? interval.startMinutes ?? 0);
		const minutes = clock === '' ? null : clockToDayMinutes(clock, offset);
		if (clock !== '' && minutes == null) return;
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index ? { ...entry, endMinutes: minutes } : entry
		);
	}
	/** A night shift's end moves onto the following morning, or back off it: one toggle per end, never a date picker. */
	function shiftEndDay(index: number, days: number): void {
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index && entry.endMinutes != null
				? { ...entry, endMinutes: entry.endMinutes + days * DAY_MINUTES }
				: entry
		);
	}
	const scheduled = () => {
		const start =
			selectedWindow == null ? 9 * 60 : (clockToDayMinutes(selectedWindow.start_time, 0) ?? 9 * 60);
		const end =
			selectedWindow == null
				? start + 8 * 60
				: (clockToDayMinutes(selectedWindow.end_time, 0) ?? start + 8 * 60);
		return { start, end: end <= start ? end + DAY_MINUTES : end };
	};
	/** The first interval suggests the planned window; later ones begin where the previous split ended. */
	function addInterval(): void {
		const previous = draftIntervals.at(-1);
		const window = scheduled();
		const start = previous?.endMinutes ?? window.start;
		draftAttendanceRecorded = true;
		draftIntervals = [
			...draftIntervals,
			{ startMinutes: start, endMinutes: previous == null ? window.end : start + 60 }
		];
	}
	function removeInterval(index: number): void {
		draftAttendanceRecorded = true;
		draftIntervals = draftIntervals.filter((_entry, position) => position !== index);
	}
	/** Absent: a deliberate reviewed-no-work fact without an interval. */
	function markAbsent(): void {
		draftAttendanceRecorded = true;
		draftIntervals = [];
	}
	/** Back to the distinct unrecorded `null` state. */
	function clearAttendance(): void {
		draftAttendanceRecorded = false;
		draftIntervals = [];
	}
	/** Self-service's one write: pre-fill the day the roster says it should have been, then let the person correct it. */
	function reportMissingPunch(): void {
		reporting = true;
		if (draftIntervals.length > 0) return;
		const window = scheduled();
		draftIntervals = [{ startMinutes: window.start, endMinutes: window.end }];
		draftAttendanceRecorded = true;
	}
</script>

{#snippet fieldRow(label: string, value: string)}
	<Inline gap="sm" align="baseline" class="text-xs">
		<span class="min-w-28 shrink-0 text-muted-foreground">{label}</span>
		<span class="min-w-0 break-words">{value}</span>
	</Inline>
{/snippet}

{#snippet plannedTab()}
	<Stack gap="md">
		{@render fieldRow(
			t('roster.projected_shift'),
			patternCodeId == null ? t('roster.plan_missing') : codeLabel(patternCodeId)
		)}
		{#if mode === 'controller'}
			<Stack gap="xs">
				<p class="text-sm font-medium">{t('roster.recorded_plan')}</p>
				<p class="text-xs text-muted-foreground">{t('roster.recorded_plan_help')}</p>
				<Picker
					of="shift_definitions"
					label={['code', 'name']}
					{...codeWhere}
					orderBy="code"
					value={draftCodeId}
					onChange={(next) => (draftCodeId = next)}
					disabled={!planWritable}
				/>
				<!-- No override is the pattern's day: returning to it clears the override, saved with the sheet. -->
				<Cluster gap="xs" align="center" class="text-xs text-muted-foreground">
					{#if draftCodeId != null && planWritable}
						<Button variant="ghost" size="sm" type="button" onclick={() => (draftCodeId = null)}>
							<Icon name="lucide:undo-2" class="size-3.5" />
							{patternCodeId == null
								? t('roster.no_work_pattern')
								: t('roster.follow_work_pattern', { code: codeLabel(patternCodeId) })}
						</Button>
					{:else}
						<span
							>{patternCodeId == null
								? t('roster.no_work_pattern')
								: t('roster.follow_work_pattern', { code: codeLabel(patternCodeId) })}</span
						>
					{/if}
				</Cluster>
			</Stack>
		{:else}
			<!-- Self-service reads the plan; it never sets it. A roster is HR's record. -->
			{@render fieldRow(
				t('roster.day_sheet_roster_code'),
				selectedWindow == null
					? t('roster.unrostered')
					: t('roster.shift_window', {
							start: selectedWindow.start_time,
							end: selectedWindow.end_time,
							break: selectedWindow.break_minutes / 60
						})
			)}
		{/if}
		<!-- Overtime is PLANNED on the day. One figure: the statute splits it into approved and incentive hours. -->
		<FormSection
			name="roster.day_sheet_planned_overtime"
			title={t('roster.day_sheet_planned_overtime')}
			hint={t('roster.day_sheet_approved_overtime_description')}
			first
		>
			{#if planWritable}
				<Input
					type="number"
					min="0"
					max="24"
					step={settingsVersion?.work_rules?.overtime_unit_hours ?? 'any'}
					class="w-28"
					aria-label={t('roster.day_sheet_planned_overtime')}
					value={draftOvertime ?? ''}
					oninput={(event) => {
						const next = hoursValue(event.currentTarget.value);
						if (next !== undefined) draftOvertime = next;
					}}
				/>
				<p class="text-xs text-muted-foreground" role="status" data-overtime-max>
					{#if draftIncentive != null && overtimeHeadroom.maximum != null}
						{t('roster.day_sheet_overtime_split', {
							approved: formatDurationHours((draftApproved ?? 0) * 60, t),
							incentive: formatDurationHours(draftIncentive * 60, t),
							limit: overtimeHeadroom.maximum.limit.key
						})}
					{:else if overtimeHeadroom.maximum == null}
						{t('roster.day_sheet_overtime_no_limit')}
					{:else}
						{t('roster.day_sheet_overtime_max', {
							max: formatDurationHours(overtimeHeadroom.maximum.hours * 60, t),
							limit: overtimeHeadroom.maximum.limit.key
						})}
					{/if}
				</p>
				{#if holidayWithoutOvertime}
					<Alert.Root data-holiday-without-overtime>
						<Alert.Description>
							{t('roster.day_sheet_holiday_without_overtime', {
								person: personLabel,
								date: workDate ?? ''
							})}
						</Alert.Description>
					</Alert.Root>
				{/if}
			{:else}
				{@render fieldRow(
					t('roster.day_sheet_approved_overtime'),
					(storedHours(record?.approved_overtime_hours) ?? 0) > 0
						? formatDurationHours((storedHours(record?.approved_overtime_hours) ?? 0) * 60, t)
						: t('roster.no_approved_overtime')
				)}
				{#if (storedHours(record?.incentive_hours) ?? 0) > 0}
					{@render fieldRow(
						t('roster.day_sheet_incentive_hours'),
						formatDurationHours((storedHours(record?.incentive_hours) ?? 0) * 60, t)
					)}
				{/if}
			{/if}
		</FormSection>
		{#if consentRequired}
			<FormSection
				name="roster.consent_title"
				title={t('roster.consent_title')}
				hint={t('roster.consent_hint')}
			>
				{#if planWritable}
					<Stack as="label" gap="xs" class="text-xs">
						<span>{t('roster.consent_input')}</span>
						<Input
							type="text"
							value={draftConsent}
							oninput={(event) => (draftConsent = event.currentTarget.value)}
						/>
					</Stack>
				{:else}
					{@render fieldRow(
						t('roster.consent_worker'),
						record?.overtime_consented_at == null ? '—' : String(record.overtime_consented_at)
					)}
				{/if}
			</FormSection>
		{/if}
	</Stack>
{/snippet}

{#snippet actualTab()}
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('roster.actual_attendance_help')}</p>
		{#if dayDeclarations.length > 0 || Object.keys(record?.facts ?? {}).length > 0}
			<FormSection
				name="work_day_facts"
				title={t('component.work_day_facts')}
				hint={t('component.work_day_facts_hint')}
			>
				<EntityFactsRenderer
					view={{
						mode: 'edit',
						name: 'facts',
						value: draftFacts,
						disabled: !wageDayWritable,
						onChange: (next) => (draftFacts = next ?? {})
					}}
					declarations={dayDeclarations}
				/>
			</FormSection>
		{/if}
		{#if wageDayWritable}
			<Cluster gap="sm" align="center">
				<span class="text-sm">{t('roster.day_sheet_worksite')}</span>
				<CodeSelect
					{settingsCode}
					day={workDate}
					wage="places"
					value={draftWorksite}
					aria-label={t('roster.day_sheet_worksite')}
					onChange={(next) => (draftWorksite = next ?? '')}
				/>
			</Cluster>
			{#if workDate != null && termOn(workDate)?.statutory_work_category === 'PIECE_RATE'}
				<Cluster gap="sm" align="center">
					<label for="piece-units">{t('roster.day_sheet_piece_units')}</label>
					<Input
						id="piece-units"
						type="number"
						min="0"
						step="0.01"
						value={draftPieceUnits ?? ''}
						oninput={(event) => {
							const value = hoursValue(event.currentTarget.value);
							if (value !== undefined) draftPieceUnits = value;
						}}
					/>
					<label for="piece-rate">{t('roster.day_sheet_piece_unit_rate')}</label>
					<Input
						id="piece-rate"
						type="number"
						min="0"
						step="0.01"
						value={draftPieceUnitRate ?? ''}
						oninput={(event) => {
							const value = hoursValue(event.currentTarget.value);
							if (value !== undefined) draftPieceUnitRate = value;
						}}
					/>
				</Cluster>
			{/if}
		{/if}
		{#if attendanceWritable}
			{#each draftIntervals as interval, index (index)}
				<Cluster gap="xs" align="center" class="text-xs">
					<span class="min-w-16 shrink-0 text-muted-foreground"
						>{t('roster.day_sheet_interval', { number: index + 1 })}</span
					>
					<TimeRangeInput
						aria-label={t('roster.day_sheet_interval', { number: index + 1 })}
						invalid={interval.startMinutes == null}
						value={{
							start: clockValue(interval.startMinutes),
							end: clockValue(interval.endMinutes)
						}}
						onChange={(next) => {
							if (next.start !== clockValue(interval.startMinutes))
								setStart(index, next.start ?? '');
							if (next.end !== clockValue(interval.endMinutes)) setEnd(index, next.end ?? '');
						}}
					/>
					{#if interval.endMinutes != null}
						<Button
							variant={dayMinutesOffsetDays(interval.endMinutes) > 0 ? 'default' : 'ghost'}
							size="sm"
							type="button"
							aria-pressed={dayMinutesOffsetDays(interval.endMinutes) > 0}
							title={t('roster.day_sheet_next_day')}
							onclick={() =>
								shiftEndDay(index, dayMinutesOffsetDays(interval.endMinutes ?? 0) > 0 ? -1 : 1)}
						>
							+1d
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="icon"
						type="button"
						aria-label={t('roster.day_sheet_remove_interval', { number: index + 1 })}
						onclick={() => removeInterval(index)}
					>
						<Icon name="lucide:x" class="size-3.5" />
					</Button>
				</Cluster>
			{/each}
			{#if draftAttendanceRecorded && draftIntervals.length === 0}
				<Alert.Root>
					<Alert.Title>{t('roster.day_sheet_absent')}</Alert.Title>
					<Alert.Description>{t('roster.day_sheet_absent_description')}</Alert.Description>
				</Alert.Root>
			{:else if !draftAttendanceRecorded}
				<p class="text-xs text-muted-foreground">{t('roster.day_sheet_unrecorded_attendance')}</p>
			{/if}
			<Cluster gap="xs">
				<Button variant="outline" size="sm" type="button" onclick={addInterval}>
					<Icon name="lucide:plus" class="size-3.5" />
					{t('roster.day_sheet_add_interval')}
				</Button>
				{#if !draftAttendanceRecorded}
					<Button variant="outline" size="sm" type="button" onclick={markAbsent}>
						<Icon name="lucide:circle-check" class="size-3.5" />
						{t('roster.day_sheet_mark_absent')}
					</Button>
				{:else}
					<Button variant="ghost" size="sm" type="button" onclick={clearAttendance}>
						<Icon name="lucide:eraser" class="size-3.5" />
						{t('roster.day_sheet_clear_attendance')}
					</Button>
				{/if}
			</Cluster>
			<!-- Painted only where the version's bands read them (see `bandsRead`). -->
			{#if showRequestedBy}
				<Stack as="label" gap="xs" class="text-xs">
					<span class="text-muted-foreground">{t('component.requested_by')}</span>
					<Combobox
						class="w-40"
						size="sm"
						clearable
						placeholder="—"
						options={[
							{ value: 'EMPLOYER', label: 'EMPLOYER' },
							{ value: 'EMPLOYEE', label: 'EMPLOYEE' }
						]}
						value={requestedBy}
						onChange={(next) => (requestedBy = next)}
					/>
				</Stack>
			{/if}
			{#if showEmergency}
				<Inline as="label" gap="sm" class="text-xs"
					><input type="checkbox" bind:checked={emergency} />{t(
						'component.emergency_cause'
					)}</Inline
				>
			{/if}
			{#if showTimeOffInLieu}
				<Inline as="label" gap="sm" class="text-xs"
					><input type="checkbox" bind:checked={timeOffInLieu} />{t(
						'component.time_off_in_lieu'
					)}</Inline
				>
			{/if}
			{#if problemMessage != null}
				<Alert.Root variant="destructive">
					<Alert.Title>{t('roster.day_sheet_cannot_save')}</Alert.Title>
					<Alert.Description>{problemMessage}</Alert.Description>
				</Alert.Root>
			{/if}
		{:else}
			<!-- Read-only actual: the same numbers, with nothing to press. -->
			{@render fieldRow(
				t('roster.day_sheet_recorded'),
				(record?.worked_intervals?.length ?? 0) === 0
					? t('roster.no_attendance')
					: t('roster.attendance_intervals', { count: record?.worked_intervals?.length ?? 0 })
			)}
			{#if canReportMissingPunch}
				<Inline>
					<Button variant="outline" size="sm" type="button" onclick={reportMissingPunch}>
						<Icon name="lucide:flag" class="size-3.5" />
						{t('roster.day_sheet_report_missing_punch')}
					</Button>
				</Inline>
				<p class="text-xs text-muted-foreground">
					{t('roster.day_sheet_report_missing_punch_help')}
				</p>
			{/if}
		{/if}
		<!-- Attendance as a presence check against the plan; clock time past it is unplanned and not paid, never overtime. -->
		<p class="text-xs">
			{#if assessment.workedMinutes == null || assessment.workedMinutes === 0}
				{t('roster.day_sheet_totals_planned', { scheduled: formatDurationHours(planned, t) })}
			{:else}
				{t('roster.day_sheet_totals', {
					worked: formatDurationHours(assessment.workedMinutes, t),
					planned: formatDurationHours(planned, t),
					unplanned: formatDurationHours(unplanned, t)
				})}
			{/if}
		</p>
	</Stack>
{/snippet}

<RecordShell
	of="work_days"
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
	{...subtitle == null ? {} : { subtitle }}
	{...lockHint == null ? {} : { icon: 'lucide:lock-keyhole', hint: lockHint }}
>
	{#if employmentId == null || workDate == null}
		<Stack gap="sm">
			<Picker
				{...employmentPicker(scope?.companyId())}
				value={pickedEmployment}
				onChange={(next) => (pickedEmployment = next)}
			/>
			<DateInput value={pickedDate} onChange={(next) => (pickedDate = next)} />
		</Stack>
	{:else if identityResolved}
		{#key sheetKey}
			<div style="display: contents;" {@attach seedSheet}>
				<Stack gap="md">
					<Tabs
						tabs={[
							{
								name: 'planned',
								title: t('component.work_day_planned'),
								icon: 'lucide:calendar-range',
								body: plannedTab,
								keepAlive: true
							},
							{
								name: 'actual',
								title: t('component.work_day_actual'),
								icon: 'lucide:clock',
								body: actualTab,
								keepAlive: true
							}
						]}
					/>
					{#if notice != null}
						<Alert.Root
							variant={notice.tone}
							role={notice.tone === 'destructive' ? 'alert' : 'status'}>{notice.text}</Alert.Root
						>
					{/if}
					{#if !frozen && (mode === 'controller' || reporting)}
						<Inline justify="end">
							<Button
								type="button"
								disabled={saving || saveProblem != null}
								title={saveProblem ?? undefined}
								onclick={() => void save()}
							>
								{t(daySaveLabelKey(mode, saveIntent))}
							</Button>
						</Inline>
					{/if}
				</Stack>
			</div>
		{/key}
	{:else}
		<p class="text-sm text-muted-foreground" role="status">{t('component.loading')}</p>
	{/if}
</RecordShell>
