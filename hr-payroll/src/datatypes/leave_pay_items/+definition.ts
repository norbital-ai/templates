import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { statutoryOptInValueSchema } from '../work_rules/+definition.js';
import { calendarDay } from '../../lib/iso-day.js';

/** Exact settled Leave outputs, including the opt-ins required for a later reversal. */
export const leavePayItemSchema = Schema.Struct({
	catalogue_id: Schema.String.check(Schema.isUUID()),
	settings_id: Schema.String.check(Schema.isUUID()),
	code: Schema.NonEmptyString,
	is_statutory: Schema.Boolean,
	sequence: Schema.Int,
	bucket: Schema.Literals(['EARNING', 'ABSENCE']),
	statutory_opt_ins: Schema.Array(statutoryOptInValueSchema),
	date: Schema.NullOr(calendarDay),
	amount: Schema.Finite,
	quantity: Schema.NullOr(Schema.Finite),
	rate: Schema.NullOr(Schema.Finite)
});
export const leavePayItemsValueSchema = Schema.Array(leavePayItemSchema);
export type LeavePayItem = Schema.Schema.Type<typeof leavePayItemSchema>;

export default defineCustomType({
	name: 'leave_pay_items',
	description:
		'Frozen Leave payment amounts and statutory opt-ins. Reversals negate these outputs without repricing.',
	schema: Schema.toStandardSchemaV1(leavePayItemsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
