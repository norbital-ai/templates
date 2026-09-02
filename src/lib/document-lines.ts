import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { documentTotals, requireCurrency, type LineAmounts } from './pricing.js';

/** The money cells a document roll-up reads off one stored line. */
interface RollupLineCells {
	readonly net?: number | null;
	readonly tax?: number | null;
	readonly line_total?: number | null;
}

interface RollupDocumentSource {
	readonly document: Effect.Effect<{ readonly currency: string | null } | undefined>;
	readonly lines: Effect.Effect<readonly RollupLineCells[]>;
	readonly write: (totals: LineAmounts) => Effect.Effect<unknown>;
}

/**
 * Re-total one document from its own lines.
 *
 * Quotes, purchase orders, purchase invoices and sales invoices roll up the same way — read the
 * header, read its lines, write the summed net, tax and gross back — so the shape is owned here and
 * each line collection supplies only the two reads and the write that name its own tables.
 */
export function rollupDocument(source: RollupDocumentSource): Effect.Effect<void> {
	return Effect.gen(function* () {
		const document = yield* source.document;
		if (!document) return;

		const lines = yield* source.lines;
		const totals = documentTotals(
			lines.map((line) => ({
				net: decodeNumber(line.net ?? 0),
				tax: decodeNumber(line.tax ?? 0),
				gross: decodeNumber(line.line_total ?? 0)
			})),
			requireCurrency(document.currency)
		);

		yield* source.write(totals);
	});
}

/** The quantity a selection of lines accounts for, whatever selected them. */
export function sumQuantity(
	lines: Effect.Effect<readonly { readonly quantity?: number | null }[]>
): Effect.Effect<number> {
	return Effect.map(lines, (rows) =>
		rows.reduce((sum, row) => sum + decodeNumber(row.quantity ?? 0), 0)
	);
}
