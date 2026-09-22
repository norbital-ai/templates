/**
 * Indonesia — independent audit (2026-09-23). Every expected figure below is derived by hand from
 * the instrument cited beside it; none was read off the engine.
 *
 * PP 44/2015 art.16, 18, 19 (JKK, JKM, contribution wage); PP 46/2015 art.16 (JHT); PP 45/2015
 * art.15, 28, 29 (JP, pension age, ceiling); SE BPJS Ketenagakerjaan B/1226/022026 (JP ceiling
 * 11,086,300 from March 2026; 10,547,400 from March 2025); Perpres 82/2018 art.1 angka 2, 32 as
 * amended (Kesehatan); PMK 168/2023 art.9 and Lampiran (TER, PTKP of a married woman);
 * UU 36/2008 art.17(1)(a) as amended by UU 7/2021 (annual rates); PP 68/2009 (final severance
 * tax); PP 35/2021 art.33, 40, 56 (daily wage, pesangon, UPMK); Permenaker 6/2016 art.7 (THR of
 * a leaver); SKB 3 Menteri 2025/2026 holiday dates.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	assessStatutoryUnvalidated,
	buildStatutory,
	chargeOf,
	createStatutoryWorld,
	expectStatutory,
	expectStatutorySkipped,
	COMPANY_ID,
	type Person
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';

const world = (period: string, people: Person[], riskClass = 'II', region = 'DKI Jakarta') => ({
	code: 'ID' as const,
	period,
	region,
	riskClass,
	people
});

// ─── BPJS Ketenagakerjaan ────────────────────────────────────────────────────────────────────

for (const [riskClass, jkk] of [
	// PP 44/2015 art.16(1)(a)–(e): 0.24 / 0.54 / 0.89 / 1.27 / 1.74 % of the monthly wage, employer.
	// On 10,000,000: 24,000 / 54,000 / 89,000 / 127,000 / 174,000.
	['I', 24_000],
	['II', 54_000],
	['III', 89_000],
	['IV', 127_000],
	['V', 174_000]
] as const)
	test(`ID audit — JKK risk group ${riskClass}, JKM, JHT, JP and JKP on 10,000,000 (April 2026)`, () => {
		const book = assessStatutoryUnvalidated(
			world('2026-04', [{ key: 'W10', wage: 10_000_000, age: 40 }], riskClass)
		);
		expectStatutory(book, 'W10', 'JKK', 0, jkk);
		// PP 44/2015 art.18(1): 0.30% × 10,000,000 = 30,000, employer.
		expectStatutory(book, 'W10', 'JKM', 0, 30_000);
		// PP 46/2015 art.16: 2% × 10,000,000 = 200,000 employee; 3.7% = 370,000 employer.
		expectStatutory(book, 'W10', 'JHT', 200_000, 370_000);
		// PP 45/2015 art.28(3): 1% / 2% of 10,000,000 (under the 11,086,300 ceiling) = 100,000 / 200,000.
		expectStatutory(book, 'W10', 'JP', 100_000, 200_000);
		// PP 37/2021 art.11 as amended by PP 6/2025: the 0.14% employer share is recomposed out of
		// JKK, the 0.22% is the government's — no further payslip charge.
		expectStatutory(book, 'W10', 'JKP', 0, 0);
	});

test('ID audit — JP ceiling at, just above and across the 1 March 2026 step', () => {
	// PP 45/2015 art.29(2)–(4); BPJS: 10,547,400 from 1 March 2025, 11,086,300 from 1 March 2026.
	const feb = assessStatutoryUnvalidated(
		world('2026-02', [
			{ key: 'AT', wage: 10_547_400 },
			{ key: 'ABOVE', wage: 10_547_500 },
			{ key: 'W11', wage: 11_000_000 }
		])
	);
	// 1% × 10,547,400 = 105,474; 2% = 210,948.
	expectStatutory(feb, 'AT', 'JP', 105_474, 210_948);
	// 10,547,500 is over the ceiling: charged on 10,547,400 (uncapped would be 105,475 / 210,950).
	expectStatutory(feb, 'ABOVE', 'JP', 105_474, 210_948);
	expectStatutory(feb, 'W11', 'JP', 105_474, 210_948);
	const mar = assessStatutoryUnvalidated(
		world('2026-04', [
			{ key: 'W11', wage: 11_000_000 },
			{ key: 'AT', wage: 11_086_300 },
			{ key: 'ABOVE', wage: 11_086_301 }
		])
	);
	// Under the new ceiling: 1% × 11,000,000 = 110,000; 2% = 220,000.
	expectStatutory(mar, 'W11', 'JP', 110_000, 220_000);
	// 1% × 11,086,300 = 110,863; 2% = 221,726, and the rupiah above changes nothing.
	expectStatutory(mar, 'AT', 'JP', 110_863, 221_726);
	expectStatutory(mar, 'ABOVE', 'JP', 110_863, 221_726);
	// The December 2025 version sits on the 2025 ceiling: 11,000,000 → 105,474 / 210,948.
	const dec = assessStatutoryUnvalidated(world('2025-12', [{ key: 'W11', wage: 11_000_000 }]));
	expectStatutory(dec, 'W11', 'JP', 105_474, 210_948);
});

test('ID audit — JP stops at the pension age unless the participant defers (PP 45/2015 art.15)', () => {
	// art.15(1)–(3): 56, 57 from 1 January 2019, +1 every three years → 59 from 1 January 2025 to
	// 31 December 2027. art.15(4): still employed, the participant may take the pension when work
	// stops, at most three years after pension age — contributions continue only on that choice.
	const defer = { JP: { kind: 'REGISTERED', elections: { continue_after_pension_age: true } } };
	const book = assessStatutoryUnvalidated(
		world('2026-04', [
			{ key: 'A58', wage: 10_000_000, age: 58 },
			{ key: 'A59', wage: 10_000_000, age: 59 },
			{ key: 'A59-DEFER', wage: 10_000_000, age: 59, registrations: defer },
			{ key: 'A61-DEFER', wage: 10_000_000, age: 61, registrations: defer },
			{ key: 'A62-DEFER', wage: 10_000_000, age: 62, registrations: defer }
		])
	);
	expectStatutory(book, 'A58', 'JP', 100_000, 200_000);
	expectStatutorySkipped(book, 'A59', 'JP');
	expectStatutory(book, 'A59-DEFER', 'JP', 100_000, 200_000);
	expectStatutory(book, 'A61-DEFER', 'JP', 100_000, 200_000);
	expectStatutorySkipped(book, 'A62-DEFER', 'JP');
	// JHT has no age limit: 2% / 3.7% of 10,000,000 at 59 still.
	expectStatutory(book, 'A59', 'JHT', 200_000, 370_000);
	// Pension age 59 already held in December 2025.
	const dec = assessStatutoryUnvalidated(
		world('2025-12', [{ key: 'A59', wage: 10_000_000, age: 59 }])
	);
	expectStatutorySkipped(dec, 'A59', 'JP');
});

// ─── BPJS Kesehatan ──────────────────────────────────────────────────────────────────────────

test('ID audit — Kesehatan floor, ceiling and the six-month foreigner (Perpres 82/2018)', () => {
	const book = assessStatutoryUnvalidated(
		world(
			'2026-01',
			[
				// art.32(2): floor = workplace UMK; Kabupaten Bekasi 2026 = 5,938,885 (Kepgub Jabar
				// 561.7/Kep.862-Kesra/2025). 1% = 59,388.85 → 59,389; 4% = 237,555.40 → 237,555.
				{ key: 'FLOOR', wage: 5_000_000 },
				// Between floor and cap: 1% / 4% of 11,000,000 = 110,000 / 440,000.
				{ key: 'MID', wage: 11_000_000 },
				// art.32(1): cap 12,000,000 → 120,000 / 480,000, at and above.
				{ key: 'CAP', wage: 12_000_000 },
				{ key: 'CAP+1', wage: 12_000_001 },
				// art.1 angka 2: a foreigner is a participant after six months of work in Indonesia.
				{
					key: 'TKA-3M',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					employment_type: 'CONTRACT',
					hire_date: '2026-01-01',
					exit_date: '2026-03-31'
				},
				{
					key: 'TKA-6M',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					employment_type: 'CONTRACT',
					hire_date: '2026-01-01',
					exit_date: '2026-06-30'
				}
			],
			'II',
			'Kabupaten Bekasi'
		)
	);
	expectStatutory(book, 'FLOOR', 'KESEHATAN', 59_389, 237_555);
	expectStatutory(book, 'MID', 'KESEHATAN', 110_000, 440_000);
	expectStatutory(book, 'CAP', 'KESEHATAN', 120_000, 480_000);
	expectStatutory(book, 'CAP+1', 'KESEHATAN', 120_000, 480_000);
	expectStatutorySkipped(book, 'TKA-3M', 'KESEHATAN');
	expectStatutory(book, 'TKA-6M', 'KESEHATAN', 120_000, 480_000);
});

// ─── PPh 21 ──────────────────────────────────────────────────────────────────────────────────

test('ID audit — every PTKP status lands on its TER category (PMK 168/2023 art.9, Lampiran)', () => {
	// Wage 11,450,000, JKK group II. Gross (PMK 168/2023 art.5(1): employer premiums are income)
	// = 11,450,000 + JKK 0.54% 61,830 + JKM 0.30% 34,350 + Kesehatan 4% 458,000 = 12,004,180.
	// TER A 11,600,001–12,500,000 → 4%: 480,167.20 → 480,167.
	// TER B 11,600,001–12,600,000 → 3%: 360,125.40 → 360,125.
	// TER C 11,200,001–12,050,000 → 2%: 240,083.60 → 240,084.
	const W = 11_450_000;
	const ki = { PPH21: { kind: 'REGISTERED', elections: { ptkp: 'KI' } } };
	const people: Person[] = [
		{ key: 'TK0', wage: W, marital_status: 'SINGLE', children: 0 },
		{ key: 'TK1', wage: W, marital_status: 'SINGLE', children: 1 },
		{ key: 'K0', wage: W, gender: 'MALE', marital_status: 'MARRIED', children: 0 },
		// art.9(2)(a): a married woman is PTKP for herself alone → TK/0 → A.
		{ key: 'W-K3', wage: W, gender: 'FEMALE', marital_status: 'MARRIED', children: 3 },
		{ key: 'DIV1', wage: W, marital_status: 'DIVORCED', children: 1 },
		{ key: 'TK2', wage: W, marital_status: 'SINGLE', children: 2 },
		{ key: 'TK3', wage: W, marital_status: 'SINGLE', children: 3 },
		{ key: 'K1', wage: W, gender: 'MALE', marital_status: 'MARRIED', children: 1 },
		{ key: 'K2', wage: W, gender: 'MALE', marital_status: 'MARRIED', children: 2 },
		{ key: 'K3', wage: W, gender: 'MALE', marital_status: 'MARRIED', children: 3 },
		// UU PPh art.7(1): at most three dependants.
		{ key: 'K5', wage: W, gender: 'MALE', marital_status: 'MARRIED', children: 5 },
		// art.9(3): with the statement that her husband has no income, K/<dependants>.
		{
			key: 'W-KI-1',
			wage: W,
			gender: 'FEMALE',
			marital_status: 'MARRIED',
			children: 1,
			registrations: ki
		},
		{
			key: 'W-KI-3',
			wage: W,
			gender: 'FEMALE',
			marital_status: 'MARRIED',
			children: 3,
			registrations: ki
		}
	];
	const book = assessStatutoryUnvalidated(world('2026-04', people));
	for (const key of ['TK0', 'TK1', 'K0', 'W-K3', 'DIV1'])
		expectStatutory(book, key, 'PPH21', 480_167, 0);
	for (const key of ['TK2', 'TK3', 'K1', 'K2', 'W-KI-1'])
		expectStatutory(book, key, 'PPH21', 360_125, 0);
	for (const key of ['K3', 'K5', 'W-KI-3']) expectStatutory(book, key, 'PPH21', 240_084, 0);
});

test('ID audit — the last tax period reckons the year (PMK 168/2023; UU PPh art.17)', () => {
	// Joiners on 1 December 2026, so the year is one month (`year.months_employed` = 1).
	// Wage 100,000,000, JKK group II: gross = 100,000,000 + JKK 540,000 + JKM 300,000 +
	// Kesehatan 480,000 (cap) = 101,320,000. Biaya jabatan 5% = 5,066,000, capped at 500,000 × 1.
	// JP 1% of the 11,086,300 ceiling = 110,863; JHT 2% = 2,000,000.
	// Net before PTKP = 101,320,000 − 500,000 − 110,863 − 2,000,000 = 98,709,137.
	const ki = { PPH21: { kind: 'REGISTERED', elections: { ptkp: 'KI' } } };
	const hire = '2026-12-01';
	const book = assessStatutoryUnvalidated(
		world('2026-12', [
			{ key: 'TK0', wage: 100_000_000, hire_date: hire, marital_status: 'SINGLE' },
			{
				key: 'K3',
				wage: 100_000_000,
				hire_date: hire,
				gender: 'MALE',
				marital_status: 'MARRIED',
				children: 3
			},
			{
				key: 'W-K3',
				wage: 100_000_000,
				hire_date: hire,
				gender: 'FEMALE',
				marital_status: 'MARRIED',
				children: 3
			},
			{
				key: 'W-KI-3',
				wage: 100_000_000,
				hire_date: hire,
				gender: 'FEMALE',
				marital_status: 'MARRIED',
				children: 3,
				registrations: ki
			},
			{ key: 'TK5', wage: 100_000_000, hire_date: hire, marital_status: 'SINGLE', children: 5 },
			{ key: 'TK0-200', wage: 200_000_000, hire_date: hire, marital_status: 'SINGLE' }
		])
	);
	// TK/0: PTKP 54,000,000 → PKP 44,709,137 → 44,709,000 (art.17(4)) × 5% = 2,235,450.
	expectStatutory(book, 'TK0', 'PPH21', 2_235_450, 0);
	// K/3: PTKP 54,000,000 + 4,500,000 + 3 × 4,500,000 = 72,000,000 → PKP 26,709,137 → 26,709,000
	// × 5% = 1,335,450.
	expectStatutory(book, 'K3', 'PPH21', 1_335_450, 0);
	// Married woman without the statement: TK/0 → 2,235,450.
	expectStatutory(book, 'W-K3', 'PPH21', 2_235_450, 0);
	// With it (PMK 168/2023 art.9(3)): self + married + dependants = 72,000,000 — never the
	// spouse's 54,000,000 again → 1,335,450 (the seed had given 126,000,000 → 0).
	expectStatutory(book, 'W-KI-3', 'PPH21', 1_335_450, 0);
	// Single with five dependants: TK/3 = 67,500,000 → PKP 31,209,137 → 31,209,000 × 5% = 1,560,450.
	expectStatutory(book, 'TK5', 'PPH21', 1_560_450, 0);
	// 200,000,000: gross 200,000,000 + 1,080,000 + 600,000 + 480,000 = 202,160,000; − 500,000 −
	// 110,863 − 4,000,000 − 54,000,000 = 143,549,137 → 143,549,000; tax = 5% × 60,000,000 +
	// 15% × 83,549,000 = 3,000,000 + 12,532,350 = 15,532,350.
	expectStatutory(book, 'TK0-200', 'PPH21', 15_532_350, 0);
});

// ─── Separation ──────────────────────────────────────────────────────────────────────────────

const SEPARATION = ['PESANGON', 'UPMK', 'UANG_PISAH'] as const;

function leaver(hire: string, facts: Record<string, string | number | boolean>) {
	const { slips } = buildStatutory(
		world('2026-01', [
			{
				key: 'LEAVER',
				wage: 10_000_000,
				hire_date: hire,
				exit_date: '2026-01-31',
				exit_reason: 'DISMISSAL'
			}
		]),
		(w) => {
			w.employments[0]!.exit_facts = {
				// Idul Fitri 1447 H (SKB 2026): the religious holiday the departure's THR is judged against.
				thr_holiday_date: '2026-03-21',
				separation_wage_basis: 'MONTHLY',
				micro_small_enterprise: false,
				pension_offset_applies: false,
				...facts
			};
			const version = w.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			for (const [offset, code] of SEPARATION.entries()) {
				const catalogue = w.adhoc_catalogue!.find(
					(row) => row.settings_id === version.id && row.code === code
				)!;
				w.adhoc_requests!.push({
					id: `d2000000-0000-4000-8000-${String(offset).padStart(12, '0')}`,
					employment_id: w.employments[0]!.id,
					catalogue_id: catalogue.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: code,
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const slip = slips.get('LEAVER')!;
	const paid = (code: string) =>
		slip.adjustments.find((row) => row.component_code === code)?.amount ?? 0;
	const charge = (code: string) => slip.statutory.find((row) => row.scheme_code === code);
	return { paid, charge };
}

test('ID audit — retirement pesangon, UPMK and the final tax at the eight-year step', () => {
	// 2018-01-31 → 2026-01-31: 96 completed months. PP 35/2021 art.40(2)(i): ≥ 8 years = 9 months;
	// art.56: retirement 1.75× → 9 × 1.75 × 10,000,000 = 157,500,000. art.40(3)(b): 6–<9 years =
	// 3 months = 30,000,000. PP 68/2009 on 187,500,000: 0% × 50,000,000 + 5% × 50,000,000
	// (2,500,000) + 15% × 87,500,000 (13,125,000) = 15,625,000.
	const eight = leaver('2018-01-31', { termination_cause: 'RETIREMENT' });
	assert.equal(eight.paid('PESANGON'), 157_500_000);
	assert.equal(eight.paid('UPMK'), 30_000_000);
	assert.equal(eight.charge('PPH21_FINAL_SEVERANCE')!.employee_amount, 15_625_000);
	// 2018-02-28 → 2026-01-31: 95 months → 8 months × 1.75 × 10,000,000 = 140,000,000; UPMK still
	// 30,000,000; final tax on 170,000,000 = 2,500,000 + 15% × 70,000,000 = 13,000,000.
	const under = leaver('2018-02-28', { termination_cause: 'RETIREMENT' });
	assert.equal(under.paid('PESANGON'), 140_000_000);
	assert.equal(under.paid('UPMK'), 30_000_000);
	assert.equal(under.charge('PPH21_FINAL_SEVERANCE')!.employee_amount, 13_000_000);
});

test('ID audit — UPMK starts at three years (PP 35/2021 art.40(3)(a))', () => {
	// 36 months, closure without loss (art.44(2), 1×): pesangon 4 months = 40,000,000; UPMK 2
	// months = 20,000,000; final tax on 60,000,000 = 5% × 10,000,000 = 500,000.
	const at = leaver('2023-01-31', { termination_cause: 'CLOSURE_NO_LOSS' });
	assert.equal(at.paid('PESANGON'), 40_000_000);
	assert.equal(at.paid('UPMK'), 20_000_000);
	assert.equal(at.charge('PPH21_FINAL_SEVERANCE')!.employee_amount, 500_000);
	// 35 months: pesangon 3 months = 30,000,000; no UPMK; 30,000,000 is under the 0% tier.
	const under = leaver('2023-02-28', { termination_cause: 'CLOSURE_NO_LOSS' });
	assert.equal(under.paid('PESANGON'), 30_000_000);
	assert.equal(under.paid('UPMK'), 0);
	assert.equal(under.charge('PPH21_FINAL_SEVERANCE')?.employee_amount ?? 0, 0);
});

test('ID audit — uang pisah is uang pesangon for PP 68/2009 and leaves the TER base', () => {
	// PP 68/2009 art.1 angka 4: uang pesangon is income paid "dengan nama dan dalam bentuk apa pun"
	// in connection with the end of service — uang pisah is paid only on termination. 60,000,000
	// → 5% × 10,000,000 = 500,000 final.
	const quit = leaver('2022-01-31', {
		termination_cause: 'VOLUNTARY_RESIGNATION',
		separation_pay_amount: 60_000_000,
		separation_pay_reference: 'PKB-2026-1'
	});
	assert.equal(quit.paid('UANG_PISAH'), 60_000_000);
	assert.equal(quit.charge('PPH21_FINAL_SEVERANCE')!.employee_amount, 500_000);
	// The PPh 21 base is the month's wage and employer premiums only: 10,000,000 + JKK 0.54%
	// 54,000 + JKM 0.30% 30,000 + Kesehatan 4% 400,000 = 10,484,000.
	assert.equal(quit.charge('PPH21')!.base_amount, 10_484_000);
});

// ─── THR ─────────────────────────────────────────────────────────────────────────────────────

test('ID audit — the December 2025 version measures a Christian leaver against Christmas 2025', () => {
	// Permenaker 6/2016 art.7(1): a PKWTT worker whose employment ends from thirty days before the
	// religious holiday keeps the THR; art.7(3): a PKWT that ends before the holiday does not.
	// Christmas 25 December 2025 → the PKWTT window opens 25 November 2025. More than 12 months'
	// service → one month's wage, 10,000,000 (art.3(1)(a)).
	const w = createStatutoryWorld(
		world('2025-12', [
			{
				key: 'XT-PERM',
				wage: 10_000_000,
				religion: 'CHRISTIAN',
				hire_date: '2024-01-01',
				exit_date: '2025-12-10'
			},
			{
				key: 'XT-PKWT-20',
				wage: 10_000_000,
				religion: 'CHRISTIAN',
				employment_type: 'CONTRACT',
				hire_date: '2024-01-01',
				exit_date: '2025-12-20'
			},
			// Idulfitri 2026 is 21 March: 10 December 2025 is outside its thirty days.
			{
				key: 'MU-PERM',
				wage: 10_000_000,
				religion: 'ISLAM',
				hire_date: '2024-01-01',
				exit_date: '2025-12-10'
			}
		])
	);
	const version = w.jurisdiction_settings.find((row) =>
		String(row.effective_range.start).startsWith('2025-12')
	)!;
	const thr = w.adhoc_catalogue!.find(
		(row) => row.settings_id === version.id && row.code === 'THR'
	)!;
	// The declared holiday each departure is judged against: Christmas 2025 for the Christian
	// leavers; for the Muslim leaver the first Idul Fitri on or after 10 November 2025 (thirty days
	// before the last day) is 21 March 2026 (SKB 2026).
	const resigned = {
		termination_cause: 'VOLUNTARY_RESIGNATION',
		separation_pay_amount: 0,
		separation_pay_reference: 'NONE',
		pension_offset_applies: false,
		micro_small_enterprise: false
	};
	const holidays: Record<string, Record<string, string | number | boolean>> = {
		'XT-PERM': { ...resigned, thr_holiday_date: '2025-12-25' },
		'XT-PKWT-20': { micro_small_enterprise: false, thr_holiday_date: '2025-12-25' },
		'MU-PERM': { ...resigned, thr_holiday_date: '2026-03-21' }
	};
	for (const employment of w.employments)
		employment.exit_facts = holidays[employment.employee_number];
	for (const [index, employment] of w.employments.entries())
		w.adhoc_requests!.push({
			id: `d3000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: thr.id,
			amount: 1,
			event_date: '2025-12-01',
			pay_period: '2025-12',
			payslip_id: null,
			reason: 'THR on departure',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	const built = buildPayrollRun(
		Effect.runSync(
			gatherPayrollRun({ api: memoryPayrollApi(w), companyId: COMPANY_ID, period: '2025-12' })
		)
	);
	const paid = (key: string) => {
		const employment = w.employments.find((row) => row.employee_number === key)!;
		const slip = built.payslip_payroll_run.find(
			(row) => String(row.employment_id) === employment.id
		)!;
		return slip.adjustments
			.filter((line) => line.component_code === 'THR')
			.map((line) => line.amount);
	};
	assert.deepEqual(paid('XT-PERM'), [10_000_000]);
	assert.deepEqual(paid('XT-PKWT-20'), []);
	assert.deepEqual(paid('MU-PERM'), []);
});

// ─── Overtime of a daily-paid worker — engine gap, left failing ──────────────────────────────

test('ID audit — a daily wage is ×21 (five-day week) before the 1/173 hour (PP 35/2021 art.33(1)(b))', () => {
	// art.33(1)(b): daily 400,000 × 21 = 8,400,000 a month; art.32(2): the hour is 1/173 of it =
	// 48,554.91; the first overtime hour (art.31(1)(a)) is 1.5× = 72,832.37. The engine prices a
	// DAILY contract's hour as the day over its hours (400,000 / 8 × 1.5 = 75,000) and never reads
	// the ×21/×25 month — see the audit report, open gap G1.
	const { slips } = buildStatutory(
		world(
			'2026-01',
			[{ key: 'DAILY', wage: 400_000, pay_frequency: 'DAILY' }],
			'II',
			'Kabupaten Bekasi'
		),
		(w: PayrollWorld) => {
			const employment = w.employments[0]!;
			w.work_days.push({
				id: 'wd-daily-2026-01-05',
				employment_id: employment.id,
				work_date: '2026-01-05',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2026-01-05T09:00:00+07:00', end: '2026-01-05T19:00:00+07:00' }
				],
				approval_id: null
			});
		}
	);
	const line = slips
		.get('DAILY')!
		.adjustments.find((row) => row.family === 'WORK_DAY' && row.label === 'OT-1.5X')!;
	assert.equal(line.quantity, 1);
	assert.ok(
		Math.abs(line.amount - 72_832.37) < 1,
		`first overtime hour ${line.amount}, law 72,832.37`
	);
});

test('ID audit — validated run still builds after the audit fixes', () => {
	assessStatutory(world('2026-04', [{ key: 'W', wage: 10_000_000 }]));
	assert.equal(
		chargeOf(assessStatutory(world('2026-04', [{ key: 'W', wage: 10_000_000 }])), 'W', 'JHT')
			.employee,
		200_000
	);
});
