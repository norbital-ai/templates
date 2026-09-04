/**
 * Step 8 — the run's complete result, as a value.
 *
 * A `create.before` hook's return is the record the runtime persists, and it may carry the records
 * that belong to it — so the run's whole result is returned here and committed as part of the
 * run's own write: the payslips, their inlined base, proration and statutory entries, the four
 * captured-input junctions, and every adjustment that names one of those captures.
 *
 * Three consequences worth stating, because each replaces something that used to be code:
 *
 *  - **A rebuild cannot leave half an answer.** The nested graph is the run's complete desired
 *    set of payslips, so every previous payslip is omitted and deleted (each through cascade,
 *    junctions and adjustments included) in the same statement that writes the new ones. There
 *    is no clear-then-write pair and therefore no window between the two halves.
 *  - **A child carries no `payslip_id`.** Nested under the payslip that owns it, there is no id to
 *    carry: the runtime fills the foreign key from the parent it assigned.
 *  - **A capture lands in the same statement as the figures it protects.** Source claims used to be
 *    written after the lines. In one write there is no "after".
 *
 * ## The join the two halves of the graph meet at
 *
 * MEASURE emits adjustments that name a source by family and id; the junctions this file builds
 * carry runtime-minted ids. The join is made here and nowhere else — the junction id the payslip
 * stores is the same id the adjustment's `input` handle names — which is what makes the
 * adjustment's provenance a real foreign key into a row its own payslip holds. An adjustment whose
 * causal input no junction stores is a bug to stop on, not a null to paper over.
 *
 * ## Four output planes, three of them inlined
 *
 * `base`, `proration` and `statutory` are columns on the payslip because none of them is caused by
 * a record anybody can edit: base is the contract, proration is the calendar, and statutory is
 * arithmetic over their sum. There is nothing to link to, nothing to freeze and no junction to
 * keep honest. `payslip_adjustments` is the one output relation, and every row in it names the one
 * captured input that caused it. The junctions carry no calculated values and never may: an input
 * that prices to nothing is still a row, because "consumed nothing" and "was never read" are
 * different claims.
 *
 * Nothing here reshapes anything. MEASURE emits the stored shapes and CONTRIBUTE emits the charges;
 * this assembles them into the graph and assigns the adjustment sequence, which is the one fact
 * that only exists once a payslip's rows are in an order.
 */

import type { ContributionCharge } from './contribute.js';
import type { MeasuredAdjustment, MeasuredBase, MeasuredEmployment } from './measure.js';
import type { PayslipProration } from '../../../datatypes/payslip_proration/+definition.js';
import type { Settlement } from './settle.js';

export type PendingPayslip = {
	readonly employmentId: string;
	readonly currency: string;
	readonly settlement: Settlement;
	readonly proration: readonly PayslipProration[];
	readonly charges: readonly ContributionCharge[];
	/** The four captured input families, by source id — the junction rows this payslip stores. */
	readonly captured: MeasuredEmployment['captured'];
};

/**
 * The junction an adjustment's `input` handle names, per input family.
 *
 * The four families are the four logical payslip attributes; the tags are the reference arms
 * `payslip_adjustments.input` declares. Kept beside the assembly rather than inlined as literals
 * at each emit site, so the family → junction spelling exists exactly once.
 */
const INPUT_TAG_BY_FAMILY = {
	WORK_DAY: 'WORK_DAY_INPUT',
	COMPONENT_ENTRY: 'COMPONENT_ENTRY_INPUT',
	LEAVE_REQUEST: 'LEAVE_REQUEST_INPUT',
	LOAN_REPAYMENT: 'LOAN_REPAYMENT_INPUT'
} as const;

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

/**
 * The junction rows one captured family contributes, under the source column it stores.
 *
 * The ids are minted here and nowhere else, because an id is a graph-ordering fact: the runtime
 * layers a returned graph parent-first and resolves every reference in it, so an authored id is
 * what lets an adjustment's `input` foreign key name a junction row in the same statement.
 */
type JunctionRow<Source extends string> = {
	readonly id: string;
	readonly period: string;
} & Readonly<Record<Source, string>>;

function junctionRowsOf<Source extends string>(
	ids: readonly string[],
	period: string,
	sourceColumn: Source
): JunctionRow<Source>[] {
	return ids.map((sourceId) => ({
		id: crypto.randomUUID(),
		[sourceColumn]: sourceId,
		// Denormalized deliberately: the refusal that stops somebody editing a captured record is
		// composed under that person's own subject, and a supervisor has no `payroll_runs` read
		// grant — so joining through the payslip to the run would turn an explanation into an
		// access denial. The engine writes it and refuses hand edits to it.
		period
	})) as JunctionRow<Source>[];
}

/** Every payslip in the run, with the captured inputs and the adjustments that belong to it. */
export function payrollRunGraph(options: {
	readonly pending: readonly PendingPayslip[];
	readonly period: string;
}) {
	return options.pending.map((payslip) => {
		const workDayJunctions = junctionRowsOf(
			payslip.captured.workDays,
			options.period,
			'work_day_id'
		);
		const entryJunctions = junctionRowsOf(
			payslip.captured.componentEntries,
			options.period,
			'component_entry_id'
		);
		const leaveJunctions = junctionRowsOf(
			payslip.captured.leaveRequests,
			options.period,
			'leave_request_id'
		);
		const repaymentJunctions = junctionRowsOf(
			payslip.captured.loanRepayments,
			options.period,
			'loan_repayment_id'
		);
		/**
		 * Source id → junction id, per family. The junction rows and the adjustment handles are
		 * joined here and nowhere else: the junction id the payslip stores is the same id the
		 * adjustment's input handle names, which is what makes the adjustment's provenance a real
		 * foreign key into a row its own payslip holds.
		 */
		const junctionIdOf = {
			WORK_DAY: new Map(workDayJunctions.map((row) => [row.work_day_id, row.id])),
			COMPONENT_ENTRY: new Map(entryJunctions.map((row) => [row.component_entry_id, row.id])),
			LEAVE_REQUEST: new Map(leaveJunctions.map((row) => [row.leave_request_id, row.id])),
			LOAN_REPAYMENT: new Map(repaymentJunctions.map((row) => [row.loan_repayment_id, row.id]))
		} as const;
		return {
			employment_id: payslip.employmentId,
			base: payslip.settlement.base.map((item: MeasuredBase) => item.entry),
			proration: payslip.proration,
			statutory: payslip.charges.map((charge) => ({
				scheme_code: charge.contribution.row.code,
				authority: charge.contribution.row.authority,
				base_amount: charge.base,
				employee_amount: charge.employee,
				employer_amount: charge.employer,
				band_key: charge.bandReference,
				special_amounts: charge.special
			})),
			gross: payslip.settlement.gross,
			total_deductions: payslip.settlement.totalDeductions,
			net: payslip.settlement.net,
			employer_cost: payslip.settlement.employerCost,
			currency: payslip.currency,
			payslip_work_day_input_payslip: workDayJunctions,
			payslip_component_entry_input_payslip: entryJunctions,
			payslip_leave_request_input_payslip: leaveJunctions,
			payslip_loan_repayment_input_payslip: repaymentJunctions,
			payslip_adjustment_payslip: payslip.settlement.adjustments.map(
				(adjustment: MeasuredAdjustment, index: number) => {
					// Every adjustment's causal input is in its payslip's junctions by construction —
					// the capture sets are the union of what the adjustments name and what the span
					// filters found. A miss is a bug to stop on, not a null to paper over: the foreign
					// key is exactly what would catch it, and the same statement is the right place.
					const junctionId = junctionIdOf[adjustment.input.family].get(adjustment.input.id);
					if (junctionId == null)
						throw new Error(
							`Adjustment ${adjustment.label} names a ${adjustment.input.family} input ` +
								`${adjustment.input.id} that this payslip never captured.`
						);
					return {
						// Denormalized deliberately: the refusal that stops somebody editing a settled
						// record is composed under that person's own subject, and a supervisor has no
						// `payroll_runs` read grant — so joining to the run for its period would turn an
						// explanation into an access denial. `payroll_runs/+hooks.ts` refuses any hand
						// edit to `period`, so it cannot drift.
						period: options.period,
						input: { kind: INPUT_TAG_BY_FAMILY[adjustment.input.family], id: junctionId },
						label: adjustment.label,
						bucket: bucketOf(adjustment.nature),
						amount: adjustment.amount,
						quantity: adjustment.quantity,
						rate: adjustment.rate,
						statutory_rule_key: adjustment.statutoryRuleKey,
						sequence: index + 1
					};
				}
			)
		};
	});
}
