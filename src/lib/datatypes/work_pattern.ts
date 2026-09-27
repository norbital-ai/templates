/**
 * The employment's one schedule term: a repeating cycle of roster codes anchored at the pattern row's
 * effective start, or — where no cycle can be generated — a declared week (days, and the paid
 * minutes a week the roster must supply or may not exceed).
 */
export type WorkPattern =
	| { readonly days: readonly { readonly roster_code_id: string }[] }
	| {
			readonly expectation: {
				/** 1–7; a half day is an alternate-Saturday week (5.5). */
				readonly days_per_week: number;
				readonly minimum_paid_minutes_per_week: number | null;
				readonly maximum_paid_minutes_per_week: number | null;
			};
	  };
