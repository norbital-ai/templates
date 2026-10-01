/**
 * Money rounding.
 *
 * The calculation runs on IEEE doubles, exactly as the engine this one replaces did. Float error is
 * managed by adding a compensating epsilon before every `round`/`trunc`/`ceil` rather than by a
 * decimal library: the two disagree on genuine ties, and this data is full of them (a SOCSO band
 * midpoint of 4,650 × 1.75% is exactly 81.375). Swapping in decimals would move cents silently, so
 * the epsilon is load-bearing and deliberate — see decision E35.
 */

import { minorDigits } from '@norbital-ai/std/decimal';

/** The stored and wire shape of a monetary amount. */
export type MoneyValue = { readonly value: number; readonly currency: string };

/** ISO 4217 fraction digits of a currency. */
export const currencyFractionDigits = (currency: string): number =>
	minorDigits(currency.toUpperCase());

export const toMinorUnits = (value: number, currency: string): bigint =>
	BigInt(Math.round(value * 10 ** currencyFractionDigits(currency)));

export const fromMinorUnits = (minor: bigint, currency: string): number =>
	// repository-health:allow COERCE1 -- bigint minor units back to the float the engine computes in
	Number(minor) / 10 ** currencyFractionDigits(currency);

/**
 * The engine's own roundings (`cents`, the overtime floor, a cap's share). A stored rule rounds
 * with `round(value, step, 'MODE')` (`roundStep`), its direction and step written in the rule.
 */
export type RoundingMethod =
	'NEAREST_CENT' | 'TRUNCATE_CENT' | 'UP_5_CENTS' | 'NEAREST_UNIT' | 'FLOOR_UNIT' | 'UP_TO_UNIT';

/**
 * A difference inherits its operands' error, not its own size: 6,225.41 − 5,655.60 is
 * 569.8099999999995, 5e-13 short, and a result-relative epsilon truncated it to 569.80. The 1e-9
 * floor covers that cancellation; no amount built from sen and published rates sits that close to a
 * boundary without being on it.
 */
function epsilon(value: number): number {
	return Math.max(1e-9, Number.EPSILON * Math.abs(value) * 4);
}

/**
 * Round a money value.
 *
 * Every method is deterministic arithmetic on one value; a published table amount is returned by
 * the rule expression itself and is never passed here, because rounding it would move every SOCSO
 * and EIS employer share by a cent or two (E3, E12).
 */
export function roundMoney(value: number, method: RoundingMethod): number {
	if (!Number.isFinite(value)) throw new Error('Cannot round a non-finite amount.');
	const eps = epsilon(value);
	switch (method) {
		case 'NEAREST_CENT':
			return Math.round((value + eps) * 100) / 100;
		case 'TRUNCATE_CENT':
			return Math.trunc((value + (value < 0 ? -eps : eps)) * 100) / 100;
		case 'UP_5_CENTS':
			return Math.ceil((value - eps) * 20) / 20;
		case 'NEAREST_UNIT':
			return Math.round(value + eps);
		case 'FLOOR_UNIT':
			return Math.floor(value + eps);
		case 'UP_TO_UNIT':
			return Math.ceil(value - eps);
	}
}

/**
 * Round to the payroll currency's minor unit — whole đồng, two decimal places for rupiah. Without a
 * currency it is `round(x, NEAREST_CENT)`: a rate or an intermediate the currency does not reach.
 */
export function cents(value: number, currency?: string): number {
	if (currency == null) return roundMoney(value, 'NEAREST_CENT');
	if (!Number.isFinite(value)) throw new Error('Cannot round a non-finite amount.');
	const scale = 10 ** currencyFractionDigits(currency);
	return Math.round((value + epsilon(value)) * scale) / scale;
}

/**
 * The directions a stored `round(value, step, mode)` names. UP is toward +∞ and DOWN toward −∞;
 * TRUNCATE drops toward zero; HALF_UP takes a half away from zero; HALF_EVEN takes a half to the
 * even multiple.
 */
export const ROUND_MODES = ['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'TRUNCATE'] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

/** A stored rounding step: the multiple a figure rounds to, and the direction. */
export type StepRounding = { readonly step: number; readonly mode: 'UP' | 'DOWN' | 'HALF_UP' };

/** Round to a multiple of `step`: up, down, or to the nearest with a half up. */
export function roundToStep(value: number, { step, mode }: StepRounding): number {
	return roundStep(value, step, mode);
}

/**
 * Round to a multiple of `step` in one of the `ROUND_MODES`. The quotient carries the same
 * compensating epsilon as `roundMoney`, so 1.15 / 0.05 (22.999999999999996) is the whole 23 it
 * stands for; the product is re-fixed to the step's own decimals, so 3 × 0.05 is 0.15, not
 * 0.15000000000000002.
 */
export function roundStep(value: number, step: number, mode: RoundMode): number {
	if (!Number.isFinite(value) || !(step > 0) || !Number.isFinite(step))
		throw new Error('Rounding needs a finite value and a positive step.');
	const quotient = value / step;
	const eps = epsilon(quotient);
	const sign = quotient < 0 ? -1 : 1;
	const magnitude = Math.abs(quotient);
	let multiple: number;
	switch (mode) {
		case 'UP':
			multiple = Math.ceil(quotient - eps);
			break;
		case 'DOWN':
			multiple = Math.floor(quotient + eps);
			break;
		case 'TRUNCATE':
			multiple = sign * Math.floor(magnitude + eps);
			break;
		case 'HALF_UP':
			multiple = sign * Math.floor(magnitude + 0.5 + eps);
			break;
		case 'HALF_EVEN': {
			const whole = Math.floor(magnitude + eps);
			const rest = magnitude - whole;
			const nearest =
				Math.abs(rest - 0.5) <= eps
					? whole % 2 === 0
						? whole
						: whole + 1
					: Math.floor(magnitude + 0.5);
			multiple = sign * nearest;
			break;
		}
		default:
			throw new Error(`Unknown rounding mode ${String(mode)}.`);
	}
	const decimals = (String(step).split('.')[1] ?? '').length;
	// `|| 0` folds a −0 (a negative value rounded to nothing) into 0.
	return Number((multiple * step).toFixed(decimals)) || 0;
}

/**
 * An hour count to the minute the punches were made in. Clock arithmetic yields 2.9999999999999996
 * for three hours; the minute is the punch's own unit, so nothing the day earned is lost or
 * invented. No statute states a coarser payable unit — a jurisdiction that prices "each hour or
 * part thereof" says so in its band (`round(hours, 1, 'UP')`), not here.
 */
export function roundMinute(hours: number): number {
	return Math.round(hours * 60) / 60;
}
