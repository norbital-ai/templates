import { Effect } from 'effect';
import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { eachBatched, runEngine } from '../../../../lib/payroll_engine/foundation.js';
import { admitSuspension } from '../../../../lib/payroll_engine/admit.js';
const update_columns = [
	'kind',
	'starts_on',
	'ends_on',
	'worksite',
	'employment_ids',
	'facts'
] as const;
const create_columns = [...update_columns, 'company_id'] as const;
const c = collection('work_suspension', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
export default c;
/** A suspension names a kind its governing version lists and ends on or after it starts. */
c.transform(function* (inputs, ctx: TransformCtx<'work_suspension'>) {
	return yield* eachBatched(
		inputs,
		ctx.db.read,
		Effect.fnUntraced(function* (input, i, read) {
			if ('$delete' in input) return input;
			const row = { ...ctx.existing[i], ...input };
			if (row.company_id == null) return yield* ctx.refuse('This needs its legal entity.');
			yield* runEngine(
				admitSuspension({
					company_id: row.company_id,
					kind: String(row.kind ?? ''),
					starts_on: String(row.starts_on ?? ''),
					ends_on: String(row.ends_on ?? '')
				}),
				read,
				ctx.refuse
			);
			return input;
		})
	);
});
