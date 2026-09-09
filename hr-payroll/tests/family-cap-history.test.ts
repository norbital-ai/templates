import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { assertPayRequestAdmissible, type PayRequestGuard } from '../src/lib/pay_request_hooks.ts';
import { payRequestTerms } from '../src/lib/component_entry_cap_subject.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { adjust, capturesOf, settle } from './helpers/settlement.ts';

type Family = 'claim' | 'payment' | 'allowance';
const periodCap = (amount = 1000, eligibility = '') => ({
	period: 'CALENDAR_YEAR',
	on_exceed: 'BLOCK',
	bands: [{ eligibility, amount }]
});

function capWorld(family: Family) {
	const world = createPublicPayrollWorld();
	world.allowance_requests = [];
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
		day.break_minutes = 60;
	}
	const oldSettings = world.jurisdiction_settings[0];
	world.jurisdiction_settings.push({
		...structuredClone(oldSettings),
		id: 'new-settings',
		effective_range: { start: '2026-02-01', end: null }
	});
	oldSettings.effective_range = { start: '2020-01-01', end: '2026-02-01' };
	world.work_catalogue.push({
		...structuredClone(world.work_catalogue[0]),
		id: 'new-work',
		settings_id: 'new-settings'
	});
	const source = {
		...structuredClone(world.payment_catalogue[0]),
		id: 'old-catalogue',
		code: 'BENEFIT',
		cap: periodCap()
	};
	world[`${family}_catalogue`] = [
		source,
		{ ...structuredClone(source), id: 'new-catalogue', settings_id: 'new-settings' }
	];
	const request = (id: string, catalogueId: string, amount: number, month: string) => ({
		id,
		employment_id: EMPLOYMENT_ID,
		[`${family}_catalogue_id`]: catalogueId,
		amount,
		incurred_on: `${month}-05`,
		effective_on: `${month}-05`,
		recurrence: { kind: 'ONE_OFF', period: month },
		reason: 'Synthetic benefit request',
		approval_id: null,
		as_adjustment_entry: false
	});
	const prior = request('prior', 'old-catalogue', 800, '2026-01');
	const candidate = request('candidate', 'new-catalogue', 200, '2026-02');
	world[`${family}_requests`].push(prior);
	return { world, prior, candidate, request };
}

const guardFor = (family: Family): PayRequestGuard => ({
	family: family.toUpperCase() as PayRequestGuard['family'],
	noun: family,
	eventDate: (row) =>
		family === 'allowance'
			? `${(row.recurrence as { period: string }).period}-01`
			: String(row[family === 'claim' ? 'incurred_on' : 'effective_on'])
});

const admit = (family: Family, world: PayrollWorld, candidate: Record<string, unknown>) =>
	Effect.runPromise(
		assertPayRequestAdmissible(guardFor(family), {
			api: memoryPayrollApi(world) as never,
			input: candidate,
			existing: undefined
		})
	);
const build = async (world: PayrollWorld, period = '2026-02') =>
	buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({
				api: memoryPayrollApi(world) as never,
				companyId: COMPANY_ID,
				period
			})
		)
	);

for (const family of ['claim', 'payment', 'allowance'] as const) {
	test(`${family} cap spans catalogue revisions of the same code`, async () => {
		const { world, candidate } = capWorld(family);
		await admit(family, world, candidate); // 800 under the old revision + 200 = 1,000.
		await assert.rejects(
			admit(family, world, { ...candidate, amount: 201 }),
			/1001\.00 requested against 1000\.00/
		);
		world[`${family}_requests`].push(candidate);
		const result = await build(world);
		const outputs = result.payslip_payroll_run[0].adjustments.filter(
			(row) => row.label === 'BENEFIT'
		);
		assert.deepEqual(
			outputs.map((row) => row.amount).sort((a, b) => a - b),
			[200, 800]
		);
		candidate.amount = 201;
		await assert.rejects(build(world), /1001\.00 requested against 1000\.00/);
	});
}

test('two bands that differ by grade: the tier is read off the terms in force on the event date', async () => {
	const { world, candidate } = capWorld('claim');
	for (const catalogue of world.claim_catalogue)
		catalogue.cap = {
			period: 'CALENDAR_YEAR',
			on_exceed: 'BLOCK',
			bands: [
				{ eligibility: 'terms.grade == "G3"', amount: 2000 },
				{ eligibility: '', amount: 1000 }
			]
		};
	await assert.rejects(
		admit('claim', world, { ...candidate, amount: 201 }),
		/1001\.00 requested against 1000\.00/
	);
	world.employment_terms[0].grade = 'G3';
	await admit('claim', world, { ...candidate, amount: 1200 });
	await assert.rejects(
		admit('claim', world, { ...candidate, amount: 1201 }),
		/2001\.00 requested against 2000\.00/
	);
});

test('a person no band covers is refused at the request and paid nothing by the run', async () => {
	const { world, candidate } = capWorld('claim');
	for (const catalogue of world.claim_catalogue)
		catalogue.cap = periodCap(2000, 'terms.grade == "G3"');
	await assert.rejects(admit('claim', world, candidate), /BENEFIT has no entitlement band/);
	world.claim_requests.push(candidate);
	const result = await build(world);
	const slip = result.payslip_payroll_run[0];
	assert.equal(
		slip.adjustments.some((row) => row.label === 'BENEFIT'),
		false
	);
	assert.equal(capturesOf(result, slip).claims.length, 2, 'read and captured, priced at nothing');
});

test('prior source eligibility uses its own event date and contract terms', async () => {
	const { world, candidate } = capWorld('claim');
	const originalTerms = world.employment_terms[0];
	originalTerms.department = 'OPERATIONS';
	originalTerms.effective_range = { start: '2020-01-01', end: '2026-01-31' };
	world.employment_terms.push({
		...structuredClone(originalTerms),
		id: 'new-terms',
		department: 'SALES',
		effective_range: { start: '2026-02-01', end: null }
	});
	world.claim_catalogue[0].eligibility = "terms.department == 'OPERATIONS'";
	await assert.rejects(admit('claim', world, { ...candidate, amount: 201 }), /1001\.00 requested/);
	world.claim_requests.push({ ...candidate, amount: 201 });
	await assert.rejects(build(world), /1001\.00 requested/);
});

test('signed corrections restore their source amount and remain admissible above an inherited ceiling', async () => {
	const { world, candidate, request } = capWorld('claim');
	world.claim_requests.push({
		...request('refund', 'old-catalogue', 200, '2026-01'),
		incurred_on: '2026-01-10',
		as_adjustment_entry: true
	});
	await admit('claim', world, { ...candidate, amount: 400 }); // 800 - 200 + 400.
	await assert.rejects(admit('claim', world, { ...candidate, amount: 401 }), /1001\.00 requested/);
	world.claim_catalogue[1].cap = periodCap(200);
	await admit('claim', world, { ...candidate, amount: 20, as_adjustment_entry: true });
});

test('paid captured amounts, including zero, replace source estimates without changing their sign', async () => {
	for (const captured of [0, 250]) {
		const { world, candidate } = capWorld('claim');
		world.payroll_runs.push({
			id: 'paid-run',
			company_id: COMPANY_ID,
			period: '2026-01',
			lifecycle: 'PAID'
		});
		world.payslips.push({
			id: 'paid-slip',
			employment_id: EMPLOYMENT_ID,
			payroll_run_id: 'paid-run',
			statutory: []
		});
		settle(world, 'claim_requests', 'prior', 'paid-slip', '2026-01');
		if (captured !== 0)
			adjust(world, 'paid-slip', { family: 'CLAIM', source_id: 'prior', amount: captured });
		candidate.amount = 1000 - captured;
		await admit('claim', world, candidate);
		await assert.rejects(
			admit('claim', world, { ...candidate, amount: candidate.amount + 1 }),
			/1001\.00 requested/
		);
		world.claim_requests.push(candidate);
		const outputs = (await build(world)).payslip_payroll_run[0].adjustments.filter(
			(row) => row.label === 'BENEFIT'
		);
		assert.deepEqual(
			outputs.map((row) => row.amount),
			[1000 - captured]
		);
	}
});

test('a rehire and an employment in another entity each have independent contract caps', async () => {
	for (const elsewhere of [false, true]) {
		const { world, candidate } = capWorld('claim');
		const contract = {
			...world.employments[0],
			id: 'other-contract',
			...(elsewhere ? { company_id: 'other-company' } : { hire_date: '2026-02-01' })
		};
		world.employments.push(contract);
		world.employment_terms.push({
			...world.employment_terms[0],
			id: 'other-terms',
			employment_id: contract.id
		});
		await admit('claim', world, { ...candidate, employment_id: contract.id, amount: 1000 });
		await assert.rejects(
			admit('claim', world, { ...candidate, employment_id: contract.id, amount: 1001 }),
			/1001\.00 requested/
		);
	}
});

test('the same code in another family or settings lineage does not consume this cap', async () => {
	const { world, candidate, request } = capWorld('claim');
	world.jurisdiction_settings.push({
		...world.jurisdiction_settings[0],
		id: 'unrelated-settings',
		code: 'UNRELATED'
	});
	world.claim_catalogue.push({
		...world.claim_catalogue[0],
		id: 'unrelated-catalogue',
		settings_id: 'unrelated-settings'
	});
	world.claim_requests.push(request('unrelated', 'unrelated-catalogue', 9000, '2026-01'));
	world.payment_catalogue[0].code = 'BENEFIT';
	world.payment_requests.push({
		...request('other-family', 'unused', 9000, '2026-01'),
		payment_catalogue_id: world.payment_catalogue[0].id
	});
	await admit('claim', world, candidate);
});

test('a recurring annual award pays 600 then 400, exhausts, and starts fresh next year', async () => {
	const { world, prior } = capWorld('allowance');
	prior.amount = 600;
	prior.recurrence = { kind: 'RECURRING', from: '2026-01-01', to: '2027-12-31' } as never;
	world.allowance_catalogue[0].cap = periodCap();
	const template = world.work_days[0];
	world.work_days = [];
	for (
		let time = Date.parse('2025-12-21T00:00:00Z');
		time <= Date.parse('2027-02-20T00:00:00Z');
		time += 86400000
	) {
		const date = new Date(time).toISOString().slice(0, 10);
		world.work_days.push({
			...template,
			id: `work-${date}`,
			work_date: date,
			worked_intervals: [{ start: `${date}T07:30:00+08:00`, end: `${date}T16:30:00+08:00` }]
		});
	}
	for (const [period, expected] of [
		['2026-01', 600],
		['2026-02', 400],
		['2026-03', 0],
		['2027-01', 600]
	] as const) {
		const slip = (await build(world, period)).payslip_payroll_run[0];
		assert.equal(
			slip.adjustments.find((row) => row.label === 'BENEFIT')?.amount ?? 0,
			expected,
			period
		);
		assert.equal(
			slip.payslip_allowance_request_input_payslip.length,
			1,
			'zero awards remain captured'
		);
		const payslipId = `slip-${period}`;
		world.payroll_runs.push({
			id: `run-${period}`,
			company_id: COMPANY_ID,
			period,
			lifecycle: 'PAID'
		});
		world.payslips.push({ ...slip, id: payslipId, payroll_run_id: `run-${period}` });
		world.payslip_allowance_request_inputs.push(
			...slip.payslip_allowance_request_input_payslip.map((row) => ({
				...row,
				payslip_id: payslipId
			}))
		);
		const repeated = (await build(world, period)).payslip_payroll_run[0];
		assert.equal(
			repeated.payslip_allowance_request_input_payslip.length,
			0,
			'same-period occurrence is already consumed'
		);
		assert.equal(
			repeated.adjustments.some((row) => row.label === 'BENEFIT'),
			false
		);
	}
});

test('a recurring declaration is accepted and its cap is applied to each payroll occurrence', async () => {
	const { world, candidate } = capWorld('allowance');
	candidate.recurrence = { kind: 'RECURRING', from: '2026-02-01', to: null } as never;
	candidate.amount = 1200;
	await admit('allowance', world, candidate);
	world.allowance_requests.push(candidate);
	const outputs = (await build(world)).payslip_payroll_run[0].adjustments.filter(
		(row) => row.label === 'BENEFIT'
	);
	assert.deepEqual(
		outputs.map((row) => row.amount).sort((a, b) => a - b),
		[200, 800]
	);
});

test('post-departure Payment uses final terms from its own contract for eligibility', async () => {
	const { world, candidate } = capWorld('payment');
	world.employments[0].exit_date = '2026-01-31';
	world.employments[0].exit_reason = 'RESIGNATION';
	world.employment_terms[0].effective_range = { start: '2020-01-01', end: '2026-01-31' };
	world.employment_terms[0].employment_type = 'PERMANENT';
	world.employments.push({
		...world.employments[0],
		id: 'concurrent-contract',
		company_id: 'another-entity',
		exit_date: null,
		exit_reason: null
	});
	world.employment_terms.push({
		...world.employment_terms[0],
		id: 'concurrent-terms',
		employment_id: 'concurrent-contract',
		employment_type: 'TEMPORARY',
		effective_range: { start: '2026-02-01', end: null }
	});
	for (const catalogue of world.payment_catalogue) {
		catalogue.eligibility = "employment.type == 'PERMANENT'";
		catalogue.cap.bands[0].eligibility = "employment.type == 'PERMANENT'";
	}
	await admit('payment', world, candidate);
	await assert.rejects(
		admit('payment', world, { ...candidate, amount: 201 }),
		/1001\.00 requested/
	);
	world.payment_requests.push(candidate);
	const slip = (await build(world)).payslip_payroll_run[0];
	assert.deepEqual(slip.base, []);
	assert.deepEqual(
		slip.adjustments
			.filter((row) => row.label === 'BENEFIT')
			.map((row) => row.amount)
			.sort((a, b) => a - b),
		[200, 800]
	);
});

test('payroll cap usage values a due one-off Allowance using its actual source-month proration', async () => {
	const { world, prior, candidate } = capWorld('allowance');
	world.employments[0].hire_date = '2026-01-15';
	world.employments[0].effective_range = { start: '2026-01-15', end: null };
	world.employment_terms[0].effective_range = { start: '2026-01-15', end: null };
	world.allowance_catalogue[0].cap = periodCap();
	prior.amount = 310;
	candidate.amount = 830;
	// The write guard conservatively reserves the stated source magnitude before payroll prices it.
	await assert.rejects(admit('allowance', world, candidate), /1140\.00 requested/);
	world.allowance_requests.push(candidate);
	const outputs = (await build(world)).payslip_payroll_run[0].adjustments.filter(
		(row) => row.label === 'BENEFIT'
	);
	assert.deepEqual(
		outputs.map((row) => row.amount).sort((a, b) => a - b),
		[170, 830]
	);
	candidate.amount = 831;
	await assert.rejects(build(world), /1001\.00 requested/);
});

test('final terms do not fill an in-service gap or a missing departure-day record', () => {
	const first = { id: 'early', effective_range: { start: '2026-01-01', end: '2026-01-10' } };
	const final = { id: 'final', effective_range: { start: '2026-01-25', end: '2026-01-31' } };
	const contract = { exit_date: '2026-01-31' };
	assert.equal(payRequestTerms([first, final], contract, '2026-01-20'), null);
	assert.equal(payRequestTerms([first, final], contract, '2026-02-05'), final);
	assert.equal(payRequestTerms([first], contract, '2026-02-05'), null);
	assert.equal(payRequestTerms([first, final], { exit_date: null }, '2026-02-05'), null);
});
