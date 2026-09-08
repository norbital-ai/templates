import { resolveEmployment } from '../lib/employment-contract.js';
import { defineQueryHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/ui/calendar.js';
import { inForceOnDay } from '../lib/effective_range.js';
import { dateKey } from '../lib/iso-day.js';
import type { Api } from './$types.js';
import {
	KIOSK_MATCH_THRESHOLD,
	KIOSK_MATCH_MARGIN,
	KIOSK_EMBEDDING_DIMENSIONS
} from '../lib/kiosk/embed.js';

export default defineQueryHandler({
	description:
		'Identifies an approved face only when clearly separated from the runner-up, then resolves exactly one active employment contract in the explicitly selected entity.',
	schema: Schema.Struct({
		company_id: Schema.String.check(Schema.isUUID()),
		probe: Schema.Array(Schema.Finite),
		threshold: Schema.optional(
			Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: KIOSK_MATCH_THRESHOLD }))
		)
	}),
	handler: ({ company_id, probe, threshold }, api: Api) =>
		Effect.gen(function* () {
			if (probe.length !== KIOSK_EMBEDDING_DIMENSIONS) {
				refuse(`Probe must hold ${KIOSK_EMBEDDING_DIMENSIONS} numbers, got ${probe.length}.`);
			}
			if (probe.every((value) => value === 0)) refuse('Probe must contain a face descriptor.');
			const maximum = threshold ?? KIOSK_MATCH_THRESHOLD;
			const nearest = yield* api.db.employees.findNearest({
				column: 'face_embedding',
				probe: [...probe],
				metric: 'cosine',
				maxDistance: maximum + KIOSK_MATCH_MARGIN,
				limit: 2,
				where: { face_enrollment_status: { eq: 'APPROVED' }, approval_id: { isNull: true } },
				columns: { id: true, name: true, face_match_count: true }
			});
			const hit = nearest[0];
			if (
				hit === undefined ||
				!Number.isFinite(hit.distance) ||
				hit.distance > maximum ||
				(nearest[1] !== undefined && nearest[1].distance - hit.distance < KIOSK_MATCH_MARGIN)
			)
				return { status: 'unknown' } as const;
			const employments = yield* api.db.employments.findMany({
				with: { employment_departure: { where: { approval_id: { isNull: true } } } },
				where: {
					employee_id: { eq: hit.id },
					company_id: { eq: company_id },
					approval_id: { isNull: true }
				},
				columns: {
					id: true,
					employee_id: true,
					company_id: true,
					employee_number: true,
					hire_date: true,
					effective_range: true
				},
				orderBy: { hire_date: 'desc' },
				limit: 1_000
			});
			if (employments.length >= 1_000)
				refuse('Kiosk matching exceeded its employment contract read limit.');
			const today = calendarDateInTimeZone(
				new Date(yield* Clock.currentTimeMillis),
				PAYROLL_TIME_ZONE
			);
			const active = employments
				.map(resolveEmployment)
				.filter(
					(employment) =>
						employment.company_id === company_id &&
						inForceOnDay(employment.effective_range, today) &&
						dateKey(employment.hire_date) <= today &&
						(employment.exit_date == null || dateKey(employment.exit_date) >= today)
				);
			if (active.length > 1)
				refuse(
					'This employee has overlapping active employment contracts in the selected entity. Resolve the contracts before recording attendance.'
				);
			const current = active[0];
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
