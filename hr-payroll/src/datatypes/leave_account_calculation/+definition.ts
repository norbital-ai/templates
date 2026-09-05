import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

export const leaveAccountCalculationValueSchema = Schema.Struct({
	calculated_on: Schema.String,
	service_months: Schema.Int,
	statutory_days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	company_days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	selected_days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	statutory_cohort_date: Schema.optional(Schema.String),
	allocation_unit: Schema.optional(Schema.Literals(['DAYS', 'WEEKS'])),
	allocation_units: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
	weekly_index: Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0)))),
	formula_version: Schema.Literal('LEAVE_ACCOUNT_V1')
});

export default defineCustomType({
	name: 'leave_account_calculation',
	description:
		'The sealed calculation receipt for a leave account: inputs reduced to the statutory floor, company award, selected target and formula version.',
	schema: Schema.toStandardSchemaV1(leaveAccountCalculationValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
