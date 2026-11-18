import { id_of, instance_id, type CreateInput, type Row, type StoredRow } from '@norbital-ai/bolt';
import { DateTime, Option, Schema } from 'effect';

const Time = Schema.Struct({
	dateTime: Schema.optionalKey(Schema.String),
	date: Schema.optionalKey(Schema.String),
	timeZone: Schema.optionalKey(Schema.String)
});
type Time = typeof Time.Type;
/** Google all-day dates stay dates; only an explicitly zoned dateTime becomes an instant. */
export const calendarInstant = ({ dateTime }: Time) => {
	if (dateTime === undefined) return null;
	if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateTime))
		throw new RangeError(`An instant needs its time with a zone: ${dateTime}`);
	return DateTime.formatIso(DateTime.makeUnsafe(dateTime));
};
export const calendarDate = ({ date }: Time) => date ?? null;

// ── two-way sync: what HQ writes to Google and how it recognises its own writes coming back ──
const Person = Schema.Struct({
	email: Schema.optionalKey(Schema.String),
	displayName: Schema.optionalKey(Schema.String),
	self: Schema.optionalKey(Schema.Boolean),
	organizer: Schema.optionalKey(Schema.Boolean),
	optional: Schema.optionalKey(Schema.Boolean),
	responseStatus: Schema.optionalKey(Schema.String)
});
/**
 * A Google event as HQ reads it: its version, HQ's stamp, the fields a meeting mirrors and who takes part. The calendar
 * sync decodes the driver's source event once against it (every other field kept) into `calendar_entries.source_event`.
 */
export const GoogleEvent = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	etag: Schema.optionalKey(Schema.String),
	status: Schema.optionalKey(Schema.String),
	summary: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.String),
	location: Schema.optionalKey(Schema.String),
	start: Schema.optionalKey(Time),
	end: Schema.optionalKey(Time),
	attendees: Schema.optionalKey(Schema.Array(Person)),
	organizer: Schema.optionalKey(Person),
	extendedProperties: Schema.optionalKey(
		Schema.Struct({ private: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) })
	)
});
export type GoogleEvent = typeof GoogleEvent.Type;
/** The Google event id of a meeting created in HQ: its activity id in Google's base32hex alphabet, so a retried insert is the same event. */
export const eventIdOf = (activity: string) => activity.toLowerCase().replace(/[^0-9a-v]/g, '');
/** The activity an event was created from in HQ, stamped on it at insert. */
const ActivityId = id_of('activities');
/** What the helpers below read, as a decoded Google event and a stored `source_event` both hold it. */
type EventParts = Pick<Row<'calendar_entries'>['source_event'], 'attendees' | 'extendedProperties'>;
export const activityOf = (event: EventParts) =>
	Option.getOrNull(
		Schema.decodeUnknownOption(ActivityId)(event.extendedProperties?.private?.['norbital_activity'])
	);
/** Validate a calendar instance's definition before using its id in a pinned reference. */
export const calendarAccountOf = (row: Pick<Row<'sys_integration'>, 'id' | 'integration'>) =>
	instance_id('google_calendar', row);
/** The guests of an event: its attendees but the calendar's own entry. */
export const guestsOf = (event: EventParts) => [
	...new Set(
		(event.attendees ?? []).flatMap((attendee) =>
			attendee.self === true || attendee.email == null ? [] : [attendee.email.trim().toLowerCase()]
		)
	)
];
/** What a member edit of a meeting writes to Google: one more revision when any of these moved. */
const SYNCED = [
	'subject',
	'detail',
	'location',
	'attendees',
	'scheduled_start_at',
	'scheduled_end_at',
	'scheduled_start_on',
	'scheduled_end_on',
	'status'
] as const;
export const syncedChange = (
	input: { readonly [K in (typeof SYNCED)[number]]?: CreateInput<'activities'>[K] },
	before: Pick<StoredRow<'activities'>, (typeof SYNCED)[number]>
) =>
	SYNCED.some(
		(field) =>
			input[field] !== undefined &&
			JSON.stringify(input[field]) !== JSON.stringify(before[field] ?? null)
	);
