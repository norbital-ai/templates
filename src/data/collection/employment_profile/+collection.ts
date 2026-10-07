import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { refuseEmploymentFacts } from '../../../lib/payroll_engine/employment_facts.js';
import { workspaceReadAsHost } from '../../../lib/payroll_engine/foundation.js';

const create_columns = [
	'name',
	'date_of_birth',
	'gender',
	'marital_status',
	'solo_parent',
	'disabled',
	'receiving_pension',
	'race',
	'religion',
	'spouse_status',
	'children',
	'nationality',
	'identity_number',
	'dependents_count',
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
	'user_id'
] as const;
const update_columns = [
	'name',
	'date_of_birth',
	'gender',
	'marital_status',
	'solo_parent',
	'disabled',
	'receiving_pension',
	'race',
	'religion',
	'spouse_status',
	'children',
	'nationality',
	'identity_number',
	'dependents_count',
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
	'user_id'
] as const;

const c = collection('employment_profile', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'employment_profile'>) => {
	const read = workspaceReadAsHost(ctx.db.read);
	for (const [i, input] of inputs.entries()) {
		const merged = { ...ctx.existing[i], ...input };
		const message = await refuseEmploymentFacts(merged.facts, read);
		if (message != null) ctx.refuse(message);
	}
	return inputs;
});
