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
		hire_date: '2026-01-16',
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
		day.break_minutes = 60;
	}
	world.allowance_requests.length = 0;
	world.statutory_contributions.push({
		id: 'fixed-scheme',
		settings_id: JURISDICTION_ID,
		code: 'PUB-FIXED',
		name: 'Invented fixed assessment',
		authority: 'Public regression fixture',
		is_statutory: true,
		rounding: 'NEAREST_CENT',
		relief_for: [],
		sequence: 1,
		special_rules: [],
		bands: [
			{
				selector: { by: 'WAGE', from: 0, to: null },
				award: { kind: 'FIXED', employee: 30.01, employer: 60.01 }
			}
		],
		approval_id: null
	});
	for (const catalogue of [world.allowance_catalogue, world.payment_catalogue])
		for (const row of catalogue) row.contribution_treatments = { 'PUB-FIXED': { kind: 'EXCLUDE' } };
	for (const work of world.work_catalogue)
		work.treatments = {
			'PUB-FIXED': {
				salary: { kind: 'INCLUDE' },
				overtime: { kind: 'INCLUDE' },
				overtime_excess: { kind: 'INCLUDE' },
				absence: { kind: 'REDUCE' }
			}
		};
	return world;
}

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

test('rehire gathers prior paid YTD across old contracts while excluding another entity and drafts', async () => {
	const world = rehireWorld();
	world.employments.push({
		...world.employments[0],
		id: 'other-entity-contract',
		company_id: 'other-company'
	});
	for (const [id, company, lifecycle] of [
		['old-paid', COMPANY_ID, 'PAID'],
		['old-draft', COMPANY_ID, 'DRAFT'],
		['other-paid', 'other-company', 'PAID']
	]) {
		world.payroll_runs.push({ id, company_id: company, period: '2026-01', lifecycle });
		world.payslips.push({
			id: `${id}-slip`,
			payroll_run_id: id,
			employment_id: company === COMPANY_ID ? EMPLOYMENT_ID : 'other-entity-contract',
			statutory: [
				{ scheme_code: 'PUB-FIXED', employee_amount: 30, employer_amount: 60, base_amount: 1000 }
			]
		});
	}
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-02' })
	);
	assert.deepEqual(prepared.gathered.yearToDate.get(`${EMPLOYEE_ID}:PUB-FIXED`), {
		employee: 30,
		employer: 60,
		base: 1000
	});
	assert.deepEqual(
		prepared.gathered.bundles.map((bundle) => bundle.employment.id),
		['new-contract']
	);
});
