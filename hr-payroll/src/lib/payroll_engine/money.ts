import { Decimal } from '@norbital-ai/std/decimal';
import type { Rounding } from './contracts.js';

// a run converts the same rates and amounts over and over; a Decimal is immutable, so one conversion serves them all
// ponytail: capped, not LRU; the first numbers of a run are the ones that repeat
const converted = new Map<number, Decimal>();
export function decimal(value: number | string | Decimal): Decimal {
	if (value instanceof Decimal) return value;
	if (typeof value === 'number' && !Number.isFinite(value))
		throw new Error('Money requires a finite decimal.');
	if (typeof value === 'number') {
		const held = converted.get(value);
		if (held !== undefined) return held;
		const [digits, exponent] = String(value).toLowerCase().split('e');
		const made = Decimal.from_number(
			value,
			Math.max(0, (digits?.split('.')[1]?.length ?? 0) - Number(exponent ?? 0))
		);
		if (converted.size < 50_000) converted.set(value, made);
		return made;
	}
	return Decimal.of(value);
}
export const sum = (values: readonly number[]): number =>
	values.reduce((n, v) => n.plus(decimal(v)), Decimal.of(0)).to_number();
export function rounded(value: number | string | Decimal, rule: Rounding): number {
	const modes = {
		HALF_UP: 'half_up',
		HALF_EVEN: 'half_even',
		UP: 'up',
		DOWN: 'down',
		TRUNCATE: 'down'
	} as const;
	return decimal(value).round(rule.scale, modes[rule.mode]).to_number();
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
