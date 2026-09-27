import type { ProrationBasis } from './proration_basis.js';

/**
 * One segment of what the calendar did to a base amount: one `employment_terms` row over part of the
 * period, prorated against the full-period denominator. Every input is stored beside its result
 * (`contract_amount × days / denominator = prorated_amount`) so the payslip stays re-readable.
 */
export type PayslipProration = {
	/** The base line this segment is the working of: the wage's code, or an allowance class's. */
	readonly component_code: string;
	/** The terms' title with the day its range opens: a frozen label, not an id. */
	readonly term_key: string;
	readonly from: string;
	readonly to: string;
	readonly basis: ProrationBasis;
	readonly days: number;
	readonly denominator: number;
	/** Unpaid-leave days taken off `days` for an allowance; 0 on the wage. */
	readonly unpaid_days: number;
	readonly contract_amount: number;
	readonly prorated_amount: number;
};
