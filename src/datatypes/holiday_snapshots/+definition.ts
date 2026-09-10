import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/** One holiday exactly as a payroll run read it: values as well as the id, so a replay needs no live read. */
export const holidaySnapshotSchema = Schema.Struct({
	id: Schema.String.check(Schema.isUUID()),
	company_id: Schema.String.check(Schema.isUUID()),
	date: calendarDay,
	name: Schema.String,
	kind: Schema.Literals(['PUBLIC', 'SPECIAL', 'SUBSTITUTE']),
	original_date: Schema.NullOr(calendarDay),
	published_at: Schema.String
});

export type HolidaySnapshot = Schema.Schema.Type<typeof holidaySnapshotSchema>;
export const holidaySnapshotsSchema = Schema.Array(holidaySnapshotSchema);

export default defineCustomType({
	name: 'holiday_snapshots',
	description: 'The published holidays a payroll calculation read, captured on the run.',
	schema: Schema.toStandardSchemaV1(holidaySnapshotsSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
