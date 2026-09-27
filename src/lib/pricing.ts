import { Decimal } from '@norbital-ai/std/decimal';
import * as Predicate from './guards.js';

/**
 * The only place rounding is decided. A line is priced once, in its document's currency and tax mode: half-up to the
 * currency's minor unit by exponent shift (so `1.005` rounds to `1.01`), and a tax-inclusive line takes tax as the
 * residual `gross − net`. A document total is the `sum` of its already-rounded lines (the model's roll-ups).
 */

/**
 * A stored or submitted decimal as a number: a `Decimal` (its text), the wire's `{ $dec }`, a number or numeric text;
 * anything else, or blank text, is NaN.
 */
export function num(value: unknown): number {
	if (value == null) return Number.NaN;
	if (Predicate.isNumber(value)) return value;
	const text = Predicate.isObjectOrArray(value)
		? '$dec' in value
			? (value as { $dec: string }).$dec
			: String(value)
		: String(value);
	// repository-health:allow COERCE1 -- the workspace's one decimal-text decode: blank is NaN, text is Number's
	return /\S/.test(text) ? Number(text) : Number.NaN;
}
/** A nullable decimal as a number, for an export or a view. */
export const numOrNull = (value: unknown) => (value == null ? null : num(value));

/** Minor-unit digits of the CRM currencies (`lib/currency.ts`): JPY has none. */
const digitsOf = (currency: string) => (currency === 'JPY' ? 0 : 2);

function shift(value: number, places: number): number {
	if (value === 0) return 0;
	const [mantissa, exponent] = value.toExponential().split('e');
	return Number.parseFloat(`${mantissa}e${Number.parseInt(exponent ?? '', 10) + places}`);
}
function roundHalfUp(value: number, digits: number): number {
	const rounded = Math.round(Math.abs(shift(value, digits)));
	return shift(value < 0 ? -rounded : rounded, -digits);
}

/** A line's own pricing cells; `unit_price` is the sell price or, on the buy side, the unit cost. */
export type LineCells = {
	readonly quantity?: unknown;
	readonly unit_price?: unknown;
	readonly discount_pct?: unknown;
	readonly tax_rate?: unknown;
};
/** The document facts that price its lines. */
export type PricedDocument = { readonly tax_inclusive: boolean; readonly currency: string | null };

/**
 * A line's `net`, `tax` and `line_total`, or the refusal its cells earn. `price` names the unit-price column in the
 * sentence (`Unit price` on the sell side, `Unit cost` on the buy side).
 */
export function priceLine(
	document: PricedDocument,
	line: LineCells,
	price = 'Unit price'
): { net: Decimal; tax: Decimal; line_total: Decimal } | { refusal: string } {
	const quantity = num(line.quantity);
	if (Number.isNaN(quantity) || quantity <= 0)
		return { refusal: 'Quantity must be greater than zero.' };
	const unitPrice = num(line.unit_price);
	if (Number.isNaN(unitPrice)) return { refusal: `${price} is required.` };
	if (unitPrice < 0) return { refusal: `${price} cannot be negative.` };
	const discount = line.discount_pct == null ? 0 : num(line.discount_pct);
	if (!(discount >= 0 && discount <= 100))
		return { refusal: 'Discount percentage must be between 0 and 100.' };
	const taxRate = line.tax_rate == null ? 0 : num(line.tax_rate);
	if (!(taxRate >= 0 && taxRate <= 100)) return { refusal: 'Tax rate must be between 0 and 100.' };
	if (!document.currency) return { refusal: 'Document currency is required.' };
	const digits = digitsOf(document.currency);
	const base = quantity * unitPrice * (1 - discount / 100);
	const rate = taxRate / 100;
	if (document.tax_inclusive) {
		const gross = roundHalfUp(base, digits);
		const net = roundHalfUp(gross / (1 + rate), digits);
		return { net: dec(net), tax: dec(roundHalfUp(gross - net, digits)), line_total: dec(gross) };
	}
	const net = roundHalfUp(base, digits);
	const tax = roundHalfUp(net * rate, digits);
	return { net: dec(net), tax: dec(tax), line_total: dec(roundHalfUp(net + tax, digits)) };
}

/**
 * What a batch may still claim of each source line (a quote line billed, an order line invoiced): the quantity already
 * claimed against it, advanced as the batch claims its own, so two lines of one call cannot each fit under the cap
 * alone and overflow it together. `claim` returns the refusal, or null.
 */
export function ledger(prior: Iterable<readonly [string, number]>) {
	const claimed = new Map<string, number>();
	for (const [id, quantity] of prior) claimed.set(id, (claimed.get(id) ?? 0) + quantity);
	return (
		id: string,
		amount: number,
		cap: number,
		refusal: (soFar: number, cap: number) => string
	): string | null => {
		const soFar = claimed.get(id) ?? 0;
		if (soFar + amount > cap) return refusal(soFar, cap);
		claimed.set(id, soFar + amount);
		return null;
	};
}

/** A reason a status move must carry, from the input or already on the record. */
export const missingReason = (reason: unknown) =>
	!Predicate.isString(reason) || reason.trim() === '';

/**
 * A number as the `Decimal` a decimal field holds, by its shortest text (`Decimal.of` refuses a fractional number): the
 * pricing here is number arithmetic that rounds half-up before it stores.
 */
export const dec = (n: number): Decimal => Decimal.of(String(n));
