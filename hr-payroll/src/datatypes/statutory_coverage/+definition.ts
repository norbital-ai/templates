import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Whose statutory protection a coverage code names, as salary data — never as prose.
 *
 * Thresholds change (SG Part-IV today: workmen at basic ≤ $4,500, non-workmen ≤ $2,600), so they
 * live here, versioned with the profile that states them, instead of as an enum. Derivation
 * matches the first band whose ceiling and workman scope the employment satisfies; no band
 * matching means the employment carries no coverage code, and universal floors (a CARRY arm
 * with null coverage) still protect it.
 */
export const statutoryCoverageBandValueSchema = Schema.Struct({
	code: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]{1,63}$/)),
	max_monthly_basic: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
	workman_only: Schema.NullOr(Schema.Boolean),
	authority: Schema.NonEmptyString
});

export const statutoryCoverageValueSchema = Schema.Array(statutoryCoverageBandValueSchema).check(
	Schema.makeFilter((bands) =>
		new Set(bands.map((band) => band.code)).size === bands.length
			? true
			: 'Each statutory coverage code must be unique.'
	)
);

/** Strict standard view: a key the band does not declare is refused rather than stripped. */
export const statutoryCoverageSchema = Schema.toStandardSchemaV1(statutoryCoverageValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'statutory_coverage',
	description:
		'The salary-banded statutory coverage codes one law revision protects, with the ceilings and workman scope derivation matches employments against.',
	schema: statutoryCoverageSchema
});
