// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What the export pipeline hands the outside world for a settled run.
 *
 * `verify-payroll-export-data.mjs` pins `lib/export-data.ts` — the read that assembles a
 * `ReportPayslip` — and `verify-payroll-xlsx.mjs` pins the workbook built from one. Neither runs
 * `+pipelines.ts`, which is the module a person actually reaches: it decides how many artefacts a
 * selection produces, what each one is called, what its `metadata.kind` says and — the part that
 * only exists here — which employments were left out of the bank file and are named as skipped.
 *
 * The run under test is the public fixture's January, built by the real gather and create hook, so
 * the payslip these artefacts are made of is the one `public-month.test.ts` asserts figure by
 * figure: gross 3,761, net 3,761, BASIC 3,451 and a standing TRANSPORT of 310.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import payrollRunPipelines from '../src/collections/payroll_runs/+pipelines.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';

const RUN_ID = 'run:2026-01';
const PERIOD = '2026-01';
const PAY_DATE = '2026-01-31';
const EMPLOYEE_NUMBER = 'PF0001';

/** The destination a payslip is paid to. Absent on the fixture employment, which is the skip case. */
const BANK = {
	bank_account_name: 'Public Fixture Employee',
	bank_code: 'MBBEMYKL',
	bank_name: 'Maybank',
	bank_account_number: '512345678901'
};

/**
 * The public fixture's January, settled and stored the way a persisted run is read back.
 *
 * The create hook returns the run with its payslips nested; the export reads them from the
 * `payslips` table by `payroll_run_id`, so the nested write is unrolled into the world here exactly
 * as the database would hold it.
 */
async function januaryWorld({ bank = false } = {}) {
	const world = createPublicPayrollWorld();
	if (bank) world.employments[0].bank = BANK;
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
		day.break_minutes = 60;
	}
	const api = memoryPayrollApi(world);
	const prepared = await Effect.runPromise(
		payrollRunHooks.mutate.prepare({ inputs: [{ company_id: COMPANY_ID, period: PERIOD }], api })
	);
	const created = await Effect.runPromise(
		payrollRunHooks.mutate.perRecord.before.handler({
			input: { company_id: COMPANY_ID, period: PERIOD },
			existing: undefined,
			prepared,
			api
		})
	);
	const run = {
		id: RUN_ID,
		company_id: created.company_id,
		settings_id: created.settings_id,
		period: created.period,
		pay_date: created.pay_date,
		attendance_from: created.attendance_from,
		attendance_to: created.attendance_to
	};
	world.payroll_runs.push({ ...run, lifecycle: created.lifecycle });
	for (const payslip of created.payslip_payroll_run)
		world.payslips.push({ ...payslip, payroll_run_id: RUN_ID });
	return { world, run };
}

const exportRuns = (world, runs) =>
	Effect.runPromise(payrollRunPipelines.export.handler({ records: runs }, memoryPayrollApi(world)));

/** Every action of a manifest is a label, a list of named attachments and its routing metadata. */
const assertManifestShape = (manifest) => {
	assert.ok(Array.isArray(manifest), 'an export manifest is a list of actions');
	for (const action of manifest) {
		assert.equal(typeof action.label, 'string');
		assert.ok(action.label.length > 0, 'every action is labelled');
		assert.ok(Array.isArray(action.attachments) && action.attachments.length > 0);
		for (const attachment of action.attachments) {
			assert.ok(attachment.name.length > 0);
			assert.ok(['CSV', 'PDF', 'XLSX'].includes(attachment.contentType), attachment.contentType);
			assert.notEqual(attachment.content, null);
		}
		assert.equal(typeof action.metadata.kind, 'string');
	}
	return new Map(manifest.map((action) => [action.metadata.kind, action]));
};

test('a settled run exports a bank file, a payslip per employment and the workbook', async () => {
	const { world, run } = await januaryWorld({ bank: true });
	const manifest = await exportRuns(world, [run]);
	const byKind = assertManifestShape(manifest);
	assert.deepEqual(
		manifest.map((action) => action.metadata.kind),
		['bank-files', 'payslip-pdfs', 'payroll-report-xlsx'],
		'three artefacts, in the order the app routes them'
	);

	// ── the bank file: one row per paid payslip, under one header row ───────────────────────────
	const bank = byKind.get('bank-files');
	assert.equal(bank.label, `Bank file ${PERIOD}`);
	assert.equal(bank.metadata.period, PERIOD);
	assert.equal(bank.metadata.included_payslips, 1);
	assert.equal(bank.metadata.skipped_payslips, 0);
	assert.deepEqual(bank.metadata.skipped_employment_ids, []);
	assert.equal(bank.attachments.length, 1);
	assert.equal(bank.attachments[0].name, `bank_payments_${PERIOD}.csv`);
	assert.equal(bank.attachments[0].contentType, 'CSV');
	const rows = bank.attachments[0].content;
	assert.equal(rows.length, 1 + world.payslips.length, 'a header row and one row per paid payslip');
	assert.equal(rows[0][0], 'record_type');
	assert.deepEqual(rows[1], [
		'PAYMENT',
		PAY_DATE,
		EMPLOYEE_NUMBER,
		BANK.bank_account_name,
		BANK.bank_code,
		BANK.bank_name,
		BANK.bank_account_number,
		// The net of the payslip `public-month.test.ts` pins, to the cent, as text.
		'3761.00',
		'MYR',
		`${RUN_ID}:${EMPLOYEE_NUMBER}`
	]);

	// ── the payslips: one PDF per employment on the run ──────────────────────────────────────────
	const payslips = byKind.get('payslip-pdfs');
	assert.equal(payslips.label, `Payslips ${PERIOD}`);
	assert.equal(payslips.attachments.length, world.payslips.length);
	assert.deepEqual(
		payslips.attachments.map((attachment) => attachment.name),
		[`payslip_${PERIOD}_${EMPLOYEE_NUMBER}.pdf`]
	);
	for (const attachment of payslips.attachments) {
		assert.equal(attachment.contentType, 'PDF');
		// A PDF is its header: anything that does not start `%PDF` is not one, whatever it contains.
		assert.ok(
			String(attachment.content).startsWith('%PDF'),
			`payslip attachment is not a PDF: ${String(attachment.content).slice(0, 40)}`
		);
		assert.match(String(attachment.content), /Net pay/);
	}

	// ── the workbook: one file naming the period it covers ───────────────────────────────────────
	const workbook = byKind.get('payroll-report-xlsx');
	assert.equal(workbook.attachments[0].name, `payroll_report_${PERIOD}.xlsx`);
	assert.equal(workbook.attachments[0].contentType, 'XLSX');
	assert.deepEqual(workbook.metadata.periods, [PERIOD]);
});

test('a payslip with no bank destination is named as skipped rather than dropped in silence', async () => {
	// The public fixture employment carries no bank account, which is the case this covers.
	const { world, run } = await januaryWorld();
	const manifest = await exportRuns(world, [run]);
	const byKind = assertManifestShape(manifest);

	const bank = byKind.get('bank-files');
	assert.ok(bank != null, 'a run that pays nobody still hands out the file naming who was skipped');
	assert.equal(bank.metadata.included_payslips, 0);
	assert.equal(bank.metadata.skipped_payslips, 1);
	assert.deepEqual(bank.metadata.skipped_employment_ids, [EMPLOYMENT_ID]);
	assert.equal(bank.attachments[0].content.length, 1, 'the header row and no payments');

	// The payslip itself is unaffected: not being payable by transfer is not being unpaid.
	assert.equal(byKind.get('payslip-pdfs').attachments.length, 1);
});

test('a run with no payslips answers a manifest with nothing in it', async () => {
	const { world, run } = await januaryWorld({ bank: true });
	world.payslips.length = 0;
	const manifest = await exportRuns(world, [run]);
	assertManifestShape(manifest);
	assert.deepEqual(manifest, [], 'no payslips is no artefacts, not a file with a header in it');
});
