import { model } from '../../../../.norbital/models/employee_profile.ts';
import { amendmentsFor } from '../../../lib/amendments.js';
import { tap } from '../../../lib/payroll_engine/taps.js';

/** The s.113 register particulars the template owns on the profile: name and address. */
export const registerChanged = <
	T extends {
		readonly before: { readonly name?: unknown; readonly address?: unknown };
		readonly after: { readonly name?: unknown; readonly address?: unknown };
	}
>(
	changes: readonly T[]
): readonly T[] =>
	changes.filter(
		({ before, after }) =>
			before.name !== after.name || (before.address ?? null) !== (after.address ?? null)
	);

/** The plain fields a formula, a rule or the ledger reads. */
const PRICED = ['cumulative_service', 'date_of_birth', 'gender'] as const;

/** The profile's fields a writer sets. */
const columns = [
	'name',
	'source_reference',
	'cumulative_service',
	'date_of_birth',
	'identity_number',
	'gender',
	'birth_city',
	'bank',
	'email',
	'phone',
	'address',
	'location',
	'documents',
	'face_embedding',
	'face_photo',
	'face_enrollment_status',
	'face_consent_at',
	'face_enrolled_at',
	'invitation_id',
	'user_id'
] as const;

export default model({
	description:
		'One system identity for a person: name, contact details, documents, login, face enrolment and the particulars that never change (date of birth, identity number, gender, bank). What changes by date belongs to their stints.',
	icon: 'lucide:user',
	record_label: 'record.name',
	fields: {
		source_reference: { kind: 'text', optional: true },
		cumulative_service: { kind: 'bool', default: false },
		// the person's fixed particulars: a different value can only mean the old one was wrong
		date_of_birth: { kind: 'date', optional: true },
		identity_number: { kind: 'text', optional: true },
		gender: { kind: 'enum', values: ['MALE', 'FEMALE'], optional: true },
		birth_city: { kind: 'text', optional: true },
		bank: { kind: 'custom', of: 'bank', optional: true },
		name: {
			kind: 'text'
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
		documents: {
			kind: 'file',
			accept: ['application/pdf', 'image/*'],
			max: '20MiB',
			many: true,
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
		invitation_id: {
			kind: 'ref',
			to: 'sys_invitation',
			optional: true,
			on_delete: 'set_null'
		},
		// empty until the person is invited: payroll needs a person, not a login
		user_id: { kind: 'ref', to: 'sys_user', optional: true, on_delete: 'restrict' }
	},
	constraints: {
		invitation_id: { unique: ['invitation_id'] },
		user_id: { unique: ['user_id'] }
	},
	indexes: {
		search: { text: ['name', 'email', 'phone'] },
		semantic: { semantic: { fields: ['address'], model: 'default', dim: 1536 } }
	},
	outputs: {
		default: {
			fields: 'all',
			employment: {
				fields: 'all',
				entity_id: { fields: 'all' },
				terms: { fields: 'all' },
				parameters: { fields: 'all' }
			},
			dependants: { fields: 'all' }
		},
		// the attendance kiosk: who may punch and their enrolled face
		kiosk: {
			fields: [
				'name',
				'email',
				'phone',
				'face_embedding',
				'face_photo',
				'face_enrollment_status',
				'face_enrolled_at'
			]
		}
	},
	create: {
		columns: { fields: columns },
		transform: function* (changes, ctx) {
			// identity is the invitation automation's to link; an imported person has no login yet
			const linked = changes.findIndex(
				({ set }) => set.user_id != null || set.invitation_id != null
			);
			if (!ctx.policies.includes('invitation_profile_automation') && linked >= 0)
				return yield* ctx.refuse('errors.employee_profile_invitation_links', { row: linked });
			return changes.map(({ set }) => set);
		}
	},
	update: {
		columns: { fields: columns },
		transform: function* (changes, ctx) {
			// a particular a formula reads, and how service counts, were always so: every paid period of the person was
			// worked out on them
			const counted = changes.filter((change) => change.changed(...PRICED));
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* amendmentsFor(
					ctx.query,
					counted.map(({ before }) => ({
						employee: String(before.id),
						from: '1900-01-01',
						to: null
					}))
				)
			};
		},
		effect: function* (changes, ctx) {
			// how service counts moves every service window and band, and a particular may move an entitlement: the
			// person's entitlements sync again
			const counted = changes.filter((change) => change.changed(...PRICED));
			if (counted.length > 0)
				yield* ctx.schedule('ledger', { employees: counted.map(({ after }) => after.id) });
			// s.113 register particulars only: email, phone, user_id, face, documents and location are not
			// register changes, so they do not raise EMPLOYEE_REGISTER_UPDATE.
			const register = registerChanged(changes);
			if (register.length > 0) yield* tap(ctx, 'update', 'employee_profile', register);
		}
	}
});
