import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { MoneyValueSchema } from '@norbital-ai/std/finance';
import { Schema } from 'effect';

export interface MoneyOptions {
	readonly allowedCurrencies?: readonly [string, ...string[]];
}

export default defineCustomType({
	name: 'money',
	description:
		'A monetary amount stored with its ISO 4217 currency code, so charges and variation amounts can never silently mix currencies.',
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
