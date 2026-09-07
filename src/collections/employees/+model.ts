import {
	defineModel,
	enums,
	file,
	geolocation,
	instant,
	integer,
	phone,
	text,
	uuid,
	vector
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		name: text({ search: true }).notNull(),
		date_of_birth: instant({ precision: 'day' }),
		gender: enums(['MALE', 'FEMALE']),
		marital_status: enums(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']),
		/**
		 * Whether the employee has a spouse, and whether that spouse has total income of their own.
		 *
		 * `marital_status` cannot answer this and every spouse relief turns on it: Malaysia's s.47
		 * relief and its MTD Category 2 scale both ask whether the spouse has income, not whether
		 * the employee is married. The two genuinely differ — a separated-but-not-divorced employee
		 * may record SINGLE while still supporting a spouse, and a married employee whose spouse
		 * works qualifies for neither. `null` means unrecorded, which is read as no relief.
		 */
		spouse_status: enums(['NONE', 'WITHOUT_INCOME', 'WITH_INCOME']),
		nationality: text(),
		/**
		 * The employee's standing in the jurisdiction their employment is governed by, which is the
		 * fact statutory eligibility actually turns on.
		 *
		 * `nationality` cannot answer this and is not a substitute for it. It is free text — the seed
		 * bank alone carries `INDONESIAN`, `JAPANESE` and `Filipino` — so a rule written against it
		 * silently matches nobody, which is the worst failure a statutory rule has: it reports the
		 * empty answer as the correct one. And the two facts genuinely differ: a Singapore permanent
		 * resident's nationality is Malaysian or Indian, yet they carry the same national service
		 * liability a citizen does, so overwriting `nationality` with `PR` would corrupt the field
		 * every people directory displays in order to answer a question it was never asked.
		 *
		 * Relative to the jurisdiction, not naming one: a leave row lives under a settings lineage
		 * already, so CITIZEN under the SG lineage is a Singapore citizen and CITIZEN under MY is a
		 * Malaysian one. `null` is unrecorded, and an unrecorded standing satisfies no rule.
		 */
		residency_status: enums(['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER']),
		identity_number: text(),
		dependents_count: integer().notNull().default(0),
		email: text(),
		phone: phone(),
		address: geolocation(),
		user_id: uuid(),
		/**
		 * Kiosk face-recognition descriptor (1024-d, cosine). Written by enrollment, read by
		 * `kiosk_match` through `findNearest`. Null means never enrolled.
		 */
		face_embedding: vector({ dimensions: 1024 }),
		/** Enrollment snapshot, for HR review of PENDING rows. */
		face_photo: file({ mimeTypes: ['image/jpeg', 'image/png'] }),
		/**
		 * Kiosk-side lifecycle only: NONE (never enrolled), PENDING (kiosk-created person awaiting
		 * HR review), APPROVED (matchable), SUSPENDED (explicitly barred from matching). The kiosk
		 * may only ever write PENDING; APPROVED and SUSPENDED are HR decisions.
		 */
		face_enrollment_status: enums(['NONE', 'PENDING', 'APPROVED', 'SUSPENDED'])
			.notNull()
			.default('NONE'),
		face_consent_at: instant(),
		face_enrolled_at: instant(),
		face_last_match_at: instant(),
		face_match_count: integer().notNull().default(0)
	},
	{
		description:
			'A natural person. Holds only facts true of the human being — never of a job; everything employment-shaped lives on employments.',
		recordLabel: 'name',
		icon: 'lucide:user',
		indexes: [
			{
				name: 'employees_face_embedding_hnsw',
				method: 'hnsw',
				columns: ['face_embedding'],
				opclass: { face_embedding: 'vector_cosine_ops' }
			}
		]
	}
);
