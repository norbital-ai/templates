/**
 * The statutory wage comparand: what a wage ceiling in an overtime-eligibility predicate is
 * measured against, read in expressions as `terms.statutory_wages`.
 *
 * Nothing here is hard-coded to a jurisdiction; it classifies a pay component against the
 * statute's own definition of wages so that a version's `overtime_when` can compare the figure the
 * statute names rather than a convenient salary column.
 */

import { Schema } from 'effect';
import type { MoneyValue } from '@norbital-ai/std/finance';

/**
 * One component classified against the statutory definition of "wages".
 *
 * Employment Act 1955 s.2 defines wages as basic wages **and all other cash payments for work
 * done**, and First Schedule para 3 then reads "wages" for the Schedule as that figure less
 * commissions, subsistence allowance and overtime payment. The categories below are that
 * definition, expressed over what a component row can say:
 *
 * - `BASIC_WAGES`   — the contracted wage from `employment_terms` (source `SCHEDULE`).
 * - `CASH_FOR_WORK` — an `EARNING` component: any other cash payment for work done.
 * - `NOT_WAGES`     — everything else: information, deductions, absences, employer costs, and
 *                     `NON_WAGE_PAYMENT` reimbursements, none of which is a cash payment for work.
 *
 * Para 3's third exclusion, overtime payment, needs no category. Overtime is not a component at
 * all — it is derived from `work_days` against the version's bands — so it is never in the set
 * being classified, and the comparand excludes it structurally rather than by filtering it back
 * out.
 *
 * Two para 3 exclusions the component model cannot express: **commissions and subsistence
 * allowance have no category of their own.** A commission paid through an `EARNING` component is
 * counted in the comparand even though the statute takes it out. The seeded catalogues contain no
 * commission or subsistence component, so no shipped population is affected by the gap — but a
 * company that adds one must know the comparand will overstate until the model carries the
 * distinction.
 */
const WageComparandCategorySchema = Schema.Literals(['BASIC_WAGES', 'CASH_FOR_WORK', 'NOT_WAGES']);
type WageComparandCategory = Schema.Schema.Type<typeof WageComparandCategorySchema>;

const WageComparandComponentSchema = Schema.Struct({
	destination: Schema.NullOr(Schema.String),
	direction: Schema.NullOr(Schema.String),
	definition: Schema.NullOr(Schema.Struct({ source: Schema.String })),
	fixed: Schema.optional(Schema.NullOr(Schema.Boolean))
});
type WageComparandComponent = Schema.Schema.Type<typeof WageComparandComponentSchema>;

/** Classify one component for the wage comparand. See `WageComparandCategory`. */
export function classifyWageComparand(component: WageComparandComponent): WageComparandCategory {
	const source = component.definition?.source;
	if (source === 'SCHEDULE') return 'BASIC_WAGES';
	// A row not granted wholly for the month — a bonus (s.2(f)), a back payment, a separation
	// payment — is not the month's cash payment for work done.
	if (component.fixed === false) return 'NOT_WAGES';
	if (component.destination === 'PAY' && component.direction !== 'SUBTRACT') return 'CASH_FOR_WORK';
	return 'NOT_WAGES';
}

/**
 * The s.2 comparand: basic wages plus every other cash payment for work done, less overtime pay.
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
