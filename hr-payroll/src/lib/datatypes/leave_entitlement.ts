import { Schema } from 'effect';

/**
 * Availability and earning belong to the leave definition, never to a yearly account. The bands
 * are the entitlement matrix: rows of who and how many days, read top-down on the entitlement
 * date, the first predicate that holds being the grant; nobody matched is no days. MONTHLY with
 * NONE proration grants the stated days afresh each calendar month, without automatic carry.
 * MONTHLY with proration releases earned annual leave at month end. A service
 * tier is `employment.service_months >= 24`; a grade tier is `terms.grade == "M1"`.
 */
/** A stored rounding step: the multiple a figure rounds to, and the direction. */
const stepRounding = Schema.Struct({
	step: Schema.Finite.check(Schema.isGreaterThan(0)),
	mode: Schema.Literals(['UP', 'DOWN', 'HALF_UP'])
});

/** One row of an entitlement matrix: who, and how many days. */
const entitlementBand = Schema.Struct({
	/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
	eligibility: Schema.String,
	/** The grant, or a number over the person: a seniority ladder with no top (VN art.114: `12.0 + round(employment.service_months / 60.0, 1, 'DOWN')`). */
	days: Schema.Union([Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), Schema.String])
});

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
	/** Make the full upfront grant available once eligible; earning remains prorated for cash-out. */
	upfront_full_grant: Schema.optionalKey(Schema.Boolean),
	year_start_month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
	/** A statutory service year starts on each anniversary of the employment hire date. */
	year_anchor: Schema.optionalKey(Schema.Literals(['CALENDAR', 'SERVICE_ANNIVERSARY'])),
	/** Carry unused current-year entitlement into the next leave year, expiring at its end. */
	auto_carry_one_year: Schema.optionalKey(Schema.Boolean),
	/**
	 * Of an `auto_carry_one_year` row, the most unused days that carry, as a number or an expression
	 * over the person on the source year's last day (a company cap an employee's terms may override:
	 * `"carry_days" in terms.fact_keys ? terms.facts.carry_days : 5.0`). Absent is every unused day.
	 */
	carry_max_days: Schema.optionalKey(
		Schema.NullOr(
			Schema.Union([Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), Schema.String])
		)
	),
	/**
	 * The statute's own grant matrix, read and prorated as `bands` are: that many of the source
	 * year's unused days carry in full, and `carry_max_days` caps only the days above them (MY EA
	 * s.60E(2): each year's statutory leave may be taken in the twelve months after it). Absent is
	 * none: `carry_max_days` caps every day.
	 */
	carry_statutory_bands: Schema.optionalKey(Schema.NullOr(Schema.Array(entitlementBand))),
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
	/** Fixed statutory divisor for CALENDAR_DAYS proration; absent uses the window length. */
	calendar_days_divisor: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
	/** The entitlement counts every calendar day, including rest days and holidays. */
	calendar_days: Schema.optionalKey(Schema.Boolean),
	/**
	 * Of a PER_EVENT row, the bands grant calendar months, not days: the leave must fall within
	 * that many months counted from the event's first leave day (`monthsEnd`), whatever days the
	 * roster charges inside them (VN Labour Code art.139(1): 06 tháng; Law 41/2024 art.53(9): the
	 * period includes holidays and weekly rest days). Absent is days.
	 */
	calendar_months: Schema.optionalKey(Schema.Boolean),
	/**
	 * Of a PER_EVENT row, a commencement date the law gives no transition rule for: one event whose
	 * charges fall on both sides of it is refused for transition review (TH Act No.9 B.E.2568, in
	 * force 7 December 2025, states no rule for maternity leave already in progress). Absent is none.
	 */
	transition_review_on: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
	/** Grant days beyond the funded shared pool as unpaid time off. */
	consumes_overflow_unpaid: Schema.optionalKey(Schema.Boolean),
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
	 * Each recorded child holds its own pool, renewed on each of its birthdays: the bands, read over
	 * the person as if that child were their only one on the first day of the child's year counted
	 * from its birth date, grant that child's days for that year, and every day of the leave is placed
	 * on the pool of a child whose year holds it (沪府规〔2022〕18号 art.3: 5 days a year for each
	 * child under three, "每年的育儿假从其子女出生之日起计算"; 上海市卫健委 口径 Q4: a child born
	 * 1 Dec 2021 has the year to 30 Nov 2022). The leave year keeps no pool. Absent is the leave year.
	 */
	child_years: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/** Of a `child_years` row, who it holds for, over the person on the leave day; absent is everyone. */
	child_years_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * A window measured back from the day rather than a leave year: the `days` may be taken in any
	 * such span (TW hospitalised sickness: one year within two, `24`). Absent is the leave year.
	 */
	rolling_months: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
	/**
	 * The most days of this leave charged in any calendar week, Monday to Sunday, whatever else
	 * grants them (TW 勞基法 §16(2): job-search leave 每星期不得超過二日之工作時間, `2`). Absent is no cap.
	 */
	weekly_days: Schema.optionalKey(Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0)))),
	/**
	 * How a prorated grant rounds: to the half day (the default), to the whole day with a half
	 * or more rounding up (MY EA s.60E(1); SG EA s.88A(3)), or not at all (PH SIL: the DOLE
	 * Handbook converts 2/12 × 5 = 0.833 days), or down to the whole day (CN 企业职工带薪年休假实施办法
	 * arts.5, 12: 折算后不足1整天的部分不…).
	 */
	rounding: Schema.optionalKey(
		Schema.NullOr(Schema.Literals(['HALF_DAY', 'WHOLE_DAY', 'WHOLE_DAY_DOWN', 'EXACT']))
	),
	/**
	 * How a grant the `scale` moved rounds, in days: `{ step: 0.5, mode: 'UP' }` is up to the half
	 * day, never below the hours owed. Absent is the exact figure.
	 */
	scaled_rounding: Schema.optionalKey(Schema.NullOr(stepRounding)),
	/** How an hourly grant (`requires_hourly_for_part_time`) rounds, in hours. Absent is exact. */
	hour_rounding: Schema.optionalKey(Schema.NullOr(stepRounding)),
	/**
	 * Of a `requires_hourly_for_part_time` row, the weekly hours below which the contract is
	 * part-time (SG Part-Time Employees Regulations reg.2(1): `35`), and the daily and weekly hours
	 * a declared ABSENT similar full-time employee is deemed to work (reg.2(2): `8` and `44`). A
	 * declared comparator must itself work at least `part_time_below_hours`. Required by that flag.
	 */
	part_time_hours: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				part_time_below_hours: Schema.Finite.check(Schema.isGreaterThan(0)),
				comparator_weekly_hours: Schema.Finite.check(Schema.isGreaterThan(0)),
				comparator_daily_hours: Schema.Finite.check(Schema.isGreaterThan(0))
			})
		)
	),
	/**
	 * Of a `HALF_MONTHS` proration, the share of a calendar month's days that must be eligible for
	 * the month to count (VN Decree 145/2020 art.66(2): `0.5`). Required by that proration.
	 */
	month_counts_when: Schema.optionalKey(
		Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })))
	),
	/**
	 * Of a `HALF_MONTHS` proration, the days `month_counts_when` is a share of: the month's calendar
	 * days (absent) or its normal working days on the roster (VN Decree 145/2020 art.66(2)).
	 */
	month_share_basis: Schema.optionalKey(
		Schema.NullOr(Schema.Literals(['CALENDAR_DAYS', 'NORMAL_WORKING_DAYS']))
	),
	/**
	 * Of an hourly row (`unit: HOUR`), the step the share of the shift's paid hours rounds to,
	 * half up, and the least share an hour charges (`0.125`: an hour of an eight-hour day). Absent
	 * is the exact share.
	 */
	hour_share_step: Schema.optionalKey(
		Schema.NullOr(
			Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).check(
				Schema.isGreaterThan(0)
			)
		)
	),
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
	/** Exit pay-out predicate for leave carried from an earlier leave year; absent uses the ordinary predicate. */
	encash_carry_on_exit_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * A number over the person the matched band's days are multiplied by, before any proration
	 * and rounding: a part-timer's share of the full-time grant by contracted hours (SG Part-Time
	 * Employees Regulations; TW 僱用部分時間工作勞工應行注意事項). Absent or empty is the whole grant.
	 */
	scale: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** Refuse part-time grants until this hourly entitlement can be balanced and paid in hours. */
	requires_hourly_for_part_time: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/** Paid outpatient leave excludes a classified shift allowance from its gross-pay basis. */
	outpatient_sick_excludes_shift_allowance: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/** A dated event grant whose payment needs the wife's prior living biological child count. */
	requires_wife_prior_living_biological_children: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * Service counted for this leave leaves out approved whole days of no-pay leave the employee
	 * asked for (`no_pay_origin: EMPLOYEE_REQUESTED`): every other no-pay origin, a part day, or a
	 * later window the exclusion would shift is refused for assessment. Absent is gross service.
	 */
	service_excludes_no_pay: Schema.optionalKey(
		Schema.NullOr(Schema.Literal('EMPLOYEE_REQUESTED_FULL_DAYS'))
	),
	/** A full-day requested no-pay approval re-plans this leave's balances against the shorter service. */
	replans_on_no_pay: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * Attendance decides this grant: a work-day plan, attendance or absence decision cannot change
	 * once leave in its leave year or carry year was approved or paid.
	 */
	locks_attendance_after_use: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * The year's grant, and its carry, is forfeited once unexcused whole-day absences (a day's
	 * `absence_permission` and `absence_reasonable_excuse` both `NO`) exceed this share of the
	 * year's working days. Absent is no forfeiture.
	 */
	forfeit_above_absence_share: Schema.optionalKey(
		Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })))
	),
	bands: Schema.Array(entitlementBand)
});
export type LeaveEntitlement = Schema.Schema.Type<typeof leaveEntitlementValueSchema>;
export const leaveEntitlementSchema = Schema.toStandardSchemaV1(leaveEntitlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = leaveEntitlementSchema;
