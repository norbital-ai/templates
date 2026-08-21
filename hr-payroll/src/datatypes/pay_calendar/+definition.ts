import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How a company divides one month for a cadence that is paid more than once inside it.
 *
 * `companies.pay_cutoff_day` and `companies.pay_day` are one integer each, and one integer each can
 * only describe a **monthly** calendar: one window, one pay date, one settlement a month. Every
 * company has that calendar and it stays where it is. What it cannot say is that some of the same
 * company's people are paid twice in the month — 1st–15th and 16th–end at Omni Plus System
 * Philippines, where Philippine law requires payment at least twice a month — and that is what this
 * type says.
 *
 * **Why this is not part of `settlement_policy`.** That type states a company's *deviations* from
 * its plain pay calendar: what happens at the two ends of an employment, which divisor values an
 * unpaid day, which narrower slice of attendance overtime reads. This is not a deviation from a pay
 * calendar — it *is* a pay calendar, the period a person's wages belong to and the day those wages
 * arrive. Filing it under "deviations" would have made the calendar a footnote to its own
 * exceptions, so it is its own column on `companies`.
 *
 * **One truth per cadence.** A monthly calendar is never stated here, because the company columns
 * already state it and two places to write the same fact is two places for them to disagree. Only a
 * cadence that splits a month into instalments can be described by day-of-month ranges at all — a
 * weekly or fortnightly cycle does not divide a month and is deliberately not expressible, so an
 * employment on one is refused by `validatePayCalendar` rather than quietly run on a calendar that
 * does not fit it.
 *
 * The instalments must tile the month: the first starts on day 1, each next one starts the day
 * after the previous ends, and the last runs to the end of the month (state `31`, which clamps to
 * the 28th or 29th in February). That is what makes "no day is paid twice and no day is missed" a
 * property of the data rather than a hope — `companies/+hooks.ts` refuses anything else on write,
 * and `payroll_runs/lib/period.ts` refuses it again on read.
 */
export const payCalendarValueSchema = Schema.Array(
	Schema.Struct({
		/** The `employment_terms.pay_frequency` this calendar governs. */
		pay_frequency: Schema.Literals(['SEMI_MONTHLY']),
		/**
		 * The pay events of one month, in order. Two of them for a semi-monthly calendar; the type
		 * refuses a single instalment, because one instalment covering the whole month is the
		 * monthly calendar the company columns already state.
		 */
		instalments: Schema.Array(
			Schema.Struct({
				/** First day of the month these wages belong to. */
				start_day: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 })),
				/** Last day of the month these wages belong to; `31` means the end of the month. */
				end_day: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 })),
				/** The day of the same month the instalment is paid on. */
				pay_day: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 }))
			})
		).check(Schema.isMinLength(2))
	})
).check(Schema.isMinLength(1));

export type PayCalendar = Schema.Schema.Type<typeof payCalendarValueSchema>;

/** Strict standard view: a key the calendar does not declare is refused rather than stripped. */
export const payCalendarSchema = Schema.toStandardSchemaV1(payCalendarValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'pay_calendar',
	description:
		'The instalments a month is divided into for a cadence paid more than once in it — each one’s salary window and its pay day. A monthly calendar is the company’s own cutoff and pay day and is never restated here.',
	schema: payCalendarSchema
});
