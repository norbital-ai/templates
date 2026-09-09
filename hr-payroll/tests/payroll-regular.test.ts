import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import hooks from '../src/collections/payroll_runs/+hooks.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { adjust, capturesOf, release, settle } from './helpers/settlement.ts';

test('a run reads only the catalogue of the version it picked, never a sibling version’s', async () => {
	const world = createPublicPayrollWorld();
	const prepare = () =>
		Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	const expected = buildPayrollRun(await prepare()).payslip_payroll_run;
	const basic = world.work_catalogue[0];
	assert.ok(basic);
	// Two more versions of the lineage (a draft and a voided one) carry their own BASIC clones;
	// the picked version's catalogue is the only one the run prices.
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
	world.work_catalogue.push(
		{ ...structuredClone(basic), id: 'other-basic-1', settings_id: 'other-settings-1' },
		{ ...structuredClone(basic), id: 'other-basic-2', settings_id: 'other-settings-2' }
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
		lifecycle: 'DRAFT'
	});
	const existing = {
		id: 'next',
		company_id: COMPANY_ID,
		period: '2026-02',
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

function attendedWorld(options: Parameters<typeof createPublicPayrollWorld>[0] = {}) {
	const world = createPublicPayrollWorld(options);
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
		day.break_minutes = 60;
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

test('late requests settle once, including corrections, while recurring allowances repeat', async () => {
	const world = attendedWorld({ includePayment: true });
	const payment = world.payment_requests[0];
	const first = await build(world);
	assert.deepEqual(first.captured.payments, [payment.id]);
	settle(world, 'payment_requests', payment.id, 'paid-slip');
	const next = await build(world);
	assert.equal(next.captured.payments.length, 0);
	assert.equal(
		next.prepared.gathered.bundles[0].payRequests.find((row) => row.id === payment.id)?.captured,
		true
	);
	assert.equal(next.slip.payslip_allowance_request_input_payslip.length, 1);
	payment.as_adjustment_entry = true;
	assert.equal((await build(world)).captured.payments.length, 0);
	release(world, 'payment_requests');
	assert.equal((await build(world)).captured.payments.length, 1);
	payment.pay_period = '2026-03';
	assert.equal((await build(world)).captured.payments.length, 0);
	payment.pay_period = '2026-01';
	payment.approval_id = 'pending';
	assert.equal((await build(world)).captured.payments.length, 0);
});

test('late one-off allowances retain source-month proration', async () => {
	const world = attendedWorld();
	world.employments[0].hire_date = '2026-01-16';
	world.employments[0].effective_range = { start: '2026-01-16', end: null };
	world.allowance_requests[0].recurrence = { kind: 'ONE_OFF', period: '2026-01' };
	const { slip } = await build(world);
	const row = slip.adjustments.find((row) => row.family === 'ALLOWANCE');
	assert.equal(row.amount, 160);
	world.payslip_allowance_request_inputs.push({
		allowance_request_id: world.allowance_requests[0].id,
		payslip_id: 'paid-slip'
	});
	assert.equal((await build(world)).slip.payslip_allowance_request_input_payslip.length, 0);
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
			day.break_minutes = 0;
			const catalogueId = '00000000-0000-4000-8000-000000000001';
			world.leave_catalogue.push({
				id: catalogueId,
				settings_id: world.jurisdiction_settings[0].id,
				code: 'TEST_LEAVE',
				name: 'Test leave',
				is_statutory: false,
				eligibility: '',
				approval_id: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				requires_certificate_after_days: null,
				paid,
				treatments: {}
			});
			world.leave_entries.push({
				id: '00000000-0000-4000-8000-000000000002',
				employment_id: terms.employment_id,
				leave_catalogue_id: catalogueId,
				leave_code: 'TEST_LEAVE',
				reference: 'TEST-LEAVE',
				approval_id: null,
				event: {
					kind: 'TIME_OFF',
					range: {
						start: { date: '2026-01-05', half: 'FIRST' },
						end: { date: '2026-01-05', half: 'SECOND' }
					},
					chargeable_days: 1,
					reason: 'Test'
				},
				allocations: [],
				charges: [
					{
						date: '2026-01-05',
						days: 1,
						leave_catalogue_id: catalogueId,
						employment_term_id: terms.id,
						holiday_id: null,
						shift_definition_id: day.shift_definition_id,
						work_day_id: day.id
					}
				]
			});
			const { slip } = await build(world, '2026-01');
			assert.equal(
				slip.base.find((row) => row.component_code === 'BASIC').amount,
				regular.base.find((row) => row.component_code === 'BASIC').amount
			);
			assert.equal(slip.gross, regular.gross - (paid ? 0 : 80));
			assert.equal(slip.payslip_leave_input_payslip.length, 1);
			assert.equal(slip.payslip_leave_input_payslip[0].gross_amount.value, paid ? 0 : -80);
		});
	}
}

test('single-use recoveries cannot be silently reduced or leave a negative payslip', async () => {
	const world = attendedWorld({ includePayment: true });
	world.payment_requests[0].as_adjustment_entry = true;
	world.payment_requests[0].amount = 100000;
	await assert.rejects(build(world), /net pay is negative/);
	world.payment_catalogue[0].nature = 'DEDUCTION';
	world.payment_requests[0].as_adjustment_entry = false;
	await assert.rejects(build(world), /net pay is negative/);
});

test('captured siblings still count against the annual request cap', async () => {
	const world = attendedWorld({ includePayment: true });
	const first = world.payment_requests[0];
	world.payment_requests.push({
		...first,
		id: 'later-payment',
		effective_on: '2026-02-05',
		pay_period: '2026-02'
	});
	settle(world, 'payment_requests', first.id, 'prior-slip', '2026-01');
	adjust(world, 'prior-slip', { family: 'PAYMENT', source_id: first.id, amount: 100 });
	world.payment_catalogue[0].cap = {
		period: 'CALENDAR_YEAR',
		on_exceed: 'BLOCK',
		bands: [{ eligibility: '', amount: 150 }]
	};
	await assert.rejects(build(world), /entitlement exceeded/);
	world.payment_requests[1].amount = 50;
	assert.equal((await build(world)).captured.payments.length, 1);
});

test('loan recovery reduces to available net and keeps the unrecovered balance at its source', async () => {
	const world = attendedWorld();
	const before = (await build(world)).slip;
	world.loan_catalogue.push({
		...world.payment_catalogue[0],
		id: 'loan-type',
		code: 'LOAN'
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
	const { slip } = await build(world);
	const recovery = slip.adjustments.find((row) => row.family === 'LOAN_REPAYMENT');
	assert.equal(recovery.amount, before.net);
	assert.equal(slip.net, 0);
	assert.equal(world.loan_repayments[0].amount_due, 10000);
});

test('deferred joining wages do not pay the same late manual request twice', async () => {
	const world = attendedWorld({ includePayment: true });
	world.employments[0].hire_date = '2026-01-25';
	world.employments[0].effective_range = { start: '2026-01-25', end: null };
	world.payment_requests[0].effective_on = '2026-01-25';
	const withPayment = (await build(world)).slip.gross;
	world.payment_requests.length = 0;
	const withoutPayment = (await build(world)).slip.gross;
	assert.equal(withPayment - withoutPayment, 100);
});

test('ended contracts settle approved Payment and Claim once without reviving Work or recurring allowances', async () => {
	const world = attendedWorld({ includePayment: true });
	world.employments[0].effective_range = { start: '2021-06-01', end: '2026-01-31' };
	world.employment_terms[0].effective_range = { start: '2021-06-01', end: '2026-01-31' };
	world.payment_requests[0].effective_on = '2026-02-01';
	world.payment_requests[0].pay_period = '2026-02';
	world.payment_requests[0].reason = 'Reviewed separation package';
	world.claim_catalogue.push({ ...world.payment_catalogue[0], id: 'expense', code: 'EXPENSE' });
	world.claim_requests.push({
		id: 'receipt',
		employment_id: world.employments[0].id,
		claim_catalogue_id: 'expense',
		amount: 25,
		incurred_on: '2026-01-15',
		approval_id: null
	});
	const { slip, captured } = await build(world);
	assert.equal(slip.gross, 125);
	assert.deepEqual(slip.base, []);
	assert.deepEqual(slip.proration, []);
	assert.equal(captured.workDays.length, 0);
	assert.equal(slip.payslip_allowance_request_input_payslip.length, 0);
	assert.equal(captured.payments.length, 1);
	assert.equal(captured.claims.length, 1);
	settle(world, 'payment_requests', world.payment_requests[0].id, 'paid');
	settle(world, 'claim_requests', 'receipt', 'paid');
	assert.equal((await build(world, '2026-03')).slip, undefined);
});

test('pending and future Payment obligations do not select an ended contract', async () => {
	const world = attendedWorld({ includePayment: true });
	world.employments[0].effective_range = { start: '2021-06-01', end: '2026-01-31' };
	world.payment_requests[0].approval_id = 'pending';
	assert.equal((await build(world)).slip, undefined);
	world.payment_requests[0].approval_id = null;
	world.payment_requests[0].pay_period = '2026-03';
	assert.equal((await build(world)).slip, undefined);
	assert.equal((await build(world, '2026-03')).slip.gross, 100);
});

for (const family of ['payment', 'claim', 'allowance']) {
	test(`late ${family} retains the catalogue definition from its sealed source revision`, async () => {
		const world = attendedWorld({ includePayment: family === 'payment' });
		world.allowance_requests = family === 'allowance' ? world.allowance_requests : [];
		if (family === 'claim') {
			world.claim_catalogue.push({
				...world.payment_catalogue[0],
				id: 'claim-type',
				code: 'EXPENSE'
			});
			world.claim_requests.push({
				id: 'old-receipt',
				employment_id: world.employments[0].id,
				claim_catalogue_id: 'claim-type',
				amount: 100,
				incurred_on: '2026-01-15',
				approval_id: null
			});
		}
		if (family === 'allowance') {
			world.allowance_requests[0].recurrence = { kind: 'ONE_OFF', period: '2026-01' };
			world.allowance_requests[0].amount = 100;
		}
		const source = world[`${family}_catalogue`][0];
		const sourceSettings = world.jurisdiction_settings[0];
		sourceSettings.effective_range = { start: '2020-01-01', end: '2026-02-01' };
		const currentSettings = {
			...sourceSettings,
			id: 'current-settings',
			effective_range: { start: '2026-02-01', end: null }
		};
		world.jurisdiction_settings.push(currentSettings);
		world.work_catalogue.push({
			...world.work_catalogue[0],
			id: 'current-work',
			settings_id: currentSettings.id
		});
		world[`${family}_catalogue`].push({
			...source,
			id: 'current-family-item',
			settings_id: currentSettings.id,
			nature: 'DEDUCTION'
		});
		const { slip, prepared } = await build(world);
		const output = slip.adjustments.find((row) => row.family === family.toUpperCase());
		assert.equal(output.amount, 100);
		assert.equal(output.bucket, 'EARNING');
		const request = prepared.gathered.bundles[0].payRequests.find(
			(row) => row.family === family.toUpperCase()
		);
		assert.equal(request.catalogueComponent.settings_id, sourceSettings.id);
		assert.equal(prepared.configuration.jurisdiction.id, currentSettings.id);
	});
}
