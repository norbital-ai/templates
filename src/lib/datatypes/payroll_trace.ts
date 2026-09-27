/**
 * How one run's statutory charges were derived: per payslip, per charge, the priced lines that fed
 * its base, the producers it read, the rule that governed and the two shares. Every figure is copied
 * from the charge the engine wrote; this is the audit trail, not a second calculation.
 */

/**
 * One band slice of overtime taken as time off (`work_days.time_off_in_lieu`): credited when the day
 * settled (`paid` false), or paid out when untaken past expiry or the contract's end (TW 勞基法 §32-1).
 */
export type InLieuSlice = {
	readonly work_day_id: string;
	readonly date: string;
	readonly line: string;
	readonly label: string;
	readonly hours: number;
	readonly rate: number;
	readonly amount: number;
	readonly paid: boolean;
};

export type PayrollTrace = readonly {
	readonly employment_id: string;
	readonly employee_number: string;
	readonly schemes: readonly {
		readonly scheme_code: string;
		/** The governing rule's `when`, or null where the scheme charged at zero. */
		readonly rule_when?: string | null;
		/** Liability history the selected rule used, kept apart from later declarations. */
		readonly first_contribution_due_on?: string | null | undefined;
		readonly base_amount: number;
		readonly ordinary_amount?: number | null | undefined;
		readonly assessment_frequency?: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY' | null;
		readonly employee_amount: number;
		readonly employer_amount: number;
		/** The priced lines whose signed sum is the base, in accumulation order. */
		readonly inputs: readonly {
			readonly code: string;
			readonly label: string;
			readonly effect: 'INCLUDE' | 'REDUCE';
			readonly amount: number;
		}[];
		/** The `produced.<code>` reads this charge made, in first-mention order. */
		readonly reads: readonly {
			readonly code: string;
			readonly employee_amount: number;
			/** The normal-pay relief when it differs from the full additional-pay calculation. */
			readonly ordinary_employee_amount?: number | null | undefined;
			readonly employer_amount: number;
		}[];
	}[];
	/** Overtime settled by calendar month per limit (`''` the regulated count), for later quarters. */
	readonly overtime_hours?:
		| readonly {
				readonly limit: string;
				readonly month: string;
				readonly hours: number;
		  }[]
		| null;
	readonly time_off_in_lieu?: readonly InLieuSlice[] | null;
	/** The window's overtime days and minimum wage, bounding a later run's de minimis ceiling. */
	readonly overtime_days?: number | null;
	readonly minimum_wage?: number | null;
}[];
