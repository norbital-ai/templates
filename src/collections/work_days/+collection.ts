import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import model from './+model.js';
import { boundToContract } from '../../lib/employment-contract.js';
import { canonicalDays, dateKey, dayInstant } from '../../lib/iso-day.js';
import { addDays, monthBounds } from '../../lib/period.js';
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
	funnelledLimitKeys,
	plannedDay,
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
 * Approved overtime is keyed in half-hour steps — the unit the scheduler works in and the unit the
 * payroll input is read in — and a day cannot hold more of it than a day has hours. It is not
 * judged against the clock: the approval is the record, and a figure the punches disagree with is
 * the scheduler's to correct, not this write's to silently trim.
 */
function assertApprovedOvertimeHours(value: number | null | undefined): void {
	if (value == null) return;
	if (!Number.isFinite(value) || value < 0)
		refuse('Approved overtime hours must be zero or a positive number of hours.');
	if (Math.round(value * 2) !== value * 2)
		refuse('Approved overtime is keyed in half-hour steps — 0.5, 1, 1.5, and so on.');
	if (value > 24) refuse('Approved overtime cannot exceed the 24 hours a day has.');
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
 * WORK-day count or paid minutes different from what the work pattern projects. Statutory rest,
 * hour and break ceilings refuse any plan, rostered or not. Deleting a day a run took into
 * account is refused by the delete grant (`lib/policy_grants.ts`).
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
			// Approved overtime the write keys, by person-day: it is worked time the hour ceilings
			// project, so a write that changes it is judged like a plan change.
			const ownOvertimeByKey = new Map<string, number>();
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
					ownOvertimeByKey.set(`${employmentId}:${workDate}`, input.approved_overtime_hours ?? 0);
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
											columns: { id: true, settings_code: true, region: true, facts: true }
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
										approved_overtime_hours: true
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
									where: { employment_id: { in: employmentIds }, period: { in: months } },
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
			const [runs, codes, patterns, projectionRows] = yield* Effect.all(
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
								columns: { id: true, code: true, variant: true },
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
									approved_overtime_hours: true
								},
								limit: QUERY_LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
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
								spread_hours: 0
							});
						}
					} catch {
						continue;
					}
				}
				const storedByKey = new Map<string, string | null>();
				const storedOvertimeByKey = new Map<string, number>();
				for (const row of [...monthRows, ...projectionRows]) {
					const storedDate = dateKey(row.work_date);
					if (storedDate == null) continue;
					storedByKey.set(`${row.employment_id}:${storedDate}`, row.shift_definition_id);
					storedOvertimeByKey.set(
						`${row.employment_id}:${storedDate}`,
						row.approved_overtime_hours ?? 0
					);
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
					// The hour ceilings are a schedule gate too: a pattern or roster whose projection
					// breaches a limit is refused here. Payroll still reports an attendance overrun
					// and prices it; a plan the law forbids is never written. A limit payroll funnels
					// to INCENTIVE (the monthly overtime cap, a day limit a band funnels above) is
					// not a refusal: the plan is accepted and the payroll run warns.
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
					const funnelled = funnelledLimitKeys(version.work_rules, applicable);
					const limits = applicable.filter((limit) => !funnelled.has(limit.key));
					if (limits.length > 0) {
						const window = projectionBounds(
							own.map((change) => change.work_date),
							limits
						);
						if (window != null) {
							// The write under judgement is not stored yet: its own dates read from the
							// change, not from the row it replaces, or a day moved to rest would be
							// refused for the hours it no longer plans.
							const ownByDate = new Map(own.map((change) => [change.work_date, change]));
							const planByDate = new Map<string, SchedulePlanDay>();
							for (let date = window.start; date <= window.end; date = addDays(date, 1)) {
								const term = termsByEmployment
									.get(employmentId)
									?.find((candidate) => coversDate(candidate.effective_range, date));
								const patternRow = term == null ? null : termPatternRow(term, patternById);
								let projectedId: string | null = null;
								if (patternRow != null && 'days' in patternRow.pattern) {
									try {
										projectedId = patternRosterCodeId(
											patternRow.pattern,
											date,
											patternAnchor(patternRow)
										);
									} catch {
										projectedId = null;
									}
								}
								const explicitId = ownByDate.has(date)
									? ownByDate.get(date)?.shift_definition_id
									: storedByKey.get(`${employmentId}:${date}`);
								const key = `${employmentId}:${date}`;
								planByDate.set(
									date,
									plannedDay({
										date,
										rosterCodeId: explicitId ?? projectedId,
										codeById: codeFactsById,
										approvedOvertimeHours:
											ownOvertimeByKey.get(key) ?? storedOvertimeByKey.get(key) ?? 0
									})
								);
							}
							const breach = projectedLimitBreaches({
								subject: employeeNumber,
								changedDates: new Set(own.map((change) => change.work_date)),
								planByDate,
								limits,
								authority: version.work_rules?.authority ?? null
							})[0];
							if (breach != null) refuse(breach.message);
						}
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
				assertApprovedOvertimeHours(
					input.approved_overtime_hours !== undefined
						? input.approved_overtime_hours
						: stored?.approved_overtime_hours
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
