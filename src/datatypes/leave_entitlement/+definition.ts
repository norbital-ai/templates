import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * `Finite` rather than `Number` for `days`: `Number` admits `NaN` and `Infinity`, and the
 * `z.number()` this replaced admitted neither. A `NaN` entitlement propagates through every merge
 * and comparison as `NaN` without ever failing, so the leave balance silently becomes unprintable.
 *
 * `band_from` sits on the layer itself: the band applies from that many completed months of
 * service upward, until a higher band takes over. A flat entitlement is `band_from: 0`.
 */
const award = {
	band_from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
} as const;

/**
 * The company's own policy layers. The STATUTORY arm this union once carried moved into the
 * statutory profile's `statutory_leave` member — the floor is law, versioned and sealed with the
 * profile revision that states it, not hand-typed per company.
 */
export const leaveEntitlementLayerSchema = Schema.Union([
	Schema.Struct({ level: Schema.Literal('ORGANISATION'), ...award }),
	Schema.Struct({
		level: Schema.Literal('EMPLOYEE'),
		employment_id: Schema.String.check(Schema.isUUID()),
		...award
	})
]);

export const leaveEntitlementValueSchema = Schema.Struct({
	layers: Schema.Array(leaveEntitlementLayerSchema)
});

/** Strict standard view: a key no layer declares is refused rather than stripped. */
export const leaveEntitlementSchema = Schema.toStandardSchemaV1(leaveEntitlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_entitlement',
	description:
		'The organisation and per-employee leave layers for one leave type, each with its service band, merged by taking the most generous layer above the statutory floor the linked statutory profile states.',
	schema: leaveEntitlementSchema
});
