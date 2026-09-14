/**
 * Step 5 — ACCUMULATE.
 *
 * Every measured amount, whichever plane holds it, is added to the base of each scheme its band
 * opted into (RFC 0001 §8, decision 5). A scheme a line does not name is not charged: silence
 * means no effect, and an explicit `REDUCE` subtracts. There is no grid to default from and no
 * undecided cell to trip on, because the opt-in list on the band that priced the line is the
 * whole answer.
 */

import { type Configuration, type ContributionConfig } from './configuration.js';
import type { PricedItem } from '../../../lib/payroll/family.js';
import { cents } from './rounding.js';

export type ContributionBase = {
	readonly contribution: ContributionConfig;
	/** Never negative: a base is a quantity of chargeable wages, and there is no negative wage. */
	readonly base: number;
	/** Amounts routed by a special rule, keyed by the rule named. Empty in the current grammar. */
	readonly special: Readonly<Record<string, number>>;
};

/** Every family supplies its own priced line; Contribution reads its opt-ins and nothing else. */
export function accumulateBases(options: {
	readonly configuration: Configuration;
	readonly items: readonly PricedItem[];
	readonly employeeNumber: string;
}): ContributionBase[] {
	return options.configuration.contributions.map((contribution) => {
		let base = 0;
		const special: Record<string, number> = {};
		for (const item of options.items) {
			// Information is not money, so no scheme charges it and it carries no opt-in.
			if (item.bucket === 'INFORMATION') continue;
			const optIn = item.optIns.find((row) => row.contribution_id === contribution.row.id);
			if (optIn == null) continue;
			switch (optIn.effect) {
				case 'INCLUDE':
					base += item.amount;
					break;
				case 'REDUCE':
					base -= item.amount;
					break;
			}
		}
		return { contribution, base: cents(Math.max(0, base)), special };
	});
}
