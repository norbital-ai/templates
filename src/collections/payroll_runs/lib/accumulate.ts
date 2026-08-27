/**
 * Step 5 — ACCUMULATE.
 *
 * Every measured amount passes through the treatment grid and becomes part of a contribution base.
 * Nothing in this step knows the word "EPF": an amount and a contribution meet in exactly one cell,
 * and the cell says what to do.
 *
 * An amount reaches its cell down one of two roads, and which road it takes is the whole of what
 * this step knows about overtime. A configured component asks the component; derived overtime asks
 * the scheme, because there is no component to ask.
 *
 * ```
 * base  MEAL_ALLOWANCE  120.00              adjustment  OT · ORDINARY · BEYOND_NORMAL · 0
 *       │  pay_components.policy                    │  statutory_contributions.overtime_treatments
 *       ▼                                           ▼
 * MEAL × EPF    INCLUDE ──► EPF base += 120   EPF.overtime   EXCLUDE ──► EPF base   unchanged
 * MEAL × SOCSO  INCLUDE ──► SOCSO    += 120   SOCSO.overtime INCLUDE ──► SOCSO base += 288.45
 * ```
 *
 * The second road exists because "EPF excludes overtime" is a fact about EPF and not about anyone's
 * pay catalogue. It is stated once on the scheme, effective-dated, and every company in the
 * jurisdiction reads the same statement.
 *
 * `REDUCE` is why unpaid leave needs no second mechanism: its amount is a positive magnitude typed
 * `UNPAID_ABSENCE`, and the cell subtracts it from every base. `SPECIAL` is why no cell is ever
 * blank — "it's complicated" is a value, and it routes the amount to a named side-channel instead
 * of the ordinary base.
 *
 * `UNSET` cannot reach a run, and neither road may be silent. A missing decision must never be read
 * as `EXCLUDE`, which is the dangerous outcome: an under-contribution nobody notices. Both paths
 * therefore throw on absence rather than defaulting.
 */

import { lookupTreatment, type Configuration, type ContributionConfig } from './configuration.js';
import type { ContributionTreatment } from '../../../datatypes/contribution_treatment/+definition.js';
import type { PricedItem } from './measure.js';
import { cents } from './rounding.js';

export type ContributionBase = {
	readonly contribution: ContributionConfig;
	/** Never negative: a base is a quantity of chargeable wages, and there is no negative wage. */
	readonly base: number;
	/** Amounts routed by `SPECIAL` cells, keyed by the rule they named. */
	readonly special: Readonly<Record<string, number>>;
};

/**
 * The one cell deciding this amount against this scheme, or `undefined` where nobody has decided.
 *
 * `overtimeBand` is the whole of the test. It is set on derived overtime and on nothing else — an
 * amount with a band has no pay component to ask, which is exactly the case the scheme answers for
 * — and its `excess` flag chooses between the scheme's two overtime positions.
 */
function treatmentFor(
	configuration: Configuration,
	contribution: ContributionConfig,
	item: PricedItem
): ContributionTreatment | undefined {
	const band = item.overtimeBand;
	if (band != null)
		return band.excess
			? contribution.overtimeExcessTreatment?.treatment
			: contribution.overtimeTreatment?.treatment;
	return item.payComponent == null
		? undefined
		: lookupTreatment(configuration, item.payComponent.id, contribution.row.id)?.treatment;
}

/**
 * Every measured amount passes through the grid, whichever plane holds it.
 *
 * `items` is the contracted amounts and the adjustments concatenated, and that is deliberate: a
 * contribution base is a fact about the payslip, so which table a figure will be stored in cannot
 * change what it is charged on. Proration is not in here — it is the working behind a base amount,
 * not a second amount — and charging it would double the wage.
 */
export function accumulateBases(options: {
	readonly configuration: Configuration;
	readonly items: readonly PricedItem[];
	readonly employeeNumber: string;
}): ContributionBase[] {
	return options.configuration.contributions.map((contribution) => {
		let base = 0;
		const special: Record<string, number> = {};
		for (const item of options.items) {
			// Information is not money, so the grid does not apply to it and it carries no cell.
			if (item.nature === 'INFORMATION') continue;
			/**
			 * A settlement claim is not money either, and it is the one thing here that has no cell.
			 *
			 * An adjustment naming neither a catalogue row nor a statutory band is a source the run
			 * read and priced at nothing — the zero-amount row that replaced `payslip_sources`. There
			 * is no component to ask and no scheme to ask for it, and there is nothing to charge: it
			 * carries an amount of zero by construction. Skipping it is not a silent default, which
			 * is what the throw below exists to prevent — it is the absence of anything to decide.
			 */
			if (item.payComponent == null && item.overtimeBand == null) continue;
			const treatment = treatmentFor(options.configuration, contribution, item);
			if (treatment == null)
				throw new Error(
					item.payComponent == null
						? `${contribution.row.code} states no treatment for derived overtime effective in this ` +
								`period, so ${item.label} cannot be charged. Record the scheme's overtime position ` +
								'on statutory_contributions.'
						: `No ${contribution.row.code} treatment exists for ${item.label}. ` +
								'The component policy must decide every effective statutory scheme.'
				);
			switch (treatment.kind) {
				case 'INCLUDE':
					base += item.amount;
					break;
				case 'EXCLUDE':
					break;
				case 'REDUCE':
					base -= item.amount;
					break;
				case 'SPECIAL': {
					if (!contribution.row.special_rules.includes(treatment.rule))
						throw new Error(
							`${item.label} × ${contribution.row.code} routes to special rule ` +
								`"${treatment.rule}", which ${contribution.row.code} does not declare.`
						);
					special[treatment.rule] = (special[treatment.rule] ?? 0) + item.amount;
					break;
				}
				case 'UNSET':
					throw new Error(
						`${item.label} × ${contribution.row.code} is undecided. ` +
							`${options.employeeNumber} cannot be paid until the grid cell is set.`
					);
			}
		}
		return { contribution, base: cents(Math.max(0, base)), special };
	});
}
