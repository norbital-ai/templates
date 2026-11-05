import { addDays } from '@norbital-ai/std/date';
import type { JsonObject } from './contracts.js';
import { objectValue, valueText } from './reads.js';

/** `date` + clock time in an IANA zone, as epoch milliseconds. */
const instant = (date: string, time: string, zone: string): number => {
	const guess = Date.parse(`${date}T${time}:00Z`);
	const shown = new Intl.DateTimeFormat('en-CA', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	})
		.formatToParts(new Date(guess))
		.map((part) => part.value);
	const [year, month, day, hour, minute, second] = shown;
	return guess - (Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!, +second!) - guess);
};

/** The planned shift for one roster day, or an untimed/non-work day. */
export function scheduled(
	row: JsonObject,
	data: { readonly zone: string; readonly shift?: JsonObject }
): {
	readonly spans: readonly { readonly start: number; readonly end: number }[];
	readonly day_type: 'WORK' | 'REST' | 'OFF';
	readonly untimed: number;
} {
	const variant = data.shift === undefined ? null : objectValue(data.shift.variant);
	const dayType = row.day_type ?? variant?.day_type;
	const day_type: 'WORK' | 'REST' | 'OFF' =
		dayType === 'REST' || dayType === 'OFF' ? dayType : 'WORK';
	if (day_type !== 'WORK') return { spans: [], day_type, untimed: 0 };
	const untimed = typeof variant?.untimed_hours === 'number' ? variant.untimed_hours : 0;
	if (variant == null || variant.start_time == null || variant.end_time == null)
		return { spans: [], day_type, untimed };
	const date = valueText(row, 'work_date');
	const endDate = variant.ends_next_day === true ? String(addDays(date, 1)) : date;
	const start = instant(date, String(variant.start_time), data.zone);
	const end = instant(endDate, String(variant.end_time), data.zone);
	return { spans: end > start ? [{ start, end }] : [], day_type, untimed };
}

/** The published holidays observed on a day. */
export function holidaysForDay(
	day: string,
	data: {
		readonly holidays: readonly JsonObject[];
		readonly roster_day_types?: Readonly<Record<string, string>>;
		readonly roster_days: readonly JsonObject[];
	}
): readonly JsonObject[] {
	return data.holidays.filter(
		(holiday) =>
			holiday.date === day &&
			holiday.published_at != null &&
			(holiday.given_to !== 'ONLY_IF_OFF_ON_REPLACED_DATE' ||
				data.roster_day_types?.[String(holiday.replaces)] !== 'WORK')
	);
}
