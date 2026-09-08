// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Public-fixture payroll golden. Creates 2026-01 through the real gather + create.before hook.
 *
 * This package world is one person and has no sealed statutory schemes.
 * Hosted payroll acceptance is I1 (`public-seed-payroll.integration.test.ts`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { settledBy, stampRun } from './helpers/settlement.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	STANDING_ENTRY_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';

let world;
async function createJanuary() {
	world = createPublicPayrollWorld();
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
		day.break_minutes = 60;
	}
	const api = memoryPayrollApi(world);
	const prepared = await Effect.runPromise(
		payrollRunHooks.mutate.prepare({
			inputs: [{ company_id: COMPANY_ID, period: '2026-01' }],
			api
		})
	);
	assert.equal(prepared.size, 1);
	const created = await Effect.runPromise(
		payrollRunHooks.mutate.perRecord.before.handler({
			input: { company_id: COMPANY_ID, period: '2026-01' },
			existing: undefined,
			prepared,
			api
		})
	);
	// The after hook stamps the single-use sources once the payslips exist.
	await stampRun(world, created);
	return created;
}

test('public fixture January run: one payslip, observed fixture totals', async () => {
	const created = await createJanuary();
	const payslips = created.payslip_payroll_run;
	assert.equal(payslips.length, 1);
	assert.equal(created.lifecycle, 'DRAFT');
	assert.equal(created.period, '2026-01');
	assert.equal(created.company_id, COMPANY_ID);

	const payslip = payslips[0];
	assert.equal(payslip.employment_id, EMPLOYMENT_ID);
	assert.equal(payslip.currency, 'MYR');

	assert.deepEqual(
		(payslip.payslip_allowance_request_input_payslip ?? []).map((row) => row.allowance_request_id),
		[STANDING_ENTRY_ID]
	);
	// And nothing from the families this month has no rows in.
	for (const source of ['claim_requests', 'payment_requests'])
		assert.deepEqual(settledBy(world, source, payslip.id), [], source);
	assert.equal(settledBy(world, 'work_days', payslip.id).length, 42);
	assert.equal(payslip.payslip_loan_repayment_input_payslip.length, 0);
	assert.equal(payslip.payslip_leave_input_payslip.length, 0);
	assert.equal(payslip.statutory.length, 0);

	// Observed on this public world (no schemes, one standing allowance).
	assert.equal(payslip.gross, 3761);
	assert.equal(payslip.net, 3761);
	assert.equal(payslip.total_deductions, 0);
	assert.equal(payslip.employer_cost, 0);
	assert.ok(
		payslip.base.some((line) => line.component_code === 'BASIC' && line.amount === 3451),
		'BASIC schedule is the 3,451 contract'
	);
	assert.ok(
		payslip.adjustments.some((line) => line.label === 'TRANSPORT' && line.amount === 310),
		'standing TRANSPORT 310 lands as an adjustment'
	);
});
