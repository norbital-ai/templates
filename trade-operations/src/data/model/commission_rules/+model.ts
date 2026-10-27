import { Result } from 'effect';
import { model } from '@norbital-ai/bolt';
import {
	commissionFault,
	DEFAULT_COMMISSION_EXPRESSION
} from '../../../lib/commission-expressions.js';
import { Decimal } from '@norbital-ai/std/decimal';

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
				Decimal.of(parameter.value);
			}
		})
	);
export default model('commission_rules', {
	description: 'commission rules',
	label: ['currency', 'effective_on'],
	fields: {
		eligibility_expression: { kind: 'text', format: 'cel', default: 'true' },
		amount_expression: { kind: 'text', format: 'cel', default: DEFAULT_COMMISSION_EXPRESSION },
		parameters: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: { kind: 'object', fields: { name: { kind: 'text' }, value: { kind: 'text' } } }
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
	key: ['code', 'currency', 'effective_on'],
	check: {
		fixed_rate_nonnegative: {
			fixed_rate: {
				gte: '0'
			}
		}
	},
	read: 'all',
	create: {
		columns: {
			commission_rules: [
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
			]
		},
		transform: function* (rows, ctx) {
			const expressions = rows.map((row) => ({
				eligibility: row.eligibility_expression ?? 'true',
				amount: row.amount_expression ?? DEFAULT_COMMISSION_EXPRESSION,
				parameters: row.parameters ?? []
			}));
			if (!expressions.every(valid)) yield* ctx.refuse('errors.commission_expression_invalid');
			return rows;
		}
	},
	update: {
		columns: {
			commission_rules: [
				'eligibility_expression',
				'amount_expression',
				'parameters',
				'fixed_rate',
				'spread_pct',
				'active'
			]
		},
		transform: function* (changes, ctx) {
			const expressions = changes.map(({ before, set }) => ({
				eligibility: set.eligibility_expression ?? before.eligibility_expression,
				amount: set.amount_expression ?? before.amount_expression,
				parameters:
					set.parameters === undefined ? (before.parameters ?? []) : (set.parameters ?? [])
			}));
			if (!expressions.every(valid)) yield* ctx.refuse('errors.commission_expression_invalid');
			return changes.map((c) => c.set);
		}
	}
});
