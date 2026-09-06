import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { leaveSettlementValueSchema } from '../leave_settlement/+definition.js';

/**
 * How entitlement for a leave type comes into existence, and what the leave year does with
 * what is left. `FORFEIT` is the default: nothing carries, nothing converts.
 * - `MONTHLY`   — pro-rata each completed month of the leave year.
 * - `UPFRONT`   — the whole band granted at the start of the leave year.
 * - `UNLIMITED` — requests still require a yearly account, but no balance ceiling applies.
 */
export const leaveAccrualValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('MONTHLY'), settlement: leaveSettlementValueSchema }),
	Schema.Struct({ kind: Schema.Literal('UPFRONT'), settlement: leaveSettlementValueSchema }),
	Schema.Struct({ kind: Schema.Literal('UNLIMITED') })
]);

export type LeaveAccrual = Schema.Schema.Type<typeof leaveAccrualValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const leaveAccrualSchema = Schema.toStandardSchemaV1(leaveAccrualValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_accrual',
	description:
		'How a yearly leave account earns days — monthly, upfront, or unmetered — plus what the leave year does with its unused balance. FORFEIT means nothing carries and nothing converts.',
	schema: leaveAccrualSchema
});
