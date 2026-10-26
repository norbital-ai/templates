import {
	model,
	type WriteCtx,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type Id
} from '@norbital-ai/bolt';
import { refuseEmploymentFactsBatch } from '../../../lib/payroll_engine/employment_facts.js';
import { beforeOf, runEngine } from '../../../lib/payroll_engine/foundation.js';
import { admitAnonymiseBatch, anonymousProfile } from '../../../lib/payroll_engine/admit.js';
import { Effect } from 'effect';

const create_columns = [
	'name',
	'date_of_birth',
	'gender',
	'marital_status',
	'children',
	'nationality',
	'identity_number',
	'email',
	'phone',
	'address',
	'location',
	'face_embedding',
	'face_photo',
	'face_enrollment_status',
	'face_consent_at',
	'face_enrolled_at',
	'face_last_match_at',
	'face_match_count',
	'facts',
	'invitation_id',
	'user_id'
] as const;

const update_columns = [
	'anonymised_at',
	'name',
	'date_of_birth',
	'gender',
	'marital_status',
	'children',
	'nationality',
	'identity_number',
	'email',
	'phone',
	'address',
	'location',
	'face_embedding',
	'face_photo',
	'face_enrollment_status',
	'face_consent_at',
	'face_enrolled_at',
	'face_last_match_at',
	'face_match_count',
	'facts',
	'invitation_id',
	'user_id'
] as const;

type WriteInput = Omit<UpdateSet<'employment_profile'>, 'id'> &
	Partial<Omit<CreateRow<'employment_profile'>, 'id'>> & {
		readonly id?: Id<'employment_profile'>;
		readonly $delete?: true;
	};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'employment_profile'> | undefined)[],
	ctx: WriteCtx<'employment_profile'>
) {
	const anonymising = inputs.flatMap((input, index) => {
		const before = existing[index];
		return before !== undefined && input.anonymised_at != null && before.anonymised_at == null
			? [before.id]
			: [];
	});
	if (anonymising.length > 0)
		yield* runEngine(admitAnonymiseBatch(anonymising, String(ctx.today)), ctx.db.query, ctx.refuse);
	const messages = yield* refuseEmploymentFactsBatch(
		inputs.map((input, index) =>
			existing[index] !== undefined && anonymising.includes(existing[index].id)
				? undefined
				: { ...existing[index], ...input }.facts
		),
		ctx.db.query
	);
	for (const [row, message] of messages.entries())
		if (message !== null) return yield* ctx.refuse(message, { row });
	return inputs.map((input, index): WriteInput => {
		const before = existing[index];
		if (before !== undefined && input.anonymised_at != null && anonymising.includes(before.id))
			return { ...anonymousProfile(), anonymised_at: input.anonymised_at };
		return before === undefined ? input : { ...input, before: beforeOf(before, input) };
	});
});

export default model('employment_profile', {
	description:
		'A natural person. Holds only facts true of the human being — never of a job; everything employment-shaped lives on employment contracts.',
	icon: 'lucide:user',
	label: 'name',
	unique: [{ fields: ['invitation_id'] }, { fields: ['user_id'] }],
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
			values: ['SINGLE', 'MARRIED', 'SEPARATED', 'DIVORCED', 'WIDOWED'],
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
							kind: 'text',
							optional: true,
							help: 'The child’s citizenship as the governing version’s records compare it (e.g. CITIZEN).'
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
		anonymised_at: {
			kind: 'instant',
			optional: true,
			help: 'When the former employee was anonymised after the retention period; personal fields are blank since.'
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
		},
		before: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true,
			help: 'The prior values of the fields the last update changed, recorded for the duties that answer a change.'
		},
		invitation_id: {
			kind: 'ref',
			to: 'sys_invitation',
			optional: true,
			onDelete: 'setNull'
		},
		user_id: {
			kind: 'ref',
			to: 'sys_user',
			optional: true,
			onDelete: 'setNull'
		}
	},
	search: {
		text: ['name', 'email', 'phone'],
		semantic: { fields: ['address'], model: 'default', dim: 1536 }
	},
	read: 'all',
	create: {
		columns: create_columns,
		transform: function* (rows, ctx) {
			const transformed = yield* transformRows(
				rows,
				rows.map(() => undefined),
				ctx
			);
			return rows.map((row, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...row, ...set };
			});
		}
	},
	update: {
		columns: update_columns,
		transform: function* (changes, ctx) {
			const transformed = yield* transformRows(
				changes.map(({ set }) => set),
				changes.map(({ before }) => before),
				ctx
			);
			return changes.map(({ set: original }, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...original, ...set };
			});
		}
	}
});
