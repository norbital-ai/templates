// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A request the run read and paid nothing for says so.
 *
 * The pin is the settlement lock, so a claim the run reads is consumed whether or not it produces
 * money, and an allowance on the contract the run declines to price leaves no line behind. Every
 * branch that decides to pay nothing therefore leaves no payslip line to explain it: an allowance
 * is simply absent next time somebody looks. The measurement reports each of those decisions, and
 * the run carries them as warnings — the arithmetic is right, and the operator has to see it.
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
	assert.ok(slip.base.some((row) => row.component_code === 'TRANSPORT'));
});

test('an allowance whose eligibility the person fails pays nothing, prices no line, and is reported', async () => {
	const world = createPublicPayrollWorld();
	// A rule nobody satisfies. The allowance is on the contract every period; nothing is priced.
	world.allowance_catalogue[0].eligibility = 'employment.service_months >= 600';
	const built = await build(world);
	const slip = built.payslip_payroll_run[0];
	assert.equal(
		slip.base.find((row) => row.component_code === 'TRANSPORT'),
		undefined,
		'nothing was paid'
	);
	assert.equal(
		slip.proration.some((row) => row.component_code === 'TRANSPORT'),
		false,
		'no segment is priced, so the payslip carries nothing to explain it — which is why it is reported'
	);
	const reported = built.warnings.filter((line) => line.includes('paid nothing'));
	assert.equal(reported.length, 1);
	assert.match(reported[0], /allowance TRANSPORT/);
	assert.match(reported[0], /eligibility rule/);
});
