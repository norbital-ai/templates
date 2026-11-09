/** The weekly rest days of a normal week: none on a seven-day roster, Sunday on six, Saturday and Sunday on five. */
export const weeklyRestDays = (daysPerWeek: number): ReadonlySet<number> =>
	new Set(daysPerWeek >= 7 ? [] : daysPerWeek >= 6 ? [0] : [0, 6]);
