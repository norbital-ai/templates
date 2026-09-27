/** The calendar's kinds of day; DOUBLE_HOLIDAY is two regular holidays on one date. */
export const HOLIDAY_KINDS = [
	'PUBLIC_HOLIDAY',
	'SPECIAL_HOLIDAY',
	'SUBSTITUTE',
	'DOUBLE_HOLIDAY'
] as const;

/** One holiday exactly as a payroll run read it: values as well as the id, so a replay needs no live read. */
export type HolidaySnapshot = {
	readonly id: string;
	readonly company_id: string;
	readonly date: string;
	readonly name: string;
	readonly kind: (typeof HOLIDAY_KINDS)[number];
	readonly replaces?: string | null;
	readonly given_to: 'EVERYONE' | 'ONLY_IF_OFF_ON_REPLACED_DATE';
	readonly published_at: string;
};
