import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { rateSelectorValueSchema } from '../rate_selector/+definition.js';
import { rateAwardValueSchema } from '../rate_award/+definition.js';
import { overtimeTreatmentScheduleValueSchema } from '../overtime_treatment_schedule/+definition.js';

export const statutoryContributionRevisionSchema = Schema.Struct({
	statutory_contribution_id: Schema.String.check(Schema.isUUID()),
	authority: Schema.NonEmptyString,
	special_rules: Schema.Array(Schema.String),
	overtime_treatments: overtimeTreatmentScheduleValueSchema,
	overtime_excess_treatments: overtimeTreatmentScheduleValueSchema,
	rates: Schema.Array(
		Schema.Struct({ selector: rateSelectorValueSchema, award: rateAwardValueSchema })
	).check(
		Schema.isMinLength(1),
		Schema.makeFilter((rates) => {
			const bounds = rates
				.map(({ selector }) => ({
					group: `${selector.by}:${selector.by === 'RISK_CLASS' ? selector.class : selector.by === 'WAGE_AND_MARITAL' ? selector.marital : ''}`,
					from: selector.by === 'RISK_CLASS' ? 0 : selector.from,
					to: selector.by === 'RISK_CLASS' ? Infinity : (selector.to ?? Infinity),
					ageFrom: selector.by === 'WAGE_AND_AGE' ? selector.age_from : 0,
					ageTo: selector.by === 'WAGE_AND_AGE' ? (selector.age_to ?? Infinity) : Infinity
				}))
				.sort((left, right) => left.group.localeCompare(right.group) || left.from - right.from);
			for (let index = 0; index < bounds.length; index += 1) {
				const left = bounds[index];
				for (let next = index + 1; next < bounds.length; next += 1) {
					const right = bounds[next];
					if (right.group !== left.group || right.from >= left.to) break;
					if (left.ageFrom < right.ageTo && right.ageFrom < left.ageTo)
						return 'Contribution revision rate bands must not overlap.';
				}
			}
			return true;
		})
	)
});

export const statutoryRevisionValueSchema = Schema.Struct({
	sources: Schema.Array(
		Schema.Struct({
			url: Schema.NonEmptyString,
			title: Schema.NonEmptyString,
			retrieved_at: Schema.NonEmptyString,
			sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
			excerpt: Schema.NonEmptyString
		})
	).check(Schema.isMinLength(1)),
	/** Complete cumulative overrides for stable contribution identities, preserving existing input FKs. */
	contributions: Schema.Array(statutoryContributionRevisionSchema).check(
		Schema.makeFilter(
			(rows) =>
				new Set(rows.map((row) => row.statutory_contribution_id)).size === rows.length ||
				'Contribution revisions must be unique.'
		)
	)
});

export default defineCustomType({
	name: 'statutory_revision',
	description:
		'Verified source evidence and cumulative contribution revisions enacted with one effective-dated law snapshot. Existing catalogue identities remain stable.',
	schema: Schema.toStandardSchemaV1(statutoryRevisionValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
