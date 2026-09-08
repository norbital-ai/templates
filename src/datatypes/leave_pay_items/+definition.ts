import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentsValueSchema } from '../contribution_treatments/+definition.js';
import { calendarDay } from '../../lib/iso-day.js';

/** Exact settled Leave outputs, including the treatments required for a later reversal. */
export const leavePayItemSchema = Schema.Struct({
	catalogue_id: Schema.String.check(Schema.isUUID()),
	settings_id: Schema.String.check(Schema.isUUID()),
	code: Schema.NonEmptyString,
	is_statutory: Schema.Boolean,
	sequence: Schema.Int,
	nature: Schema.Literals(['EARNING', 'ABSENCE']),
	contribution_treatments: contributionTreatmentsValueSchema,
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
		'Frozen Leave payment amounts and contribution treatments. Reversals negate these outputs without repricing.',
	schema: Schema.toStandardSchemaV1(leavePayItemsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
