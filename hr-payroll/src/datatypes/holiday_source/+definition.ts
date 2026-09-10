import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

const validTimeZone = (zone: string) => {
	try {
		new Intl.DateTimeFormat('en', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
};

/** The Google holiday calendar and IANA time zone one jurisdiction's annual drafts are read from. */
export const holidaySourceValueSchema = Schema.Struct({
	calendar_id: Schema.String,
	time_zone: Schema.String,
	/** Whether the yearly 1 October job prepares next year's draft; a manual run ignores it. */
	enabled: Schema.Boolean
}).check(
	Schema.makeFilter((row) => {
		if (!row.calendar_id.trim() || row.calendar_id !== row.calendar_id.trim())
			return 'Enter a Google calendar identifier without surrounding whitespace.';
		if (!row.time_zone.trim() || /^[+-]/.test(row.time_zone) || !validTimeZone(row.time_zone))
			return 'Enter a valid IANA time zone for this jurisdiction, not a fixed UTC offset.';
		return true;
	})
);

export default defineCustomType({
	name: 'holiday_source',
	description:
		'The Google Calendar source and IANA time zone used to prepare annual holiday drafts for one payroll jurisdiction. Credentials belong to the managed connection.',
	schema: Schema.toStandardSchemaV1(holidaySourceValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
