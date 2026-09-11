import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/**
 * Whether a standing allowance is paid once or across a window, and when.
 *
 * A one-off is one date: the day the amount is paid for, which the ordinary cutoff rule turns into
 * the run that pays it.
 */
export const allowanceRecurrenceValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('ONE_OFF'),
		/**
		 * The day the amount is paid for. A 15th entry is picked up by the first half of a
		 * semi-monthly month, a month-end entry by the second, a day past the cutoff by the next
		 * month's run — the same rule every other dated entry follows.
		 */
		on: calendarDay
	}),
	Schema.Struct({
		kind: Schema.Literal('RECURRING'),
		/** Paid whole in every period this window covers. `to` null is open-ended. */
		from: calendarDay,
		to: Schema.NullOr(calendarDay),
		/**
		 * The day of each month the instalment is incurred on, which decides the run that pays it —
		 * a 15th instalment in the first half of a semi-monthly month, a 20th in the second, a 25th
		 * past a 21st cutoff in the next month's run. Absent keeps the older reading: the amount is
		 * paid whole in every period the window overlaps.
		 */
		on_day: Schema.optionalKey(
			Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 31 }))
		)
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
		'Whether a standing allowance is paid once, on one stated day, or across a window it is live for — paid whole in every period that window covers.',
	schema: allowanceRecurrenceSchema
});
