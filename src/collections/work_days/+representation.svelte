<script lang="ts">
	/**
	 * One person-day: the plan and the actual, on the collection's own record surface.
	 *
	 * The sheet chrome — the record label, the lock seal, the close — belongs to the framework's
	 * record sheet, and this file owns only the fields. A board cell that has a stored row opens the
	 * standard sidesheet for it; a cell that has none opens this same composition as a create, with
	 * the person and the day carried by `lib/ui/roster/day-draft.ts`. Either way the day reads the
	 * same, and every write still crosses `client.collection.work_days` and its transform.
	 *
	 * The lock is the RECORD's, read off the row itself: `payslip_id` is the pin a payroll run left,
	 * and `sourceLockRecordMetadata` publishes it to the sheet header as the seal beside the title.
	 * A paid window over a day that has no record is a fact about the day, not about this row, and
	 * the board is where it is drawn.
	 *
	 * The plan half is the controller's: an employee's `work_days` grant masks `shift_definition_id`,
	 * so the picker follows the apps the shell made visible — the same capability boundary the
	 * policies state, and never a query for a grant.
	 */
	import { Effect } from 'effect';
	import { getPlatformStateContext } from '@norbital-ai/bolt/client';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import type { RepresentationProps } from './$types.js';
	import {
		CollectionForm,
		type CollectionFormController,
		type CollectionFormSemantic
	} from '@norbital-ai/ui/collection-form';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Tabs } from '@norbital-ai/ui/tabs';
	import { Alert, AlertDescription, AlertTitle } from '@norbital-ai/ui/alert';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { client } from '../../lib/workspace-client.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { dayInstant, dateKey, PAYROLL_TIME_ZONE } from '../../lib/iso-day.js';
	import { settingsInForce } from '../../lib/jurisdiction_settings.js';
	import { onLineage } from '../../lib/ui/settings-scope.js';
	import { formatDurationHours } from '../../lib/ui/display-formatters.js';
	import {
		attendanceChanged,
		daySaveIntent,
		daySaveLabelKey,
		type AttendanceValue
	} from '../../lib/ui/roster/controller-attendance-state.js';
	import { getDayDraft } from '../../lib/ui/roster/day-draft.js';
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
	} from '../../lib/ui/roster/roster-month.js';
	import {
		applicableLimits,
		assessmentWindow,
		observedHolidayDates,
		overtimeEntitled,
		type RosterCodeFacts
	} from '../../lib/scheduling/work-limits.js';
	import {
		PATTERN_WITH,
		patternAnchor,
		patternRosterCodeId,
		termPatternRow
	} from '../../lib/scheduling/work-pattern.js';
	import { windowOvertime } from '../../lib/ui/roster/day-overtime.js';
	import { coversDate } from '../payroll_runs/lib/effective.js';
	import { personContext } from '../payroll_runs/lib/eligibility.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	const draft = getDayDraft();

	const platform = getPlatformStateContext();
	/** The controller app group owns the plan grant; self-service has the clock and nothing else. */
	const maySetSchedule = $derived(platform().apps.some((app) => app.startsWith('hr_controller/')));
	const mode = $derived<'controller' | 'employee'>(maySetSchedule ? 'controller' : 'employee');

	/* ── IDENTITY, AND THE ENTITY'S CLOCK ─────────────────────────────────────────────────────── */

	/** The person-day this sheet is about: the record's, or the draft's when it is a create. */
	const employmentId = $derived(record?.employment_id ?? draft?.employmentId() ?? null);
	const workDate = $derived(record != null ? dateKey(record.work_date) : (draft?.date() ?? null));
	const workDateInstant = $derived(workDate == null ? null : dayInstant(workDate));

	/**
	 * The employment as this sheet reads it: the number, the person behind it, and the entity whose
	 * vocabulary and clock the day is read in.
	 *
	 * The company rides the employment so the roster-code picker is scoped to the entity's own
	 * vocabulary and the timezone is the entity's own: a Jakarta punch read in Kuala Lumpur time is
	 * a day an hour off its plan.
	 *
	 * The relations ride the row through `with`; the generated query type carries only the selected
	 * columns, so the shape is stated here the way every other surface in this template states it.
	 */
	type EmploymentIdentity = WorkspaceRow<'employments'> & {
		readonly employment_employee?: { readonly name: string | null } | null;
		readonly employment_company?: {
			readonly settings_code: string | null;
			readonly region: string | null;
			readonly facts: WorkspaceRow<'companies'>['facts'];
			readonly pay_cutoff_day: number | null;
		} | null;
	};
	const employmentQuery = $derived(
		employmentId == null
			? null
			: client.db.employments.findMany({
					where: { id: { eq: employmentId } },
					columns: { id: true, employee_number: true, company_id: true },
					with: {
						employment_employee: { columns: { name: true } },
						employment_company: {
							columns: { settings_code: true, region: true, facts: true, pay_cutoff_day: true }
						}
					},
					limit: 1
				})
	);
	const employment = $derived(employmentQuery?.current?.[0] as EmploymentIdentity | undefined);
	const personLabel = $derived(
		[employment?.employee_number, employment?.employment_employee?.name]
			.filter((part) => part != null && part !== '')
			.join(' ')
	);
	const companyId = $derived(employment?.company_id ?? null);
	const settingsCode = $derived(employment?.employment_company?.settings_code ?? null);
	const settingsQuery = $derived(
		settingsCode == null
			? null
			: client.db.jurisdiction_settings.findMany({ where: onLineage(settingsCode), limit: 200 })
	);
	/**
	 * The editors are seeded from instants, so they wait for the entity's zone. Rendering them
	 * against the default zone and reseeding when the settings arrive would fight the operator's
	 * first keystrokes; the sheet holds until the identity it reads them with is known.
	 */
	const identityResolved = $derived(
		employmentId == null ||
			(employmentQuery?.current !== undefined &&
				(settingsCode == null || settingsQuery?.current !== undefined))
	);
	const settingsVersion = $derived.by(() => {
		const code = settingsCode;
		if (code == null) return null;
		try {
			return settingsInForce(settingsQuery?.current ?? [], code, workDate ?? todayKey());
		} catch {
			return null;
		}
	});
	const timeZone = $derived(settingsVersion?.payroll.timezone ?? PAYROLL_TIME_ZONE);

	/* ── THE ROSTER VOCABULARY ────────────────────────────────────────────────────────────────── */

	/**
	 * The entity's roster codes. The picker offers those effective on this day; the headroom
	 * resolves the whole window's plan, which may name a code this day does not.
	 */
	const shiftsQuery = $derived(
		companyId == null
			? null
			: client.db.shift_definitions.findMany({
					where: { company_id: { eq: companyId } },
					orderBy: { code: 'asc' },
					limit: 500
				})
	);
	const shiftsById = $derived(new Map((shiftsQuery?.current ?? []).map((code) => [code.id, code])));
	const rosterCodeOptions = $derived(
		(shiftsQuery?.current ?? [])
			.filter((code) => workDate == null || coversDate(code.effective_range, workDate))
			.map((code) => {
				const kind = rosterCodeKind(code.variant);
				const window = kind === 'WORK' ? workWindow(code.variant) : null;
				return {
					value: code.id,
					label:
						window == null
							? `${code.code} · ${kind}`
							: `${code.code} · ${t('roster.shift_window', {
									start: window.start_time,
									end: window.end_time,
									break: window.break_minutes / 60
								})}`,
					search_term: `${code.code} ${code.name} ${window?.start_time ?? ''} ${window?.end_time ?? ''}`
				};
			})
	);

	/* ── THE PLAN ─────────────────────────────────────────────────────────────────────────────── */

	let draftCodeId = $state<string | null>(null);
	let baselineCodeId = $state<string | null>(null);

	/** The picker's value for "no override": the work pattern decides the day. */
	const PATTERN_OPTION = '__pattern__';
	/** What the work pattern projects on this day; the plan the day follows without an override. */
	const patternCodeId = $derived.by(() => {
		if (workDate == null) return null;
		const term = (termsQuery?.current ?? []).find((row) =>
			coversDate(row.effective_range, workDate)
		);
		const row = term == null ? null : termPatternRow(term);
		return row == null ? null : patternRosterCodeId(row.pattern, workDate, patternAnchor(row));
	});
	/** The code the day is planned on: its own override, else the pattern's. */
	const effectiveCodeId = $derived(draftCodeId ?? patternCodeId);
	const effectiveKind = $derived.by(() => {
		const code = effectiveCodeId == null ? null : shiftsById.get(effectiveCodeId);
		return code == null ? null : rosterCodeKind(code.variant);
	});
	const planOptions = $derived([
		{
			value: PATTERN_OPTION,
			label:
				patternCodeId == null
					? t('roster.no_work_pattern')
					: t('roster.follow_work_pattern', {
							code:
								rosterCodeOptions.find((option) => option.value === patternCodeId)?.label ??
								shiftsById.get(patternCodeId)?.code ??
								''
						})
		},
		...rosterCodeOptions
	]);

	const selectedWindow = $derived.by(() => {
		const code = effectiveCodeId == null ? null : shiftsById.get(effectiveCodeId);
		if (code == null) return null;
		return rosterCodeKind(code.variant) === 'WORK' ? workWindow(code.variant) : null;
	});
	/** Always an object, so the totals below read a day with no plan as a planned zero, not a gap. */
	const plannedShift = $derived({
		shiftStart: selectedWindow?.start_time ?? null,
		shiftEnd: selectedWindow?.end_time ?? null,
		shiftBreakMinutes: selectedWindow?.break_minutes ?? null
	});

	const settled = $derived(record?.payslip_id != null);
	const frozen = $derived(settled);
	const lock = $derived(
		record == null
			? ({ kind: 'NONE' } as const)
			: sourceLock({
					existing: true,
					approvalId: record.approval_id,
					dates: [],
					settledBy: settled ? { period: null } : null,
					datePassed: 'IS_NOT_A_LOCK'
				})
	);
	const recordMetadata = $derived(sourceLockRecordMetadata(lock, t));

	const planWritable = $derived(mode === 'controller' && !frozen);
	/** Choosing the pattern clears the override: a change like any other, saved with the form. */
	const planTouched = $derived(planWritable && draftCodeId !== baselineCodeId);

	/* ── THE ACTUAL ───────────────────────────────────────────────────────────────────────────── */

	/**
	 * An interval while it is being edited: minutes from the start of the work date.
	 *
	 * Not instants. An operator types a wall clock, and the conversion between a clock and an instant
	 * needs the work date and the business zone — both fixed for the whole sheet. Held as minutes, a
	 * night shift ending at 02:00 is simply 1560 rather than a second date the form has to keep
	 * consistent with the first, and the round trip is exact arithmetic with no timezone in it.
	 */
	type EditableInterval = { startMinutes: number | null; endMinutes: number | null };

	let draftIntervals = $state<EditableInterval[]>([]);
	let draftAttendanceRecorded = $state(false);
	let baselineAttendance = $state<AttendanceValue>({ intervals: null });
	/**
	 * The day's planned overtime, keyed as ONE figure. The statute decides the split, not the
	 * operator: the hours within the day's headroom are approved overtime, the rest incentive
	 * hours — the same split the import makes (`splitPlannedOvertime`). Null is none planned.
	 */
	let draftOvertime = $state<number | null>(null);
	/** Self-service only: the operator has asked to report a punch on a day that has none. */
	let reporting = $state(false);

	/** The identity of the sheet, so a new person-day re-seeds the editors. */
	const sheetKey = $derived(`${employmentId ?? ''}:${workDate ?? ''}`);

	/** Seed the editors from the record. Runs on mount, and again whenever the keyed block remounts. */
	function seedSheet(): void {
		reporting = false;
		draftCodeId = record?.shift_definition_id ?? null;
		baselineCodeId = record?.shift_definition_id ?? null;
		const storedApproved = storedHours(record?.approved_overtime_hours);
		const storedIncentive = storedHours(record?.incentive_hours);
		draftOvertime =
			storedApproved == null && storedIncentive == null
				? null
				: (storedApproved ?? 0) + (storedIncentive ?? 0);
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
	 * Self-service's one affordance: a rostered day with nothing recorded, on a day that is not
	 * locked. A base day is read-only for the employee — the pattern projects it and payroll takes
	 * it as worked to plan — so there is nothing to punch against until HR writes a row for it.
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

	/* ── THE ASSESSMENT WINDOW ─────────────────────────────────────────────────────────────── */

	/**
	 * The pay's assessment window around this day (the entity's `pay_cutoff_day`: Nihon's 21st to
	 * 20th) and what the headroom reads inside it: the employment's stored days, its terms and their
	 * pattern, its rosters of record, and the published holidays. Read for the plan's writer only.
	 */
	const overtimeWindow = $derived(
		!planWritable || workDate == null || employment == null
			? null
			: assessmentWindow(workDate, employment.employment_company?.pay_cutoff_day ?? 1)
	);
	const windowDaysQuery = $derived(
		overtimeWindow == null || employmentId == null
			? null
			: client.db.work_days.findMany({
					where: {
						employment_id: { eq: employmentId },
						work_date: {
							gte: dayInstant(overtimeWindow.start),
							lte: dayInstant(overtimeWindow.end)
						}
					},
					columns: {
						work_date: true,
						shift_definition_id: true,
						approved_overtime_hours: true,
						emergency_cause: true
					},
					limit: 62
				})
	);
	const rostersQuery = $derived(
		overtimeWindow == null || employmentId == null
			? null
			: client.db.rosters.findMany({
					where: {
						employment_id: { eq: employmentId },
						period: {
							in: [...new Set([overtimeWindow.start, overtimeWindow.end])].map((date) =>
								date.slice(0, 7)
							)
						}
					},
					columns: { period: true },
					limit: 12
				})
	);
	const termsQuery = $derived(
		overtimeWindow == null || employmentId == null
			? null
			: client.db.employment_terms.findMany({
					where: { employment_id: { eq: employmentId } },
					columns: {
						effective_range: true,
						shift_pattern_id: true,
						employment_type: true,
						work_classification: true,
						base_salary: true,
						statutory_work_category: true,
						pay_frequency: true,
						allowances: true
					},
					with: { term_shift_pattern: PATTERN_WITH },
					limit: 100
				})
	);
	/** The classes of the allowances the terms list: each counts toward the overtime rule's wage as payroll counts it. */
	const listedAllowanceIds = $derived([
		...new Set(
			(termsQuery?.current ?? []).flatMap((term) =>
				Array.isArray(term.allowances)
					? (term.allowances as readonly { readonly catalogue_id: string }[]).map(
							(row) => row.catalogue_id
						)
					: []
			)
		)
	]);
	const allowanceClassesQuery = $derived(
		listedAllowanceIds.length === 0
			? null
			: client.db.allowance_catalogue.findMany({
					where: { id: { in: listedAllowanceIds } },
					columns: { id: true, destination: true, direction: true },
					limit: 100
				})
	);
	const holidaysQuery = $derived(
		overtimeWindow == null || companyId == null
			? null
			: client.db.jurisdiction_holidays.findMany({
					where: {
						company_id: { eq: companyId },
						date: {
							gte: dayInstant(overtimeWindow.start),
							lte: dayInstant(overtimeWindow.end)
						},
						published_at: { isNotNull: true },
						approval_id: { isNull: true }
					},
					columns: {
						id: true,
						company_id: true,
						date: true,
						name: true,
						kind: true,
						replaces: true,
						given_to: true,
						published_at: true
					},
					limit: 62
				})
	);

	/**
	 * The most approved overtime this day can hold, and whether the person is owed overtime pay for
	 * it: the transform's own headroom over the assessment window and the person's applicable
	 * limits (`windowOvertime`), on the holidays payroll observes (`observedHolidayDates`).
	 */
	const overtimeHeadroom = $derived.by(() => {
		const rules = settingsVersion?.work_rules;
		const terms = termsQuery?.current ?? [];
		const termOn = (date: string) => terms.find((term) => coversDate(term.effective_range, date));
		const entity = employment?.employment_company;
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
			const kind = rosterCodeKind(code.variant);
			const window = kind === 'WORK' ? workWindow(code.variant) : null;
			if (kind !== 'WORK')
				codeById.set(code.id, {
					kind,
					paid_minutes: 0,
					break_minutes: 0,
					spread_hours: 0,
					statutory_rest: code.variant.kind === 'REST' && code.variant.statutory === true
				});
			else if (window != null)
				codeById.set(code.id, {
					kind,
					paid_minutes: window.paid_minutes,
					break_minutes: window.break_minutes,
					spread_hours: window.elapsed_minutes / 60
				});
		}
		const stored = (windowDaysQuery?.current ?? []).map((row) => ({
			date: dateKey(row.work_date),
			shift_definition_id: row.shift_definition_id ?? null,
			approved: storedHours(row.approved_overtime_hours) ?? 0,
			emergency: row.emergency_cause === true
		}));
		const date = workDate ?? '';
		const window = overtimeWindow ?? { start: date, end: date };
		const cutoffDay = employment?.employment_company?.pay_cutoff_day ?? 1;
		const patternOn = (day: string) => {
			const term = termOn(day);
			const row = term == null ? null : termPatternRow(term);
			return row == null ? null : { pattern: row.pattern, anchor: patternAnchor(row) };
		};
		let holidays: ReadonlySet<string> = new Set();
		try {
			holidays = observedHolidayDates({
				dates: [date],
				cutoffDay,
				companyId: companyId ?? '',
				holidays: holidaysQuery?.current ?? [],
				codes: [...shiftsById.values()],
				precedence: rules?.holiday_rest_precedence,
				plans: [
					...stored
						.filter((day) => day.date !== date)
						.map((day) => ({ work_date: day.date, shift_definition_id: day.shift_definition_id })),
					{ work_date: date, shift_definition_id: draftCodeId }
				],
				rosterPeriods: (rostersQuery?.current ?? []).map((row) => row.period),
				patternOn
			});
		} catch {
			// A plan the schedule cannot resolve (a code not in force on a date) observes nothing
			// here; the save is judged by the transform, and a run refuses it by name.
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
				holidays,
				limits,
				cutoffDay
			}),
			holiday: holidays.has(date),
			entitled:
				workDate == null ||
				overtimeEntitled(rules?.overtime_when, person(workDate), (id) =>
					(allowanceClassesQuery?.current ?? []).find((row) => row.id === id)
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
	/**
	 * The company holiday worked by a person the overtime rule does not cover: no overtime is paid,
	 * so HR grants an off-in-lieu day. Never created here.
	 */
	const holidayWithoutOvertime = $derived(
		overtimeHeadroom.holiday &&
			!overtimeHeadroom.entitled &&
			((draftApproved ?? 0) + (draftIncentive ?? 0) > 0 ||
				draftIntervals.some((interval) => interval.startMinutes != null))
	);
	/** The plan the clock is checked against: the shift plus the overtime planned on the day. */
	const planned = $derived(
		plannedMinutes({
			...plannedShift,
			approvedOvertimeHours: draftApproved,
			incentiveHours: draftIncentive
		})
	);
	/** Clock time past that plan: unplanned, and not paid. */
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

	/**
	 * The refusal to show, or null.
	 *
	 * Silent while the editor is empty: a controller opening a day nobody has punched has not done
	 * anything wrong, and `NO_INTERVALS` shouted at them in destructive red would say they had.
	 */
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
		if (record == null) return undefined;
		const plannedCode =
			record.shift_definition_id == null
				? null
				: (shiftsById.get(record.shift_definition_id) ?? null);
		const kind = plannedCode == null ? null : rosterCodeKind(plannedCode.variant);
		const intervals = record.worked_intervals;
		const state =
			intervals == null
				? kind == null
					? t('roster.unrostered')
					: kind === 'WORK'
						? t('roster.planned')
						: kind === 'REST'
							? t('roster.rest_day')
							: t('roster.off_day')
				: intervals.length === 0
					? t('roster.absent')
					: intervals.some((interval) => interval.end == null)
						? t('roster.open_punch')
						: t('roster.attended');
		return personLabel === '' ? state : `${personLabel} · ${state}`;
	});

	/**
	 * The form's baseline: the stored row when one exists, the draft's identity when none does.
	 *
	 * An update is routed by `id`; a create by employment plus day, both in their stored form so the
	 * unique person-day key cannot be missed by a day-precision instant read in the host's zone.
	 */
	const formDefaults = $derived.by(() => {
		if (record != null) return record;
		if (employmentId == null || workDateInstant == null) return undefined;
		return { employment_id: employmentId, work_date: workDateInstant };
	});

	/**
	 * The three statutory flags exist for the jurisdictions whose overtime bands read them —
	 * `requested_by` (SG, ID) only on a rest day, `emergency_cause` and `time_off_in_lieu` (TW).
	 * A version whose bands never name one leaves it registered but unpainted: asking an operator
	 * a question payroll never reads is noise.
	 */
	const bandText = $derived(
		(settingsVersion?.work_rules?.bands ?? [])
			.flatMap((band) => [band.when ?? '', band.take_hours, band.price_amount])
			.join('\n')
	);
	const bandsRead = (name: string) => new RegExp(`\\b${name}\\b`).test(bandText);
	const showRequestedBy = $derived(bandsRead('requested_by') && effectiveKind === 'REST');
	const showEmergency = $derived(bandsRead('emergency_cause'));
	const showTimeOffInLieu = $derived(bandsRead('time_off_in_lieu'));

	/** The identity is a fact of the cell, not a field: shown, never edited. */
	const identityFixed = $derived(employmentId != null);

	/**
	 * The guards the write path will apply, as form validation.
	 *
	 * Interval attendance is gated on the same assessment the transform makes. The two interval-free
	 * states are intentional exceptions: `[]` is reviewed-no-work and `null` is explicit clearing,
	 * neither of which should be rejected as a missing interval. An untouched create is refused so
	 * the board's create sheet cannot land an empty person-day row.
	 */
	const daySemantic: CollectionFormSemantic = () =>
		Effect.sync(() => {
			if (!planTouched && !attendanceTouched && !overtimeTouched)
				return [{ message: t('roster.day_sheet_cannot_save') }];
			if (!attendanceTouched) return;
			if (missingIntervalStart) return [{ message: t('roster.day_sheet_problem_missing_start') }];
			if (draftIntervals.length === 0) return;
			const problem = assessment.problem;
			if (problem != null) return [{ message: t(ATTENDANCE_DRAFT_PROBLEM_KEY[problem]) }];
			return;
		});

	/** Mirror the plan half into the form; the picker is custom composition. */
	function pushPlan(form: CollectionFormController): void {
		form.setValues({ shift_definition_id: draftCodeId });
		// The headroom follows the plan, so the split of a keyed figure may move with it.
		pushOvertime(form);
	}

	/**
	 * Mirror the actual half into the form. `null` intervals are explicit clearing; untouched
	 * editors never call this, so the column stays `undefined` and rides past the write.
	 */
	function pushAttendance(form: CollectionFormController): void {
		form.setValues({ worked_intervals: draftAttendanceRecorded ? draftIntervalValues : null });
	}

	/**
	 * Mirror the two planned figures into the form. Null clears one; the inputs offer the half-hour
	 * step, and the write path enforces the headroom and the day's own bound.
	 */
	function pushOvertime(form: CollectionFormController): void {
		form.setValues({ approved_overtime_hours: draftApproved, incentive_hours: draftIncentive });
	}

	function hoursValue(value: string): number | null | undefined {
		if (value.trim() === '') return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	function clockValue(minutes: number | null): string {
		return minutes == null ? '' : dayMinutesToClock(minutes);
	}

	function setStart(index: number, clock: string): void {
		const interval = draftIntervals[index];
		if (interval == null) return;
		if (clock === '') {
			draftIntervals = draftIntervals.map((entry, position) =>
				position === index ? { ...entry, startMinutes: null } : entry
			);
			return;
		}
		const minutes = clockToDayMinutes(clock, dayMinutesOffsetDays(interval.startMinutes ?? 0));
		if (minutes == null) return;
		// A fresh array: `$state` ignores a mutation-in-place that leaves the reference identical.
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index ? { ...entry, startMinutes: minutes } : entry
		);
	}

	function setEnd(index: number, clock: string): void {
		const interval = draftIntervals[index];
		if (interval == null) return;
		if (clock === '') {
			draftIntervals = draftIntervals.map((entry, position) =>
				position === index ? { ...entry, endMinutes: null } : entry
			);
			return;
		}
		const offset = dayMinutesOffsetDays(interval.endMinutes ?? interval.startMinutes ?? 0);
		const minutes = clockToDayMinutes(clock, offset);
		if (minutes == null) return;
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index ? { ...entry, endMinutes: minutes } : entry
		);
	}

	/**
	 * Move an end onto the following morning, or back off it.
	 *
	 * A night shift needs this and nothing else does, so it is one toggle per end rather than a date
	 * picker on every field — the work date is already the sheet's subject, and offering to change it
	 * per interval would invite a punch to be filed against a day it does not belong to.
	 */
	function shiftEndDay(index: number, days: number): void {
		draftIntervals = draftIntervals.map((entry, position) =>
			position === index && entry.endMinutes != null
				? { ...entry, endMinutes: entry.endMinutes + days * DAY_MINUTES }
				: entry
		);
	}

	function addInterval(): void {
		const previous = draftIntervals.at(-1);
		const scheduledStart =
			selectedWindow == null ? 9 * 60 : (clockToDayMinutes(selectedWindow.start_time, 0) ?? 9 * 60);
		const scheduledEnd =
			selectedWindow == null
				? scheduledStart + 8 * 60
				: (clockToDayMinutes(selectedWindow.end_time, 0) ?? scheduledStart + 8 * 60);
		// The first interval is a suggestion of the planned window, not a persisted fact. Subsequent
		// intervals begin where the preceding split ended and stay intentionally short for editing.
		const start = previous?.endMinutes ?? scheduledStart;
		const end =
			previous == null
				? scheduledEnd <= start
					? scheduledEnd + DAY_MINUTES
					: scheduledEnd
				: start + 60;
		draftAttendanceRecorded = true;
		draftIntervals = [...draftIntervals, { startMinutes: start, endMinutes: end }];
	}

	function removeInterval(index: number): void {
		draftAttendanceRecorded = true;
		draftIntervals = draftIntervals.filter((_entry, position) => position !== index);
	}

	/** Mark the day absent: a deliberate reviewed-no-work fact without an interval. */
	function markAbsent(): void {
		draftAttendanceRecorded = true;
		draftIntervals = [];
	}

	/** Return actual attendance to the distinct unrecorded `null` state. */
	function clearAttendance(): void {
		draftAttendanceRecorded = false;
		draftIntervals = [];
	}

	/**
	 * Self-service's one write: pre-fill the day the roster says it should have been, then let the
	 * person correct it.
	 */
	function reportMissingPunch(): void {
		reporting = true;
		if (draftIntervals.length > 0) return;
		const start =
			selectedWindow == null ? 9 * 60 : (clockToDayMinutes(selectedWindow.start_time, 0) ?? 9 * 60);
		const end =
			selectedWindow == null
				? start + 480
				: (clockToDayMinutes(selectedWindow.end_time, 0) ?? start + 480);
		draftIntervals = [{ startMinutes: start, endMinutes: end <= start ? end + DAY_MINUTES : end }];
		draftAttendanceRecorded = true;
	}
</script>

{#snippet fieldRow(label: string, value: string)}
	<Inline gap="sm" align="baseline" class="text-xs">
		<span class="min-w-28 shrink-0 text-muted-foreground">{label}</span>
		<span class="min-w-0 break-words">{value}</span>
	</Inline>
{/snippet}

<!--
	No record actions: returning the day to its work pattern is the picker's first option, saved with
	the rest of the sheet. The person and the day are the sheet's title and subtitle, and the lock is
	the header's seal (`recordMetadata`), so none of them is repeated in the body.
-->
<RecordShell {subtitle}>
	{#if identityResolved}
		{#key sheetKey}
			<div style="display: contents;" {@attach seedSheet}>
				<CollectionForm
					{client}
					collection="work_days"
					notice="header"
					{recordMetadata}
					defaultValues={formDefaults}
					submitLabel={t(daySaveLabelKey(mode, saveIntent))}
					semantic={daySemantic}
					failure_message={t('roster.day_sheet_save_failed')}
					onAfterSubmit={record == null ? close : undefined}
				>
					{#snippet children({ Field, form })}
						<!-- Identity registers exactly once; a cell already names the person and the day. -->
						<Field
							name="employment_id"
							hidden={identityFixed}
							label={t('component.person')}
							relationOptions={employmentRelationOptions(scopedCompanyId)}
						/>
						<Field name="work_date" hidden={identityFixed} label={t('component.day')} />
						<Field name="shift_definition_id" hidden />
						<Field name="worked_intervals" hidden />
						<Field name="approved_overtime_hours" hidden />
						<Field name="incentive_hours" hidden />

						{#snippet planned()}
							<Stack gap="md">
								{#if mode === 'controller'}
									<Combobox
										ariaLabel={t('roster.choose_roster_code')}
										options={planOptions}
										value={draftCodeId ?? PATTERN_OPTION}
										disabled={!planWritable}
										allowClear={false}
										preserveOptionOrder
										onValueChange={(value) => {
											draftCodeId = value == null || value === PATTERN_OPTION ? null : value;
											pushPlan(form);
										}}
										searchPlaceholder={t('roster.search_roster_codes')}
									/>
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
								<!--
									Overtime is PLANNED on the day. One figure: the statute splits it into approved
									overtime (within the headroom) and incentive hours (beyond it).
								-->
								<FormSection
									title={t('roster.day_sheet_planned_overtime')}
									hint={t('roster.day_sheet_approved_overtime_description')}
									first
								>
									{#if planWritable}
										<Input
											type="number"
											min="0"
											max="24"
											step="0.5"
											class="w-28"
											aria-label={t('roster.day_sheet_planned_overtime')}
											value={draftOvertime ?? ''}
											oninput={(event) => {
												const next = hoursValue(event.currentTarget.value);
												if (next === undefined) return;
												draftOvertime = next;
												pushOvertime(form);
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
											<Alert data-holiday-without-overtime>
												<AlertDescription>
													{t('roster.day_sheet_holiday_without_overtime', {
														person: personLabel,
														date: workDate ?? ''
													})}
												</AlertDescription>
											</Alert>
										{/if}
									{:else}
										{@render fieldRow(
											t('roster.day_sheet_approved_overtime'),
											(storedHours(record?.approved_overtime_hours) ?? 0) > 0
												? formatDurationHours(
														(storedHours(record?.approved_overtime_hours) ?? 0) * 60,
														t
													)
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
							</Stack>
						{/snippet}

						{#snippet actual()}
							<Stack gap="md">
								{#if attendanceWritable}
									{#each draftIntervals as interval, index (index)}
										<Cluster gap="xs" align="center" class="text-xs">
											<span class="min-w-16 shrink-0 text-muted-foreground">
												{t('roster.day_sheet_interval', { number: index + 1 })}
											</span>
											<Input
												type="time"
												required
												class="w-28"
												aria-label={t('roster.day_sheet_interval_start', { number: index + 1 })}
												value={clockValue(interval.startMinutes)}
												oninput={(event) => {
													setStart(index, event.currentTarget.value);
													pushAttendance(form);
												}}
											/>
											<span aria-hidden="true">→</span>
											<Input
												type="time"
												class="w-28"
												aria-label={t('roster.day_sheet_interval_end', { number: index + 1 })}
												value={clockValue(interval.endMinutes)}
												oninput={(event) => {
													setEnd(index, event.currentTarget.value);
													pushAttendance(form);
												}}
											/>
											{#if interval.endMinutes != null}
												<!-- The night-shift affordance: one toggle, not a date picker per field. -->
												<Button
													variant={dayMinutesOffsetDays(interval.endMinutes) > 0
														? 'default'
														: 'ghost'}
													size="sm"
													type="button"
													aria-pressed={dayMinutesOffsetDays(interval.endMinutes) > 0}
													title={t('roster.day_sheet_next_day')}
													onclick={() => {
														shiftEndDay(
															index,
															dayMinutesOffsetDays(interval.endMinutes ?? 0) > 0 ? -1 : 1
														);
														pushAttendance(form);
													}}
												>
													+1d
												</Button>
											{/if}
											<Button
												variant="ghost"
												size="icon"
												type="button"
												aria-label={t('roster.day_sheet_remove_interval', { number: index + 1 })}
												onclick={() => {
													removeInterval(index);
													pushAttendance(form);
												}}
											>
												<IconWrapper name="lucide:x" class="size-3.5" />
											</Button>
										</Cluster>
									{/each}
									{#if draftAttendanceRecorded && draftIntervals.length === 0}
										<Alert>
											<AlertTitle>{t('roster.day_sheet_absent')}</AlertTitle>
											<AlertDescription>
												{t('roster.day_sheet_absent_description')}
											</AlertDescription>
										</Alert>
									{:else if !draftAttendanceRecorded}
										<p class="text-xs text-muted-foreground">
											{t('roster.day_sheet_unrecorded_attendance')}
										</p>
									{/if}

									<Cluster gap="xs">
										<Button
											variant="outline"
											size="sm"
											type="button"
											onclick={() => {
												addInterval();
												pushAttendance(form);
											}}
										>
											<IconWrapper name="lucide:plus" class="size-3.5" />
											{t('roster.day_sheet_add_interval')}
										</Button>
										{#if !draftAttendanceRecorded}
											<Button
												variant="outline"
												size="sm"
												type="button"
												onclick={() => {
													markAbsent();
													pushAttendance(form);
												}}
											>
												<IconWrapper name="lucide:circle-check" class="size-3.5" />
												{t('roster.day_sheet_mark_absent')}
											</Button>
										{/if}
										{#if draftAttendanceRecorded}
											<Button
												variant="ghost"
												size="sm"
												type="button"
												onclick={() => {
													clearAttendance();
													pushAttendance(form);
												}}
											>
												<IconWrapper name="lucide:eraser" class="size-3.5" />
												{t('roster.day_sheet_clear_attendance')}
											</Button>
										{/if}
									</Cluster>
									<!-- Painted only where the version's bands read them (see `bandsRead`). -->
									<Field
										name="requested_by"
										label={t('component.requested_by')}
										hidden={!showRequestedBy}
									/>
									<Field
										name="emergency_cause"
										label={t('component.emergency_cause')}
										hidden={!showEmergency}
									/>
									<Field
										name="time_off_in_lieu"
										label={t('component.time_off_in_lieu')}
										hidden={!showTimeOffInLieu}
									/>

									{#if problemMessage != null}
										<Alert variant="destructive">
											<AlertTitle>{t('roster.day_sheet_cannot_save')}</AlertTitle>
											<AlertDescription>{problemMessage}</AlertDescription>
										</Alert>
									{/if}
								{:else}
									<!-- Read-only actual: the same numbers, with nothing to press. -->
									<Field name="requested_by" hidden />
									<Field name="emergency_cause" hidden />
									<Field name="time_off_in_lieu" hidden />
									{@render fieldRow(
										t('roster.day_sheet_recorded'),
										(record?.worked_intervals?.length ?? 0) === 0
											? t('roster.no_attendance')
											: t('roster.attendance_intervals', {
													count: record?.worked_intervals?.length ?? 0
												})
									)}
									{#if canReportMissingPunch}
										<Inline>
											<Button
												variant="outline"
												size="sm"
												type="button"
												onclick={() => {
													reportMissingPunch();
													pushAttendance(form);
												}}
											>
												<IconWrapper name="lucide:flag" class="size-3.5" />
												{t('roster.day_sheet_report_missing_punch')}
											</Button>
										</Inline>
										<p class="text-xs text-muted-foreground">
											{t('roster.day_sheet_report_missing_punch_help')}
										</p>
									{/if}
								{/if}

								<!--
						Attendance as a presence check against the plan (shift plus planned overtime), and
						the only place a length-of-day figure appears. Clock time past the plan is shown as
						unplanned and is not paid; it is never overtime.
					-->
								<p class="text-xs">
									{#if assessment.workedMinutes == null || assessment.workedMinutes === 0}
										{t('roster.day_sheet_totals_planned', {
											scheduled: formatDurationHours(planned, t)
										})}
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

						<!-- Every Field stays mounted in both tabs: validation and submit read all of them. -->
						<Tabs
							variant="underline"
							flush
							animate={false}
							lazyLoad={false}
							keepAlive
							config={[
								{
									name: 'planned',
									label: t('component.work_day_planned'),
									icon: 'lucide:calendar-range',
									description: t('component.work_day_planned_description'),
									content: planned
								},
								{
									name: 'actual',
									label: t('component.work_day_actual'),
									icon: 'lucide:clock',
									description: t('component.work_day_actual_description'),
									content: actual
								}
							]}
						/>
					{/snippet}
				</CollectionForm>
			</div>
		{/key}
	{:else}
		<p class="text-sm text-muted-foreground" role="status">{t('component.loading')}</p>
	{/if}
</RecordShell>
