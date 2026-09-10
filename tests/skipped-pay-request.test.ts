// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A request the run read and paid nothing for says so.
 *
 * The junction row is the settlement lock, so a request the run reads is consumed whether or not
 * it produces money. Every branch that decides to pay nothing therefore takes the entry out of the
 * operator's queue and leaves no payslip line to explain it: an approved allowance is simply gone
 * next time somebody looks. The measurement now reports each of those decisions, and the run
 * carries them as warnings — the arithmetic is right, and the operator has to be able to see it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const build = async (world, period = '2026-01') =>
	buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
		)
	);

test('an allowance paid is not reported as skipped', async () => {
	const built = await build(createPublicPayrollWorld());
	assert.deepEqual(
		built.warnings.filter((line) => line.includes('paid nothing')),
		[]
	);
	const slip = built.payslip_payroll_run[0];
	assert.ok(slip.adjustments.some((row) => row.component_code === 'TRANSPORT'));
});

test('an allowance whose eligibility the person fails is captured, pays nothing and is reported', async () => {
	const world = createPublicPayrollWorld();
	// A rule nobody satisfies. The entry is still read, so it is still consumed.
	world.allowance_catalogue[0].eligibility = 'employment.service_months >= 600';
	const built = await build(world);
	const slip = built.payslip_payroll_run[0];
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'TRANSPORT'),
		undefined,
		'nothing was paid'
	);
	assert.equal(
		slip.payslip_allowance_request_input_payslip.length,
		1,
		'and the request was captured all the same, which is why it has to be reported'
	);
	const reported = built.warnings.filter((line) => line.includes('paid nothing'));
	assert.equal(reported.length, 1);
	assert.match(reported[0], /allowance TRANSPORT/);
	assert.match(reported[0], /eligibility rule/);
});
