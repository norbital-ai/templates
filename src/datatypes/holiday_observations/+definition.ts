import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { Schema } from 'effect';

export const holidayObservationInputSchema = Schema.Struct({
	date: Schema.String,
	name: Schema.String,
	original_date: Schema.NullOr(Schema.String),
	source: Schema.NullOr(Schema.String)
});

export const holidayObservationSchema = holidayObservationInputSchema.check(
	Schema.makeFilter(
		(row) =>
			(isCalendarDate(row.date) &&
				(row.original_date == null || isCalendarDate(row.original_date)) &&
				row.name.trim().length > 0) ||
			'Enter a holiday name and valid calendar dates.'
	)
);

export type HolidayObservation = Schema.Schema.Type<typeof holidayObservationSchema>;

export const holidayObservationsValueSchema = Schema.Array(holidayObservationSchema).check(
	Schema.makeFilter(
		(rows) =>
			new Set(rows.map((row) => row.date)).size === rows.length ||
			'Each observed date must occur only once.'
	)
);

export default defineCustomType({
	name: 'holiday_observations',
	description:
		'The complete list of observed public-holiday dates in one jurisdiction and calendar year. An empty published list explicitly declares no public holidays.',
	schema: Schema.toStandardSchemaV1(holidayObservationsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
