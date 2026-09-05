import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/** Carry-forward policy. Null is the default: nothing carries. Reconciliation posts any carry as a new-year ledger entry. */
export const leaveCarryValueSchema = Schema.Struct({
	limit_days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	expiry_months: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
});

export type LeaveCarry = Schema.Schema.Type<typeof leaveCarryValueSchema>;

/**
 * How entitlement for a leave type comes into existence.
 * - `MONTHLY`   — pro-rata each completed month of the leave year.
 * - `UPFRONT`   — the whole band granted at the start of the leave year.
 * - `UNLIMITED` — requests still require a yearly account, but no balance ceiling applies.
 */
export const leaveAccrualValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('MONTHLY'), carry: Schema.NullOr(leaveCarryValueSchema) }),
	Schema.Struct({ kind: Schema.Literal('UPFRONT'), carry: Schema.NullOr(leaveCarryValueSchema) }),
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
		'How a yearly leave account earns days — monthly, upfront, or unmetered — plus an explicit carry rule. Null carry means no carry-forward.',
	schema: leaveAccrualSchema
});
