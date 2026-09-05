import { defineCommandHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import {
	calendarDateInTimeZone,
	PAYROLL_TIME_ZONE,
	startOfDayInstant
} from '../lib/ui/calendar.js';
import { KIOSK_EMBEDDING_DIMENSIONS } from './+kiosk_match.js';
import type { Api } from './$types.js';

const facePhotoSchema = Schema.Struct({
	storage_key: Schema.String,
	file_name: Schema.String,
	file_size: Schema.Number,
	mime_type: Schema.String
});

export default defineCommandHandler({
	description:
		'Enrolls a kiosk face: attaches the descriptor to a known person (approved at once), or creates the person and their employment as PENDING for HR review. The kiosk policy — never this function — is what keeps APPROVED out of kiosk reach.',
	schema: Schema.Struct({
		employee_id: Schema.optional(Schema.String.check(Schema.isUUID())),
		new_person: Schema.optional(
			Schema.Struct({
				name: Schema.String,
				email: Schema.optional(Schema.String),
				phone: Schema.optional(Schema.String),
				company_id: Schema.String.check(Schema.isUUID()),
				employee_number: Schema.optional(Schema.String)
			})
		),
		face_embedding: Schema.Array(Schema.Finite),
		face_photo: Schema.optional(facePhotoSchema),
		consent_at: Schema.String
	}),
	handler: ({ employee_id, new_person, face_embedding, face_photo, consent_at }, api: Api) =>
		Effect.gen(function* () {
			if (face_embedding.length !== KIOSK_EMBEDDING_DIMENSIONS) {
				refuse(
					`Embedding must hold ${KIOSK_EMBEDDING_DIMENSIONS} numbers, got ${face_embedding.length}.`
				);
			}
			if (Number.isNaN(new Date(consent_at).getTime())) refuse('Consent instant is not valid.');
			const now = new Date(yield* Clock.currentTimeMillis).toISOString();
			if (new Date(consent_at).getTime() > new Date(now).getTime())
				refuse('Consent cannot be recorded in the future.');
			if (employee_id !== undefined) {
				if (new_person !== undefined) refuse('Pass an employee or a new person, not both.');
				const existing = yield* api.db.employees.findFirst({
					where: { id: { eq: employee_id } },
					columns: { id: true, name: true, face_enrollment_status: true }
				});
				if (existing === undefined) refuse('Employee does not exist.');
				if (
					existing.face_enrollment_status === 'PENDING' ||
					existing.face_enrollment_status === 'SUSPENDED'
				) {
					refuse(
						'HR must review this pending or suspended face enrollment before it can be replaced.'
					);
				}
				yield* api.db.employees.mutate([
					{
						id: employee_id,
						face_embedding: [...face_embedding],
						...(face_photo === undefined ? {} : { face_photo }),
						face_enrollment_status: 'APPROVED',
						face_consent_at: consent_at,
						face_enrolled_at: now
					}
				]);
				return { employee_id, status: 'APPROVED' } as const;
			}
			if (new_person === undefined) refuse('Pass an employee or a new person.');
			const employmentId = crypto.randomUUID();
			const employeeNumber = new_person.employee_number?.trim() || `KIOSK-${employmentId}`;
			if (new_person.name.trim().length === 0) refuse('A new person needs a name.');
			const todayKey = calendarDateInTimeZone(new Date(now), PAYROLL_TIME_ZONE);
			const hireDate = startOfDayInstant(todayKey, PAYROLL_TIME_ZONE);
			// The nested employment and person commit together. Its minted child identity gives
			// readback an exact key; names and timestamps cannot safely identify a new person.
			yield* api.db.employees.mutate([
				{
					name: new_person.name.trim(),
					...(new_person.email === undefined ? {} : { email: new_person.email }),
					...(new_person.phone === undefined ? {} : { phone: new_person.phone }),
					face_embedding: [...face_embedding],
					...(face_photo === undefined ? {} : { face_photo }),
					face_enrollment_status: 'PENDING',
					face_consent_at: consent_at,
					face_enrolled_at: now,
					employment_employee: [
						{
							id: employmentId,
							company_id: new_person.company_id,
							employee_number: employeeNumber,
							hire_date: hireDate,
							effective_range: { start: hireDate, end: null }
						}
					]
				}
			]);
			const created = yield* api.db.employments.findFirst({
				where: { id: { eq: employmentId } },
				columns: { employee_id: true }
			});
			if (created === undefined) refuse('Person creation did not persist.');
			return {
				status: 'PENDING',
				employee_id: created.employee_id,
				company_id: new_person.company_id,
				employee_number: employeeNumber
			} as const;
		})
});
