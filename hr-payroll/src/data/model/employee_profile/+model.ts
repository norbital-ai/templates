import { model } from '@norbital-ai/bolt';
import { tap } from '../../../lib/payroll_engine/taps.js';

/** The s.113 register particulars the template owns on the profile: name and address. */
export const registerChanged = <
	T extends { readonly before: { readonly name?: unknown; readonly address?: unknown }; readonly after: { readonly name?: unknown; readonly address?: unknown } }
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
		first_hired_on: {
			kind: 'date',
			optional: true,
			help: 'The first day this person joined the employer group. Company service stays with the person across entity and jurisdiction transfers.'
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
		face_match_count: { kind: 'int', min: 0, default: 0 },
		face_last_match_at: { kind: 'instant', optional: true },
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
		'employee_profile.employee_contract': { fields: 'all' }
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
					'face_enrolled_at',
					'face_match_count',
					'face_last_match_at'
				]
			}
		}
	},
	create: {
		columns: {
			employee_profile: [
				'name',
				'source_reference',
				'first_hired_on',
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
				'face_match_count',
				'face_last_match_at',
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
				return yield* ctx.refuse('Only an accepted invitation links a profile to a login.');
			return rows;
		}
	},
	update: {
		columns: {
			employee_profile: [
				'name',
				'source_reference',
				'first_hired_on',
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
				'face_match_count',
				'face_last_match_at',
				'invitation_id',
				'user_id'
			]
		}
	},
	// The jurisdiction's registered effects for this model's writes, started as the writer.
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'employee_profile', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			// s.113 register particulars only: email, phone, user_id, face, documents and location are not
			// register changes, so they do not raise EMPLOYEE_REGISTER_UPDATE.
			const register = registerChanged(changes);
			if (register.length > 0)
				yield* tap(
					ctx,
					'update',
					{ collection: 'employee_profile', ids: register.map(({ after }) => after.id) },
					register
				);
			// a renamed person's employments carry the new name (their pickers and links name them by it)
			const renamed = new Map(
				changes
					.filter(({ before, after }) => before.name !== after.name)
					.map(({ after }) => [after.id, after.name])
			);
			if (renamed.size === 0) return;
			const { employee_contract } = yield* ctx.query({
				employee_contract: {
					where: { employee_id: { in: [...renamed.keys()] }, status: { eq: 'DRAFT' } },
					fields: ['employee_id']
				}
			});
			if (employee_contract.rows.length > 0)
				yield* ctx.act.checked([
					{
						callable: 'employee_contract.update',
						input: employee_contract.rows.map((row) => ({
							target: row.id,
							set: { employee_name: renamed.get(row.employee_id) ?? null }
						}))
					}
				]);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'employee_profile', ids: rows.map((row) => row.id) },
				rows.map((before) => ({ before }))
			);
		}
	}
});
