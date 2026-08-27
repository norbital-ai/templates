/**
 * Step 8 — the run's complete result, as a value.
 *
 * This is what `persist.ts` used to do with four functions and `mutate`. It writes nothing. A
 * `create.before` hook's return is the record the runtime persists, and it may carry the records
 * that belong to it — so the payslips and their adjustments are returned here and committed as part
 * of the run's own insert.
 *
 * Three consequences worth stating, because each replaces something that used to be code:
 *
 *  - **A rebuild cannot leave half an answer.** An included `many` relationship is the parent's
 *    complete desired state, so stating the payslips deletes the previous build's and its cascade
 *    takes their adjustments with them. There is no clear-then-write pair and therefore no window
 *    between the two halves.
 *  - **An adjustment carries no `payslip_id`.** Nested under the payslip that owns it, there is no
 *    id to carry: the runtime fills the foreign key from the parent it assigned. The version this
 *    replaces wrote the payslips first, collected their returned ids into a map, and needed two
 *    guards for the two ways that map could come back wrong.
 *  - **A lock lands in the same statement as the figures it protects.** Source claims used to be
 *    written after the lines, because writing them first would leave a record locked by a run that
 *    then failed to persist anything. In one write there is no "after".
 *
 * ## Four planes, three of them inlined
 *
 * `base`, `proration` and `statutory` are columns on the payslip because none of them is caused by
 * a record anybody can edit: base is the contract, proration is the calendar, and statutory is
 * arithmetic over their sum. There is nothing to link to, nothing to freeze and no junction to keep
 * honest. `payslip_adjustments` is the one relation, and every row in it names the one input that
 * caused it — including the rows whose amount is zero, which say the run read a source and priced
 * it at nothing. That is what `payslip_sources` was, at no extra collection.
 *
 * Nothing here reshapes anything. MEASURE emits the stored shapes and CONTRIBUTE emits the charges;
 * this assembles them into the graph and assigns the adjustment sequence, which is the one fact
 * that only exists once a payslip's rows are in an order.
 */

import type { ContributionCharge } from './contribute.js';
import type { MeasuredAdjustment, MeasuredBase } from './measure.js';
import type { PayslipProration } from '../../../datatypes/payslip_proration/+definition.js';
import type { Settlement } from './settle.js';

export type PendingPayslip = {
	readonly employmentId: string;
	readonly currency: string;
	readonly settlement: Settlement;
	readonly proration: readonly PayslipProration[];
	readonly charges: readonly ContributionCharge[];
};

/**
 * The bucket an amount settles into, which is `pay_components.policy.kind` where there is one.
 *
 * `INFORMATION` never reaches here — MEASURE stops it, because an hourly rate is not money — so a
 * nature that is null or informational is a derived overtime row, and derived overtime is an
 * earning. The fallback is stated rather than left to a cast so an unexpected value lands in the
 * pot it economically belongs to instead of failing a not-null column at the database.
 */
function bucketOf(nature: MeasuredAdjustment['nature']): NonNullable<MeasuredAdjustment['nature']> {
	return nature == null || nature === 'INFORMATION' ? 'EARNING' : nature;
}

/** Every payslip in the run, with the adjustments that belong to it. */
export function payrollRunGraph(options: {
	readonly pending: readonly PendingPayslip[];
	readonly period: string;
}) {
	return options.pending.map((payslip) => ({
		employment_id: payslip.employmentId,
		base: payslip.settlement.base.map((item: MeasuredBase) => item.entry),
		proration: payslip.proration,
		statutory: payslip.charges.map((charge) => ({
			statutory_contribution_id: charge.contribution.row.id,
			base_amount: charge.base,
			employee_amount: charge.employee,
			employer_amount: charge.employer,
			band_reference: charge.bandReference,
			special_amounts: charge.special
		})),
		gross: payslip.settlement.gross,
		total_deductions: payslip.settlement.totalDeductions,
		net: payslip.settlement.net,
		employer_cost: payslip.settlement.employerCost,
		currency: payslip.currency,
		payslip_adjustment_payslip: payslip.settlement.adjustments.map((adjustment, index) => ({
			// Denormalized deliberately: the refusal that stops somebody editing a settled record is
			// composed under that person's own subject, and a supervisor has no `payroll_runs` read
			// grant — so joining to the run for its period would turn an explanation into an access
			// denial. `payroll_runs/+hooks.ts` refuses any hand edit to `period`, so it cannot drift.
			period: options.period,
			source: adjustment.source,
			// Exactly one of the two: overtime is derived from the clock and the jurisdiction's rules,
			// so it names the band that priced it and no catalogue row. A settlement-lock row names
			// neither, because nothing was priced.
			pay_component_id: adjustment.payComponent?.id ?? null,
			overtime_band: adjustment.overtimeBand,
			bucket: bucketOf(adjustment.nature),
			amount: adjustment.amount,
			quantity: adjustment.quantity,
			rate: adjustment.rate,
			sequence: index + 1
		}))
	}));
}
