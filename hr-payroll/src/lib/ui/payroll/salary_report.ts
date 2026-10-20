import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Result } from 'effect';
import type { SalaryReport } from '../../payroll_engine/salary_report.js';

/** The salary listing follows the raw reports: grouped columns, one employee per row and company payment last. */
export function salaryWorkbook(reports: readonly SalaryReport[]) {
	const workbook = new ExcelJSBrowser.Workbook();
	workbook.creator = 'Payroll';
	for (const [index, report] of reports.entries()) {
		const title = `${index + 1} ${report.period} ${report.currency}`.replaceAll(
			/[\\/?*\[\]:]/g,
			'-'
		);
		const sheet = workbook.addWorksheet(title.slice(0, 31));
		const last = report.columns.length + 3;
		sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 7 }];
		sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
		sheet.columns = [
			{ width: 19 },
			{ width: 30 },
			{ width: 18 },
			...report.columns.map(() => ({ width: 19 }))
		];
		for (const row of [1, 2, 3, 4]) sheet.mergeCells(row, 1, row, Math.min(last, 9));
		sheet.getCell(1, 1).value = `${report.company} — Salary listing`;
		sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF18344F' } };
		sheet.getRow(1).height = 28;
		sheet.getCell(2, 1).value =
			`${report.period} | ${report.currency} | ${report.run_kind === 'OFF_CYCLE' ? 'Extra payroll' : 'Regular payroll'} | Pay date: ${report.pay_date} | Run: ${report.run_reference}`;
		sheet.getCell(3, 1).value =
			'Company payment = net pay + employee and employer statutory + external remittances + company bank charges. Internal loan recoveries stay deducted.';
		sheet.getCell(3, 1).alignment = { wrapText: true, vertical: 'middle' };
		sheet.getRow(3).height = 30;
		sheet.getCell(4, 1).value = report.warnings.join(' ');
		sheet.getCell(4, 1).alignment = { wrapText: true, vertical: 'middle' };
		if (report.warnings.length > 0) {
			sheet.getRow(4).height = 42;
			sheet.getCell(4, 1).fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFFFE8AE' }
			};
		}
		for (const [index, text] of ['Employee no.', 'Employee name', 'Payment status'].entries()) {
			sheet.mergeCells(6, index + 1, 7, index + 1);
			sheet.getCell(6, index + 1).value = text;
		}
		for (let index = 0; index < report.columns.length;) {
			const first = index;
			const group = report.columns[index]?.group;
			while (index + 1 < report.columns.length && report.columns[index + 1]?.group === group)
				index++;
			if (index > first) sheet.mergeCells(6, first + 4, 6, index + 4);
			sheet.getCell(6, first + 4).value = group ?? '';
			index++;
		}
		for (const [index, column] of report.columns.entries())
			sheet.getCell(7, index + 4).value =
				column.family === 'TOTAL' ? column.label : `${column.label}\n${column.code}`;
		for (const rowNumber of [6, 7]) {
			sheet.getRow(rowNumber).height = rowNumber === 6 ? 32 : 90;
			for (let column = 1; column <= last; column++) {
				const cell = sheet.getCell(rowNumber, column);
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18344F' } };
				cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
				cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
			}
		}
		const decimals = report.minor_units === 0 ? '' : `.${'0'.repeat(report.minor_units)}`;
		const format = `#,##0${decimals};[Red](#,##0${decimals});"–"`;
		const companyIndex = report.columns.findIndex(
			(column) => column.family === 'TOTAL' && column.code === 'COMPANY_PAYMENT'
		);
		const netIndex = report.columns.findIndex(
			(column) => column.family === 'TOTAL' && column.code === 'NET'
		);
		for (const [index, row] of report.rows.entries()) {
			const rowNumber = index + 8;
			sheet.getRow(rowNumber).height = row.amounts.some((amount) => amount === null) ? 30 : 20;
			sheet.getCell(rowNumber, 1).value = row.employee_number;
			sheet.getCell(rowNumber, 2).value = row.name;
			sheet.getCell(rowNumber, 3).value =
				row.status === 'ON_HOLD' ? 'On hold' : row.status === 'PAID' ? 'Paid' : 'To be paid';
			for (const [column, amount] of row.amounts.entries()) {
				const cell = sheet.getCell(rowNumber, column + 4);
				cell.value = amount === null ? 'Needs confirmation' : amount;
				cell.numFmt = format;
				if (column === companyIndex && amount !== null) {
					const terms = [
						sheet.getCell(rowNumber, netIndex + 4).address,
						...report.columns.flatMap((column, index) =>
							column.external ? [sheet.getCell(rowNumber, index + 4).address] : []
						)
					];
					cell.value = { formula: terms.join('+'), result: amount };
				}
				if (column === companyIndex || amount === null) {
					cell.fill = {
						type: 'pattern',
						pattern: 'solid',
						fgColor: { argb: amount === null ? 'FFFFE8AE' : 'FFE0F0E6' }
					};
					cell.font = { bold: true };
					cell.alignment = { wrapText: true, vertical: 'middle' };
				}
			}
		}
		const totalRow = report.rows.length + 8;
		sheet.getCell(totalRow, 2).value = 'Total';
		for (const [index] of report.columns.entries()) {
			const cell = sheet.getCell(totalRow, index + 4);
			const values = report.rows.map((row) => row.amounts[index] ?? null);
			if (values.some((value) => value === null)) cell.value = 'Needs confirmation';
			else {
				const sum = values
					.reduce<Decimal>((sum, value) => sum.plus(Decimal.of(String(value ?? 0))), Decimal.of(0))
					.toNumber();
				cell.value =
					report.rows.length === 0
						? 0
						: {
								formula: `SUM(${sheet.getCell(8, index + 4).address}:${sheet.getCell(totalRow - 1, index + 4).address})`,
								result: sum
							};
			}
			cell.numFmt = format;
			cell.font = { bold: true };
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0EAF2' } };
			cell.alignment = { wrapText: true };
		}
		sheet.getRow(totalRow).height = 30;
		sheet.autoFilter = { from: { row: 7, column: 1 }, to: { row: totalRow - 1, column: last } };
	}
	return workbook;
}

export const downloadSalaryReport = (reports: readonly SalaryReport[]) =>
	Effect.tryPromise(async () => {
		if (reports.length === 0) return;
		const bytes = await salaryWorkbook(reports).xlsx.writeBuffer();
		const url = URL.createObjectURL(
			new Blob([new Uint8Array(bytes)], {
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			})
		);
		const link = Object.assign(document.createElement('a'), {
			href: url,
			download:
				reports.length === 1 ? `salary-listing-${reports[0]?.period}.xlsx` : 'salary-listings.xlsx'
		});
		document.body.append(link);
		const clicked = Result.try(() => link.click());
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		Result.getOrThrow(clicked);
	});
