/**
 * The work-rule value shapes shared by `work_rules` and the pricing modules.
 *
 * These lived under a `statutory_regime` custom datatype that the RFC removed; nothing binds that
 * type any more, so the two schemas the engine still reads — the overtime coverage rule and the
 * night premium — live here beside the rules that own them.
 */

import { MoneyValueSchema } from '@norbital-ai/std/finance';
import { Schema } from 'effect';

export const overtimeCoverageValueSchema = Schema.Struct({
	wage_ceiling: Schema.NullOr(MoneyValueSchema),
	ceiling_is_inclusive: Schema.NullOr(Schema.Boolean),
	wage_basis: Schema.NullOr(Schema.Literals(['STATUTORY_WAGES', 'BASE_SALARY'])),
	category_basis: Schema.Literals(['STATUTORY_WORK_CATEGORY', 'WORK_CLASSIFICATION']),
	exempt_categories: Schema.Array(Schema.Trimmed.check(Schema.isMinLength(1))),
	excluded_categories: Schema.Array(Schema.Trimmed.check(Schema.isMinLength(1)))
});

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
