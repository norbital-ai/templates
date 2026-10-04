import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One employment_profile record.',
	icon: 'lucide:file-text',
	label: 'name',
	fields: {
		name: { kind: 'text', optional: true },
		date_of_birth: { kind: 'text', optional: true },
		gender: { kind: 'text', optional: true },
		marital_status: { kind: 'text', optional: true },
		solo_parent: { kind: 'text', optional: true },
		disabled: { kind: 'text', optional: true },
		receiving_pension: { kind: 'text', optional: true },
		race: { kind: 'text', optional: true },
		religion: { kind: 'text', optional: true },
		spouse_status: { kind: 'text', optional: true },
		children: { kind: 'text', optional: true },
		nationality: { kind: 'text', optional: true },
		identity_number: { kind: 'text', optional: true },
		dependents_count: { kind: 'text', optional: true },
		email: { kind: 'text', optional: true },
		phone: { kind: 'text', optional: true },
		address: { kind: 'text', optional: true },
		location: { kind: 'text', optional: true },
		face_embedding: { kind: 'text', optional: true },
		face_photo: { kind: 'text', optional: true },
		face_enrollment_status: { kind: 'text', optional: true },
		face_consent_at: { kind: 'instant', optional: true },
		face_enrolled_at: { kind: 'instant', optional: true },
		face_last_match_at: { kind: 'instant', optional: true },
		face_match_count: { kind: 'text', optional: true },
		facts: { kind: 'text', optional: true }
	}
});
