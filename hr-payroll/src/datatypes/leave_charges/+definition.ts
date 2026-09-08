import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

const id = Schema.String.check(Schema.isUUID());
export const leaveChargeSchema = Schema.Struct({
	date: calendarDay,
	days: Schema.Literals([0.5, 1]),
	leave_catalogue_id: id,
	employment_term_id: id,
	calendar_id: id,
	shift_definition_id: id,
	work_day_id: Schema.NullOr(id)
});
export const leaveChargesValueSchema = Schema.Array(leaveChargeSchema);
export type LeaveCharge = Schema.Schema.Type<typeof leaveChargeSchema>;
export default defineCustomType({
	name: 'leave_charges',
	description:
		'Approved time-off charges by date, with the exact catalogue, schedule and calendar inputs. Payroll charges only dates in its own window.',
	schema: Schema.toStandardSchemaV1(leaveChargesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
