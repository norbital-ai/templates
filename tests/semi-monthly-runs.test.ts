// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Two payroll runs a month at a semi-monthly company, through the engine.
 *
 * Before the half grammar, one monthly run at a `SEMI_MONTHLY` company paid every cadence at once:
 * a semi-monthly employment received one payslip carrying the whole month, exactly as the monthly
 * employment beside it did. Those are the figures captured below as `BEFORE`, from the model as it
 * stood, and they are the ones the two halves have to add back up to. The monthly employment's
 * figure must not move at all: it is paid once, in the second half, over the same cutoff window it
 * always had.
 *
 * The world is `createSemiMonthlyPayrollWorld`: the public fixture entity paying twice a month, one
 * employment on `SEMI_MONTHLY` terms at 4,100 and one on monthly terms at 3,451 plus a 310 standing
 * allowance, an 11% / 13% retirement scheme on both.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { memoryPayrollApi, refusalMessage } from './fixtures/memory-payroll-api.ts';
import { capturesOf, settle as settleSource } from './helpers/settlement.ts';
import {
	COMPANY_ID,
	JURISDICTION_ID,
	MONTHLY_EMPLOYMENT_ID,
	SEMI_MONTHLY_BASE,
	SEMI_MONTHLY_EMPLOYEE_ID,
	SEMI_MONTHLY_EMPLOYMENT_ID,
	RETIREMENT_SCHEME_ID,
	createSemiMonthlyPayrollWorld
} from './fixtures/semi-monthly-payroll-world.ts';
import { assignAllowance, clearAllowances } from './fixtures/contract-allowances.ts';

/** One monthly run of `2026-02` at this company, before halves existed (captured 2026-09-07). */
const BEFORE = {
	semiMonthly: { gross: 4100, deductions: 451, net: 3649, employerCost: 533 },
	monthly: { gross: 3761, deductions: 413.71, net: 3347.29, employerCost: 488.93 }
};

const cents = (value) => Math.round(value * 100) / 100;

async function build(world, period) {
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
	);
	return { prepared, built: buildPayrollRun(prepared) };
}

const slipOf = (built, employmentId) =>
	built.payslip_payroll_run.find((slip) => slip.employment_id === employmentId) ?? null;

/** File a built run in the world as PAID, so the next run reads it as year-to-date. */
function settle(world, period, prepared, built) {
	const runId = `run-${period}`;
	world.payroll_runs.push({
		id: runId,
		company_id: COMPANY_ID,
		period,
		pay_date: prepared.window.payDate,
		attendance_from: prepared.window.attendance.start,
		attendance_to: prepared.window.attendance.end,
		approval_id: null
	});
	for (const slip of built.payslip_payroll_run) {
		// Filed as PAID means its slips are paid: payment is the slip's fact, and the next run
		// reads history off `paid_at` rather than off the run's summary.
		world.payslips.push({
			...slip,
			payroll_run_id: runId,
			paid_at: prepared.window.payDate,
			approval_id: null
		});
		const captured = capturesOf(built, slip);
		// Pin every captured source.
		for (const id of captured.claims) settleSource(world, 'claim_requests', id, slip.id, period);
		for (const id of captured.adhoc) settleSource(world, 'adhoc_requests', id, slip.id, period);
		for (const id of captured.leave) settleSource(world, 'leave_entries', id, slip.id, period);
		for (const id of captured.loanRepayments)
			settleSource(world, 'loan_repayments', id, slip.id, period);
	}
}

test('a semi-monthly company refuses a whole month and a monthly company refuses a half, naming the frequency', async () => {
	const world = createSemiMonthlyPayrollWorld();
	await assert.rejects(build(world, '2026-02'), (error) => {
		assert.match(
			refusalMessage(error),
			/Public Fixture Co pays SEMI_MONTHLY.*YYYY-MM-1.*YYYY-MM-2.*"2026-02" names a whole month/
		);
		return true;
	});
	world.companies[0].pay_frequency = 'MONTHLY';
	await assert.rejects(build(world, '2026-02-1'), (error) => {
		assert.match(refusalMessage(error), /Public Fixture Co pays MONTHLY.*months written YYYY-MM/);
		return true;
	});
});

for (const [assessment, cutoff] of [
	['PAY_PERIOD', 'FIRST'],
	['MONTH', 'FIRST'],
	['MONTH', 'SPLIT']
])
	test(`a monthly directed instalment is collected once across settled ${assessment} ${cutoff} cut-offs`, async () => {
		const world = createSemiMonthlyPayrollWorld();
		const scheme = world.statutory_contributions.find((row) => row.id === RETIREMENT_SCHEME_ID);
		scheme.assessment_period = assessment;
		world.companies[0].semi_monthly_statutory_cutoff = cutoff;
		world.employment_statutory_facts.push({
			id: 'directed-fixture',
			employee_id: SEMI_MONTHLY_EMPLOYEE_ID,
			statutory_contribution_id: RETIREMENT_SCHEME_ID,
			effective_range: { start: '2026-01-01', end: null },
			status: {
				kind: 'REGISTERED',
				reference_number: 'direction-test',
				rate_override: null,
				instalments: [{ amount: 1000, from: '2026-02', to: '2026-02', reference: 'test' }]
			}
		});
		const first = await build(world, '2026-02-1');
		settle(world, '2026-02-1', first.prepared, first.built);
		const second = await build(world, '2026-02-2');
		const charges = [first, second].map(({ built }) =>
			slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID).statutory.find(
				(row) => row.scheme_code === 'PUB_EPF'
			)
		);
		assert.deepEqual(
			charges.map((row) => row.directed_amount),
			[1000, 0]
		);
		assert.equal(cents(charges.reduce((sum, row) => sum + row.employee_amount, 0)), 1451);
		assert.equal(cents(charges.reduce((sum, row) => sum + row.employer_amount, 0)), 533);
	});

test('half 1 pays only the semi-monthly employment, for the 1st to the 15th, on the 15th', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const { prepared, built } = await build(world, '2026-02-1');
	assert.deepEqual(prepared.window.attendance, { start: '2026-02-01', end: '2026-02-15' });
	assert.equal(prepared.window.payDate, '2026-02-15');
	assert.equal(built.payslipCount, 1, 'the monthly employment is not in the first half');
	assert.equal(slipOf(built, MONTHLY_EMPLOYMENT_ID), null);
	const slip = slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID);
	assert.deepEqual(
		slip.proration
			.filter((segment) => segment.component_code === 'BASIC')
			.map((segment) => [segment.from, segment.to, segment.days, segment.denominator]),
		[['2026-02-01', '2026-02-15', 15, 28]],
		"fifteen of February's twenty-eight days"
	);
	assert.equal(slip.gross, cents(SEMI_MONTHLY_BASE * (15 / 28)));
	// The monthly employment is still on the books: headcount is the company's, not the run's.
	assert.equal(prepared.gathered.headcount, 2);
});

test('half 2 pays the semi-monthly employment for the 16th to the end and the monthly employment on the cutoff window', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const { prepared, built } = await build(world, '2026-02-2');
	assert.deepEqual(
		prepared.window.attendance,
		{ start: '2026-01-21', end: '2026-02-28' },
		'the envelope of the semi-monthly instalment and the monthly cutoff window'
	);
	assert.equal(prepared.window.payDate, '2026-02-28');
	assert.equal(built.payslipCount, 2);
	const semi = slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID);
	assert.deepEqual(
		semi.proration
			.filter((segment) => segment.component_code === 'BASIC')
			.map((segment) => [segment.from, segment.to, segment.days, segment.denominator]),
		[['2026-02-16', '2026-02-28', 13, 28]]
	);
	const monthly = slipOf(built, MONTHLY_EMPLOYMENT_ID);
	assert.deepEqual(
		monthly.proration
			.filter((segment) => segment.component_code === 'BASIC')
			.map((segment) => [segment.from, segment.to, segment.days, segment.denominator]),
		[['2026-02-01', '2026-02-28', 28, 28]],
		'the whole month, as at a monthly company'
	);
	const monthlyBundle = prepared.gathered.bundles.find(
		(bundle) => bundle.employment.id === MONTHLY_EMPLOYMENT_ID
	);
	assert.deepEqual(monthlyBundle.attendance, { start: '2026-01-21', end: '2026-02-20' });
	assert.equal(monthlyBundle.payFrequency, 'MONTHLY');
});

test('the two halves add up to what one monthly run paid, and the monthly employment is unchanged', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const first = await build(world, '2026-02-1');
	settle(world, '2026-02-1', first.prepared, first.built);
	const second = await build(world, '2026-02-2');

	const half1 = slipOf(first.built, SEMI_MONTHLY_EMPLOYMENT_ID);
	const half2 = slipOf(second.built, SEMI_MONTHLY_EMPLOYMENT_ID);
	const sum = (field) => cents(half1[field] + half2[field]);
	assert.equal(sum('gross'), BEFORE.semiMonthly.gross);
	assert.equal(sum('total_deductions'), BEFORE.semiMonthly.deductions);
	assert.equal(sum('net'), BEFORE.semiMonthly.net);
	assert.equal(sum('employer_cost'), BEFORE.semiMonthly.employerCost);
	// The halves themselves, so a compensating pair of errors cannot pass as a sum.
	assert.equal(half1.net, 1954.82);
	assert.equal(half2.net, 1694.18);

	const monthly = slipOf(second.built, MONTHLY_EMPLOYMENT_ID);
	assert.equal(monthly.gross, BEFORE.monthly.gross);
	assert.equal(monthly.total_deductions, BEFORE.monthly.deductions);
	assert.equal(monthly.net, BEFORE.monthly.net);
	assert.equal(monthly.employer_cost, BEFORE.monthly.employerCost);
});

/**
 * The proration divisor is the month, on every basis.
 *
 * The two halves above add up because `CALENDAR_DAYS` always divided by `monthDays`. The other two
 * bases divided by the *period*, so each half of a semi-monthly month measured itself against its
 * own working days, came out at a fraction of 1.0, and paid a whole month's salary — twice. The
 * halves are asserted against the same monthly figures the calendar basis reaches, because a month
 * is a month whatever counts its days.
 */
for (const [name, proration] of [
	['WORKING_DAYS', { by: 'WORKING_DAYS' }],
	['FIXED_DAYS', { by: 'FIXED_DAYS', days: 21.75 }]
]) {
	test(`the two halves add up to one month on a ${name} basis, not to two`, async () => {
		const world = createSemiMonthlyPayrollWorld();
		(world.jurisdiction_settings[0]!.work_rules as { proration: unknown }).proration = proration;
		const first = await build(world, '2026-02-1');
		settle(world, '2026-02-1', first.prepared, first.built);
		const second = await build(world, '2026-02-2');

		const half1 = slipOf(first.built, SEMI_MONTHLY_EMPLOYMENT_ID);
		const half2 = slipOf(second.built, SEMI_MONTHLY_EMPLOYMENT_ID);
		assert.equal(cents(half1.gross + half2.gross), BEFORE.semiMonthly.gross);
		assert.equal(cents(half1.net + half2.net), BEFORE.semiMonthly.net);
		// Neither half is a whole month on its own, which is the shape the bug had.
		assert.ok(
			half1.gross < SEMI_MONTHLY_BASE,
			`half 1 paid ${half1.gross} of ${SEMI_MONTHLY_BASE}`
		);
		assert.ok(
			half2.gross < SEMI_MONTHLY_BASE,
			`half 2 paid ${half2.gross} of ${SEMI_MONTHLY_BASE}`
		);
		// A monthly run measures the whole month, so its figures do not move with the basis at all.
		const monthly = slipOf(second.built, MONTHLY_EMPLOYMENT_ID);
		assert.equal(monthly.gross, BEFORE.monthly.gross);
		assert.equal(monthly.net, BEFORE.monthly.net);
	});
}

test('an allowance on the terms of one half alone is priced in that half, at the half’s share of the month', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const transport = world.allowance_catalogue.find((component) => component.code === 'TRANSPORT');
	// A terms change on the 16th drops the allowance: the first half's terms list it, the
	// second half's do not.
	assignAllowance(world, {
		employment_id: SEMI_MONTHLY_EMPLOYMENT_ID,
		catalogue_id: transport.id,
		amount: 100,
		effective_from: '2026-02-01',
		effective_to: '2026-02-15'
	});
	const first = await build(world, '2026-02-1');
	settle(world, '2026-02-1', first.prepared, first.built);
	const second = await build(world, '2026-02-2');
	const segments = (built) =>
		slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID)
			.proration.filter((row) => row.component_code === 'TRANSPORT')
			.map((row) => [row.days, row.denominator, row.prorated_amount]);
	// The public fixture prorates on calendar days: a monthly 100 over the 1st–15th is 15/28 of it.
	assert.deepEqual(segments(first.built), [[15, 28, 53.57]]);
	assert.deepEqual(segments(second.built), []);
});

/**
 * The withholding projection over twenty-four half-month payslips lands where twelve did.
 *
 * A progressive scale over the annual wage: nothing to 20,000, then 1%, 3% from 35,000 with 150
 * accumulated, 8% from 50,000 with 600. On 4,100 a month the annual wage is 49,200 and the annual
 * tax 150 + 14,200 × 3% = 576: 48.00 a month. The monthly employment is put on the same wage with
 * no allowance so the two cadences project the same year, and each half must withhold 24.00: the
 * first from a projection of the whole year off fifteen days' wages, the second from the year-to-
 * date it reads back off the first.
 */
/**
 * The annual scale as its rules state it: project the year, clamp at zero, scale through the
 * published ladder, spread what is left, then round to the cent.
 */
const PUB_TAX_CHARGEABLE =
	'scheme.year_to_date.base + base * (1.0 + scheme.projection.future_equivalents)';
const PUB_TAX_CLAMPED = `(${PUB_TAX_CHARGEABLE} > 0.0 ? ${PUB_TAX_CHARGEABLE} : 0.0)`;
const PUB_TAX_SCALED = `progressive(${PUB_TAX_CLAMPED}, [0.0, 0.0, 0.0, 20000.0, 0.0, 1.0, 35000.0, 150.0, 3.0, 50000.0, 600.0, 8.0])`;
const PUB_TAX_EMPLOYEE = `round_cent((${PUB_TAX_SCALED} - scheme.year_to_date.employee > 0.0 ? (${PUB_TAX_SCALED} - scheme.year_to_date.employee) / (scheme.projection.payslips_remaining > 1.0 ? scheme.projection.payslips_remaining : 1.0) : 0.0))`;

test('the tax projection over twenty-four half payslips lands where twelve monthly ones did', async () => {
	const world = createSemiMonthlyPayrollWorld();
	world.employment_terms[0].base_salary = { value: SEMI_MONTHLY_BASE, currency: 'MYR' };
	clearAllowances(world);
	world.statutory_contributions.push({
		id: 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa9',
		settings_id: JURISDICTION_ID,
		code: 'PUB_TAX',
		name: 'Public fixture withholding',
		authority: 'Public fixture',
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		assessed_on: 'BASE + OVERTIME + NIGHT_PREMIUM - ABSENCE - NO_PAY_LEAVE + CLAIMS + ALLOWANCES',
		parts: [],
		approval_id: null,
		rules: [{ when: 'true', employee: PUB_TAX_EMPLOYEE, employer: '0.0' }]
	});

	const tax = (slip) => slip.statutory.find((line) => line.scheme_code === 'PUB_TAX');

	const first = await build(world, '2026-01-1');
	settle(world, '2026-01-1', first.prepared, first.built);
	const second = await build(world, '2026-01-2');
	settle(world, '2026-01-2', second.prepared, second.built);

	const half1 = tax(slipOf(first.built, SEMI_MONTHLY_EMPLOYMENT_ID));
	const half2 = tax(slipOf(second.built, SEMI_MONTHLY_EMPLOYMENT_ID));
	const monthly = tax(slipOf(second.built, MONTHLY_EMPLOYMENT_ID));
	assert.equal(monthly.employee_amount, 48, 'a twelfth of 576 on the monthly cadence');
	assert.equal(half1.employee_amount, 24, 'a twenty-fourth of the year projected off fifteen days');
	assert.equal(half2.employee_amount, 24, 'a twenty-third of what the first half left');
	assert.equal(cents(half1.employee_amount + half2.employee_amount), monthly.employee_amount);

	// February reads January's two payslips as year-to-date and keeps landing on the same year.
	const third = await build(world, '2026-02-1');
	settle(world, '2026-02-1', third.prepared, third.built);
	const fourth = await build(world, '2026-02-2');
	assert.equal(tax(slipOf(third.built, SEMI_MONTHLY_EMPLOYMENT_ID)).employee_amount, 24);
	assert.equal(tax(slipOf(fourth.built, SEMI_MONTHLY_EMPLOYMENT_ID)).employee_amount, 24);
	assert.equal(tax(slipOf(fourth.built, MONTHLY_EMPLOYMENT_ID)).employee_amount, 48);
});

/**
 * A standing allowance at a semi-monthly employment is priced in both halves, each taking its
 * share of the month, and the two shares are the month: the halves prorate within the half.
 */
test('a standing allowance is split across the halves and adds up to the month', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const transport = world.allowance_catalogue.find((component) => component.code === 'TRANSPORT');
	assert.ok(transport, 'the semi-monthly world offers a component that takes entries');
	assignAllowance(world, {
		employment_id: SEMI_MONTHLY_EMPLOYMENT_ID,
		catalogue_id: transport.id,
		amount: 100,
		effective_from: '2026-02-01',
		effective_to: null,
		reason: '',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});

	const firstHalf = await build(world, '2026-02-1');
	settle(world, '2026-02-1', firstHalf.prepared, firstHalf.built);
	const secondHalf = await build(world, '2026-02-2');

	/** The allowance's base line on the half's slip. */
	const paidFor = (built) =>
		slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID).base.find((row) => row.component_code === 'TRANSPORT')
			?.amount ?? 0;

	const first = paidFor(firstHalf.built);
	const second = paidFor(secondHalf.built);
	assert.equal(first, 53.57, 'the 1st to the 15th is 15/28 of the month');
	assert.equal(second, 46.43, 'the 16th to the 28th is 13/28 of it');
	assert.equal(cents(first + second), 100, 'the halves are the month');
	settle(world, '2026-02-2', secondHalf.prepared, secondHalf.built);
	const roster = world.work_days.find((row) => row.employment_id === SEMI_MONTHLY_EMPLOYMENT_ID);
	world.work_days.push(
		...Array.from({ length: 31 }, (_, index) => {
			const date = `2026-03-${String(index + 1).padStart(2, '0')}`;
			return {
				...roster,
				id: `next-${date}`,
				work_date: date,
				worked_intervals: [{ start: `${date}T07:30:00+08:00`, end: `${date}T16:30:00+08:00` }]
			};
		})
	);
	assert.equal(
		paidFor((await build(world, '2026-03-1')).built),
		48.39,
		'a standing allowance is due again next month: 15/31 of it in the first half'
	);
});
