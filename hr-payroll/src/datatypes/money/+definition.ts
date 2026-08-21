import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

export interface MoneyOptions {
	readonly allowedCurrencies?: readonly [string, ...string[]];
}

/** `Trimmed` first, as the zod `z.trim()` this replaced did, then the ISO 4217 pattern. */
const iso4217 = Schema.Trimmed.check(
	Schema.isPattern(/^[A-Z]{3}$/, { message: 'Currency must be an ISO 4217 code.' })
);

export function moneySchema(options: MoneyOptions = {}) {
	return Schema.Struct({
		value: Schema.Finite,
		currency: options.allowedCurrencies ? Schema.Literals(options.allowedCurrencies) : iso4217
	});
}

/** The plain money value (no currency restriction), for nesting and decode. */
export const moneyValueSchema = moneySchema();

export type Money = Schema.Schema.Type<typeof moneyValueSchema>;

export default defineCustomType({
	name: 'money',
	description:
		'A monetary amount carried with its ISO 4217 currency code, so totals never silently mix currencies.',
	schema: moneySchema
});
