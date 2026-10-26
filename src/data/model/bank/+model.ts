import { model, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { BANK_TEMPLATE_SHAPE, bankConfigurationRefusal } from '../../../lib/bank_template.js';

const columns = ['code', 'name', 'bank_codes', 'currencies', 'enabled', 'template'] as const;
/** Every bank as it will be stored: a nonblank code and name, and a complete format before it is enabled. */
const admit = Effect.fnUntraced(function* (
	records: readonly (Parameters<typeof bankConfigurationRefusal>[0] & {
		readonly code?: string;
		readonly name?: string;
	})[],
	ctx: WriteCtx<'bank'>
) {
	for (const [row, record] of records.entries()) {
		for (const field of ['code', 'name'] as const)
			if (record[field]?.trim() === '')
				return yield* ctx.refuse('Enter a bank code and name.', { field, row });
		const refusal = bankConfigurationRefusal(record);
		if (refusal !== undefined)
			return yield* ctx.refuse(refusal.message, { field: refusal.field, row });
	}
});

export default model('bank', {
	description:
		'A reusable bank upload format. Entities select the same bank record while retaining their own paying account. Disabled formats remain drafts until their template and supported payment details are complete.',
	icon: 'lucide:landmark',
	label: 'name',
	key: ['code'],
	fields: {
		code: { kind: 'text', unique: true },
		name: { kind: 'text' },
		bank_codes: { kind: 'text', many: true, default: [] },
		currencies: { kind: 'text', many: true, default: [] },
		enabled: { kind: 'bool', default: false },
		template: { kind: 'json', shape: BANK_TEMPLATE_SHAPE, default: {} }
	},
	read: 'all',
	create: {
		columns,
		transform: function* (rows, ctx) {
			yield* admit(rows, ctx);
			return rows;
		}
	},
	update: {
		columns,
		transform: function* (changes, ctx) {
			yield* admit(
				changes.map(({ before, set }) => ({ ...before, ...set })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	}
});
