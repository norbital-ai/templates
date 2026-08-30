import { Schema } from 'effect';

/**
 * ============================================================================
 * THE CEILINGS THE DATABASE DOES NOT HOLD
 * ============================================================================
 *
 * Two families of payroll input are consumed across more than one payslip, and the junctions make
 * that legal: a one-off component entry may settle under a cap that pays less than it asked for, and
 * a loan repayment may be part-recovered when net-pay protection reduces what a run could take.
 * `unique(payslip_id, source)` on the junctions keeps double-consumption *within* one run
 * impossible; what the database does not say is that the sum across every paid run stays inside
 * what the source is worth.
 *
 * That is arithmetic, and this file is where the arithmetic is named:
 *
 *     A DATABASE INVARIANT WAS TRADED FOR AN ARITHMETIC ONE.
 *     It is stated here, raised by the payroll engine, and held by a test - not by a comment.
 *
 * The refusals are declared in the declaration layer rather than inside the engine on purpose. The
 * rules belong to the shape: they are the reason a captured input may feed several payslips, and
 * anything that reads that shape has to be able to name the thing that bounds it.
 */

/**
 * The refusal raised when a run would take more from a component entry than the entry is worth.
 *
 * **This exact string is the name.** The engine raises it, the test asserts on it, and an operator
 * reads it in the sentence below. Renaming it in one place and not the others silently unhooks the
 * only guard the consumption ceiling has.
 */
export const ENTRY_OVER_CONSUMED = 'ENTRY_OVER_CONSUMED' as const;

/** What the engine knows when it is about to exceed a component entry. */
const entryConsumptionSchema = Schema.Struct({
	/** The `component_entries` row being drawn against. */
	component_entry_id: Schema.String.check(Schema.isUUID()),
	/** The pay component code it settles under, to make the sentence readable. */
	component_code: Schema.String,
	/** What the entry is worth — its approved magnitude. */
	entitlement: Schema.Finite,
	/** What every earlier PAID run already took from it. */
	consumed: Schema.Finite,
	/** What this run is proposing to take on top. */
	proposed: Schema.Finite,
	/** The period of the run proposing it. */
	period: Schema.String
});

type EntryConsumption = Schema.Schema.Type<typeof entryConsumptionSchema>;

/**
 * Whether this proposal would break the ceiling.
 *
 * A tolerance is deliberate and small: amounts are rounded to the currency's minor unit on the way
 * into a payslip, so a reimbursement percentage can land a hundredth over the entry across a
 * handful of runs. One cent of rounding is not an over-consumption; a cent more than that is.
 */
export const overConsumesEntry = (consumption: EntryConsumption): boolean =>
	consumption.consumed + consumption.proposed - consumption.entitlement > 0.01;

/**
 * The sentence the refusal carries.
 *
 * It names the entry, what is left, and what was asked for — because the only two ways out are
 * amending the entry or letting the run settle the remainder, and neither is choosable from
 * "over-consumed".
 */
export const entryOverConsumedMessage = (consumption: EntryConsumption): string => {
	const remaining = consumption.entitlement - consumption.consumed;
	return (
		`${ENTRY_OVER_CONSUMED}: the ${consumption.component_code} entry is worth ` +
		`${consumption.entitlement.toFixed(2)} and earlier paid runs have already taken ` +
		`${consumption.consumed.toFixed(2)} of it. Payroll ${consumption.period} asked for ` +
		`${consumption.proposed.toFixed(2)}, which is more than the ${remaining.toFixed(2)} ` +
		'outstanding. Amend the entry, or let the run settle the remainder only.'
	);
};

/** The refusal raised when paid recovery across payslips would exceed a repayment's amount due. */
export const REPAYMENT_OVER_RECOVERED = 'REPAYMENT_OVER_RECOVERED' as const;

/**
 * The refusal raised when a one-off entry is already captured by another standing payroll.
 *
 * Single-use means one standing/paid payslip — not "until output amounts add up to the requested
 * amount". A $100 claim reimbursed at 80% is fully settled by one $80 output and must not leave an
 * invented $20 balance behind for a later run to "catch up". Declared here beside the other
 * ceilings because it is the same shape: a rule the junction unique indexes cannot state alone.
 */
export const ENTRY_ALREADY_CAPTURED = 'ENTRY_ALREADY_CAPTURED' as const;

/** What the engine knows when a one-off entry is already held by a standing run. */
const entryCaptureSchema = Schema.Struct({
	/** The period of the run that already holds the entry. */
	capturedBy: Schema.String,
	/** The period of the run that asked to capture it. */
	period: Schema.String
});

type EntryCapture = Schema.Schema.Type<typeof entryCaptureSchema>;

export const entryAlreadyCapturedMessage = (capture: EntryCapture): string =>
	`${ENTRY_ALREADY_CAPTURED}: this one-off entry is already captured by payroll ` +
	`${capture.capturedBy}. A one-off claim, bonus, arrears settlement or correction settles in ` +
	'one standing payroll; correct a settled payslip with a new component entry, not by ' +
	'capturing the same one twice.';

/** What the engine knows when a recovery would overrun a repayment. */
const repaymentConsumptionSchema = Schema.Struct({
	/** The `loan_repayments` row being recovered. */
	loan_repayment_id: Schema.String.check(Schema.isUUID()),
	/** The due date, to make the sentence readable. */
	due_date: Schema.String,
	amount_due: Schema.Finite,
	/** What every earlier PAID run already recovered from it. */
	consumed: Schema.Finite,
	/** What this run is proposing to recover on top. */
	proposed: Schema.Finite,
	period: Schema.String
});

type RepaymentConsumption = Schema.Schema.Type<typeof repaymentConsumptionSchema>;

/** The ceiling is exact: a repayment is recovered to its amount due and never past it. */
export const overRecoversRepayment = (consumption: RepaymentConsumption): boolean =>
	consumption.consumed + consumption.proposed - consumption.amount_due > 0.01;

export const repaymentOverRecoveredMessage = (consumption: RepaymentConsumption): string => {
	const remaining = consumption.amount_due - consumption.consumed;
	return (
		`${REPAYMENT_OVER_RECOVERED}: the repayment due ${consumption.due_date} is worth ` +
		`${consumption.amount_due.toFixed(2)} and earlier paid runs have already recovered ` +
		`${consumption.consumed.toFixed(2)} of it. Payroll ${consumption.period} asked for ` +
		`${consumption.proposed.toFixed(2)}, which is more than the ${remaining.toFixed(2)} ` +
		'outstanding.'
	);
};
