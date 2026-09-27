import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A natural person. Holds only facts true of the human being — never of a job; everything employment-shaped lives on employments.',
	icon: 'lucide:user',
	label: 'name',
	fields: {
		name: { kind: 'text' },
		date_of_birth: { kind: 'date', optional: true },
		gender: { kind: 'enum', values: ['MALE', 'FEMALE'], optional: true },
		/** Standing a statutory band or leave may key on; null is unrecorded. */
		marital_status: { kind: 'enum', values: ['SINGLE', 'MARRIED', 'DIVORCED'], optional: true },
		/** A solo parent under a statute that names one (PH RA 8972). */
		solo_parent: { kind: 'bool', default: false },
		/** A person with a disability under a statute that grants one more (VN art.113(1)(b), MY PCB relief). */
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
		children: { kind: 'custom', of: 'employee_children', default: [] },
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
