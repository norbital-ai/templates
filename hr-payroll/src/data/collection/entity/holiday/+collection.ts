import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { refuseUnlistedKind } from '../../../../lib/payroll_engine/listed_kinds.js';
import { eachBatched, workspaceReadAsHost } from '../../../../lib/payroll_engine/foundation.js';

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
c.transform(async (inputs, ctx: TransformCtx<'holiday'>) =>
	// Every input at once over one batched reader: a calendar's rows read once per shape, not once per day.
	eachBatched(inputs, workspaceReadAsHost(ctx.db.read), async (input, i, read) => {
		if ('$delete' in input) return input;
		const before = ctx.existing[i];
		const row = { ...before, ...input };
		if (before !== undefined && row.kind === before.kind && row.date === before.date) return input;
		const refused = await refuseUnlistedKind(
			{
				rule: 'holiday_kinds',
				noun: 'holiday kind',
				company_id: String(row.company_id),
				code: String(row.kind ?? ''),
				day: String(row.date).slice(0, 10)
			},
			read
		);
		if (refused != null) ctx.refuse(refused);
		return input;
	})
);
