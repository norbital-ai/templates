/**
 * Step 8 — the run's complete result, as a value.
 *
 * This is what `persist.ts` used to do with four functions and `mutate`. It writes nothing. A
 * `create.before` hook's return is the record the runtime persists, and it may carry the records
 * that belong to it — so the payslips, their lines and their settlement locks are returned here and
 * committed as part of the run's own insert.
 *
 * Three consequences worth stating, because each replaces something that used to be code:
 *
 *  - **A rebuild cannot leave half an answer.** An included `many` relationship is the parent's
 *    complete desired state, so stating the payslips deletes the previous build's and its cascade
 *    takes their lines and source rows with them. There is no clear-then-write pair and therefore no
 *    window between the two halves.
 *  - **A line carries no `payslip_id`.** Nested under the payslip that owns it, there is no id to
 *    carry: the runtime fills the foreign key from the parent it assigned. The version this replaces
 *    wrote the payslips first, collected their returned ids into a map, and needed two guards for the
 *    two ways that map could come back wrong.
 *  - **A lock lands in the same statement as the figures it protects.** Source claims used to be
 *    written after the lines, because writing them first would leave a record locked by a run that
 *    then failed to persist anything. In one write there is no "after".
 */

import { Schema } from 'effect';
import { dedupeClaims, type SettlementClaim } from './claims.js';
import type { ContributionCharge } from './contribute.js';
import { payslipLineComponentValueSchema } from '../../../datatypes/payslip_line_component/+definition.js';
import type { Settlement } from './settle.js';

export type PendingPayslip = {
	readonly employmentId: string;
	readonly currency: string;
	readonly settlement: Settlement;
	readonly charges: readonly ContributionCharge[];
	/**
	 * The time entries and leave movements this payslip consumed, from `claimsForBundle`.
	 *
	 * Component entries and loan instalments are not in here: their direct foreign keys already live
	 * on the payslip lines that name them.
	 */
	readonly claims: readonly SettlementClaim[];
};

const LineInputSchema = Schema.Struct({
	component: payslipLineComponentValueSchema,
	bucket: Schema.Literals(['EARNING', 'ABSENCE', 'DEDUCTION', 'NON_WAGE_PAYMENT', 'EMPLOYER_COST']),
	amount: Schema.Number,
	quantity: Schema.NullOr(Schema.Number),
	rate: Schema.NullOr(Schema.Number),
	sequence: Schema.Number
});
type LineInput = Schema.Schema.Type<typeof LineInputSchema>;

/** Every payslip in the run, with the lines and locks that belong to it. */
export function payrollRunGraph(options: {
	readonly pending: readonly PendingPayslip[];
	readonly period: string;
}) {
	return options.pending.map((payslip) => {
		let sequence = 1;
		const lines: LineInput[] = [];
		for (const line of payslip.settlement.lines) {
			// Derived overtime carries its own nature — there is no component row to read one off.
			if (line.nature == null || line.nature === 'INFORMATION') continue;
			lines.push({
				component: line.component,
				bucket: line.nature,
				amount: line.amount,
				quantity: line.quantity,
				rate: line.rate,
				sequence: sequence++
			});
		}
		for (const charge of payslip.charges) {
			const shared = {
				statutory_contribution_id: charge.contribution.row.id,
				base_amount: charge.base,
				band_reference: charge.bandReference,
				special_amounts: charge.special
			};
			lines.push({
				component: { kind: 'STATUTORY_EMPLOYEE', ...shared },
				bucket: 'DEDUCTION',
				amount: charge.employee,
				quantity: null,
				rate: null,
				sequence: sequence++
			});
			lines.push({
				component: { kind: 'STATUTORY_EMPLOYER', ...shared },
				bucket: 'EMPLOYER_COST',
				amount: charge.employer,
				quantity: null,
				rate: null,
				sequence: sequence++
			});
		}
		/**
		 * These rows exist only for sources that have no natural payslip line: attendance and leave.
		 * Component entries and loan instalments are already linked by the generated foreign-key
		 * projections on `payslip_lines`, so writing them again here would duplicate one fact.
		 */
		return {
			employment_id: payslip.employmentId,
			gross: payslip.settlement.gross,
			total_deductions: payslip.settlement.totalDeductions,
			net: payslip.settlement.net,
			employer_cost: payslip.settlement.employerCost,
			currency: payslip.currency,
			payslip_line_payslip: lines,
			payslip_source_payslip: dedupeClaims([...payslip.claims]).map((claim) => ({
				source: claim,
				period: options.period
			}))
		};
	});
}
