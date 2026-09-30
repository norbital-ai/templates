import { automation } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { loadRunExports } from '../lib/payroll/run/export-data.js';
import {
	bankFileDeclaration,
	filingGroups,
	filingPayer,
	generateReturn,
	loadReturns,
	returnVersions,
	type GeneratedFile
} from '../lib/payroll/run/returns.js';
import { returnsOf, type ReturnDeclaration } from '../lib/datatypes/returns.js';
import {
	bankFileRows,
	catalogueEntriesXlsx,
	hasCatalogueEntries,
	payrollReportXlsx,
	payslipPdf,
	tableXlsx
} from '../lib/payroll/run/export.js';
import { PlainDate } from '@norbital-ai/std/date';
import { decodeNumber, plainRows } from '../lib/wire.js';
import { readAll } from '../lib/reads.js';
import * as Predicate from 'effect/Predicate';
import { loadIncomeReturns } from '../lib/payroll/run/income-return.js';
import { refuse } from '../lib/refuse.js';
import { dateKey } from '../lib/iso-day.js';
import { resolveWindow } from '../lib/payroll/run/period.js';
import type { WorkspaceRow } from '../lib/rows.js';

/** The artefacts, in the order the payroll page offers them. */
const KINDS = [
	'bank-files',
	'payslip-pdfs',
	'payroll-report-xlsx',
	'catalogue-entries-xlsx',
	'income-tax-returns',
	'returns'
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
		skipped_employment_ids: { kind: 'list', of: { kind: 'text' }, optional: true },
		/** The declared return (or bank file) code the file was generated from. */
		return_code: { kind: 'text', optional: true },
		/** The obligation instances the file was attached to as evidence. */
		evidenced_obligation_ids: { kind: 'list', of: { kind: 'text' }, optional: true }
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
		"Turns the selected payroll runs into the artefacts a settled period hands out: a bank payment file (the version's declared layout for the payer's bank, else a generic listing), one PDF payslip per employee, the payroll report workbook, and the catalogue entries workbook (allowances, claims and loans only, with totals); asked for by kind, the version's declared statutory returns of each run, month, quarter or year (attached as evidence to the duty each one fulfils), or the employment-income returns of each selected year.",
	input: {
		ids: { kind: 'list', of: { kind: 'id', of: 'payroll_runs' }, min: 1 },
		kind: { kind: 'enum', values: KINDS, optional: true },
		/** `returns`: only these declared return codes; every declared return of the runs' cadences without. */
		codes: { kind: 'list', of: { kind: 'text' }, optional: true },
		/** The income returns: who signs them, and the day they sign. */
		authorised_person: {
			kind: 'object',
			optional: true,
			fields: {
				name: { kind: 'text' },
				designation: { kind: 'text' },
				contact: { kind: 'text' },
				date: { kind: 'date' }
			}
		},
		/** ORIGINAL; REVISION restates whole records; AMENDMENT submits differences from `submitted`. */
		submission: { kind: 'enum', values: ['ORIGINAL', 'AMENDMENT', 'REVISION'], optional: true },
		/** The amounts already submitted, one per identity number and declared return item key. */
		submitted: {
			kind: 'list',
			optional: true,
			of: {
				kind: 'object',
				fields: { id_number: { kind: 'text' }, item: { kind: 'text' }, amount: { kind: 'number' } }
			}
		}
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

/** A record's leaves as one CSV row, keyed by their dotted path (`employee.id_number`). */
const flatten = (value: object, prefix = ''): [string, string | number][] =>
	Object.entries(value).flatMap(([key, leaf]): [string, string | number][] =>
		Predicate.isObject(leaf) && !Array.isArray(leaf)
			? flatten(leaf, `${prefix}${key}.`)
			: [[`${prefix}${key}`, leaf == null ? '' : (leaf as string | number)]]
	);
const recordsCsv = (records: readonly object[]) => {
	const rows = records.map((record) => flatten(record));
	const header = [...new Set(rows.flatMap((row) => row.map(([key]) => key)))];
	return csv([
		header,
		...rows.map((row) => {
			const cells = new Map(row);
			return header.map((key) => cells.get(key) ?? '');
		})
	]);
};

payroll_export.run(async ({ ids, kind, codes, authorised_person, submission, submitted }, ctx) => {
	const wants = (artefact: (typeof KINDS)[number]) => kind == null || kind === artefact;
	const put = (bytes: Uint8Array, name: string, mime: string) =>
		ctx.files.put(bytes, { name, mime, for: 'payroll_export' });
	const runs = await readAll<Parameters<typeof loadRunExports>[1][number]>(ctx, 'payroll_runs', {
		id: { in: ids }
	});
	const exports = await loadRunExports(ctx, runs);
	const artefacts = [];
	const companies = await readAll<WorkspaceRow<'companies'>>(ctx, 'companies', {
		id: { in: [...new Set(runs.map((run) => run.company_id))] }
	});
	const saveFile = async (file: GeneratedFile) =>
		put(
			file.text == null
				? Uint8Array.from(await Effect.runPromise(tableXlsx(file.name, file.table)))
				: encode(file.text),
			file.name,
			file.mime
		);
	/**
	 * The file is the evidence of the duty its declaration names: every OPEN instance of that duty on the entity or
	 * the covered runs for the same period records the file under its completion fact. Fulfilment stays the
	 * controller's: the authority's acknowledgement is recorded by hand.
	 */
	const evidence = async (
		declaration: ReturnDeclaration,
		scope: { companyId: string; period: string; runIds: readonly string[] },
		file: Awaited<ReturnType<typeof put>>,
		name: string
	) => {
		const target = declaration.evidence;
		if (target == null) return [];
		const open = plainRows<{ id: string; facts?: Record<string, unknown> | null }>(
			await ctx.read('obligation_instances', {
				where: {
					duty_code: { eq: target.duty },
					trigger_ref: { eq: scope.period },
					subject_id: { in: [scope.companyId, ...scope.runIds] },
					state: { eq: 'OPEN' }
				},
				select: { facts: true },
				all: true
			} as never)
		);
		for (const instance of open) {
			await ctx.act('obligation_instances.update', {
				target: instance.id,
				set: { facts: { ...instance.facts, [target.fact_key]: name } }
			} as never);
			await ctx.act('fact_evidence.create', {
				subject: { collection: 'obligation_instances', id: instance.id },
				fact_key: target.fact_key,
				reference: name,
				file,
				received_on: PlainDate(dateKey(String(ctx.today)))
			} as never);
		}
		return open.map((instance) => instance.id);
	};

	const bankRuns = wants('bank-files')
		? exports.filter((run) => run.bank.length > 0 || run.skippedEmploymentIds.length > 0)
		: [];
	const versions = await returnVersions(
		ctx,
		bankRuns.map((run) => runs.find((row) => row.id === run.runId)!.settings_id)
	);
	for (const run of bankRuns) {
		const row = runs.find((candidate) => candidate.id === run.runId)!;
		const company = companies.find((candidate) => candidate.id === row.company_id);
		const version = versions.get(row.settings_id);
		// The entity's own bank governs the layout: the file is uploaded to the payer's bank. A payer whose bank the
		// version declares no layout for keeps the generic listing rather than a wrong fixed-width file.
		const declaration =
			run.payer === null ? null : bankFileDeclaration(returnsOf(version), run.payer.bank_code);
		const generated =
			declaration == null
				? null
				: generateReturn({
						declaration,
						filing: {
							code: declaration.code,
							period: run.period,
							year: decodeNumber(run.period.slice(0, 4)),
							pay_date: run.payDate
						},
						company: {
							settings_code: company?.settings_code ?? '',
							name: company?.name ?? '',
							facts: (company?.facts as Record<string, unknown> | null | undefined) ?? {}
						},
						payer: filingPayer(run.payer),
						groups: filingGroups([run], true),
						currency: version?.payroll?.currency
					});
		const file =
			generated == null
				? await put(
						encode(
							csv(
								bankFileRows(
									run.bank.map((payment) => ({
										...payment,
										payrollRunId: run.runId,
										paymentDate: run.payDate
									}))
								)
							)
						),
						`bank_payments_${run.period}.csv`,
						'text/csv'
					)
				: await saveFile(generated);
		artefacts.push({
			label: `Bank file ${run.period}`,
			kind: 'bank-files' as const,
			periods: [run.period],
			files: [file],
			bank_format: declaration?.code ?? 'generic',
			included_payslips: run.bank.length,
			skipped_employment_ids: [...run.skippedEmploymentIds],
			...(declaration == null
				? {}
				: {
						return_code: declaration.code,
						evidenced_obligation_ids: await evidence(
							declaration,
							{ companyId: row.company_id, period: run.period, runIds: [run.runId] },
							file,
							generated!.name
						)
					})
		});
	}

	if (kind === 'returns')
		for (const filing of await loadReturns(ctx, runs, codes ?? undefined)) {
			await ctx.progress({ text: `${filing.declaration.code} ${filing.period}` });
			const file = await saveFile(filing.file);
			artefacts.push({
				label: `${filing.declaration.label ?? filing.declaration.code} ${filing.period}`,
				kind: 'returns' as const,
				periods: [filing.period],
				files: [file],
				included_payslips: filing.file.rows,
				return_code: filing.declaration.code,
				evidenced_obligation_ids: await evidence(filing.declaration, filing, file, filing.file.name)
			});
		}

	const slipRuns = wants('payslip-pdfs') ? exports.filter((run) => run.payslips.length > 0) : [];
	for (const run of slipRuns) {
		await ctx.progress({ text: `Payslips ${run.period}` });
		const row = runs.find((candidate) => candidate.id === run.runId)!;
		const company = companies.find((candidate) => candidate.id === row.company_id);
		if (company == null)
			refuse(`Payroll run ${run.period} names a company this export cannot read.`);
		// ponytail: the salary period is the run's envelope on the company's calendar; a semi-monthly
		// second half prints the month for a monthly-cadence employee too. Per-employment cadence
		// windows when a mixed-cadence entity needs each slip's own.
		const salaryPeriod = resolveWindow(run.period, company).salary;
		const overtimePeriod = { start: dateKey(row.attendance_from), end: dateKey(row.attendance_to) };
		const files = [];
		for (const payslip of run.payslips)
			files.push(
				await put(
					encode(
						payslipPdf({
							employer: company.name,
							period: run.period,
							salaryPeriod,
							overtimePeriod,
							payDate: run.payDate,
							payslip
						})
					),
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
	if (kind === 'income-tax-returns') {
		if (authorised_person == null)
			refuse('An income return names the authorised person, their designation, contact and date.');
		const returns = await loadIncomeReturns(ctx, runs, {
			authorised: { ...authorised_person, date: dateKey(authorised_person.date) },
			submission: submission ?? 'ORIGINAL',
			submitted: new Map(
				[...Map.groupBy(submitted ?? [], (row) => row.id_number)].map(([id, rows]) => [
					id,
					Object.fromEntries(rows.map((row) => [row.item, row.amount]))
				])
			)
		});
		for (const filing of returns) {
			const files = [];
			for (const records of [filing.annual, filing.cessation])
				if (records.length > 0)
					files.push(
						await put(
							encode(recordsCsv(records)),
							`${records[0]!.form.toLowerCase()}_${filing.year}_${filing.label.replaceAll(/\W+/g, '_')}.csv`,
							'text/csv'
						)
					);
			if (files.length > 0)
				artefacts.push({
					label: `Income tax returns ${filing.label}`,
					kind: 'income-tax-returns' as const,
					periods: [String(filing.year)],
					files
				});
		}
	}
	return { artefacts };
});
