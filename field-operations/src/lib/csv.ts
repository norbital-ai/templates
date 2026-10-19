import { csvRows } from '@norbital-ai/std/csv';
/**
 * The rows of an RFC 4180 CSV as records keyed by its header row, blank cells omitted.
 *
 * A doubled quote inside a quoted cell is one literal quote, the only escape the format has.
 */
export function csvRecords(text: string): Array<Record<string, string>> {
	return gridRecords(
		csvRows(text.replace(/^﻿/, '')).filter((row) => row.some((cell) => cell.trim() !== ''))
	);
}
/** Rows under a header row as records keyed by the lower-cased header, blank cells omitted. */
export function gridRecords(
	grid: ReadonlyArray<ReadonlyArray<string>>
): Array<Record<string, string>> {
	const [header = [], ...body] = grid;
	const names = header.map((name) => name.trim().toLowerCase());
	return body.map((values) =>
		Object.fromEntries(
			names.flatMap((name, column) => {
				const value = values[column]?.trim() ?? '';
				return name === '' || value === '' ? [] : [[name, value]];
			})
		)
	);
}
