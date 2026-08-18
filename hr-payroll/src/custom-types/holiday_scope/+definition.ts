import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Where a company holiday applies. `REGIONAL` always carries at least one location code —
 * this replaces a nullable `location_codes` column that would be meaningless for national
 * holidays.
 */
export const holidayScopeValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('NATIONAL') }),
	Schema.Struct({
		kind: Schema.Literal('REGIONAL'),
		location_codes: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
			Schema.isMinLength(1)
		)
	})
]);

export type HolidayScope = Schema.Schema.Type<typeof holidayScopeValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const holidayScopeSchema = Schema.toStandardSchemaV1(holidayScopeValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'holiday_scope',
	description:
		'Whether a company holiday falls nationally or only at the named location codes, so a gazetted state holiday reaches only the people it covers.',
	schema: holidayScopeSchema
});
