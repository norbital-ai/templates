import { Decimal } from '@norbital-ai/std/decimal';
import * as Predicate from 'effect/Predicate';

/**
 * Rows reach code typed (the guest prelude and `$bolt` decode the wire): a date and an instant are their ISO strings,
 * a decimal a `Decimal` (importing std/decimal here registers it, so no decimal stays its bare text). The template's
 * domain code reads plain values, so every row read through `ctx` passes here once; a still-tagged value (a fixture,
 * a raw answer) reads the same.
 */
// ponytail: decimals become numbers, as today's `numeric` columns read (the engine's arithmetic is float with
// cent rounding, D21); a `Decimal` port is OD-7's boundary, not this function's.
const DecimalClass =
	((globalThis as { [key: symbol]: unknown })[Symbol.for('norbital.std.Decimal')] as
		typeof Decimal | undefined) ?? Decimal;

/** A value as `plain` returns it: a `Decimal` is a number; ids, dates and instants stay their branded strings. */
export type Wire<T> = T extends string
	? T
	: T extends Decimal
		? number
		: T extends readonly (infer U)[]
			? readonly Wire<U>[]
			: T extends object
				? { readonly [K in keyof T]: Wire<T[K]> }
				: T;

export function plain<T>(value: T): Wire<T>;
export function plain(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(plain);
	if (!Predicate.isObjectOrArray(value)) return value;
	if (value instanceof DecimalClass) return value.toNumber();
	const entries = Object.entries(value);
	if (entries.length === 1) {
		const [tag, inner] = entries[0]!;
		// repository-health:allow COERCE1 -- a tagged wire decimal's text, as today's `numeric` columns read
		if (tag === '$dec') return Number(inner);
		if (tag === '$d' || tag === '$t') return inner;
	}
	return Object.fromEntries(entries.map(([key, inner]) => [key, plain(inner)]));
}

/** A page of rows, plain. */
export const plainRows = <T = Record<string, unknown>>(page: {
	readonly rows: readonly unknown[];
}): T[] => page.rows.map((row) => plain(row) as T);

/**
 * A stored or typed number: a number, a non-blank numeric string, a `Decimal` or a tagged `{ $dec }`. Anything else
 * (a blank, a word) is `NaN`, as `Number('x')` is, so a caller branching on `Number.isFinite` keeps its control flow.
 */
export function decodeNumber(value: unknown): number {
	const bare = plain(value);
	if (Predicate.isNumber(bare)) return bare;
	// repository-health:allow COERCE1 -- the workspace's one numeric-text decode
	return Predicate.isString(bare) && /\S/u.test(bare) ? Number(bare) : Number.NaN;
}
