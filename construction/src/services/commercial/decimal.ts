/**
 * Exact Effect `BigDecimal` arithmetic and display helpers shared across commercial, BIM, and UI code.
 * Zero IEEE-754 float math on monetary or decimal quantities.
 */
import { BigDecimal, Option } from 'effect';

export type DecimalLike = string | number | null | undefined;

export const ZERO = BigDecimal.fromBigInt(0n);
export const ONE = BigDecimal.fromBigInt(1n);
export const HUNDRED = BigDecimal.fromBigInt(100n);

export function toDecimal(value: DecimalLike): BigDecimal.BigDecimal {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') return ZERO;
		return Option.getOrElse(BigDecimal.fromString(trimmed), () => ZERO);
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Option.getOrElse(BigDecimal.fromNumber(value), () => ZERO);
	}
	return ZERO;
}

/** Converts a decimal string or number to a finite number for non-monetary UI charts/ratios. */
export const toNumber = (value: DecimalLike): number => BigDecimal.toNumberUnsafe(toDecimal(value));

export const nonNegative = (value: BigDecimal.BigDecimal): BigDecimal.BigDecimal =>
	BigDecimal.max(ZERO, value);

export const clampPct = (value: BigDecimal.BigDecimal): BigDecimal.BigDecimal =>
	BigDecimal.clamp(value, { minimum: ZERO, maximum: HUNDRED });

export const roundHalf = (value: BigDecimal.BigDecimal, scale: number): BigDecimal.BigDecimal =>
	BigDecimal.round(value, { scale, mode: 'half-from-zero' });

export function formatTrimmed(value: BigDecimal.BigDecimal, scale: number): string {
	return BigDecimal.format(BigDecimal.normalize(roundHalf(value, scale)));
}

export function moneyStr(value: BigDecimal.BigDecimal): string {
	const raw = BigDecimal.format(roundHalf(value, 2));
	const [whole = '0', frac = ''] = raw.split('.');
	return `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

/** Embodied carbon for display: kgCO2e below one tonne, tCO2e from there up. */
export function formatCarbon(kg: DecimalLike): string {
	const value = toDecimal(kg);
	const tonne = BigDecimal.fromBigInt(1000n);
	return BigDecimal.isLessThan(value, tonne)
		? `${formatTrimmed(value, 0)} kgCO₂e`
		: `${formatTrimmed(divSafe(value, tonne), 1)} tCO₂e`;
}

export const divSafe = (
	num: BigDecimal.BigDecimal,
	den: BigDecimal.BigDecimal
): BigDecimal.BigDecimal =>
	BigDecimal.isZero(den) ? ZERO : Option.getOrElse(BigDecimal.divide(num, den), () => ZERO);

export const pctOf = (
	base: BigDecimal.BigDecimal,
	ratePct: BigDecimal.BigDecimal
): BigDecimal.BigDecimal => roundHalf(divSafe(BigDecimal.multiply(base, ratePct), HUNDRED), 2);
