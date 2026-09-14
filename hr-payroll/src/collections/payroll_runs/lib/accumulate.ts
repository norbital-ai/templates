/**
 * Step 5 — ACCUMULATE.
 *
 * Every measured amount, whichever plane holds it, is added to the base of each scheme its band
 * opted into (RFC 0001 §8, decision 5). A scheme a line does not name is not charged: silence
 * means no effect, and an explicit `REDUCE` subtracts. There is no grid to default from and no
 * undecided cell to trip on, because the opt-in list on the band that priced the line is the
 * whole answer.
 *
 * Each line that fed a base is kept beside it, so the run's calculation trace can name the source
 * of every figure without re-reading the payslip (RFC 0002 §5).
 */

import { type Configuration, type ContributionConfig } from './configuration.js';
import type { PricedItem } from '../../../lib/payroll/family.js';
import type { StatutoryOptIn } from '../../../datatypes/work_rules/+definition.js';
import { cents } from './rounding.js';

/** One priced line that named a scheme, as the calculation trace records it. */
export type ContributionLine = {
	/** The catalogue component or work class the line settles under, e.g. `OVERTIME`. */
	readonly code: string;
	/** The band label that priced it, e.g. the OT class `1.5`. */
	readonly label: string;
	readonly effect: StatutoryOptIn['effect'];
	readonly amount: number;
};

export type ContributionBase = {
	readonly contribution: ContributionConfig;
	/** Never negative: a base is a quantity of chargeable wages, and there is no negative wage. */
	readonly base: number;
	/** The lines whose signed sum is `base`, in accumulation order. */
	readonly lines: readonly ContributionLine[];
};

/** Every family supplies its own priced line; Contribution reads its opt-ins and nothing else. */
export function accumulateBases(options: {
	readonly configuration: Configuration;
	readonly items: readonly PricedItem[];
	readonly employeeNumber: string;
}): ContributionBase[] {
	return options.configuration.contributions.map((contribution) => {
		let base = 0;
		const lines: ContributionLine[] = [];
		for (const item of options.items) {
			// Information is not money, so no scheme charges it and it carries no opt-in.
			if (item.bucket === 'INFORMATION') continue;
			const optIn = item.optIns.find((row) => row.contribution_id === contribution.row.id);
			if (optIn == null || item.amount === 0) continue;
			lines.push({
				code: item.catalogueComponent.code,
				label: item.label,
				effect: optIn.effect,
				amount: item.amount
			});
			switch (optIn.effect) {
				case 'INCLUDE':
					base += item.amount;
					break;
				case 'REDUCE':
					base -= item.amount;
					break;
			}
		}
		return { contribution, base: cents(Math.max(0, base)), lines };
	});
}
