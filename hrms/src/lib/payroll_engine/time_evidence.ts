import { BigDecimal, DateTime, Duration, Option } from 'effect';
import { isJsonObject, Refusal, type JsonObject } from './foundation.js';
import { objectValue, valueText } from './reads.js';
export interface TimeSpan {
	readonly start: number;
	readonly end: number;
}
// an instant is a stored ISO text with its offset, or the epoch milliseconds a run already worked out
const instant = (value: unknown): number => {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	const made =
		typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value)
			? DateTime.make(value)
			: Option.none();
	if (Option.isNone(made))
		throw new Refusal({
			message: 'An interval requires actual instants with explicit UTC offsets.'
		});
	return DateTime.toEpochMillis(made.value);
};
export const elapsedMinutes = (start: unknown, end: unknown): number => {
	const a = instant(start),
		b = instant(end);
	if (b < a) throw new Refusal({ message: 'An interval ends before it starts.' });
	return Duration.toMinutes(Duration.millis(b - a));
};
// rows are decoded once where they are read: here only their shape is checked
const rowsOf = (value: unknown): readonly JsonObject[] => {
	if (value == null) return [];
	if (!Array.isArray(value) || !value.every(isJsonObject))
		throw new Refusal({ message: 'Work intervals must be a list of intervals.' });
	return value;
};
export function intervalSpans(value: unknown, as_of?: unknown): readonly TimeSpan[] {
	let previousEnd = -Infinity;
	return rowsOf(value)
		.toSorted((a, b) => instant(a.start) - instant(b.start))
		.flatMap((row) => {
			const start = instant(row.start),
				end = instant(row.end ?? as_of);
			if (end < start || (end === start && row.end != null) || start < previousEnd)
				throw new Refusal({ message: 'Work intervals must be positive and nonoverlapping.' });
			previousEnd = end;
			const breaks = rowsOf(row.breaks)
				.map((b) => ({ start: instant(b.start), end: instant(b.end) }))
				.toSorted((a, b) => a.start - b.start);
			if (
				row.break_minutes != null &&
				(typeof row.break_minutes !== 'number' ||
					!Number.isFinite(row.break_minutes) ||
					row.break_minutes < 0 ||
					row.break_minutes !==
						BigDecimal.toNumberUnsafe(
							BigDecimal.sumAll(
								breaks.map((b) =>
									BigDecimal.fromNumberUnsafe(Duration.toMinutes(Duration.millis(b.end - b.start)))
								)
							)
						))
			)
				throw new Refusal({
					message: 'A break total must equal its original dated break intervals.'
				});
			let from = start;
			const result: TimeSpan[] = [];
			for (const pause of breaks) {
				if (pause.start < from || pause.end <= pause.start || pause.end > end)
					throw new Refusal({ message: 'Breaks must be nonoverlapping and inside the interval.' });
				if (pause.start > from) result.push({ start: from, end: pause.start });
				from = pause.end;
			}
			if (from < end) result.push({ start: from, end });
			return result;
		});
}
export const intervalMinutes = (value: unknown, as_of?: unknown): number =>
	BigDecimal.toNumberUnsafe(
		BigDecimal.sumAll(
			intervalSpans(value, as_of).map((s) =>
				BigDecimal.fromNumberUnsafe(Duration.toMinutes(Duration.millis(s.end - s.start)))
			)
		)
	);
// a night window's edges are the same for everyone who worked that date
const clocks = new Map<string, number>();
const clockAt = (date: string, time: string, zone: string) => {
	const key = `${zone} ${date} ${time}`;
	const held = clocks.get(key);
	if (held !== undefined) return held;
	if (!/^\d{2}:\d{2}$/.test(time))
		throw new Refusal({ message: 'A local clock window requires HH:mm.' });
	const parsed = DateTime.makeZoned(`${date}T${time}:00`, {
		timeZone: zone,
		adjustForTimeZone: true,
		disambiguation: 'compatible'
	});
	if (Option.isNone(parsed))
		throw new Refusal({ message: 'The local clock window cannot resolve its time zone.' });
	const found = DateTime.toEpochMillis(parsed.value);
	if (clocks.size >= 20_000) clocks.clear();
	clocks.set(key, found);
	return found;
};
export function clockWindowMinutes(
	value: unknown,
	zone: string,
	start_time: string,
	end_time: string,
	as_of?: unknown
): number {
	let total = 0;
	for (const span of intervalSpans(value, as_of)) {
		const last = DateTime.formatIsoDate(DateTime.makeZonedUnsafe(span.end, { timeZone: zone }));
		let day = DateTime.subtract(
			DateTime.removeTime(DateTime.makeZonedUnsafe(span.start, { timeZone: zone })),
			{ days: 1 }
		);
		for (
			let count = 0, date = DateTime.formatIsoDate(day);
			date <= last;
			day = DateTime.add(day, { days: 1 }), date = DateTime.formatIsoDate(day), count++
		) {
			if (count > 370) throw new Refusal({ message: 'Split intervals spanning more than a year.' });
			const start = clockAt(date, start_time, zone),
				end = clockAt(
					start_time < end_time ? date : DateTime.formatIsoDate(DateTime.add(day, { days: 1 })),
					end_time,
					zone
				);
			total += Duration.toMinutes(
				Duration.millis(Math.max(0, Math.min(span.end, end) - Math.max(span.start, start)))
			);
		}
	}
	return total;
}
export function dateWeekday(value: string): number {
	const day = DateTime.make(value);
	if (Option.isNone(day) || DateTime.formatIsoDate(day.value) !== value)
		throw new Refusal({ message: 'A weekday requires an actual calendar date.' });
	return DateTime.getPartUtc(day.value, 'weekDay');
}
export function addWorkingDays(
	value: string,
	count: number,
	holidays: readonly unknown[],
	rest: readonly number[],
	working_dates: readonly string[] = []
): string {
	if (
		!Option.exists(DateTime.make(value), (d) => DateTime.formatIsoDate(d) === value) ||
		!Number.isInteger(count) ||
		Math.abs(count) > 1000 ||
		(new Set(rest).size === 7 && working_dates.length === 0) ||
		rest.some((n) => !Number.isInteger(n) || n < 0 || n > 6)
	)
		throw new Refusal({
			message:
				'Working-day offsets require an explicit reachable calendar and bounded integer count.'
		});
	const dates = new Set(
		holidays.map((h) => (typeof h === 'string' ? h : valueText(objectValue(h), 'date')))
	);
	const working = new Set(working_dates);
	if (
		working_dates.some(
			(date) => !Option.exists(DateTime.make(date), (d) => DateTime.formatIsoDate(d) === date)
		)
	)
		throw new Refusal({ message: 'Working-date exceptions require actual dates.' });
	let day: string = value,
		remaining = Math.abs(count);
	for (let seen = 0; remaining > 0; seen++) {
		if (seen > 10000)
			throw new Refusal({ message: 'The business calendar cannot reach its deadline.' });
		day = DateTime.formatIsoDate(
			DateTime.add(DateTime.makeUnsafe(day), { days: count < 0 ? -1 : 1 })
		);
		if (working.has(day) || (!rest.includes(dateWeekday(day)) && !dates.has(day))) remaining--;
	}
	return day;
}

export function addMinutes(value: string, count: number): string {
	if (!Number.isFinite(count) || Math.abs(count) > 527040)
		throw new Refusal({ message: 'An instant offset must be finite and within one year.' });
	return DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(instant(value)), { minutes: count }));
}
