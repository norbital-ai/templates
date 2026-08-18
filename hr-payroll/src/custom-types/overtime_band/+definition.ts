import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The slice of a working day an overtime rule covers.
 * `BEYOND_NORMAL` counts hours past the normal daily hours;
 * `FROM_START_OF_DAY` counts fractions of a normal day worked from the first minute
 * (rest-day / public-holiday day-wage rules).
 * `to_*` is an exclusive upper bound; `null` means "open ended".
 */
export const overtimeBandValueSchema = Schema.Union([
	Schema.Struct({
		measure: Schema.Literal('BEYOND_NORMAL'),
		from_hours: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		to_hours: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	Schema.Struct({
		measure: Schema.Literal('FROM_START_OF_DAY'),
		from_fraction: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		to_fraction: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))
	})
]);

export type OvertimeBand = Schema.Schema.Type<typeof overtimeBandValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const overtimeBandSchema = Schema.toStandardSchemaV1(overtimeBandValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'overtime_band',
	description:
		'The slice of a working day an overtime rule covers, counted either as hours beyond the normal daily hours or as fractions of a normal day worked from the first minute.',
	schema: overtimeBandSchema
});
