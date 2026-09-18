import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { cents } from '../src/collections/payroll_runs/lib/rounding.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	COMPANY_ID,
	EMPLOYEE_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';

function rehireWorld() {
	const world = createPublicPayrollWorld();
	const old = world.employments[0]!;
	const term = world.employment_terms[0]!;
	old.effective_range = { start: '2021-06-01', end: '2026-01-15' };
	term.effective_range = { start: '2021-06-01', end: '2026-01-15' };
	world.employments.push({
		...old,
		id: 'new-contract',
		effective_range: { start: '2026-01-16', end: null }
	});
	world.employment_terms.push({
		...term,
		id: 'new-terms',
		employment_id: 'new-contract',
		effective_range: { start: '2026-01-16', end: null }
	});
	for (const day of world.work_days) {
		if (String(day.work_date) >= '2026-01-16') day.employment_id = 'new-contract';
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:00:00+08:00` }
		];
	}
	world.allowances.length = 0;
	world.statutory_contributions.push({
		id: 'fixed-scheme',
		settings_id: JURISDICTION_ID,
		code: 'PUB-FIXED',
		name: 'Invented fixed assessment',
		authority: 'Public regression fixture',
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [{ when: 'base >= 0.0', employee: 'round_cent(30.01)', employer: 'round_cent(60.01)' }],
		assessed_on: "BASE + OVERTIME - ABSENCE - NO_PAY_LEAVE + catalog('ALLOWANCE')",
		approval_id: null
	});
	return world;
}

test('a company-assessed scheme lands once on the run, on no payslip', async () => {
	const world = createPublicPayrollWorld();
	world.statutory_contributions.push({
		id: 'company-levy',
		settings_id: JURISDICTION_ID,
		code: 'PUB-LEVY',
		name: 'Invented establishment levy',
		authority: 'Public regression fixture',
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'COMPANY',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [{ when: 'true', employee: '0.0', employer: 'round_cent(base * 1.0 / 100.0)' }],
		assessed_on: 'BASE',
		approval_id: null
	});
	const built = buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		)
	);
	// One charge for the whole run, and the payslips carry none of it.
	assert.equal(built.company_charges.length, 1);
	assert.equal(built.company_charges[0]!.scheme_code, 'PUB-LEVY');
	assert.ok(built.company_charges[0]!.employer_amount > 0);
	assert.ok(
		built.payslip_payroll_run.every(
			(slip) => !slip.statutory.some((line) => line.scheme_code === 'PUB-LEVY')
		)
	);
});

test('the payroll engine measures two rehire contracts but charges one contribution assessment', async () => {
	const world = rehireWorld();
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	assert.equal(prepared.gathered.bundles.length, 2);
	const built = buildPayrollRun(prepared);
	assert.equal(built.payslipCount, 2);
	assert.deepEqual(
		new Set(built.payslip_payroll_run.map((slip) => slip.employment_id)),
		new Set([EMPLOYMENT_ID, 'new-contract'])
	);
	assert.equal(cents(built.payslip_payroll_run.reduce((sum, slip) => sum + slip.gross, 0)), 3451);
	assert.equal(
		cents(
			built.payslip_payroll_run.reduce((sum, slip) => sum + slip.statutory[0]!.employee_amount, 0)
		),
		30.01
	);
	assert.equal(
		cents(
			built.payslip_payroll_run.reduce((sum, slip) => sum + slip.statutory[0]!.employer_amount, 0)
		),
		60.01
	);
	for (const slip of built.payslip_payroll_run)
		assert.equal(slip.statutory[0]!.base_amount, slip.gross);
	const reordered = buildPayrollRun({
		...prepared,
		gathered: { ...prepared.gathered, bundles: prepared.gathered.bundles.toReversed() }
	});
	for (const slip of built.payslip_payroll_run)
		assert.deepEqual(
			reordered.payslip_payroll_run.find((other) => other.employment_id === slip.employment_id)!
				.statutory,
			slip.statutory
		);
});

/**
 * A colleague's held payslip does not erase this person's paid history.
 *
 * `payroll_runs.lifecycle` is a reading of the slips, so a run where one person is still unpaid
 * reads DRAFT. Selecting prior *runs* by that summary — which is what this gather did while a run
 * was the unit of payment — would drop every paid slip inside it: loan instalments recovered a
 * second time, single-use entries paid twice, year-to-date reset to nothing. The history is the
 * paid slips, and it is read off them.
 */
test('a person’s held earlier slip is history the next period stands on', async () => {
	const world = rehireWorld();
	// One earlier run, reading DRAFT because this person is still held. The slip counts: it
	// cannot be deleted from under the next period's slip, and it is paid before that slip is.
	world.payroll_runs.push({
		id: 'january',
		company_id: COMPANY_ID,
		period: '2026-01',
		lifecycle: 'DRAFT'
	});
	world.payslips.push({
		id: 'january-held',
		payroll_run_id: 'january',
		employment_id: EMPLOYMENT_ID,
		base: [],
		adjustments: [],
		paid_at: null,
		statutory: [
			{ scheme_code: 'PUB-FIXED', employee_amount: 30, employer_amount: 60, base_amount: 1000 }
		]
	});
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-02' })
	);
	assert.deepEqual(
		prepared.gathered.yearToDate.get(`${EMPLOYEE_ID}:PUB-FIXED`),
		{ employee: 30, employer: 60, base: 1000, ordinary: 0 },
		'the held slip is history: February is paid only after it is'
	);
});

test('rehire gathers prior YTD across old contracts while excluding another entity', async () => {
	const world = rehireWorld();
	world.employments.push({
		...world.employments[0],
		id: 'other-entity-contract',
		company_id: 'other-company'
	});
	// History is every slip of the person at this company: the unpaid `old-draft` slip counts,
	// because nothing can delete it from under February and it is paid before February is.
	for (const [id, company, lifecycle, paid_at] of [
		['old-paid', COMPANY_ID, 'PAID', '2026-01-31'],
		['old-draft', COMPANY_ID, 'DRAFT', null],
		['other-paid', 'other-company', 'PAID', '2026-01-31']
	]) {
		world.payroll_runs.push({ id, company_id: company, period: '2026-01', lifecycle });
		world.payslips.push({
			id: `${id}-slip`,
			payroll_run_id: id,
			paid_at,
			employment_id: company === COMPANY_ID ? EMPLOYMENT_ID : 'other-entity-contract',
			base: [],
			adjustments: [],
			statutory: [
				{ scheme_code: 'PUB-FIXED', employee_amount: 30, employer_amount: 60, base_amount: 1000 }
			]
		});
	}
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-02' })
	);
	assert.deepEqual(
		prepared.gathered.yearToDate.get(`${EMPLOYEE_ID}:PUB-FIXED`),
		{ employee: 60, employer: 120, base: 2000, ordinary: 0 },
		'the paid and the unpaid slip of this company count; the other entity’s does not'
	);
	assert.deepEqual(
		prepared.gathered.bundles.map((bundle) => bundle.employment.id),
		['new-contract']
	);
});
