/**
 * The rows of an RFC 4180 CSV as records keyed by its header row, blank cells omitted.
 *
 * A doubled quote inside a quoted cell is one literal quote, the only escape the format has.
 */
export function csvRecords(text: string): Array<Record<string, string>> {
	const grid: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	const source = text.replace(/^﻿/, '');
	const endCell = () => {
		row.push(cell);
		cell = '';
	};
	const endRow = () => {
		endCell();
		if (row.some((value) => value.trim() !== '')) grid.push(row);
		row = [];
	};
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index]!;
		if (quoted) {
			if (character !== '"') cell += character;
			else if (source[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else quoted = false;
		} else if (character === '"') quoted = true;
		else if (character === ',') endCell();
		else if (character === '\n') endRow();
		else if (character !== '\r') cell += character;
	}
	endRow();
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
