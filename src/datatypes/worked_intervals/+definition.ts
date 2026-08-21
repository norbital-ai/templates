import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { offsetDateTime } from '../../lib/iso-day.js';

export const workedIntervalValueSchema = Schema.Struct({
	start_at: offsetDateTime,
	end_at: Schema.NullOr(offsetDateTime)
});

export type WorkedInterval = Schema.Schema.Type<typeof workedIntervalValueSchema>;

/**
 * Raw attendance observations. A source system may call one interval "regular" and another "OT",
 * but both are simply worked time here; overtime is derived only after comparing the normalized
 * intervals with the published schedule and the effective rules.
 */
export const workedIntervalsValueSchema = Schema.Array(workedIntervalValueSchema).check(
	Schema.isMinLength(1)
);

export type WorkedIntervals = Schema.Schema.Type<typeof workedIntervalsValueSchema>;

/** Strict standard view: a key an interval does not declare is refused rather than stripped. */
export const workedIntervalsSchema = Schema.toStandardSchemaV1(workedIntervalsValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'worked_intervals',
	description:
		'One or more actual worked intervals. Open attendance has a null final end; overtime is never stored in this value.',
	schema: workedIntervalsSchema
});
