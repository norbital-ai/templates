import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import model from './+model.js';
import { boundToContract } from '../../lib/employment-contract.js';
import { canonicalDays, dateKey, dayInstant } from '../../lib/iso-day.js';
import { addDays, monthBounds } from '../payroll_runs/lib/dates.js';
import { settingsInForce } from '../../lib/jurisdiction_settings.js';
import { selectBreakRule } from '../../lib/scheduling/rest-break.js';
import { leaveCoverage, type LeaveRequestLike } from '../../lib/scheduling/leave-coverage.js';
import {
	patternAnchor,
	patternRosterCodeId,
	termPatternRow,
	type ShiftPatternLike
} from '../../lib/scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
import {
	applicableLimits,
	assessmentWindow,
	plannedDay,
	breachSentence,
	observedHolidayDates,
	overtimeHeadroom,
	projectedLimitBreaches,
	projectionBounds,
	type RosterCodeFacts,
	type SchedulePlanDay
} from '../../lib/scheduling/work-limits.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import { isEligible, personContext } from '../payroll_runs/lib/eligibility.js';
import {
	assertNotCaptured,
	assertNotSettled,
	attendanceRecorded,
	payrollWindows,
	planChanges
} from '../../lib/scheduling/lock.js';
import { assertNoOverlap, overlapDataFrom } from './lib/assignment-overlap.js';
import {
	assertMonthConformsToPattern,
	assertRunHasRestDay,
	type PlanChange,
	type StatutoryWeeklyRestRule
} from './lib/schedule-rules.js';
import { isRestLimit, type WorkRules } from '../../datatypes/work_rules/+definition.js';

/**
 * Which person, which day, the plan, the clock, the approved overtime, and who asked for a rest
 * day's work — the fact a rest-day rate turns on. `payslip_id` is the payroll run's pin.
 */
const columns = {
	employment_id: true,
	work_date: true,
	shift_definition_id: true,
	worked_intervals: true,
	approved_overtime_hours: true,
	incentive_hours: true,
	requested_by: true,
	emergency_cause: true,
	time_off_in_lieu: true
} as const;

const QUERY_LIMIT = 20_000;
/**
 * How far either side of a touched month the roster is read, so a consecutive-work run that starts
 * in the previous month is seen whole. It is the schema's ceiling on the rest limit's `max_days`
 * (30) plus one, which makes it provably sufficient for every rule the schema can express.
 */
const REST_RUN_PAD_DAYS = 31;

/** The jurisdiction version columns `settingsInForce`, the rest-day and the break rules read. */
type SettingsVersionRow = {
	readonly id: string;
	readonly code: string;
	readonly name: string | null;
	readonly jurisdiction_code: string;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
	readonly approval_id: string | null;
	readonly effective_range: unknown;
	readonly work_rules?: {
		readonly limits: WorkRules['limits'];
		readonly bands?: WorkRules['bands'];
		readonly authority?: string | null;
		readonly holiday_rest_precedence?: WorkRules['holiday_rest_precedence'];
		readonly breaks?: readonly {
			readonly when: string;
			readonly owed_minutes: string;
			readonly counts_as_worked_time: boolean | null;
		}[];
	} | null;
};

type WorkDayCoordinate = Readonly<{
	employment_id: string;
	work_date: string;
	shift_definition_id: string | null;
}>;

/**
 * One writer wins the day: attendance must not record work on a day approved leave already owns.
 * Half-day leave still allows the other half, which is why only fully covered dates refuse.
 */
function refuseIfLeaveOwnsDay(requests: readonly LeaveRequestLike[], workDate: string): void {
	const date = dateKey(workDate);
	const covering = requests.find((request) => leaveCoverage(request, date).fullDay);
	if (covering != null)
		refuse(
			`${date} is covered by approved leave ${dateKey(covering.from_date)} → ` +
				`${dateKey(covering.to_date)} for this employment. Attendance on a leave day is not ` +
				'recorded; amend or cancel that leave first.'
		);
}

/**
 * Attendance is an ordered set of observations. It does not classify any interval as overtime:
 * premium work is derived later from these intervals, the effective schedule and statutory rules.
 *
 * NULL is a work day with no attendance recorded — a plan and nothing else — and there is nothing
 * to validate about it. `[]` is a day that WAS read and produced no work, which the rules below
 * accept as the settled statement it is.
 */
function assertWorkedIntervals(value: readonly WorkedInterval[] | null | undefined): void {
	if (value == null) return;
	let previousEnd = Number.NEGATIVE_INFINITY;
	for (const [index, interval] of value.entries()) {
		const startedAt = Date.parse(interval.start);
		const endedAt = interval.end == null ? null : Date.parse(interval.end);
		if (index > 0 && startedAt < previousEnd)
			refuse('Worked intervals must be in time order and cannot overlap.');
		if (endedAt == null) {
			if (index !== value.length - 1) refuse('Only the final worked interval may still be open.');
			previousEnd = Number.POSITIVE_INFINITY;
			continue;
		}
		if (endedAt <= startedAt)
			refuse('Each worked interval must end after it starts, including work across midnight.');
		previousEnd = endedAt;
	}
}

/**
 * Approved overtime and incentive hours are each keyed in half-hour steps — the unit the scheduler
 * works in and the unit the payroll input is read in — and a day cannot hold more of them together
 * than a day has hours. They are not judged against the clock: the plan is the record, and
 * attendance only confirms the day was worked.
 */
function assertPlannedHours(
	approved: number | string | null | undefined,
	incentive: number | string | null | undefined
): void {
	let sum = 0;
	for (const [label, stated] of [
		['Approved overtime', approved],
		['Incentive hours', incentive]
	] as const) {
		if (stated == null) continue;
		// A numeric column reads back as a string; the stated figure may be either.
		const value = Number(stated);
		if (!Number.isFinite(value) || value < 0)
			refuse(`${label} must be zero or a positive number of hours.`);
		if (Math.round(value * 2) !== value * 2)
			refuse(`${label} is keyed in half-hour steps — 0.5, 1, 1.5, and so on.`);
		sum += value;
	}
	if (sum > 24)
		refuse('Approved overtime and incentive hours cannot exceed the 24 hours a day has.');
}

/**
 * One person-day, and the two halves that land on it.
 *
 * The plan half is `shift_definition_id`; the actual half is `worked_intervals`. Either may be
 * absent — `shift_definition_id` non-NULL is the presence test for a plan, and `worked_intervals`
 * NULL means no attendance was recorded, which is a different fact from `[]`.
 *
 * The transform requires ordered, non-overlapping worked intervals with only the final one open;
 * refuses attendance on a day approved leave owns or inside a paid run's window whose scheduled
 * attendance that run already settled; refuses any change to a row a payroll run has taken into
 * account; refuses a planned shift that would overlap the person's adjacent-day assignments;
 * refuses a plan change under recorded attendance unless the same write restates the attendance;
 * and — for a month with no roster of record — refuses a plan write that would leave the month's
 * WORK-day count or paid minutes different from what the work pattern projects. Statutory rest
 * and break rules, and a shift's own hours or spread-over above a limit, refuse any plan, rostered
 * or not; planned overtime never does. Deleting a day a run took into account is refused by the
 * delete grant (`lib/policy_grants.ts`).
 *
 * Overtime: a write keys `approved_overtime_hours` and `incentive_hours` apart, and the transform
 * stores them as keyed — it never moves hours between the two. A write that changes a plan or the
 * approved hours is refused where any day of the employment's ceiling periods would then hold more
 * approved overtime than its statutory headroom (`overtimeHeadroom`), a later stored day included;
 * the refusal names the days, the limit and the most each may hold. Incentive hours need no limit.
 *
 * Two waves: the people, their terms, the months around the write, the leave and payslips over
 * them, the rosters of record and every settings version; then the entities' runs, roster codes
 * and patterns, and the wider projection the hour ceilings ask for.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const coordinates: WorkDayCoordinate[] = [];
			const changes: PlanChange[] = [];
			// The approved overtime the write keys, by person-day: it spends the limits' headroom, so
			// a write that changes it is judged like a plan change.
			const ownApprovedByKey = new Map<string, number>();
			// The emergency flag each written person-day will carry: its hours sit outside the ceilings.
			const ownEmergencyByKey = new Map<string, boolean>();
			for (const [index, input] of inputs.entries()) {
				const stored = existing[index];
				const employmentId = input.employment_id ?? stored?.employment_id;
				const rawWorkDate = input.work_date ?? stored?.work_date;
				if (employmentId == null || rawWorkDate == null) continue;
				const workDate = dateKey(rawWorkDate);
				if (workDate === '') continue;
				const coordinate = {
					employment_id: employmentId,
					work_date: workDate,
					shift_definition_id:
						input.shift_definition_id !== undefined
							? input.shift_definition_id
							: (stored?.shift_definition_id ?? null)
				};
				coordinates.push(coordinate);
				if (input.approved_overtime_hours !== undefined)
					ownApprovedByKey.set(
						`${employmentId}:${workDate}`,
						decodeNumber(input.approved_overtime_hours ?? 0)
					);
				if (input.emergency_cause !== undefined)
					ownEmergencyByKey.set(`${employmentId}:${workDate}`, input.emergency_cause === true);
				if (input.shift_definition_id !== undefined || input.approved_overtime_hours !== undefined)
					changes.push(coordinate);
			}
			// The days a moved row leaves are judged too, so the neighbourhood covers them.
			const touchedDates = [
				...coordinates.map((row) => row.work_date),
				...existing.flatMap((row) => (row == null ? [] : [dateKey(row.work_date)]))
			].toSorted();
			const employmentIds = [
				...new Set([
					...coordinates.map((row) => row.employment_id),
					...existing.flatMap((row) => (row == null ? [] : [row.employment_id]))
				])
			];
			const months = [...new Set(touchedDates.map((date) => date.slice(0, 7)))].toSorted();
			const from = touchedDates[0];
			const to = touchedDates.at(-1);
			const spanStart = from == null ? '' : addDays(`${from.slice(0, 7)}-01`, -REST_RUN_PAD_DAYS);
			const spanEnd = to == null ? '' : addDays(monthBounds(to.slice(0, 7)).end, REST_RUN_PAD_DAYS);
			const none = employmentIds.length === 0 || from == null || to == null;
			const [employments, terms, monthRows, requests, slips, rosterRows, versions] =
				yield* Effect.all(
					[
						none
							? Effect.succeed([])
							: db.employments.findMany({
									where: { id: { in: employmentIds } },
									columns: { id: true, company_id: true, employee_number: true },
									// The lineage rides the employment, so the entity is one source, not a
									// company query of its own; its facts decide a conditional limit.
									with: {
										employment_company: {
											columns: {
												id: true,
												settings_code: true,
												region: true,
												facts: true,
												pay_cutoff_day: true
											}
										}
									},
									limit: employmentIds.length
								}),
						none
							? Effect.succeed([])
							: db.employment_terms.findMany({
									where: { employment_id: { in: employmentIds } },
									columns: {
										employment_id: true,
										shift_pattern_id: true,
										effective_range: true,
										employment_type: true,
										work_classification: true
									},
									limit: QUERY_LIMIT
								}),
						none
							? Effect.succeed([])
							: db.work_days.findMany({
									where: {
										employment_id: { in: employmentIds },
										work_date: { gte: dayInstant(spanStart), lte: dayInstant(spanEnd) }
									},
									columns: {
										id: true,
										employment_id: true,
										work_date: true,
										shift_definition_id: true,
										approved_overtime_hours: true,
										incentive_hours: true,
										emergency_cause: true,
										payslip_id: true
									},
									limit: QUERY_LIMIT
								}),
						none
							? Effect.succeed([])
							: db.leave_entries.findMany({
									where: {
										employment_id: { in: employmentIds },
										// Time off is the activity whose charges are its dated days.
										charges: { ne: [] },
										approval_id: { isNull: true },
										from_date: { lte: dayInstant(to) },
										to_date: { gte: dayInstant(from) }
									},
									columns: {
										employment_id: true,
										leave_code: true,
										from_date: true,
										to_date: true,
										half_day_start: true,
										half_day_end: true
									},
									limit: QUERY_LIMIT
								}),
						// This person's own payslips: the lock is the slip's, so a colleague's payment
						// neither closes this day nor does a colleague's held slip keep it open.
						none
							? Effect.succeed([])
							: db.payslips.findMany({
									where: { employment_id: { in: employmentIds } },
									columns: { payroll_run_id: true, employment_id: true, paid_at: true },
									limit: QUERY_LIMIT
								}),
						none
							? Effect.succeed([])
							: db.rosters.findMany({
									// The read span's months: the touched months decide conformance, and the
									// months around them which days a roster of record states (`resolveSchedule`).
									where: {
										employment_id: { in: employmentIds },
										period: {
											in: [
												...new Set([spanStart, ...months.map((month) => `${month}-01`), spanEnd])
											].map((date) => date.slice(0, 7))
										}
									},
									columns: { employment_id: true, period: true },
									limit: QUERY_LIMIT
								}),
						none
							? Effect.succeed([])
							: db.jurisdiction_settings.findMany({
									columns: {
										id: true,
										code: true,
										name: true,
										jurisdiction_code: true,
										sealed_at: true,
										voided_at: true,
										approval_id: true,
										effective_range: true,
										work_rules: true
									},
									limit: QUERY_LIMIT
								})
					],
					{ concurrency: 'unbounded' }
				);
			if (monthRows.length === QUERY_LIMIT || terms.length === QUERY_LIMIT)
				refuse('This schedule is too large to validate safely in one write.');
			if (versions.length >= QUERY_LIMIT)
				refuse('Workday calendar resolution exceeded its complete-read limit.');
			const employmentById = new Map(employments.map((row) => [row.id, row]));
			const companyIds = [
				...new Set(employments.flatMap((row) => (row.company_id == null ? [] : [row.company_id])))
			];
			const settingsCodeByCompany = new Map(
				employments.flatMap((row) =>
					row.employment_company == null
						? []
						: [[row.employment_company.id, row.employment_company.settings_code] as const]
				)
			);
			// Every touched day has a governing jurisdiction, or the write is refused up front.
			const settingsVersions = versions as readonly SettingsVersionRow[];
			for (const coordinate of coordinates) {
				const companyId = employmentById.get(coordinate.employment_id)?.company_id;
				const settingsCode = companyId == null ? null : settingsCodeByCompany.get(companyId);
				const version =
					settingsCode == null
						? null
						: settingsInForce(settingsVersions, settingsCode, coordinate.work_date);
				if (!version)
					refuse(
						`No governing jurisdiction is configured for the workday on ${coordinate.work_date}.`
					);
			}
			// Wave 2: the entities' runs, codes and patterns, and the wider projection the hour
			// ceilings ask for, keyed by what wave 1 named.
			const allLimits = settingsVersions.flatMap((version) => version.work_rules?.limits ?? []);
			const projectionWindow = projectionBounds(
				[...new Set(changes.map((change) => change.work_date))],
				allLimits
			);
			const widen =
				projectionWindow != null &&
				(projectionWindow.start < spanStart || projectionWindow.end > spanEnd);
			const calendarStart =
				projectionWindow == null || spanStart < projectionWindow.start
					? spanStart
					: projectionWindow.start;
			const calendarEnd =
				projectionWindow == null || spanEnd > projectionWindow.end ? spanEnd : projectionWindow.end;
			const [runs, codes, patterns, projectionRows, holidays] = yield* Effect.all(
				[
					companyIds.length === 0
						? Effect.succeed([])
						: db.payroll_runs.findMany({
								where: { company_id: { in: companyIds } },
								columns: {
									id: true,
									company_id: true,
									period: true,
									attendance_from: true,
									attendance_to: true
								},
								limit: QUERY_LIMIT
							}),
					companyIds.length === 0
						? Effect.succeed([])
						: db.shift_definitions.findMany({
								where: { company_id: { in: companyIds } },
								columns: { id: true, code: true, variant: true, effective_range: true },
								limit: QUERY_LIMIT
							}),
					companyIds.length === 0
						? Effect.succeed([])
						: db.shift_patterns.findMany({
								where: { company_id: { in: companyIds } },
								columns: { id: true, code: true, pattern: true, effective_range: true },
								limit: QUERY_LIMIT
							}),
					!widen
						? Effect.succeed([])
						: db.work_days.findMany({
								where: {
									employment_id: { in: employmentIds },
									work_date: {
										gte: dayInstant(projectionWindow.start),
										lte: dayInstant(projectionWindow.end)
									}
								},
								columns: {
									id: true,
									employment_id: true,
									work_date: true,
									shift_definition_id: true,
									approved_overtime_hours: true,
									incentive_hours: true,
									emergency_cause: true,
									payslip_id: true
								},
								limit: QUERY_LIMIT
							}),
					// The calendar's published holidays over the same span, replacement days included,
					// padded to whole assessment windows: payroll's own schedule resolves which of them
					// each person observes (`observedHolidayDates`).
					companyIds.length === 0 || changes.length === 0
						? Effect.succeed([])
						: db.jurisdiction_holidays.findMany({
								where: {
									company_id: { in: companyIds },
									date: {
										gte: dayInstant(addDays(calendarStart, -REST_RUN_PAD_DAYS)),
										lte: dayInstant(addDays(calendarEnd, REST_RUN_PAD_DAYS))
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
								limit: QUERY_LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			if (holidays.length === QUERY_LIMIT)
				refuse('This legal entity has too many holidays to validate safely.');
			if (codes.length === QUERY_LIMIT || patterns.length === QUERY_LIMIT)
				refuse('This legal entity has too many roster codes or shift patterns to validate safely.');
			if (projectionRows.length === QUERY_LIMIT)
				refuse("This schedule's projection is too large to validate safely in one write.");

			const windowsByCompany = new Map(
				[...Map.groupBy(runs, (run) => run.company_id)].map(([companyId, grouped]) => [
					companyId,
					payrollWindows(grouped, slips)
				])
			);
			const leaveByEmployment = Map.groupBy(requests, (request) => request.employment_id);
			const overlap = overlapDataFrom({
				terms,
				entries: monthRows,
				codes,
				patterns: patterns as ReadonlyArray<ShiftPatternLike & { readonly id: string }>
			});

			// Write-time roster conformance, over the whole batch: the month must still add up to
			// the pattern once every plan change in this write has landed. Checking the batch rather
			// than the row is what lets a two-cell swap pass while a single-cell REST-into-WORK write
			// is refused.
			if (changes.length > 0) {
				const patternById = new Map<string, ShiftPatternLike>(
					(patterns as ReadonlyArray<ShiftPatternLike & { readonly id: string }>).map((pattern) => [
						pattern.id,
						pattern
					])
				);
				const codeKindById = new Map<string, 'WORK' | 'REST' | 'OFF'>();
				const paidMinutesById = new Map<string, number>();
				const codeFactsById = new Map<string, RosterCodeFacts>();
				for (const code of codes) {
					try {
						const kind = rosterCodeKind(code.variant);
						codeKindById.set(code.id, kind);
						if (kind === 'WORK') {
							const window = workWindow(code.variant);
							if (window != null) {
								paidMinutesById.set(code.id, window.paid_minutes);
								codeFactsById.set(code.id, {
									kind: 'WORK',
									paid_minutes: window.paid_minutes,
									break_minutes: window.break_minutes,
									spread_hours: window.elapsed_minutes / 60
								});
							}
						} else {
							codeFactsById.set(code.id, {
								kind,
								paid_minutes: 0,
								break_minutes: 0,
								spread_hours: 0,
								statutory_rest: code.variant.kind === 'REST' && code.variant.statutory === true
							});
						}
					} catch {
						continue;
					}
				}
				const storedByKey = new Map<string, string | null>();
				const storedApprovedByKey = new Map<string, number>();
				const sealedKeys = new Set<string>();
				const emergencyKeys = new Set<string>();
				for (const row of [...monthRows, ...projectionRows]) {
					const storedDate = dateKey(row.work_date);
					if (storedDate == null) continue;
					const key = `${row.employment_id}:${storedDate}`;
					storedByKey.set(key, row.shift_definition_id);
					storedApprovedByKey.set(key, decodeNumber(row.approved_overtime_hours ?? 0));
					if (row.payslip_id != null) sealedKeys.add(key);
					if (row.emergency_cause === true) emergencyKeys.add(key);
				}
				const termsByEmployment = Map.groupBy(terms, (term) => term.employment_id);
				const changesByGroup = Map.groupBy(
					changes,
					(change) => `${change.employment_id}:${change.work_date.slice(0, 7)}`
				);
				// A month with a roster of record is not measured against the pattern: the roster is
				// the schedule. The statutory gates below still judge it.
				const rostered = new Set(rosterRows.map((row) => `${row.employment_id}:${row.period}`));
				for (const [key, group] of changesByGroup) {
					if (rostered.has(key)) continue;
					const separator = key.lastIndexOf(':');
					const employmentId = key.slice(0, separator);
					const month = key.slice(separator + 1);
					const plannedByDate = new Map<string, string | null>();
					for (const [storedKey, shiftId] of storedByKey) {
						if (!storedKey.startsWith(`${employmentId}:`)) continue;
						const date = storedKey.slice(employmentId.length + 1);
						if (date.startsWith(month)) plannedByDate.set(date, shiftId);
					}
					for (const change of group)
						plannedByDate.set(change.work_date, change.shift_definition_id);
					assertMonthConformsToPattern({
						employeeNumber: employmentById.get(employmentId)?.employee_number ?? employmentId,
						month,
						plannedByDate,
						terms: termsByEmployment.get(employmentId) ?? [],
						patternById,
						codeKindById,
						paidMinutesById
					});
				}
				// The rest-day run is keyed by employment alone, not by employment-month: a run
				// straddles the first of the month, and grouping it by month is exactly the seam a
				// thirteen-day roster would slip through.
				for (const employmentId of new Set(changes.map((change) => change.employment_id))) {
					const own = changes.filter((change) => change.employment_id === employmentId);
					const firstChange = own[0]!;
					const companyId = employmentById.get(employmentId)?.company_id;
					const settingsCode = companyId == null ? null : settingsCodeByCompany.get(companyId);
					if (settingsCode == null || settingsCode === '') continue;
					// Effective-dated on the day whose lawfulness is being judged, like every other
					// reader of a jurisdiction snapshot.
					const version = settingsInForce(settingsVersions, settingsCode, firstChange.work_date);
					if (version == null) continue;
					const employeeNumber = employmentById.get(employmentId)?.employee_number ?? employmentId;
					// Every overtime limit bounds the approved hours; what lies beyond it is keyed as
					// incentive hours. The roster plan itself is a gate too: a shift whose own hours
					// or spread-over breach a limit is refused here.
					// A conditional limit is judged over what the gate knows of the person: the
					// contract's type and classification and the entity's facts.
					const judged = termsByEmployment
						.get(employmentId)
						?.find((candidate) => coversDate(candidate.effective_range, firstChange.work_date));
					const entity = employmentById.get(employmentId)?.employment_company;
					const applicable = applicableLimits(
						version.work_rules?.limits ?? [],
						personContext({
							employee: null,
							employment: { service_start: '' },
							terms: judged ?? null,
							company: entity == null ? null : { region: entity.region, facts: entity.facts },
							asOf: firstChange.work_date
						})
					);
					const ownDates = own.map((change) => change.work_date).toSorted();
					// A month limit is the assessment month (the entity's cutoff window), which
					// the read span's month-and-31-days pad already holds.
					const cutoffDay = entity?.pay_cutoff_day ?? 1;
					const bounds = projectionBounds(ownDates, applicable);
					const window = {
						start: [
							bounds?.start ?? ownDates[0]!,
							assessmentWindow(ownDates[0]!, cutoffDay).start
						].toSorted()[0]!,
						end: [
							bounds?.end ?? ownDates.at(-1)!,
							assessmentWindow(ownDates.at(-1)!, cutoffDay).end
						]
							.toSorted()
							.at(-1)!
					};
					// The write under judgement is not stored yet: its own dates read from the change,
					// not from the row it replaces, or a day moved to rest would be refused for the
					// hours it no longer plans.
					const ownByDate = new Map(own.map((change) => [change.work_date, change]));
					/** The roster code a date resolves to: this write's, the stored row's, else the pattern's. */
					const codeIdOn = (date: string): string | null => {
						const explicitId = ownByDate.has(date)
							? ownByDate.get(date)?.shift_definition_id
							: storedByKey.get(`${employmentId}:${date}`);
						if (explicitId != null) return explicitId;
						const term = termsByEmployment
							.get(employmentId)
							?.find((candidate) => coversDate(candidate.effective_range, date));
						const patternRow = term == null ? null : termPatternRow(term, patternById);
						if (patternRow == null || !('days' in patternRow.pattern)) return null;
						try {
							return patternRosterCodeId(patternRow.pattern, date, patternAnchor(patternRow));
						} catch {
							return null;
						}
					};
					const planByDate = new Map<string, SchedulePlanDay>();
					for (let date = window.start; date <= window.end; date = addDays(date, 1))
						planByDate.set(
							date,
							plannedDay({ date, rosterCodeId: codeIdOn(date), codeById: codeFactsById })
						);
					// The approved hours every day of the window would hold once this write lands, each
					// judged against the headroom its limits leave: a later stored day an earlier edit
					// pushes over is refused by name, like the day written.
					const holidayDates = observedHolidayDates({
						dates: [...planByDate.keys()],
						cutoffDay,
						companyId: companyId ?? '',
						holidays,
						codes,
						precedence: version.work_rules?.holiday_rest_precedence,
						plans: [...storedByKey]
							.filter(([key]) => key.startsWith(`${employmentId}:`))
							.map(([key, shiftId]) => ({
								work_date: key.slice(employmentId.length + 1),
								shift_definition_id: ownByDate.has(key.slice(employmentId.length + 1))
									? (ownByDate.get(key.slice(employmentId.length + 1))?.shift_definition_id ?? null)
									: shiftId
							}))
							.concat(
								own
									.filter((change) => !storedByKey.has(`${employmentId}:${change.work_date}`))
									.map((change) => ({
										work_date: change.work_date,
										shift_definition_id: change.shift_definition_id
									}))
							),
						rosterPeriods: rosterRows
							.filter((row) => row.employment_id === employmentId)
							.map((row) => row.period),
						patternOn: (date) => {
							const term = termsByEmployment
								.get(employmentId)
								?.find((candidate) => coversDate(candidate.effective_range, date));
							const row = term == null ? null : termPatternRow(term, patternById);
							return row == null ? null : { pattern: row.pattern, anchor: patternAnchor(row) };
						}
					});
					const headroomOf = (written: boolean) =>
						overtimeHeadroom({
							days: [...planByDate.values()].map((plan) => {
								const key = `${employmentId}:${plan.date}`;
								return {
									...plan,
									approved_overtime_hours:
										(written ? ownApprovedByKey.get(key) : undefined) ??
										storedApprovedByKey.get(key) ??
										0,
									emergency:
										(written ? ownEmergencyByKey.get(key) : undefined) ?? emergencyKeys.has(key),
									holiday: holidayDates.has(plan.date)
								};
							}),
							limits: applicable,
							cutoffDay
						}).breaches;
					// Only what this write puts over a limit refuses it: a day whose approved hours it
					// changes, or a stored day it pushes over. A day already over before the write, left at
					// the same figure (an attendance edit, say), is not this write's to answer.
					const before = new Set(headroomOf(false).map((breach) => breach.date));
					const changed = (date: string) => {
						const key = `${employmentId}:${date}`;
						return (
							ownApprovedByKey.has(key) &&
							ownApprovedByKey.get(key) !== (storedApprovedByKey.get(key) ?? 0)
						);
					};
					const breaches = headroomOf(true).filter(
						(breach) => !before.has(breach.date) || changed(breach.date)
					);
					if (breaches.length > 0)
						refuse(
							`Overtime for ${employeeNumber} is refused: ${breaches.map(breachSentence).join('; ')}. ` +
								'Approved overtime may not exceed the statutory limit: lower it to the hours ' +
								'left and key the rest as incentive hours.'
						);
					if (applicable.length > 0) {
						const breach = projectedLimitBreaches({
							subject: employeeNumber,
							changedDates: new Set(ownDates),
							planByDate,
							limits: applicable,
							authority: version.work_rules?.authority ?? null
						})[0];
						if (breach != null) refuse(breach.message);
					}
					// The weekly rest rule is the version's consecutive-work-days limit, judged per person.
					const rule: StatutoryWeeklyRestRule | undefined =
						version.work_rules?.limits.find(isRestLimit);
					if (rule == null) continue;
					const plannedByDate = new Map<string, string | null>();
					for (const [storedKey, shiftId] of storedByKey) {
						if (!storedKey.startsWith(`${employmentId}:`)) continue;
						plannedByDate.set(storedKey.slice(employmentId.length + 1), shiftId);
					}
					for (const change of own) plannedByDate.set(change.work_date, change.shift_definition_id);
					// A day under leave the rule names (maternity, sick) is no worked day: it suspends
					// the rest-day count the way a rest day discharges it.
					const suspendedDates = new Set<string>();
					const suspending = new Set(rule.suspended_by_leave ?? []);
					if (suspending.size > 0)
						for (const request of leaveByEmployment.get(employmentId) ?? [])
							if (
								suspending.has(request.leave_code) &&
								request.from_date != null &&
								request.to_date != null
							)
								for (
									let date = dateKey(request.from_date);
									date <= dateKey(request.to_date);
									date = addDays(date, 1)
								)
									if (leaveCoverage(request, date).fullDay) suspendedDates.add(date);
					const averageWhen = (rule.average?.when ?? '').trim();
					assertRunHasRestDay({
						employeeNumber,
						rule,
						authority: null,
						window: { start: spanStart, end: spanEnd },
						plannedByDate,
						changedDates: new Set(own.map((change) => change.work_date)),
						terms: termsByEmployment.get(employmentId) ?? [],
						patternById,
						codeKindById,
						suspendedDates,
						averaging:
							averageWhen === '' ||
							isEligible(
								averageWhen,
								personContext({
									employee: null,
									employment: { service_start: '' },
									terms: judged ?? null,
									company: entity == null ? null : { region: entity.region, facts: entity.facts },
									asOf: firstChange.work_date
								})
							)
					});
					// The break obligation is a schedule gate: a plan whose shift grants less break
					// than the rules owe is refused here, never priced around at payroll.
					const breaks = version.work_rules?.breaks ?? [];
					if (breaks.length > 0)
						for (const change of own) {
							if (change.shift_definition_id == null) continue;
							const code = codes.find((row) => row.id === change.shift_definition_id);
							const window = code == null ? null : workWindow(code.variant);
							if (code == null || window == null) continue;
							const owed = selectBreakRule(breaks, {
								consecutiveHours: window.paid_minutes / 60,
								overtimeHours: 0,
								continuousAttendance: false
							});
							const granted = decodeNumber(
								(code.variant as { break_minutes?: unknown }).break_minutes ?? 0
							);
							if (owed?.minimum_minutes != null && owed.minimum_minutes > granted)
								refuse(
									`Roster change for ${employeeNumber} on ${change.work_date} is refused: the ` +
										`shift grants ${granted} minutes of break, but the rules require ` +
										`${owed.minimum_minutes} for a ${(window.paid_minutes / 60).toFixed(2)}-hour day.`
								);
						}
				}
			}

			const assignments: Parameters<typeof assertNoOverlap>[1][number][] = [];
			const outputs = inputs.map((input, index) => {
				const stored = existing[index];
				const employmentId = input.employment_id ?? stored?.employment_id;
				if (employmentId == null) refuse('A work day must reference an employment on file.');
				const workDate = input.work_date ?? stored?.work_date;
				if (workDate == null) refuse('A work day must specify a work date.');
				const shiftDefinitionId =
					input.shift_definition_id !== undefined
						? input.shift_definition_id
						: (stored?.shift_definition_id ?? null);
				assertWorkedIntervals(
					input.worked_intervals !== undefined ? input.worked_intervals : stored?.worked_intervals
				);
				assertPlannedHours(
					input.approved_overtime_hours !== undefined
						? input.approved_overtime_hours
						: stored?.approved_overtime_hours,
					input.incentive_hours !== undefined ? input.incentive_hours : stored?.incentive_hours
				);
				const companyId = employmentById.get(employmentId)?.company_id ?? null;
				const windows = (companyId == null ? undefined : windowsByCompany.get(companyId)) ?? [];
				if (stored !== undefined) {
					// An edit is the only write that can disturb something already settled: a create
					// has no prior row for a run to have consumed.
					assertNotCaptured(stored, 'Changing this work day');
					// Editing in place never asks the window; *moving* a row does, because the row
					// lands on a person-day it was not on before, governed by exactly the rule a
					// create is governed by.
					const moved =
						employmentId !== stored.employment_id ||
						dateKey(workDate) !== dateKey(stored.work_date);
					if (moved)
						assertNotSettled(windows, dateKey(workDate), 'Moving this work day', employmentId);
					refuseIfLeaveOwnsDay(leaveByEmployment.get(employmentId) ?? [], workDate);
					// The roster is frozen once somebody has clocked in against it: attendance is
					// scored against the plan, so changing the code under a recorded punch silently
					// re-prices work that already happened. A write that restates the attendance
					// beside the new plan — an import setting the whole day — is not re-pricing punches
					// behind anyone's back: the punches are its own.
					const frozen = planChanges(input, stored);
					const restatesAttendance = input.worked_intervals !== undefined;
					if (
						attendanceRecorded(stored.worked_intervals) &&
						frozen.length > 0 &&
						!restatesAttendance
					)
						refuse(
							`The roster for ${dateKey(workDate)} is locked: attendance has already been ` +
								`recorded against it, and ${frozen.join(', ')} decides how that ` +
								`attendance is priced. Clear the recorded time first, or leave the plan ` +
								`as it is and correct the attendance instead.`
						);
				} else {
					// A create has no record to ask about, so the window is the only fact there is. An
					// employment the batch could not find has no company and therefore no window.
					assertNotSettled(windows, dateKey(workDate), 'Recording this work day', employmentId);
					refuseIfLeaveOwnsDay(leaveByEmployment.get(employmentId) ?? [], workDate);
				}
				// The plan half. `unique(employment_id, work_date)` cannot express this: the conflict
				// is between work windows on ADJACENT days, not two rows on one day.
				assignments.push({
					employment_id: employmentId,
					work_date: workDate,
					shift_definition_id: shiftDefinitionId,
					...(stored === undefined ? {} : { existing_id: stored.id })
				});
				return boundToContract(canonicalDays(input, ['work_date']), stored);
			});
			// Judged over the whole batch: an import writes a month's days in one batch, and two new
			// adjacent days overlap each other, not anything stored.
			assertNoOverlap(overlap, assignments);
			return outputs;
		})
});
