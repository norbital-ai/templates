import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Which band of a statutory contribution table a rate row applies to.
 * The discriminator mirrors `statutory_contributions.keyed_by`.
 * `to` bounds are exclusive upper limits; `null` means "open ended".
 */
export const rateSelectorValueSchema = Schema.Union([
	Schema.Struct({
		by: Schema.Literal('WAGE'),
		from: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		to: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	Schema.Struct({
		by: Schema.Literal('WAGE_AND_AGE'),
		from: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		to: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
		age_from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		age_to: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	/**
	 * A wage ladder that a jurisdiction publishes twice, once per marital category — Malaysia's
	 * MTD Category 1 and Category 2 are the same scale with a larger s.6D rebate folded into
	 * Category 2's constants. It is the marital sibling of `WAGE_AND_AGE`: the category filters
	 * first, then the wage ceiling picks a row from what survives.
	 *
	 * `marital` names the CATEGORY, not the employee's civil status. `MARRIED` is the category for
	 * a taxpayer who carries a spouse — one who exists and has no total income of their own — and
	 * `SINGLE` is the category for everyone else, including a married taxpayer whose spouse earns.
	 * It is chosen from `employees.spouse_status`, which is the question the statute asks.
	 */
	Schema.Struct({
		by: Schema.Literal('WAGE_AND_MARITAL'),
		from: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		to: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
		marital: Schema.Literals(['SINGLE', 'MARRIED'])
	}),
	Schema.Struct({
		by: Schema.Literal('HEADCOUNT'),
		from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		to: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	Schema.Struct({
		by: Schema.Literal('RISK_CLASS'),
		class: Schema.String.check(Schema.isMinLength(1))
	})
]).check(
	Schema.makeFilter((selector) => {
		if (selector.by === 'RISK_CLASS') return true;
		if (selector.to != null && selector.to <= selector.from)
			return 'A rate band must end above its lower bound.';
		if (
			selector.by === 'WAGE_AND_AGE' &&
			selector.age_to != null &&
			selector.age_to <= selector.age_from
		)
			return 'An age band must end above its lower bound.';
		return true;
	})
);

export type RateSelector = Schema.Schema.Type<typeof rateSelectorValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const rateSelectorSchema = Schema.toStandardSchemaV1(rateSelectorValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'rate_selector',
	description:
		'Which row of a statutory contribution table a rate applies to, keyed by wage, wage and age, wage and marital category, headcount, or risk class.',
	schema: rateSelectorSchema
});
