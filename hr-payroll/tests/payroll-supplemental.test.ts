import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	cumulativePayroll,
	supplementalPayroll,
	corePayrollInputHash
} from '../src/collections/payroll_runs/lib/supplemental.ts';
import hooks from '../src/collections/payroll_runs/+hooks.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

test('companies sharing one statutory profile cannot contribute each other’s pay components', async () => {
	const world = createPublicPayrollWorld();
	const prepare = () =>
		Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	const expected = buildPayrollRun(await prepare()).payslip_payroll_run;
	const basic = world.pay_components.find((row) => row.code === 'BASIC');
	assert.ok(basic);
	world.pay_components.push(
		{ ...structuredClone(basic), id: 'other-basic-1', company_id: 'other-company-1' },
		{ ...structuredClone(basic), id: 'other-basic-2', company_id: 'other-company-2' }
	);
	const actual = buildPayrollRun(await prepare()).payslip_payroll_run;
	assert.equal(actual[0].gross, expected[0].gross);
	assert.deepEqual(actual[0].base, expected[0].base);
	assert.deepEqual(actual[0].proration, expected[0].proration);
});

// Full-month recomputation, not independent taxation of each bonus, preserves monthly ceilings.
test('successive supplemental payrolls pay only new money and do not repeat salary', async () => {
	const world = createPublicPayrollWorld();
	const prepare = () =>
		Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	const regularFacts = await prepare();
	const originalHash = corePayrollInputHash(regularFacts);
	const regular = buildPayrollRun(regularFacts).payslip_payroll_run;
	const bonus = createPublicPayrollWorld({ includeBonus: true }).component_entries.find(
		(row) => row.event.kind === 'BONUS'
	);
	assert.ok(bonus);
	world.component_entries.push(bonus);
	const addedFacts = await prepare();
	assert.equal(corePayrollInputHash(addedFacts), originalHash);
	const cumulative = buildPayrollRun(addedFacts).payslip_payroll_run;
	const supplement = supplementalPayroll(cumulative, cumulativePayroll(regular));
	assert.equal(supplement[0].gross, bonus.amount);
	assert.equal(
		supplement[0].base.reduce((sum, row) => sum + row.amount, 0),
		0
	);
	assert.equal(regular[0].net + supplement[0].net, cumulative[0].net);
	assert.equal(supplementalPayroll(cumulative, cumulativePayroll(cumulative))[0].net, 0);
	world.employment_terms[0].base_salary = { currency: 'MYR', value: 9000 };
	assert.notEqual(corePayrollInputHash(await prepare()), originalHash);
});

test('monthly contribution cap is charged once across regular and ad hoc payments', () => {
	const charge = (base, amount) => ({
		scheme_code: 'CAPPED',
		authority: 'Test cap: 10% up to 1000',
		base_amount: base,
		employee_amount: amount,
		employer_amount: amount,
		band_key: null,
		special_amounts: {}
	});
	const payslip = (gross, amount) => ({
		employment_id: 'employee',
		currency: 'SGD',
		gross,
		net: gross - amount,
		total_deductions: amount,
		employer_cost: gross + amount,
		base: [{ component_code: 'BASIC', amount: 900 }],
		proration: [],
		statutory: [charge(gross, amount)],
		payslip_adjustment_payslip: [],
		payslip_work_day_input_payslip: [],
		payslip_component_entry_input_payslip: [],
		payslip_leave_request_input_payslip: [],
		payslip_loan_repayment_input_payslip: []
	});
	const regular = payslip(900, 90);
	const full = payslip(1200, 100);
	const difference = supplementalPayroll([full], cumulativePayroll([regular]))[0];
	assert.equal(difference.statutory[0].employee_amount, 10);
	assert.equal(difference.net, 290);
});

for (const frequency of ['DAILY', 'HOURLY']) {
	test(`${frequency} earnings use actual ordinary hours, schedule fallback and explicit AWOL`, async () => {
		const world = createPublicPayrollWorld();
		world.employment_terms[0].pay_frequency = frequency;
		world.employment_terms[0].base_salary = {
			currency: 'MYR',
			value: frequency === 'DAILY' ? 80 : 10
		};
		const base = async () => {
			const facts = await Effect.runPromise(
				gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
			);
			return buildPayrollRun(facts).payslip_payroll_run[0].base.find(
				(row) => row.component_code === 'BASIC'
			).amount;
		};
		const scheduled = await base();
		const day = world.work_days.find((row) => row.work_date === '2026-01-05');
		assert.ok(day);
		day.worked_intervals = [
			{ start: '2026-01-05T09:30:00+08:00', end: '2026-01-05T16:30:00+08:00' }
		];
		day.break_minutes = 60;
		assert.equal(await base(), scheduled - 20);
		day.worked_intervals = [];
		day.break_minutes = 0;
		assert.equal(await base(), scheduled - 80);
		day.worked_intervals = null;
		assert.equal(await base(), scheduled);
	});
}

test('marking paid rechecks earlier drafts and a draft cannot silently recalculate', async () => {
	const world = createPublicPayrollWorld();
	world.payroll_runs.push({
		id: 'prior',
		company_id: COMPANY_ID,
		period: '2026-01',
		sequence: 0,
		lifecycle: 'DRAFT'
	});
	const existing = {
		id: 'next',
		company_id: COMPANY_ID,
		period: '2026-02',
		sequence: 0,
		lifecycle: 'DRAFT'
	};
	const context = { existing, api: memoryPayrollApi(world), prepared: new Map() };
	await assert.rejects(
		Effect.runPromise(
			hooks.mutate.perRecord.before.handler({ ...context, input: { lifecycle: 'PAID' } })
		),
		/must be paid/
	);
	await assert.rejects(
		Effect.runPromise(hooks.mutate.perRecord.before.handler({ ...context, input: {} })),
		/inputs are frozen/
	);
	world.payroll_runs[0].lifecycle = 'PAID';
	world.payslips.push({ id: 'slip', payroll_run_id: 'next' });
	assert.equal(
		(
			await Effect.runPromise(
				hooks.mutate.perRecord.before.handler({ ...context, input: { lifecycle: 'PAID' } })
			)
		).lifecycle,
		'PAID'
	);
});
