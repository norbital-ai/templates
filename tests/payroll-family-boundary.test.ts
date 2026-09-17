import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

function mixedFamilies() {
	const world = createPublicPayrollWorld({ includePayment: true });
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	}
	world.claim_catalogue.push({
		...world.allowance_catalogue[0],
		id: 'claim-type',
		code: 'EXPENSE',
		bands: [
			{
				when: '',
				amount: 'entry.amount',
				limit: { period: 'CALENDAR_YEAR', on_exceed: 'BLOCK', amount: '500.0' }
			}
		]
	});
	world.claim_requests.push({
		id: 'claim',
		employment_id: EMPLOYMENT_ID,
		catalogue_id: 'claim-type',
		amount: 300,
		incurred_on: '2026-01-15',
		approval_id: null
	});
	world.loan_catalogue.push({
		...world.allowance_catalogue[0],
		id: 'loan-type',
		code: 'LOAN',
		destination: 'NET',
		direction: 'SUBTRACT'
	});
	world.loans.push({
		id: 'loan',
		employment_id: EMPLOYMENT_ID,
		loan_catalogue_id: 'loan-type',
		approval_id: null
	});
	world.loan_repayments.push({
		id: 'repayment',
		loan_id: 'loan',
		due_date: '2026-01-15',
		amount_due: 50,
		sequence: 1
	});
	return world;
}

async function calculate(world: ReturnType<typeof mixedFamilies>) {
	return buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({
				api: memoryPayrollApi(world) as never,
				companyId: COMPANY_ID,
				period: '2026-01'
			})
		)
	);
}

test('family preparation and calculation preserve mixed source capture and cross-family sequence', async () => {
	const result = await calculate(mixedFamilies());
	const payslip = result.payslip_payroll_run[0]!;
	const amounts = new Map<string, number>();
	for (const line of payslip.adjustments)
		amounts.set(line.family, (amounts.get(line.family) ?? 0) + line.amount);
	assert.equal(amounts.get('CLAIM'), 300);
	// The standing allowance and the one-off are one family now: 310 + 100.
	assert.equal(amounts.get('ALLOWANCE'), 410);
	assert.equal(amounts.get('LOAN_REPAYMENT'), 50);
	assert.equal(payslip.base.find((line) => line.component_code === 'BASIC')?.amount, 3451);
	assert.equal(payslip.employment_id, EMPLOYMENT_ID);
});

test('payroll orchestration does not read family-owned source tables or interpret calculation definitions', async () => {
	for (const name of ['engine', 'gather', 'configuration']) {
		const source = await readFile(
			new URL(`../src/collections/payroll_runs/lib/${name}.ts`, import.meta.url),
			'utf8'
		);
		assert.doesNotMatch(
			source,
			/\bdb\.(?:claim_requests|allowances|allowance_entries|loans|loan_repayments|work_days|leave_entries|employment_statutory_facts|claim_catalogue|allowance_catalogue|loan_catalogue|leave_catalogue|statutory_contributions)\b/,
			name
		);
		assert.doesNotMatch(source, /definition\??\.source/, name);
	}
	const coordinator = await readFile(
		new URL('../src/lib/payroll/families.ts', import.meta.url),
		'utf8'
	);
	assert.doesNotMatch(coordinator, /definition\??\.source/);
});
