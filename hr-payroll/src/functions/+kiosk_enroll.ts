import { defineCommandHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
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
		face_embedding: Schema.Array(Schema.Number),
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
			const now = new Date().toISOString();
			if (employee_id !== undefined) {
				if (new_person !== undefined) refuse('Pass an employee or a new person, not both.');
				const existing = yield* api.db.employees.findFirst({
					where: { id: { eq: employee_id } },
					columns: { id: true, name: true, face_enrollment_status: true }
				});
				if (existing === undefined) refuse('Employee does not exist.');
				if (existing.face_enrollment_status !== 'NONE') {
					refuse('This person already has a face enrollment; HR owns changes to it.');
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
			const employeeNumber =
				new_person.employee_number ?? `KIOSK-${Date.now().toString(36).toUpperCase()}`;
			const todayKey = calendarDateInTimeZone(new Date(now), PAYROLL_TIME_ZONE);
			const hireDate = startOfDayInstant(todayKey, PAYROLL_TIME_ZONE);
			// Server writes return no rows, and a submitted id would route to the update path,
			// so the created person is re-read by the exact enrollment instant this call minted.
			yield* api.db.employees.mutate([
				{
					name: new_person.name,
					...(new_person.email === undefined ? {} : { email: new_person.email }),
					...(new_person.phone === undefined ? {} : { phone: new_person.phone }),
					face_embedding: [...face_embedding],
					...(face_photo === undefined ? {} : { face_photo }),
					face_enrollment_status: 'PENDING',
					face_consent_at: consent_at,
					face_enrolled_at: now
				}
			]);
			const created = yield* api.db.employees.findFirst({
				where: { name: { eq: new_person.name }, face_enrolled_at: { eq: now } },
				columns: { id: true }
			});
			if (created === undefined) refuse('Person creation did not persist.');
			yield* api.db.employments.mutate([
				{
					employee_id: created.id,
					company_id: new_person.company_id,
					employee_number: employeeNumber,
					hire_date: hireDate,
					effective_range: { start: hireDate, end: null }
				}
			]);
			return {
				status: 'PENDING',
				employee_id: created.id,
				company_id: new_person.company_id,
				employee_number: employeeNumber
			} as const;
		})
});
