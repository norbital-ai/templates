import { refuse } from '@norbital-ai/bolt/authoring';
import { currencyFractionDigits, fromMinorUnits, toMinorUnits } from '@norbital-ai/std/finance';
import { decodeNumber } from '@norbital-ai/std/json';
import { Schema } from 'effect';

/** The derived-money inputs one document line contributes, owned once for every document kind. */
const linePricingSchema = Schema.Struct({
	quantity: Schema.Number,
	unit_price: Schema.Number,
	discount_pct: Schema.optional(Schema.Number),
	tax_rate: Schema.optional(Schema.Number),
	tax_inclusive: Schema.Boolean,
	currency: Schema.NonEmptyString
});

type LinePricing = Schema.Schema.Type<typeof linePricingSchema>;

/** The derived-money outcome for a document line or a whole document. */
const lineAmountsSchema = Schema.Struct({
	net: Schema.Number,
	tax: Schema.Number,
	gross: Schema.Number
});

export type LineAmounts = Schema.Schema.Type<typeof lineAmountsSchema>;

export function requireCurrency(currency: string | null): string {
	if (!currency) throw new Error('Document currency is required.');
	return currency;
}

function shiftExponent(value: number, places: number): number {
	if (value === 0) return 0;
	const [mantissa, exponent] = value.toExponential().split('e');
	return decodeNumber(`${mantissa}e${decodeNumber(exponent) + places}`);
}

function roundHalfUp(value: number, digits: number): number {
	if (!Number.isFinite(value)) {
		throw new Error('Cannot round a value that is not a finite number.');
	}
	const magnitude = Math.abs(shiftExponent(value, digits));
	const rounded = Math.round(magnitude);
	return shiftExponent(value < 0 ? -rounded : rounded, -digits);
}

function lineAmounts(line: LinePricing): LineAmounts {
	const digits = currencyFractionDigits(line.currency);
	const discount = line.discount_pct ?? 0;
	const rate = (line.tax_rate ?? 0) / 100;
	const base = line.quantity * line.unit_price * (1 - discount / 100);

	if (line.tax_inclusive) {
		const gross = roundHalfUp(base, digits);
		const net = roundHalfUp(gross / (1 + rate), digits);
		return { net, tax: roundHalfUp(gross - net, digits), gross };
	}

	const net = roundHalfUp(base, digits);
	const tax = roundHalfUp(net * rate, digits);
	return { net, tax, gross: roundHalfUp(net + tax, digits) };
}

/** The document facts that price its lines: how tax is quoted, and in which currency. */
type PricedDocument = Pick<LinePricing, 'tax_inclusive'> & {
	readonly currency: string | null;
};

/** A line's own pricing cells, as the row carries them, before the document is applied. */
type DocumentLineCells = {
	readonly quantity?: number | null;
	readonly unit_price?: number | null;
	readonly discount_pct?: number | null;
	readonly tax_rate?: number | null;
};

/**
 * Refuses a line whose cells cannot be priced.
 *
 * Quote, order and invoice lines ask the same four questions of a row; `price` names the column the
 * sentence talks about (`Unit price` on the sell side, `Unit cost` on the buy side).
 */
export function validateLineCells(line: DocumentLineCells, price = 'Unit price'): void {
	const quantity = decodeNumber(line.quantity ?? Number.NaN);
	if (Number.isNaN(quantity) || quantity <= 0) refuse('Quantity must be greater than zero.');
	const unitPrice = decodeNumber(line.unit_price ?? Number.NaN);
	if (Number.isNaN(unitPrice)) refuse(`${price} is required.`);
	if (unitPrice < 0) refuse(`${price} cannot be negative.`);
	const discount = decodeNumber(line.discount_pct ?? 0);
	if (discount < 0 || discount > 100) refuse('Discount percentage must be between 0 and 100.');
	const taxRate = decodeNumber(line.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) refuse('Tax rate must be between 0 and 100.');
}

/**
 * One line's net, tax and gross, priced against the document that owns it.
 *
 * Quote lines, order lines and invoice lines all price the same way and differ only in which column
 * carries the unit price, so the coercion and the document's tax basis are owned here rather than
 * copied into each collection.
 */
export function documentLineAmounts(
	document: PricedDocument,
	line: DocumentLineCells
): LineAmounts {
	return lineAmounts({
		quantity: decodeNumber(line.quantity ?? 0),
		unit_price: decodeNumber(line.unit_price ?? 0),
		discount_pct: decodeNumber(line.discount_pct ?? 0),
		tax_rate: decodeNumber(line.tax_rate ?? 0),
		tax_inclusive: document.tax_inclusive,
		currency: requireCurrency(document.currency)
	});
}

export function documentTotals(lines: readonly LineAmounts[], currency: string): LineAmounts {
	let net = 0n;
	let tax = 0n;
	let gross = 0n;
	for (const line of lines) {
		net += toMinorUnits(line.net, currency);
		tax += toMinorUnits(line.tax, currency);
		gross += toMinorUnits(line.gross, currency);
	}
	return {
		net: fromMinorUnits(net, currency),
		tax: fromMinorUnits(tax, currency),
		gross: fromMinorUnits(gross, currency)
	};
}

/** A buy-side line's cells, as order and purchase invoice lines carry them. */
type CostLineCells = {
	readonly quantity?: number | null;
	readonly unit_cost?: number | null;
	readonly tax_rate?: number | null;
};

/**
 * A buy-side line's money columns, priced against the document that owns it.
 *
 * The cost column is the unit price of the buy side; the checks and the rounding are the same as
 * a sell-side line's, so only the column name differs here.
 */
export function costLineColumns(
	document: PricedDocument,
	line: CostLineCells
): { readonly net: number; readonly tax: number; readonly line_total: number } {
	const cells = { quantity: line.quantity, unit_price: line.unit_cost, tax_rate: line.tax_rate };
	validateLineCells(cells, 'Unit cost');
	const amounts = documentLineAmounts(document, cells);
	return { net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
}
