import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * One eligibility predicate. `SERVICE_MONTHS.to` is an exclusive upper bound;
 * `null` means "no upper bound".
 *
 * Every `in` list keeps its minimum length of one: an empty list is not "matches everything", it is
 * a predicate that can never match, and a rule that can never match silently disqualifies everyone.
 * An empty *rules* list is the way to mean everyone, which is why only the members are bounded.
 */
export const eligibilityRuleSchema = Schema.Union([
	Schema.Struct({
		field: Schema.Literal('EMPLOYMENT_TYPE'),
		in: Schema.Array(
			Schema.Literals(['PERMANENT', 'CONTRACT', 'PROBATION', 'INTERN', 'CONSULTANT'])
		).check(Schema.isMinLength(1))
	}),
	Schema.Struct({
		field: Schema.Literal('WORK_CLASSIFICATION'),
		in: Schema.Array(Schema.Literals(['EA_COVERED', 'NON_EA', 'MANAGERIAL'])).check(
			Schema.isMinLength(1)
		)
	}),
	Schema.Struct({
		field: Schema.Literal('SERVICE_MONTHS'),
		from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		to: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	Schema.Struct({
		field: Schema.Literal('GENDER'),
		in: Schema.Array(Schema.Literals(['MALE', 'FEMALE'])).check(Schema.isMinLength(1))
	}),
	Schema.Struct({
		field: Schema.Literal('DEPARTMENT'),
		in: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1))
	}),
	Schema.Struct({
		field: Schema.Literal('PAYROLL_GROUP'),
		in: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1))
	})
]);

export type EligibilityRule = typeof eligibilityRuleSchema.Type;

/** ALL rules must match. An empty list means everyone is eligible. */
export const eligibilityRulesValueSchema = Schema.Array(eligibilityRuleSchema);
export type EligibilityRules = Schema.Schema.Type<typeof eligibilityRulesValueSchema>;

/** Strict standard view: a key no rule declares is refused rather than stripped. */
export const eligibilityRulesSchema = Schema.toStandardSchemaV1(eligibilityRulesValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'eligibility_rules',
	description:
		'Conditions on employment type, work classification, months of service, gender, department or payroll group that must all match for an employee to qualify; an empty list qualifies everyone.',
	schema: eligibilityRulesSchema
});
