import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { isCalendarDate, isUtcIsoInstant } from '@norbital-ai/std/date';
import { Schema } from 'effect';

export const holidayImportEventSchema = Schema.Struct({
	/** Calendar and event identity, independent of the event's date or upstream revision. */
	source: Schema.String,
	event_id: Schema.String,
	revision: Schema.String,
	updated_at: Schema.NullOr(Schema.String),
	name: Schema.String,
	dates: Schema.Array(Schema.String),
	cancelled: Schema.Boolean,
	review_required: Schema.Boolean
});

export const holidayImportReviewSchema = Schema.Struct({
	calendar_id: Schema.String,
	time_zone: Schema.String,
	retrieved_at: Schema.String,
	events: Schema.Array(holidayImportEventSchema)
}).check(
	Schema.makeFilter(
		(row) =>
			(isUtcIsoInstant(row.retrieved_at) &&
				new Set(row.events.map((event) => event.source)).size === row.events.length &&
				row.events.every(
					(event) =>
						event.source.length > 0 &&
						event.event_id.length > 0 &&
						event.name.trim().length > 0 &&
						event.dates.every(isCalendarDate) &&
						new Set(event.dates).size === event.dates.length &&
						(event.updated_at == null || isUtcIsoInstant(event.updated_at))
				)) ||
			'An import requires unique source identities, valid dates and retrieval evidence.'
	)
);

export type HolidayImportEvent = Schema.Schema.Type<typeof holidayImportEventSchema>;
export type HolidayImportReview = Schema.Schema.Type<typeof holidayImportReviewSchema>;

export default defineCustomType({
	name: 'holiday_import_review',
	description:
		'The complete Google Calendar import and pending source changes for an annual holiday draft. Operator selections remain in its observations until explicitly reviewed.',
	schema: Schema.toStandardSchemaV1(holidayImportReviewSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
