import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { rateAwardValueSchema } from '../rate_award/+definition.js';
import { rateSelectorValueSchema } from '../rate_selector/+definition.js';

/**
 * One rung of a scheme's ladder: the selector that picks it, the award it pays, and who it is
 * for. `eligibility` is a predicate over the person (absent or empty is everyone); a band whose
 * predicate does not hold is skipped before the wage ceiling is read, so one scheme can carry a
 * ladder per citizenship, marital category or residency year.
 */
export const contributionBandSchema = Schema.Struct({
	selector: rateSelectorValueSchema,
	award: rateAwardValueSchema,
	eligibility: Schema.optionalKey(Schema.String)
});

export type ContributionBand = Schema.Schema.Type<typeof contributionBandSchema>;

const overlaps = (
	from: number | null | undefined,
	to: number | null | undefined,
	otherFrom: number | null | undefined,
	otherTo: number | null | undefined
) => (from ?? 0) < (otherTo ?? Infinity) && (otherFrom ?? 0) < (to ?? Infinity);

/**
 * The band is the pair of ranges the selector keys on. Discriminator and risk class are equality
 * members (a WAGE row and a RISK_CLASS row are never the same cell); the wage range and the age
 * range are the two dimensions, so EPF/SOCSO/EIS may carry an `age_from 60` row over the same wage
 * bands. Two bands with different predicates are different ladders and never overlap. Successive
 * bands coexist because their selectors do not overlap.
 */
export const contributionBandsValueSchema = Schema.Array(contributionBandSchema).check(
	Schema.makeFilter((bands) => {
		for (const [index, left] of bands.entries())
			for (const right of bands.slice(index + 1)) {
				const a = left.selector;
				const b = right.selector;
				if (a.by !== b.by) continue;
				if ((left.eligibility ?? '').trim() !== (right.eligibility ?? '').trim()) continue;
				if (a.by === 'RISK_CLASS' || b.by === 'RISK_CLASS') {
					if (a.by === 'RISK_CLASS' && b.by === 'RISK_CLASS' && a.class === b.class)
						return `Two bands select risk class ${a.class}.`;
					continue;
				}
				const ageOverlap =
					a.by === 'WAGE_AND_AGE' && b.by === 'WAGE_AND_AGE'
						? overlaps(a.age_from, a.age_to, b.age_from, b.age_to)
						: true;
				if (ageOverlap && overlaps(a.from, a.to, b.from, b.to))
					return `Bands ${index + 1} and ${bands.indexOf(right) + 1} overlap.`;
			}
		return true;
	})
);

export default defineCustomType({
	name: 'contribution_bands',
	description:
		'The bands of one statutory contribution: each the selector that picks it (wage, wage and age, headcount or risk class), the award it pays and, optionally, who it is for. A floor is the first band, a ceiling the terminal one; no two bands of one predicate may overlap.',
	schema: Schema.toStandardSchemaV1(contributionBandsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
