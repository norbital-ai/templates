import { collection, type TransformCtx } from '@norbital-ai/bolt';

const columns = [
	'regarding',
	'type',
	'subject',
	'description',
	'due_date',
	'completed_at',
	'owner_id'
] as const;

/** A task entered without a due date is due today (the desk's day). */
const c = collection('activities', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'activities'>) =>
	inputs.map((input, i) =>
		ctx.existing[i] === undefined && input.type === 'task' && input.due_date == null
			? { ...input, due_date: ctx.today }
			: input
	)
);
