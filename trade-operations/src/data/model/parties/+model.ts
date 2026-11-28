import { BigDecimal, Effect, Option } from 'effect';
import { model, type WriteCtx } from '@norbital-ai/bolt';

const validateCreditTargets = Effect.fnUntraced(function* (
	rows: readonly {
		readonly kind: 'customer' | 'supplier' | 'both';
		readonly credit_limit_target?: string | null | undefined;
		readonly credit_days_target?: number | null | undefined;
	}[],
	ctx: WriteCtx<'parties'>
) {
	for (const [i, row] of rows.entries()) {
		if (row.credit_limit_target != null) {
			if (row.kind === 'supplier')
				return yield* ctx.refuse('errors.credit_target_customer_only', {
					row: i,
					field: 'credit_limit_target'
				});
			const parsed = BigDecimal.fromString(row.credit_limit_target.trim());
			if (Option.isNone(parsed) || BigDecimal.isNegative(parsed.value))
				return yield* ctx.refuse('errors.credit_target_invalid', {
					row: i,
					field: 'credit_limit_target'
				});
		}
		if (row.credit_days_target != null) {
			if (row.kind === 'supplier')
				return yield* ctx.refuse('errors.credit_target_customer_only', {
					row: i,
					field: 'credit_days_target'
				});
			if (row.credit_days_target < 0 || row.credit_days_target > 3660)
				return yield* ctx.refuse('errors.credit_target_invalid', {
					row: i,
					field: 'credit_days_target'
				});
		}
	}
});

export default model('parties', {
	description: 'parties',
	record_label: 'record.name',
	fields: {
		external_code: {
			kind: 'text'
		},
		source_number: { kind: 'text', optional: true },
		name: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: ['customer', 'supplier', 'both']
		},
		currency: {
			kind: 'currency'
		},
		active: {
			kind: 'bool',
			default: true
		},
		region: {
			kind: 'text',
			optional: true
		},
		// workspace-owned profile fields (never overwritten by Kingdee polling)
		related_party: {
			kind: 'bool',
			default: false
		},
		tax_id: {
			kind: 'text',
			optional: true
		},
		bank_name: {
			kind: 'text',
			optional: true
		},
		bank_account: {
			kind: 'text',
			optional: true
		},
		profile_notes: {
			kind: 'text',
			optional: true
		},
		credit_limit_target: {
			kind: 'money',
			currency: 'currency',
			optional: true
		},
		credit_days_target: {
			kind: 'int',
			min: 0,
			optional: true
		},
		address: {
			kind: 'text',
			optional: true
		},
		phone: {
			kind: 'text',
			format: 'phone',
			optional: true
		},
		source_updated_at: {
			kind: 'instant'
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	outputs: { default: { fields: 'all' } },
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	indexes: { search: { text: ['name', 'external_code', 'source_number', 'tax_id'] } },
	create: {
		fields: [
			'external_code',
			'source_number',
			'name',
			'kind',
			'currency',
			'active',
			'region',
			'tax_id',
			'bank_name',
			'bank_account',
			'profile_notes',
			'credit_limit_target',
			'credit_days_target',
			'address',
			'phone',
			'source_updated_at',
			'source'
		],
		transform: function* (changes, ctx) {
			yield* validateCreditTargets(
				changes.map(({ after }) => after),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: [
			'external_code',
			'source_number',
			'name',
			'kind',
			'currency',
			'active',
			'region',
			'related_party',
			'tax_id',
			'bank_name',
			'bank_account',
			'profile_notes',
			'credit_limit_target',
			'credit_days_target',
			'address',
			'phone',
			'source_updated_at',
			'source'
		],
		transform: function* (changes, ctx) {
			yield* validateCreditTargets(
				changes.map(({ after }) => after),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	}
});
