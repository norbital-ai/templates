import { Result } from 'effect';
import { collection, type TransformCtx, type QueryCtx } from '@norbital-ai/bolt';
import {
	commissionFault,
	DEFAULT_COMMISSION_EXPRESSION,
	commissionContext,
	evaluateCommission
} from '../../../lib/commission-expressions.js';
import { minorDigits } from '@norbital-ai/std/decimal';
import { d } from '../../../lib/commercial.js';
const c = collection('commission_rules', {
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
			}
		}
	},
	read: {
		fields: 'all'
	},
	create: {
		input: {
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
			]
		}
	},
	update: {
		input: {
			columns: [
				'eligibility_expression',
				'amount_expression',
				'parameters',
				'fixed_rate',
				'spread_pct',
				'active'
			]
		}
	}
});
export default c;
c.transform(function* (inputs, ctx: TransformCtx<'commission_rules'>) {
	{
		const out = [];
		for (const [i, input] of inputs.entries()) {
			const previous = ctx.existing[i];
			const eligibility =
				input.eligibility_expression ?? previous?.eligibility_expression ?? 'true';
			const amount =
				input.amount_expression ?? previous?.amount_expression ?? DEFAULT_COMMISSION_EXPRESSION;
			const validation = Result.try(() => {
				if (!amount) throw new Error('Missing amount expression');
				const fault = commissionFault(eligibility, 'bool') ?? commissionFault(amount, 'money');
				if (fault !== undefined) throw new Error(fault);
				const parameters =
					input.parameters === undefined ? (previous?.parameters ?? []) : (input.parameters ?? []);
				const names = new Set<string>();
				for (const parameter of parameters) {
					if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.name) || names.has(parameter.name))
						throw new Error('Duplicate or invalid parameter name');
					names.add(parameter.name);
					d(parameter.value);
				}
			});
			if (Result.isFailure(validation)) yield* ctx.refuse('errors.commission_expression_invalid');
			{
				out.push(input);
				continue;
			}
		}
		return out;
	}
});
c.query('preview', function* (input, ctx: QueryCtx) {
	const rule = yield* ctx.get('commission_rules', input.rule);
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
		const result = evaluateCommission(rule.eligibility_expression, rule.amount_expression, context);
		return {
			currency: rule.currency,
			amount: result.amount.round(minorDigits(rule.currency)),
			reason: result.eligible ? ('resolved' as const) : ('ineligible' as const)
		};
	});
	return Result.isFailure(evaluated)
		? { currency: rule.currency, amount: null, reason: 'expression_error' as const }
		: evaluated.success;
});
