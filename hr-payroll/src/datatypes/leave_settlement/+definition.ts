import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * What happens to a leave year's unused balance, and who says so.
 *
 * One union — not a `carry` struct plus an `encash` boolean plus special cases — because the
 * statutes mandate whole behaviors, and they differ by country:
 *
 * - `FORFEIT` — untaken days lapse (MY s.60E(2) after its 12-month window; the default).
 * - `CARRY`   — days move to the next leave year under a cap and an expiry window. `limit_days`
 *               null carries the whole balance (SG Part-IV staff: the statute guarantees the
 *               carry, so no company cap may clip it); `expiry_months` 0 never expires.
 *               `coverage` null applies to every covered employee, otherwise names the
 *               `statutory_coverage` codes the floor protects (e.g. SG_PART_IV) — company
 *               policy rows always leave it null.
 * - `COMMUTE` — untaken days convert to cash at year end instead of lapsing or moving
 *               (PH SIL Art.95, TW special leave). `pay_basis` is the daily-rate divisor the
 *               statute states, because MY ÷26, TW ÷30 and PH daily-rate are genuinely different.
 */
export const leaveSettlementValueSchema = Schema.Union([
	Schema.Struct({ settlement: Schema.Literal('FORFEIT') }),
	Schema.Struct({
		settlement: Schema.Literal('CARRY'),
		limit_days: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
		expiry_months: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		coverage: Schema.NullOr(Schema.Array(Schema.String.check(Schema.isMinLength(1))))
	}),
	Schema.Struct({
		settlement: Schema.Literal('COMMUTE'),
		pay_basis: Schema.Literals(['ORDINARY_DIV26', 'MONTHLY_DIV30', 'DAILY_WAGE'])
	})
]);

export type LeaveSettlement = Schema.Schema.Type<typeof leaveSettlementValueSchema>;

/** Strict standard view: a key the arm does not declare is refused rather than stripped. */
export const leaveSettlementSchema = Schema.toStandardSchemaV1(leaveSettlementValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_settlement',
	description:
		'What a leave year does with its unused balance — lapse, carry under a cap and expiry window, or commute to cash on the statute’s daily-rate basis.',
	schema: leaveSettlementSchema
});
