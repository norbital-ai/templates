import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Which band of a statutory contribution table a rate row applies to.
 * The discriminator is what keys the scheme's ladder; a scheme's bands say what it is keyed by.
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

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const rateSelectorSchema = Schema.toStandardSchemaV1(rateSelectorValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'rate_selector',
	description:
		'Which row of a statutory contribution table a rate applies to, keyed by wage, wage and age, headcount, or risk class. A scale published per marital category is two bands with an eligibility predicate each.',
	schema: rateSelectorSchema
});
