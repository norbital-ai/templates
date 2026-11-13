import { BigDecimal } from 'effect';
import type { Rounding } from './contracts.js';

/** HR's rounding modes as `BigDecimal.round` names them; TRUNCATE and DOWN both go toward zero. */
export const ROUNDING_MODES = {
	HALF_UP: 'half-from-zero',
	HALF_EVEN: 'half-even',
	UP: 'from-zero',
	DOWN: 'to-zero',
	TRUNCATE: 'to-zero'
} as const satisfies Record<Rounding['mode'], BigDecimal.RoundingMode>;

// a run converts the same rates and amounts over and over; a BigDecimal is immutable, so one conversion serves them all
// ponytail: capped, not LRU; the first numbers of a run are the ones that repeat
const converted = new Map<number, BigDecimal.BigDecimal>();
/** An exact decimal from a finite number's shortest digits, a decimal text, or itself. */
export function decimal(value: number | string | BigDecimal.BigDecimal): BigDecimal.BigDecimal {
	if (BigDecimal.isBigDecimal(value)) return value;
	if (typeof value === 'string') {
		if (!/^[+-]?\d+(\.\d+)?$/.test(value.trim()))
			throw new RangeError(`'${value}' is not a decimal`);
		return BigDecimal.fromStringUnsafe(value.trim());
	}
	if (!Number.isFinite(value)) throw new Error('Money requires a finite decimal.');
	const held = converted.get(value);
	if (held !== undefined) return held;
	const made = BigDecimal.fromNumberUnsafe(value);
	// a large whole number keeps scale 0, as its digits read
	const scaled = made.scale < 0 ? BigDecimal.scale(made, 0) : made;
	if (converted.size < 50_000) converted.set(value, scaled);
	return scaled;
}
/** Its digits at its own scale (`1.20` stays `1.20`), never exponential: how a decimal field is written. */
export function decimalText(input: number | string | BigDecimal.BigDecimal): string {
	const value = decimal(input),
		negative = value.value < 0n,
		digits = (negative ? -value.value : value.value).toString().padStart(value.scale + 1, '0'),
		cut = digits.length - value.scale;
	return `${negative ? '-' : ''}${digits.slice(0, cut)}${value.scale > 0 ? `.${digits.slice(cut)}` : ''}`;
}
export const toNumber = (value: BigDecimal.BigDecimal): number => Number(decimalText(value));
export const sum = (values: readonly number[]): number =>
	toNumber(BigDecimal.sumAll(values.map((v) => decimal(v))));
export function rounded(value: number | string | BigDecimal.BigDecimal, rule: Rounding): number {
	return toNumber(
		BigDecimal.round(decimal(value), { scale: rule.scale, mode: ROUNDING_MODES[rule.mode] })
	);
}
export const signed = (value: {
	readonly amount: number;
	readonly direction: 'ADD' | 'DEDUCT';
}): number => (value.direction === 'ADD' ? value.amount : -value.amount);
export function nonnegative(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
		throw new Error(`${field}: expected a finite nonnegative magnitude.`);
	return value;
}
