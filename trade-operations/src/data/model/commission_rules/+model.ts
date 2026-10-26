import { Result } from 'effect';
import { model } from '@norbital-ai/bolt';
import {
	commissionFault,
	DEFAULT_COMMISSION_EXPRESSION,
	commissionContext,
	evaluateCommission
} from '../../../lib/commission-expressions.js';
import { minorDigits, Decimal } from '@norbital-ai/std/decimal';

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
		columns: [
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
		columns: [
			'eligibility_expression',
			'amount_expression',
			'parameters',
			'fixed_rate',
			'spread_pct',
			'active'
		],
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
	},
	queries: {
		preview: {
			description:
				'Test the saved commission rule against explicit sample facts without changing any SO.',
			input: {
				rule: { kind: 'id', of: 'commission_rules' },
				quantity: { kind: 'decimal', scale: 8 },
				net: { kind: 'decimal', scale: 8 },
				floor_net: { kind: 'decimal', scale: 8, optional: true },
				factor: { kind: 'decimal', scale: 8, optional: true },
				product_code: { kind: 'text', default: '' },
				unit: { kind: 'text', default: '' },
				party_code: { kind: 'text', default: '' },
				ordered_on: { kind: 'date' }
			},
			output: {
				kind: 'object',
				fields: {
					currency: { kind: 'currency' },
					amount: { kind: 'money', currency: 'currency', optional: true },
					reason: { kind: 'enum', values: ['resolved', 'ineligible', 'expression_error'] }
				}
			},
			run: function* (input, ctx) {
				const rule = yield* ctx.query('commission_rules', { id: input.rule });
				if (!rule) return yield* ctx.refuse('errors.commission_expression_invalid');
				const evaluated = Result.try(() => {
					const context = commissionContext({
						quantity: input.quantity.toString(),
						net: input.net.toString(),
						floor_net: input.floor_net?.toString() ?? null,
						factor: input.factor?.toString() ?? null,
						product_code: input.product_code ?? '',
						product_name: '',
						unit: input.unit ?? '',
						currency: rule.currency,
						ordered_on: input.ordered_on,
						party_code: input.party_code ?? '',
						fixed_rate: rule.fixed_rate.toString(),
						spread_pct: rule.spread_pct.toString(),
						parameters: rule.parameters ?? []
					});
					const result = evaluateCommission(
						rule.eligibility_expression,
						rule.amount_expression,
						context
					);
					return {
						currency: rule.currency,
						amount: result.amount.round(minorDigits(rule.currency)),
						reason: result.eligible ? ('resolved' as const) : ('ineligible' as const)
					};
				});
				return Result.isFailure(evaluated)
					? { currency: rule.currency, amount: null, reason: 'expression_error' as const }
					: evaluated.success;
			}
		}
	}
});
