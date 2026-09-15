import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';

/**
 * The entitlement ceiling of one catalogue band.
 *
 * The band's `when` already decides who it covers, so the ceiling states only how much and over
 * what window. A person the band covers has this entitlement per period; usage is judged against
 * every other entry of the same catalogue that settled in the same window.
 *
 * `amount` is money over the entry context, so a ceiling that is a formula
 * (`minimum_wage(region) * 12.0`) is one compiled rule and a plain figure is a valid expression.
 */
export const entitlementValueSchema = Schema.Struct({
	period: Schema.Literals(['CALENDAR_YEAR', 'MONTH', 'LIFETIME', 'PER_EVENT']),
	/**
	 * `BLOCK` refuses an entry that takes usage past the ceiling at write time and at payroll.
	 * `ALLOW` reports it without refusing: the ceiling is a statement, not a gate.
	 */
	on_exceed: Schema.Literals(['BLOCK', 'ALLOW']),
	/** Money over the entry context. */
	amount: Schema.String.check(Schema.isMinLength(1))
});

export type Entitlement = Schema.Schema.Type<typeof entitlementValueSchema>;

export const entitlementSchema = Schema.toStandardSchemaV1(entitlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
}).check(
	Schema.makeFilter((entitlement) => {
		return (
			compileExpression({ expression: entitlement.amount, site: 'entry', type: 'money' }) ?? true
		);
	})
);

export default defineCustomType({
	name: 'entitlement',
	description:
		'The ceiling of one catalogue band: the window it counts over, whether exceeding it blocks or is only reported, and the amount as a figure or an expression over the entry context.',
	schema: entitlementSchema
});
