type Codes = readonly string[] | null;

/** The return item a settled class is reported on (SG Form IR8A items a–d8 and deductions). */
export const INCOME_RETURN_ITEMS = [
	'A_SALARY',
	'B_CONTRACTUAL_BONUS',
	'B_NON_CONTRACTUAL_BONUS',
	'C_DIRECTOR_FEES',
	'D1_ALLOWANCE',
	'D1_OCLA',
	'D2_COMMISSION',
	'D3_LUMP_SUM',
	'COMPENSATION_FOR_LOSS_OF_OFFICE',
	'D4_PENSION',
	'D5_OVERSEAS_PENSION_FUND',
	'D7_GAINS_S10_1_B',
	'D7_GAINS_S10_1_G',
	'D8_BENEFITS_IN_KIND',
	'DONATION',
	'LIFE_INSURANCE',
	'NOT_INCOME'
] as const;
export type IncomeReturnItem = (typeof INCOME_RETURN_ITEMS)[number];

/** How settled payslips become the employer's annual employment-income return. */
export type IncomeReturnSettings = {
	readonly form: 'IR8A';
	/** Class code → item; an unnamed earning is item a, an unnamed allowance item d1. */
	readonly items: readonly { readonly code: string; readonly item: IncomeReturnItem }[];
	/** The scheme whose employee share is the compulsory-contribution deduction. */
	readonly compulsory_scheme: string;
	/** Schemes whose employee share is a donation deducted from salary. */
	readonly donation_schemes: readonly string[];
	/** A combined fund whose Mosque Building part is reported apart, the rest as a donation. */
	readonly mosque_fund?: {
		readonly scheme: string;
		readonly allocation: readonly { readonly total: number; readonly mosque: number }[];
		readonly authority: string;
	} | null;
	readonly authority: string;
};

/**
 * The payroll facts of one jurisdiction settings version: currency, the IANA zone of its wall clock
 * (a punch is an instant, a shift start a wall-clock time), the month its tax year opens and whether
 * unpaid leave prorates a standing allowance.
 */
export type PayrollSettings = {
	readonly currency: string;
	readonly timezone: string;
	readonly tax_year_start_month: number;
	/**
	 * The default for whether a standing allowance loses its unpaid-leave days; a class overrules it
	 * with `allowance_catalogue.npl_prorates` (SG EA s.2 travel, food, housing; MY travelling).
	 */
	readonly allowance_npl_prorates: boolean;
	/** Contractual wage months before exit used by a separation-pay catalogue (VN Decree 145 art.8(5)). */
	readonly separation_wage_average_months?: number | null;
	/** Configured days after the last day of work for the final-pay warning; absent is no rule. */
	readonly final_pay_due_days?: number | null;
	/** Final-pay deadlines per circumstance; `when` is CEL over the leaver, empty the default. */
	readonly final_pay_deadlines?:
		| readonly {
				readonly when: string;
				readonly days: number;
				/** `WORKING_DAYS` counts scheduled workdays; `NON_REST_HOLIDAY_DAYS` also counts off days (SG EA s.22). */
				readonly basis:
					'EVENT_DATE' | 'MONTH_END' | 'NEXT_PAYDAY' | 'WORKING_DAYS' | 'NON_REST_HOLIDAY_DAYS';
				readonly authority: string;
		  }[]
		| null;
	/**
	 * The most the employer may deduct from a payslip's pay (MY EA s.24(8), SG EA s.32, ID PP
	 * 36/2021 art.65, VN Labour Code art.102(3)). Whole loan recoveries past it stay outstanding.
	 */
	readonly deduction_ceiling?: {
		/** The share of the base the counted deductions may reach: `0.5` is half. */
		readonly share: number;
		readonly assessment_period?: 'PAY_PERIOD' | 'MONTH' | null;
		readonly basis: 'GROSS' | 'NET_OF_STATUTORY';
		/** Only these statutory charges reduce a net base; absent means every employee charge. */
		readonly basis_statutory_codes?: Codes;
		/** Whether the employee's statutory charges count (SG CPF, s.27(1)(h)). */
		readonly counts_statutory: boolean;
		/** Whether loan and advance recoveries count (SG s.32 exempts s.27(1)(f)). */
		readonly counts_loans: boolean;
		/** Independent cap per loan instalment; also applies to final pay (SG EA s.31). */
		readonly loan_instalment_share?: number | null;
		readonly group_limits?:
			| readonly {
					readonly codes: readonly string[];
					/** A damage incident has its own limit; accommodation and services share one. */
					readonly per_entry?: boolean | null;
					readonly share: number;
					readonly assessment_period: 'PAY_PERIOD' | 'MONTH';
			  }[]
			| null;
		readonly basis_exempt_codes?: Codes;
		readonly uncapped_payment_codes?: Codes;
		readonly loan_instalment_exempt_codes?: Codes;
		readonly advance_recovery?: {
			readonly codes: readonly string[];
			readonly months: number;
			readonly first_full_period?: boolean | null;
			readonly unrecoverable_before_employment_codes?: Codes;
		} | null;
		/** Extra room usable only by the named loan classes with a recorded approval. */
		readonly approved_loan_extension?: {
			readonly codes: readonly string[];
			readonly share: number;
		} | null;
		readonly exempt_codes: readonly string[];
		/** Whether the whole final payslip is outside the ceiling (SG s.32(2)). */
		readonly final_pay_exempt: boolean;
		/** Recoveries taken from the final payslip are outside it (MY s.24(9)(b)). */
		readonly final_pay_exempts_loans?: boolean | null;
		readonly final_pay_exempt_codes?: Codes;
		readonly authority: string;
	} | null;
	/** Exit clearance before final money is released: a match raises an open disbursement hold. */
	readonly tax_clearance?: {
		readonly when: string;
		readonly category:
			'TAX_CLEARANCE' | 'COURT_ORDER' | 'AGENCY_DIRECTION' | 'EMPLOYEE_DISPUTE' | 'OTHER';
		readonly reference_label: string;
		readonly max_withhold_days?: number | null;
		readonly tax_payment_days?: number | null;
		readonly authority: string;
	} | null;
	/** A public holiday enclosed by requested no-pay leave is unpaid (SG EA s.88(2)). */
	readonly holiday_in_no_pay_leave_unpaid?: boolean | null;
	/** An unworked special day earns the daily/hourly-paid nothing (PH DOLE Handbook ch.3 §C). */
	readonly special_holiday_unworked_unpaid?: boolean | null;
	/** An unworked regular holiday needs presence on the prior workday (PH Handbook ch.2 §D–E). */
	readonly regular_holiday_prior_workday?: boolean | null;
	/** A contracted day of at most this many hours is half a working day (SG EA s.20A(2)). */
	readonly short_day_half_hours?: number | null;
	readonly income_return?: IncomeReturnSettings | null;
};

const share = (value: number | null | undefined) => value == null || (value >= 0 && value <= 1);

export function payrollSettingsFault(value: PayrollSettings): string | undefined {
	if (value.currency === '' || value.timezone === '') return 'Enter the currency and timezone.';
	if ((value.final_pay_due_days ?? 1) <= 0) return 'final_pay_due_days: must be positive';
	if (
		value.separation_wage_average_months != null &&
		!(
			Number.isInteger(value.separation_wage_average_months) &&
			value.separation_wage_average_months > 0
		)
	)
		return 'separation_wage_average_months: must be a positive integer';
	if (value.final_pay_deadlines?.some((rule) => rule.days < 0 || rule.authority === ''))
		return 'final_pay_deadlines: each rule states its days and authority';
	const ceiling = value.deduction_ceiling;
	if (ceiling != null) {
		const shares = [
			ceiling.share,
			ceiling.loan_instalment_share,
			ceiling.approved_loan_extension?.share,
			...(ceiling.group_limits ?? []).map((group) => group.share)
		];
		if (!shares.every(share)) return 'deduction_ceiling: a share is between 0 and 1';
		if (ceiling.authority === '') return 'deduction_ceiling: authority is required';
		if (ceiling.advance_recovery != null && ceiling.advance_recovery.months <= 0)
			return 'deduction_ceiling: advance recovery months must be positive';
	}
	const clearance = value.tax_clearance;
	if (
		clearance != null &&
		(clearance.when === '' || clearance.reference_label === '' || clearance.authority === '')
	)
		return 'tax_clearance: when, reference label and authority are required';
	if (
		clearance?.max_withhold_days != null &&
		!(Number.isInteger(clearance.max_withhold_days) && clearance.max_withhold_days > 0)
	)
		return 'tax_clearance: max_withhold_days must be a positive integer';
	if (
		clearance?.tax_payment_days != null &&
		!(Number.isInteger(clearance.tax_payment_days) && clearance.tax_payment_days > 0)
	)
		return 'tax_clearance: tax_payment_days must be a positive integer';
	if ((value.short_day_half_hours ?? 1) <= 0) return 'short_day_half_hours: must be positive';
	const income = value.income_return;
	if (income != null && (income.compulsory_scheme === '' || income.authority === ''))
		return 'income_return: compulsory scheme and authority are required';
	if (income?.mosque_fund?.allocation.some((row) => row.mosque < 0 || row.mosque > row.total))
		return 'income_return: a Mosque Building part lies between zero and its total';
	return undefined;
}
