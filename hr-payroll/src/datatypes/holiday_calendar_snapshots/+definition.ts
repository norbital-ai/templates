import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { holidayObservationsValueSchema } from '../holiday_observations/+definition.js';

export const holidayCalendarSnapshotSchema = Schema.Struct({
	id: Schema.String.check(Schema.isUUID()),
	jurisdiction_code: Schema.String,
	year: Schema.Int,
	revision: Schema.Int,
	published_at: Schema.String,
	observations: holidayObservationsValueSchema
});

export type HolidayCalendarSnapshot = Schema.Schema.Type<typeof holidayCalendarSnapshotSchema>;
export const holidayCalendarSnapshotsSchema = Schema.Array(holidayCalendarSnapshotSchema);

export default defineCustomType({
	name: 'holiday_calendar_snapshots',
	description:
		'The exact published jurisdiction calendar revisions and observed dates captured by a payroll calculation.',
	schema: Schema.toStandardSchemaV1(holidayCalendarSnapshotsSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
