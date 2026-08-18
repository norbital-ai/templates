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
	sourceLockMessage
} from '../../lib/scheduling/lock.js';
import type { HookApi, Hooks } from './$types.js';

const QUERY_LIMIT = 20_000;

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
	employmentId: string,
	workDate: string | Date,
	approvalId: string | null | undefined,
	action: string
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
		const lock = sourceLock({
			existing: true,
			approvalId,
			dates: [dateKey(workDate)],
			today: todayKey(),
			windows: payrollWindows(runs),
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
				'Re-checks the complete patched attendance row so partial edits cannot create overlapping intervals, time reversal or an impossible unpaid break, or rewrite a day that has passed, approved leave owns, or a paid payroll run settled.',
			handler: ({ input, existing, api }) =>
				Effect.gen(function* () {
					yield* assertAttendanceSourceUnlocked(
						api,
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
				'Refuses deleting attendance on a day that has already passed or a paid payroll run settled.',
			handler: ({ existing, api }) =>
				Effect.gen(function* () {
					yield* assertAttendanceSourceUnlocked(
						api,
						existing.employment_id,
						existing.work_date,
						existing.norbital_approval_id,
						'Deleting attendance'
					);
				})
		}
	}
} satisfies Hooks;
