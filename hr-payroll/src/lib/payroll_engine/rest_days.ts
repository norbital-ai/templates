import { addDays, PlainDate } from '@norbital-ai/std/date';

/** The weekly rest days of a normal week: none on a seven-day roster, Sunday on six, Saturday and Sunday on five. */
export const weeklyRestDays = (daysPerWeek: number): ReadonlySet<number> =>
	new Set(daysPerWeek >= 7 ? [] : daysPerWeek >= 6 ? [0] : [0, 6]);

const weekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

/**
 * Employment Act 1955 s.60D(1): a public holiday that falls on a rest day gives the next working day in substitution.
 * A substitute holiday itself and a makeup workday are not holidays to substitute.
 */
export const restDaySubstitutions = (
	holidays: readonly { readonly date: string; readonly kind?: string }[],
	restDays: ReadonlySet<number>
): ReadonlySet<string> => {
	const named = new Set(holidays.map((holiday) => String(holiday.date)));
	const result = new Set<string>();
	for (const holiday of holidays) {
		if (holiday.kind === 'MAKEUP_WORKDAY' || holiday.kind === 'SUBSTITUTE') continue;
		if (!restDays.has(weekday(String(holiday.date)))) continue;
		let day = addDays(PlainDate(String(holiday.date)), 1);
		for (let step = 0; step < 14; step += 1) {
			if (!restDays.has(weekday(String(day))) && !named.has(String(day))) {
				result.add(String(day));
				break;
			}
			day = addDays(day, 1);
		}
	}
	return result;
};
