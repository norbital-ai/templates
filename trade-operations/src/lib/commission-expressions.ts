import { BigDecimal, Predicate, Result } from 'effect';
import { compile, context, evaluate, formula, type Id, type ReadAnswer } from '@norbital-ai/bolt';
import { type D, type DecimalLike, dec, div, minorDigits, round, text } from './values.js';

export const DEFAULT_COMMISSION_EXPRESSION =
	'basis_quantity * (rule.fixed_rate + max(spread, 0) * rule.spread_pct / 100)';
export const COMMISSION_ENGINE = 'cel-decimal-v1';
/** A CEL argument as a figure: a boxed decimal carries its `BigDecimal` as `value`. */
const decimal = (value: unknown): D =>
	Predicate.hasProperty(value, 'value') && BigDecimal.isBigDecimal(value.value)
		? value.value
		: typeof value === 'bigint'
			? BigDecimal.fromBigInt(value)
			: typeof value === 'number'
				? BigDecimal.fromNumberUnsafe(value)
				: BigDecimal.fromStringUnsafe(String(value));
const numeric = { kind: 'decimal' } as const;
const optionalNumeric = { kind: 'decimal', optional: true } as const;
const textKind = { kind: 'text' } as const;
const commission = context(
	{
		quantity: numeric,
		net: numeric,
		floor_net: optionalNumeric,
		basis_quantity: optionalNumeric,
		spread: optionalNumeric,
		product: { kind: 'object', fields: { code: textKind, name: textKind, unit: textKind } },
		order: {
			kind: 'object',
			fields: { currency: textKind, ordered_on: textKind, party_code: textKind }
		},
		rule: { kind: 'object', fields: { fixed_rate: numeric, spread_pct: numeric } },
		params: { kind: 'record', of: numeric }
	},
	{
		functions: {
			min: {
				signature: 'min(dyn, dyn): Decimal',
				// Returns the argument itself, so CEL keeps its own decimal box.
				fn: (a: unknown, b: unknown) =>
					BigDecimal.isLessThanOrEqualTo(decimal(a), decimal(b)) ? a : b
			},
			max: {
				signature: 'max(dyn, dyn): Decimal',
				fn: (a: unknown, b: unknown) =>
					BigDecimal.isGreaterThanOrEqualTo(decimal(a), decimal(b)) ? a : b
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
	const quantity = dec(values.quantity),
		factor = values.factor ? dec(values.factor) : null;
	const floor = values.floor_net === null ? null : dec(values.floor_net);
	return {
		quantity,
		net: dec(values.net),
		floor_net: floor,
		basis_quantity:
			factor && BigDecimal.isPositive(factor) ? BigDecimal.multiply(quantity, factor) : null,
		spread:
			floor && factor && BigDecimal.isPositive(factor) && BigDecimal.isPositive(quantity)
				? div(BigDecimal.subtract(div(values.net, quantity, 18), floor), factor, 18)
				: null,
		product: { code: values.product_code, name: values.product_name, unit: values.unit },
		order: {
			currency: values.currency,
			ordered_on: values.ordered_on,
			party_code: values.party_code
		},
		rule: { fixed_rate: dec(values.fixed_rate), spread_pct: dec(values.spread_pct) },
		params: Object.fromEntries(values.parameters.map((p): [string, D] => [p.name, dec(p.value)]))
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
	if (!evaluate(eligible, values)) return { eligible: false, amount: dec(0) };
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
				quantity: text(sample.quantity),
				net: text(sample.net),
				floor_net: sample.floor_net == null ? null : text(sample.floor_net),
				factor: sample.factor == null ? null : text(sample.factor),
				product_code: sample.product_code ?? '',
				product_name: '',
				unit: sample.unit ?? '',
				currency: rule.currency,
				ordered_on: sample.ordered_on,
				party_code: sample.party_code ?? '',
				fixed_rate: rule.fixed_rate,
				spread_pct: rule.spread_pct,
				parameters: rule.parameters ?? []
			})
		);
		return {
			currency: rule.currency,
			amount: round(result.amount, minorDigits(rule.currency)),
			reason: result.eligible ? ('resolved' as const) : ('ineligible' as const)
		};
	});
	return Result.isFailure(evaluated)
		? { currency: rule.currency, amount: null, reason: 'expression_error' as const }
		: evaluated.success;
}
