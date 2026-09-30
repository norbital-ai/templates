import assert from 'node:assert/strict';

/** RFC 4180: quoted fields may hold commas, newlines and `""`. `lines[i]` is row i's first line. */
export function parseCsv(text: string): string[][] & { lines: number[] } {
	const rows = Object.assign([] as string[][], { lines: [] as number[] });
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let line = 1;
	let start = 1;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '\n') line++;
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') ((field += '"'), i++);
			else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') (row.push(field), (field = ''));
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') (i++, line++);
			(row.push(field), rows.push(row), rows.lines.push(start), (row = []), (field = ''));
			start = line;
		} else field += c;
	}
	assert.equal(quoted, false, 'unterminated quoted field');
	if (field !== '' || row.length) (row.push(field), rows.push(row), rows.lines.push(start));
	return rows;
}
