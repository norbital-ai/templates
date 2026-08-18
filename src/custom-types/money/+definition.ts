import { Schema } from 'effect';
import { defineCustomType } from '@norbital-ai/bolt/authoring';

export interface MoneyOptions {
	readonly allowedCurrencies?: readonly [string, ...string[]];
}

/**
 * An ISO 4217 currency code, trimmed before it is checked the way the zod `z.string().trim()`
 * chain this replaced did.
 */
const isoCurrencyCode = Schema.decodeTo(Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)))(
	Schema.Trim
);

export default defineCustomType({
	name: 'money',
	description:
		'A monetary amount stored with its ISO 4217 currency code, so claim and contract totals can never silently mix currencies.',
	schema: (options: MoneyOptions = {}) =>
		Schema.toStandardSchemaV1(
			Schema.Struct({
				value: Schema.Finite,
				currency: options.allowedCurrencies
					? Schema.Literals(options.allowedCurrencies)
					: isoCurrencyCode
			}),
			{ parseOptions: { onExcessProperty: 'error' } }
		)
});
