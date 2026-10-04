import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A natural person. Holds only facts true of the human being — never of a job; everything employment-shaped lives on employee_profiles.',
	icon: 'lucide:user',
	label: 'name',
	fields: {
    input_column_history: { kind: 'json', optional: true, hidden: true },
		input_census: { kind: 'json', optional: true, hidden: true },
		/** Original proof records retain their IDs and exact accepted schema/value bindings. */
		input_originals: { kind: 'json', optional: true, hidden: true },
		input_proofs: { kind: 'json', optional: true, hidden: true },
		input_files: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true, optional: true, hidden: true },
		input_schema_code: { kind: 'text' },
		facts: { kind: 'json' },
		input_schema_snapshot: { kind: 'json', optional: true, hidden: true },
		input_history: { kind: 'json', optional: true, hidden: true },
		name: { kind: 'text' },
		date_of_birth: { kind: 'date', optional: true },
		gender: { kind: 'enum', values: ['MALE', 'FEMALE'], optional: true },
		/** Standing a statutory band or leave may key on; null is unrecorded. */
		marital_status: { kind: 'enum', values: ['SINGLE', 'MARRIED', 'DIVORCED'], optional: true },
		/** A solo parent under a statute that names one (PH RA 8972). */
		solo_parent: { kind: 'bool', default: false },
		/** A person with a disability; `employee.disabled`, read by the lineage's expressions. */
		disabled: { kind: 'bool', default: false },
		/** Drawing a statutory pension while employed (VN Law 41/2024 art.2(7)(a)). */
		receiving_pension: { kind: 'bool', default: false },
		/** Only where a statutory fund is selected by it (SG's SHG funds). */
		race: { kind: 'text', optional: true },
		religion: { kind: 'text', optional: true },
		/** Whether the employee has a spouse, and whether that spouse has income; null is unrecorded (no relief). */
		spouse_status: {
			kind: 'enum',
			values: ['NONE', 'WITHOUT_INCOME', 'WITH_INCOME'],
			optional: true
		},
		/** Append-only child facts; `[]` when none. */
		children: { kind: 'json', shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				child_birthdate: { kind: 'text' },
				child_deathdate: { kind: 'text', optional: true },
				child_confinement_date: { kind: 'text', optional: true },
				estimated_delivery_date: { kind: 'text', optional: true },
				adoption_eligibility_date: { kind: 'text', optional: true },
				relationship: { kind: 'enum', values: ['CHILD', 'STEPCHILD', 'ADOPTED', 'LEGAL_WARD'] },
				effective_range: { kind: 'period', of: 'instant', optional: true },
				/** The same standing classes as `employment_terms.residency_status`. */
				citizenship: {
					kind: 'enum',
					values: ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER'],
					optional: true
				},
				shared_parental_weeks: { kind: 'int', min: 0, optional: true },
				prior_employment_days: { kind: 'int', min: 0, optional: true },
				prior_childcare_days: { kind: 'int', min: 0, optional: true },
				prior_extended_childcare_days: { kind: 'int', min: 0, optional: true },
				prior_infant_care_days: { kind: 'int', min: 0, optional: true },
				relief_class: { kind: 'text', optional: true }
			}
		}
	}, default: [] },
		nationality: { kind: 'text', optional: true },
		identity_number: { kind: 'text', optional: true },
		dependents_count: { kind: 'int', min: 0, default: 0 },
		/** Self-service scopes compare it case-folded to the signed-in member's email. */
		email: { kind: 'text', format: 'email', optional: true },
		phone: { kind: 'text', format: 'phone', optional: true },
		/** The formatted address, kept whether or not the host has a geocoder. */
		address: { kind: 'text', optional: true },
		location: { kind: 'point', optional: true },
		/** Kiosk face descriptor (1024-d, cosine); null is never enrolled. Read by `kiosk_match`. */
		face_embedding: { kind: 'vector', dim: 1024, metric: 'cosine', optional: true },
		/** Enrollment snapshot, for HR review of PENDING rows. */
		face_photo: { kind: 'file', accept: ['image/jpeg', 'image/png'], max: '5MiB', optional: true },
		/** NONE never enrolled, PENDING kiosk-created awaiting HR, APPROVED matchable, SUSPENDED barred. */
		face_enrollment_status: {
			kind: 'enum',
			values: ['NONE', 'PENDING', 'APPROVED', 'SUSPENDED'],
			default: 'NONE'
		},
		face_consent_at: { kind: 'instant', optional: true },
		face_enrolled_at: { kind: 'instant', optional: true },
		face_last_match_at: { kind: 'instant', optional: true },
		face_match_count: { kind: 'int', min: 0, default: 0 }
	},
	search: { text: ['name'] }
});
