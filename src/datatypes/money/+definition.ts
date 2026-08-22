import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { MoneyValueSchema } from '@norbital-ai/std/finance';
import { Schema } from 'effect';

export interface MoneyOptions {
	readonly allowedCurrencies?: readonly [string, ...string[]];
}

export function moneySchema(options: MoneyOptions = {}) {
	return Schema.Struct({
		...MoneyValueSchema.fields,
		currency: options.allowedCurrencies
			? Schema.Literals(options.allowedCurrencies)
			: MoneyValueSchema.fields.currency
	});
}

export default defineCustomType({
	name: 'money',
	description:
		'A monetary amount carried with its ISO 4217 currency code, so totals never silently mix currencies.',
	schema: moneySchema
});
