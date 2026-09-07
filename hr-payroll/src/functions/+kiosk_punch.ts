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
import { coversDate } from '../collections/payroll_runs/lib/effective.js';
import { patternRosterCodeId } from '../lib/scheduling/work-pattern.js';
import { rosterCodeKind } from '../lib/scheduling/roster-code.js';

export default defineCommandHandler({
	description:
		'Records one kiosk punch against the day the person is scheduled to work: the first punch of the day is the arrival and every later one moves the departure. A face punch on a day with no scheduled shift, or on a rest or off day, is refused.',
	schema: Schema.Struct({
		employment_id: Schema.String.check(Schema.isUUID()),
		kind: Schema.Literals(['FACE', 'MANUAL'])
	}),
	handler: ({ employment_id, kind }, api: Api) =>
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
				columns: { id: true, worked_intervals: true, shift_definition_id: true }
			});

			/**
			 * The day's plan, which a face punch must have.
			 *
			 * A punch used to create a plan-less `work_days` row for whoever stood at the tablet, on
			 * any day at all — a rest day, a public holiday, somebody else's shift. The plan is
			 * resolvable, and by the rule the rest of this workspace already uses: an explicit roster
			 * assignment on the row wins, and otherwise the employment terms' shift pattern projects
			 * the day's code (`explicitId ?? projectedId`, as in `work_days/+hooks.ts`).
			 *
			 * Nothing is stamped onto the row. Writing the projected code as an explicit assignment
			 * would freeze it, and the day would stop following its own pattern; the plan is read to
			 * decide whether the punch may happen, and the projection stays a projection.
			 */
			const terms = yield* api.db.employment_terms.findMany({
				where: { employment_id: { eq: employment_id }, approval_id: { isNull: true } },
				columns: { shift_pattern_id: true, effective_range: true },
				limit: 200
			});
			const term = terms.find((candidate) => coversDate(candidate.effective_range, dayKey));
			// Terms that name no pattern are rostered as assigned: there is no base to project, so
			// only an explicit roster entry can put the person on this day.
			const patternRow =
				term?.shift_pattern_id == null
					? undefined
					: yield* api.db.shift_patterns.findFirst({
							where: { id: { eq: term.shift_pattern_id } },
							columns: { id: true, pattern: true }
						});
			// `patternRosterCodeId` throws on a pattern it cannot measure, and nothing stops such a row
			// being stored: `shift_patterns` has no write hook. A projection that cannot be computed
			// is "no base", exactly as `work_days/+hooks.ts` treats it — so a malformed pattern makes
			// the punch fall through to the plain "no shift scheduled today" refusal instead of
			// failing the command with an error nobody at a tablet can act on.
			let projectedCodeId: string | null = null;
			if (patternRow !== undefined) {
				try {
					projectedCodeId = patternRosterCodeId(patternRow.pattern, dayKey);
				} catch {
					projectedCodeId = null;
				}
			}
			const plannedCodeId = stored?.shift_definition_id ?? projectedCodeId;
			const plannedCode =
				plannedCodeId == null
					? undefined
					: yield* api.db.shift_definitions.findFirst({
							where: { id: { eq: plannedCodeId } },
							columns: { id: true, code: true, variant: true }
						});
			/**
			 * Not scheduled is a *blocked outcome*, not a refusal.
			 *
			 * `refuse` throws, and the kiosk's catch renders anything thrown as "Recording failed" in
			 * red, speaking "Something went wrong. Try again." — which is a lie to the person at the
			 * tablet: nothing went wrong, they are simply not rostered today. The command already has
			 * a channel meaning exactly "the punch did not happen, and here is why" (the cooldown
			 * uses it), so this rides the same one and the screen can say so in the right tone.
			 *
			 * MANUAL is untouched: the model admits "actual present, planned absent" as a call-back or
			 * an ad hoc day, and a supervisor entering that by hand is the path for it.
			 */
			if (kind === 'FACE' && plannedCode === undefined)
				return { status: 'blocked', kind, reason: 'not-scheduled' } as const;
			if (
				kind === 'FACE' &&
				plannedCode !== undefined &&
				rosterCodeKind(plannedCode.variant) !== 'WORK'
			)
				return {
					status: 'blocked',
					kind,
					reason: 'not-a-work-day',
					plannedCode: plannedCode.code
				} as const;

			const intervals: readonly PunchInterval[] | null = stored?.worked_intervals ?? null;
			const outcome: PunchOutcome = nextPunch(intervals, now, employee.face_last_match_at);
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
