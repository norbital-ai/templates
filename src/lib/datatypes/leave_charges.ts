/** One approved time-off charge; `days` is a whole or half day, or an eighth for an hourly row. */
export type LeaveCharge = {
	readonly date: string;
	readonly days: number;
	/** Approved portion beyond the funded shared leave pool, frozen at approval. */
	readonly unpaid_days?: number | null;
	/** Actual scheduled hours consumed, for an hourly entitlement. */
	readonly hours?: number | null;
	readonly catalogue_id: string;
	readonly employment_term_id: string;
	/** The published holiday that excluded the day from the charge, when one did. */
	readonly holiday_id?: string | null;
	/** A calendar-day leave charge can fall on a day with no roster code. */
	readonly shift_definition_id?: string | null | undefined;
	readonly work_day_id?: string | null;
};
