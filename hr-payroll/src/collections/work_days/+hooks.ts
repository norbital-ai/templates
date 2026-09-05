import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';
import { dateKey } from '../../lib/iso-day.js';
import { monthBounds } from '../../lib/period.js';
import { leaveCoverage, type LeaveRequestLike } from '../../lib/scheduling/leave-coverage.js';
import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import {
	payrollWindows,
	assertNotSettled,
	refuseIfCaptured,
	type PayrollWindow
} from '../../lib/scheduling/lock.js';
import type { Api, Hooks } from './$types.js';
import type { Api as AuthoringApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types';
import { assertNoOverlap, readOverlapData, type OverlapData } from './lib/assignment-overlap.js';
import { decodeNumber } from '@norbital-ai/std/json';

const QUERY_LIMIT = 20_000;

/**
 * The two questions attendance asks about a person-day, answered once for the whole batch.
 *
 * A create used to ask four: which company the employment belongs to, that company's payroll runs,
 * and the approved leave over this one date — the last two of which are the same query asked with a
 * different key every time. An import of four thousand punches made sixteen thousand round trips out
 * of the isolate; it now makes three, whatever the batch size.
 *
 * The maps are keyed so a hook that knows only its own record still finds its own answer:
 * employment → company, company → that company's windows, employment → the leave overlapping the
 * span this batch covers. `prepare` decides nothing — both refusals are still written once, below,
 * against the same pure functions the update path calls with its own reads.
 */
/**
 * `Hooks` with what `prepare` returns filled in.
 *
 * The generated `Hooks` alias fixes that parameter at `void`, so a collection that prepares anything
 * has to name the type itself. Once `bolt sync` emits `Hooks<Prepared = void>` this becomes
 * `satisfies Hooks<Prepared>`.
 */

/**
 * The settlement lock held over one attendance record, or null when none is.
 *
 * One indexed lookup on the unique `source` reference arm. It is asked on every update and
 * every delete, and that is the point: the previous guard could only ask whether the *day* fell
 * inside a paid run's window, so a draft run that had already priced this exact entry left it
 * editable underneath its own payslips.
 *
 * It is now the *only* thing either of those paths asks. The window and the calendar used to be
 * consulted beside it and both were answering a question about days that neither had any business
 * putting to a record — see `assertRecordNotClaimed`.
 *
 * Read through the requesting person's own subject, like every other hook read. That is why every
 * policy in `src/access/policies` carries a settlement-junction read grant — without one this would fail
 * as an access denial naming a collection the person has never heard of, instead of the sentence
 * that tells them what to do.
 */
/**
 * A roster row is an override of the work pattern, and the month must still add up to it.
 *
 * A plan write must leave the month's expected WORK-day count and paid minutes equal to what
 * the pattern projects for that month. A two-cell swap is one mutation and passes, because the
 * whole batch overlays the stored month before anything is compared. A single cell that turns
 * REST into WORK, or WORK into OFF, is refused with a sentence naming the pattern's count.
 * Extra work is not rostered: the person punches in, and overtime is derived. A contract change
 * is a new `employment_terms` row.
 *
 * Patterned employments only: a rostered employment has no pattern day, and its guaranteed or
 * capped load is validated at payroll precheck over the pay window, where the money is.
 */
type PlanChange = {
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id: string | null;
};

function assertMonthConformsToPattern(options: {
	readonly employeeNumber: string;
	readonly month: string;
	readonly plannedByDate: ReadonlyMap<string, string | null>;
	readonly terms: readonly {
		readonly work_pattern: {
			readonly type: string;
			readonly phases?: readonly {
				readonly day_cycle: readonly { readonly roster_code_id: string }[];
			}[];
			readonly anchor_date?: string;
		};
		readonly effective_range: unknown;
	}[];
	readonly codeKindById: ReadonlyMap<string, 'WORK' | 'REST' | 'OFF'>;
	readonly paidMinutesById: ReadonlyMap<string, number>;
}): void {
	const { employeeNumber, month, plannedByDate, terms, codeKindById, paidMinutesById } = options;
	let expectedDays = 0;
	let expectedMinutes = 0;
	let actualDays = 0;
	let actualMinutes = 0;
	let patterned = false;
	const bounds = monthBounds(month);
	let date = bounds.start;
	while (date <= bounds.end) {
		const term = terms.find((candidate) => coversDate(candidate.effective_range, date));
		const pattern = term?.work_pattern;
		if (pattern != null && pattern.type === 'PATTERNED') {
			patterned = true;
			let projectedId: string | null = null;
			try {
				projectedId = patternRosterCodeId(
					pattern as Parameters<typeof patternRosterCodeId>[0],
					date
				);
			} catch {
				projectedId = null;
			}
			const projectedKind = projectedId == null ? null : codeKindById.get(projectedId);
			if (projectedKind === 'WORK') {
				expectedDays += 1;
				expectedMinutes += paidMinutesById.get(projectedId!) ?? 0;
			}
			const explicitId = plannedByDate.get(date);
			// No row and a row with no plan both fall back to the pattern: only an explicit
			// assignment (including a batched one) overrides it. A cleared cell is `null`, and
			// `??` resumes the pattern for exactly that reason.
			const actualId = explicitId ?? projectedId;
			const actualKind = actualId == null ? null : codeKindById.get(actualId);
			if (actualKind === 'WORK') {
				actualDays += 1;
				actualMinutes += paidMinutesById.get(actualId!) ?? 0;
			}
		}
		date = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
	}
	if (!patterned) return;
	if (actualDays === expectedDays && actualMinutes === expectedMinutes) return;
	refuse(
		`Roster change for ${employeeNumber} in ${month} is refused: the month would assign ` +
			`${actualDays} WORK day(s) and ${actualMinutes} paid minute(s), but the work pattern ` +
			`projects ${expectedDays} WORK day(s) and ${expectedMinutes} paid minute(s). Extra work ` +
			`is not rostered — record a punch and overtime is derived; a contract change is a new ` +
			`employment-terms row.`
	);
}
/**
 * The batched conformance read: one month-span query for the whole write, then one pure
 * comparison per touched employment-month. Deletes never reach here — removing an override can
 * only resume the pattern — and attendance-only writes carry no plan change to check.
 */
function assertBatchConformsToPattern(
	api: AuthoringApi<WorkspaceSchema, unknown>,
	inputs: readonly {
		readonly id?: string;
		readonly employment_id?: string | null;
		readonly work_date?: unknown;
		readonly shift_definition_id?: string | null;
	}[],
	existingById: ReadonlyMap<
		string,
		{
			readonly employment_id: string;
			readonly work_date: unknown;
			readonly shift_definition_id: string | null;
		}
	>,
	employments: readonly {
		readonly id: string;
		readonly company_id: string | null;
		readonly employee_number: string;
	}[]
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const changes: PlanChange[] = [];
		for (const input of inputs) {
			if (input.shift_definition_id === undefined) continue;
			const stored = input.id === undefined ? undefined : existingById.get(input.id);
			const employmentId = input.employment_id ?? stored?.employment_id;
			const rawWorkDate = input.work_date ?? stored?.work_date;
			if (employmentId == null || rawWorkDate == null) continue;
			if (typeof rawWorkDate !== 'string') continue;
			const workDate = dateKey(rawWorkDate);
			if (workDate == null || workDate === '') continue;
			changes.push({
				employment_id: employmentId,
				work_date: workDate,
				shift_definition_id: input.shift_definition_id
			});
		}
		if (changes.length === 0) return;
		const employmentIds = [...new Set(changes.map((change) => change.employment_id))];
		const months = [...new Set(changes.map((change) => change.work_date.slice(0, 7)))].toSorted();
		const spanStart = `${months[0]}-01`;
		const spanEnd = monthBounds(months[months.length - 1]!).end;
		const employmentById = new Map(employments.map((employment) => [employment.id, employment]));
		const companyIds = [
			...new Set(
				employmentIds.flatMap((id) => {
					const companyId = employmentById.get(id)?.company_id;
					return companyId == null ? [] : [companyId];
				})
			)
		];
		const [monthRows, terms] = yield* Effect.all(
			[
				api.db.work_days.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: spanStart, lte: spanEnd }
					},
					columns: { employment_id: true, work_date: true, shift_definition_id: true },
					limit: QUERY_LIMIT
				}),
				api.db.employment_terms.findMany({
					where: { employment_id: { in: employmentIds } },
					columns: { employment_id: true, work_pattern: true, effective_range: true },
					limit: QUERY_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		const codes =
			companyIds.length === 0
				? []
				: yield* api.db.shift_definitions.findMany({
						where: { company_id: { in: companyIds } },
						columns: { id: true, variant: true },
						limit: QUERY_LIMIT
					});
		if (monthRows.length === QUERY_LIMIT || terms.length === QUERY_LIMIT) {
			refuse('This schedule is too large to validate safely in one write.');
		}
		if (codes.length === QUERY_LIMIT) {
			refuse('This legal entity has too many roster codes to validate safely.');
		}
		const codeKindById = new Map<string, 'WORK' | 'REST' | 'OFF'>();
		const paidMinutesById = new Map<string, number>();
		for (const code of codes) {
			try {
				const kind = rosterCodeKind(code.variant);
				codeKindById.set(code.id, kind);
				if (kind === 'WORK') {
					const window = workWindow(code.variant);
					if (window != null) paidMinutesById.set(code.id, window.paid_minutes);
				}
			} catch {
				continue;
			}
		}
		const storedByKey = new Map<string, string | null>();
		for (const row of monthRows) {
			const storedDate = dateKey(row.work_date);
			if (storedDate == null) continue;
			storedByKey.set(`${row.employment_id}:${storedDate}`, row.shift_definition_id);
		}
		const termsByEmployment = new Map<string, typeof terms>();
		for (const term of terms) {
			const bucket = termsByEmployment.get(term.employment_id) ?? [];
			bucket.push(term);
			termsByEmployment.set(term.employment_id, bucket);
		}
		const changesByGroup = new Map<string, PlanChange[]>();
		for (const change of changes) {
			const key = `${change.employment_id}:${change.work_date.slice(0, 7)}`;
			const bucket = changesByGroup.get(key) ?? [];
			bucket.push(change);
			changesByGroup.set(key, bucket);
		}
		for (const [key, group] of changesByGroup) {
			const separator = key.lastIndexOf(':');
			const employmentId = key.slice(0, separator);
			const month = key.slice(separator + 1);
			const plannedByDate = new Map<string, string | null>();
			for (const [storedKey, shiftId] of storedByKey) {
				if (storedKey.startsWith(`${employmentId}:`)) {
					const date = storedKey.slice(employmentId.length + 1);
					if (date.startsWith(month)) plannedByDate.set(date, shiftId);
				}
			}
			for (const change of group) plannedByDate.set(change.work_date, change.shift_definition_id);
			assertMonthConformsToPattern({
				employeeNumber: employmentById.get(employmentId)?.employee_number ?? employmentId,
				month,
				plannedByDate,
				terms: termsByEmployment.get(employmentId) ?? [],
				codeKindById,
				paidMinutesById
			});
		}
	});
}

/**
 * One writer wins the day: attendance must not record work on a day approved leave already owns.
 * Half-day leave still allows the other half, which is why only fully covered dates refuse.
 *
 * It is a guard about who owns a day rather than about payroll, so it keeps its own schedule: every
 * write that leaves a record standing on a day — create and update, on the patched date — and not
 * delete, which leaves none.
 */
function refuseIfLeaveOwnsDay(requests: readonly LeaveRequestLike[], workDate: string): void {
	const date = dateKey(workDate);
	const covering = requests.find((request) => leaveCoverage(request, date).fullDay);
	if (covering != null) {
		refuse(
			`${date} is covered by approved leave ${dateKey(covering.from_date)} → ` +
				`${dateKey(covering.to_date)} for this employment. Attendance on a leave day is not ` +
				'recorded; amend or cancel that leave first.'
		);
	}
}

/**
 * The same rule, for the one path that has no batch to read for.
 *
 * `update` has no `prepare` — it is authored for one existing record and the platform gives it no
 * view of the call it arrived in — so this reads the day it needs and hands it to the decision
 * above. The decision is written once; only where its input comes from differs.
 */
function assertDayNotOwnedByLeave(
	api: AuthoringApi<WorkspaceSchema, unknown>,
	employmentId: string,
	workDate: string
): Effect.Effect<void, never, never> {
	const date = dateKey(workDate);
	return Effect.map(
		api.db.leave_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				kind: { eq: 'TIME_OFF' },
				approval_id: { isNull: true },
				from_date: { lte: date },
				to_date: { gte: date }
			},
			columns: { from_date: true, to_date: true, half_day_start: true, half_day_end: true },
			limit: 200
		}),
		(requests) => refuseIfLeaveOwnsDay(requests, date)
	);
}

/**
 * The window guard, and the only place a window still decides anything about attendance.
 *
 * It answers "may a record appear on this person-day at all?", never "may this record change?".
 * A paid run priced every day in its assessment window, including the days it found nothing on:
 * silence on those days was already sold as absence, and dropping a punch into one afterwards
 * would move money that has been paid. There is no capture to consult, because
 * there was no record for the run to claim — so the window is the only fact available, and here it
 * is the right one.
 *
 * That is the whole of its remit. It used to run on updates and deletes too, beside the claim
 * lookup below, which is what froze the arrears case this window guard once argued about:
 * a punch keyed in after a run was paid, consumed by nobody, refused because of where it was dated.
 */
function assertDayHasNoPaidSilence(
	api: AuthoringApi<WorkspaceSchema, unknown>,
	employmentId: string,
	workDate: string,
	action: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId } },
			columns: { company_id: true }
		});
		if (employment == null) return;
		const runs = yield* api.db.payroll_runs.findMany({
			where: { company_id: { eq: employment.company_id } },
			columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
			limit: QUERY_LIMIT
		});
		assertNotSettled(payrollWindows(runs), dateKey(workDate), action);
	});
}

/**
 * The record guard: what an existing attendance row is held by, which is a claim and nothing else.
 *
 * Three inputs to `sourceLock` are deliberately empty here, and the emptiness is the change §2.2 of
 * `docs/attendance-on-the-board-proposal.md` asks for rather than an omission:
 *
 *   - `windows: []` — the window is an inference about *days* and this row is a *record*. Whether
 *     it is editable is answered by whether a run took it, and a run that took it says so in
 *     a captured input. A record dated inside a paid window that no run consumed settles as
 *     arrears in a later run (§2.3), so consulting the window here would refuse exactly the write
 *     that is supposed to happen. With no windows there is nothing left for the employment and
 *     `payroll_runs` reads to feed, so both queries are gone from the update and delete paths.
 *   - `datePassed: 'IS_NOT_A_LOCK'` — every punch is recorded about a day that has already gone by.
 *     A passed date froze every historical row on every attendance surface, and it never protected
 *     anything: consumption by payroll is what protects a record, and consumption is stored.
 *   - `dates: []` — with neither of the date-shaped locks in play there is no date-shaped question
 *     left to ask, and passing a date that nothing reads would only suggest one is still asked.
 *
 * What survives is `PENDING_APPROVAL`, which stays the platform's 409 and which
 * `sourceLockBlocksWrite` leaves alone, and the payslip-linked `SETTLED`. The claim is the only one
 * of these that can name the period holding the record, so its refusal is the only one that can
 * tell a person what would have to happen to release it: delete the draft, or correct it with an
 * adjustment.
 */
/**
 * Attendance is an ordered set of observations. It does not classify any interval as overtime:
 * premium work is derived later from these intervals, the effective schedule and statutory rules.
 *
 * The write boundary already decoded `worked_intervals` against the strict worked-intervals
 * schema, so the handler receives the decoded intervals and only the ordering rules below remain.
 */
function assertWorkedIntervals(
	// NULL is a work day with no attendance recorded — a plan and nothing else — and there is nothing
	// to validate about it. `[]` is a day that WAS read and produced no work, which the rules below
	// accept as the settled statement it is.
	value: readonly WorkedInterval[] | null | undefined,
	breakMinutes: number | null | undefined
): void {
	if (value == null) return;
	let previousEnd = Number.NEGATIVE_INFINITY;
	let closedMinutes = 0;
	for (const [index, interval] of value.entries()) {
		const startedAt = Date.parse(interval.start);
		const endedAt = interval.end == null ? null : Date.parse(interval.end);
		if (index > 0 && startedAt < previousEnd) {
			refuse('Worked intervals must be in time order and cannot overlap.');
		}
		if (endedAt == null) {
			if (index !== value.length - 1) {
				refuse('Only the final worked interval may still be open.');
			}
			previousEnd = Number.POSITIVE_INFINITY;
			continue;
		}
		if (endedAt <= startedAt) {
			refuse('Each worked interval must end after it starts, including work across midnight.');
		}
		closedMinutes += (endedAt - startedAt) / 60_000;
		previousEnd = endedAt;
	}

	const unpaidBreak = decodeNumber(breakMinutes ?? 0);
	if (!Number.isInteger(unpaidBreak) || unpaidBreak < 0) {
		refuse('Unpaid break must be a non-negative whole number of minutes.');
	}
	const hasOpenInterval = value.some((interval) => interval.end == null);
	// `unpaidBreak > 0` is load-bearing, not a shortcut past the zero case. A reviewed-empty day is
	// `[]` with no break: no interval, so `closedMinutes` is 0, and `0 >= 0` refused the one write
	// the day sheet's "reviewed, nothing worked" action exists to make — the day could be cleared to
	// NULL or filled with punches, but never stated as read-and-empty. Deducting a *positive* break
	// from nothing is still the contradiction this rule is for, and is still refused.
	if (!hasOpenInterval && unpaidBreak > 0 && unpaidBreak >= closedMinutes) {
		refuse('Unpaid break must be shorter than the recorded worked time.');
	}
}

/**
 * One person-day, and the two halves that land on it.
 *
 * `time_entries` and `roster_entries` were the same row read twice, so their hooks were the same
 * refusals written twice. This is both, once. The plan half is `shift_definition_id`,
 * `assignment_code`, `planned_origin` and `planned_note`; the actual half is `worked_intervals` and
 * `break_minutes`. Either may be absent — `shift_definition_id` non-NULL is the presence test for a
 * plan, and `worked_intervals` NULL means no attendance was recorded, which is a different fact from
 * `[]`, the day that was read and produced nothing.
 *
 * The overlap rule survives the merge and is not made redundant by `unique(employment_id,
 * work_date)`. That index stops two rows on the same day; the rule stops two work windows occupying
 * the same real minute across *adjacent* days — a night shift ending after midnight against the next
 * morning's start — which is why it reads day-1, day and day+1.
 */
/** What `prepare` hands every record: the batch's reads, done once. */
type Prepared = {
	readonly companyByEmployment: ReadonlyMap<string, string | null>;
	readonly windowsByCompany: ReadonlyMap<string, readonly PayrollWindow[]>;
	readonly leaveByEmployment: ReadonlyMap<string, readonly LeaveRequestLike[]>;
	readonly overlap: OverlapData;
};

type WorkDayCoordinate = Readonly<{
	employment_id: string;
	work_date: string;
	shift_definition_id: string | null;
}>;

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const existingIds = inputs.flatMap((input) => (input.id === undefined ? [] : [input.id]));
				const existingRows = existingIds.length
					? yield* api.db.work_days.findMany({
							where: { id: { in: existingIds } },
							columns: {
								id: true,
								employment_id: true,
								work_date: true,
								shift_definition_id: true
							},
							limit: QUERY_LIMIT
						})
					: [];
				const existingById = new Map(existingRows.map((row) => [row.id, row]));
				const coordinates: WorkDayCoordinate[] = [];
				for (const input of inputs) {
					const stored = input.id === undefined ? undefined : existingById.get(input.id);
					const employmentId = input.employment_id ?? stored?.employment_id;
					const rawWorkDate = input.work_date ?? stored?.work_date;
					if (employmentId == null || rawWorkDate == null) continue;
					const workDate = dateKey(rawWorkDate);
					if (workDate === '') continue;
					coordinates.push({
						employment_id: employmentId,
						work_date: workDate,
						shift_definition_id:
							input.shift_definition_id !== undefined
								? input.shift_definition_id
								: (stored?.shift_definition_id ?? null)
					});
				}
				const employmentIds = [...new Set(coordinates.map((row) => row.employment_id))];
				const dates = coordinates.map((row) => row.work_date).sort();
				const employments = employmentIds.length
					? yield* api.db.employments.findMany({
							where: { id: { in: employmentIds } },
							columns: { id: true, company_id: true, employee_number: true },
							limit: QUERY_LIMIT
						})
					: [];
				const companyIds = [
					...new Set(
						employments.flatMap((employment) =>
							employment.company_id ? [employment.company_id] : []
						)
					)
				];
				const runs = companyIds.length
					? yield* api.db.payroll_runs.findMany({
							where: { company_id: { in: companyIds } },
							columns: {
								company_id: true,
								period: true,
								lifecycle: true,
								attendance_from: true,
								attendance_to: true
							},
							limit: QUERY_LIMIT
						})
					: [];
				const runsByCompany = new Map<string, Array<(typeof runs)[number]>>();
				for (const run of runs) {
					const grouped = runsByCompany.get(run.company_id) ?? [];
					grouped.push(run);
					runsByCompany.set(run.company_id, grouped);
				}
				const from = dates[0];
				const to = dates[dates.length - 1];
				const requests =
					employmentIds.length && from != null && to != null
						? yield* api.db.leave_requests.findMany({
								where: {
									employment_id: { in: employmentIds },
									kind: { eq: 'TIME_OFF' },
									approval_id: { isNull: true },
									from_date: { lte: to },
									to_date: { gte: from }
								},
								columns: {
									employment_id: true,
									from_date: true,
									to_date: true,
									half_day_start: true,
									half_day_end: true
								},
								limit: QUERY_LIMIT
							})
						: [];
				const leaveByEmployment = new Map<string, Array<LeaveRequestLike>>();
				for (const request of requests) {
					const grouped = leaveByEmployment.get(request.employment_id) ?? [];
					grouped.push(request);
					leaveByEmployment.set(request.employment_id, grouped);
				}
				// The plan half's read, batched the same way: one three-day neighbourhood query for the
				// whole write rather than one per row.
				const overlap: OverlapData =
					coordinates.length > 0
						? yield* readOverlapData(api, coordinates)
						: {
								termsByEmployment: new Map(),
								explicitByKey: new Map(),
								codeById: new Map()
							};
				// Write-time roster conformance, over the whole batch: the month must still add up to
				// the pattern once every plan change in this write has landed. Checking the batch
				// rather than the row is what lets a two-cell swap pass while a single-cell
				// REST-into-WORK write is refused.
				yield* assertBatchConformsToPattern(api, inputs, existingById, employments);
				return {
					companyByEmployment: new Map(
						employments.map((employment) => [employment.id, employment.company_id])
					),
					windowsByCompany: new Map(
						[...runsByCompany].map(([companyId, grouped]) => [companyId, payrollWindows(grouped)])
					),
					leaveByEmployment,
					overlap
				};
			}),
		perRecord: {
			before: {
				description:
					'Requires ordered, non-overlapping worked intervals with only the final one open, refuses attendance on a day approved leave owns or inside a paid run’s window whose scheduled attendance that run already settled, refuses any change to a row a payroll run has taken into account, refuses a planned shift that would overlap the person’s adjacent-day assignments, and refuses a plan write that would leave the month’s WORK-day count or paid minutes different from what the work pattern projects.',
				handler: ({ input, existing, prepared, api }) =>
					Effect.gen(function* () {
						const employmentId = input.employment_id ?? existing?.employment_id;
						if (employmentId == null) refuse('A work day must reference an employment on file.');
						const workDate = input.work_date ?? existing?.work_date;
						if (workDate == null) refuse('A work day must specify a work date.');
						const shiftDefinitionId =
							input.shift_definition_id !== undefined
								? input.shift_definition_id
								: (existing?.shift_definition_id ?? null);
						assertWorkedIntervals(
							input.worked_intervals !== undefined
								? input.worked_intervals
								: existing?.worked_intervals,
							input.break_minutes !== undefined ? input.break_minutes : existing?.break_minutes
						);
						// An edit is the only write that can disturb something already settled: a create has
						// no prior row for a run to have consumed.
						if (existing !== undefined) {
							yield* refuseIfCaptured({
								capture: api.db.payslip_work_day_inputs.findFirst({
									where: { work_day_id: { eq: existing.id } },
									columns: { period: true }
								}),
								approvalId: existing.approval_id,
								action: 'Changing this work day'
							});
							// Editing in place never asks the window; *moving* a row does, because the row
							// lands on a person-day it was not on before, governed by exactly the rule a
							// create is governed by. Without this the create guard is two writes away from
							// decorative: create on an open day, then re-date into the paid period.
							const moved =
								employmentId !== existing.employment_id ||
								dateKey(workDate) !== dateKey(existing.work_date);
							if (moved)
								yield* assertDayHasNoPaidSilence(
									api,
									employmentId,
									workDate,
									'Moving this work day'
								);
							yield* assertDayNotOwnedByLeave(api, employmentId, workDate);
						} else {
							// A create has no record to ask about, so the batch's window is the only fact
							// there is. An employment the batch could not find has no company and therefore
							// no window — the same silence a per-record lookup produced when it found nothing.
							const companyId = prepared.companyByEmployment.get(employmentId) ?? null;
							assertNotSettled(
								(companyId == null ? undefined : prepared.windowsByCompany.get(companyId)) ?? [],
								dateKey(workDate),
								'Recording this work day'
							);
							refuseIfLeaveOwnsDay(prepared.leaveByEmployment.get(employmentId) ?? [], workDate);
						}
						// The plan half. `unique(employment_id, work_date)` cannot express this: the conflict
						// is between work windows on ADJACENT days, not two rows on one day.
						assertNoOverlap(prepared.overlap, [
							{
								employment_id: employmentId,
								work_date: workDate,
								shift_definition_id: shiftDefinitionId,
								...(existing === undefined ? {} : { existing_id: existing.id })
							}
						]);
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a work day a payroll run has already taken into account. A day no run has consumed may be deleted whatever its date, because nothing has been paid on it.',
				/**
				 * No window and no leave check, for the same reason in both cases: a delete removes a
				 * record, and the only thing harmed by removing one is a run that priced it. Deleting a
				 * punch that landed on an approved leave day is a correction, not a conflict.
				 */
				handler: ({ existing, api }) =>
					refuseIfCaptured({
						capture: api.db.payslip_work_day_inputs.findFirst({
							where: { work_day_id: { eq: existing.id } },
							columns: { period: true }
						}),
						approvalId: existing.approval_id,
						action: 'Deleting this work day'
					})
			}
		}
	}
} satisfies Hooks<Prepared>;
