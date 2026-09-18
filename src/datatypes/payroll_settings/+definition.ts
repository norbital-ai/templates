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
	 * Whether a standing allowance loses its unpaid-leave days. Joining or leaving inside the
	 * period prorates an allowance everywhere, like basic salary; a day of unpaid leave comes off
	 * it only where the jurisdiction says so — the Philippines does, Singapore, Malaysia, Taiwan,
	 * Indonesia and Vietnam do not.
	 */
	allowance_npl_prorates: Schema.Boolean,
	/**
	 * Days after the last day of work by which a leaver's final pay is due, where the statute
	 * states one (PH Labor Advisory 06-20: 30; ID PP 35/2021 art.15: 7; VN art.48: 14). A run
	 * whose pay date falls later warns. Absent is no rule.
	 */
	final_pay_due_days: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))))
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
