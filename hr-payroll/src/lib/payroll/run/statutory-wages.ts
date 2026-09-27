/**
 * The statutory wage comparand: what a wage ceiling in an overtime-eligibility predicate is
 * measured against, read in expressions as `terms.statutory_wages`.
 *
 * A dated catalogue marks the cash classes that count under the Employment Act First Schedule.
 * The comparand stays separate from general WAGES history: commission can be wages under s.2
 * while paragraph 3 removes it from the Schedule's RM4,000 coverage threshold.
 */

import type { MoneyValue } from './rounding.js';

/**
 * A catalogue membership for cash wages in the EA 1955 First Schedule comparand. It is distinct
 * from WAGES, the general earnings-history membership, because Schedule paragraph 3 excludes
 * commission, subsistence allowance and overtime even if they are otherwise cash wages.
 */
export const FIRST_SCHEDULE_WAGES = 'FIRST_SCHEDULE_WAGES';

type WageComparandCategory = 'BASIC_WAGES' | 'CASH_FOR_WORK' | 'NOT_WAGES';

type WageComparandComponent = {
	readonly destination: string | null;
	readonly direction: string | null;
	readonly definition: {
		readonly source: string;
	} | null;
	readonly counts_toward?: readonly string[] | null | undefined;
};

/** Classify one component for the wage comparand. See `WageComparandCategory`. */
export function classifyWageComparand(component: WageComparandComponent): WageComparandCategory {
	const source = component.definition?.source;
	if (source === 'SCHEDULE') return 'BASIC_WAGES';
	if (
		component.destination === 'PAY' &&
		component.direction !== 'SUBTRACT' &&
		component.counts_toward?.includes(FIRST_SCHEDULE_WAGES)
	)
		return 'CASH_FOR_WORK';
	return 'NOT_WAGES';
}

/**
 * The First Schedule comparand: basic wages plus marked cash payments for work done.
 *
 * The amounts passed in are the signed entry totals settling in this run for each component — the
 * contractual monthly figures, **not** prorated amounts. The ceiling asks what a person's wages
 * *are* a month, not what a partial month happened to pay: a joiner on RM5,000 earns RM5,000 a
 * month from the day they join, and prorating the comparand would cover them for one month and
 * uncover them the next.
 */
type DeriveStatutoryWagesOptions = {
	readonly baseSalary: MoneyValue;
	readonly payments: readonly {
		readonly category: WageComparandCategory;
		readonly amount: number;
	}[];
};

export function deriveStatutoryWages(options: DeriveStatutoryWagesOptions): MoneyValue {
	const cashForWork = options.payments
		.filter((payment) => payment.category === 'CASH_FOR_WORK')
		.reduce((total, payment) => total + payment.amount, 0);
	return {
		value: options.baseSalary.value + cashForWork,
		currency: options.baseSalary.currency
	};
}
