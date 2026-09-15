/**
 * The work-rule value shapes shared by `work_rules` and the pricing modules.
 *
 * These lived under a `statutory_regime` custom datatype that was removed; the night premium
 * schema the engine still reads lives here beside the rules that own it.
 */

import { Schema } from 'effect';

/** The day types the work-day context prices. A SPECIAL holiday is its own type. */
export const RULE_DAY_TYPES = [
	'ORDINARY',
	'REST_DAY',
	'PUBLIC_HOLIDAY',
	'SPECIAL_HOLIDAY'
] as const;

const clockTime = Schema.String.check(
	Schema.makeFilter((value) =>
		/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? true : `"${value}" is not a HH:MM wall-clock time.`
	)
);

/**
 * A night window and what an hour inside it adds, as whole percentages of the hourly rate:
 * the Philippines adds 10% to every hour between 22:00 and 06:00, Vietnam 30% on ordinary hours
 * and 20% more on overtime hours. A window ending at or before its start crosses midnight.
 */
export const nightPremiumValueSchema = Schema.Struct({
	from: clockTime,
	to: clockTime,
	ordinary_add: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	overtime_add: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
});
export type NightPremium = Schema.Schema.Type<typeof nightPremiumValueSchema>;
