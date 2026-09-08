import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { MoneyValueSchema } from '@norbital-ai/std/finance';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

export const leaveWindowSchema = Schema.Struct({ start: calendarDay, end: calendarDay });
export type LeaveWindow = Schema.Schema.Type<typeof leaveWindowSchema>;
const quantity = Schema.Finite.check(Schema.isGreaterThan(0));
const reason = Schema.NullOr(Schema.String);
const half = Schema.Literals(['FIRST', 'SECOND']);
export const timeOffEventSchema = Schema.Struct({
	kind: Schema.Literal('TIME_OFF'),
	range: Schema.Struct({
		start: Schema.Struct({ date: calendarDay, half }),
		end: Schema.Struct({ date: calendarDay, half })
	}),
	/** Approval computes this from dated charges, never from a stored balance account. */
	chargeable_days: Schema.NullOr(quantity),
	reason
});
export const leaveEventValueSchema = Schema.Union([
	timeOffEventSchema,
	Schema.Struct({
		kind: Schema.Literal('ENCASHMENT'),
		source_window: leaveWindowSchema,
		days: quantity,
		gross_amount: MoneyValueSchema,
		/** Optional entered rate explains the entered gross; payroll never supplies one. */
		rate: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
		effective_on: calendarDay,
		due_on: calendarDay,
		reason
	}),
	Schema.Struct({
		kind: Schema.Literal('CARRY_FORWARD'),
		source_window: leaveWindowSchema,
		destination_window: leaveWindowSchema,
		days: quantity,
		available_from: calendarDay,
		expires_on: calendarDay,
		effective_on: calendarDay,
		reason
	}),
	Schema.Struct({
		kind: Schema.Literal('ADJUSTMENT'),
		window: leaveWindowSchema,
		days: Schema.Finite.check(
			Schema.makeFilter((value: number) => value !== 0 || 'must change the balance')
		),
		effective_on: calendarDay,
		reason
	}),
	Schema.Struct({
		kind: Schema.Literal('REVERSAL'),
		entry_id: Schema.String.check(Schema.isUUID()),
		effective_on: calendarDay,
		due_on: Schema.NullOr(calendarDay),
		days: Schema.NullOr(quantity),
		gross_amount: Schema.NullOr(MoneyValueSchema),
		reason
	})
]);
export type LeaveEvent = Schema.Schema.Type<typeof leaveEventValueSchema>;
export type TimeOffEvent = Extract<LeaveEvent, { kind: 'TIME_OFF' }>;
export const leaveEventSchema = Schema.toStandardSchemaV1(leaveEventValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
export function defaultTimeOffEvent(on: string): TimeOffEvent {
	return {
		kind: 'TIME_OFF',
		range: { start: { date: on, half: 'FIRST' }, end: { date: on, half: 'SECOND' } },
		chargeable_days: null,
		reason: null
	};
}
export default defineCustomType({
	name: 'leave_event',
	description:
		'One manual Leave activity: time off, agreed encashment, carry-forward, adjustment or a linked reversal.',
	schema: leaveEventSchema
});
