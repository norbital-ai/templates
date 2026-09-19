// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** An allowance on the contract is a base line every period; an ad hoc request is priced once. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAccepted } from '@norbital-ai/test-utilities';
import { createRun, payslipsOf, storeRun } from './helpers/settlement.ts';
import { writeRows } from './helpers/write.ts';
import {
	ONE_OFF_ENTRY_ID,
	COMPANY_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import {
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const CREATE_PAYROLL_COMMAND = 'collections.write';

const JAN_RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

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

/** The allowance's segments on a payslip, read back off the stored slip. */
const transportOf = (slip) =>
	slip.proration
		.filter((row) => row.component_code === 'TRANSPORT')
		.map((row) => [row.from, row.to, row.prorated_amount]);

/** Pay the stored run: consumption is read as history only off paid slips. */
function persistPayslip(world, options) {
	for (const slip of world.payslips)
		if (slip.payroll_run_id === options.runId) slip.paid_at = `${options.period}-28`;
}

test('an allowance on the contract is priced on two periods and two payslips', async () => {
	const world = createPublicPayrollWorld();
	const january = await createPayrollRun(world, '2026-01', JAN_RUN);
	assert.deepEqual(transportOf(january.payslip_payroll_run[0]), [
		['2026-01-01', '2026-01-31', 310]
	]);
	persistPayslip(world, { runId: JAN_RUN, period: '2026-01' });
	const february = await createPayrollRun(world, '2026-02');
	assert.deepEqual(transportOf(february.payslip_payroll_run[0]), [
		['2026-02-01', '2026-02-28', 310]
	]);
});

test('an ad hoc request is priced once and not raised again', async () => {
	const world = createPublicPayrollWorld({ includePayment: true });
	const january = await createPayrollRun(world, '2026-01', JAN_RUN);
	const januarySlip = january.payslip_payroll_run[0];
	assert.ok(
		januarySlip.adjustments.some((row) => row.source_id === ONE_OFF_ENTRY_ID),
		'January prices the request'
	);
	assert.equal(
		world.adhoc_requests.find((row) => row.id === ONE_OFF_ENTRY_ID).payslip_id,
		januarySlip.id,
		'and pins it'
	);
	persistPayslip(world, { runId: JAN_RUN, period: '2026-01' });

	const february = await createPayrollRun(world, '2026-02');
	const februarySlip = february.payslip_payroll_run[0];
	assert.equal(
		februarySlip.adjustments.some((row) => row.source_id === ONE_OFF_ENTRY_ID),
		false,
		'a request settled in January is not priced again'
	);
	assert.deepEqual(transportOf(februarySlip), [['2026-02-01', '2026-02-28', 310]]);
});

test(
	'public seed allowance on the contract lands on January and February payslips',
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

			const lines = (await session.query(
				`select r.period, s.base
				 from payslips s join payroll_runs r on r.id = s.payroll_run_id
				 where r.company_id = $1
				 order by r.period`,
				[COMPANY_ID]
			)) as ReadonlyArray<{
				readonly period: string;
				readonly base: readonly { component_code: string; amount: number | string }[];
			}>;
			assert.deepEqual(
				lines.map((row) => [
					row.period,
					row.base.find((line) => line.component_code === 'TRANSPORT')?.amount
				]),
				[
					[JANUARY_2026, 310],
					[FEBRUARY_2026, 310]
				],
				`the allowance on the contract must land on both public periods, got ${JSON.stringify(lines)}`
			);
		} finally {
			await session.stop();
		}
	}
);
