/**
 * Money rounding.
 *
 * The calculation runs on IEEE doubles, exactly as the engine this one replaces did. Float error is
 * managed by adding a compensating epsilon before every `round`/`trunc`/`ceil` rather than by a
 * decimal library: the two disagree on genuine ties, and this data is full of them (a SOCSO band
 * midpoint of 4,650 × 1.75% is exactly 81.375). Swapping in decimals would move cents silently, so
 * the epsilon is load-bearing and deliberate — see decision E35.
 */

import { currencyFractionDigits } from '@norbital-ai/std/finance';

/**
 * Every rounding the engine executes. A scheme's rule names one of these as a registered helper
 * (`round_cent`, `round_5_cents`, `truncate_cent`, `up_5_cents`, `round_unit`, `floor_unit`,
 * `up_to_unit`); `roundMoney` is their shared implementation, called by `cents` and the overtime
 * floor too.
 */
type RoundingMethod =
	'NEAREST_CENT' | 'TRUNCATE_CENT' | 'UP_5_CENTS' | 'NEAREST_UNIT' | 'FLOOR_UNIT' | 'UP_TO_UNIT';

function epsilon(value: number): number {
	return Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
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
			return Math.trunc(value * 100 + (value < 0 ? -eps : eps)) / 100;
		case 'UP_5_CENTS':
			return Math.ceil(value * 20 - eps) / 20;
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
 * Round a day count to the nearest half day, half **up** at the 0.25 boundary — the plan's own
 * worked accrual, 21 × 3 / 12 = 5.25, must land on 5.5 (decision E8/L1).
 */
export function roundHalfDay(value: number): number {
	return Math.round((value + epsilon(value)) * 2) / 2;
}

/**
 * An hour count to the minute the punches were made in. Clock arithmetic yields 2.9999999999999996
 * for three hours; the minute is the punch's own unit, so nothing the day earned is lost or
 * invented. No statute states a coarser payable unit — a jurisdiction that prices "each hour or
 * part thereof" says so in its band (`up_to_unit(hours)`), not here.
 */
export function roundMinute(hours: number): number {
	return Math.round(hours * 60) / 60;
}
