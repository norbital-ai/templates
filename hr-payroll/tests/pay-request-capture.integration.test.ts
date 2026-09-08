// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** Recurring allowances capture per period; captured single-use requests are excluded later. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { mutationPush, postGuestCommand, requireAccepted } from '@norbital-ai/test-utilities';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
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
		day.break_minutes = 60;
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

function entryCaptures(created) {
	const payslips = created.payslip_payroll_run ?? [];
	return payslips.flatMap((payslip) => payslip.payslip_allowance_request_input_payslip ?? []);
}

function persistStandingCapture(world, options) {
	world.payroll_runs.push({
		id: options.runId,
		company_id: COMPANY_ID,
		period: options.period,
		lifecycle: options.lifecycle,
		approval_id: null
	});
	world.payslips.push({
		id: options.payslipId,
		payroll_run_id: options.runId,
		employment_id: EMPLOYMENT_ID,
		statutory: [],
		approval_id: null
	});
	for (const capture of options.captures) {
		world.payslip_allowance_request_inputs.push({
			id: capture.id,
			payslip_id: options.payslipId,
			allowance_request_id: capture.allowance_request_id,
			period: capture.period
		});
	}
}

test('a standing allowance is captured on two periods and two payslips', async () => {
	const world = createPublicPayrollWorld();
	const january = await createPayrollRun(world, '2026-01');
	const januaryCaptures = entryCaptures(january);
	assert.deepEqual(januaryCaptures.map((row) => row.allowance_request_id).toSorted(), [
		STANDING_ENTRY_ID
	]);
	persistStandingCapture(world, {
		runId: JAN_RUN,
		payslipId: JAN_PAYSLIP,
		period: '2026-01',
		lifecycle: 'PAID',
		captures: januaryCaptures
	});

	const february = await createPayrollRun(world, '2026-02');
	const februaryCaptures = entryCaptures(february);
	assert.deepEqual(februaryCaptures.map((row) => row.allowance_request_id).toSorted(), [
		STANDING_ENTRY_ID
	]);
	assert.equal(januaryCaptures[0].period, '2026-01');
	assert.equal(februaryCaptures[0].period, '2026-02');
	assert.notEqual(january.payslip_payroll_run[0].employment_id, undefined);
	assert.equal(february.payslip_payroll_run[0].employment_id, EMPLOYMENT_ID);
});

test('a captured single-use request is excluded from the next regular payroll', async () => {
	const world = createPublicPayrollWorld({ includePayment: true });
	const january = await createPayrollRun(world, '2026-01');
	const paymentCaptures = (january.payslip_payroll_run ?? []).flatMap(
		(payslip) => payslip.payslip_payment_request_input_payslip ?? []
	);
	assert.deepEqual(
		paymentCaptures.map((row) => row.payment_request_id),
		[PAYMENT_ENTRY_ID],
		'January captures the payment once'
	);
	persistStandingCapture(world, {
		runId: JAN_RUN,
		payslipId: JAN_PAYSLIP,
		period: '2026-01',
		lifecycle: 'PAID',
		captures: entryCaptures(january)
	});
	for (const capture of paymentCaptures) {
		world.payslip_payment_request_inputs.push({
			id: capture.id,
			payslip_id: JAN_PAYSLIP,
			payment_request_id: capture.payment_request_id,
			period: capture.period
		});
	}

	const february = await createPayrollRun(world, '2026-02');
	assert.equal(february.payslip_payroll_run[0].payslip_payment_request_input_payslip.length, 0);
	assert.equal(february.payslip_payroll_run[0].payslip_allowance_request_input_payslip.length, 1);
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
						`update payroll_runs set lifecycle = 'PAID' where company_id = $1 and period = $2`,
						[COMPANY_ID, JANUARY_2026]
					);
				}
			}

			const captures = (await session.query(
				`select period, payslip_id from payslip_allowance_request_inputs
				 where allowance_request_id = $1
				 order by period`,
				[PUBLIC_STANDING_ENTRY_ID]
			)) as ReadonlyArray<{ readonly period: string; readonly payslip_id: string }>;
			const periods = [...new Set(captures.map((row) => row.period))].toSorted();
			assert.deepEqual(
				periods,
				[JANUARY_2026, FEBRUARY_2026],
				`standing entry must land on both public periods, got ${JSON.stringify(captures)}`
			);

			const january = captures.find((row) => row.period === JANUARY_2026);
			assert.ok(january, 'January capture must exist');
			await assert.rejects(() =>
				session.query(
					`insert into payslip_allowance_request_inputs
					 (id, payslip_id, allowance_request_id, period)
					 values ($1, $2, $3, $4)`,
					[crypto.randomUUID(), january.payslip_id, PUBLIC_STANDING_ENTRY_ID, JANUARY_2026]
				)
			);
		} finally {
			await session.stop();
		}
	}
);
