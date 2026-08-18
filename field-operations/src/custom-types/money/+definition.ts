import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

export interface MoneyOptions {
	readonly allowedCurrencies?: readonly [string, ...string[]];
}

const moneyValueSchema = Schema.Struct({
	value: Schema.Finite,
	currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))
});

export default defineCustomType({
	name: 'money',
	description:
		'A monetary amount stored with its ISO 4217 currency code, so charges and variation amounts can never silently mix currencies.',
	schema: (options: MoneyOptions = {}) =>
		Schema.toStandardSchemaV1(
			Schema.Struct({
				...moneyValueSchema.fields,
				currency: options.allowedCurrencies
					? Schema.Literals(options.allowedCurrencies)
					: moneyValueSchema.fields.currency
			}),
			{ parseOptions: { onExcessProperty: 'error' } }
		)
});
