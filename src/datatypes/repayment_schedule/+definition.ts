import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/** One loan has one schedule containing N independently editable repayment instalments. */
export const repaymentScheduleEntryValueSchema = Schema.Struct({
	due_date: calendarDay,
	amount: Schema.Finite.check(Schema.isGreaterThan(0))
});

export type RepaymentScheduleEntry = Schema.Schema.Type<typeof repaymentScheduleEntryValueSchema>;

export const repaymentScheduleValueSchema = Schema.Array(repaymentScheduleEntryValueSchema).check(
	Schema.isMinLength(1),
	Schema.isMaxLength(600)
);

export type RepaymentSchedule = Schema.Schema.Type<typeof repaymentScheduleValueSchema>;

/** Strict standard view: a key an instalment does not declare is refused rather than stripped. */
export const repaymentScheduleSchema = Schema.toStandardSchemaV1(repaymentScheduleValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'repayment_schedule',
	description:
		'The dated instalments a staff loan is recovered by, each with its due date and amount, in the order payroll will deduct them.',
	schema: repaymentScheduleSchema
});
