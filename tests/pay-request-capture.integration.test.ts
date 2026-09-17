// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** Standing allowances price one entry per period; a window of one period is priced once. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAccepted } from '@norbital-ai/test-utilities';
import { createRun, payslipsOf, storeRun } from './helpers/settlement.ts';
import { writeRows } from './helpers/write.ts';
import {
	ONE_OFF_ENTRY_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	STANDING_ENTRY_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import {
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const PUBLIC_STANDING_ENTRY_ID = '88888888-8888-4888-8888-888888888888';
const CREATE_PAYROLL_COMMAND = 'collections.write';

const JAN_RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const FEB_RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const JAN_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const FEB_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

/** The run's transform over the world, stored as the database would hold it: pins and all. */
async function createPayrollRun(world, period, runId = crypto.randomUUID()) {
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	}
	const created = await createRun(world, period);
	storeRun(world, created, runId);
	return { ...created, payslip_payroll_run: payslipsOf(created) };
}

/** The entries a run priced from the standing allowances, read back off the world. */
function materialisedOf(world, payslipId) {
	return (world.allowance_entries ?? []).filter((row) => row.payslip_id === payslipId);
}

/** Pay the stored run: consumption is read as history only off paid slips. */
function persistPayslip(world, options) {
	for (const slip of world.payslips)
		if (slip.payroll_run_id === options.runId) slip.paid_at = `${options.period}-28`;
}

test('a standing allowance is captured on two periods and two payslips', async () => {
	const world = createPublicPayrollWorld();
	const january = await createPayrollRun(world, '2026-01', JAN_RUN);
	const januarySlip = january.payslip_payroll_run[0];
	const januaryRows = materialisedOf(world, januarySlip.id);
	assert.deepEqual(
		januaryRows.map((row) => row.derived_from_id),
		[STANDING_ENTRY_ID]
	);
	persistPayslip(world, {
		runId: JAN_RUN,
		payslipId: januarySlip.id,
		payslip: januarySlip,
		period: '2026-01',
		paid: true
	});

	const february = await createPayrollRun(world, '2026-02');
	const februarySlip = february.payslip_payroll_run[0];
	const februaryRows = materialisedOf(world, februarySlip.id);
	assert.deepEqual(
		februaryRows.map((row) => row.derived_from_id),
		[STANDING_ENTRY_ID]
	);
	assert.equal(String(januaryRows[0].from).slice(0, 7), '2026-01');
	assert.equal(String(februaryRows[0].from).slice(0, 7), '2026-02');
	assert.notEqual(januarySlip.employment_id, undefined);
	assert.equal(februarySlip.employment_id, EMPLOYMENT_ID);
});

test('an allowance whose window is one period is priced once and not raised again', async () => {
	const world = createPublicPayrollWorld({ includePayment: true });
	const january = await createPayrollRun(world, '2026-01', JAN_RUN);
	const januarySlip = january.payslip_payroll_run[0];
	assert.ok(
		materialisedOf(world, januarySlip.id).some((row) => row.derived_from_id === ONE_OFF_ENTRY_ID),
		'January prices the one-period window'
	);
	persistPayslip(world, {
		runId: JAN_RUN,
		payslipId: januarySlip.id,
		payslip: januarySlip,
		period: '2026-01',
		paid: true
	});

	const february = await createPayrollRun(world, '2026-02');
	const februarySlip = february.payslip_payroll_run[0];
	assert.equal(
		materialisedOf(world, februarySlip.id).some((row) => row.derived_from_id === ONE_OFF_ENTRY_ID),
		false,
		'the window closed in January'
	);
	assert.equal(materialisedOf(world, februarySlip.id).length, 1);
});

test(
	'public seed standing allowance lands on January and February payslips',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-pay-request-capture');
		try {
			for (const period of [JANUARY_2026, FEBRUARY_2026]) {
				const created = await writeRows(session, 'payroll_runs', 'create', [
					{ company_id: COMPANY_ID, period }
				]);
				assert.ok(
					created.status >= 200 && created.status < 300,
					`${CREATE_PAYROLL_COMMAND} ${period} returned ${created.status}: ${JSON.stringify(created.value)}`
				);
				requireAccepted(created.value, `${CREATE_PAYROLL_COMMAND} ${period}`);
				if (period === JANUARY_2026) {
					await session.query(
						`update payslips set status = 'PAID', paid_at = $3
						  where payroll_run_id = (
							select id from payroll_runs where company_id = $1 and period = $2
						  )`,
						[COMPANY_ID, JANUARY_2026, `${JANUARY_2026}-28`]
					);
				}
			}

			const captures = (await session.query(
				// A day-precision instant is midnight in the entity's own zone; read it back there.
				`select to_char("from" at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') as from_date, payslip_id
				 from allowance_entries
				 where derived_from_id = $1
				 order by "from"`,
				[PUBLIC_STANDING_ENTRY_ID]
			)) as ReadonlyArray<{ readonly from_date: string; readonly payslip_id: string }>;
			const periods = [...new Set(captures.map((row) => row.from_date.slice(0, 7)))].toSorted();
			assert.deepEqual(
				periods,
				[JANUARY_2026, FEBRUARY_2026],
				`standing entry must land on both public periods, got ${JSON.stringify(captures)}`
			);
			for (const period of [JANUARY_2026, FEBRUARY_2026]) {
				const rows = captures.filter((row) => row.from_date.slice(0, 7) === period);
				assert.equal(rows.length, 1, `one entry for ${period}`);
			}
		} finally {
			await session.stop();
		}
	}
);
