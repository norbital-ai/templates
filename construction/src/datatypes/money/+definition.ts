import { Schema } from 'effect';
import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { MoneyValueSchema, type MoneyValue } from '@norbital-ai/std/finance';

/**
 * Options accepted by the money custom type's schema factory: the ISO 4217 codes an install may
 * allow for a column, before the open pattern is used for the rest.
 */
const moneyOptionsSchema = Schema.Struct({
	allowedCurrencies: Schema.optional(Schema.NonEmptyArray(Schema.String))
});

export type MoneyOptions = typeof moneyOptionsSchema.Type;

export type { MoneyValue };

export default defineCustomType({
	name: 'money',
	description:
		'A monetary amount stored with its ISO 4217 currency code, so claim and contract totals can never silently mix currencies.',
	schema: (options: MoneyOptions = {}) =>
		Schema.toStandardSchemaV1(
			Schema.Struct({
				...MoneyValueSchema.fields,
				currency: options.allowedCurrencies
					? Schema.Literals(options.allowedCurrencies)
					: MoneyValueSchema.fields.currency
			}),
			{ parseOptions: { onExcessProperty: 'error' } }
		)
});
