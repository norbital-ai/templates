import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';

const columns = {
	name: true,
	date_of_birth: true,
	gender: true,
	marital_status: true,
	solo_parent: true,
	race: true,
	religion: true,
	spouse_status: true,
	children: true,
	nationality: true,
	identity_number: true,
	dependents_count: true,
	disabled: true,
	receiving_pension: true,
	email: true,
	phone: true,
	address: true,
	user_id: true,
	face_embedding: true,
	face_photo: true,
	face_enrollment_status: true,
	face_consent_at: true,
	face_enrolled_at: true,
	face_last_match_at: true,
	face_match_count: true
} as const;

/**
 * The person. Child facts are append-only: close a wrong fact with its period and append the
 * correction. A kiosk enrolment creates the person and their first employment together, so the
 * create input accepts the employment under `employment_employee`.
 */
export default defineCollection({
	model,
	create: {
		input: {
			columns,
			with: {
				employment_employee: {
					create: { columns: { company_id: true, employee_number: true, effective_range: true } }
				}
			}
		}
	},
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing }) =>
		Effect.sync(() =>
			inputs.map((input, index) => {
				const stored = existing[index];
				if (stored != null && input.children != null) {
					const prior = stored.children ?? [];
					if (
						input.children.length < prior.length ||
						prior.some((row, position) => stableJson(row) !== stableJson(input.children![position]))
					)
						refuse(
							'Child facts are append-only. Close a wrong fact with its effective period and append the correction.'
						);
				}
				// A person created with their first employment: the stint's rolling number is 1, and
				// the employment transform does not run for a nested row.
				if (!('employment_employee' in input) || input.employment_employee?.create == null)
					return input;
				return {
					...input,
					employment_employee: {
						...input.employment_employee,
						create: input.employment_employee.create.map((row, position) => ({
							...row,
							contract_number: position + 1
						}))
					}
				};
			})
		)
});
