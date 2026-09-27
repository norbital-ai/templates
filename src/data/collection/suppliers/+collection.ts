import { collection, type TransformCtx } from '@norbital-ai/bolt';

const columns = [
	'external_code',
	'code',
	'name',
	'contact',
	'category',
	'currency',
	'payment_terms_days',
	'phone',
	'email',
	'address',
	'active'
] as const;

/** Uppercases the supplier code and trims the name on creation, and refuses to change a code once set. */
const c = collection('suppliers', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'suppliers'>) =>
	inputs.map((input, i) => {
		const stored = ctx.existing[i];
		const name = input.name?.trim();
		if (name === '') ctx.refuse('Supplier name is required.');
		if (stored !== undefined) {
			if (input.code != null && input.code !== stored.code)
				ctx.refuse('Supplier code cannot be changed once set.');
			return input;
		}
		const code = input.code!.trim().toUpperCase();
		if (!code) ctx.refuse('Supplier code is required.');
		return { ...input, code, name: name! };
	})
);
