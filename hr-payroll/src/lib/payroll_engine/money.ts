import { Decimal } from '@norbital-ai/std/decimal';
import type { Rounding } from './contracts.js';

export function decimal(value: number | string | Decimal): Decimal {
	if (value instanceof Decimal) return value;
	if (typeof value === 'number' && !Number.isFinite(value))
		throw new Error('Money requires a finite decimal.');
	if (typeof value === 'number') {
		const [digits, exponent] = String(value).toLowerCase().split('e');
		return Decimal.fromNumber(
			value,
			Math.max(0, (digits?.split('.')[1]?.length ?? 0) - Number(exponent ?? 0))
		);
	}
	return Decimal.of(value);
}
export const sum = (values: readonly number[]): number =>
	values.reduce((n, v) => n.plus(decimal(v)), Decimal.of(0)).toNumber();
export function rounded(value: number | string | Decimal, rule: Rounding): number {
	const modes = {
		HALF_UP: 'halfUp',
		HALF_EVEN: 'halfEven',
		UP: 'up',
		DOWN: 'down',
		TRUNCATE: 'down'
	} as const;
	return decimal(value).round(rule.scale, modes[rule.mode]).toNumber();
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
