import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import {
	assertPayrollPeriodAvailable,
	assertPayrollRunDeletable,
	nextRunSequence
} from '../src/lib/payroll/run/period.ts';
import { calendarDueDate, payCalendarFault } from '../src/lib/datatypes/pay_calendar.ts';
import { cents } from '../src/lib/payroll/run/rounding.ts';
import { payrollWorld, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import type { RunKind } from '../src/lib/payroll/run/period.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	ONE_OFF_ENTRY_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import { clearAllowances } from './fixtures/contract-allowances.ts';
import { settle } from './helpers/settlement.ts';

const LEAVER = 'leaver-contract';

/** The public world plus a second person who leaves on 2026-01-10, and one per-employment scheme remitted floored. */
function twoPersonWorld() {
	const world = createPublicPayrollWorld();
	clearAllowances(world);
	world.employees.push({ ...world.employees[0]!, id: 'leaver-person', name: 'Leaver' });
	world.employments.push({
		...world.employments[0]!,
		id: LEAVER,
		employee_id: 'leaver-person',
		employee_number: 'PF0002',
		effective_range: { start: '2021-06-01', end: '2026-01-10' }
	});
	world.employment_terms.push({
		...world.employment_terms[0]!,
		id: 'leaver-terms',
		employment_id: LEAVER,
		effective_range: { start: '2021-06-01', end: '2026-01-10' }
	});
	for (const day of world.work_days.filter((row) => String(row.work_date) <= '2026-01-10'))
		world.work_days.push({ ...day, id: `leaver-${day.id}`, employment_id: LEAVER });
	world.statutory_contributions.push({
		id: 'pub-epf',
		settings_id: JURISDICTION_ID,
		code: 'PUB_EPF',
		name: 'Invented provident fund',
		authority: 'Public regression fixture',
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		remittance_rounding: 'FLOOR_MAJOR_UNIT',
		rules: [
			{
				when: 'base >= 0.0',
				employee: 'round(base * 11.0 / 100.0, 0.01, "HALF_UP")',
				employer: 'round(base * 1.0 / 100.0, 0.01, "HALF_UP")'
			}
		],
		assessed_on: 'BASE + OVERTIME - ABSENCE - NO_PAY_LEAVE + ALLOWANCES',
		parts: [],
		approval_id: null
	});
	return world;
}

type Built = ReturnType<typeof buildPayrollRun>;
type Slip = Built['payslip_payroll_run'][number];

const build = (
	world: PayrollWorld,
	period: string,
	kind: RunKind = 'REGULAR',
	sources: string[] = []
) =>
	buildPayrollRun(
		gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period, kind, sources })
	);

/** File a built run the way its transform's write would: the run, its slips, every captured pin. */
function file(world: PayrollWorld, built: Built, period: string, kind: RunKind = 'REGULAR') {
	const run = {
		id: `run-${period}-${world.payroll_runs.length + 1}`,
		company_id: COMPANY_ID,
		period,
		kind,
		sequence: nextRunSequence(world.payroll_runs, period),
		company_remittances: built.company_remittances,
		company_charges: built.company_charges,
		calculation_trace: built.calculation_trace,
		approval_id: null
	};
	world.payroll_runs.push(run);
	for (const slip of built.payslip_payroll_run)
		world.payslips.push({ ...slip, payroll_run_id: run.id, approval_id: null });
	for (const capture of built.captures) {
		for (const id of capture.workDays) settle(world, 'work_days', id, capture.payslipId);
		for (const id of capture.claims) settle(world, 'claim_requests', id, capture.payslipId);
		for (const id of capture.adhoc) settle(world, 'adhoc_requests', id, capture.payslipId);
	}
	return run;
}

const slipOf = (built: Built, employmentId: string): Slip =>
	built.payslip_payroll_run.find((slip) => slip.employment_id === employmentId)!;
const figures = (slip: Slip) => ({
	gross: slip.gross,
	net: slip.net,
	statutory: slip.statutory.map((row) => [
		row.scheme_code,
		row.employee_amount,
		row.employer_amount
	])
});
const payable = (runs: readonly Built[]) =>
	cents(
		runs
			.flatMap((built) => built.company_remittances)
			.reduce((sum, row) => sum + row.payable_amount, 0)
	);

test('a FINAL run then a REGULAR run pay what one combined run pays', () => {
	const combined = build(twoPersonWorld(), '2026-01');
	assert.equal(combined.payslipCount, 2);

	const world = twoPersonWorld();
	const final = build(world, '2026-01', 'FINAL');
	// FINAL takes only the employment that exits in the window.
	assert.deepEqual(
		final.payslip_payroll_run.map((slip) => slip.employment_id),
		[LEAVER]
	);
	file(world, final, '2026-01', 'FINAL');
	const regular = build(world, '2026-01');
	// REGULAR skips the person the FINAL settled.
	assert.deepEqual(
		regular.payslip_payroll_run.map((slip) => slip.employment_id),
		[EMPLOYMENT_ID]
	);

	assert.deepEqual(figures(slipOf(final, LEAVER)), figures(slipOf(combined, LEAVER)));
	assert.deepEqual(
		figures(slipOf(regular, EMPLOYMENT_ID)),
		figures(slipOf(combined, EMPLOYMENT_ID))
	);
	// Hand-computed for the whole-month stayer: 11% and 1% of 3,451.00.
	assert.deepEqual(figures(slipOf(regular, EMPLOYMENT_ID)).statutory, [['PUB_EPF', 379.61, 34.51]]);
});

test('FINAL then REGULAR remits the month once: the REGULAR reports only its increment', () => {
	const combined = build(twoPersonWorld(), '2026-01');
	const world = twoPersonWorld();
	const final = build(world, '2026-01', 'FINAL');
	file(world, final, '2026-01', 'FINAL');
	const regular = build(world, '2026-01');
	const accrued = (runs: readonly Built[]) =>
		cents(
			runs
				.flatMap((built) => built.company_remittances)
				.reduce((sum, row) => sum + row.accrued_amount, 0)
		);
	assert.equal(accrued([final, regular]), accrued([combined]));
	// The month's floor is taken once, over the whole month: floor(34.51 + the leaver's 1%).
	assert.equal(payable([final, regular]), payable([combined]));
	assert.equal(payable([combined]), Math.floor(accrued([combined])));
});

test('a FINAL run refuses when nobody exits in the period, or the leaver is already settled', () => {
	const world = twoPersonWorld();
	file(world, build(world, '2026-01', 'FINAL'), '2026-01', 'FINAL');
	assert.throws(() => build(world, '2026-01', 'FINAL'), /No employment exits in 2026-01/);
	assert.throws(() => build(createPublicPayrollWorld(), '2026-01', 'FINAL'), /No employment exits/);
});

test('an OFF_CYCLE run pays only the selected request, with no wages beside it', () => {
	const world = createPublicPayrollWorld();
	clearAllowances(world);
	file(world, build(world, '2026-01'), '2026-01');
	world.adhoc_requests.push({
		...createPublicPayrollWorld({ includePayment: true }).adhoc_requests[0]!,
		payslip_id: null
	});
	assert.throws(() => build(world, '2026-01', 'OFF_CYCLE'), /select one/);
	assert.throws(
		() => build(world, '2026-01', 'OFF_CYCLE', ['no-such-request']),
		/not an outstanding, approved claim or ad hoc request/
	);
	const offCycle = build(world, '2026-01', 'OFF_CYCLE', [ONE_OFF_ENTRY_ID]);
	assert.equal(offCycle.payslipCount, 1);
	const slip = offCycle.payslip_payroll_run[0]!;
	assert.deepEqual(slip.base, []);
	assert.equal(slip.gross, 100);
	assert.equal(slip.net, 100);
	assert.deepEqual(
		slip.adjustments.map((row) => [row.family, row.source_id, row.amount]),
		[['ADHOC', ONE_OFF_ENTRY_ID, 100]]
	);
	assert.deepEqual(offCycle.captures[0]!.adhoc, [ONE_OFF_ENTRY_ID]);
});

test('an OFF_CYCLE run pays someone who has already left; a CORRECTION pays ad hoc lines only', () => {
	const world = createPublicPayrollWorld({ includePayment: true });
	clearAllowances(world);
	world.employments[0]!.effective_range = { start: '2021-06-01', end: '2025-12-31' };
	world.employment_terms[0]!.effective_range = { start: '2021-06-01', end: '2025-12-31' };
	const correction = build(world, '2026-01', 'CORRECTION', [ONE_OFF_ENTRY_ID]);
	assert.equal(correction.payslip_payroll_run[0]!.gross, 100);
	assert.equal(correction.payslip_payroll_run[0]!.employment_id, EMPLOYMENT_ID);

	world.claim_catalogue.push({ ...world.allowance_catalogue[0], id: 'expense', code: 'EXPENSE' });
	world.claim_requests.push({
		id: 'claim',
		employment_id: EMPLOYMENT_ID,
		catalogue_id: 'expense',
		amount: 40,
		incurred_on: '2026-01-05',
		pay_period: '2026-01',
		as_adjustment_entry: false,
		payslip_id: null,
		approval_id: null
	});
	assert.throws(
		() => build(world, '2026-01', 'CORRECTION', ['claim']),
		/A correction pays ad hoc lines only/
	);
	assert.equal(build(world, '2026-01', 'OFF_CYCLE', ['claim']).payslip_payroll_run[0]!.gross, 40);
});

test('one REGULAR run per period; other kinds stand beside it, never behind a later period', () => {
	const runs = [
		{ period: '2026-01', kind: 'REGULAR', sequence: 1 },
		{ period: '2026-01', kind: 'FINAL', sequence: 2 }
	];
	assert.throws(
		() => assertPayrollPeriodAvailable(runs, '2026-01'),
		/Payroll 2026-01 already exists/
	);
	assertPayrollPeriodAvailable(runs, '2026-01', 'OFF_CYCLE');
	assertPayrollPeriodAvailable(runs, '2026-01', 'CORRECTION');
	assertPayrollPeriodAvailable(runs, '2026-02');
	assertPayrollPeriodAvailable(runs, '2026-02', 'FINAL');
	assert.throws(() => assertPayrollPeriodAvailable(runs, '2026-03'), /2026-02 was never run/);
	const later = [...runs, { period: '2026-02', kind: 'REGULAR', sequence: 1 }];
	assert.throws(
		() => assertPayrollPeriodAvailable(later, '2026-01', 'OFF_CYCLE'),
		/Payroll 2026-02 already exists/
	);

	assert.equal(nextRunSequence(runs, '2026-01'), 3);
	assert.equal(nextRunSequence(runs, '2026-02'), 1);
	// Within a period the higher sequence is the later run, and it is unwound first.
	assert.throws(
		() => assertPayrollRunDeletable([runs[1]!], runs[0]!),
		/Delete payrolls newest first/
	);
	assertPayrollRunDeletable([runs[0]!], runs[1]!);
});

test('the pay calendar dates a run with no stated due date; a stated one wins', () => {
	const calendar = [{ cadence: 'MONTHLY', due: 'add_days(period.end, 7)', authority: 'fixture' }];
	assert.equal(payCalendarFault(calendar), undefined);
	assert.match(payCalendarFault([...calendar, ...calendar])!, /MONTHLY is dated twice/);
	assert.match(payCalendarFault([{ ...calendar[0]!, due: ' ' }])!, /states its cadence/);
	assert.equal(
		calendarDueDate({
			calendar,
			cadence: 'MONTHLY',
			period: { start: '2026-02-01', end: '2026-02-28' },
			run: { period: '2026-02', pay_date: '2026-02-28' },
			company: { settings_code: 'PF', pay_frequency: 'MONTHLY' }
		}),
		'2026-03-07'
	);
	assert.equal(
		calendarDueDate({
			calendar,
			cadence: 'WEEKLY',
			period: { start: '2026-02-01', end: '2026-02-07' },
			run: { period: '2026-02-1', pay_date: '2026-02-07' },
			company: { settings_code: 'PF', pay_frequency: 'WEEKLY' }
		}),
		undefined
	);

	const world = createPublicPayrollWorld();
	world.jurisdiction_settings[0]!.payroll.pay_calendar = calendar;
	const prepare = (payDueDate?: string) =>
		gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period: '2026-01',
			payDueDate
		});
	assert.equal(prepare().window.payDueDate, '2026-02-07');
	assert.equal(prepare('2026-02-03').window.payDueDate, '2026-02-03');
});
