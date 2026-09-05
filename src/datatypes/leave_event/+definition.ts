import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/** One application only. Balance movements belong to leave_entries. */
export const leaveEventValueSchema = Schema.Struct({
	kind: Schema.Literal('TIME_OFF'),
	range: Schema.Struct({
		start: Schema.Struct({ date: calendarDay, half: Schema.Literals(['FIRST', 'SECOND']) }),
		end: Schema.Struct({ date: calendarDay, half: Schema.Literals(['FIRST', 'SECOND']) })
	}),
	/** Immutable approval snapshot, calculated by the server from the schedule and calendar. */
	chargeable_days: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
	reason: Schema.NullOr(Schema.String)
});

export type LeaveEvent = Schema.Schema.Type<typeof leaveEventValueSchema>;
export type TimeOffEvent = LeaveEvent;

export function defaultTimeOffEvent(on: string): TimeOffEvent {
	return {
		kind: 'TIME_OFF',
		range: {
			start: { date: on, half: 'FIRST' },
			end: { date: on, half: 'SECOND' }
		},
		chargeable_days: null,
		reason: null
	};
}

export const leaveEventSchema = Schema.toStandardSchemaV1(leaveEventValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_event',
	description:
		'One contiguous half-day-stepped time-off application. It never carries entitlement, carry, encashment or adjustment movements.',
	schema: leaveEventSchema
});
