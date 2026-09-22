/**
 * Round 2, letter C: the statutory mechanisms closed as data over the existing grammar — every
 * figure below is the law's own, worked by hand in the comment beside it.
 *
 * VN: Decree 253/2026/NĐ-CP (PDF read page by page:
 * https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/253m-ndcp.signed.pdf) arts.8(2)(g)–(h),
 * 46(2)(a), 51(2)–(3), 69(1); Circular 111/2013/TT-BTC; Decree 135/2020 art.4; Law 74/2025
 * art.31(2). MY: EPF Act Third Schedule (Act A1760) and KWSP's non-citizen page; Act 800 First
 * Schedule para 10 and Second Schedule. TW: 全民健康保險法 §31(1)(2) with NHIA 二代健保補充保險費簡介
 * (115.01.05); 各類所得扣繳率標準. ID: UU PPh art.21(5a).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	allowanceCatalogue,
	assessStatutory,
	assessStatutoryUnvalidated,
	buildStatutory,
	expectStatutory,
	expectStatutorySkipped,
	settingsVersions,
	type StatutoryBook
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';

const versionOf = (code: 'VN', start: string) =>
	settingsVersions(code).find((row) => String(row.effective_range.start).startsWith(start))!.id;

/** Put one seed allowance row, at a monthly amount, on every contract of the world. */
const allowance = (world: PayrollWorld, code: string, start: string, amount: number) => {
	const row = allowanceCatalogue('VN').find(
		(item) => item.code === code && item.settings_id === versionOf('VN', start)
	)!;
	for (const [index, employment] of world.employments.entries())
		assignAllowance(world, {
			id: `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: row.id,
			amount,
			effective_from: '2025-01-01',
			effective_to: null,
			reason: '',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
};

/** An absent charge and a zero one both mean the scheme took nothing. */
const nothing = (book: StatutoryBook, key: string, code: string) => {
	const row = book.get(key)!.get(code);
	assert.ok(row == null || (row.employee === 0 && row.employer === 0), `${key} × ${code}`);
};

test('VN — a meal allowance counts toward PIT only above the cap: 730,000 to June 2026, 1,200,000 from July (Decree 253/2026 art.8(2)(g), art.69(1)(b))', () => {
	// 20,000,000 salary, 1,500,000 meal. Insurance on the salary alone (the meal is outside the SI
	// salary): SI 8% 1,600,000 + HI 1.5% 300,000 + UI 1% 200,000 = 2,100,000; own deduction
	// 15,500,000; the 2026 monthly table is 5% to 10,000,000.
	// July: 1,500,000 − 1,200,000 = 300,000 taxable → base 20,300,000; (20,300,000 − 2,100,000 −
	// 15,500,000) × 5% = 2,700,000 × 5% = 135,000.
	const july = buildStatutory(
		{
			code: 'VN',
			period: '2026-07',
			region: 'I',
			people: [{ key: 'MEAL', wage: 20_000_000, citizenship: 'CITIZEN' }]
		},
		(world) => allowance(world, 'MEAL_ALLOWANCE', '2026-07', 1_500_000)
	);
	const pit = (slips: typeof july.slips) =>
		slips.get('MEAL')!.statutory.find((row) => row.scheme_code === 'PIT')!;
	assert.deepEqual(
		[pit(july.slips).base_amount, pit(july.slips).employee_amount],
		[20_300_000, 135_000]
	);
	// January: 1,500,000 − 730,000 = 770,000 → base 20,770,000; 3,170,000 × 5% = 158,500.
	const january = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key: 'MEAL', wage: 20_000_000, citizenship: 'CITIZEN' }]
		},
		(world) => allowance(world, 'MEAL_ALLOWANCE', '2026-01', 1_500_000)
	);
	assert.deepEqual(
		[pit(january.slips).base_amount, pit(january.slips).employee_amount],
		[20_770_000, 158_500]
	);
});

test('VN — rent the employer pays counts toward PIT at no more than 15% of the other taxable income (Decree 253/2026 art.8(2)(h))', () => {
	// 20,000,000 salary: 15% is 3,000,000. Rent of 5,000,000 enters at 3,000,000 → base
	// 23,000,000; (23,000,000 − 2,100,000 − 15,500,000) × 5% = 5,400,000 × 5% = 270,000.
	// Rent of 1,000,000 is under the cap and enters whole → 21,000,000; 3,400,000 × 5% = 170,000.
	for (const [rent, base, tax] of [
		[5_000_000, 23_000_000, 270_000],
		[1_000_000, 21_000_000, 170_000]
	] as const) {
		const { slips } = buildStatutory(
			{
				code: 'VN',
				period: '2026-07',
				region: 'I',
				people: [{ key: 'RENT', wage: 20_000_000, citizenship: 'CITIZEN' }]
			},
			(world) => allowance(world, 'HOUSING', '2026-07', rent)
		);
		const slip = slips.get('RENT')!;
		const pit = slip.statutory.find((row) => row.scheme_code === 'PIT')!;
		assert.deepEqual([pit.base_amount, pit.employee_amount], [base, tax], `rent ${rent}`);
		// The employer pays the landlord: the rent is its cost, not the worker's pay, and the
		// insurance salary does not see it.
		assert.equal(slip.gross, 20_000_000);
		const si = slip.statutory.find((row) => row.scheme_code === 'SI')!;
		assert.equal(si.base_amount, 20_000_000);
	}
});

test('VN — voluntary pension is deducted as paid, capped at 3,000,000 a month from 2026 and 1,000,000 before (Decree 253/2026 art.46(2)(a); Circular 111/2013)', () => {
	const claim = (period: string, amount: number) => ({
		PIT: {
			kind: 'REGISTERED',
			deduction_claims: [
				{ period, category: 'VOLUNTARY_PENSION', amount, source: 'EMPLOYEE', reference: 'VP-1' }
			]
		}
	});
	// 30,000,000 salary: SI 2,400,000 + HI 450,000 + UI 300,000 = 3,150,000.
	// July 2026, 4,000,000 paid → 3,000,000 deducted: 30,000,000 − 3,150,000 − 15,500,000 −
	// 3,000,000 = 8,350,000 × 5% = 417,500. 2,000,000 paid → deducted whole: 9,350,000 × 5% =
	// 467,500. None: 11,350,000 → 500,000 + 1,350,000 × 10% = 635,000.
	const july = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [
			{
				key: 'VP-4M',
				wage: 30_000_000,
				citizenship: 'CITIZEN',
				registrations: claim('2026-07', 4_000_000)
			},
			{
				key: 'VP-2M',
				wage: 30_000_000,
				citizenship: 'CITIZEN',
				registrations: claim('2026-07', 2_000_000)
			},
			{ key: 'VP-0', wage: 30_000_000, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(july, 'VP-4M', 'PIT', 417_500, 0);
	expectStatutory(july, 'VP-2M', 'PIT', 467_500, 0);
	expectStatutory(july, 'VP-0', 'PIT', 635_000, 0);
	// December 2025, the old 1,000,000 cap, the 11,000,000 own deduction and the seven-rung table
	// (5% to 5,000,000, 10% to 10,000,000, 15% to 18,000,000). UI 1% of 30,000,000 is under the
	// 99,200,000 cap. 4,000,000 paid → 1,000,000: 30,000,000 − 3,150,000 − 11,000,000 − 1,000,000 =
	// 14,850,000 → 750,000 + 4,850,000 × 15% = 1,477,500. December with no finalisation
	// authorised stays on the monthly table.
	const december = assessStatutory({
		code: 'VN',
		period: '2025-12',
		region: 'I',
		people: [
			{
				key: 'VP-4M',
				wage: 30_000_000,
				citizenship: 'CITIZEN',
				registrations: claim('2025-12', 4_000_000)
			}
		]
	});
	expectStatutory(december, 'VP-4M', 'PIT', 1_477_500, 0);
});

test('VN — December is re-priced on the annual table only for an employee who authorised the employer to finalise (Decree 126/2020 art.8(6)(d); Decree 253/2026 art.51(2))', () => {
	// The July joiner of the golden, 60,000,000 a month, without the authorisation: December stays
	// on the monthly table — 60,000,000 − 5,407,000 (SI 4,048,000 + HI 759,000 on the 50,600,000
	// cap, UI 600,000) − 15,500,000 = 39,093,000 → 500,000 + 2,000,000 + 9,093,000 × 20% =
	// 4,318,600. (Authorised, the golden refunds the year's over-withholding instead.)
	const book = assessStatutory({
		code: 'VN',
		period: '2026-12',
		region: 'I',
		people: [{ key: 'VN-JULY', wage: 60_000_000, citizenship: 'CITIZEN', hire_date: '2026-07-01' }]
	});
	expectStatutory(book, 'VN-JULY', 'PIT', 4_318_600, 0);
});

test('VN — a foreign hire is outside insurance by the retirement age of the year the contract was signed (Law 41/2024 art.2(2)(b); Decree 135/2020 art.4)', () => {
	// Decree 135/2020 art.4: a man's retirement age is 60y3m in 2021, three months more each year —
	// 61y3m (735 months) in 2025 and 61y6m (738) in 2026. Both men are 61y4m (736 months) on the day
	// they were hired.
	// Hired 1 March 2025 (born 1 November 1963): 736 ≥ 735 → outside SI and HI for good, though the
	// 2026 age (738) would have let him in.
	// Hired 1 February 2026 (born 1 October 1964): 736 < 738 → insured: 8% and 17.5% of 20,000,000.
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [
			{
				key: 'F-2025',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				gender: 'MALE',
				birth_date: '1963-11-01',
				hire_date: '2025-03-01'
			},
			{
				key: 'F-2026',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				gender: 'MALE',
				birth_date: '1964-10-01',
				hire_date: '2026-02-01'
			}
		]
	});
	nothing(book, 'F-2025', 'SI');
	nothing(book, 'F-2025', 'HI');
	expectStatutory(book, 'F-2026', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'F-2026', 'HI', 300_000, 600_000);
});

test('VN — an employee who qualifies for a pension is outside unemployment insurance (Law 74/2025 art.31(2))', () => {
	// Otherwise 1% each side of 20,000,000 = 200,000.
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [
			{
				key: 'QUALIFIED',
				wage: 20_000_000,
				citizenship: 'CITIZEN',
				registrations: { UI: { kind: 'REGISTERED', elections: { pension_qualified: true } } }
			},
			{ key: 'NOT-YET', wage: 20_000_000, citizenship: 'CITIZEN' }
		]
	});
	nothing(book, 'QUALIFIED', 'UI');
	expectStatutory(book, 'NOT-YET', 'UI', 200_000, 200_000);
});

test('VN — under the December 2025 version the premium of overtime beyond the art.107 limit is taxed (Circular 111/2013 art.3(1)(i))', () => {
	// December 2025 has 23 weekdays: 18,400,000 ÷ 23 ÷ 8 = 100,000 an hour. Monday 8 December,
	// 09:00–23:00 less the hour's break is 13 worked hours: 5 beyond the normal day at 150%. Four
	// are within the art.107(2)(b) four-hour limit (600,000, premium 4 × 50,000 = 200,000, exempt);
	// the fifth (150,000) is beyond it and taxed whole. (Its night premium, art.98(3), is its own
	// line, outside this version's PIT base.) PIT base 18,400,000 + 750,000 − 200,000 =
	// 18,950,000. Insurance on the salary: 1,472,000 + 276,000 + 184,000 = 1,932,000. Taxable
	// 18,950,000 − 1,932,000 − 11,000,000 = 6,018,000 → 250,000 + 1,018,000 × 10% = 351,800.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2025-12',
			region: 'I',
			people: [{ key: 'OT', wage: 18_400_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'OT')!;
			world.work_days.push({
				id: 'wd-OT-2025-12-08',
				employment_id: employment.id,
				work_date: '2025-12-08',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2025-12-08T09:00:00+07:00', end: '2025-12-08T23:00:00+07:00' }
				],
				approval_id: null
			});
		}
	);
	const pit = slips.get('OT')!.statutory.find((row) => row.scheme_code === 'PIT')!;
	assert.deepEqual([pit.base_amount, pit.employee_amount], [18_950_000, 351_800]);
});

test('MY — a non-citizen EPF member from before 1 August 1998 stays on Parts A and C, not Part F (Act A1760; KWSP)', () => {
	for (const lineage of ['MY', 'MY-nihon'] as const) {
		// A non-citizen on EPF or EIS declares both answers (round 5, D15).
		const elector = {
			EPF: { kind: 'REGISTERED', elections: { member_before_1998: true } },
			EIS: { kind: 'REGISTERED', elections: { mykas_resident: false } },
			EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' }
		};
		const book = assessStatutory({
			code: lineage,
			period: '2026-07',
			people: [
				{ key: 'F-40', wage: 3000, age: 40, citizenship: 'FOREIGNER', registrations: elector },
				{ key: 'F-62', wage: 3000, age: 62, citizenship: 'FOREIGNER', registrations: elector },
				{
					key: 'F-NEW',
					wage: 3000,
					age: 40,
					citizenship: 'FOREIGNER',
					registrations: {
						EPF: { kind: 'REGISTERED', elections: { member_before_1998: false } },
						EIS: { kind: 'REGISTERED', elections: { mykas_resident: false } }
					}
				}
			]
		});
		// Part A on the 3,000 bracket: 11% = 330, 13% = 390.
		expectStatutory(book, 'F-40', 'EPF', 330, 390);
		// Part C from 60: 5.5% × 3,000 = 165, 6.5% = 195.
		expectStatutory(book, 'F-62', 'EPF_PR', 165, 195);
		expectStatutorySkipped(book, 'F-62', 'EPF');
		// Everyone else: Part F, 2% each of 3,000 = 60 / 60, and never Part A.
		expectStatutory(book, 'F-NEW', 'EPF_NON_CITIZEN', 60, 60);
		expectStatutorySkipped(book, 'F-NEW', 'EPF');
	}
});

test('MY — a foreign employee is outside the EIS by rule, except the para 10(b)/(c) identity-card holder (Act 800 First Schedule para 10)', () => {
	for (const lineage of ['MY', 'MY-nihon'] as const) {
		const book = assessStatutory({
			code: lineage,
			period: '2026-07',
			people: [
				// Registered, declared not a card holder: the rule, not a NOT_REGISTERED record, keeps
				// him out. An undeclared non-citizen on EIS refuses (round 5, D15).
				{
					key: 'F',
					wage: 3000,
					age: 40,
					citizenship: 'FOREIGNER',
					registrations: {
						EPF: { kind: 'REGISTERED', elections: { member_before_1998: false } },
						EIS: { kind: 'REGISTERED', elections: { mykas_resident: false } }
					}
				},
				{
					key: 'F-MYKAS',
					wage: 3000,
					age: 40,
					citizenship: 'FOREIGNER',
					registrations: {
						EPF: { kind: 'REGISTERED', elections: { member_before_1998: false } },
						EIS: { kind: 'REGISTERED', elections: { mykas_resident: true } }
					}
				},
				{ key: 'PR', wage: 3000, age: 40, citizenship: 'PERMANENT_RESIDENT' }
			]
		});
		expectStatutorySkipped(book, 'F', 'EIS');
		// Second Schedule row 34, wages over RM2,900 to RM3,000: RM5.90 each.
		expectStatutory(book, 'F-MYKAS', 'EIS', 5.9, 5.9);
		expectStatutory(book, 'PR', 'EIS', 5.9, 5.9);
	}
});

test('TW — salary paid to a worker not insured here carries the 2.11% NHI supplement from the minimum wage (健保法 §31(1)(2))', () => {
	const elsewhere = { NHI: { kind: 'NOT_REGISTERED' }, NHI_SUPPLEMENT: { kind: 'NOT_REGISTERED' } };
	const book = assessStatutory({
		code: 'TW',
		period: '2026-07',
		riskClass: '1',
		people: [
			// 30,000 ≥ the 29,500 minimum wage: 30,000 × 2.11% = 633.
			{ key: 'PT-30000', wage: 30_000, citizenship: 'CITIZEN', registrations: elsewhere },
			// 29,000 < 29,500: not withheld on (NHIA: 未達基本工資 無需扣取).
			{ key: 'PT-29000', wage: 29_000, citizenship: 'CITIZEN', registrations: elsewhere },
			// A 第2類 insured with proof on file.
			{
				key: 'PT-UNION',
				wage: 30_000,
				citizenship: 'CITIZEN',
				registrations: {
					...elsewhere,
					NHI_PART_TIME: { kind: 'REGISTERED', elections: { exempt: true } }
				}
			},
			// Insured through this unit: its own premium, never this one.
			{ key: 'INSURED', wage: 30_000, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'PT-30000', 'NHI_PART_TIME', 633, 0);
	nothing(book, 'PT-29000', 'NHI_PART_TIME');
	nothing(book, 'PT-UNION', 'NHI_PART_TIME');
	nothing(book, 'INSURED', 'NHI_PART_TIME');
});

test('TW — the non-resident 6% band ends at one and a half times the minimum wage (各類所得扣繳率標準 §3)', () => {
	// 1.5 × 28,590 = 42,885 (December 2025); 1.5 × 29,500 = 44,250 (2026). At the line: 6%, the
	// fraction discarded — 42,885 × 6% = 2,573.1 → 2,573; 44,250 × 6% = 2,655. One dollar above:
	// 18% — 42,886 × 18% = 7,719.48 → 7,719; 44,251 × 18% = 7,965.18 → 7,965.
	for (const [period, at, atTax, above, aboveTax] of [
		['2025-12', 42_885, 2_573, 42_886, 7_719],
		['2026-07', 44_250, 2_655, 44_251, 7_965]
	] as const) {
		const book = assessStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [
				{ key: 'AT', wage: at, citizenship: 'FOREIGNER', tax_residency: 'NON_RESIDENT' },
				{ key: 'ABOVE', wage: above, citizenship: 'FOREIGNER', tax_residency: 'NON_RESIDENT' }
			]
		});
		expectStatutory(book, 'AT', 'INCOME_TAX_NON_RESIDENT', atTax, 0);
		expectStatutory(book, 'ABOVE', 'INCOME_TAX_NON_RESIDENT', aboveTax, 0);
	}
});

test('ID — without an NPWP or a NIK valid as one, PPh 21 is withheld 20% higher (UU PPh art.21(5a))', () => {
	// The golden's TK/0 15,000,000: gross with the employer's JKK 0.54% (81,000), JKM 0.30%
	// (45,000) and Kesehatan 4% of the 12,000,000 cap (480,000) = 15,606,000, TER A 7% =
	// 1,092,420. Without a tax id: × 1.2 = 1,310,904.
	const book = assessStatutoryUnvalidated({
		code: 'ID',
		period: '2026-01',
		region: 'DKI Jakarta',
		riskClass: 'II',
		people: [
			{ key: 'NIK', wage: 15_000_000, marital_status: 'SINGLE' },
			{
				key: 'NO-ID',
				wage: 15_000_000,
				marital_status: 'SINGLE',
				registrations: { PPH21: { kind: 'REGISTERED', elections: { no_tax_id: true } } }
			}
		]
	});
	expectStatutory(book, 'NIK', 'PPH21', 1_092_420, 0);
	expectStatutory(book, 'NO-ID', 'PPH21', 1_310_904, 0);
});
