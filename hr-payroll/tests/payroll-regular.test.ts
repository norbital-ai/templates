import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import payrollRuns from '../src/collections/payroll_runs/+collection.ts';
import payslips from '../src/collections/payslips/+collection.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { adjust, capturesOf, release, settle } from './helpers/settlement.ts';
import { admitPayRequests } from '../src/lib/pay_request_rules.ts';
import { transform } from './helpers/transform.ts';
import { assignAllowance, clearAllowances } from './fixtures/contract-allowances.ts';

test('a run reads only the catalogue of the version it picked, never a sibling version’s', async () => {
	const world = createPublicPayrollWorld();
	const prepare = () =>
		Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	const expected = buildPayrollRun(await prepare()).payslip_payroll_run;
	// Two more versions of the lineage (a draft and a voided one) carry their own work rules;
	// the picked version's root is the only one the run prices.
	world.jurisdiction_settings.push(
		{
			...structuredClone(world.jurisdiction_settings[0]),
			id: 'other-settings-1',
			name: 'PF draft',
			sealed_at: null
		},
		{
			...structuredClone(world.jurisdiction_settings[0]),
			id: 'other-settings-2',
			name: 'PF voided',
			voided_at: '2025-12-31T00:00:00.000Z',
			void_reason: 'superseded'
		}
	);
	const actual = buildPayrollRun(await prepare()).payslip_payroll_run;
	assert.equal(actual[0].gross, expected[0].gross);
	assert.deepEqual(actual[0].base, expected[0].base);
	assert.deepEqual(actual[0].proration, expected[0].proration);
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
		assert.equal(await base(), scheduled - 20);
		day.worked_intervals = [];
		assert.equal(await base(), scheduled - 80);
		day.worked_intervals = null;
		assert.equal(await base(), scheduled);
	});
}

test('paying a slip rechecks the person’s earlier periods, and a run cannot silently recalculate', async () => {
	const world = createPublicPayrollWorld();
	world.payroll_runs.push(
		{ id: 'prior', company_id: COMPANY_ID, period: '2026-01', approval_id: null },
		{ id: 'next', company_id: COMPANY_ID, period: '2026-02', approval_id: null }
	);
	const januarySlip = {
		id: 'jan-slip',
		payroll_run_id: 'prior',
		employment_id: 'emp-1',
		status: 'DRAFT',
		paid_at: null,
		approval_id: null
	};
	const februarySlip = {
		id: 'feb-slip',
		payroll_run_id: 'next',
		employment_id: 'emp-1',
		status: 'DRAFT',
		paid_at: null,
		approval_id: null
	};
	world.payslips.push(januarySlip, februarySlip);
	const api = memoryPayrollApi(world);

	// Payment is per slip and in order per person: January still standing refuses February by name.
	const pay = () =>
		transform(payslips, [{ status: 'PAID', paid_at: '2026-02-28' }], {
			existing: [februarySlip],
			db: api.db
		});
	await assert.rejects(pay(), /still unpaid/);
	januarySlip.status = 'PAID';
	januarySlip.paid_at = '2026-01-28';
	await pay();

	// The run itself has no writable column: payment is recorded on the slips, never through it.
	assert.equal(payrollRuns.update, undefined, 'a run is frozen once built: no update endpoint');
});

function attendedWorld(options: Parameters<typeof createPublicPayrollWorld>[0] = {}) {
	const world = createPublicPayrollWorld(options);
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	}
	return world;
}

const build = async (world: ReturnType<typeof createPublicPayrollWorld>, period = '2026-02') => {
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
	);
	const built = buildPayrollRun(prepared);
	const slip = built.payslip_payroll_run[0];
	return { prepared, built, slip, captured: capturesOf(built, slip) };
};

/** A base line's amount on a payslip, or undefined where the payslip carries none of that code. */
const baseOf = (
	slip: { base: readonly { component_code: string; amount: number }[] },
	code: string
) => slip.base.find((row) => row.component_code === code)?.amount;

test('an allowance on the contract is a base line every period; a one-off is an ad hoc request settled once', async () => {
	const world = attendedWorld({ includePayment: true });
	const once = world.adhoc_requests![0]!;
	const january = await build(world, '2026-01');
	// The allowance is the contract's money: a base line, prorated over the same calendar as the
	// salary, and its working stored beside the salary's.
	assert.equal(baseOf(january.slip, 'TRANSPORT'), 310);
	assert.deepEqual(
		january.slip.proration
			.filter((segment) => segment.component_code === 'TRANSPORT')
			.map((segment) => [segment.from, segment.to, segment.days, segment.denominator]),
		[['2026-01-01', '2026-01-31', 31, 31]]
	);
	// The bonus is an ad hoc request: an adjustment naming it, pinned once.
	assert.ok(january.slip.adjustments.some((row) => row.source_id === once.id));
	assert.deepEqual(january.captured.adhoc, [once.id]);
	settle(world, 'adhoc_requests', once.id, 'paid');
	const february = await build(world);
	assert.equal(baseOf(february.slip, 'TRANSPORT'), 310);
	assert.equal(
		february.slip.adjustments.some((row) => row.source_id === once.id),
		false,
		'a request settled in January is not priced in February'
	);
	// Removing the allowance from the contract removes the line from every cycle built after.
	clearAllowances(world);
	assert.equal(baseOf((await build(world)).slip, 'TRANSPORT'), undefined);
	assert.equal(
		(await build(world)).slip.proration.some((segment) => segment.component_code === 'TRANSPORT'),
		false
	);
});

test('an allowance prorates on the same basis as basic salary: a joiner takes the covered days', async () => {
	const world = attendedWorld();
	world.employments[0].effective_range = { start: '2026-02-16', end: null };
	for (const terms of world.employment_terms)
		if (
			String(terms.effective_range.start) < '2026-02-16' &&
			String(terms.effective_range.end ?? '9999') >= '2026-02-16'
		)
			terms.effective_range = { ...terms.effective_range, start: '2026-02-16' };
	const { slip } = await build(world);
	const basic = slip.proration.find((segment) => segment.component_code === 'BASIC')!;
	const transport = slip.proration.find((segment) => segment.component_code === 'TRANSPORT')!;
	assert.deepEqual(
		[transport.from, transport.to, transport.days, transport.denominator],
		[basic.from, basic.to, basic.days, basic.denominator]
	);
	assert.deepEqual([transport.days, transport.denominator], [13, 28]);
	assert.equal(transport.prorated_amount, Math.round(((310 * 13) / 28) * 100) / 100);
	assert.equal(baseOf(slip, 'TRANSPORT'), transport.prorated_amount);
});

test('a terms change mid-period prices an allowance as two segments that add up to the month', async () => {
	const world = attendedWorld();
	// The transport allowance rises from 310 to 400 on the 16th: two terms rows, two segments.
	assignAllowance(world, {
		employment_id: world.employments[0].id,
		catalogue_id: world.allowance_catalogue[0].id,
		amount: 400,
		effective_from: '2026-02-16',
		effective_to: '2026-03-31'
	});
	const { slip } = await build(world);
	const segments = slip.proration.filter((segment) => segment.component_code === 'TRANSPORT');
	assert.deepEqual(
		segments.map((segment) => [segment.from, segment.to, segment.contract_amount]),
		[
			['2026-02-01', '2026-02-15', 310],
			['2026-02-16', '2026-02-28', 400]
		]
	);
	const expected = Math.round(((310 * 15) / 28 + (400 * 13) / 28) * 100) / 100;
	assert.equal(baseOf(slip, 'TRANSPORT'), expected);
	assert.equal(
		Math.round(segments.reduce((total, segment) => total + segment.prorated_amount, 0) * 100) / 100,
		expected,
		'the segments sum to the line'
	);
});

for (const frequency of ['DAILY', 'HOURLY']) {
	for (const paid of [true, false]) {
		test(`${frequency} ${paid ? 'paid' : 'unpaid'} leave preserves covered units with exactly one deduction`, async () => {
			const world = createPublicPayrollWorld();
			const terms = world.employment_terms[0];
			terms.pay_frequency = frequency;
			terms.base_salary = { currency: 'MYR', value: frequency === 'DAILY' ? 80 : 10 };
			const day = world.work_days.find((row) => row.work_date === '2026-01-05');
			const regular = (await build(world, '2026-01')).slip;
			day.worked_intervals = [];
			const catalogueId = '00000000-0000-4000-8000-000000000001';
			world.leave_catalogue.push({
				id: catalogueId,
				settings_id: world.jurisdiction_settings[0].id,
				code: 'TEST_LEAVE',
				name: 'Test leave',
				eligibility: '',
				approval_id: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				evidence_after_days: null,
				is_npl: !paid,
				can_encash: true,
				evidence: 'NONE',
				bands: [{ when: '', amount: 'entry.amount', limit: null }]
			});
			world.leave_entries.push({
				id: '00000000-0000-4000-8000-000000000002',
				employment_id: terms.employment_id,
				catalogue_id: catalogueId,
				leave_code: 'TEST_LEAVE',
				reference: 'TEST-LEAVE',
				approval_id: null,
				from_date: '2026-01-05',
				to_date: '2026-01-05',
				half_day_start: false,
				half_day_end: false,
				days: 1,
				effective_on: '2026-01-05',
				reason: 'Test',
				allocations: [],
				charges: [
					{
						date: '2026-01-05',
						days: 1,
						catalogue_id: catalogueId,
						employment_term_id: terms.id,
						holiday_id: null,
						shift_definition_id: day.shift_definition_id,
						work_day_id: day.id
					}
				]
			});
			const { slip, captured } = await build(world, '2026-01');
			assert.equal(
				slip.base.find((row) => row.component_code === 'BASIC').amount,
				regular.base.find((row) => row.component_code === 'BASIC').amount
			);
			assert.equal(slip.gross, regular.gross - (paid ? 0 : 80));
			assert.deepEqual(captured.leave, ['00000000-0000-4000-8000-000000000002']);
			const deduction = slip.adjustments.find((row) => row.family === 'LEAVE');
			assert.equal(deduction?.bucket, paid ? undefined : 'ABSENCE');
			assert.equal(deduction?.amount ?? 0, paid ? 0 : 80);
		});
	}
}

test('a deduction net pay cannot carry refuses the run rather than reducing itself', async () => {
	const world = attendedWorld({ includePayment: true });
	const once = world.adhoc_requests![0]!;
	once.as_adjustment_entry = true;
	once.amount = 100000;
	await assert.rejects(build(world, '2026-01'), /net pay is negative/);
	world.adhoc_catalogue![0].destination = 'NET';
	world.adhoc_catalogue![0].direction = 'SUBTRACT';
	once.as_adjustment_entry = false;
	await assert.rejects(build(world, '2026-01'), /net pay is negative/);
});

test('a loan recovery net pay cannot carry is dropped whole, unpinned and named', async () => {
	const world = attendedWorld();
	const before = await build(world);
	world.loan_catalogue.push({
		...world.allowance_catalogue[0],
		id: 'loan-type',
		code: 'LOAN',
		destination: 'NET',
		direction: 'SUBTRACT'
	});
	world.loans.push({
		id: 'loan',
		employment_id: world.employments[0].id,
		loan_catalogue_id: 'loan-type',
		approval_id: null
	});
	world.loan_repayments.push({
		id: 'repayment',
		loan_id: 'loan',
		due_date: '2026-01-15',
		amount_due: 10000,
		sequence: 1,
		approval_id: null
	});
	const { built, slip, captured } = await build(world);
	assert.equal(
		slip.adjustments.find((row) => row.family === 'LOAN_REPAYMENT'),
		undefined,
		'no partial recovery: the instalment is dropped whole'
	);
	assert.equal(slip.net, before.slip.net);
	assert.deepEqual(captured.loanRepayments, [], 'a dropped recovery pins nothing');
	assert.ok(built.warnings.some((warning) => warning.includes('LOAN_REPAYMENT_SHORT')));
	assert.equal(world.loan_repayments[0].amount_due, 10000);
});

test('deferred joining wages carry the allowances of the deferred period, prorated', async () => {
	const world = attendedWorld();
	world.employments[0].effective_range = { start: '2026-01-25', end: null };
	const withAllowance = (await build(world)).slip.gross;
	clearAllowances(world);
	const withoutAllowance = (await build(world)).slip.gross;
	const owed = withAllowance - withoutAllowance;
	// January's covered days (7 of 31 at 310) beside February's whole month.
	assert.equal(owed, Math.round(((310 * 7) / 31) * 100) / 100 + 310);
});

test('ended contracts settle approved claims once, without reviving Work or the allowances that ended with them', async () => {
	const world = attendedWorld({ includePayment: true });
	world.employments[0].effective_range = { start: '2021-06-01', end: '2026-01-31' };
	for (const terms of world.employment_terms)
		if (String(terms.effective_range.end ?? '9999') > '2026-01-31')
			terms.effective_range = { ...terms.effective_range, end: '2026-01-31' };
	world.claim_catalogue.push({ ...world.allowance_catalogue[0], id: 'expense', code: 'EXPENSE' });
	world.claim_requests.push({
		id: 'receipt',
		employment_id: world.employments[0].id,
		catalogue_id: 'expense',
		amount: 25,
		incurred_on: '2026-01-15',
		approval_id: null
	});
	settle(world, 'adhoc_requests', world.adhoc_requests![0]!.id, 'paid');
	const { slip, captured } = await build(world);
	assert.equal(slip.gross, 25);
	assert.deepEqual(slip.base, [], 'an allowance ended with the contract');
	assert.deepEqual(slip.proration, []);
	assert.equal(captured.workDays.length, 0);
	assert.equal(captured.claims.length, 1);
	settle(world, 'claim_requests', 'receipt', 'paid');
	assert.equal((await build(world, '2026-03')).slip, undefined);
});

test('a pending ad hoc request, or one due later, does not select an ended contract', async () => {
	const world = attendedWorld({ includePayment: true });
	world.employments[0].effective_range = { start: '2021-06-01', end: '2026-01-31' };
	const once = world.adhoc_requests![0]!;
	once.approval_id = 'pending';
	assert.equal((await build(world)).slip, undefined);
	once.approval_id = null;
	once.event_date = '2026-03-10';
	assert.equal((await build(world)).slip, undefined);
});

test('a claim retains the catalogue definition from its sealed source revision', async () => {
	const world = attendedWorld();
	clearAllowances(world);
	world.claim_catalogue.push({
		...world.allowance_catalogue[0],
		id: 'claim-type',
		code: 'EXPENSE'
	});
	world.claim_requests.push({
		id: 'old-receipt',
		employment_id: world.employments[0].id,
		catalogue_id: 'claim-type',
		amount: 100,
		incurred_on: '2026-01-15',
		approval_id: null
	});
	const source = world.claim_catalogue[0];
	const sourceSettings = world.jurisdiction_settings[0];
	sourceSettings.effective_range = { start: '2020-01-01', end: '2026-02-01' };
	const currentSettings = {
		...sourceSettings,
		id: 'current-settings',
		effective_range: { start: '2026-02-01', end: null }
	};
	world.jurisdiction_settings.push(currentSettings);
	world.claim_catalogue.push({
		...source,
		id: 'current-family-item',
		settings_id: currentSettings.id
	});
	const { slip, prepared } = await build(world);
	const output = slip.adjustments.find((row) => row.family === 'CLAIM');
	assert.equal(output.amount, 100);
	assert.equal(output.bucket, 'EARNING');
	const request = prepared.gathered.bundles[0].payRequests.find((row) => row.family === 'CLAIM');
	assert.equal(request.catalogueComponent.settings_id, sourceSettings.id);
	assert.equal(prepared.configuration.jurisdiction.id, currentSettings.id);
});
