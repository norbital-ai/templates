import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/** Availability and earning belong to the leave definition, never to a yearly account. */
export const leaveEntitlementValueSchema = Schema.Struct({
	availability: Schema.Literals(['UPFRONT', 'MONTHLY', 'UNLIMITED']),
	year_start_month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
	proration: Schema.Literals(['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'CALENDAR_DAYS']),
	bands: Schema.Array(
		Schema.Struct({
			band_from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
		})
	)
}).check(
	Schema.makeFilter(
		(rule) =>
			new Set(rule.bands.map((band) => band.band_from)).size === rule.bands.length ||
			'Service band thresholds must be unique.'
	),
	Schema.makeFilter(
		(rule) =>
			rule.availability !== 'MONTHLY' ||
			rule.proration !== 'NONE' ||
			'Monthly release requires a monthly or daily earning basis.'
	)
);
export type LeaveEntitlement = Schema.Schema.Type<typeof leaveEntitlementValueSchema>;
export const leaveEntitlementSchema = Schema.toStandardSchemaV1(leaveEntitlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_entitlement',
	description:
		'Computed annual leave: service bands, availability and proration. Carry-forward and encashment are manually approved entries.',
	schema: leaveEntitlementSchema
});
