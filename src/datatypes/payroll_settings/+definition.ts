import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The payroll facts of one jurisdiction settings version: the currency wages are
 * stated in, the IANA zone the jurisdiction's wall clock sits at, the month its tax year opens and
 * whether unpaid leave prorates a standing allowance.
 */
export const payrollSettingsValueSchema = Schema.Struct({
	currency: Schema.String.check(Schema.isMinLength(1)),
	/**
	 * The IANA zone the jurisdiction's wall clock sits at. A shift start is a wall-clock time and a
	 * punch is a UTC instant, so pricing overtime needs the offset the zone was actually at on the
	 * date — `offsetMinutesFor` derives it, so a daylight-saving jurisdiction needs no second column.
	 */
	timezone: Schema.String.check(Schema.isMinLength(1)),
	tax_year_start_month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
	/**
	 * The version's default for whether a standing allowance loses its unpaid-leave days; an
	 * allowance class overrules it with `allowance_catalogue.npl_prorates`. Joining or leaving
	 * inside the period prorates an allowance everywhere, like basic salary, and the deduction for
	 * an unpaid day is computed on the wage including the fixed allowances — except the classes a
	 * statute keeps out of that wage (SG's travel, food and housing allowances, EA s.2; MY's
	 * travelling allowance), which state false on the class.
	 */
	allowance_npl_prorates: Schema.Boolean,
	/**
	 * Configured days after the last day of work for the final-pay warning. Coverage, departure
	 * reason and statutory exceptions require separate verification. Absent is no configured rule.
	 */
	final_pay_due_days: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
	/**
	 * The final-pay deadlines the law states per circumstance, each with its authority. The
	 * calculation flags a run that pays an employment after the applicable deadline it can select;
	 * a rule whose predicate names facts the version does not declare stops selection rather than
	 * guessing.
	 */
	final_pay_deadlines: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					/** CEL over the person on the final service day; empty is every leaver (the default deadline). */
					when: Schema.String,
					days: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
					/**
					 * What `days` counts from: the last day, the end of its month, the next payday — or
					 * `WORKING_DAYS`, the leaver's own working days after the last day on their pattern,
					 * less the published holidays (VN Labour Code art.48(1): 14 working days).
					 */
					basis: Schema.Literals(['EVENT_DATE', 'MONTH_END', 'NEXT_PAYDAY', 'WORKING_DAYS']),
					authority: Schema.String.check(Schema.isMinLength(1))
				})
			)
		)
	),
	/**
	 * The most the employer may deduct from a payslip's pay, where the law caps it (MY EA s.24(8),
	 * SG EA s.32, ID PP 36/2021 art.65, VN Labour Code art.102(3)). The run drops whole loan
	 * recoveries past it — they stay outstanding — and refuses a payslip whose other deductions
	 * still exceed it. Absent or null is no ceiling.
	 */
	deduction_ceiling: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				/** The share of the base the counted deductions may reach: `0.5` is half. */
				share: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
				/** The pay the share is taken of: gross pay, or gross less the employee's statutory charges. */
				basis: Schema.Literals(['GROSS', 'NET_OF_STATUTORY']),
				/** Whether the employee's statutory charges count toward the ceiling (SG CPF, s.27(1)(h)). */
				counts_statutory: Schema.Boolean,
				/** Whether loan and advance recoveries count toward it (SG s.32 exempts s.27(1)(f)). */
				counts_loans: Schema.Boolean,
				/** Catalogue codes of deduction lines the ceiling does not reach. */
				exempt_codes: Schema.Array(Schema.String),
				/** Whether the whole final payslip is outside the ceiling (SG s.32(2)). */
				final_pay_exempt: Schema.Boolean,
				/**
				 * Whether loan and advance recoveries — amounts due to the employer — taken from the final
				 * payslip are outside the ceiling while its other deductions stay counted (MY s.24(9)(b)).
				 */
				final_pay_exempts_loans: Schema.optionalKey(Schema.Boolean),
				authority: Schema.String.check(Schema.isMinLength(1))
			})
		)
	),
	/**
	 * The exit clearance this jurisdiction requires before final money may be released, where any.
	 * The predicate names the person on the final service day; a match raises an open
	 * disbursement hold that blocks settlement until HR records the releasing directive.
	 */
	tax_clearance: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				when: Schema.String.check(Schema.isMinLength(1)),
				category: Schema.Literals([
					'TAX_CLEARANCE',
					'COURT_ORDER',
					'AGENCY_DIRECTION',
					'EMPLOYEE_DISPUTE',
					'OTHER'
				]),
				/** The authority's form or process, recorded as the pending hold's reference. */
				reference_label: Schema.String.check(Schema.isMinLength(1)),
				authority: Schema.String.check(Schema.isMinLength(1))
			})
		)
	),
	/**
	 * A public holiday enclosed by no-pay leave the employee asked for is itself unpaid (SG EA
	 * s.88(2)): the leave entry charges the holiday too, and payroll deducts it as a day. Absent
	 * or false is the holiday paid whatever surrounds it.
	 */
	holiday_in_no_pay_leave_unpaid: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * A special non-working day the daily- or hourly-paid did not work earns nothing ("no work, no
	 * pay": PH Labor Code, DOLE Handbook ch.3 §C). Absent or false is the rostered day paid.
	 */
	special_holiday_unworked_unpaid: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * An unworked regular holiday is paid to the daily- or hourly-paid only where they were present,
	 * or on leave with pay, on the workday immediately preceding it — a rest or non-work day in
	 * between looks further back, and an unworked holiday before it passes the test to the day
	 * before that (PH Handbook ch.2 §D–E). Absent or false is the holiday paid regardless.
	 */
	regular_holiday_prior_workday: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * A contracted day of at most this many hours counts as half a working day in the part-month
	 * count (SG EA s.20A(2): five hours or less); absent or null is no half days.
	 */
	short_day_half_hours: Schema.optionalKey(
		Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0)))
	)
});

export type PayrollSettings = Schema.Schema.Type<typeof payrollSettingsValueSchema>;

export default defineCustomType({
	name: 'payroll_settings',
	description:
		'The payroll facts of one jurisdiction settings version: its currency, its IANA timezone, the month its tax year opens and whether unpaid leave prorates a standing allowance.',
	schema: Schema.toStandardSchemaV1(payrollSettingsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
