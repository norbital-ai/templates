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

function mixedFamilies(claimSequence = 200) {
	const world = createPublicPayrollWorld({ includePayment: true });
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
		day.break_minutes = 60;
	}
	world.claim_catalogue.push({
		...world.payment_catalogue[0],
		id: 'claim-type',
		code: 'EXPENSE',
		sequence: claimSequence,
		definition: {
			source: 'ENTRY',
			unit: 'MONEY',
			evidence: 'NONE',
			settlement: 'PAYROLL',
			cap: {
				period: 'CALENDAR_YEAR',
				on_exceed: 'BLOCK',
				matrix: {
					merge: 'MAX_WITH_COMPANY_LAYERS',
					layers: [
						{
							level: 'ORGANISATION',
							eligibility: '',
							authority: 'Synthetic sequence regression',
							effective_range: { start: '2020-01-01', end: null },
							award: { kind: 'FORMULA', expr: "component('BASIC') / 10.0" },
							reimbursement_percentage: 100
						}
					]
				}
			}
		}
	});
	world.claim_requests.push({
		id: 'claim',
		employment_id: EMPLOYMENT_ID,
		claim_catalogue_id: 'claim-type',
		amount: 300,
		incurred_on: '2026-01-15',
		approval_id: null
	});
	world.loan_catalogue.push({
		...world.payment_catalogue[0],
		id: 'loan-type',
		code: 'LOAN',
		nature: 'DEDUCTION',
		policy: { kind: 'DEDUCTION', settlement: 'DEDUCT' },
		sequence: 400
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
	const amounts = new Map(payslip.adjustments.map((line) => [line.family, line.amount]));
	assert.equal(amounts.get('CLAIM'), 300);
	assert.equal(amounts.get('ALLOWANCE'), 310);
	assert.equal(amounts.get('PAYMENT'), 100);
	assert.equal(amounts.get('LOAN_REPAYMENT'), 50);
	assert.equal(payslip.base.find((line) => line.component_code === 'BASIC')?.amount, 3451);
	assert.equal(payslip.employment_id, EMPLOYMENT_ID);
});

test('a money cap cannot see a Work output scheduled after it', async () => {
	await assert.rejects(calculate(mixedFamilies(10)), /EXPENSE.*(cap|entitlement|exceed)/i);
});

test('payroll orchestration does not read family-owned source tables or interpret calculation definitions', async () => {
	for (const name of ['engine', 'gather', 'configuration']) {
		const source = await readFile(
			new URL(`../src/collections/payroll_runs/lib/${name}.ts`, import.meta.url),
			'utf8'
		);
		assert.doesNotMatch(
			source,
			/\bdb\.(?:claim_requests|allowance_requests|payment_requests|loans|loan_repayments|work_days|leave_entries|employment_statutory_facts|claim_catalogue|allowance_catalogue|payment_catalogue|loan_catalogue|work_catalogue|leave_catalogue|statutory_contributions)\b/,
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
