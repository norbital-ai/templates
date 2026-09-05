import { defineQueryHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/ui/calendar.js';
import { inForceOnDay } from '../lib/effective_range.js';
import { dateKey } from '../lib/iso-day.js';
import type { Api } from './$types.js';

/** Cosine distance at or below which a probe counts as the enrolled person. */
export const KIOSK_MATCH_THRESHOLD = 0.4;
/** Width of the `faceres` descriptor the kiosk writes and matches. */
export const KIOSK_EMBEDDING_DIMENSIONS = 1024;

export default defineQueryHandler({
	description:
		'Identifies one kiosk face probe against approved enrollments: nearest cosine neighbour on employees.face_embedding, with the current employment for the punch that follows.',
	schema: Schema.Struct({
		probe: Schema.Array(Schema.Finite),
		threshold: Schema.optional(
			Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: KIOSK_MATCH_THRESHOLD }))
		)
	}),
	handler: ({ probe, threshold }, api: Api) =>
		Effect.gen(function* () {
			if (probe.length !== KIOSK_EMBEDDING_DIMENSIONS) {
				refuse(`Probe must hold ${KIOSK_EMBEDDING_DIMENSIONS} numbers, got ${probe.length}.`);
			}
			const nearest = yield* api.db.employees.findNearest({
				column: 'face_embedding',
				probe: [...probe],
				metric: 'cosine',
				maxDistance: threshold ?? KIOSK_MATCH_THRESHOLD,
				limit: 1,
				where: { face_enrollment_status: { eq: 'APPROVED' }, approval_id: { isNull: true } },
				columns: { id: true, name: true, face_match_count: true }
			});
			const hit = nearest[0];
			if (hit === undefined) return { status: 'unknown' } as const;
			const employments = yield* api.db.employments.findMany({
				where: { employee_id: { eq: hit.id }, approval_id: { isNull: true } },
				columns: {
					id: true,
					employee_id: true,
					company_id: true,
					employee_number: true,
					hire_date: true,
					exit_date: true,
					effective_range: true
				},
				orderBy: { hire_date: 'desc' },
				limit: 10
			});
			const today = calendarDateInTimeZone(
				new Date(yield* Clock.currentTimeMillis),
				PAYROLL_TIME_ZONE
			);
			const current = employments.find(
				(employment) =>
					inForceOnDay(employment.effective_range, today) &&
					dateKey(employment.hire_date) <= today &&
					(employment.exit_date == null || dateKey(employment.exit_date) >= today)
			);
			if (current === undefined) {
				return {
					status: 'unenrolled',
					employee: { id: hit.id, name: hit.name },
					distance: hit.distance
				} as const;
			}
			return {
				status: 'match',
				employee: { id: hit.id, name: hit.name },
				employment: {
					id: current.id,
					employee_number: current.employee_number,
					company_id: current.company_id
				},
				distance: hit.distance
			} as const;
		})
});
