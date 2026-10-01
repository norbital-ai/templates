import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildStatutory,
	createStatutoryWorld,
	settingsIdOn,
	COMPANY_ID
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { admitPayRequests, type PayRequestGuard } from '../src/lib/pay_request_rules.ts';
import { memoryDb } from './helpers/ctx.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';

// JTKSM Act446 FAQ, P.U.(A)249/2020 and P.U.(A)49/2026:
// https://jtksm.mohr.gov.my/ms/soalan-lazim/perumahan-penginapan-dan-kemudahan-pekerja
// RM100 through February, RM150 from March; actual contract lower cap remains binding.
const CODE = 'ACCOMMODATION_RENT';
const person = {
	key: 'RENT',
	wage: 3000,
	citizenship: 'CITIZEN',
	registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } }
};
const facts = (month: string, over: Record<string, unknown> = {}) => ({
	rent_month: month,
	accommodation_kind: 'ACCOMMODATION',
	certificate_reference: 'JTKSM-CERT-001',
	certificate_active: true,
	certificate_valid_from: '2025-01-01',
	certificate_valid_to: '2026-12-31',
	contract_reference: 'SIGNED-CONTRACT-001',
	contract_monthly_charge: 200,
	written_variation: false,
	...over
});
const rent = (
	world: PayrollWorld,
	id: string,
	date: string,
	amount: number,
	over: Record<string, unknown> = {},
	reversal = false
) => ({
	id,
	employment_id: world.employments[0]!.id,
	catalogue_id: world.adhoc_catalogue!.find(
		(row) => row.settings_id === settingsIdOn('MY', date) && row.code === CODE
	)!.id,
	amount,
	event_date: date,
	pay_period: date.slice(0, 7),
	facts: facts(date.slice(0, 7), over),
	reason: 'Accommodation rent',
	approval_id: null,
	as_adjustment_entry: reversal,
	payslip_id: null
});
const guard: PayRequestGuard = {
	family: 'ADHOC',
	catalogue: 'adhoc_catalogue',
	requests: 'adhoc_requests',
	noun: 'accommodation rent',
	sign: 1,
	eventDate: (row) => String(row.event_date)
};
const admit = (world: PayrollWorld, candidate: ReturnType<typeof rent>) =>
	admitPayRequests(guard, memoryDb(world) as never, [candidate], [undefined]);
const netRent = (
	slip: ReturnType<typeof buildStatutory>['slips'] extends Map<string, infer S> ? S : never
) =>
	slip.adjustments
		.filter((row) => row.component_code === CODE)
		.reduce((sum, row) => sum + row.amount, 0);

for (const [month, allowed] of [
	['2026-02', 100],
	['2026-03', 150]
] as const) {
	test(`MY Act446 — ${month} rent ceiling RM${allowed} leaves gross RM3000 and reduces net by RM${allowed}`, () => {
		const baseline = buildStatutory({ code: 'MY', period: month, people: [person] }).slips.get(
			'RENT'
		)!;
		const slip = buildStatutory({ code: 'MY', period: month, people: [person] }, (world) =>
			world.adhoc_requests!.push(rent(world, 'r1', `${month}-01`, allowed) as never)
		).slips.get('RENT')!;
		assert.equal(slip.gross, 3000);
		assert.equal(netRent(slip), allowed);
		assert.equal(slip.net, baseline.net - allowed);
		assert.deepEqual(slip.statutory, baseline.statutory);
	});
}

test('MY Act446 — lower contract, free accommodation, certificate, estate and prior-written-variation gates', async () => {
	const world = createStatutoryWorld({ code: 'MY', period: '2026-03', people: [person] });
	await assert.rejects(
		admit(world, rent(world, 'r1', '2026-03-01', 101, { contract_monthly_charge: 100 })),
		/101\.00 requested against 100\.00/
	);
	await assert.rejects(
		admit(world, rent(world, 'r1', '2026-03-01', 1, { contract_monthly_charge: 0 })),
		/1\.00 requested against 0\.00/
	);
	for (const [over, message] of [
		[{ certificate_active: false }, /certificate currently in force/],
		[{ certificate_valid_from: '2026-03-02' }, /certificate must be valid/],
		[{ certificate_valid_to: '2026-02-28' }, /certificate must be valid/],
		[{ accommodation_kind: 'ESTATE_HOUSING' }, /Estate housing rent/],
		[{ rent_month: '2026-02' }, /rent month must/],
		[
			{
				written_variation: true,
				varied_monthly_charge: 150,
				variation_reference: 'SIGNED-CHANGE',
				variation_agreed_on: '2026-03-02'
			},
			/variation must precede/
		]
	] as const)
		await assert.rejects(admit(world, rent(world, 'r1', '2026-03-01', 100, over)), message);
	await admit(
		world,
		rent(world, 'r1', '2026-03-01', 150, {
			contract_monthly_charge: 0,
			written_variation: true,
			varied_monthly_charge: 150,
			variation_reference: 'SIGNED-CHANGE',
			variation_agreed_on: '2026-02-28'
		})
	);
});

test('MY Act446 — repeated pending rent shares one monthly RM150 ceiling', async () => {
	const world = createStatutoryWorld({ code: 'MY', period: '2026-03', people: [person] });
	world.adhoc_requests!.push(rent(world, 'r1', '2026-03-01', 100) as never);
	await admit(world, rent(world, 'r2', '2026-03-02', 50));
	await assert.rejects(
		admit(world, rent(world, 'r2', '2026-03-02', 51)),
		/151\.00 requested against 150\.00/
	);
	world.adhoc_requests!.push(rent(world, 'r2', '2026-03-02', 51) as never);
	assert.throws(
		() =>
			buildPayrollRun(
				gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-03' })
			),
		/151\.00 requested against 150\.00/
	);
});

test('MY Act446 — captured rent consumes the month, reversal releases only the actual RM100 before replacement', async () => {
	const world = createStatutoryWorld({ code: 'MY', period: '2026-03', people: [person] });
	const prior = rent(world, 'r1', '2026-03-01', 100);
	world.adhoc_requests!.push(prior as never);
	const built = buildPayrollRun(
		gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-03' })
	);
	world.payroll_runs.push({ id: 'prior-run', company_id: COMPANY_ID, period: '2026-03' } as never);
	world.payslips.push({
		...built.payslip_payroll_run[0]!,
		id: 'prior-slip',
		payroll_run_id: 'prior-run',
		paid_at: '2026-03-10'
	} as never);
	prior.payslip_id = 'prior-slip' as never;
	await assert.rejects(
		admit(world, rent(world, 'r3', '2026-03-03', 51)),
		/151\.00 requested against 150\.00/
	);
	world.adhoc_requests!.push(rent(world, 'r2', '2026-03-02', 100, {}, true) as never);
	await admit(world, rent(world, 'r3', '2026-03-03', 150));
	await assert.rejects(
		admit(world, rent(world, 'r3', '2026-03-03', 151)),
		/151\.00 requested against 150\.00/
	);
});
