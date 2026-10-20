import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { bankConfigurationRefusal } from '../../../lib/bank_template.js';

const columns = ['code', 'name', 'bank_codes', 'currencies', 'enabled', 'template'] as const;
const c = collection('bank', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});

c.transform(function* (inputs, ctx: TransformCtx<'bank'>) {
	for (const [index, input] of inputs.entries()) {
		const record = { ...ctx.existing[index], ...input };
		for (const field of ['code', 'name'] as const)
			if (record[field]?.trim() === '')
				return yield* ctx.refuse('Enter a bank code and name.', { field });
		const refusal = bankConfigurationRefusal(record);
		if (refusal !== undefined) return yield* ctx.refuse(refusal.message, { field: refusal.field });
	}
	return inputs;
});

export default c;
