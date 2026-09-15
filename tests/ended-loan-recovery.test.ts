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
import { capturesOf, settle } from './helpers/settlement.ts';

test('an ended contract recovers its due loan from later manual payments without reviving salary', async () => {
	const world = createPublicPayrollWorld({ includePayment: true });
	world.employments[0]!.effective_range = { start: '2021-06-01', end: '2026-01-20' };
	world.allowance_requests.length = 0;
	const firstPayment = world.payment_requests[0]!;
	firstPayment.effective_on = '2026-02-05';
	firstPayment.pay_period = '2026-02';
	world.loan_catalogue.push({
		...world.payment_catalogue[0],
		id: 'loan-type',
		code: 'LOAN',
		destination: 'NET',
		direction: 'SUBTRACT'
	});
	world.loans.push({
		id: 'loan',
		employment_id: EMPLOYMENT_ID,
		loan_catalogue_id: 'loan-type',
		principal: 150,
		effective_range: { start: '2026-01-01', end: '2026-06-30' },
		approval_id: null
	});
	world.loan_repayments.push({
		id: 'repayment',
		loan_id: 'loan',
		employment_id: EMPLOYMENT_ID,
		due_date: '2026-01-15',
		amount_due: 150,
		sequence: 1,
		approval_id: null
	});
	const prepare = (period: string) =>
		Effect.runPromise(
			gatherPayrollRun({
				api: memoryPayrollApi(world),
				companyId: COMPANY_ID,
				period
			})
		);
	const persist = (
		slip: ReturnType<typeof buildPayrollRun>['payslip_payroll_run'][number],
		period: string
	) => {
		const runId = `run-${period}`;
		const payslipId = `payslip-${period}`;
		world.payroll_runs.push({
			id: runId,
			company_id: COMPANY_ID,
			period,
			approval_id: null
		});
		world.payslips.push({
			id: payslipId,
			payroll_run_id: runId,
			employment_id: EMPLOYMENT_ID,
			base: [],
			adjustments: [],
			// A run filed as PAID has paid its slips, and history is the slip's own payment.
			paid_at: `${period}-28`,
			statutory: slip.statutory,
			adjustments: slip.adjustments,
			approval_id: null
		});
		for (const id of capturesOf(built, slip).payments)
			settle(world, 'payment_requests', id, payslipId);
		for (const id of capturesOf(built, slip).loanRepayments)
			settle(world, 'loan_repayments', id, payslipId);
	};

	// February's 100 cannot carry a 150 instalment: the recovery is dropped whole, nothing is
	// pinned, and the month settles at gross with the shortfall named.
	let built = buildPayrollRun(await prepare('2026-02'));
	const february = built.payslip_payroll_run;
	assert.equal(february.length, 1);
	const first = february[0]!;
	assert.equal(first.employment_id, EMPLOYMENT_ID);
	assert.deepEqual(first.base, []);
	assert.equal(first.gross, 100);
	assert.equal(first.net, 100);
	assert.equal(first.total_deductions, 0);
	assert.equal(
		first.adjustments.find((row) => row.family === 'LOAN_REPAYMENT'),
		undefined
	);
	assert.deepEqual(capturesOf(built, first).loanRepayments, []);
	assert.ok(built.warnings.some((warning) => warning.includes('LOAN_REPAYMENT_SHORT')));
	persist(first, '2026-02');

	// A later payment that can carry the instalment recovers it whole; the copy of the settled
	// payment must not inherit its pin.
	world.payment_requests.push({
		...firstPayment,
		id: 'later-payment',
		amount: 200,
		effective_on: '2026-03-05',
		pay_period: '2026-03',
		payslip_id: null
	});
	built = buildPayrollRun(await prepare('2026-03'));
	const march = built.payslip_payroll_run;
	assert.equal(march.length, 1);
	const second = march[0]!;
	assert.equal(second.employment_id, EMPLOYMENT_ID);
	assert.deepEqual(second.base, []);
	assert.equal(second.gross, 200);
	assert.equal(second.net, 50);
	assert.equal(second.total_deductions, 150);
	const recovery = second.adjustments.find((row) => row.family === 'LOAN_REPAYMENT');
	assert.equal(recovery?.amount, 150);
	assert.equal(recovery?.source_id, 'repayment');
	assert.deepEqual(capturesOf(built, second).loanRepayments, ['repayment']);
	assert.equal(
		world.loan_repayments[0]!.amount_due,
		150,
		'repayment principal stays at its source'
	);
	persist(second, '2026-03');
	assert.deepEqual(buildPayrollRun(await prepare('2026-04')).payslip_payroll_run, []);
});
