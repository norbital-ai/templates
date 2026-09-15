import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/** Exact settled Leave outputs, frozen so a later reversal negates them without repricing. */
export const leavePayItemSchema = Schema.Struct({
	catalogue_id: Schema.String.check(Schema.isUUID()),
	settings_id: Schema.String.check(Schema.isUUID()),
	code: Schema.NonEmptyString,
	bucket: Schema.Literals(['EARNING', 'ABSENCE']),
	date: Schema.NullOr(calendarDay),
	amount: Schema.Finite,
	quantity: Schema.NullOr(Schema.Finite),
	rate: Schema.NullOr(Schema.Finite)
});
export const leavePayItemsValueSchema = Schema.Array(leavePayItemSchema);
export type LeavePayItem = Schema.Schema.Type<typeof leavePayItemSchema>;

export default defineCustomType({
	name: 'leave_pay_items',
	description: 'Frozen Leave payment amounts. Reversals negate these outputs without repricing.',
	schema: Schema.toStandardSchemaV1(leavePayItemsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
