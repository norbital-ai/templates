/** The input families a payslip settles; the provenance of every adjustment is family + source id. */
export const ADJUSTMENT_FAMILIES = [
	'WORK_DAY',
	'CLAIM',
	'ADHOC',
	'LEAVE',
	'LOAN_REPAYMENT'
] as const;

/**
 * One calculated thing a payslip settled, caused by exactly one captured input; code, label, bucket
 * and amount are frozen facts. `component_code` is the catalogue column; a derived overtime row's
 * `label` is the statutory rule key that priced it, which is work-day provenance only.
 */
export type PayslipAdjustment = {
	readonly family: (typeof ADJUSTMENT_FAMILIES)[number];
	readonly source_id: string;
	readonly component_code: string;
	readonly label: string;
	readonly bucket:
		'EARNING' | 'ABSENCE' | 'DEDUCTION' | 'NON_WAGE_PAYMENT' | 'EMPLOYER_COST' | 'INFORMATION';
	/** A magnitude, never a direction; zero is an input consumed and priced at nothing. */
	readonly amount: number;
	readonly quantity?: number | null;
	readonly rate?: number | null;
	readonly statutory_rule_key?: string | null;
};
