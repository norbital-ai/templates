import { model } from '@norbital-ai/bolt';
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

export default model('employee_profile', {
	description:
		'One system identity for a person: name, contact details, documents, login and face enrolment. Standing payroll inputs belong to sealed employment contracts.',
	icon: 'lucide:user',
	label: 'name',
	unique: [{ fields: ['invitation_id'] }, { fields: ['user_id'] }],
	fields: {
		source_reference: { kind: 'text', optional: true, label: 'Source reference' },
		cumulative_service: {
			kind: 'bool',
			default: false,
			help: 'Service counts every stint at the employer, rehires included. Off, only the current unbroken stint counts: the statutory continuous service.'
		},
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
			multiple: true,
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
			onDelete: 'setNull'
		},
		// empty until the person is invited: payroll needs a person, not a login
		user_id: { kind: 'ref', to: 'sys_user', optional: true, onDelete: 'restrict' }
	},
	search: {
		text: ['name', 'email', 'phone'],
		semantic: { fields: ['address'], model: 'default', dim: 1536 }
	},
	read: {
		employee_profile: { fields: 'all' },
		'employee_profile.employee_contract': { fields: 'all' },
		'employee_profile.employee_contract.entity_id': { fields: 'all' }
	},
	outputs: {
		// the attendance kiosk: who may punch and their enrolled face
		kiosk: {
			employee_profile: {
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
		}
	},
	create: {
		columns: {
			employee_profile: [
				'name',
				'source_reference',
				'cumulative_service',
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
			]
		},
		transform: function* (rows, ctx) {
			// identity is the invitation automation's to link; an imported person has no login yet
			if (
				!ctx.policies.includes('invitation_profile_automation') &&
				rows.some((row) => row.user_id != null || row.invitation_id != null)
			)
				return yield* ctx.refuse(
					'Only an accepted invitation links a profile to a login. Create the profile without a login; it is linked when the person accepts their invitation.'
				);
			return rows;
		}
	},
	update: {
		columns: {
			employee_profile: [
				'name',
				'source_reference',
				'cumulative_service',
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
			]
		}
	},
	// The jurisdiction's registered effects for this model's writes.
	effect: {
		created: function* (rows, ctx) {
			// under the system identity: the invitation automation makes profiles and cannot read the law
			yield* ctx.schedule('registered_effects', {
				collection: 'employee_profile',
				operation: 'create',
				ids: rows.map((row) => String(row.id))
			});
		},
		updated: function* (changes, ctx) {
			// how service counts moves every service window and band: the person's entitlements sync again
			const counted = changes.filter(
				({ before, after }) => before.cumulative_service !== after.cumulative_service
			);
			if (counted.length > 0)
				yield* ctx.schedule('ledger', { employees: counted.map(({ after }) => after.id) });
			// s.113 register particulars only: email, phone, user_id, face, documents and location are not
			// register changes, so they do not raise EMPLOYEE_REGISTER_UPDATE.
			const register = registerChanged(changes);
			if (register.length > 0) yield* tap(ctx, 'update', 'employee_profile', register);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				'employee_profile',
				rows.map((before) => ({ before }))
			);
		}
	}
});
