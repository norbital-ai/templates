/**
 * Step 5 — ACCUMULATE.
 *
 * Each scheme declares its own wage base: whether salary, absence, overtime and
 * the night premium are in it, and which catalogue rows are. Every measured amount the
 * declaration admits joins that scheme's base with the sign of its own landing — an earning adds,
 * an absence or a deduction subtracts. A line the declaration does not admit feeds nothing.
 *
 * Each line that fed a base is kept beside it, so the run's calculation trace can name the source
 * of every figure without re-reading the payslip.
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

/**
 * Whether one scheme's declaration admits one priced line, and the annual exemption its entry
 * states: the first `annual_exempt` a tax year of that entry stays outside the base.
 */
function baseAdmits(
	base: BaseDeclaration,
	item: PricedItem
): { readonly admit: boolean; readonly annualExempt: number | null } {
	const no = { admit: false, annualExempt: null };
	const yes = { admit: true, annualExempt: null };
	// Information is not money; no scheme charges it.
	if (item.bucket === 'INFORMATION') return no;
	const component = item.catalogueComponent;
	if (component.family === 'WORK') {
		if (component.output === 'salary') return base.salary ? yes : no;
		if (component.output === 'absence') return base.absence ? yes : no;
		if (component.output === 'night') return base.night_premium ? yes : no;
		return base.overtime ? yes : no;
	}
	// An unpaid leave day is an absence; a leave row listed in `entries` is its encashment.
	if (component.family === 'LEAVE' && item.bucket === 'ABSENCE') return base.absence ? yes : no;
	const code = component.family === 'LEAVE' ? leaveRowCode(component.code) : component.code;
	const entry = base.entries.find((row) => row.family === component.family && row.code === code);
	return entry == null ? no : { admit: true, annualExempt: entry.annual_exempt ?? null };
}

/** The sign a line carries into a base: its landing, never a stated effect. */
const effectOf = (item: PricedItem): ContributionLine['effect'] =>
	item.bucket === 'ABSENCE' || item.bucket === 'DEDUCTION' ? 'REDUCE' : 'INCLUDE';

/** Every family supplies its own priced line; Contribution reads each scheme's declaration and nothing else. */
export function accumulateBases(options: {
	readonly configuration: Configuration;
	readonly items: readonly PricedItem[];
	readonly employeeNumber: string;
	/** component code → earned in earlier paid payslips this tax year, for the annual exemptions. */
	readonly yearEarned?: ReadonlyMap<string, number>;
}): ContributionBase[] {
	return options.configuration.contributions.map((contribution) => {
		let base = 0;
		const lines: ContributionLine[] = [];
		// What this run has already admitted under an exempt code, so two lines of one code share
		// one exemption and the year's earlier payslips have spent their part of it first.
		const exemptSpent = new Map<string, number>();
		for (const item of options.items) {
			if (item.amount === 0) continue;
			const admitted = baseAdmits(contribution.row.base, item);
			if (!admitted.admit) continue;
			const effect = effectOf(item);
			let amount = item.amount;
			if (admitted.annualExempt != null && effect === 'INCLUDE') {
				const code = item.catalogueComponent.code;
				const spent = (options.yearEarned?.get(code) ?? 0) + (exemptSpent.get(code) ?? 0);
				const left = Math.max(0, admitted.annualExempt - spent);
				const exempt = Math.min(amount, left);
				exemptSpent.set(code, (exemptSpent.get(code) ?? 0) + amount);
				amount = cents(amount - exempt);
				if (amount === 0) continue;
			}
			lines.push({
				code: item.catalogueComponent.code,
				label: item.label,
				effect,
				amount
			});
			base += effect === 'REDUCE' ? -amount : amount;
		}
		return { contribution, base: cents(Math.max(0, base)), lines };
	});
}
