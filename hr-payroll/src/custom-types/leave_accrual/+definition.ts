import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/** Carry-forward policy. Carry-forward and expiry are DERIVED at read time — never a job. */
export const leaveCarryValueSchema = Schema.Struct({
	limit_days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	expiry_months: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
});

export type LeaveCarry = Schema.Schema.Type<typeof leaveCarryValueSchema>;

/**
 * How entitlement for a leave type comes into existence.
 * - `MONTHLY`   — pro-rata each completed month of the leave year.
 * - `UPFRONT`   — the whole band granted at the start of the leave year.
 * - `PER_EVENT` — no balance at all (maternity, compassionate); granted per request.
 */
export const leaveAccrualValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('MONTHLY'), carry: Schema.NullOr(leaveCarryValueSchema) }),
	Schema.Struct({ kind: Schema.Literal('UPFRONT'), carry: Schema.NullOr(leaveCarryValueSchema) }),
	Schema.Struct({ kind: Schema.Literal('PER_EVENT') })
]);

export type LeaveAccrual = Schema.Schema.Type<typeof leaveAccrualValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const leaveAccrualSchema = Schema.toStandardSchemaV1(leaveAccrualValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_accrual',
	description:
		'How entitlement for a leave type comes into being — pro-rata each completed month, granted whole at the start of the leave year, or granted per event with no balance — plus any carry-forward limit and its expiry.',
	schema: leaveAccrualSchema
});
