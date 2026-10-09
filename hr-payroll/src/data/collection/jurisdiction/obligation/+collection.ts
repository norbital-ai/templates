import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { currency } from '@norbital-ai/std/decimal';

const create_columns = [
	'duty_code',
	'authority',
	'occurrence_key',
	'trigger_ref',
	'triggered_on',
	'due_on',
	'amount_due',
	'amount_settled',
	'state',
	'fulfilled_on',
	'waive_reason',
	'reference',
	'evidence_file',
	'facts',
	'company_id',
	'settings_id'
] as const;
const update_columns = [
	'due_on',
	'amount_due',
	'amount_settled',
	'state',
	'fulfilled_on',
	'waive_reason',
	'reference',
	'evidence_file',
	'facts'
] as const;

const c = collection('obligation', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns, filled: ['currency'] } },
	update: { input: { columns: update_columns } },
	// an open obligation is withdrawn when the run that raised it is deleted; a settled or waived one stays
	delete: { transform: true }
});
export default c;

// The amounts are money in the raising version's payroll currency, so a new obligation takes that currency.
c.transform(async (inputs, ctx: TransformCtx<'obligation'>) => {
	for (const [i, input] of inputs.entries())
		if ('$delete' in input && ctx.existing[i]?.state !== 'OPEN')
			ctx.refuse('Only an open obligation is withdrawn; a settled or waived one stays.');
	const ids = [
		...new Set(
			inputs.flatMap((input, i) =>
				ctx.existing[i] === undefined && 'settings_id' in input && input.settings_id != null
					? [input.settings_id]
					: []
			)
		)
	];
	const versions =
		ids.length === 0
			? []
			: (
					await ctx.db.read('jurisdiction_settings', {
						where: { id: { in: ids } },
						select: { id: true, payroll: true },
						all: true
					})
				).rows;
	const currencyOf = new Map(
		versions.map((row) => [row.id, row.payroll?.currency ? currency(row.payroll.currency) : null])
	);
	return inputs.map((input, i) =>
		ctx.existing[i] !== undefined || !('settings_id' in input) || input.settings_id == null
			? input
			: { ...input, currency: currencyOf.get(input.settings_id) ?? null }
	);
});
