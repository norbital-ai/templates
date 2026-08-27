// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What earlier paid runs already took from an obligation — the whole of "outstanding".
 *
 * This replaces the test that read `payslip_lines.repayment_agreement_id` and `repayment_sequence`
 * off the persisted lines. Both columns are gone, and so is the pair of generated projections that
 * produced them: a repayment is a `payslip_adjustments` row whose `source` is the `OBLIGATION` arm,
 * and consumption is the sum of those rows.
 *
 *     outstanding = obligation.amount − Σ(adjustments against it in PAID runs)
 *
 * Three properties decide whether that sentence is true, and each is a way it has silently been
 * wrong before:
 *
 *   1. **Only PAID runs count.** An abandoned draft that deducted 167 must not reduce what is owed;
 *      nothing recomputes when a draft is discarded.
 *   2. **Only the OBLIGATION arm counts.** A work day or a leave request is a settlement claim, not
 *      a draw on a balance, and summing them would report an obligation as over-recovered by the
 *      number of days somebody attended.
 *   3. **Every earlier tax year counts.** Year-to-date is a tax-year question; what a loan has
 *      repaid is not. A November agreement is still being recovered in February, and reading only
 *      the current tax year would report its instalments as untouched and deduct them twice.
 *
 * It drives `gatherRun` rather than a helper, because the read is the claim: a fixture that
 * described the rows without going through the query would prove the arithmetic and nothing about
 * which rows reach it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherRun } from '../payroll_runs/lib/gather.ts';
import { withReadLog } from '../payroll_runs/lib/api.ts';
import { PLAIN_CALENDAR } from '../payroll_runs/lib/settlement.ts';

const EMPLOYMENT_ID = 'emp-1';
const LOAN_ID = 'ob-loan';

const WINDOW = {
	period: '2026-04',
	payFrequency: 'MONTHLY',
	salary: { start: '2026-04-01', end: '2026-04-30' },
	attendance: { start: '2026-03-21', end: '2026-04-20' },
	payDate: '2026-04-25',
	instalments: []
};

const CONFIGURATION = {
	company: { id: 'co-1', leave_year_start_month: 1 },
	jurisdiction: { id: 'jur-my', code: 'MY', tax_year_start_month: 1 },
	contributions: [{ row: { id: 'sc-epf', code: 'EPF', special_rules: [] } }],
	payComponents: [],
	leaveTypes: []
};

const EMPLOYMENT = {
	id: EMPLOYMENT_ID,
	employee_id: 'ee-1',
	employee_number: 'NHPMY0001',
	company_id: 'co-1',
	hire_date: '2021-06-01',
	exit_date: null,
	approval_id: null,
	effective_range: { start: '2021-06-01', end: null }
};

/**
 * A database double whose surface is exactly the reads GATHER performs.
 *
 * Narrow on purpose. A broader fake would be a second, silently divergent description of the
 * authoring api, and the one thing this has to be right about is which rows reach the sum.
 */
function fakeApi({ runs = [], payslips = [], adjustments = [] } = {}) {
	const rows = {
		employments: [EMPLOYMENT],
		employees: [{ id: 'ee-1', date_of_birth: '1990-01-01', gender: 'MALE', approval_id: null }],
		employment_terms: [],
		employment_statutory_facts: [],
		obligations: [],
		leave_requests: [],
		work_days: [],
		payroll_runs: runs,
		payslips,
		payslip_adjustments: adjustments
	};
	/**
	 * Only the three predicates this file is about are honoured, and they are honoured exactly.
	 *
	 * A double that ignored them would let a broken query pass every test here — which is the
	 * failure mode a fixture describing an imagined response shape always has.
	 */
	const matches = (collection, row, where = {}) => {
		if (collection === 'payroll_runs')
			return (
				(where.lifecycle?.eq == null || row.lifecycle === where.lifecycle.eq) &&
				(where.period?.lt == null || row.period < where.period.lt)
			);
		if (collection === 'payslips')
			return where.payroll_run_id?.in == null || where.payroll_run_id.in.includes(row.payroll_run_id);
		if (collection === 'payslip_adjustments')
			return (
				(where.payslip_id?.in == null || where.payslip_id.in.includes(row.payslip_id)) &&
				(where.source?.kind?.eq == null || row.source.kind === where.source.kind.eq)
			);
		return true;
	};
	const db = {};
	for (const [collection, all] of Object.entries(rows)) {
		db[collection] = {
			findMany: (query = {}) =>
				Effect.succeed(all.filter((row) => matches(collection, row, query.where)))
		};
	}
	return withReadLog({ db });
}

const gather = (options) =>
	Effect.runSync(
		gatherRun({
			api: fakeApi(options),
			configuration: CONFIGURATION,
			window: WINDOW,
			policy: PLAIN_CALENDAR
		})
	);

const paidRun = (id, period) => ({ id, period, company_id: 'co-1', lifecycle: 'PAID' });
const payslip = (id, runId) => ({
	id,
	payroll_run_id: runId,
	employment_id: EMPLOYMENT_ID,
	statutory: []
});
const drawnOn = (payslipId, obligationId, amount) => ({
	payslip_id: payslipId,
	source: { kind: 'OBLIGATION', id: obligationId },
	amount
});

test('consumption is the sum of the OBLIGATION-arm adjustments on earlier paid payslips', () => {
	const gathered = gather({
		runs: [paidRun('run-feb', '2026-02'), paidRun('run-mar', '2026-03')],
		payslips: [payslip('ps-feb', 'run-feb'), payslip('ps-mar', 'run-mar')],
		adjustments: [drawnOn('ps-feb', LOAN_ID, 167), drawnOn('ps-mar', LOAN_ID, 100)]
	});
	// 267 taken. What is still owed is the obligation's own amount minus this, derived by MEASURE —
	// never a carried-forward row, because there is no arrears row anywhere for it to have become.
	assert.equal(gathered.consumedObligations.get(LOAN_ID), 267);
});

test('a partial recovery is summed, not counted: 100 of 167 is 100 consumed', () => {
	// SETTLE reduces a deduction that would have driven net below zero, and the reduced figure is
	// what was actually taken. The difference is not written anywhere — it is outstanding *here*,
	// in the gap between the obligation and this sum.
	const gathered = gather({
		runs: [paidRun('run-mar', '2026-03')],
		payslips: [payslip('ps-mar', 'run-mar')],
		adjustments: [drawnOn('ps-mar', LOAN_ID, 100)]
	});
	assert.equal(gathered.consumedObligations.get(LOAN_ID), 100);
});

test('a draft run’s deduction does not reduce what is owed', () => {
	// The prior-run query filters `lifecycle = PAID`, so a draft's payslips are never read and its
	// adjustments never reach the sum. An abandoned draft that deducted 167 must not make somebody
	// owe 167 less, and nothing recomputes when the draft is discarded.
	const gathered = gather({
		runs: [{ id: 'run-mar', period: '2026-03', company_id: 'co-1', lifecycle: 'DRAFT' }],
		payslips: [payslip('ps-mar', 'run-mar')],
		adjustments: [drawnOn('ps-mar', LOAN_ID, 167)]
	});
	assert.equal(gathered.consumedObligations.size, 0);
});

test('a work day and a leave request are claims, not draws on a balance', () => {
	// `unique(source, payslip_id)` lets one payslip hold a row per source, and most of them are
	// settlement locks with an amount of zero. Summing the whole collection would report an
	// obligation as over-recovered by the number of days somebody attended.
	const gathered = gather({
		runs: [paidRun('run-mar', '2026-03')],
		payslips: [payslip('ps-mar', 'run-mar')],
		adjustments: [
			drawnOn('ps-mar', LOAN_ID, 167),
			{ payslip_id: 'ps-mar', source: { kind: 'WORK_DAY', id: 'wd-1' }, amount: 0 },
			{ payslip_id: 'ps-mar', source: { kind: 'LEAVE_REQUEST', id: 'lr-1' }, amount: 0 }
		]
	});
	assert.deepEqual([...gathered.consumedObligations], [[LOAN_ID, 167]]);
});

test('an obligation recovered across a tax-year boundary is still recovered', () => {
	// The one read that was widened deliberately: the prior-run query does not filter to the tax
	// year, because a loan outlives one. Year-to-date still filters; consumption does not.
	const gathered = gather({
		runs: [paidRun('run-2025-11', '2025-11'), paidRun('run-2026-01', '2026-01')],
		payslips: [payslip('ps-nov', 'run-2025-11'), payslip('ps-jan', 'run-2026-01')],
		adjustments: [drawnOn('ps-nov', LOAN_ID, 167), drawnOn('ps-jan', LOAN_ID, 167)]
	});
	assert.equal(gathered.consumedObligations.get(LOAN_ID), 334);
});

test('year-to-date is summed off the payslips alone, with both shares on one entry', () => {
	// The statutory charges are inlined, so this needs no second collection and no join — which is
	// also why pairing two rows by `statutory_contribution_id` and hoping neither half was missing
	// is gone with the shape, and so is the guard against counting one base twice.
	const gathered = gather({
		runs: [paidRun('run-jan', '2026-01'), paidRun('run-feb', '2026-02')],
		payslips: [
			{
				...payslip('ps-jan', 'run-jan'),
				statutory: [
					{
						statutory_contribution_id: 'sc-epf',
						base_amount: 3000,
						employee_amount: 330,
						employer_amount: 390,
						band_reference: null,
						special_amounts: {}
					}
				]
			},
			{
				...payslip('ps-feb', 'run-feb'),
				statutory: [
					{
						statutory_contribution_id: 'sc-epf',
						base_amount: 3000,
						employee_amount: 330,
						employer_amount: 390,
						band_reference: null,
						special_amounts: {}
					}
				]
			}
		]
	});
	assert.deepEqual(gathered.yearToDate.get('ee-1:EPF'), {
		employee: 660,
		employer: 780,
		base: 6000
	});
});

test('a run outside the tax year is consumed but never counted as year-to-date', () => {
	// One read answers both questions; only the summing differs. November 2025 repaid the loan and
	// contributed nothing to the 2026 projection.
	const gathered = gather({
		runs: [paidRun('run-2025-11', '2025-11')],
		payslips: [
			{
				...payslip('ps-nov', 'run-2025-11'),
				statutory: [
					{
						statutory_contribution_id: 'sc-epf',
						base_amount: 3000,
						employee_amount: 330,
						employer_amount: 390,
						band_reference: null,
						special_amounts: {}
					}
				]
			}
		],
		adjustments: [drawnOn('ps-nov', LOAN_ID, 167)]
	});
	assert.equal(gathered.consumedObligations.get(LOAN_ID), 167);
	assert.equal(gathered.yearToDate.size, 0);
});
