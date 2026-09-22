/**
 * Round 5 (Y) — annual-leave cash-out for non-monthly contracts. Figures derived by hand.
 *
 * VN — Decree 145/2020 art.67(3): the basis is "tiền lương theo hợp đồng lao động của tháng trước
 * liền kề tháng người lao động thôi việc"; art.54(1)(a)(a3) a weekly contract's day is the weekly
 * wage ÷ the contract's working days in the week, a daily contract's day is its daily wage;
 * (a4) hour = day ÷ normal hours of the day, so an hourly contract's day = hour × those hours.
 * TW — 勞基法施行細則 §24-1(2)(1)(2): the day is the normal-hours wage of the day before year
 * end/termination; only 計月 wages are divided by thirty, so a weekly wage is not.
 * ID — PP 36/2021 art.15: time-unit wages are per jam, harian or bulanan (no weekly); a daily
 * wage is the day; a per-hour wage (art.16(1)) × the day's normal hours; a fixed monthly
 * allowance adds its share over the entity's declared PK/PP/PKB divisor when its basis includes it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { createStatutoryWorld, COMPANY_ID, leaveCatalogue } from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { leaveEncashmentRate } from '../src/lib/leave/encashment-rate.ts';

const id = (n: number) => `a5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function rate(
	code: 'VN' | 'TW' | 'ID',
	frequency: 'DAILY' | 'WEEKLY' | 'HOURLY',
	wage: number,
	options: { facts?: Record<string, string | number>; houseAllowance?: number } = {}
) {
	const world = createStatutoryWorld({
		code,
		period: '2026-06',
		riskClass: code === 'ID' ? 'I' : '1',
		region: code === 'VN' ? 'I' : code === 'ID' ? 'DKI Jakarta' : null,
		people: [{ key: 'LEAVE', wage: 10_000_000 }]
	});
	const terms = world.employment_terms[0]!;
	terms.pay_frequency = frequency;
	terms.base_salary = { ...terms.base_salary, value: wage } as never;
	if (options.facts) world.companies[0]!.facts = options.facts;
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= '2026-06-30' &&
			(row.effective_range.end == null ||
				String(row.effective_range.end).slice(0, 10) > '2026-06-30')
	)!;
	if (options.houseAllowance)
		terms.allowances = [
			{
				catalogue_id: world.allowance_catalogue.find(
					(row) => row.code === 'HOUSE_ALLOWANCE' && row.settings_id === version.id
				)!.id,
				amount: options.houseAllowance
			}
		] as never;
	world.leave_catalogue.push(...leaveCatalogue(code).map((row) => ({ ...row, approval_id: null })));
	const catalogue = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id: id(1),
		employment_id: world.employments[0]!.id,
		catalogue_id: catalogue.id,
		leave_code: catalogue.code,
		reference: 'ROUND5-Y',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1,
		encash_days: 1,
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
	const bundle = prepared.gathered.bundles[0]!;
	return leaveEncashmentRate({
		bundle,
		configuration: prepared.configuration,
		entry: bundle.leave.entries.find((entry) => entry.id === id(1))!
	});
}

// The world's contract works Monday–Friday, 8 hours a day (40 a week).

test('VN daily contract: the day of May’s contract salary is the daily wage', () => {
	// art.54(1)(a)(a3): 500,000 đồng a day.
	assert.equal(rate('VN', 'DAILY', 500_000), 500_000);
});

test('VN weekly contract: weekly wage ÷ 5 contract working days', () => {
	// art.54(1)(a)(a3): 2,500,000 ÷ 5 = 500,000 đồng.
	assert.equal(rate('VN', 'WEEKLY', 2_500_000), 500_000);
});

test('VN hourly contract: hourly wage × 8 normal hours', () => {
	// art.54(1)(a)(a4) inverted: 60,000 × 8 = 480,000 đồng.
	assert.equal(rate('VN', 'HOURLY', 60_000), 480_000);
});

test('TW weekly contract: the preceding day’s normal-hours wage, not ÷ 30', () => {
	// NT$10,000 a week over 5 normal working days = NT$2,000.
	assert.equal(rate('TW', 'WEEKLY', 10_000), 2_000);
});

test('ID daily contract on the basic basis: the daily wage itself', () => {
	// PP 36/2021 art.15(b): Rp300,000 a day.
	assert.equal(
		rate('ID', 'DAILY', 300_000, {
			facts: { leave_cash_out_day_divisor: 21, leave_cash_out_wage_basis: 'BASIC' },
			houseAllowance: 1_050_000
		}),
		300_000
	);
});

test('ID daily contract with fixed allowances: daily wage + allowance ÷ declared divisor', () => {
	// Rp300,000 + Rp1,050,000 ÷ 21 (= Rp50,000) = Rp350,000.
	assert.equal(
		rate('ID', 'DAILY', 300_000, {
			facts: {
				leave_cash_out_day_divisor: 21,
				leave_cash_out_wage_basis: 'BASIC_AND_FIXED_ALLOWANCES'
			},
			houseAllowance: 1_050_000
		}),
		350_000
	);
});

test('ID hourly (part-time) contract: hourly wage × 8 normal hours', () => {
	// PP 36/2021 art.16(1): Rp40,000 × 8 = Rp320,000.
	assert.equal(
		rate('ID', 'HOURLY', 40_000, {
			facts: { leave_cash_out_day_divisor: 21, leave_cash_out_wage_basis: 'BASIC' }
		}),
		320_000
	);
});

test('ID weekly contract is refused: PP 36/2021 art.15 has no weekly time unit', () => {
	assert.throws(
		() =>
			rate('ID', 'WEEKLY', 1_500_000, {
				facts: { leave_cash_out_day_divisor: 21, leave_cash_out_wage_basis: 'BASIC' }
			}),
		/Leave cash-out has no verified WEEKLY valuation rule/
	);
});
