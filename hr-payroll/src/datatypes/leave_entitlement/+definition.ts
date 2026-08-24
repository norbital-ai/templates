import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { accrualKeyValueSchema } from '../accrual_key/+definition.js';
import { instantRangeValueSchema } from '@norbital-ai/bolt/authoring';

/**
 * `Finite` rather than `Number` for `days`: `Number` admits `NaN` and `Infinity`, and the
 * `z.number()` this replaced admitted neither. A `NaN` entitlement propagates through every merge
 * and comparison as `NaN` without ever failing, so the leave balance silently becomes unprintable.
 */
const award = {
	key: accrualKeyValueSchema,
	days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	authority: Schema.NonEmptyString,
	effective_range: instantRangeValueSchema
} as const;

/** One closed policy layer. A row can never accidentally be statutory and individual at once. */
export const leaveEntitlementLayerSchema = Schema.Union([
	Schema.Struct({ level: Schema.Literal('STATUTORY'), ...award }),
	Schema.Struct({ level: Schema.Literal('ORGANISATION'), ...award }),
	Schema.Struct({
		level: Schema.Literal('EMPLOYEE'),
		employment_id: Schema.String.check(Schema.isUUID()),
		...award
	})
]);

export const leaveEntitlementValueSchema = Schema.Struct({
	merge: Schema.Literal('MAX_WITH_STATUTORY_FLOOR'),
	layers: Schema.Array(leaveEntitlementLayerSchema)
});

export type LeaveEntitlement = Schema.Schema.Type<typeof leaveEntitlementValueSchema>;

/** Strict standard view: a key no layer declares is refused rather than stripped. */
export const leaveEntitlementSchema = Schema.toStandardSchemaV1(leaveEntitlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_entitlement',
	description:
		'The statutory, organisation and per-employee layers of leave days for one leave type, each with its authority and effective range, merged by taking the most generous layer above the statutory floor.',
	schema: leaveEntitlementSchema
});
