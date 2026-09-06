import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * What happens to an account's unused balance when the employment ends, and who says so.
 *
 * Separate from the year-end settlement because the statutes treat the two moments differently:
 * MY forfeits untaken annual leave at year end (s.60E(2)) yet pays it in lieu on termination
 * (s.60E(3)); SG guarantees a carry at year end and a pro-rated payout on exit. `pay_basis` is
 * the daily-rate divisor the statute states; `misconduct_forfeits` records the statutory exception
 * (SG, MY: dismissal for misconduct forfeits the payout), which the reconciler applies from the
 * employment's `exit_reason`.
 */
export const leaveExitSettlementValueSchema = Schema.Union([
	Schema.Struct({ exit: Schema.Literal('FORFEIT') }),
	Schema.Struct({
		exit: Schema.Literal('PAY_OUT'),
		pay_basis: Schema.Literals(['ORDINARY_DIV26', 'MONTHLY_DIV30', 'DAILY_WAGE']),
		misconduct_forfeits: Schema.Boolean
	})
]);
export type LeaveExitSettlement = Schema.Schema.Type<typeof leaveExitSettlementValueSchema>;

export const leaveExitSettlementSchema = Schema.toStandardSchemaV1(leaveExitSettlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_exit_settlement',
	description:
		'What an account does with its unused balance when the employment ends: lapse, or pay out on the stated daily-rate basis, with the misconduct exception the statute names.',
	schema: leaveExitSettlementSchema
});
