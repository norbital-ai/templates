// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** Recurring allowances capture per period; captured single-use requests are excluded later. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { mutationPush, postGuestCommand, requireAccepted } from '@norbital-ai/test-utilities';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { settledBy } from './helpers/settlement.ts';
import {
	PAYMENT_ENTRY_ID,
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
const CREATE_PAYROLL_COMMAND = 'collections.mutate';

const JAN_RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const FEB_RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const JAN_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const FEB_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

async function createPayrollRun(world, period) {
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	}
	const api = memoryPayrollApi(world);
	const prepared = await Effect.runPromise(
		payrollRunHooks.mutate.prepare({
			inputs: [{ company_id: COMPANY_ID, period }],
			api
		})
	);
	return Effect.runPromise(
		payrollRunHooks.mutate.perRecord.before.handler({
			input: { company_id: COMPANY_ID, period },
			existing: undefined,
			prepared,
			api
		})
	);
}

/** The per-period rows a run materialised from a standing source, read back off the world. */
function materialisedOf(world, payslipId) {
	return world.allowance_requests.filter(
		(row) => row.derived_from_id != null && row.payslip_id === payslipId
	);
}

function persistPayslip(world, options) {
	world.payroll_runs.push({
		id: options.runId,
		company_id: COMPANY_ID,
		period: options.period,
		approval_id: null
	});
	world.payslips.push({
		...options.payslip,
		id: options.payslipId,
		payroll_run_id: options.runId,
		paid_at: `${options.period}-28`,
		approval_id: null
	});
}

test('a standing allowance is captured on two periods and two payslips', async () => {
	const world = createPublicPayrollWorld();
	const january = await createPayrollRun(world, '2026-01');
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
	assert.equal(String(januaryRows[0].recurrence.from).slice(0, 7), '2026-01');
	assert.equal(String(februaryRows[0].recurrence.from).slice(0, 7), '2026-02');
	assert.notEqual(januarySlip.employment_id, undefined);
	assert.equal(februarySlip.employment_id, EMPLOYMENT_ID);
});

test('a captured single-use request is excluded from the next regular payroll', async () => {
	const world = createPublicPayrollWorld({ includePayment: true });
	const january = await createPayrollRun(world, '2026-01');
	const januarySlip = january.payslip_payroll_run[0];
	assert.deepEqual(
		settledBy(world, 'payment_requests', januarySlip.id),
		[PAYMENT_ENTRY_ID],
		'January captures the payment once'
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
	assert.equal(settledBy(world, 'payment_requests', februarySlip.id).length, 0);
	assert.equal(materialisedOf(world, februarySlip.id).length, 1);
});

test(
	'public seed standing allowance lands on January and February payslips',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-pay-request-capture');
		try {
			for (const period of [JANUARY_2026, FEBRUARY_2026]) {
				const created = await postGuestCommand(
					session.host.baseUrl,
					CREATE_PAYROLL_COMMAND,
					mutationPush(session.schemaFingerprint, {
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [
							{
								action: 'create',
								values: {
									id: crypto.randomUUID(),
									company_id: COMPANY_ID,
									period
								}
							}
						]
					}),
					{ authorization: `Bearer ${session.credential}` }
				);
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
				`select recurrence->>'from' as from_date, payslip_id from allowance_requests
				 where derived_from_id = $1
				 order by recurrence->>'from'`,
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
				assert.equal(rows.length, 1, `one materialised row for ${period}`);
			}
		} finally {
			await session.stop();
		}
	}
);
