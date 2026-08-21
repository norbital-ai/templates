import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * What a matched contribution band awards.
 *
 * `PERCENT.employee` / `PERCENT.employer` and `PROGRESSIVE.rate` are PERCENTAGE NUMBERS, not
 * fractions: 11 means 11%. That is how a statute states a rate, so a rate can be read off a
 * gazette and typed in. The engine divides by 100 in exactly one place — `asFraction()` in
 * `collections/payroll_runs/lib/contribute.ts`.
 *
 * `PROGRESSIVE` is `constant + (base − band_from) × rate / 100`, where `constant` is the
 * CUMULATIVE tax at the band's lower bound; it is the ONLY value in the whole schema — besides
 * a leave event's signed `movement_days` — that is allowed to be negative.
 */
export const rateAwardValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('PERCENT'),
		employee: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		employer: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
	}),
	Schema.Struct({
		kind: Schema.Literal('FIXED'),
		employee: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		employer: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
	}),
	Schema.Struct({
		kind: Schema.Literal('PROGRESSIVE'),
		rate: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
		constant: Schema.Finite
	})
]);

export type RateAward = Schema.Schema.Type<typeof rateAwardValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const rateAwardSchema = Schema.toStandardSchemaV1(rateAwardValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'rate_award',
	description:
		'What a matched contribution band charges: employee and employer percentages, fixed employee and employer amounts, or a progressive step of the cumulative tax at the band floor plus a rate on the wage above it.',
	schema: rateAwardSchema
});
