/**
 * Round 4 (L) — Indonesia. Every figure is derived by hand from the instrument cited beside it.
 *
 * C01 — annual-leave cash-out. UU 13/2003 art.156(4)(a) as amended by UU 6/2023 and PP 35/2021
 * art.40(4)(a) grant untaken, unexpired leave as uang penggantian hak with no amount; art.79(4)
 * as amended: "Pelaksanaan cuti tahunan ... diatur dalam Perjanjian Kerja, Peraturan Perusahaan,
 * atau Perjanjian Kerja Bersama". Art.157(1) as amended fixes the wage components only for
 * pesangon and UPMK. The entity therefore declares the PK/PP/PKB basis (wage basis and divisor);
 * without it the cash-out stops by name.
 *
 * PKWT compensation — PP 68/2009 art.1 angka 4: uang pesangon is income paid "dengan nama dan
 * dalam bentuk apapun, sehubungan dengan berakhirnya masa kerja atau terjadi pemutusan hubungan
 * kerja". PP 35/2021 art.15(2) pays the compensation when the PKWT ends, so it takes the final
 * rates of PP 68/2009 art.5 (0% to 50,000,000; 5% to 100,000,000; 15% to 500,000,000; 25% above).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	buildStatutory,
	createStatutoryWorld,
	COMPANY_ID,
	leaveCatalogue,
	settingsVersions
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';

const uuid = (n: number) => `a4000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ─── C01: leave cash-out on the declared PK/PP/PKB basis ────────────────────────────────────

function cashOut(facts: Record<string, string | number>, houseAllowance = 0) {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-06',
		region: 'DKI Jakarta',
		riskClass: 'I',
		people: [{ key: 'LEAVE', wage: 6_000_000 }]
	});
	world.companies[0]!.facts = facts;
	if (houseAllowance > 0)
		world.employment_terms[0]!.allowances = [
			{
				catalogue_id: world.allowance_catalogue.find(
					(row) =>
						row.code === 'HOUSE_ALLOWANCE' &&
						world.jurisdiction_settings.some(
							(version) =>
								version.id === row.settings_id &&
								String(version.effective_range.start).startsWith('2026-03')
						)
				)!.id,
				amount: houseAllowance
			}
		];
	world.leave_catalogue.push(...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null })));
	const version = world.jurisdiction_settings.find((row) =>
		String(row.effective_range.start).startsWith('2026-03')
	)!;
	const catalogue = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id: uuid(1),
		employment_id: world.employments[0]!.id,
		catalogue_id: catalogue.id,
		leave_code: catalogue.code,
		reference: 'PKB-CASH-OUT',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1.5,
		encash_days: 1.5,
		effective_on: '2026-06-30',
		due_on: '2026-06-30',
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-06' })
	);
	return () =>
		buildPayrollRun(prepared).payslip_payroll_run[0]!.adjustments.find(
			(row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT'
		)!.amount;
}

test('ID C01: every version declares the cash-out basis as required entity facts', () => {
	for (const version of settingsVersions('ID')) {
		const rule = version.work_rules.encashment;
		assert.ok(rule, `${String(version.effective_range.start)}: no encashment rule`);
		assert.deepEqual(rule.required_facts, [
			'leave_cash_out_day_divisor',
			'leave_cash_out_wage_basis'
		]);
		for (const key of rule.required_facts!)
			assert.ok(version.facts.some((field) => field.key === key));
	}
});

test('ID C01: basic plus fixed allowances ÷ the declared divisor', () => {
	// PKB: basic 6,000,000 + house allowance 1,000,000 = 7,000,000 ÷ 25 = 280,000 a day;
	// 1.5 days = 420,000.
	const amount = cashOut(
		{ leave_cash_out_day_divisor: 25, leave_cash_out_wage_basis: 'BASIC_AND_FIXED_ALLOWANCES' },
		1_000_000
	);
	assert.equal(amount(), 420_000);
});

test('ID C01: basic wage only ÷ 30 when the company regulation says so', () => {
	// PP: basic 6,000,000 ÷ 30 = 200,000 a day, the house allowance left out; 1.5 days = 300,000.
	const amount = cashOut(
		{ leave_cash_out_day_divisor: 30, leave_cash_out_wage_basis: 'BASIC' },
		1_000_000
	);
	assert.equal(amount(), 300_000);
});

test('ID C01: an entity that has not recorded its basis stops the cash-out by name', () => {
	assert.throws(
		() => cashOut({ leave_cash_out_wage_basis: 'BASIC' })(),
		/Leave cash-out daily divisor is required before calculation/
	);
	assert.throws(
		() => cashOut({ leave_cash_out_day_divisor: 25 })(),
		/Leave cash-out wage basis is required before calculation/
	);
});

// ─── PKWT compensation at the final severance rates ─────────────────────────────────────────

function pkwt(wage: number, taxResidency: string | null = 'RESIDENT') {
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'DKI Jakarta',
			riskClass: 'I',
			people: [
				{
					key: 'PKWT',
					employment_type: 'CONTRACT',
					wage,
					tax_residency: taxResidency,
					hire_date: '2024-01-31',
					exit_date: '2026-01-31',
					exit_reason: 'END_OF_CONTRACT'
				}
			]
		},
		(world) => {
			// Idul Fitri 1447 H (SKB 2026): the holiday the 31 January departure is judged against.
			world.employments[0]!.exit_facts = {
				micro_small_enterprise: false,
				thr_holiday_date: '2026-03-21'
			};
			const version = world.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			world.adhoc_requests!.push({
				id: uuid(10),
				employment_id: world.employments[0]!.id,
				catalogue_id: world.adhoc_catalogue!.find(
					(row) => row.settings_id === version.id && row.code === 'PKWT_COMPENSATION'
				)!.id,
				amount: 0,
				event_date: '2026-01-31',
				pay_period: '2026-01',
				payslip_id: null,
				reason: 'PKWT_COMPENSATION',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	const slip = slips.get('PKWT')!;
	return {
		paid: slip.adjustments.find((row) => row.component_code === 'PKWT_COMPENSATION')?.amount ?? 0,
		charge: (code: string) => slip.statutory.find((row) => row.scheme_code === code)
	};
}

for (const [wage, compensation, finalTax, derivation] of [
	[25_000_000, 50_000_000, 0, '50,000,000 is inside the 0% tier'],
	[50_000_000, 100_000_000, 2_500_000, '5% × (100,000,000 − 50,000,000) = 2,500,000'],
	[
		250_000_000,
		500_000_000,
		62_500_000,
		'2,500,000 + 15% × (500,000,000 − 100,000,000) = 2,500,000 + 60,000,000 = 62,500,000'
	]
] as const)
	test(`ID PKWT compensation ${compensation.toLocaleString('en')}: final PPh 21 — ${derivation}`, () => {
		// PP 35/2021 art.16(1): 24 months (31 Jan 2024 → 31 Jan 2026) × wage / 12 = 2 × wage.
		const { paid, charge } = pkwt(wage);
		assert.equal(paid, compensation);
		assert.equal(charge('PPH21_FINAL_SEVERANCE')?.employee_amount ?? 0, finalTax);
		// Outside the TER base: the monthly PPh 21 base holds only the wage and employer premiums —
		// JKK 0.24% (risk class 1) and JKM 0.30% on the wage, Kesehatan 4% on the 12,000,000 cap.
		assert.equal(charge('PPH21')!.base_amount, wage + wage * 0.0024 + wage * 0.003 + 480_000);
	});

test('ID PKWT compensation of a non-resident is PPh 26 at 20%, not the resident final rates', () => {
	// PP 68/2009 applies to residents; UU 36/2008 art.26(1): 20% of the gross. Base = wage
	// 25,000,000 + JKK 60,000 + JKM 75,000 + Kesehatan 480,000 + compensation 50,000,000
	// = 75,615,000 × 20% = 15,123,000.
	const { paid, charge } = pkwt(25_000_000, 'NON_RESIDENT');
	assert.equal(paid, 50_000_000);
	assert.equal(charge('PPH21_FINAL_SEVERANCE')?.employee_amount ?? 0, 0);
	assert.equal(charge('PPH26')!.employee_amount, 15_123_000);
});
