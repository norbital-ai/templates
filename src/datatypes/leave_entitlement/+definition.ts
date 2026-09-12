import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Availability and earning belong to the leave definition, never to a yearly account. The bands
 * are the entitlement matrix: rows of who and how many days, read top-down on the entitlement
 * date, the first predicate that holds being the grant; nobody matched is no days. MONTHLY with
 * NONE proration grants the stated days afresh each calendar month, without automatic carry.
 * MONTHLY with proration releases earned annual leave at month end. A service
 * tier is `employment.service_months >= 24`; a grade tier is `terms.grade == "M1"`.
 */
export const leaveEntitlementValueSchema = Schema.Struct({
	availability: Schema.Literals(['UPFRONT', 'MONTHLY', 'UNLIMITED']),
	year_start_month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
	proration: Schema.Literals(['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'CALENDAR_DAYS']),
	bands: Schema.Array(
		Schema.Struct({
			/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
			eligibility: Schema.String,
			days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
		})
	)
});
export type LeaveEntitlement = Schema.Schema.Type<typeof leaveEntitlementValueSchema>;
export const leaveEntitlementSchema = Schema.toStandardSchemaV1(leaveEntitlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_entitlement',
	description:
		'Computed annual leave: an entitlement matrix of who and how many days, availability and proration. Carry-forward and encashment are manually approved entries.',
	schema: leaveEntitlementSchema
});
