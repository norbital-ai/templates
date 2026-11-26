import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { DateTime, Effect } from 'effect';

export type XlsxWorkbook = InstanceType<typeof ExcelJSBrowser.Workbook>;
export type XlsxWorksheet = ReturnType<XlsxWorkbook['addWorksheet']>;
export type ThinSide = { readonly style: 'thin'; readonly color: { readonly argb: string } };

/** `2026-10` → `OCT 2026`, `2026-10-1` → `OCT 2026 1ST HALF`. */
export const monthOf = (period: string): string => {
	const match = /^(\d{4})-(\d{2})(?:-([12]))?$/.exec(period);
	if (match === null) return period.toUpperCase();
	const half = match[3] === undefined ? '' : match[3] === '1' ? ' 1ST HALF' : ' 2ND HALF';
	const month = DateTime.formatUtc(DateTime.makeUnsafe(`${match[1]}-${match[2]}-01`), {
		locale: 'en',
		month: 'short',
		year: 'numeric'
	});
	return `${month.toUpperCase()}${half}`;
};

/** Excel worksheet tab name: strips forbidden characters, caps at 31 chars, and disambiguates duplicates. */
export const uniqueSheetName = (
	raw: string,
	taken: Set<string>,
	options: { readonly replace?: string; readonly fallback?: string } = {}
): string => {
	const replace = options.replace ?? '-';
	const cleaned = raw.replaceAll(/[:\\/?*[\]]/g, replace);
	const base = options.fallback === undefined ? cleaned : cleaned.trim() || options.fallback;
	let name = options.fallback === undefined ? base.slice(0, 31) : base.slice(0, 31).trim();
	for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) {
		const tag = ` (${suffix})`;
		const head = base.slice(0, 31 - tag.length);
		name = `${options.fallback === undefined ? head : head.trim()}${tag}`;
	}
	taken.add(name.toLowerCase());
	return name;
};

export const solidFill = (argb: string) => ({
	type: 'pattern' as const,
	pattern: 'solid' as const,
	fgColor: { argb }
});

export const boxBorder = (side: ThinSide) => ({
	top: side,
	left: side,
	bottom: side,
	right: side
});

export const styleTotalsRow = (
	ws: XlsxWorksheet,
	rowNumber: number,
	width: number,
	thin: ThinSide
): void => {
	const row = ws.getRow(rowNumber);
	for (let column = 1; column <= width; column++) {
		const cell = row.getCell(column);
		cell.font = { bold: true };
		cell.border = { top: thin, bottom: { style: 'double', color: { argb: 'FF000000' } } };
	}
};

export const styleDetailSheet = (
	ws: XlsxWorksheet,
	columnCount: number,
	headerHeight: number,
	fillArgb: string
): void => {
	ws.getRow(1).height = headerHeight;
	ws.getRow(1).eachCell((cell) => {
		cell.font = { bold: true };
		cell.fill = solidFill(fillArgb);
		cell.alignment = { vertical: 'middle', wrapText: true };
	});
	ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: columnCount } };
};

export const downloadWorkbook = async (workbook: XlsxWorkbook, filename: string): Promise<void> => {
	const bytes = await workbook.xlsx.writeBuffer();
	const url = URL.createObjectURL(
		new Blob([new Uint8Array(bytes)], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		})
	);
	Object.assign(document.createElement('a'), { href: url, download: filename }).click();
	URL.revokeObjectURL(url);
};

/** Drains every cursor page of one query result into a single array. */
export const collectPages = <Row, Cursor, E>(
	first: { readonly rows: readonly Row[]; readonly next: Cursor | null },
	fetchNext: (
		after: Cursor
	) => Effect.Effect<{ readonly rows: readonly Row[]; readonly next: Cursor | null }, E>
): Effect.Effect<Row[], E> =>
	Effect.gen(function* () {
		const rows = [...first.rows];
		let next = first.next;
		while (next !== null) {
			const page = yield* fetchNext(next);
			rows.push(...page.rows);
			next = page.next;
		}
		return rows;
	});
