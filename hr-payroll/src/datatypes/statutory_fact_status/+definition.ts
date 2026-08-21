import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Whether an employment is registered for a statutory contribution.
 * `rate_override` replaces a percentage award (e.g. voluntary EPF), or replaces a progressive
 * scheme with a flat award on current remuneration (e.g. non-resident PCB); `null` = use the band.
 */
export const statutoryFactStatusValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('REGISTERED'),
		reference_number: Schema.String.check(Schema.isMinLength(1)),
		rate_override: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	Schema.Struct({
		kind: Schema.Literal('NOT_REGISTERED'),
		reason: Schema.String.check(Schema.isMinLength(1))
	})
]);

export type StatutoryFactStatus = Schema.Schema.Type<typeof statutoryFactStatusValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const statutoryFactStatusSchema = Schema.toStandardSchemaV1(statutoryFactStatusValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'statutory_fact_status',
	description:
		'Whether an employment is registered with a statutory scheme and under which reference number, with an optional rate that replaces the band’s own, or the stated reason it is not registered.',
	schema: statutoryFactStatusSchema
});
