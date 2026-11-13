// Calendar days are `YYYY-MM-DD` text and instants ISO UTC text; their arithmetic is Effect's `DateTime`.
import { DateTime } from 'effect';
import type { Instant, PlainDate } from '@norbital-ai/bolt';

/** An inclusive period of days; `to: null` is open-ended. */
export type DatePeriod = { readonly from: PlainDate; readonly to: PlainDate | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

/** An actual four-digit Gregorian calendar day. */
export const is_plain_date = (value: unknown): value is PlainDate =>
	typeof value === 'string' &&
	DATE.test(value) &&
	DateTime.make(`${value}T00:00:00Z`).pipe(
		(made) => made._tag === 'Some' && DateTime.formatIsoDateUtc(made.value) === value
	);

/** A calendar day `YYYY-MM-DD`; anything else throws. */
export function plain_date(value: string): PlainDate {
	if (!is_plain_date(value)) throw new RangeError(`'${value}' is not a calendar date (YYYY-MM-DD)`);
	return value;
}

/** An ISO instant with a zone, or a `Date`, as canonical UTC `…Z`; anything else throws. */
export const instant = (value: string | Date): Instant =>
	DateTime.formatIso(DateTime.makeUnsafe(value));

const utc = (day: string) => DateTime.makeUnsafe(`${plain_date(day)}T00:00:00Z`);
const dayOf = (at: DateTime.DateTime): PlainDate => plain_date(DateTime.formatIsoDateUtc(at));

/** The day `n` days after `day` (before, when negative). */
export const add_days = (day: string, n: number): PlainDate =>
	dayOf(DateTime.add(utc(day), { days: n }));

/** Whole calendar months, clamped to the target month's last day. */
export function add_months(day: string, n: number): PlainDate {
	if (!Number.isInteger(n)) throw new RangeError(`${n} is not a whole number of months`);
	return dayOf(DateTime.add(utc(day), { months: n }));
}

/** An inclusive period; `to < from` throws. */
export function date_period(from: string, to: string | null): DatePeriod {
	const period = { from: plain_date(from), to: to === null ? null : plain_date(to) };
	if (period.to !== null && period.to < period.from)
		throw new RangeError(`period ends (${period.to}) before it starts (${period.from})`);
	return period;
}

/** The calendar month containing `day`, as a closed period. */
export function month_of(day: string): DatePeriod {
	const from = plain_date(`${plain_date(day).slice(0, 7)}-01`);
	return { from, to: add_days(add_months(from, 1), -1) };
}

/** Inclusive day count; an open period throws. */
export function days(period: DatePeriod): number {
	if (period.to === null) throw new RangeError('an open period has no day count');
	return (
		(DateTime.toEpochMillis(utc(period.to)) - DateTime.toEpochMillis(utc(period.from))) / DAY_MS + 1
	);
}

/** Every day of a closed period, in order; an open period throws. */
export const each_day = (period: DatePeriod): PlainDate[] =>
	Array.from({ length: days(period) }, (_, i) => add_days(period.from, i));

/**
 * An ISO instant with a zone, or a wall time `YYYY-MM-DD HH:MM[:SS]` read in `zone`, as UTC ISO text; null when the text
 * is neither.
 */
export function parse_instant(text: string, zone?: string): Instant | null {
	const s = text.trim();
	if (ISO.test(s)) {
		const made = DateTime.make(s);
		return made._tag === 'Some' ? DateTime.formatIso(made.value) : null;
	}
	const m = zone === undefined ? null : LOCAL.exec(s);
	const date = m?.[1];
	if (
		m === null ||
		m === undefined ||
		date === undefined ||
		zone === undefined ||
		!is_plain_date(date) ||
		Number(m[2]) > 23 ||
		Number(m[3]) > 59 ||
		Number(m[4] ?? 0) > 59
	)
		return null;
	return DateTime.formatIso(
		DateTime.makeZonedUnsafe(`${date}T${m[2]}:${m[3]}:${m[4] ?? '00'}`, {
			timeZone: zone,
			adjustForTimeZone: true,
			disambiguation: 'compatible'
		})
	);
}
