import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A natural person. Holds only facts true of the human being — never of a job; everything employment-shaped lives on employment contracts.',
	icon: 'lucide:user',
	label: 'name',
	fields: {
		name: {
			kind: 'text'
		},
		date_of_birth: {
			kind: 'date',
			optional: true
		},
		gender: {
			kind: 'enum',
			values: ['MALE', 'FEMALE'],
			optional: true
		},
		marital_status: {
			kind: 'enum',
			values: ['SINGLE', 'MARRIED', 'DIVORCED'],
			optional: true
		},
		solo_parent: {
			kind: 'bool',
			default: false
		},
		disabled: {
			kind: 'bool',
			default: false
		},
		receiving_pension: {
			kind: 'bool',
			default: false
		},
		race: {
			kind: 'text',
			optional: true
		},
		religion: {
			kind: 'text',
			optional: true
		},
		spouse_status: {
			kind: 'enum',
			values: ['NONE', 'WITHOUT_INCOME', 'WITH_INCOME'],
			optional: true
		},
		children: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						child_birthdate: {
							kind: 'text'
						},
						child_deathdate: {
							kind: 'text',
							optional: true
						},
						child_confinement_date: {
							kind: 'text',
							optional: true
						},
						estimated_delivery_date: {
							kind: 'text',
							optional: true
						},
						adoption_eligibility_date: {
							kind: 'text',
							optional: true
						},
						relationship: {
							kind: 'enum',
							values: ['CHILD', 'STEPCHILD', 'ADOPTED', 'LEGAL_WARD']
						},
						effective_range: {
							kind: 'period',
							of: 'instant',
							optional: true
						},
						citizenship: {
							kind: 'enum',
							values: ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER'],
							optional: true
						},
						shared_parental_weeks: {
							kind: 'int',
							min: 0,
							optional: true
						},
						prior_employment_days: {
							kind: 'int',
							min: 0,
							optional: true
						},
						prior_childcare_days: {
							kind: 'int',
							min: 0,
							optional: true
						},
						prior_extended_childcare_days: {
							kind: 'int',
							min: 0,
							optional: true
						},
						prior_infant_care_days: {
							kind: 'int',
							min: 0,
							optional: true
						},
						relief_class: {
							kind: 'text',
							optional: true
						}
					}
				}
			},
			default: []
		},
		nationality: {
			kind: 'text',
			optional: true,
			help: 'ISO 3166-1 alpha-2 country code (for example SG). Jurisdiction rules compare it as a code.'
		},
		identity_number: {
			kind: 'text',
			optional: true
		},
		dependents_count: {
			kind: 'int',
			min: 0,
			default: 0
		},
		email: {
			kind: 'text',
			format: 'email',
			optional: true
		},
		phone: {
			kind: 'text',
			format: 'phone',
			optional: true
		},
		address: {
			kind: 'text',
			optional: true
		},
		location: {
			kind: 'point',
			optional: true
		},
		face_embedding: {
			kind: 'vector',
			dim: 1024,
			metric: 'cosine',
			optional: true
		},
		face_photo: {
			kind: 'file',
			accept: ['image/jpeg', 'image/png'],
			max: '5MiB',
			optional: true
		},
		face_enrollment_status: {
			kind: 'enum',
			values: ['NONE', 'PENDING', 'APPROVED', 'SUSPENDED'],
			default: 'NONE'
		},
		face_consent_at: {
			kind: 'instant',
			optional: true
		},
		face_enrolled_at: {
			kind: 'instant',
			optional: true
		},
		face_last_match_at: {
			kind: 'instant',
			optional: true
		},
		face_match_count: {
			kind: 'int',
			min: 0,
			default: 0
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: {
					kind: 'json'
				}
			},
			optional: true
		}
	}
});
