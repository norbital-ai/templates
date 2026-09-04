import { defineCommandHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
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

export default defineCommandHandler({
	description:
		'Records one kiosk punch: toggles (or sets, for manual entry) the last worked interval on today\u2019s person-day, with per-person cooldown and orientation dedup. Blocked punches write nothing.',
	schema: Schema.Struct({
		employment_id: Schema.String.check(Schema.isUUID()),
		kind: Schema.Literals(['FACE', 'MANUAL']),
		direction: Schema.optional(Schema.Literals(['in', 'out']))
	}),
	handler: ({ employment_id, kind, direction }, api: Api) =>
		Effect.gen(function* () {
			const now = new Date().toISOString();
			const employment = yield* api.db.employments.findFirst({
				where: { id: { eq: employment_id } },
				columns: { id: true, employee_id: true }
			});
			if (employment === undefined) refuse('Employment does not exist.');
			const employee = yield* api.db.employees.findFirst({
				where: { id: { eq: employment.employee_id } },
				columns: { id: true, face_last_match_at: true, face_match_count: true }
			});
			if (employee === undefined) refuse('Employee does not exist.');
			const dateKey = calendarDateInTimeZone(new Date(now), PAYROLL_TIME_ZONE);
			const workDate = startOfDayInstant(dateKey, PAYROLL_TIME_ZONE);
			const stored = yield* api.db.work_days.findFirst({
				where: { employment_id: { eq: employment_id }, work_date: { eq: workDate } },
				columns: { id: true, worked_intervals: true }
			});
			const intervals: readonly PunchInterval[] | null = stored?.worked_intervals ?? null;
			const outcome: PunchOutcome = nextPunch(
				intervals,
				now,
				employee.face_last_match_at,
				direction === 'in' ? 'in' : direction === 'out' ? 'out' : 'toggle'
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
