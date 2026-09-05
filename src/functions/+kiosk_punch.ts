import { defineCommandHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import {
	calendarDateInTimeZone,
	PAYROLL_TIME_ZONE,
	startOfDayInstant
} from '../lib/ui/calendar.js';
import {
	KIOSK_PUNCH_COOLDOWN_MS,
	nextPunch,
	type PunchInterval,
	type PunchOutcome
} from '../lib/kiosk/punch.js';
import type { Api } from './$types.js';
import { dateKey } from '../lib/iso-day.js';
import { inForceOnDay } from '../lib/effective_range.js';

export default defineCommandHandler({
	description:
		'Records one kiosk punch: keeps the first arrival and latest explicit departure on the person-day. Repeated arrivals and older departures write nothing.',
	schema: Schema.Struct({
		employment_id: Schema.String.check(Schema.isUUID()),
		kind: Schema.Literals(['FACE', 'MANUAL']),
		direction: Schema.optional(Schema.Literals(['in', 'out']))
	}),
	handler: ({ employment_id, kind, direction }, api: Api) =>
		Effect.gen(function* () {
			const now = new Date(yield* Clock.currentTimeMillis).toISOString();
			const employment = yield* api.db.employments.findFirst({
				where: { id: { eq: employment_id } },
				columns: {
					id: true,
					employee_id: true,
					hire_date: true,
					exit_date: true,
					effective_range: true
				}
			});
			if (employment === undefined) refuse('Employment does not exist.');
			const dayKey = calendarDateInTimeZone(new Date(now), PAYROLL_TIME_ZONE);
			if (
				!inForceOnDay(employment.effective_range, dayKey) ||
				dateKey(employment.hire_date) > dayKey ||
				(employment.exit_date != null && dateKey(employment.exit_date) < dayKey)
			)
				refuse('This employment is not active today.');
			const employee = yield* api.db.employees.findFirst({
				where: { id: { eq: employment.employee_id } },
				columns: {
					id: true,
					face_last_match_at: true,
					face_match_count: true,
					face_enrollment_status: true
				}
			});
			if (employee === undefined) refuse('Employee does not exist.');
			if (kind === 'FACE' && employee.face_enrollment_status !== 'APPROVED')
				refuse('Face attendance requires an approved enrollment.');
			const workDate = startOfDayInstant(dayKey, PAYROLL_TIME_ZONE);
			const stored = yield* api.db.work_days.findFirst({
				where: { employment_id: { eq: employment_id }, work_date: { eq: workDate } },
				columns: { id: true, worked_intervals: true }
			});
			const intervals: readonly PunchInterval[] | null = stored?.worked_intervals ?? null;
			const outcome: PunchOutcome = nextPunch(
				intervals,
				now,
				employee.face_last_match_at,
				direction ?? 'in'
			);
			if (outcome.kind === 'blocked') return { status: 'blocked', ...outcome, kind } as const;
			if (stored === undefined) {
				yield* api.db.work_days.mutate([
					{
						employment_id,
						work_date: workDate,
						worked_intervals: outcome.intervals,
						break_minutes: 0
					}
				]);
			} else {
				yield* api.db.work_days.mutate([{ id: stored.id, worked_intervals: outcome.intervals }]);
			}
			if (kind === 'FACE')
				yield* api.db.employees.mutate([
					{
						id: employee.id,
						face_last_match_at: now,
						face_match_count: (employee.face_match_count ?? 0) + 1
					}
				]);
			return {
				status: outcome.kind,
				kind,
				intervalIndex: outcome.index,
				time: now,
				cooldownMs: KIOSK_PUNCH_COOLDOWN_MS
			} as const;
		})
});
