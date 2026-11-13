import { BigDecimal, DateTime } from 'effect';
import type { CurrencyCode } from '@norbital-ai/bolt';

/** A figure to compute with. Decimal fields hold their exact text; maths is Effect's `BigDecimal`. */
export type D = BigDecimal.BigDecimal;
/** A decimal field's text, an integer, or a figure already being computed. */
export type DecimalLike = D | string | number;

/** A field's text or an integer as a figure; a figure passes through. */
export const dec = (value: DecimalLike): D =>
	typeof value === 'string'
		? BigDecimal.fromStringUnsafe(value)
		: typeof value === 'number'
			? BigDecimal.fromNumberUnsafe(value)
			: value;

/** Rounded half away from zero (Postgres `round(numeric)`) to `scale` places. */
export const round = (
	value: DecimalLike,
	scale: number,
	mode: BigDecimal.RoundingMode = 'half-from-zero'
): D => BigDecimal.round(dec(value), { scale, mode });

/** `a / b` rounded to `scale` places. */
export const div = (
	a: DecimalLike,
	b: DecimalLike,
	scale: number,
	mode: BigDecimal.RoundingMode = 'half-from-zero'
): D => round(BigDecimal.divideUnsafe(dec(a), dec(b)), scale, mode);

/** The exact total; `0` for none. */
export const sum = (values: Iterable<DecimalLike>): D => BigDecimal.sumAll(Array.from(values, dec));

/** The text a decimal field stores, keeping the figure's scale (`1.20` stays `1.20`). */
export const text = (value: DecimalLike): string => {
	const d = dec(value);
	if (d.scale <= 0) return (d.value * 10n ** BigInt(-d.scale)).toString();
	const negative = d.value < 0n;
	const digits = (negative ? -d.value : d.value).toString().padStart(d.scale + 1, '0');
	const cut = digits.length - d.scale;
	return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
};

/** An ISO 4217 code the runtime knows. */
export const isCurrency = (code: string): code is CurrencyCode =>
	/^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf('currency').includes(code);

/** ISO 4217 minor-unit digits (JPY 0, SGD 2, KWD 3). */
export const minorDigits = (currency: string): number =>
	new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
		.maximumFractionDigits ?? 2;

/** The calendar day `days` after `date` (before, when negative). */
export const addDays = (date: string, days: number): string =>
	DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(date), { days }));

/** Calendar months after `date`, clamped to the target month's last day. */
export const addMonths = (date: string, months: number): string =>
	DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(date), { months }));
