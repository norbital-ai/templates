import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/**
 * Whether a standing allowance is paid once or across a window, and when.
 *
 * This is the one payload that stayed a union when `component_entry_event` was split into five
 * collections, because it is a genuine two-armed fact about a single family rather than five
 * business facts wearing one type. A one-off is a *stated* one-off, not a range that happens to
 * span a single month: `depletes` reads false for a recurring allowance, so a one-off written as a
 * one-month range would be one-off only by arithmetic accident, and widening that range later
 * would silently turn one payment into many. A semi-monthly company is where that shows — it runs
 * two periods inside the month a one-off names, and an unbounded allowance would pay whole in both.
 */
export const allowanceRecurrenceValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('ONE_OFF'),
		/** The single period it is paid in, as `YYYY-MM`. */
		period: Schema.String.check(Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])$/))
	}),
	Schema.Struct({
		kind: Schema.Literal('RECURRING'),
		/** Paid whole in every period this window covers. `to` null is open-ended. */
		from: calendarDay,
		to: Schema.NullOr(calendarDay)
	})
]);

export type AllowanceRecurrence = Schema.Schema.Type<typeof allowanceRecurrenceValueSchema>;

/** Strict standard view: a key neither arm declares is refused rather than stripped. */
export const allowanceRecurrenceSchema = Schema.toStandardSchemaV1(allowanceRecurrenceValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'allowance_recurrence',
	description:
		'Whether a standing allowance is paid once, in one stated period, or across a window it is live for — paid whole in every period that window covers.',
	schema: allowanceRecurrenceSchema
});
