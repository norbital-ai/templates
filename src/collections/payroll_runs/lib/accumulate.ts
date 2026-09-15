/**
 * Step 5 — ACCUMULATE.
 *
 * Each scheme declares its own wage base (RFC 0003 §1): whether salary, absence, overtime and
 * the night premium are in it, and which catalogue rows are. Every measured amount the
 * declaration admits joins that scheme's base with the sign of its own landing — an earning adds,
 * an absence or a deduction subtracts. A line the declaration does not admit feeds nothing.
 *
 * Each line that fed a base is kept beside it, so the run's calculation trace can name the source
 * of every figure without re-reading the payslip (RFC 0002 §5).
 */

import { type Configuration, type ContributionConfig } from './configuration.js';
import type { PricedItem } from '../../../lib/payroll/family.js';
import { leaveRowCode } from '../../../lib/leave/codes.js';
import { cents } from './rounding.js';

/** One priced line that fed a scheme's base, as the calculation trace records it. */
export type ContributionLine = {
	/** The catalogue component or work class the line settles under, e.g. `OVERTIME`. */
	readonly code: string;
	/** The band label that priced it, e.g. the OT class `1.5`. */
	readonly label: string;
	readonly effect: 'INCLUDE' | 'REDUCE';
	readonly amount: number;
};

export type ContributionBase = {
	readonly contribution: ContributionConfig;
	/** Never negative: a base is a quantity of chargeable wages, and there is no negative wage. */
	readonly base: number;
	/** The lines whose signed sum is `base`, in accumulation order. */
	readonly lines: readonly ContributionLine[];
};

type BaseDeclaration = ContributionConfig['row']['base'];

/** Whether one scheme's declaration admits one priced line. */
function baseAdmits(base: BaseDeclaration, item: PricedItem): boolean {
	// Information is not money; no scheme charges it.
	if (item.bucket === 'INFORMATION') return false;
	const component = item.catalogueComponent;
	if (component.family === 'WORK') {
		if (component.output === 'salary') return base.salary;
		if (component.output === 'absence') return base.absence;
		if (component.output === 'night') return base.night_premium;
		return base.overtime;
	}
	// An unpaid leave day is an absence; a leave row listed in `entries` is its encashment.
	if (component.family === 'LEAVE' && item.bucket === 'ABSENCE') return base.absence;
	const code = component.family === 'LEAVE' ? leaveRowCode(component.code) : component.code;
	return base.entries.some((entry) => entry.family === component.family && entry.code === code);
}

/** The sign a line carries into a base: its landing, never a stated effect. */
const effectOf = (item: PricedItem): ContributionLine['effect'] =>
	item.bucket === 'ABSENCE' || item.bucket === 'DEDUCTION' ? 'REDUCE' : 'INCLUDE';

/** Every family supplies its own priced line; Contribution reads each scheme's declaration and nothing else. */
export function accumulateBases(options: {
	readonly configuration: Configuration;
	readonly items: readonly PricedItem[];
	readonly employeeNumber: string;
}): ContributionBase[] {
	return options.configuration.contributions.map((contribution) => {
		let base = 0;
		const lines: ContributionLine[] = [];
		for (const item of options.items) {
			if (item.amount === 0 || !baseAdmits(contribution.row.base, item)) continue;
			const effect = effectOf(item);
			lines.push({
				code: item.catalogueComponent.code,
				label: item.label,
				effect,
				amount: item.amount
			});
			base += effect === 'REDUCE' ? -item.amount : item.amount;
		}
		return { contribution, base: cents(Math.max(0, base)), lines };
	});
}
