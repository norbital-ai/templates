import { Decimal, minorDigits, type DecimalLike } from '@norbital-ai/std/decimal';
import { Result } from 'effect';
import type { Id, ReadAnswer } from '@norbital-ai/bolt';
import { compile, context, evaluate, formula } from '@norbital-ai/std/formula';

export const DEFAULT_COMMISSION_EXPRESSION =
	'basis_quantity * (rule.fixed_rate + max(spread, 0) * rule.spread_pct / 100)';
export const COMMISSION_ENGINE = 'cel-decimal-v1';
const decimal = (value: unknown) => (value instanceof Decimal ? value : Decimal.of(String(value)));
const numeric = { kind: 'decimal' } as const;
const optionalNumeric = { kind: 'decimal', optional: true } as const;
const text = { kind: 'text' } as const;
const commission = context(
	{
		quantity: numeric,
		net: numeric,
		floor_net: optionalNumeric,
		basis_quantity: optionalNumeric,
		spread: optionalNumeric,
		product: { kind: 'object', fields: { code: text, name: text, unit: text } },
		order: { kind: 'object', fields: { currency: text, ordered_on: text, party_code: text } },
		rule: { kind: 'object', fields: { fixed_rate: numeric, spread_pct: numeric } },
		params: { kind: 'record', of: numeric }
	},
	{
		functions: {
			min: {
				signature: 'min(dyn, dyn): Decimal',
				fn: (a: unknown, b: unknown) => (decimal(a).lte(decimal(b)) ? decimal(a) : decimal(b))
			},
			max: {
				signature: 'max(dyn, dyn): Decimal',
				fn: (a: unknown, b: unknown) => (decimal(a).gte(decimal(b)) ? decimal(a) : decimal(b))
			}
		}
	}
);
type CommissionFacts = {
	quantity: string;
	net: string;
	floor_net: string | null;
	factor: string | null;
	product_code: string;
	product_name: string;
	unit: string;
	currency: string;
	ordered_on: string;
	party_code: string;
	fixed_rate: string;
	spread_pct: string;
	parameters: readonly {
		name: string;
		value: string;
	}[];
};
export function commissionContext(values: CommissionFacts) {
	const quantity = Decimal.of(values.quantity),
		factor = values.factor ? Decimal.of(values.factor) : null;
	const floor = values.floor_net === null ? null : Decimal.of(values.floor_net);
	return {
		quantity,
		net: Decimal.of(values.net),
		floor_net: floor,
		basis_quantity: factor && factor.gt(0) ? quantity.times(factor) : null,
		spread:
			floor && factor && factor.gt(0) && quantity.gt(0)
				? Decimal.of(values.net).div(quantity, 18).minus(floor).div(factor, 18)
				: null,
		product: { code: values.product_code, name: values.product_name, unit: values.unit },
		order: {
			currency: values.currency,
			ordered_on: values.ordered_on,
			party_code: values.party_code
		},
		rule: { fixed_rate: Decimal.of(values.fixed_rate), spread_pct: Decimal.of(values.spread_pct) },
		params: Object.fromEntries(
			values.parameters.map((p): [string, Decimal] => [p.name, Decimal.of(p.value)])
		)
	};
}
type CommissionValues = ReturnType<typeof commissionContext>;
export const commissionFault = (source: string, result: 'bool' | 'money') =>
	source.trim() === '' || source.length > 8000
		? 'A commission expression must have 1–8000 characters.'
		: formula(commission, result)(source);
export function evaluateCommission(eligibility: string, amount: string, values: CommissionValues) {
	const eligible = compile(commission, eligibility, 'bool');
	if ('error' in eligible) throw new Error(eligible.error);
	if (!evaluate(eligible, values)) return { eligible: false, amount: Decimal.of(0) };
	const result = compile(commission, amount, 'money');
	if ('error' in result) throw new Error(result.error);
	return { eligible: true, amount: evaluate(result, values) };
}
/** The saved rule a preview evaluates. */
export const previewRead = (rule: Id<'commission_rules'>) =>
	({ commission_rules: { where: { id: { eq: rule } }, limit: 1 } }) as const;
/**
 * The saved commission rule against explicit sample facts, changing no order: its amount, `ineligible`, or
 * `expression_error`; `null` when the rule is not readable.
 */
export function commissionPreview(
	answer: ReadAnswer<ReturnType<typeof previewRead>>,
	sample: {
		quantity: DecimalLike;
		net: DecimalLike;
		floor_net?: DecimalLike | null;
		factor?: DecimalLike | null;
		product_code?: string | null;
		unit?: string | null;
		party_code?: string | null;
		ordered_on: string;
	}
) {
	const rule = answer.commission_rules.rows[0];
	if (!rule) return null;
	const evaluated = Result.try(() => {
		const result = evaluateCommission(
			rule.eligibility_expression,
			rule.amount_expression,
			commissionContext({
				quantity: Decimal.of(sample.quantity).toString(),
				net: Decimal.of(sample.net).toString(),
				floor_net: sample.floor_net == null ? null : Decimal.of(sample.floor_net).toString(),
				factor: sample.factor == null ? null : Decimal.of(sample.factor).toString(),
				product_code: sample.product_code ?? '',
				product_name: '',
				unit: sample.unit ?? '',
				currency: rule.currency,
				ordered_on: sample.ordered_on,
				party_code: sample.party_code ?? '',
				fixed_rate: rule.fixed_rate.toString(),
				spread_pct: rule.spread_pct.toString(),
				parameters: rule.parameters ?? []
			})
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
