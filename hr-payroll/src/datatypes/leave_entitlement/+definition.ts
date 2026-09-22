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
	/**
	 * `CREDITED` grants nothing by rule: the balance is only what adjustment entries credit and
	 * what time off debits (a day off in lieu of a public holiday worked), so the meter starts at
	 * zero in every window.
	 */
	availability: Schema.Literals(['UPFRONT', 'MONTHLY', 'UNLIMITED', 'PER_EVENT', 'CREDITED']),
	year_start_month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
	/**
	 * `HALF_MONTHS`: a calendar month counts as one once at least half its days are eligible (VN
	 * Decree 145/2020 art.66(2): a part month worked or paid for half its working days is a month).
	 */
	proration: Schema.Literals([
		'NONE',
		'CALENDAR_MONTHS',
		'COMPLETED_MONTHS',
		'HALF_MONTHS',
		'CALENDAR_DAYS'
	]),
	/** The most PER_EVENT entries of this leave an employee may take in a lifetime; absent is no cap. */
	lifetime_events: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
	/**
	 * The most days of this leave a person may ever take, across leave years and across their
	 * employments here, as a number or an expression over the person (SG GPCL: 42 days for each
	 * child, `42.0 * children.count`). Absent is no cap.
	 */
	/**
	 * Of a row that `consumes_code` another, the days a leave year that stay outside the pool:
	 * only days beyond them draw from it (TW 性別平等工作法 §14: three menstrual days a year
	 * outside the sick-leave quota, the rest counted into it). Absent is every day.
	 */
	consumes_after_days: Schema.optionalKey(
		Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))
	),
	lifetime_days: Schema.optionalKey(
		Schema.NullOr(Schema.Union([Schema.Finite.check(Schema.isGreaterThan(0)), Schema.String]))
	),
	/**
	 * Lifetime caps each recorded child holds, instead of one for the person: every day of the leave
	 * is placed on one child's cap whose predicate holds on the first or last day of the day's leave
	 * year, and the days must fit. Predicate and days are read over the person as if that child were
	 * their only one (SG CDCA s.12B(2)(a): 42 days of childcare leave and 12 of extended childcare
	 * leave for any qualifying child; s.12D(2)(a): 24 of infant care leave). Absent is no such cap.
	 */
	child_lifetime: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					eligibility: Schema.String,
					days: Schema.Union([Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), Schema.String])
				})
			)
		)
	),
	/**
	 * A window measured back from the day rather than a leave year: the `days` may be taken in any
	 * such span (TW hospitalised sickness: one year within two, `24`). Absent is the leave year.
	 */
	rolling_months: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
	/**
	 * How a prorated grant rounds: to the half day (the default), to the whole day with a half
	 * or more rounding up (MY EA s.60E(1); SG EA s.88A(3)), or not at all (PH SIL: the DOLE
	 * Handbook converts 2/12 × 5 = 0.833 days).
	 */
	rounding: Schema.optionalKey(Schema.NullOr(Schema.Literals(['HALF_DAY', 'WHOLE_DAY', 'EXACT']))),
	/**
	 * The fewest days a prorated grant rounds to, however short the service in the leave year (SG
	 * CDCA s.12B(1)(i): 2 days for less than 5 months served in the relevant period). Absent is none.
	 */
	minimum_days: Schema.optionalKey(
		Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))
	),
	/**
	 * The leave year is qualified as a whole: once eligible on a day of it, eligible for the rest
	 * of it, and the grant is the whole year's — its service counted from the year's first day and
	 * its bands read on its first and last days of service (SG CDCA s.12B(1)(b), s.12D(1)(b): a
	 * child below 7 — or 2 — "at any time during any relevant period"). Absent is day by day.
	 */
	qualifies_window: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * Of a row off-boarding pays out (`encash_on_exit`), the CEL predicate over the leaver on the
	 * last day, departure facts included, that must hold for the pay-out: MY EA s.60E(3A) and SG EA
	 * s.88A(8) withhold it on a dismissal for misconduct. Absent or empty is every leaver.
	 */
	encash_on_exit_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * A number over the person the matched band's days are multiplied by, before any proration
	 * and rounding: a part-timer's share of the full-time grant by contracted hours (SG Part-Time
	 * Employees Regulations; TW 僱用部分時間工作勞工應行注意事項). Absent or empty is the whole grant.
	 */
	scale: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
