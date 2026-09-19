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
 * `settle` drops a whole recovery the net-pay guard cannot take and records it in `shortfalls`;
 * this is what reads that array, so a person under-recovered month after month is named.
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
import { clearAllowances } from './fixtures/contract-allowances.ts';

/** A world whose one employment leaves inside the run period and owes one instalment. */
function leaverOwing(loanType) {
	const world = createPublicPayrollWorld();
	world.employments[0].effective_range = { start: '2021-06-01', end: '2026-01-20' };
	// A leaver's later money is a claim: the contract's allowances ended with it.
	clearAllowances(world);
	world.claim_catalogue.push({ ...world.allowance_catalogue[0], id: 'expense', code: 'EXPENSE' });
	world.claim_requests.push({
		id: 'later-claim',
		employment_id: EMPLOYMENT_ID,
		catalogue_id: 'expense',
		amount: 100,
		incurred_on: '2026-02-05',
		pay_period: '2026-02',
		as_adjustment_entry: false,
		payslip_id: null,
		approval_id: null
	});
	world.loan_catalogue.push({
		...world.allowance_catalogue[0],
		id: 'loan-type',
		code: 'LOAN',
		destination: 'NET',
		direction: 'SUBTRACT',
		loan_type: loanType,
		minimum_repayment: null
	});
	world.loans.push({
		id: 'loan',
		employment_id: EMPLOYMENT_ID,
		loan_catalogue_id: 'loan-type',
		principal: 100,
		effective_range: { start: '2026-01-01', end: '2026-06-30' },
		approval_id: null
	});
	world.loan_repayments.push({
		id: 'repayment',
		loan_id: 'loan',
		employment_id: EMPLOYMENT_ID,
		due_date: '2026-01-15',
		amount_due: 100,
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
	assert.deepEqual(built.captures[0].loanRepayments, [], 'nothing is captured either');
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

test('a dropped recovery with no stated floor warns and stays outstanding', () => {
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

test('a leaver with instalments beyond the final payslip is warned about, once per loan', async () => {
	const world = leaverOwing('STAFF');
	world.loans[0].reference = 'Hari Raya';
	for (const [sequence, due] of [
		[2, '2026-03-15'],
		[3, '2026-04-15']
	])
		world.loan_repayments.push({
			id: `repayment-${sequence}`,
			loan_id: 'loan',
			employment_id: EMPLOYMENT_ID,
			due_date: due,
			amount_due: 100,
			sequence,
			approval_id: null
		});
	const built = await build(world, '2026-02');
	const warning = built.warnings.filter((line) => line.startsWith('LOAN_OUTSTANDING_AT_EXIT'));
	assert.equal(warning.length, 1);
	assert.match(warning[0], /3 instalment\(s\) totalling 300 still outstanding under Hari Raya/);
	assert.equal(
		built.payslip_payroll_run[0].adjustments.filter((row) => row.family === 'LOAN_REPAYMENT')
			.length,
		1,
		'the final payslip still recovers exactly one instalment'
	);
	assert.equal(
		(await build(leaverOwing('STAFF'), '2026-02')).warnings.some((line) =>
			line.startsWith('LOAN_OUTSTANDING_AT_EXIT')
		),
		false,
		'a single last instalment the final payslip takes is not outstanding'
	);
});
