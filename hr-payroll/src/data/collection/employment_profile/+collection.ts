import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { refuseEmploymentFacts } from '../../../lib/payroll_engine/employment_facts.js';
import {
	beforeOf,
	runEngine,
	workspaceReadAsHost
} from '../../../lib/payroll_engine/foundation.js';
import { admitAnonymise, anonymousProfile } from '../../../lib/payroll_engine/services.js';

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
	'anonymised_at',
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
	update: { input: { columns: update_columns } },
	actions: {
		anonymise: {
			description:
				'Replace a former employee’s personal fields with neutral values once the governing version’s record retention has passed; payslips, runs and obligations keep their amounts.',
			target: 'record',
			input: {},
			agent: 'confirm'
		}
	}
});
export default c;

c.action('anonymise', async (_input, ctx) => {
	await ctx.act('employment_profile.update', {
		target: ctx.target.id,
		set: { anonymised_at: ctx.now }
	});
	const contracts = await ctx.read('employment_contract', {
		where: { employee_id: { eq: ctx.target.id } },
		select: { id: true },
		all: true
	});
	if (contracts.rows.length > 0)
		await ctx.act('employment_contract.update', {
			target: contracts.rows.map((row) => row.id),
			set: { bank: null, comments: null }
		});
});

c.transform(async (inputs, ctx: TransformCtx<'employment_profile'>) => {
	const read = workspaceReadAsHost(ctx.db.read);
	const out = [];
	for (const [i, input] of inputs.entries()) {
		const existing = ctx.existing[i];
		// Anonymising: once the retention day has passed, the personal fields become neutral values for good.
		if (
			existing !== undefined &&
			!('$delete' in input) &&
			input.anonymised_at != null &&
			existing.anonymised_at == null
		) {
			await runEngine(admitAnonymise(existing.id, String(ctx.today)), read, ctx.refuse);
			out.push({ ...anonymousProfile(), anonymised_at: input.anonymised_at });
			continue;
		}
		const merged = { ...existing, ...input };
		const message = await refuseEmploymentFacts(merged.facts, read);
		if (message != null) ctx.refuse(message);
		// An update records what it changed, so a duty can test which field moved.
		out.push(
			existing === undefined || '$delete' in input
				? input
				: { ...input, before: beforeOf(existing, input) }
		);
	}
	return out;
});
