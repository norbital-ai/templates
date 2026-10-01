// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What the `payroll_export` automation hands the outside world for the selected runs: the artefacts in the order
 * the payroll page routes them, each named by its period, stored on the run; the employments left out of the bank
 * file named; a later bank payment held until earlier contribution shortfalls are funded.
 *
 * The run under test is the public fixture's January, built by the real transform, so the payslip these artefacts
 * are made of is the one `public-month.test.ts` asserts figure by figure.
 * `verify-payroll-export-data.mjs` and `verify-payroll-xlsx.mjs` pin the workbook's contents.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import payslipsCollection from '../src/data/collection/payslips/+collection.ts';
import payrollExport from '../src/automation/+payroll_export.automation.ts';
import { memoryDb } from './helpers/ctx.ts';
import { createRun, storeRun } from './helpers/settlement.ts';
import { EMPLOYMENT_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';

const PERIOD = '2026-01';
const BANK = {
	bank_account_name: 'Public Fixture Employee',
	bank_code: 'MBBEMYKL',
	bank_name: 'Maybank',
	bank_account_number: '512345678901'
};

async function januaryWorld({
	bank = false,
	period = PERIOD,
	runId = `run:${period}`,
	world
} = {}) {
	world ??= createPublicPayrollWorld({ includePayment: true });
	if (bank) world.employments[0].bank = BANK;
	for (const day of world.work_days)
		// The shift's granted 60 minutes, punched as a gap — a break owed and not taken is worked
		// time, and nine continuous hours price an hour outside ordinary paid work.
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T12:30:00+08:00` },
			{ start: `${day.work_date}T13:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	storeRun(world, await createRun(world, period), runId);
	return { world, runId };
}

/** The run's body over the world, with the files it stores kept as text. */
async function exportRuns(world, ids, kind) {
	const stored = new Map();
	const db = memoryDb(world);
	const ctx = {
		read: db.read,
		query: async (collection, name, input) => {
			assert.equal(collection, 'payslips');
			assert.equal(name, 'payslip_pdf');
			return payslipsCollection.bodies.queries.payslip_pdf(input, {
				read: db.read,
				refuse: (message) => {
					throw new Error(message);
				}
			});
		},
		progress: async () => {},
		files: {
			put: async (bytes, { name, mime, for: owner }) => {
				assert.equal(owner, 'payroll_export');
				stored.set(name, { mime, bytes, text: new TextDecoder().decode(bytes) });
				return { id: name, name, mime };
			}
		}
	};
	const { artefacts } = await payrollExport.body({ ids, ...(kind == null ? {} : { kind }) }, ctx);
	return { artefacts, file: (ref) => stored.get(ref.name) };
}

test('a settled run exports its bank file, a payslip per employment and both workbooks, in routing order', async () => {
	const { world, runId } = await januaryWorld({ bank: true });
	const { artefacts, file } = await exportRuns(world, [runId]);
	assert.deepEqual(
		artefacts.map((artefact) => [artefact.kind, artefact.files.map((ref) => ref.name)]),
		[
			['bank-files', [`bank_payments_${PERIOD}.csv`]],
			['payslip-pdfs', [`payslip_${PERIOD}_PF0001.pdf`]],
			['payroll-report-xlsx', [`payroll_report_${PERIOD}.xlsx`]],
			['catalogue-entries-xlsx', [`catalogue_entries_${PERIOD}.xlsx`]]
		]
	);
	const rows = file(artefacts[0].files[0]).text.split('\r\n');
	assert.equal(rows.length, 2, 'a header row and one row per paid payslip');
	// The net of the payslip `public-month.test.ts` pins plus the 100 bonus, to the cent, as text.
	assert.match(
		rows[1],
		/^PAYMENT,2026-01-31,PF0001,Public Fixture Employee,MBBEMYKL,Maybank,512345678901,3861.00,MYR,2026-01-PF0001$/
	);
	const pdf = file(artefacts[1].files[0]);
	assert.equal(pdf.mime, 'application/pdf');
	assert.ok(pdf.text.startsWith('%PDF'));
	const document = await getDocument({ data: pdf.bytes.slice(), useSystemFonts: false }).promise;
	const content = await (await document.getPage(1)).getTextContent();
	const extracted = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ');
	assert.match(extracted, /\bNet\s+pay\b/);
	await document.destroy();
	// Each export button asks for its own artefact.
	const one = await exportRuns(world, [runId], 'payslip-pdfs');
	assert.deepEqual(
		one.artefacts.map((artefact) => artefact.kind),
		['payslip-pdfs']
	);
});

test('a payslip with no bank destination is named as skipped; no payslips is no artefacts', async () => {
	const { world, runId } = await januaryWorld();
	const [bank] = (await exportRuns(world, [runId])).artefacts;
	assert.equal(bank.included_payslips, 0);
	assert.deepEqual(bank.skipped_employment_ids, [EMPLOYMENT_ID]);
	world.payslips.length = 0;
	assert.deepEqual((await exportRuns(world, [runId])).artefacts, []);
});

test('a settled payslip PDF retains its salary dates after the company changes to weekly payroll', async () => {
	const { world, runId } = await januaryWorld();
	const settled = world.payslips.find((row) => row.payroll_run_id === runId);
	assert.ok(settled.salary_from != null && settled.salary_to != null);
	// January was settled on the monthly calendar. Its token cannot be resolved on a weekly
	// calendar: the export must use the captured salary window without evaluating the fallback.
	world.companies[0].pay_frequency = 'WEEKLY';
	const { artefacts, file } = await exportRuns(world, [runId], 'payslip-pdfs');
	const pdf = file(artefacts[0].files[0]);
	const document = await getDocument({ data: pdf.bytes.slice(), useSystemFonts: false }).promise;
	const content = await (await document.getPage(1)).getTextContent();
	const extracted = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ');
	assert.match(extracted, /Salary\s+period:\s+2026-01-01\s+to\s+2026-01-31/);
	await document.destroy();
});

test('a later bank payment waits for earlier contribution shortfalls funded by its payment date', async () => {
	const first = await januaryWorld({ bank: true });
	const second = await januaryWorld({ bank: true, period: '2026-02', world: first.world });
	const earlier = first.world.payslips.find((row) => row.payroll_run_id === first.runId);
	Object.assign(earlier, { net: 0, unfunded_contributions: 150, funding_received: 0 });
	await assert.rejects(exportRuns(first.world, [second.runId]), /2026-01.*contribution funding/);
	Object.assign(earlier, {
		funding_received: 150,
		funding_received_on: '2026-02-28',
		funding_reference: 'RECEIPT-1'
	});
	const [bank] = (await exportRuns(first.world, [second.runId])).artefacts;
	assert.equal(bank.included_payslips, 1);
});

test('two runs selected together export as two sets, each named by its own period', async () => {
	const first = await januaryWorld({ bank: true });
	const second = await januaryWorld({ bank: true, period: '2026-02', world: first.world });
	const { artefacts } = await exportRuns(first.world, [first.runId, second.runId]);
	const names = artefacts.flatMap((artefact) => artefact.files.map((ref) => ref.name));
	assert.deepEqual(
		artefacts.map((artefact) => artefact.label),
		[
			`Bank file ${PERIOD}`,
			'Bank file 2026-02',
			`Payslips ${PERIOD}`,
			'Payslips 2026-02',
			'Payroll workbook',
			'Catalogue entries'
		]
	);
	assert.equal(new Set(names).size, names.length, `a duplicate filename: ${names}`);
});

test('saved payment status and individual paid_at determine the PDF payment statement', async () => {
	const { world, runId } = await januaryWorld();
	const slip = world.payslips.find((row) => row.payroll_run_id === runId);
	// Projection test: an unpaid capture must not use its run's planned pay day as payment evidence.
	slip.status = 'DRAFT';
	slip.paid_at = null;
	const unpaid = await exportRuns(world, [runId], 'payslip-pdfs');
	const read = async (bytes) => {
		const document = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
		const content = await (await document.getPage(1)).getTextContent();
		const value = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join('');
		await document.destroy();
		return value;
	};
	assert.match(await read(unpaid.file(unpaid.artefacts[0].files[0]).bytes), /Scheduled pay date:/);
	// The same saved slip's actual payment is an individual event, independent of the run date.
	slip.status = 'PAID';
	slip.paid_at = '2026-01-16';
	const paid = await exportRuns(world, [runId], 'payslip-pdfs');
	const value = await read(paid.file(paid.artefacts[0].files[0]).bytes);
	assert.match(value, /Paid 2026-01-16/);
	assert.match(value, /Pay date: 2026-01-16/);
	assert.doesNotMatch(value, /Scheduled pay date:/);
});

for (const [timezone, instant, expected] of [
	['Asia/Tokyo', '2026-01-14T15:30:00Z', '2026-01-15'],
	['Asia/Ho_Chi_Minh', '2026-01-14T16:30:00Z', '2026-01-14'],
	['Asia/Ho_Chi_Minh', '2026-01-14T17:30:00Z', '2026-01-15'],
	['Asia/Kuala_Lumpur', '2026-01-14T15:30:00Z', '2026-01-14'],
	['Asia/Kuala_Lumpur', '2026-01-14T16:30:00Z', '2026-01-15']
])
	test(`saved payment instant ${instant} uses captured payroll zone ${timezone}`, async () => {
		const { world, runId } = await januaryWorld();
		const slip = world.payslips.find((row) => row.payroll_run_id === runId);
		const run = world.payroll_runs.find((row) => row.id === runId);
		world.jurisdiction_settings.find((row) => row.id === run.settings_id).payroll.timezone =
			timezone;
		slip.status = 'PAID';
		slip.paid_at = instant;
		const exported = await exportRuns(world, [runId], 'payslip-pdfs');
		const document = await getDocument({
			data: exported.file(exported.artefacts[0].files[0]).bytes.slice(),
			useSystemFonts: false
		}).promise;
		const content = await (await document.getPage(1)).getTextContent();
		const value = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join('');
		await document.destroy();
		assert.ok(value.includes(`Paid ${expected}`));
		assert.ok(value.includes(`Pay date: ${expected}`));
	});
