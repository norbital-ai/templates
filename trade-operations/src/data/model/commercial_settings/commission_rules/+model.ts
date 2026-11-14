import { Result } from 'effect';
import { model } from '@norbital-ai/bolt';
import {
	commissionFault,
	DEFAULT_COMMISSION_EXPRESSION
} from '../../../../lib/commission-expressions.js';

type Expressions = {
	readonly eligibility: string;
	readonly amount: string;
	readonly parameters: readonly { readonly name: string; readonly value: string }[];
};
/** Both expressions compile to their kinds and every parameter has a unique name and a decimal value. */
const valid = ({ eligibility, amount, parameters }: Expressions) =>
	Result.isSuccess(
		Result.try(() => {
			if (!amount) throw new Error('Missing amount expression');
			const fault = commissionFault(eligibility, 'bool') ?? commissionFault(amount, 'money');
			if (fault !== undefined) throw new Error(fault);
			const names = new Set<string>();
			for (const parameter of parameters) {
				if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.name) || names.has(parameter.name))
					throw new Error('Duplicate or invalid parameter name');
				names.add(parameter.name);
				if (!/^[+-]?\d+(?:\.\d+)?$/.test(parameter.value.trim()))
					throw new Error('Invalid parameter value');
			}
		})
	);
export default model('commission_rules', {
	description: 'commission rules',
	record_label: "string(record.currency) + ' · ' + string(record.effective_on)",
	fields: {
		eligibility_expression: { kind: 'text', format: 'cel', default: 'true' },
		amount_expression: { kind: 'text', format: 'cel', default: DEFAULT_COMMISSION_EXPRESSION },
		parameters: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				fields: { name: { kind: 'text' }, value: { kind: 'text' } },
				many: true
			}
		},
		code: {
			kind: 'enum',
			values: ['default'],
			default: 'default',
			hidden: true
		},
		currency: {
			kind: 'currency'
		},
		effective_on: {
			kind: 'date'
		},
		basis_unit: {
			optional: true,
			kind: 'text'
		},
		fixed_rate: {
			default: '0',
			kind: 'money',
			currency: 'currency',
			scale: 4
		},
		spread_pct: {
			default: '0',
			kind: 'decimal',
			scale: 2,
			min: 0,
			max: 100
		},
		active: {
			kind: 'bool',
			default: true
		}
	},
	outputs: { default: { fields: 'all' } },
	constraints: {
		natural_key: { unique: ['code', 'currency', 'effective_on'], import_key: true },
		fixed_rate_nonnegative: {
			check: {
				fixed_rate: {
					gte: '0'
				}
			}
		}
	},
	indexes: { search: { text: ['basis_unit'] } },
	create: {
		fields: [
			'eligibility_expression',
			'amount_expression',
			'parameters',
			'code',
			'currency',
			'effective_on',
			'basis_unit',
			'fixed_rate',
			'spread_pct',
			'active'
		],
		transform: function* (changes, ctx) {
			const expressions = changes.map(({ after }) => ({
				eligibility: after.eligibility_expression ?? 'true',
				amount: after.amount_expression ?? DEFAULT_COMMISSION_EXPRESSION,
				parameters: after.parameters ?? []
			}));
			if (!expressions.every(valid)) yield* ctx.refuse('errors.commission_expression_invalid');
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: [
			'eligibility_expression',
			'amount_expression',
			'parameters',
			'fixed_rate',
			'spread_pct',
			'active'
		],
		transform: function* (changes, ctx) {
			const expressions = changes.map(({ after }) => ({
				eligibility: after.eligibility_expression,
				amount: after.amount_expression,
				parameters: after.parameters ?? []
			}));
			if (!expressions.every(valid)) yield* ctx.refuse('errors.commission_expression_invalid');
			return changes.map((c) => c.set);
		}
	}
});
