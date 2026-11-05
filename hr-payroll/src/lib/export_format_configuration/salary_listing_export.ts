import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type { PayslipBreakdown } from '../payroll_engine/payslip_breakdown.js';

const GROUP_FILLS = [
	'FFD6E4F0',
	'FFDCEFD8',
	'FFFBE3C8',
	'FFE8DDF1',
	'FFFFF0B8',
	'FFD3EEEC',
	'FFF5D9D9',
	'FFE4E4E4'
];
const EDGE = { style: 'medium', color: { argb: 'FF18344F' } } as const;

type ExportRow = {
	readonly employee_number: string;
	readonly employee_name: string;
	readonly breakdown: PayslipBreakdown;
	readonly gross_earnings: number;
	readonly total_deductions: number;
	readonly net_pay: number;
	readonly employer_cost: number;
};

type Column = { readonly group: string; readonly label: string; readonly key: string };

const groupOf = (source: string, code: string): string => {
	if (source === 'employee_contract' && code === 'BASIC') return 'Basic pay';
	switch (source) {
		case 'allowance_catalog':
			return 'Allowances';
		case 'overtime_catalog':
			return 'Overtime';
		case 'leave_catalog_entry':
			return 'Leave';
		case 'claim_catalog_entry':
			return 'Claims';
		case 'adhoc_catalog_entry':
			return 'Ad hoc';
		case 'loan_repayment_entry':
			return 'Loan deductions';
		default:
			return 'Other earnings';
	}
};

const amountOf = (value: unknown): number => {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
	if (value !== null && typeof value === 'object') {
		const decimal = Reflect.get(value, '$dec');
		if (typeof decimal === 'string' && Number.isFinite(Number(decimal))) return Number(decimal);
		const text = String(value);
		if (text !== '[object Object]' && Number.isFinite(Number(text))) return Number(text);
	}
	return 0;
};

const signed = (row: ExportRow): Map<string, number> => {
	const values = new Map<string, number>();
	for (const line of row.breakdown.lines) {
		if (line.source === 'statutory_contribution_catalog') continue;
		if (line.party !== 'EMPLOYEE') continue;
		const key = `line:${line.source}:${line.code}`;
		values.set(
			key,
			(values.get(key) ?? 0) + (line.direction === 'DEDUCT' ? -line.amount : line.amount)
		);
	}
	for (const scheme of row.breakdown.statutory) {
		values.set(`statutory:${scheme.code}:employee`, scheme.employee);
		values.set(`statutory:${scheme.code}:employer`, scheme.employer);
	}
	return values;
};

export const downloadSalaryListing = async (input: {
	readonly company: string;
	readonly currency: string;
	readonly period: string;
	readonly runKind: string;
	readonly payDate: string;
	readonly runReference: string;
	readonly rows: readonly ExportRow[];
}) => {
	if (input.rows.length === 0) return;
	const lineLabels = new Map<string, { group: string; label: string }>();
	for (const row of input.rows)
		for (const line of row.breakdown.lines) {
			if (line.source === 'statutory_contribution_catalog' || line.party !== 'EMPLOYEE') continue;
			const key = `line:${line.source}:${line.code}`;
			if (!lineLabels.has(key))
				lineLabels.set(key, { group: groupOf(line.source, line.code), label: line.label });
		}
	const statutory = new Map<string, string>();
	for (const row of input.rows)
		for (const scheme of row.breakdown.statutory) statutory.set(scheme.code, scheme.kind);

	const columns: Column[] = [
		...[...lineLabels].map(([key, value]) => ({ key, ...value })),
		...[...statutory].flatMap(([code, kind]) => [
			{
				key: `statutory:${code}:employee`,
				group: 'Employee statutory',
				label: `${code} · ${kind}`
			},
			{ key: `statutory:${code}:employer`, group: 'Employer statutory', label: `${code} · ${kind}` }
		]),
		{ key: 'total:gross', group: 'Totals', label: 'Gross earnings' },
		{ key: 'total:deductions', group: 'Totals', label: 'Total deductions' },
		{ key: 'total:net', group: 'Totals', label: 'Net pay' },
		{ key: 'total:employer', group: 'Totals', label: 'Employer cost' }
	];

	const workbook = new ExcelJSBrowser.Workbook();
	workbook.creator = 'Payroll';
	const sheet = workbook.addWorksheet(
		`${input.period} ${input.currency}`.replaceAll(/[\\/?*\[\]:]/g, '-').slice(0, 31)
	);
	const last = columns.length + 3;
	sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 7 }];
	sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
	sheet.columns = [{ width: 19 }, { width: 30 }, ...columns.map(() => ({ width: 18 }))];

	for (const row of [1, 2, 3]) sheet.mergeCells(row, 1, row, Math.min(last, 9));
	sheet.getCell(1, 1).value = `${input.company} — Salary listing`;
	sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF18344F' } };
	sheet.getRow(1).height = 28;
	sheet.getCell(2, 1).value = `${input.period} | ${input.currency} | ${
		input.runKind === 'OFF_CYCLE' ? 'Extra payroll' : 'Regular payroll'
	} | Pay date: ${input.payDate} | Run: ${input.runReference}`;
	sheet.getCell(3, 1).value =
		'Each pay line is one column. Employee deductions are negative; statutory and employer cost are shown separately.';

	for (const [index, text] of ['Employee no.', 'Employee name', 'Payment status'].entries()) {
		sheet.mergeCells(6, index + 1, 7, index + 1);
		sheet.getCell(6, index + 1).value = text;
	}
	for (const rowNumber of [6, 7]) {
		sheet.getRow(rowNumber).height = rowNumber === 6 ? 32 : 60;
		for (let column = 1; column <= last; column++) {
			const cell = sheet.getCell(rowNumber, column);
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18344F' } };
			cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
			cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
		}
	}
	const groups: { first: number; last: number }[] = [];
	for (let index = 0; index < columns.length;) {
		const first = index;
		const group = columns[index]?.group;
		while (index + 1 < columns.length && columns[index + 1]?.group === group) index++;
		if (index > first) sheet.mergeCells(6, first + 4, 6, index + 4);
		else sheet.mergeCells(6, first + 4, 7, first + 4);
		sheet.getCell(6, first + 4).value = index > first ? group : columns[first]?.label;
		const fill = GROUP_FILLS[groups.length % GROUP_FILLS.length] ?? 'FFE4E4E4';
		for (const rowNumber of [6, 7])
			for (let column = first; column <= index; column++) {
				const cell = sheet.getCell(rowNumber, column + 4);
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
				cell.font = { bold: true, color: { argb: 'FF18344F' }, size: 10 };
			}
		groups.push({ first: first + 4, last: index + 4 });
		index++;
	}

	const format = '#,##0.00;[Red](#,##0.00);"–"';
	for (const [index, row] of input.rows.entries()) {
		const rowNumber = index + 8;
		sheet.getRow(rowNumber).height = 20;
		sheet.getCell(rowNumber, 1).value = row.employee_number;
		sheet.getCell(rowNumber, 2).value = row.employee_name;
		sheet.getCell(rowNumber, 3).value = 'To be paid';
		const values = signed(row);
		values.set('total:gross', row.gross_earnings);
		values.set('total:deductions', -Math.abs(row.total_deductions));
		values.set('total:net', row.net_pay);
		values.set('total:employer', row.employer_cost);
		for (const [column, definition] of columns.entries()) {
			const cell = sheet.getCell(rowNumber, column + 4);
			cell.value = values.get(definition.key) ?? 0;
			cell.numFmt = format;
			if (definition.key.startsWith('total:')) {
				cell.font = { bold: true };
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F0E6' } };
			}
		}
	}

	const totalRow = input.rows.length + 8;
	sheet.getCell(totalRow, 2).value = 'Total';
	for (const [column, definition] of columns.entries()) {
		const cell = sheet.getCell(totalRow, column + 4);
		const sum = input.rows.reduce(
			(total, row) => total + (signed(row).get(definition.key) ?? 0),
			0
		);
		cell.value = {
			formula: `SUM(${sheet.getCell(8, column + 4).address}:${sheet.getCell(totalRow - 1, column + 4).address})`,
			result: sum
		};
		cell.numFmt = format;
		cell.font = { bold: true };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0EAF2' } };
	}
	sheet.getRow(totalRow).height = 30;
	for (const group of groups)
		for (let rowNumber = 6; rowNumber <= totalRow; rowNumber++) {
			const start = sheet.getCell(rowNumber, group.first);
			start.border = { ...start.border, left: EDGE };
			const end = sheet.getCell(rowNumber, group.last);
			end.border = { ...end.border, right: EDGE };
		}
	sheet.autoFilter = { from: { row: 7, column: 1 }, to: { row: totalRow - 1, column: last } };

	const bytes = await workbook.xlsx.writeBuffer();
	const url = URL.createObjectURL(
		new Blob([new Uint8Array(bytes)], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		})
	);
	const link = Object.assign(document.createElement('a'), {
		href: url,
		download: `salary-listing-${input.period}-${input.currency}.xlsx`
	});
	link.click();
	URL.revokeObjectURL(url);
};
