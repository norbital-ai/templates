/** One approved time-off charge; `days` is a whole or half day, or an eighth for an hourly row. */
export type LeaveCharge = {
	readonly date: string;
	readonly days: number;
	readonly catalogue_id: string;
	readonly employment_term_id: string;
	/** The published holiday that excluded the day from the charge, when one did. */
	readonly holiday_id?: string | null;
	readonly shift_definition_id: string;
	readonly work_day_id?: string | null;
};
