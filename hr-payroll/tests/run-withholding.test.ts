// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A run covers everyone eligible, and withholding is the stated exception.
 *
 * Before this, a run was the whole company and nothing else. Two employments at Nihon whose
 * January roster had never been written raised `WORKLOAD_BELOW_TERMS`, and because the precheck
 * runs over every employment in the company and a blocker refuses the build, seventy-three
 * colleagues could not be paid. There was no per-person run and no way to route around it.
 *
 * The withhold is named and reasoned, it is applied before anything is read about the person, and
 * it forgives nothing: the period's wages and inputs stay unconsumed for a later run to settle.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	assertPayrollPeriodAvailable,
	assertPayrollRunDeletable
} from '../src/collections/payroll_runs/lib/period.ts';
import { memoryPayrollApi, refusalMessage } from './fixtures/memory-payroll-api.ts';

/** The sentence a refusal carried, or `''` when the call did not refuse at all. */
const refusalOf = (run) => {
	try {
		run();
		return '';
	} catch (error) {
		return refusalMessage(error);
	}
};
import {
	COMPANY_ID,
	MONTHLY_EMPLOYMENT_ID,
	SEMI_MONTHLY_EMPLOYMENT_ID,
	createSemiMonthlyPayrollWorld
} from './fixtures/semi-monthly-payroll-world.ts';

const build = async (world, period, withheld) =>
	buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({
				api: memoryPayrollApi(world),
				companyId: COMPANY_ID,
				period,
				...(withheld == null ? {} : { withheld })
			})
		)
	);

test('a withheld employment is paid nothing and captures nothing, and everyone else is paid', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const whole = await build(world, '2026-02-2');
	assert.equal(whole.payslipCount, 2, 'both cadences settle in the second half');

	const withheld = await build(createSemiMonthlyPayrollWorld(), '2026-02-2', [
		MONTHLY_EMPLOYMENT_ID
	]);
	assert.equal(withheld.payslipCount, 1);
	assert.deepEqual(
		withheld.payslip_payroll_run.map((slip) => slip.employment_id),
		[SEMI_MONTHLY_EMPLOYMENT_ID],
		'the colleague is still paid'
	);
	// Nothing of the withheld person's is consumed — no payslip, and so no capture to lock their
	// work days, entries or repayments. That is what lets a later run settle their period.
	assert.ok(
		withheld.capturedCount < whole.capturedCount,
		'a withheld person still had inputs captured'
	);
	assert.ok(
		withheld.captures.every((capture) =>
			withheld.payslip_payroll_run.some((slip) => slip.id === capture.payslipId)
		),
		'a capture was written for a payslip the run did not produce'
	);
});

test('withholding everyone but one person is the per-person run', async () => {
	const built = await build(createSemiMonthlyPayrollWorld(), '2026-02-2', [
		SEMI_MONTHLY_EMPLOYMENT_ID
	]);
	assert.equal(built.payslipCount, 1);
	assert.equal(built.payslip_payroll_run[0].employment_id, MONTHLY_EMPLOYMENT_ID);
});

test('a standing draft no longer blocks the next period, and a skipped period still refuses', () => {
	const runs = [{ period: '2026-01', lifecycle: 'DRAFT' }];
	// Used to refuse: "Payroll 2026-01 is still a draft. Settle or delete it before another run."
	assertPayrollPeriodAvailable(runs, '2026-02');
	assert.match(
		refusalOf(() =>
			assertPayrollPeriodAvailable([...runs, { period: '2026-03', lifecycle: 'DRAFT' }], '2026-02')
		),
		/Payroll 2026-03 already exists/
	);
	assert.match(
		refusalOf(() => assertPayrollPeriodAvailable(runs, '2026-01')),
		/Payroll 2026-01 already exists/
	);
});

test('drafts are unwound newest first', () => {
	const runs = [{ period: '2026-01' }, { period: '2026-02' }];
	assertPayrollRunDeletable(runs, '2026-02');
	assert.match(
		refusalOf(() => assertPayrollRunDeletable(runs, '2026-01')),
		/Delete payrolls newest first/
	);
});
