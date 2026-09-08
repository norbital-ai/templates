/**
 * Step 5 — ACCUMULATE.
 *
 * Every measured amount, whichever plane holds it, is routed through the treatment grid into the
 * chargeable base of each scheme. The grid is each family pay item's `contribution_treatments` — the
 * company's answer to "what does this scheme do with this money" — and every path throws on
 * absence rather than defaulting, because an undecided cell used twice is the dangerous kind: an
 * under-contribution nobody notices.
 */

import { type Configuration, type ContributionConfig } from './configuration.js';
import type { PricedItem } from '../../../lib/payroll/family.js';
import { cents } from './rounding.js';

export type ContributionBase = {
	readonly contribution: ContributionConfig;
	/** Never negative: a base is a quantity of chargeable wages, and there is no negative wage. */
	readonly base: number;
	/** Amounts routed by `SPECIAL` cells, keyed by the rule they named. */
	readonly special: Readonly<Record<string, number>>;
};

/** Every family supplies its own pay-item metadata; Contribution only reads those treatments. */
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
			const component = item.catalogueComponent;
			const treatment = component.contribution_treatments[contribution.row.code];
			if (treatment == null)
				throw new Error(`No ${contribution.row.code} treatment exists for ${component.code}.`);

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
