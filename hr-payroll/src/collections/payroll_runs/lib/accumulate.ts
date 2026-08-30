/**
 * Step 5 — ACCUMULATE.
 *
 * Every measured amount, whichever plane holds it, is routed through the effective-dated treatment
 * grid into the chargeable base of each scheme. The grid is `pay_components.policy.statutory_
 * treatments` — the company's answer to "what does this scheme do with this money" — and both
 * paths throw on absence rather than defaulting, because an undecided cell used twice is the
 * dangerous kind: an under-contribution nobody notices.
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
 * `statutoryRuleKey` is the whole of the test. It is set on derived overtime and on nothing else —
 * an amount with a rule key has no pay component to ask, which is exactly the case the scheme
 * answers for — and the key's excess segment chooses between the scheme's two overtime positions.
 */
function treatmentFor(
	configuration: Configuration,
	contribution: ContributionConfig,
	item: PricedItem
): ContributionTreatment | undefined {
	const excess = item.label.includes('_EXCESS_');
	if (item.payComponent == null)
		return excess
			? contribution.overtimeExcessTreatment?.treatment
			: contribution.overtimeTreatment?.treatment;
	return lookupTreatment(configuration, item.payComponent.id, contribution.row.id)?.treatment;
}

/**
 * Every measured amount passes through the grid, whichever plane holds it.
 *
, whichever plane holds it.
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
			 * An amount naming neither a catalogue row nor a statutory rule has nothing to charge.
			 *
			 * A derived overtime row names its rule; anything else with no component is a measured
			 * nothing, and the grid has no cell for it. Skipping it is not a silent default — it is
			 * the absence of anything to decide.
			 */
			if (
				item.payComponent == null &&
				!item.label.includes('_EXCESS_') &&
				!item.label.startsWith('OT_')
			)
				continue;
			if (item.payComponent == null && item.amount === 0) continue;
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
