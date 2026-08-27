import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';
import { dateKey } from '../../lib/iso-day.js';
import { leaveCoverage, type LeaveRequestLike } from '../../lib/scheduling/leave-coverage.js';
import {
	payrollWindows,
	assertNotSettled,
	sourceLock,
	sourceLockBlocksWrite,
	sourceLockMessage,
	type PayrollWindow,
	type SettlementClaim
} from '../../lib/scheduling/lock.js';
import type { Api, Hooks } from './$types.js';
import { assertNoOverlap, readOverlapData, type OverlapData } from './lib/assignment-overlap.js';

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
interface TimeEntryBatch {
	readonly companyByEmployment: ReadonlyMap<string, string | null>;
	readonly windowsByCompany: ReadonlyMap<string, ReadonlyArray<PayrollWindow>>;
	readonly leaveByEmployment: ReadonlyMap<string, ReadonlyArray<LeaveRequestLike>>;
}

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
 * policy in `src/access/policies` carries a `payslip_sources` read grant — without one this would fail
 * as an access denial naming a collection the person has never heard of, instead of the sentence
 * that tells them what to do.
 */
function settlementOver(
	api: Api,
	workDayId: string
): Effect.Effect<SettlementClaim | null, never, never> {
	return Effect.map(
		// A zero-amount adjustment is the settlement lock: the run read this day and priced it, even
		// at nothing. `payslip_sources` was that row before the merge; it is an adjustment arm now.
		api.db.payslip_adjustments.findFirst({
			where: { source: { eq: { kind: 'WORK_DAY', id: workDayId } } },
			columns: { period: true }
		}),
		(claim) => (claim == null ? null : { period: claim.period })
	);
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
	api: Api,
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
 * would move money that has been paid. There is no `payslip_sources` claim to consult, because
 * there was no record for the run to claim — so the window is the only fact available, and here it
 * is the right one.
 *
 * That is the whole of its remit. It used to run on updates and deletes too, beside the claim
 * lookup below, which is what froze the arrears case `payslip_sources/+model.ts` argues about:
 * a punch keyed in after a run was paid, consumed by nobody, refused because of where it was dated.
 */
function assertDayHasNoPaidSilence(
	api: Api,
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
 *     `payslip_sources`. A record dated inside a paid window that no run consumed settles as
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
function assertRecordNotClaimed(
	api: Api,
	timeEntryId: string,
	approvalId: string | null | undefined,
	action: string
): Effect.Effect<void, never, never> {
	return Effect.map(settlementOver(api, timeEntryId), (settledBy) => {
		const lock = sourceLock({
			existing: true,
			approvalId,
			dates: [],
			settledBy,
			datePassed: 'IS_NOT_A_LOCK'
		});
		if (sourceLockBlocksWrite(lock)) {
			refuse(sourceLockMessage(lock, action));
		}
	});
}

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

	const unpaidBreak = Number(breakMinutes ?? 0);
	if (!Number.isInteger(unpaidBreak) || unpaidBreak < 0) {
		refuse('Unpaid break must be a non-negative whole number of minutes.');
	}
	const hasOpenInterval = value.some((interval) => interval.end == null);
	if (!hasOpenInterval && unpaidBreak >= closedMinutes) {
		refuse('Unpaid break must be shorter than the recorded worked time.');
	}
}

/**
 * One person-day, and the two halves that land on it.
 *
 * `time_entries` and `roster_entries` were the same row read twice, so their hooks were the same
 * refusals written twice. This is both, once. The plan half is `shift_definition_id`, `roster_id`,
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

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const employmentIds = [
					...new Set(inputs.flatMap((input) => (input.employment_id ? [input.employment_id] : [])))
				];
				const dates = inputs
					.flatMap((input) => {
						const date = dateKey(input.work_date);
						return date === '' ? [] : [date];
					})
					.sort();
				const employments = employmentIds.length
					? yield* api.db.employments.findMany({
							where: { id: { in: employmentIds } },
							columns: { id: true, company_id: true },
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
				const overlap: OverlapData = yield* readOverlapData(
					api,
					inputs.map((input) => ({
						employment_id: input.employment_id,
						work_date: input.work_date,
						shift_definition_id: input.shift_definition_id ?? null
					}))
				);
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
					'Requires ordered, non-overlapping worked intervals with only the final one open, refuses attendance on a day approved leave owns or inside a paid run’s window whose silence that run already priced as absence, refuses any change to a row a payroll run has taken into account, and refuses a planned shift that would overlap the person’s adjacent-day assignments.',
				handler: ({ input, existing, prepared, api }) =>
					Effect.gen(function* () {
						assertWorkedIntervals(input.worked_intervals, input.break_minutes);
						// An edit is the only write that can disturb something already settled: a create has
						// no prior row for a run to have consumed.
						if (existing !== undefined) {
							yield* assertRecordNotClaimed(
								api,
								existing.id,
								existing.approval_id,
								'Changing this work day'
							);
							// Editing in place never asks the window; *moving* a row does, because the row
							// lands on a person-day it was not on before, governed by exactly the rule a
							// create is governed by. Without this the create guard is two writes away from
							// decorative: create on an open day, then re-date into the paid period.
							const moved =
								input.employment_id !== existing.employment_id ||
								dateKey(input.work_date) !== dateKey(existing.work_date);
							if (moved)
								yield* assertDayHasNoPaidSilence(
									api,
									input.employment_id,
									input.work_date,
									'Moving this work day'
								);
							yield* assertDayNotOwnedByLeave(api, input.employment_id, input.work_date);
						} else {
							// A create has no record to ask about, so the batch's window is the only fact
							// there is. An employment the batch could not find has no company and therefore
							// no window — the same silence a per-record lookup produced when it found nothing.
							const companyId = prepared.companyByEmployment.get(input.employment_id) ?? null;
							assertNotSettled(
								(companyId == null ? undefined : prepared.windowsByCompany.get(companyId)) ?? [],
								dateKey(input.work_date),
								'Recording this work day'
							);
							refuseIfLeaveOwnsDay(
								prepared.leaveByEmployment.get(input.employment_id) ?? [],
								input.work_date
							);
						}
						// The plan half. `unique(employment_id, work_date)` cannot express this: the conflict
						// is between work windows on ADJACENT days, not two rows on one day.
						assertNoOverlap(prepared.overlap, [
							{
								employment_id: input.employment_id,
								work_date: input.work_date,
								shift_definition_id: input.shift_definition_id ?? null,
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
					assertRecordNotClaimed(api, existing.id, existing.approval_id, 'Deleting this work day')
			}
		}
	}
} satisfies Hooks<Prepared>;
