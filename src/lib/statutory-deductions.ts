import type { StatutoryDeductionClaim } from '../datatypes/statutory_fact_status/+definition.js';

export const DEDUCTION_TOTAL_KEYS = [
	'deductions',
	'deductions_current',
	'deductions_prior',
	'deductions_prior_employer',
	'deduction_claim_counts',
	'deduction_claims_missing_event',
	'deduction_claims_negative_event',
	'deductions_last_year',
	'deductions_two_years_ago'
] as const;

/** Raw declared amounts, before the selected rule applies its shared limits and sublimits. */
export function deductionTotals(
	claims: readonly StatutoryDeductionClaim[],
	yearStart: string,
	period: string
): Record<(typeof DEDUCTION_TOTAL_KEYS)[number], Record<string, number>> {
	const totals = {
		deductions: {} as Record<string, number>,
		deductions_current: {} as Record<string, number>,
		deductions_prior: {} as Record<string, number>,
		deductions_prior_employer: {} as Record<string, number>,
		deduction_claim_counts: {} as Record<string, number>,
		deduction_claims_missing_event: {} as Record<string, number>,
		deduction_claims_negative_event: {} as Record<string, number>,
		deductions_last_year: {} as Record<string, number>,
		deductions_two_years_ago: {} as Record<string, number>
	};
	const start = yearStart.slice(0, 7);
	const month = period.slice(0, 7);
	const previous = `${Number(start.slice(0, 4)) - 1}${start.slice(4)}`;
	const earlier = `${Number(start.slice(0, 4)) - 2}${start.slice(4)}`;
	const add = (target: Record<string, number>, claim: StatutoryDeductionClaim) => {
		target[claim.category] = (target[claim.category] ?? 0) + claim.amount;
	};
	const events = new Map<string, { category: string; amount: number }>();
	for (const claim of claims) {
		if (claim.period > month) continue;
		if (claim.period >= start) {
			add(totals.deductions, claim);
			if (claim.source === 'PRIOR_EMPLOYER') add(totals.deductions_prior_employer, claim);
			const event = claim.event_reference?.trim();
			if (!event)
				totals.deduction_claims_missing_event[claim.category] =
					(totals.deduction_claims_missing_event[claim.category] ?? 0) + 1;
			const key = JSON.stringify([claim.category, event || claim.reference.trim()]);
			events.set(key, {
				category: claim.category,
				amount: (events.get(key)?.amount ?? 0) + claim.amount
			});
			add(
				claim.period === month && claim.source === 'EMPLOYEE'
					? totals.deductions_current
					: totals.deductions_prior,
				claim
			);
		} else if (claim.period >= previous) add(totals.deductions_last_year, claim);
		else if (claim.period >= earlier) add(totals.deductions_two_years_ago, claim);
	}
	for (const { category, amount } of events.values()) {
		if (amount < 0)
			totals.deduction_claims_negative_event[category] =
				(totals.deduction_claims_negative_event[category] ?? 0) + 1;
		else if (amount > 0)
			totals.deduction_claim_counts[category] = (totals.deduction_claim_counts[category] ?? 0) + 1;
	}
	return totals;
}
