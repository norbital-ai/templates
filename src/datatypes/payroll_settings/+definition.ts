import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The payroll facts of one jurisdiction settings version (RFC 0001 §4): the currency wages are
 * stated in, the IANA zone the jurisdiction's wall clock sits at, and the month its tax year opens.
 */
export const payrollSettingsValueSchema = Schema.Struct({
	currency: Schema.String.check(Schema.isMinLength(1)),
	/**
	 * The IANA zone the jurisdiction's wall clock sits at. A shift start is a wall-clock time and a
	 * punch is a UTC instant, so pricing overtime needs the offset the zone was actually at on the
	 * date — `offsetMinutesFor` derives it, so a daylight-saving jurisdiction needs no second column.
	 */
	timezone: Schema.String.check(Schema.isMinLength(1)),
	tax_year_start_month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))
});

export type PayrollSettings = Schema.Schema.Type<typeof payrollSettingsValueSchema>;

export default defineCustomType({
	name: 'payroll_settings',
	description:
		'The payroll facts of one jurisdiction settings version: its currency, its IANA timezone and the month its tax year opens.',
	schema: Schema.toStandardSchemaV1(payrollSettingsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
