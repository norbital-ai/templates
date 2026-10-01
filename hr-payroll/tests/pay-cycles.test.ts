import assert from 'node:assert/strict';
import test from 'node:test';
import {
	combineCycleSheets,
	payCycles,
	settlesSalaryEarly,
	slipTotals
} from '../src/lib/pay-cycles.ts';

const run = (id: string, kind: string, sequence: number, period = '2026-03') => ({
	id,
	company_id: 'co',
	period,
	kind,
	sequence
});
const slip = (id: string, runId: string, employment: string, gross: number) => ({
	id,
	payroll_run_id: runId,
	employment_id: employment,
	gross,
	net: gross - 100,
	employer_cost: gross + 200
});

test('a cycle groups its runs with REGULAR first, then the rest by sequence', () => {
	const cycles = payCycles(
		[
			run('fin', 'FINAL', 3),
			run('early', 'EARLY', 1),
			run('off', 'OFF_CYCLE', 2),
			run('reg', 'REGULAR', 4),
			run('feb', 'REGULAR', 1, '2026-02')
		],
		[]
	);
	assert.deepEqual(
		cycles.map((cycle) => cycle.period),
		['2026-03', '2026-02']
	);
	assert.deepEqual(
		cycles[0]!.runs.map(({ run }) => run.id),
		['reg', 'early', 'off', 'fin']
	);
});

test('cycle totals sum each payslip once and count each person once', () => {
	const slips = [
		slip('s1', 'reg', 'amy', 1000),
		slip('s2', 'reg', 'ben', 2000),
		slip('s3', 'off', 'amy', 100),
		slip('s3', 'off', 'amy', 100) // the same payslip read twice
	];
	const [cycle] = payCycles([run('reg', 'REGULAR', 1), run('off', 'OFF_CYCLE', 2)], slips);
	assert.equal(cycle!.totals.gross, 3100);
	assert.equal(cycle!.totals.net, 3100 - 300);
	assert.equal(cycle!.totals.employerCost, 3100 + 600);
	assert.equal(cycle!.totals.headcount, 2);
	assert.equal(cycle!.totals.slips, 3);
	assert.deepEqual(
		cycle!.runs.map(({ totals }) => [totals.slips, totals.headcount, totals.gross]),
		[
			[2, 2, 3000],
			[1, 1, 100]
		]
	);
	assert.equal(slipTotals([]).headcount, 0);
});

test('an off-cycle run settles salary early only before the REGULAR run, once per person', () => {
	const early = [run('early', 'EARLY', 1), run('off', 'OFF_CYCLE', 2)];
	const slips = [slip('s1', 'early', 'amy', 1000), slip('s2', 'off', 'amy', 50)];
	assert.equal(settlesSalaryEarly(early, slips, 'ben'), true);
	assert.equal(settlesSalaryEarly(early, slips, 'amy'), false);
	assert.equal(settlesSalaryEarly([...early, run('reg', 'REGULAR', 3)], slips, 'ben'), false);
});

test('a cycle export combines its runs into one sheet without listing a payslip twice', () => {
	const sheet = (runId: string, period: string, payslips: string[]) => ({
		runId,
		period,
		payslips,
		bank: payslips,
		skippedEmploymentIds: []
	});
	const combined = combineCycleSheets(
		[
			sheet('reg', '2026-03', ['s1', 's2']),
			sheet('off', '2026-03', ['s3']),
			sheet('off', '2026-03', ['s3']),
			sheet('feb', '2026-02', ['s0'])
		],
		() => 'co'
	);
	assert.deepEqual(
		combined.map((row) => [row.period, row.payslips]),
		[
			['2026-03', ['s1', 's2', 's3']],
			['2026-02', ['s0']]
		]
	);
});
