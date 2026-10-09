import { collection, type TransformCtx } from '@norbital-ai/bolt';
import {
	beforeOf,
	eachBatched,
	runEngine,
	workspaceReadAsHost
} from '../../../../lib/payroll_engine/foundation.js';
import { admitCase } from '../../../../lib/payroll_engine/services.js';

const create_columns = [
	'kind',
	'opened_on',
	'closed_on',
	'facts',
	'company_id',
	'employment_id'
] as const;
const update_columns = ['kind', 'opened_on', 'closed_on', 'facts'] as const;

const c = collection('workplace_case', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
export default c;

/** A case names a kind its governing version lists; an employment's case takes the employment's company. */
c.transform(async (inputs, ctx: TransformCtx<'workplace_case'>) => {
	// Every input at once over one batched reader: a batch reads once per shape, not once per row.
	return eachBatched(inputs, workspaceReadAsHost(ctx.db.read), async (input, i, read) => {
		if ('$delete' in input) return input;
		const row = { ...ctx.existing[i], ...input };
		const company_id = await runEngine(
			admitCase({
				company_id: row.company_id ?? null,
				employment_id: row.employment_id ?? null,
				kind: String(row.kind ?? ''),
				opened_on: String(row.opened_on ?? ''),
				closed_on: row.closed_on ?? null
			}),
			read,
			ctx.refuse
		);
		const existing = ctx.existing[i];
		return {
			...input,
			company_id,
			...(existing === undefined ? {} : { before: beforeOf(existing, input) })
		};
	});
});
