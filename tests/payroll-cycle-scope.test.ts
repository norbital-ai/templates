import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollCycleScope } from '../src/lib/ui/payroll-cycle-scope.ts';
const base = { today: '2026-10-02', frequency: 'MONTHLY', commencement: '2018-05-04' };
const run = (id: string, period: string, kind = 'REGULAR') => ({ id, period, kind });
const slip = (id: string, status = 'PAID') => ({ payroll_run_id: id, status });
test('recorded January regular history anchors the timeline and partial payment remains unfinished', () => {
	const scope = payrollCycleScope({
		...base,
		runs: [run('jan', '2026-01'), run('oct', '2026-10', 'OFF_CYCLE')],
		slips: [slip('jan'), slip('jan', 'DRAFT')]
	});
	assert.equal(scope.next, '2026-01');
	assert.equal(scope.periods[0], '2026-01');
	assert.equal(scope.available[0], '2026-02', 'New regular never prefills an existing unpaid run');
});
test('completed regular cycles advance through gaps without treating ad hoc settlement as regular', () => {
	assert.equal(
		payrollCycleScope({
			...base,
			runs: [run('jan', '2026-01'), run('feb', '2026-02', 'OFF_CYCLE'), run('mar', '2026-03')],
			slips: [slip('jan'), slip('feb'), slip('mar')]
		}).next,
		'2026-02'
	);
});
test('empty regular run remains unfinished', () => {
	assert.equal(
		payrollCycleScope({ ...base, runs: [run('jan', '2026-01')], slips: [] }).next,
		'2026-01'
	);
});
test('no recorded regular history starts at commencement in the company instalment grammar', () => {
	assert.equal(
		payrollCycleScope({
			...base,
			frequency: 'SEMI_MONTHLY',
			commencement: '2026-04-20',
			runs: [],
			slips: []
		}).next,
		'2026-04-2'
	);
	assert.equal(
		payrollCycleScope({
			...base,
			frequency: 'WEEKLY',
			commencement: '2026-04-20',
			runs: [],
			slips: []
		}).next,
		'2026-04-4'
	);
});

test('fresh payroll with January work evidence starts January despite a 2018 employment', () => {
	assert.equal(
		payrollCycleScope({ ...base, evidenceDate: '2026-01-01', runs: [], slips: [] }).next,
		'2026-01'
	);
});

test('a March regular run does not hide earlier January work and missing cycles', () => {
	const scope = payrollCycleScope({
		...base,
		evidenceDate: '2026-01-01',
		runs: [run('mar', '2026-03')],
		slips: [slip('mar')]
	});
	assert.equal(scope.next, '2026-01');
	assert.equal(scope.available[0], '2026-01');
});

test('actual January work anchors payroll ahead of December roster planning', () => {
	assert.equal(
		payrollCycleScope({
			...base,
			evidenceDate: '2026-01-01',
			rosterDate: '2025-12-01',
			runs: [],
			slips: []
		}).next,
		'2026-01'
	);
	assert.equal(
		payrollCycleScope({ ...base, rosterDate: '2026-01-01', runs: [], slips: [] }).next,
		'2026-01'
	);
});

test('fresh payroll defaults to the first missing cycle this year while retaining prior work history', () => {
	const scope = payrollCycleScope({
		...base,
		evidenceDate: '2025-12-01',
		rosterDate: '2025-12-01',
		runs: [],
		slips: []
	});
	assert.equal(scope.next, '2026-01');
	assert.equal(scope.periods[0], '2025-12');
	assert.equal(
		payrollCycleScope({
			...base,
			evidenceDate: '2025-12-01',
			runs: [run('dec', '2025-12')],
			slips: [slip('dec', 'DRAFT')]
		}).next,
		'2025-12'
	);
});
