import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';
import { leaveWindowSchema } from '../../lib/leave/entitlement.js';

/** Immutable approval evidence: positive quantities create credits, negatives consume them. */
export const leaveAllocationSchema = Schema.Struct({
	window: leaveWindowSchema,
	date: calendarDay,
	days: Schema.Finite.check(
		Schema.makeFilter((value: number) => value !== 0 || 'must allocate a non-zero quantity')
	),
	/** Null is computed entitlement; otherwise the manual entry that supplied the credit. */
	credit_entry_id: Schema.NullOr(Schema.String.check(Schema.isUUID())),
	/**
	 * The leave code of the pool this allocation draws from where it is not the entry's own row:
	 * an outpatient day that also counts inside hospitalisation leave carries a second allocation
	 * against `HOSPITALISATION`. Absent is the entry's own pool.
	 */
	pool: Schema.optionalKey(Schema.NullOr(Schema.String))
});
export const leaveAllocationsValueSchema = Schema.Array(leaveAllocationSchema);
export type LeaveAllocation = Schema.Schema.Type<typeof leaveAllocationSchema>;
export default defineCustomType({
	name: 'leave_allocations',
	description:
		'Approved leave quantities assigned to annual windows and their original credits. Expiry and reversals preserve these allocations.',
	schema: Schema.toStandardSchemaV1(leaveAllocationsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
