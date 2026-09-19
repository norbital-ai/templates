import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { admitPayRequests, type PayRequestGuard } from '../src/lib/pay_request_rules.ts';
import { payRequestTerms } from '../src/lib/component_entry_cap_subject.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { adjust, capturesOf, settle } from './helpers/settlement.ts';
import { clearAllowances } from './fixtures/contract-allowances.ts';

type Family = 'claim' | 'allowance';
/**
 * The catalogue's bands, priced as themselves with a CALENDAR_YEAR block limit. A tier the old
 * `cap.bands` stated as a person `eligibility` is the band's own `when` now, over the entry
 * context's `person` — the same predicate vocabulary, nested one level.
 */
const capBands = (amount = 1000, eligibility = '') => [
	{
		when: eligibility === '' ? '' : `person.${eligibility}`,
		amount: 'entry.amount',
		limit: { period: 'CALENDAR_YEAR', on_exceed: 'BLOCK', amount: `${amount}.0` }
	}
];

function capWorld(family: Family) {
	const world = createPublicPayrollWorld();
	world.allowances = [];
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
	}
	const oldSettings = world.jurisdiction_settings[0];
	world.jurisdiction_settings.push({
		...structuredClone(oldSettings),
		id: 'new-settings',
		effective_range: { start: '2026-02-01', end: null }
	});
	oldSettings.effective_range = { start: '2020-01-01', end: '2026-02-01' };
	const source = {
		...structuredClone(world.allowance_catalogue[0]),
		id: 'old-catalogue',
		code: 'BENEFIT',
		bands: capBands(),
		...(family === 'adhoc' ? { raised_by: 'MANUAL' } : {})
	};
	world[`${family}_catalogue`] = [
		source,
		{ ...structuredClone(source), id: 'new-catalogue', settings_id: 'new-settings' }
	];
	// A claim is dated by the day incurred, an ad hoc request by the day it is for: the same
	// day under two names, each read by its own guard.
	const request = (id: string, catalogueId: string, amount: number, month: string) => ({
		id,
		employment_id: EMPLOYMENT_ID,
		catalogue_id: catalogueId,
		amount,
		incurred_on: `${month}-05`,
		event_date: `${month}-05`,
		reason: 'Synthetic benefit request',
		approval_id: null,
		as_adjustment_entry: false
	});
	const prior = request('prior', 'old-catalogue', 800, '2026-01');
	const candidate = request('candidate', 'new-catalogue', 200, '2026-02');
	(family === 'claim' ? world.claim_requests : (world.adhoc_requests ??= [])).push(prior);
	return { world, prior, candidate, request };
}

const guardFor = (family: Family): PayRequestGuard => ({
	family: family.toUpperCase() as PayRequestGuard['family'],
	catalogue: `${family}_catalogue`,
	requests: `${family}_requests`,
	noun: family,
	eventDate: (row) => String(row.incurred_on)
});

const admit = (family: Family, world: PayrollWorld, candidate: Record<string, unknown>) =>
	Effect.runPromise(
		admitPayRequests(
			guardFor(family),
			memoryPayrollApi(world).db as never,
			[candidate],
			[undefined]
		)
	);

/** File a period's payslip as paid: the run row, the slip, and the ad hoc requests it pinned. */
const pay = (world: PayrollWorld, built: Awaited<ReturnType<typeof build>>, period: string) => {
	const slip = built.payslip_payroll_run[0]!;
	const payslipId = `slip-${period}`;
	world.payroll_runs.push({ id: `run-${period}`, company_id: COMPANY_ID, period });
	world.payslips.push({
		...slip,
		id: payslipId,
		payroll_run_id: `run-${period}`,
		paid_at: `${period}-28`
	});
	for (const id of capturesOf(built, slip).adhoc) settle(world, 'adhoc_requests', id, payslipId);
};
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

test('claim cap spans catalogue revisions of the same code', async () => {
	const { world, candidate } = capWorld('claim');
	await admit('claim', world, candidate); // 800 under the old revision + 200 = 1,000.
	await assert.rejects(
		admit('claim', world, { ...candidate, amount: 201 }),
		/1001\.00 requested against 1000\.00/
	);
	world.claim_requests.push(candidate);
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

test('ad hoc cap spans catalogue revisions of the same code, at the write and in the run', async () => {
	const { world, candidate } = capWorld('adhoc');
	pay(world, await build(world, '2026-01'), '2026-01'); // 800 under the old revision.
	await admit('adhoc', world, candidate); // 800 + 200 = 1,000.
	await assert.rejects(
		admit('adhoc', world, { ...candidate, amount: 201 }),
		/1001\.00 requested against 1000\.00/
	);
	world.adhoc_requests!.push(candidate);
	assert.deepEqual(
		(await build(world)).payslip_payroll_run[0].adjustments
			.filter((row) => row.label === 'BENEFIT')
			.map((row) => row.amount),
		[200]
	);
});

test('two bands that differ by grade: the tier is read off the terms in force on the event date', async () => {
	const { world, candidate } = capWorld('claim');
	for (const catalogue of world.claim_catalogue)
		catalogue.bands = [
			{
				when: 'person.terms.grade == "G3"',
				amount: 'entry.amount',
				limit: { period: 'CALENDAR_YEAR', on_exceed: 'BLOCK', amount: '2000.0' }
			},
			...capBands()
		];
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

test('a person no band covers is captured and paid nothing, and the run says so', async () => {
	// The band table is the entitlement: a non-empty table that covers nobody leaves the entry
	// priced at nothing, and the run reports it as a skipped request with the entry still captured.
	const { world, candidate } = capWorld('claim');
	for (const catalogue of world.claim_catalogue)
		catalogue.bands = capBands(2000, 'terms.grade == "G3"');
	await admit('claim', world, candidate);
	world.claim_requests.push(candidate);
	const result = await build(world);
	const slip = result.payslip_payroll_run[0];
	assert.equal(
		slip.adjustments.some((row) => row.label === 'BENEFIT'),
		false
	);
	assert.equal(capturesOf(result, slip).claims.length, 2, 'read and captured, priced at nothing');
	assert.ok(
		result.warnings.some((line) => line.includes('no band of the catalogue covers this entry')),
		result.warnings.join('\n')
	);
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
	world.claim_catalogue[1].bands = capBands(200);
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
			base: [],
			adjustments: [],
			payroll_run_id: 'paid-run',
			// Paid, because history is the slip's own payment rather than the run's summary.
			paid_at: '2026-01-31',
			statutory: []
		});
		settle(world, 'claim_requests', 'prior', 'paid-slip');
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
			...(elsewhere
				? { company_id: 'other-company' }
				: { effective_range: { start: '2026-02-01', end: null } })
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
	(world.adhoc_catalogue ??= []).push({
		...world.claim_catalogue[0],
		id: 'other-family-catalogue'
	});
	(world.adhoc_requests ??= []).push(
		request('other-family', 'other-family-catalogue', 9000, '2026-01')
	);
	await admit('claim', world, candidate);
});

test('a recurring annual award pays 600 then 400, exhausts, and starts fresh next year', async () => {
	// An award raised every month as an ad hoc request: the class's CALENDAR_YEAR ceiling bounds
	// what a year pays, and a request that exceeds it is refused at the write.
	const { world, prior, request } = capWorld('adhoc');
	prior.amount = 600;
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
	const award = (month: string, amount: number) =>
		request(`award-${month}`, month < '2026-02' ? 'old-catalogue' : 'new-catalogue', amount, month);
	for (const [period, amount, admitted] of [
		['2026-01', 600, true],
		['2026-02', 400, true],
		['2026-03', 1, false],
		['2027-01', 600, true]
	] as const) {
		if (period !== '2026-01') {
			const candidate = award(period, amount);
			if (admitted) {
				await admit('adhoc', world, candidate);
				world.adhoc_requests!.push(candidate);
			} else await assert.rejects(admit('adhoc', world, candidate), /requested against 1000\.00/);
		}
		const built = await build(world, period);
		const slip = built.payslip_payroll_run[0];
		assert.equal(
			slip.adjustments.find((row) => row.label === 'BENEFIT')?.amount ?? 0,
			admitted ? amount : 0,
			period
		);
		pay(world, built, period);
	}
});

test('final terms do not fill an in-service gap or a missing departure-day record', () => {
	const first = { id: 'early', effective_range: { start: '2026-01-01', end: '2026-01-10' } };
	const final = { id: 'final', effective_range: { start: '2026-01-25', end: '2026-01-31' } };
	const contract = { effective_range: { start: '2026-01-01', end: '2026-01-31' } };
	assert.equal(payRequestTerms([first, final], contract, '2026-01-20'), null);
	assert.equal(payRequestTerms([first, final], contract, '2026-02-05'), final);
	assert.equal(payRequestTerms([first], contract, '2026-02-05'), null);
	assert.equal(
		payRequestTerms(
			[first, final],
			{ effective_range: { start: '2026-01-01', end: null } },
			'2026-02-05'
		),
		null
	);
});
