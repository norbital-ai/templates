/** The six holiday kinds payroll prices; a country that does not observe one never stores it. */
export const HOLIDAY_KINDS = [
	'PUBLIC_HOLIDAY',
	'SPECIAL_HOLIDAY',
	'SUBSTITUTE',
	'DOUBLE_HOLIDAY',
	'DOUBLE_SPECIAL',
	'MAKEUP_WORKDAY'
] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];
export const isHolidayKind = (value: string): value is HolidayKind =>
	(HOLIDAY_KINDS as readonly string[]).includes(value);
