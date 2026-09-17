import { refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { documentTotals, requireCurrency, type LineAmounts } from './pricing.js';

/** The money cells a document roll-up reads off one stored line. */
interface RollupLineCells {
	readonly net?: number | null;
	readonly tax?: number | null;
	readonly line_total?: number | null;
}

/**
 * One document's net, tax and gross from its stored lines.
 *
 * Quotes, purchase orders, purchase invoices and sales invoices roll up the same way — sum the
 * already-rounded lines in the document's currency — so the shape is owned here and each roll-up
 * automation supplies only the reads that name its own tables.
 */
export function totalsOfLines(
	lines: readonly RollupLineCells[],
	currency: string | null
): LineAmounts {
	return documentTotals(
		lines.map((line) => ({
			net: decodeNumber(line.net ?? 0),
			tax: decodeNumber(line.tax ?? 0),
			gross: decodeNumber(line.line_total ?? 0)
		})),
		requireCurrency(currency)
	);
}

/**
 * What a batch may still claim of each source line: the quantity already billed, received or
 * invoiced against it, advanced as the batch claims its own — so two lines of one call cannot each
 * fit under the cap alone and overflow it together.
 */
export function allocationLedger<Row>(
	prior: readonly Row[],
	key: (row: Row) => string,
	quantity: (row: Row) => number | null | undefined
): {
	readonly claim: (
		id: string,
		amount: number,
		cap: number,
		refusal: (claimed: number, cap: number) => string
	) => void;
} {
	const claimed = new Map<string, number>();
	for (const row of prior) {
		claimed.set(key(row), (claimed.get(key(row)) ?? 0) + decodeNumber(quantity(row) ?? 0));
	}
	return {
		claim: (id, amount, cap, refusal) => {
			const soFar = claimed.get(id) ?? 0;
			if (soFar + amount > cap) refuse(refusal(soFar, cap));
			claimed.set(id, soFar + amount);
		}
	};
}
