/** Strip a UTF-8 BOM if present. */
function stripBom(text: string): string {
	return text.replace(/^\uFEFF/, '');
}

/** Parse RFC 4180-ish CSV text into rows of string cells. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	const source = stripBom(text);

	const endCell = (): void => {
		row.push(cell);
		cell = '';
	};
	const endRow = (): void => {
		endCell();
		rows.push(row);
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
			continue;
		}
		if (character === '"') quoted = true;
		else if (character === ',') endCell();
		else if (character === '\r') continue;
		else if (character === '\n') endRow();
		else cell += character;
	}
	if (cell !== '' || row.length > 0) endRow();
	return rows;
}

function normalizeHeader(value: string): string {
	return value.trim().toLowerCase();
}

function isBlankRow(cells: readonly string[]): boolean {
	return cells.every((cell) => cell.trim() === '');
}

/** Read header-keyed string records from CSV text. */
export function readCsvRecords(
	text: string,
	requiredHeaders: readonly string[]
): Record<string, string>[] {
	const grid = parseCsv(text);
	if (grid.length === 0) throw new Error('The CSV file is empty.');

	const headerRow = grid[0]!;
	const headers = headerRow.map((cell) => cell.trim());
	const headerKeys = new Set(headers.map(normalizeHeader));
	const missingHeaders = requiredHeaders.filter(
		(header) => !headerKeys.has(normalizeHeader(header))
	);
	if (missingHeaders.length > 0) {
		throw new Error(
			`The CSV is missing required columns:\n${missingHeaders.map((header) => `• ${header}`).join('\n')}`
		);
	}

	const records: Record<string, string>[] = [];
	for (let rowIndex = 1; rowIndex < grid.length; rowIndex += 1) {
		const cells = grid[rowIndex]!;
		if (isBlankRow(cells)) continue;
		const record: Record<string, string> = {};
		for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
			const header = headers[columnIndex];
			if (header == null || header === '') continue;
			record[header] = (cells[columnIndex] ?? '').trim();
		}
		records.push(record);
	}
	if (records.length === 0) {
		throw new Error('The CSV has headers but no data rows.');
	}
	return records;
}

/** Read one trimmed string cell from a header-keyed record. */
export function readCsvCell(record: Record<string, string>, header: string): string {
	return (record[header] ?? '').trim();
}
