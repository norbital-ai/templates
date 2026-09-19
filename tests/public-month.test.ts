// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Public-fixture payroll golden. Creates 2026-01 through the real gather + the run's transform.
 *
 * This package world is one person and has no sealed statutory schemes.
 * Hosted payroll acceptance is I1 (`public-seed-payroll.integration.test.ts`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRun, payslipsOf, settledBy, storeRun } from './helpers/settlement.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';

let world;
async function createJanuary() {
	world = createPublicPayrollWorld();
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	}
	// The payload the runtime would commit, then stored the way the database would hold it: the
	// pins the payslip links and the rows it materialises land on the world.
	const created = await createRun(world, '2026-01');
	storeRun(world, created);
	return created;
}

test('public fixture January run: one payslip, observed fixture totals', async () => {
	const created = await createJanuary();
	const payslips = payslipsOf(created);
	assert.equal(payslips.length, 1);
	assert.equal(created.period, '2026-01');
	assert.equal(created.company_id, COMPANY_ID);

	const payslip = payslips[0];
	assert.equal(payslip.employment_id, EMPLOYMENT_ID);
	assert.equal(payslip.currency, 'MYR');

	// The allowance on the contract is a base line with its own proration segment.
	const transport = payslip.proration.filter((row) => row.component_code === 'TRANSPORT');
	assert.deepEqual(
		transport.map((row) => [row.from, row.to, row.days, row.denominator, row.prorated_amount]),
		[['2026-01-01', '2026-01-31', 31, 31, 310]]
	);
	// And nothing from the families this month has no rows in.
	for (const source of ['claim_requests'])
		assert.deepEqual(settledBy(world, source, payslip.id), [], source);
	assert.equal(settledBy(world, 'work_days', payslip.id).length, 42);
	assert.equal(settledBy(world, 'loan_repayments', payslip.id).length, 0);
	assert.equal(settledBy(world, 'leave_entries', payslip.id).length, 0);
	assert.equal(payslip.statutory.length, 0);

	// Observed on this public world (no schemes, one allowance on the contract).
	assert.equal(payslip.gross, 3761);
	assert.equal(payslip.net, 3761);
	assert.equal(payslip.total_deductions, 0);
	assert.equal(payslip.employer_cost, 0);
	assert.ok(
		payslip.base.some((line) => line.component_code === 'BASIC' && line.amount === 3451),
		'BASIC schedule is the 3,451 contract'
	);
	assert.ok(
		payslip.base.some((line) => line.component_code === 'TRANSPORT' && line.amount === 310),
		'the TRANSPORT 310 on the contract lands as a base line'
	);
});
