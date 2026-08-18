import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/**
 * The event carried by a leave request row.
 *
 * TIME_OFF is the ordinary approval-backed request. The other arms preserve the two legitimate
 * non-request movements that used to require `leave_ledger`. Keeping them in the same closed union
 * makes one collection the complete event stream without nullable columns that only apply to one
 * kind of event.
 */
export const leaveEventValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('TIME_OFF'),
		range: Schema.Struct({
			start: Schema.Struct({ date: calendarDay, half: Schema.Literals(['FIRST', 'SECOND']) }),
			end: Schema.Struct({ date: calendarDay, half: Schema.Literals(['FIRST', 'SECOND']) })
		}),
		/** Immutable approval snapshot, calculated by the server from the schedule and calendar. */
		chargeable_days: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
		reason: Schema.NullOr(Schema.String),
		certificate_file: Schema.NullOr(Schema.String.check(Schema.isUUID()))
	}),
	Schema.Struct({
		kind: Schema.Literal('BALANCE_ADJUSTMENT'),
		effective_on: calendarDay,
		movement_days: Schema.Finite,
		note: Schema.NullOr(Schema.String),
		source_id: Schema.NullOr(Schema.String.check(Schema.isUUID()))
	}),
	Schema.Struct({
		kind: Schema.Literal('ENCASHMENT'),
		effective_on: calendarDay,
		movement_days: Schema.Finite,
		note: Schema.NullOr(Schema.String),
		source_id: Schema.NullOr(Schema.String.check(Schema.isUUID()))
	})
]);

export type LeaveEvent = Schema.Schema.Type<typeof leaveEventValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const leaveEventSchema = Schema.toStandardSchemaV1(leaveEventValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_event',
	description:
		'What a leave request row records: one contiguous half-day-stepped range whose charged days are server-derived, a balance adjustment, or an encashment.',
	schema: leaveEventSchema
});
