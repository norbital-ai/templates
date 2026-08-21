import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How an accrual band is looked up: by completed months of service (the band applies from
 * `band_from` months upward, until a higher band takes over) or flat for everyone.
 *
 * `onExcessProperty: 'error'` is what `z.strictObject` was, and it is not decoration: without it an
 * Effect `Struct` *strips* a key it does not declare and reports success, so a misspelled member
 * would be dropped on the way in and the write accepted. `Schema.Int` rather than `Schema.Number`
 * because `Number` admits `NaN` and `Infinity`, neither of which is a month count.
 */
export const accrualKeyValueSchema = Schema.Union([
	Schema.Struct({
		by: Schema.Literal('SERVICE_MONTHS'),
		band_from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
	}),
	Schema.Struct({ by: Schema.Literal('FLAT') })
]);

export type AccrualKey = Schema.Schema.Type<typeof accrualKeyValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const accrualKeySchema = Schema.toStandardSchemaV1(accrualKeyValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'accrual_key',
	description:
		'How a leave accrual band is selected: from a number of completed months of service upward, or flat for every employee regardless of service.',
	schema: accrualKeySchema
});
