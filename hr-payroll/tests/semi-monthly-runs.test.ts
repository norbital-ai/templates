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
	SEMI_MONTHLY_EMPLOYMENT_ID,
	createSemiMonthlyPayrollWorld
} from './fixtures/semi-monthly-payroll-world.ts';

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
		lifecycle: 'PAID',
		sequence: 0,
		pay_date: prepared.window.payDate,
		attendance_from: prepared.window.attendance.start,
		attendance_to: prepared.window.attendance.end,
		approval_id: null
	});
	for (const slip of built.payslip_payroll_run) {
		world.payslips.push({ ...slip, payroll_run_id: runId, approval_id: null });
		world.payslip_allowance_request_inputs.push(
			...slip.payslip_allowance_request_input_payslip.map((row) => ({
				...row,
				payslip_id: slip.id
			}))
		);
		const captured = capturesOf(built, slip);
		for (const id of captured.claims) settleSource(world, 'claim_requests', id, slip.id, period);
		for (const id of captured.payments)
			settleSource(world, 'payment_requests', id, slip.id, period);
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

test('half 1 pays only the semi-monthly employment, for the 1st to the 15th, on the 15th', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const { prepared, built } = await build(world, '2026-02-1');
	assert.deepEqual(prepared.window.attendance, { start: '2026-02-01', end: '2026-02-15' });
	assert.equal(prepared.window.payDate, '2026-02-15');
	assert.equal(built.payslipCount, 1, 'the monthly employment is not in the first half');
	assert.equal(slipOf(built, MONTHLY_EMPLOYMENT_ID), null);
	const slip = slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID);
	assert.deepEqual(
		slip.proration.map((segment) => [segment.from, segment.to, segment.days, segment.denominator]),
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
		semi.proration.map((segment) => [segment.from, segment.to, segment.days, segment.denominator]),
		[['2026-02-16', '2026-02-28', 13, 28]]
	);
	const monthly = slipOf(built, MONTHLY_EMPLOYMENT_ID);
	assert.deepEqual(
		monthly.proration.map((segment) => [
			segment.from,
			segment.to,
			segment.days,
			segment.denominator
		]),
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
		world.work_catalogue[0].proration = proration;
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

test('a one-off entry settles in the half its day falls in, for a semi-monthly employment', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const transport = world.payment_catalogue.find((component) => component.code === 'TRANSPORT');
	const entry = (id, eventDate) => ({
		id,
		employment_id: SEMI_MONTHLY_EMPLOYMENT_ID,
		payment_catalogue_id: transport.id,
		amount: 100,
		effective_on: eventDate,
		pay_period: null,
		reason: eventDate,
		approval_id: null
	});
	world.payment_requests.push(
		entry('payment-on-the-15th', '2026-02-15'),
		entry('payment-on-the-16th', '2026-02-16')
	);
	const first = await build(world, '2026-02-1');
	settle(world, '2026-02-1', first.prepared, first.built);
	const second = await build(world, '2026-02-2');
	const captured = (built) => capturesOf(built, slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID)).payments;
	assert.deepEqual(captured(first.built), ['payment-on-the-15th']);
	assert.deepEqual(captured(second.built), ['payment-on-the-16th']);
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
test('the tax projection over twenty-four half payslips lands where twelve monthly ones did', async () => {
	const world = createSemiMonthlyPayrollWorld();
	world.employment_terms[0].base_salary = { value: SEMI_MONTHLY_BASE, currency: 'MYR' };
	world.payment_requests.length = 0;
	world.allowance_requests.length = 0;
	world.statutory_contributions.push({
		id: 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa9',
		settings_id: JURISDICTION_ID,
		is_statutory: true,
		code: 'PUB-TAX',
		name: 'Public fixture withholding',
		authority: 'Public fixture',
		rounding: 'NEAREST_CENT',
		relief_for: [],
		sequence: 2,
		special_rules: [],
		approval_id: null
	});
	const band = (from, to, rate, constant) => ({
		selector: { by: 'WAGE', from, to },
		award: { kind: 'PROGRESSIVE', rate, constant }
	});
	world.statutory_contributions.at(-1)!.bands = [
		band(0, 20_000, 0, 0),
		band(20_000, 35_000, 1, 0),
		band(35_000, 50_000, 3, 150),
		band(50_000, null, 8, 600)
	];
	for (const catalogue of [
		world.claim_catalogue,
		world.allowance_catalogue,
		world.payment_catalogue,
		world.loan_catalogue
	])
		for (const component of catalogue)
			component.contribution_treatments = {
				'PUB-EPF': { kind: 'INCLUDE' },
				'PUB-TAX': { kind: 'INCLUDE' }
			};
	for (const work of world.work_catalogue)
		work.treatments = Object.fromEntries(
			['PUB-EPF', 'PUB-TAX'].map((code) => [
				code,
				{
					salary: { kind: 'INCLUDE' },
					overtime: { kind: 'INCLUDE' },
					overtime_excess: { kind: 'INCLUDE' },
					absence: { kind: 'REDUCE' }
				}
			])
		);

	const tax = (slip) => slip.statutory.find((line) => line.scheme_code === 'PUB-TAX');

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
 * A one-off Allowance becomes due when its source month ends. The regular second-half run
 * settles its full source-month entitlement once; the capture excludes it from later runs.
 */
test('an allowance is paid once across a semi-monthly month, not once per half', async () => {
	const world = createSemiMonthlyPayrollWorld();
	const transport = world.allowance_catalogue.find((component) => component.code === 'TRANSPORT');
	assert.ok(transport, 'the semi-monthly world offers a component that takes entries');
	const ONE_OFF_ID = 'once-in-february';
	world.allowance_requests.push({
		id: ONE_OFF_ID,
		employment_id: SEMI_MONTHLY_EMPLOYMENT_ID,
		allowance_catalogue_id: transport.id,
		amount: 100,
		pay_period: null,
		recurrence: { kind: 'ONE_OFF', period: '2026-02' },
		approval_id: null
	});

	const firstHalf = await build(world, '2026-02-1');
	settle(world, '2026-02-1', firstHalf.prepared, firstHalf.built);
	const secondHalf = await build(world, '2026-02-2');

	/**
	 * An adjustment names the *capture* it was priced from, not the entry, so the entry is reached
	 * through the junction the same run produced.
	 */
	const paidFor = (built, entryId) =>
		slipOf(built, SEMI_MONTHLY_EMPLOYMENT_ID)
			.adjustments.filter((row) => row.family === 'ALLOWANCE' && row.source_id === entryId)
			.reduce((total, row) => total + Number(row.amount), 0);

	const first = paidFor(firstHalf.built, ONE_OFF_ID);
	const second = paidFor(secondHalf.built, ONE_OFF_ID);
	assert.equal(first, 0, 'the source month has not ended in the first half');
	assert.equal(second, 100, 'the second half settles the complete source-month amount');
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
		paidFor((await build(world, '2026-03-1')).built, ONE_OFF_ID),
		0,
		'the captured one-off is not paid again'
	);
});
