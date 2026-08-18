import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { WorkedInterval } from '../../custom-types/worked_intervals/+definition.js';
import { leaveCoverage } from '../../lib/scheduling/leave-coverage.js';
import { todayKey } from '../../lib/ui/calendar.js';
import {
	payrollWindows,
	assertNotSettled,
	sourceLock,
	sourceLockBlocksWrite,
	sourceLockMessage,
	type SettlementClaim
} from '../../lib/scheduling/lock.js';
import type { HookApi, Hooks } from './$types.js';

const QUERY_LIMIT = 20_000;

/**
 * The settlement lock held over one attendance record, or null when none is.
 *
 * One indexed lookup on `(source_collection, source_record_id)`. It is asked on every update and
 * every delete, and that is the point: the previous guard could only ask whether the *day* fell
 * inside a paid run's window, so a draft run that had already priced this exact entry left it
 * editable underneath its own payslips.
 *
 * Read through the requesting person's own subject, like every other hook read. That is why every
 * policy in `src/policies` carries a `payroll_settlements` read grant — without one this would fail
 * as an access denial naming a collection the person has never heard of, instead of the sentence
 * that tells them what to do.
 */
function settlementOver(
	api: HookApi,
	timeEntryId: string
): Effect.Effect<SettlementClaim | null, never, never> {
	return Effect.gen(function* () {
		const claim = yield* api.db.query.payroll_settlements.findFirst({
			where: {
				source_collection: { eq: 'time_entries' },
				source_record_id: { eq: timeEntryId }
			},
			columns: { period: true }
		});
		return claim == null ? null : { period: claim.period };
	});
}

function dateKey(value: string | Date | null | undefined): string {
	if (value == null) return '';
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/**
 * One writer wins the day: attendance must not record work on a day approved leave already owns,
 * and nothing may change on a day a paid payroll run settled. Half-day leave still allows the
 * other half, which is why only fully covered dates refuse.
 */
function assertDayNotOwnedByLeave(
	api: HookApi,
	employmentId: string,
	workDate: string | Date
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const date = dateKey(workDate);
		const requests = yield* api.db.query.leave_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				kind: { eq: 'TIME_OFF' },
				norbital_approval_id: { isNull: true },
				from_date: { lte: date },
				to_date: { gte: date }
			},
			columns: { from_date: true, to_date: true, half_day_start: true, half_day_end: true },
			limit: 200
		});
		const covering = requests.find((request) => leaveCoverage(request, date).fullDay);
		if (covering != null) {
			refuse(
				`${date} is covered by approved leave ${dateKey(covering.from_date)} → ` +
					`${dateKey(covering.to_date)} for this employment. Attendance on a leave day is not ` +
					'recorded; amend or cancel that leave first.'
			);
		}
	});
}

function assertDayNotSettled(
	api: HookApi,
	employmentId: string,
	workDate: string | Date
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const employment = yield* api.db.query.employments.findFirst({
			where: { norbital_id: { eq: employmentId } },
			columns: { company_id: true }
		});
		if (employment == null) return;
		const runs = yield* api.db.query.payroll_runs.findMany({
			where: { company_id: { eq: employment.company_id } },
			columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
			limit: QUERY_LIMIT
		});
		assertNotSettled(payrollWindows(runs), dateKey(workDate), 'Changing attendance');
	});
}

function assertAttendanceSourceUnlocked(
	api: HookApi,
	timeEntryId: string,
	employmentId: string,
	workDate: string | Date,
	approvalId: string | null | undefined,
	action: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		// Asked first and asked unconditionally. The settlement lock is the only one of these that is
		// a fact rather than an inference, and it is the only one whose refusal can name the run that
		// would have to be deleted — so a person whose entry is genuinely held by a draft run is told
		// that, rather than being told a vaguer thing about the month it sits in.
		const settledBy = yield* settlementOver(api, timeEntryId);
		const employment = yield* api.db.query.employments.findFirst({
			where: { norbital_id: { eq: employmentId } },
			columns: { company_id: true }
		});
		// The employment read can come back empty for a person whose row predicate hides it. The
		// settlement lock must still apply in that case, so the window lookup is skipped and the
		// stored claim is evaluated on its own rather than the whole guard being abandoned.
		const runs =
			employment == null
				? []
				: yield* api.db.query.payroll_runs.findMany({
						where: { company_id: { eq: employment.company_id } },
						columns: {
							period: true,
							lifecycle: true,
							attendance_from: true,
							attendance_to: true
						},
						limit: QUERY_LIMIT
					});
		const lock = sourceLock({
			existing: true,
			approvalId,
			dates: [dateKey(workDate)],
			today: todayKey(),
			windows: payrollWindows(runs),
			settledBy,
			freezeWhenLive: false
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
	value: readonly WorkedInterval[],
	breakMinutes: number | null | undefined
): void {
	let previousEnd = Number.NEGATIVE_INFINITY;
	let closedMinutes = 0;
	for (const [index, interval] of value.entries()) {
		const startedAt = Date.parse(interval.start_at);
		const endedAt = interval.end_at == null ? null : Date.parse(interval.end_at);
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
	const hasOpenInterval = value.some((interval) => interval.end_at == null);
	if (!hasOpenInterval && unpaidBreak >= closedMinutes) {
		refuse('Unpaid break must be shorter than the recorded worked time.');
	}
}

export default {
	create: {
		before: {
			description:
				'Requires ordered, non-overlapping worked intervals; only the final interval may remain open, and no overtime classification is accepted or stored. Attendance cannot be recorded on a day approved leave already owns, or on a day a paid payroll run settled.',
			batchHandler: ({ inputs }) => {
				for (const input of inputs) {
					assertWorkedIntervals(input.worked_intervals, input.break_minutes);
				}
				return inputs;
			},
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					assertWorkedIntervals(input.worked_intervals, input.break_minutes);
					yield* assertDayNotSettled(api, input.employment_id, input.work_date);
					yield* assertDayNotOwnedByLeave(api, input.employment_id, input.work_date);
					return input;
				})
		}
	},
	update: {
		before: {
			description:
				'Re-checks the complete patched attendance row so partial edits cannot create overlapping intervals, time reversal or an impossible unpaid break, or rewrite a day that has passed, approved leave owns, or a payroll run has already taken into account.',
			handler: ({ input, existing, api }) =>
				Effect.gen(function* () {
					yield* assertAttendanceSourceUnlocked(
						api,
						existing.norbital_id,
						existing.employment_id,
						existing.work_date,
						existing.norbital_approval_id,
						'Changing attendance'
					);
					assertWorkedIntervals(
						input.worked_intervals ?? existing.worked_intervals,
						input.break_minutes ?? existing.break_minutes
					);
					yield* assertDayNotSettled(
						api,
						input.employment_id ?? existing.employment_id,
						input.work_date ?? existing.work_date
					);
					yield* assertDayNotOwnedByLeave(
						api,
						input.employment_id ?? existing.employment_id,
						input.work_date ?? existing.work_date
					);
					return input;
				})
		}
	},
	delete: {
		before: {
			description:
				'Refuses deleting attendance a payroll run has already taken into account, or on a day that has already passed or a paid payroll run settled.',
			handler: ({ existing, api }) =>
				Effect.gen(function* () {
					yield* assertAttendanceSourceUnlocked(
						api,
						existing.norbital_id,
						existing.employment_id,
						existing.work_date,
						existing.norbital_approval_id,
						'Deleting attendance'
					);
				})
		}
	}
} satisfies Hooks;
