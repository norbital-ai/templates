import { automation } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { loadRunExports } from '../lib/payroll/run/export-data.js';
import { bankFileFor } from '../lib/payroll/run/bank-formats.js';
import {
	bankFileRows,
	catalogueEntriesXlsx,
	hasCatalogueEntries,
	payrollReportXlsx,
	payslipPdf
} from '../lib/payroll/run/export.js';
import { readAll } from '../lib/reads.js';
import * as Predicate from 'effect/Predicate';

/** The four artefacts, in the order the payroll page offers them. */
const KINDS = [
	'bank-files',
	'payslip-pdfs',
	'payroll-report-xlsx',
	'catalogue-entries-xlsx'
] as const;
const artefact = {
	kind: 'object',
	fields: {
		label: { kind: 'text' },
		kind: { kind: 'enum', values: KINDS },
		periods: { kind: 'list', of: { kind: 'text' } },
		files: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true },
		bank_format: { kind: 'text', optional: true },
		included_payslips: { kind: 'int', optional: true },
		/** Employments with net pay and no bank destination: left out of the bank file, and named. */
		skipped_employment_ids: { kind: 'list', of: { kind: 'text' }, optional: true }
	}
} as const;

/**
 * What a settled period hands the outside world, from the runs selected on the payroll page (L-TPL-hr-payroll-137,
 * §8.1): the entity bank's payment file (a generic CSV where its bank has no formatter), one PDF payslip per
 * employee, the payroll report workbook and the catalogue entries workbook (allowances, claims and loans with
 * totals). Each of the page's export buttons asks for one `kind`; without one, every artefact is built. It reads as
 * the person who started it, as the export always did, and leaves the files on its run.
 */
const payroll_export = automation({
	description:
		'Turns the selected payroll runs into the artefacts a settled period hands out: a bank payment file, one PDF payslip per employee, the payroll report workbook, and the catalogue entries workbook (allowances, claims and loans only, with totals).',
	input: {
		ids: { kind: 'list', of: { kind: 'id', of: 'payroll_runs' }, min: 1 },
		kind: { kind: 'enum', values: KINDS, optional: true }
	},
	output: { kind: 'object', fields: { artefacts: { kind: 'list', of: artefact } } },
	runAs: 'trigger'
});
export default payroll_export;

const encode = (text: string) => new TextEncoder().encode(text);
/** RFC 4180: a cell holding a comma, a quote or a line break is quoted, its quotes doubled. */
const csv = (rows: readonly (readonly (string | number)[])[]) =>
	rows
		.map((row) =>
			row
				.map((cell) => String(cell))
				.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
				.join(',')
		)
		.join('\r\n');

payroll_export.run(async ({ ids, kind }, ctx) => {
	const wants = (artefact: (typeof KINDS)[number]) => kind == null || kind === artefact;
	const put = (bytes: Uint8Array, name: string, mime: string) =>
		ctx.files.put(bytes, { name, mime, for: 'payroll_export' });
	const runs = await readAll<Parameters<typeof loadRunExports>[1][number]>(ctx, 'payroll_runs', {
		id: { in: ids }
	});
	const exports = await loadRunExports(ctx, runs);
	const artefacts = [];

	for (const run of wants('bank-files') ? exports : []) {
		if (run.bank.length === 0 && run.skippedEmploymentIds.length === 0) continue;
		// The entity's own bank governs the layout: the file is uploaded to the payer's bank. A bank with no
		// formatter keeps the generic listing rather than a wrong fixed-width file.
		const formatted =
			run.payer === null
				? null
				: bankFileFor({
						payDate: run.payDate,
						period: run.period,
						payer: run.payer,
						payments: run.bank
					});
		const file =
			formatted ??
			({
				name: `bank_payments_${run.period}.csv`,
				contentType: 'CSV',
				content: bankFileRows(
					run.bank.map((payment) => ({
						...payment,
						payrollRunId: run.runId,
						paymentDate: run.payDate
					}))
				)
			} as const);
		const text = Predicate.isString(file.content) ? file.content : csv(file.content);
		artefacts.push({
			label: `Bank file ${run.period}`,
			kind: 'bank-files' as const,
			periods: [run.period],
			files: [
				await put(encode(text), file.name, file.contentType === 'CSV' ? 'text/csv' : 'text/plain')
			],
			bank_format: formatted?.format ?? 'generic',
			included_payslips: run.bank.length,
			skipped_employment_ids: [...run.skippedEmploymentIds]
		});
	}

	for (const run of wants('payslip-pdfs') ? exports : []) {
		if (run.payslips.length === 0) continue;
		await ctx.progress({ text: `Payslips ${run.period}` });
		const files = [];
		for (const payslip of run.payslips)
			files.push(
				await put(
					encode(payslipPdf({ period: run.period, payDate: run.payDate, payslip })),
					`payslip_${run.period}_${payslip.employeeNumber}.pdf`,
					'application/pdf'
				)
			);
		artefacts.push({
			label: `Payslips ${run.period}`,
			kind: 'payslip-pdfs' as const,
			periods: [run.period],
			files
		});
	}

	const sheets = exports.filter((run) => run.payslips.length > 0);
	const label = sheets.length === 1 ? sheets[0]!.period : `${sheets.length}_runs`;
	const periods = sheets.map((run) => run.period);
	const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
	if (wants('payroll-report-xlsx') && sheets.length > 0)
		artefacts.push({
			label: 'Payroll workbook',
			kind: 'payroll-report-xlsx' as const,
			periods,
			files: [
				await put(
					Uint8Array.from(await Effect.runPromise(payrollReportXlsx(sheets))),
					`payroll_report_${label}.xlsx`,
					XLSX
				)
			]
		});
	if (wants('catalogue-entries-xlsx') && hasCatalogueEntries(sheets))
		artefacts.push({
			label: 'Catalogue entries',
			kind: 'catalogue-entries-xlsx' as const,
			periods,
			files: [
				await put(
					Uint8Array.from(await Effect.runPromise(catalogueEntriesXlsx(sheets))),
					`catalogue_entries_${label}.xlsx`,
					XLSX
				)
			]
		});
	return { artefacts };
});
