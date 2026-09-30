// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * An instalment is taken on the payslip whose period contains its due date (F18).
 *
 * The public fixture company cuts off on the 21st. The cutoff places late-reported events; a loan
 * instalment is a date the agreement fixed, so one due 25 February is February's (paid 28
 * February), not March's. Hand-computed golden: the February payslip recovers exactly the 300
 * instalment due 2026-02-25, so its net is the no-loan net less 300; the 2026-03-01 instalment
 * is not yet due.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID
} from './fixtures/public-payroll-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { clearAllowances } from './fixtures/contract-allowances.ts';

const LOAN_ID = 'cccccccc-dddd-4eee-8fff-000000000001';
const AFTER_CUTOFF = 'cccccccc-dddd-4eee-8fff-000000000002';
const NEXT_MONTH = 'cccccccc-dddd-4eee-8fff-000000000003';

function world(withLoan: boolean) {
	const world = createPublicPayrollWorld();
	clearAllowances(world);
	for (const day of world.work_days)
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T12:30:00+08:00` },
			{ start: `${day.work_date}T13:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	if (!withLoan) return world;
	world.loan_catalogue = [
		{
			id: 'cccccccc-dddd-4eee-8fff-000000000004',
			settings_id: JURISDICTION_ID,
			code: 'STAFF_LOAN',
			name: 'Staff loan',
			destination: 'NET',
			direction: 'SUBTRACT',
			evidence: 'NONE',
			recurring: false,
			minimum_repayment: null,
			loan_type: 'STAFF',
			bands: [{ when: '', amount: 'entry.amount', limit: null }],
			sequence: 70,
			eligibility: '',
			approval_id: null
		}
	];
	world.loans.push({
		id: LOAN_ID,
		employment_id: EMPLOYMENT_ID,
		loan_catalogue_id: 'cccccccc-dddd-4eee-8fff-000000000004',
		principal: 600,
		reference: 'LN-F18',
		effective_range: { start: '2026-02-25', end: '2026-03-31' },
		approval_id: null
	});
	world.loan_repayments.push(
		{
			id: AFTER_CUTOFF,
			loan_id: LOAN_ID,
			employment_id: EMPLOYMENT_ID,
			due_date: '2026-02-25',
			amount_due: 300,
			sequence: 1,
			payslip_id: null,
			approval_id: null
		},
		{
			id: NEXT_MONTH,
			loan_id: LOAN_ID,
			employment_id: EMPLOYMENT_ID,
			due_date: '2026-03-01',
			amount_due: 300,
			sequence: 2,
			payslip_id: null,
			approval_id: null
		}
	);
	return world;
}

const february = async (world) =>
	buildPayrollRun(
		await gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-02' })
	);

test('an instalment due after the cutoff is recovered on the payslip whose period contains it', async () => {
	const result = await february(world(true));
	const slip = result.payslip_payroll_run[0];
	const recoveries = slip.adjustments.filter((row) => row.family === 'LOAN_REPAYMENT');
	assert.deepEqual(
		recoveries.map((row) => [row.source_id, row.amount]),
		[[AFTER_CUTOFF, 300]],
		'the 25 February instalment is February’s; the 1 March one is not yet due'
	);
	assert.deepEqual(result.captures.find((row) => row.payslipId === slip.id).loanRepayments, [
		AFTER_CUTOFF
	]);
	const baseline = (await february(world(false))).payslip_payroll_run[0];
	assert.equal(slip.net, Math.round((baseline.net - 300) * 100) / 100);
});
