/**
 * One statutory scheme's charge on a payslip: employee and employer shares of one pass over one
 * wage, named by the scheme's code (the rules in force are in the run's configuration snapshot).
 */
export type PayslipStatutory = {
	readonly scheme_code: string;
	readonly authority?: string | null;
	readonly label?: string | null;
	readonly listing_order?: number | null;
	readonly listing_group?: string | null;
	readonly base_amount: number;
	/** The ordinary part, where the scheme states `ordinary_on`; summed into `year_to_date.ordinary`. */
	readonly ordinary_amount?: number | null;
	readonly assessment_frequency?: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY' | null;
	/** Negative in a year-end refund month. */
	readonly employee_amount: number;
	readonly employer_amount: number;
	/** Directed instalments added after the ladder, already inside `employee_amount`. */
	readonly directed_amount?: number | null;
	readonly rebate_amount?: number | null;
	readonly rule_when?: string | null;
	readonly payment_occasion?: boolean | null;
};
