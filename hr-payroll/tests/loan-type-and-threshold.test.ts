// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A loan is not one thing, and a month that under-recovers is not silence.
 *
 * Two facts the loan catalogue now states. `loan_type` says whose debt it is: a `GOVERNMENT`
 * advance is owed to the authority, so the final salary does not settle it and the balance
 * survives the contract, while a `STAFF` loan ends with the employment and is swept up. And
 * `minimum_repayment` says how little a month may take before the shortfall stops being the
 * engine's arithmetic and becomes the operator's decision.
 *
 * `settle` has always trimmed a recovery the net-pay guard could not take and recorded what it
 * could not take in `shortfalls`. Nothing read that array, which is why a person could be
 * under-recovered month after month with every payslip looking ordinary.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { loanShortfallIssues } from '../src/lib/payroll/loan.ts';
import { blockers } from '../src/collections/payroll_runs/lib/validate.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

/** A world whose one employment leaves inside the run period and owes one instalment. */
function leaverOwing(loanType) {
	const world = createPublicPayrollWorld({ includePayment: true });
	world.employments[0].exit_date = '2026-01-20';
	world.employments[0].exit_reason = 'RESIGNATION';
	world.allowance_requests.length = 0;
	const payment = world.payment_requests[0];
	payment.effective_on = '2026-02-05';
	payment.pay_period = '2026-02';
	world.loan_catalogue.push({
		...world.payment_catalogue[0],
		id: 'loan-type',
		code: 'LOAN',
		loan_type: loanType,
		minimum_repayment: null
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
	return world;
}

const build = async (world, period) =>
	buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
		)
	);

test('a staff loan is recovered out of the final payslip', async () => {
	const built = await build(leaverOwing('STAFF'), '2026-02');
	const slip = built.payslip_payroll_run[0];
	const recovery = slip.adjustments.find((row) => row.family === 'LOAN_REPAYMENT');
	assert.ok(recovery, 'the employer’s own loan ends with the employment');
	assert.equal(recovery.amount, 100);
	assert.equal(slip.net, 0);
});

test('a government loan is left owing rather than swept into the final payslip', async () => {
	const built = await build(leaverOwing('GOVERNMENT'), '2026-02');
	const slip = built.payslip_payroll_run[0];
	assert.equal(
		slip.adjustments.find((row) => row.family === 'LOAN_REPAYMENT'),
		undefined,
		'the borrower owes the authority, and the employer has no claim on the last payslip'
	);
	assert.equal(
		slip.net,
		100,
		'the final payment is paid out rather than withheld against the loan'
	);
	assert.deepEqual(slip.payslip_loan_repayment_input_payslip, [], 'nothing is captured either');
});

/** One shortfall, as `settle` records it, against a catalogue row that does or does not state a floor. */
const shortfallOf = (minimum, taken, short) =>
	loanShortfallIssues({
		employeeNumber: 'NHPMY0001',
		employmentId: EMPLOYMENT_ID,
		loans: [
			{
				id: 'loan',
				catalogueComponent: { id: 'loan-type', code: 'LOAN', minimum_repayment: minimum }
			}
		],
		settlement: {
			adjustments: [
				{
					input: { family: 'LOAN_REPAYMENT', id: 'repayment' },
					catalogueComponent: { id: 'loan-type', code: 'LOAN' },
					amount: taken
				}
			],
			shortfalls: [{ componentCatalogueId: 'loan-type', amount: short }]
		}
	});

test('a month below the agreed minimum blocks the run and names what could not be taken', () => {
	const issues = shortfallOf(120, 40, 110);
	assert.equal(issues.length, 1);
	assert.equal(issues[0].code, 'LOAN_REPAYMENT_BELOW_MINIMUM');
	assert.equal(blockers(issues).length, 1, 'a breach of the agreed floor stops the run');
	assert.match(issues[0].message, /below the agreed minimum of 120/);
	assert.match(issues[0].message, /withhold this person/);
});

test('a trimmed recovery with no stated floor warns and stays outstanding', () => {
	const issues = shortfallOf(null, 40, 110);
	assert.equal(issues[0].code, 'LOAN_REPAYMENT_SHORT');
	assert.equal(issues[0].severity, 'WARNING');
	assert.equal(blockers(issues).length, 0, 'correct arithmetic is not a refusal');
	assert.match(issues[0].message, /stays outstanding/);
});

test('a month that met the floor raises nothing at all', () => {
	assert.deepEqual(shortfallOf(120, 150, 0).length, 1, 'a recorded shortfall is always reported');
	assert.equal(shortfallOf(120, 150, 0)[0].code, 'LOAN_REPAYMENT_SHORT');
	assert.deepEqual(
		loanShortfallIssues({
			employeeNumber: 'NHPMY0001',
			employmentId: EMPLOYMENT_ID,
			loans: [],
			settlement: { adjustments: [], shortfalls: [] }
		}),
		[],
		'no shortfall, no issue'
	);
});
