import { Effect } from 'effect';
import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { refuseUnlistedKind } from '../../../../lib/payroll_engine/listed_kinds.js';
import { eachBatched } from '../../../../lib/payroll_engine/foundation.js';
const create_columns = [
	'date',
	'name',
	'kind',
	'published_at',
	'replaces',
	'given_to',
	'company_id'
] as const;
const update_columns = [
	'date',
	'name',
	'kind',
	'published_at',
	'replaces',
	'given_to',
	'company_id'
] as const;
const c = collection('holiday', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
export default c;
/** A holiday's kind is one the version of its entity's lineage governing its day lists (`holiday_kinds`). */
c.transform(function* (inputs, ctx: TransformCtx<'holiday'>) {
	return yield* // Every input at once over one batched reader: a calendar's rows read once per shape, not once per day.
	eachBatched(
		inputs,
		ctx.db.read,
		Effect.fnUntraced(function* (input, i, read) {
			if ('$delete' in input) return input;
			const before = ctx.existing[i];
			const row = { ...before, ...input };
			if (before !== undefined && row.kind === before.kind && row.date === before.date)
				return input;
			if (row.company_id == null) return yield* ctx.refuse('This needs its legal entity.');
			const refused = yield* refuseUnlistedKind(
				{
					rule: 'holiday_kinds',
					noun: 'holiday kind',
					company_id: row.company_id,
					code: String(row.kind ?? ''),
					day: String(row.date).slice(0, 10)
				},
				read
			);
			if (refused != null) return yield* ctx.refuse(refused);
			return input;
		})
	);
});
