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
	/**
	 * `PER_EVENT` is a grant per occurrence rather than per year: every entry is its own pool of
	 * `days`, read against the person and the entry's `event.*`, and `lifetime_events` caps how
	 * many such entries an employee may ever take (PH paternity: the first four deliveries; MY:
	 * five confinements).
	 */
	availability: Schema.Literals(['UPFRONT', 'MONTHLY', 'UNLIMITED', 'PER_EVENT']),
	year_start_month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
	proration: Schema.Literals(['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'CALENDAR_DAYS']),
	/** The most PER_EVENT entries of this leave an employee may take in a lifetime; absent is no cap. */
	lifetime_events: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
	/**
	 * A window measured back from the day rather than a leave year: the `days` may be taken in any
	 * such span (TW hospitalised sickness: one year within two, `24`). Absent is the leave year.
	 */
	rolling_months: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
	bands: Schema.Array(
		Schema.Struct({
			/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
			eligibility: Schema.String,
			/** The grant, or a number over the person: a seniority ladder with no top (VN art.114: `12.0 + floor_unit(employment.service_months / 60.0)`). */
			days: Schema.Union([Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), Schema.String])
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
