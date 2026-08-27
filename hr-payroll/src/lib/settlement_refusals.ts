import { Schema } from 'effect';

/**
 * ============================================================================
 * THE INVARIANT THE DATABASE NO LONGER HOLDS
 * ============================================================================
 *
 * `payslip_sources.source` used to be globally `unique`. One concrete input belonged to exactly one
 * payslip, the database said so, and nothing in the engine had to be trusted for it to be true.
 *
 * That constraint cannot survive partial consumption. A loan instalment the negative-net guard could
 * only part-pay stays outstanding on its obligation, and the next run recovers the remainder against
 * the same instalment - so one obligation is legitimately touched by several payslips. Under the
 * merged shape the constraint is `unique(source, payslip_id)`, which still makes it impossible to
 * consume one input twice **inside one run**.
 *
 * What is gone is the cross-run ceiling: nothing at the database level now stops the sum of what
 * every run took from an obligation exceeding what the obligation is worth. That ceiling is
 * arithmetic now, and this file is where the arithmetic is named.
 *
 *     A DATABASE INVARIANT WAS TRADED FOR AN ARITHMETIC ONE.
 *     It is stated here, raised by the payroll engine, and held by a test - not by a comment.
 *
 * The refusal is declared in the declaration layer rather than inside the engine on purpose. The
 * rule belongs to the shape: it is the reason `payslip_adjustments` may carry several rows for one
 * `source`, and anything that reads that shape has to be able to name the thing that bounds it.
 */

/**
 * The refusal raised when a run would take more from an obligation than the obligation is worth.
 *
 * **This exact string is the name.** The engine raises it, the settlement test asserts on it, and
 * an operator reads it in the sentence below. Renaming it in one place and not the others silently
 * unhooks the only guard the cross-run ceiling has.
 */
export const OBLIGATION_OVER_CONSUMED = 'OBLIGATION_OVER_CONSUMED' as const;

/** What the engine knows when it is about to exceed an obligation. */
const obligationConsumptionSchema = Schema.Struct({
	/** The `obligations` row being drawn against. */
	obligation_id: Schema.String.check(Schema.isUUID()),
	/** The customer's name for it, where it has one; used to make the sentence readable. */
	reference: Schema.NullOr(Schema.String),
	/** What the obligation is worth in total - its principal, or its single amount. */
	entitlement: Schema.Finite,
	/** What every earlier PAID run already took from it. */
	consumed: Schema.Finite,
	/** What this run is proposing to take on top. */
	proposed: Schema.Finite,
	/** The period of the run proposing it. */
	period: Schema.String
});

type ObligationConsumption = Schema.Schema.Type<typeof obligationConsumptionSchema>;

/**
 * Whether this proposal would break the ceiling.
 *
 * A tolerance is deliberate and small: amounts are rounded to the currency's minor unit on the way
 * into a payslip, so a schedule that sums to its principal exactly can still land a hundredth over
 * it across a dozen runs. One cent of rounding is not an over-consumption; a cent more than that is.
 */
export const overConsumesObligation = (consumption: ObligationConsumption): boolean =>
	consumption.consumed + consumption.proposed - consumption.entitlement > 0.01;

/**
 * The sentence the refusal carries.
 *
 * It names the obligation, what is left, and what was asked for - because the only two ways out are
 * amending the obligation or letting the run settle for the remainder, and neither is choosable from
 * "over-consumed".
 */
export const obligationOverConsumedMessage = (consumption: ObligationConsumption): string => {
	const remaining = consumption.entitlement - consumption.consumed;
	const named =
		consumption.reference == null ? 'This obligation' : `Obligation ${consumption.reference}`;
	return (
		`${OBLIGATION_OVER_CONSUMED}: ${named} is worth ${consumption.entitlement.toFixed(2)} and ` +
		`earlier paid runs have already taken ${consumption.consumed.toFixed(2)} of it. Payroll ` +
		`${consumption.period} asked for ${consumption.proposed.toFixed(2)}, which is more than the ` +
		`${remaining.toFixed(2)} outstanding. Amend the obligation, or let the run settle the ` +
		'remainder only.'
	);
};
