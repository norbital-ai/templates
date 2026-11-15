/**
 * Interest and date arithmetic, one place for every page, automation and write callback.
 *
 * - interest = principal × rate % × days ÷ day basis (360 or 365, per facility)
 * - days = due date − start date: the start day counts, the due day does not
 * - accrued days to a date count that date itself, never past the full tenor
 * - rounding to the cent is the bank's: nearest cent, or down to the cent
 *
 * Decimals cross as the platform's decimal strings; dates as ISO `YYYY-MM-DD`.
 */
import { BigDecimal, DateTime, Duration, Option } from 'effect';

export type Rounding = 'nearest_cent' | 'down_to_cent';
export type DayBasis = 'actual_360' | 'actual_365';

export const ZERO = BigDecimal.fromBigInt(0n);
export const decimal = (value: string | number) => BigDecimal.fromStringUnsafe(String(value));
export const sum = (values: Iterable<BigDecimal.BigDecimal>) => BigDecimal.sumAll(values);
/** A decimal string to `scale` places, as decimal fields take it. */
export const text = (value: BigDecimal.BigDecimal, scale = 2) =>
	BigDecimal.format(BigDecimal.round(value, { scale, mode: 'half-from-zero' }));
/** a ÷ b, or null when b is zero. */
export const ratio = (a: BigDecimal.BigDecimal, b: BigDecimal.BigDecimal) =>
	Option.getOrNull(BigDecimal.divide(a, b));

export const money = (value: BigDecimal.BigDecimal, rounding: Rounding = 'nearest_cent') =>
	BigDecimal.round(value, {
		scale: 2,
		mode: rounding === 'down_to_cent' ? 'to-zero' : 'half-from-zero'
	});

export const basisDays = (basis: DayBasis) => (basis === 'actual_365' ? 365 : 360);

const at = (date: string) => DateTime.makeUnsafe(`${date}T00:00:00Z`);
/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) =>
	Math.round(Duration.toDays(DateTime.distance(at(from), at(to))));
export const addDays = (date: string, days: number) =>
	DateTime.formatIsoDateUtc(DateTime.add(at(date), { days }));
/** The last day of the month `date` falls in. */
export const monthEnd = (date: string) =>
	DateTime.formatIsoDateUtc(DateTime.endOf(at(date), 'month'));
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export const addMonths = (date: string, months: number) =>
	DateTime.formatIsoDateUtc(DateTime.add(at(monthStart(date)), { months }));

export const tenorDays = (start: string | null, due: string | null) =>
	start === null || due === null ? null : daysBetween(start, due);

/** Interest for `days` days, rounded the way the bank rounds; null when a figure is missing. */
export function interest(
	principal: string | null,
	rate_pct: string | null,
	days: number | null,
	basis: DayBasis,
	rounding: Rounding = 'nearest_cent'
): string | null {
	if (principal === null || rate_pct === null || days === null) return null;
	const raw = BigDecimal.divideUnsafe(
		BigDecimal.multiply(BigDecimal.multiply(decimal(principal), decimal(rate_pct)), decimal(days)),
		decimal(100 * basisDays(basis))
	);
	return text(money(raw, rounding));
}

/** Days of interest earned by the close of `as_of`: that day counts; capped at the tenor, never negative. */
export function accruedDays(start: string | null, due: string | null, as_of: string) {
	if (start === null || due === null || as_of < start) return 0;
	return Math.min(daysBetween(start, as_of) + 1, daysBetween(start, due));
}
