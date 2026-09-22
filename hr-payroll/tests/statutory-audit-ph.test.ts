// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Philippines — independent audit (2026-09-23). Every expected figure is derived by hand from the
 * instrument named beside it; none was read off the engine.
 *
 * Instruments:
 * - SSS Circular 2024-006, 2025 schedule (in force through 2026; no later circular):
 *   https://www.sss.gov.ph/sss-contribution-table/ — MSC ₱5,000–₱35,000 in ₱500 steps, EE 5% /
 *   ER 10%; Regular SS to MSC ₱20,000, MPF (WISP) on the MSC above it; EC ₱10 below MSC ₱15,000,
 *   ₱30 from it. Compensation below ₱5,250 → MSC ₱5,000; ₱34,750 and over → MSC ₱35,000.
 * - PhilHealth Advisory 2026-0042 (5% of monthly income, ₱500 minimum, ₱5,000 at ₱100,000):
 *   https://www.philhealth.gov.ph/advisories/2026/PA2026-0042.pdf
 * - HDMF Circular 460: 1% EE / 2% ER to ₱1,500, 2% / 2% above, fund salary cap ₱10,000.
 * - RA 10361 s.30: a kasambahay under ₱5,000 a month pays nothing; the employer pays both shares.
 * - BIR RR 11-2018 Annex E (2023 onward), monthly column: ≤20,833 → 0; 20,833–33,333 → 15% over
 *   20,833; 33,333–66,667 → 1,875 + 20%; 66,667–166,667 → 8,541.80 + 25%; 166,667–666,667 →
 *   33,541.80 + 30%; over 666,667 → 183,541.80 + 35%.
 *   https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf
 * - NIRC s.32(B)(7)(e): ₱90,000 on 13th-month pay and other benefits.
 * - DOLE Handbook on Workers' Statutory Monetary Benefits (2023), ch.1 §D–E (factors 365/313/261:
 *   the 261 and 313 factors count the 12 regular holidays and 8 special days as paid days),
 *   ch.2 §D (regular holiday: 100% unworked, 200% worked), ch.3 §C (special day: no work no pay;
 *   worked 130%), ch.4 §D table ("equivalent pay"), ch.15 (retirement: daily rate × 22.5 days
 *   per year, a fraction of six months a year).
 *   https://nwpc.dole.gov.ph/wp-content/uploads/2023/08/2023-07-25-Handbook-on-Workers-Statutory-Monetary-Benefits-2023_edition.pdf
 * - RA 11210 s.5 with BIR RMC 105-2019: the SSS maternity benefit and the employer's salary
 *   differential are exempt from income tax and withholding on compensation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	buildStatutory,
	createStatutoryWorld,
	COMPANY_ID
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';

/** One period per sealed version: 2025-12-01, 2026-01-01, 2026-04-01, 2026-09-26. */
const VERSION_PERIODS = ['2025-12', '2026-01', '2026-04', '2026-10'] as const;
const PH_2026 = 'bb5137fd-d7fd-4a26-8eae-77211521f892';
// The version governing 31 January 2026 since RR 29-2025 split January on the 6th: a separation
// row must come from the catalogue in force on the final service day.
const PH_2026_JAN6 = 'b585862c-5438-5a97-a36d-44e55ceb5498';

/** [employee, employer] of one scheme; a scheme the person is outside reads as nothing owed. */
const owed = (book, key: string, code: string): [number, number] => {
	const row = book.get(key)?.get(code);
	return row == null ? [0, 0] : [row.employee, row.employer];
};

// ─────────────────────────────────────────────────────────────────────────────
// SSS, EC and MPF at every bracket seam that moves a figure, on every version.
// ─────────────────────────────────────────────────────────────────────────────

for (const period of VERSION_PERIODS) {
	test(`PH audit ${period}: SSS / MPF / EC at the Circular 2024-006 seams`, () => {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [
				{ key: 'S-5249.99', wage: 5249.99 },
				{ key: 'S-14749.99', wage: 14_749.99 },
				{ key: 'S-14750', wage: 14_750 },
				{ key: 'S-20249.99', wage: 20_249.99 },
				{ key: 'S-20250', wage: 20_250 },
				{ key: 'S-34749.99', wage: 34_749.99 },
				{ key: 'S-34750', wage: 34_750 }
			]
		});
		// 5,249.99 < 5,250 → MSC 5,000: 5% = 250, 10% = 500; EC ₱10 (MSC < 15,000); no MPF.
		assert.deepEqual(owed(book, 'S-5249.99', 'SSS'), [250, 500]);
		assert.deepEqual(owed(book, 'S-5249.99', 'SSS_MPF'), [0, 0]);
		assert.deepEqual(owed(book, 'S-5249.99', 'SSS_EC'), [0, 10]);
		// 14,250 ≤ 14,749.99 < 14,750 → MSC 14,500: 725 / 1,450; EC ₱10.
		assert.deepEqual(owed(book, 'S-14749.99', 'SSS'), [725, 1450]);
		assert.deepEqual(owed(book, 'S-14749.99', 'SSS_EC'), [0, 10]);
		// 14,750 → MSC 15,000: 750 / 1,500; EC ₱30 from MSC 15,000.
		assert.deepEqual(owed(book, 'S-14750', 'SSS'), [750, 1500]);
		assert.deepEqual(owed(book, 'S-14750', 'SSS_EC'), [0, 30]);
		// 20,249.99 → MSC 20,000, all Regular SS: 1,000 / 2,000; MPF nothing.
		assert.deepEqual(owed(book, 'S-20249.99', 'SSS'), [1000, 2000]);
		assert.deepEqual(owed(book, 'S-20249.99', 'SSS_MPF'), [0, 0]);
		// 20,250 → MSC 20,500: Regular SS 20,000 → 1,000 / 2,000; MPF 500 → 25 / 50.
		assert.deepEqual(owed(book, 'S-20250', 'SSS'), [1000, 2000]);
		assert.deepEqual(owed(book, 'S-20250', 'SSS_MPF'), [25, 50]);
		// 34,749.99 → MSC 34,500: MPF 14,500 → 725 / 1,450.
		assert.deepEqual(owed(book, 'S-34749.99', 'SSS_MPF'), [725, 1450]);
		// 34,750 → MSC 35,000 (the ceiling): MPF 15,000 → 750 / 1,500; EC ₱30.
		assert.deepEqual(owed(book, 'S-34750', 'SSS'), [1000, 2000]);
		assert.deepEqual(owed(book, 'S-34750', 'SSS_MPF'), [750, 1500]);
		assert.deepEqual(owed(book, 'S-34750', 'SSS_EC'), [0, 30]);
	});

	test(`PH audit ${period}: PhilHealth floor, ceiling and centavo split; Pag-IBIG tiers and cap`, () => {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [
				{ key: 'P-9999.99', wage: 9999.99 },
				{ key: 'P-45678.20', wage: 45_678.2 },
				{ key: 'P-100000', wage: 100_000 },
				{ key: 'P-150000', wage: 150_000 },
				{ key: 'H-1500', wage: 1500 },
				{ key: 'H-9000', wage: 9000 }
			]
		});
		// Below the ₱10,000 floor the premium is 5% × 10,000 = 500 → 250 / 250.
		assert.deepEqual(owed(book, 'P-9999.99', 'PHIC'), [250, 250]);
		// 45,678.20 × 5% = 2,283.91; employee half truncated 1,141.95, employer the rest 1,141.96.
		assert.deepEqual(owed(book, 'P-45678.20', 'PHIC'), [1141.95, 1141.96]);
		// At the ₱100,000 ceiling 5,000 → 2,500 each; above it the ceiling holds.
		assert.deepEqual(owed(book, 'P-100000', 'PHIC'), [2500, 2500]);
		assert.deepEqual(owed(book, 'P-150000', 'PHIC'), [2500, 2500]);
		// Pag-IBIG: at ₱1,500 the 1% tier — 15 employee, 2% = 30 employer.
		assert.deepEqual(owed(book, 'H-1500', 'HDMF'), [15, 30]);
		// 9,000: 2% / 2% = 180 / 180 (under the ₱10,000 fund-salary cap).
		assert.deepEqual(owed(book, 'H-9000', 'HDMF'), [180, 180]);
	});

	test(`PH audit ${period}: a kasambahay under ₱5,000 pays nothing; the employer pays both shares (RA 10361 s.30)`, () => {
		const book = assessStatutory({
			code: 'PH',
			period,
			// NCR: the one region whose domestic-worker wage order the versions state (NCR-DW-05/06),
			// so WTAX can place her below the floor; elsewhere it refuses (round 5).
			region: 'NCR',
			people: [{ key: 'K-4000', wage: 4000, employment_type: 'DOMESTIC' }]
		});
		// SSS: 4,000 → MSC 5,000: 250 + 500 = 750, all employer.
		assert.deepEqual(owed(book, 'K-4000', 'SSS'), [0, 750]);
		// PhilHealth: the ₱10,000 floor, 500, all employer.
		assert.deepEqual(owed(book, 'K-4000', 'PHIC'), [0, 500]);
		// Pag-IBIG: 4,000 > 1,500 → 2% + 2% = 80 + 80 = 160, all employer.
		assert.deepEqual(owed(book, 'K-4000', 'HDMF'), [0, 160]);
		// EC is employer-only in every case: MSC 5,000 < 15,000 → ₱10.
		assert.deepEqual(owed(book, 'K-4000', 'SSS_EC'), [0, 10]);
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Withholding: every rung of the monthly column, and the 20,833 seam to the centavo.
// ─────────────────────────────────────────────────────────────────────────────

// December is the year-end rung (RR 11-2018 s.2.79(B)(5)(b), annualised), so the 2025-12 version
// is priced on the annual table below; the monthly column is read on the three later versions.
for (const period of VERSION_PERIODS.filter((value) => value !== '2025-12')) {
	test(`PH audit ${period}: Annex E monthly column, every rung`, () => {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [
				{ key: 'T-22751.79', wage: 22_751.79 },
				{ key: 'T-22752.82', wage: 22_752.82 },
				{ key: 'T-60000', wage: 60_000 },
				{ key: 'T-100000', wage: 100_000 },
				{ key: 'T-200000', wage: 200_000 },
				{ key: 'T-800000', wage: 800_000 }
			]
		});
		// 22,751.79: SSS MSC 23,000 → Regular 1,000 + MPF (3,000 × 5%) 150 = 1,150; PhilHealth
		// 5% = 1,137.59 → employee 568.79; Pag-IBIG 200. Taxable 22,751.79 − 1,918.79 = 20,833.00,
		// exactly the top of the nil rung → 0.
		assert.equal(owed(book, 'T-22751.79', 'WTAX')[0], 0);
		// 22,752.82: PhilHealth 1,137.64 → 568.82; taxable 22,752.82 − 1,918.82 = 20,834.00 →
		// 15% × 1.00 = 0.15.
		assert.equal(owed(book, 'T-22752.82', 'WTAX')[0], 0.15);
		// 60,000: SSS 1,750 (MSC 35,000), PhilHealth 1,500, Pag-IBIG 200 → 56,550 →
		// 1,875 + 20% × (56,550 − 33,333) = 1,875 + 4,643.40 = 6,518.40.
		assert.deepEqual(owed(book, 'T-60000', 'WTAX'), [6518.4, 0]);
		// 100,000: 1,750 + 2,500 + 200 = 4,450 → 95,550 → 8,541.80 + 25% × 28,883 = 15,762.55.
		assert.deepEqual(owed(book, 'T-100000', 'WTAX'), [15_762.55, 0]);
		// 200,000: 4,450 (PhilHealth at its ceiling) → 195,550 → 33,541.80 + 30% × 28,883 =
		// 33,541.80 + 8,664.90 = 42,206.70.
		assert.deepEqual(owed(book, 'T-200000', 'WTAX'), [42_206.7, 0]);
		// 800,000: → 795,550 → 183,541.80 + 35% × 128,883 = 183,541.80 + 45,109.05 = 228,650.85.
		assert.deepEqual(owed(book, 'T-800000', 'WTAX'), [228_650.85, 0]);
	});
}

test('PH audit 2025-12: December annualises on the TRAIN annual table (RR 11-2018 s.2.79(B)(5)(b))', () => {
	// The fixture year holds December's pay alone, so the annual taxable compensation is the
	// month's, net of the month's SSS, PhilHealth and Pag-IBIG (NIRC s.32(B)(7)(f)):
	// annual table (NIRC s.24(A)(2)(a), 2023 onward): ≤250,000 → 0; 250,000–400,000 → 15% over
	// 250,000; 400,000–800,000 → 22,500 + 20% over 400,000; …
	const book = assessStatutory({
		code: 'PH',
		period: '2025-12',
		people: [
			{ key: 'Y-60000', wage: 60_000 },
			{ key: 'Y-300000', wage: 300_000 },
			{ key: 'Y-800000', wage: 800_000 }
		]
	});
	// 60,000 − 3,450 = 56,550 a year: under 250,000 → nothing.
	assert.equal(owed(book, 'Y-60000', 'WTAX')[0], 0);
	// 300,000 − (1,750 + 2,500 + 200) = 295,550 → 15% × 45,550 = 6,832.50.
	assert.equal(owed(book, 'Y-300000', 'WTAX')[0], 6832.5);
	// 800,000 − 4,450 = 795,550 → 22,500 + 20% × 395,550 = 22,500 + 79,110 = 101,610.
	assert.equal(owed(book, 'Y-800000', 'WTAX')[0], 101_610);
});

test('PH audit 2026-02: a rice subsidy over the RR 29-2025 ceiling stays exempt inside the ₱90,000 pool', () => {
	// RR 29-2025 s.1(d): rice subsidy ₱2,500 a month is de minimis; RR 2-98 s.2.78.1(B)(11) (as
	// amended): the excess over a de minimis ceiling is an "other benefit" under the ₱90,000
	// exclusion, so with nothing else in the pool the ₱100 excess is still exempt.
	// 40,000: SSS 1,750 (MSC 35,000), PhilHealth 1,000, Pag-IBIG 200 → 37,050 →
	// 1,875 + 20% × (37,050 − 33,333) = 1,875 + 743.40 = 2,618.40 — as if no subsidy were paid.
	const MEAL_2026 = '874b6d04-8bf1-4d59-b4c4-18daf98a98e5';
	const book = assessStatutory(
		{ code: 'PH', period: '2026-02', people: [{ key: 'R-40000', wage: 40_000 }] },
		(world) =>
			assignAllowance(world, {
				employment_id: world.employments[0]!.id,
				catalogue_id: MEAL_2026,
				amount: 2600,
				effective_from: '2026-01-01',
				effective_to: null
			})
	);
	assert.deepEqual(owed(book, 'R-40000', 'WTAX'), [2618.4, 0]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 13th month at the ₱90,000 line, and its base (PD 851 Revised Guidelines; Handbook ch.13 §C–D).
// ─────────────────────────────────────────────────────────────────────────────

const THIRTEENTH_MONTH_2026 = '4fddc3cc-7bf8-42c4-8f43-7d9ef87605d6';

function decemberWith13th(people, prepare?: (world) => void) {
	const world = createStatutoryWorld({ code: 'PH', period: '2026-12', people });
	for (const [index, employment] of world.employments.entries())
		world.adhoc_requests!.push({
			id: `a1000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: THIRTEENTH_MONTH_2026,
			amount: 1,
			event_date: '2026-12-01',
			pay_period: null,
			payslip_id: null,
			reason: '13th month',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	prepare?.(world);
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-12' })
	);
	const built = buildPayrollRun(prepared);
	return (key: string) => {
		const employment = world.employments.find((row) => row.employee_number === key)!;
		const slip = built.payslip_payroll_run.find(
			(row) => String(row.employment_id) === employment.id
		)!;
		return {
			thirteenth: slip.adjustments
				.filter((row) => row.component_code === 'THIRTEENTH_MONTH_PAY')
				.reduce((sum, row) => sum + row.amount, 0),
			wtaxBase: slip.statutory.find((row) => row.scheme_code === 'WTAX')?.base_amount
		};
	};
}

test('PH audit 2026-12: 13th month exactly ₱90,000 is wholly excluded from the withholding base', () => {
	// The fixture year holds December's salary alone, so the 13th month is 1,080,000 ÷ 12 =
	// 90,000 — exactly the NIRC s.32(B)(7)(e) exclusion: nothing enters the base beyond the salary.
	const slip = decemberWith13th([{ key: 'X-1080000', wage: 1_080_000 }]);
	assert.equal(slip('X-1080000').thirteenth, 90_000);
	assert.equal(slip('X-1080000').wtaxBase, 1_080_000);
});

test('PH audit 2026-12: the 13th month is a twelfth of the basic salary actually earned — an unpaid day is not earned', () => {
	// Handbook ch.13 §D: "total basic salary earned during the year ÷ 12"; its illustration nets
	// leave without pay out of the month (September, ten days LWOP: 9,810.83). ₱30,000 on the
	// 261 factor loses 30,000 ÷ 21.75 = 1,379.31 for one unpaid day, so December's basic earned is
	// 28,620.69 and the 13th month (the fixture year holds December alone) 28,620.69 ÷ 12 =
	// 2,385.0575 → 2,385.06.
	const NPL = 'c1c1c1c1-0000-4000-8000-0000000000cc';
	const slip = decemberWith13th([{ key: 'X-LWOP', wage: 30_000 }], (world) => {
		world.leave_catalogue.push({
			id: NPL,
			settings_id: '288c7099-5797-59d8-9944-85197f09b4fb',
			code: 'LEAVE_WITHOUT_PAY',
			name: 'Leave without pay',
			eligibility: '',
			evidence: 'NONE',
			evidence_after_days: null,
			entitlement: { availability: 'UNLIMITED', year_start_month: 1, proration: 'NONE', bands: [] },
			is_npl: true,
			can_encash: false,
			bands: [],
			approval_id: null
		});
		const employment = world.employments[0]!;
		const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
		world.leave_entries.push({
			id: 'e1000000-0000-4000-8000-00000000lw01',
			employment_id: employment.id,
			catalogue_id: NPL,
			leave_code: 'LEAVE_WITHOUT_PAY',
			reference: 'LWOP-DEC',
			from_date: '2026-12-15',
			to_date: '2026-12-15',
			half_day_start: false,
			half_day_end: false,
			days: 1,
			effective_on: '2026-12-15',
			reason: 'no work, no pay',
			allocations: [],
			charges: [
				{
					date: '2026-12-15',
					days: 1,
					catalogue_id: NPL,
					employment_term_id: term.id,
					holiday_id: null,
					shift_definition_id: null,
					work_day_id: null
				}
			],
			approval_id: null,
			payslip_id: null
		});
	});
	assert.equal(slip('X-LWOP').thirteenth, 2385.06);
});

// ─────────────────────────────────────────────────────────────────────────────
// Holiday pay: the Handbook's rates are the day's TOTAL ("equivalent pay"), and the salary line
// already pays the day for a monthly-salaried person on the 261/313/365 factors and for a
// daily-paid person on a rostered day. EXPECTED TO FAIL until the bands price the premium only.
// ─────────────────────────────────────────────────────────────────────────────

const holiday = (world, date: string, kind: 'PUBLIC_HOLIDAY' | 'SPECIAL_HOLIDAY') =>
	world.jurisdiction_holidays.push({
		id: `h-${date}`,
		company_id: COMPANY_ID,
		date,
		name: kind,
		kind,
		replaces: null,
		given_to: null,
		source: null,
		published_at: '2025-12-01T00:00:00.000Z',
		approval_id: null
	});
const punch = (world, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		approval_id: null
	});
};

test('PH audit 2026-01: a worked regular holiday is 200% of the day in all, a worked special day 130% (Handbook ch.2 §D, ch.3 §C, ch.4 §D)', () => {
	// Monday 5 January a regular holiday, Tuesday 6 January a special (non-working) day; the
	// fixture shift is 09:00–18:00 with an unpaid hour, so a punch of 09:00–18:00 is 8 hours.
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{ key: 'HOL-M', wage: 21_750 },
				{ key: 'HOL-D', wage: 600, pay_frequency: 'DAILY' },
				{ key: 'HOL-D-OFF', wage: 600, pay_frequency: 'DAILY' }
			]
		},
		(world) => {
			holiday(world, '2026-01-05', 'PUBLIC_HOLIDAY');
			holiday(world, '2026-01-06', 'SPECIAL_HOLIDAY');
			for (const key of ['HOL-M', 'HOL-D']) {
				punch(world, key, '2026-01-05', '09:00', '18:00');
				punch(world, key, '2026-01-06', '09:00', '18:00');
			}
		}
	);
	// HOL-M: ₱21,750 a month on the 261 factor is ₱1,000 a day (21,750 × 12 ÷ 261), ₱125 an hour.
	// The 261 factor counts the 12 regular holidays and 8 special days as paid days (Handbook
	// ch.1 §E.2(c)), so the salary already pays 100% of both days. Work on them adds the rest:
	// 200% − 100% = 100% → 8 × 125 = 1,000; 130% − 100% = 30% → 8 × 125 × 0.3 = 300.
	// Gross = 21,750 + 1,000 + 300 = 23,050.
	// HOL-D, ₱600 a day, Monday–Friday: January 2026 has 22 weekdays, 20 ordinary.
	// 20 × 600 = 12,000; regular holiday worked 200% = 1,200; special day worked 130% = 780.
	// Gross = 13,980.
	// HOL-D-OFF works neither day: the unworked regular holiday is paid 100% (present on Friday
	// 2 January, the workday before), the unworked special day nothing ("no work, no pay").
	// 20 × 600 + 600 = 12,600.
	assert.deepEqual(
		['HOL-M', 'HOL-D', 'HOL-D-OFF'].map((key) => slips.get(key)!.gross),
		[23_050, 13_980, 12_600]
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Maternity leave pay is outside withholding (RA 11210 s.5; BIR RMC 105-2019).
// EXPECTED TO FAIL: WTAX cannot yet read the pay attributable to a leave code.
// ─────────────────────────────────────────────────────────────────────────────

test('PH audit 2026-02: a month wholly on maternity leave carries no withholding (RMC 105-2019)', () => {
	const MATERNITY = 'c1c1c1c1-0000-4000-8000-0000000000bb';
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-02',
			people: [{ key: 'MAT-30000', wage: 30_000, gender: 'FEMALE' }]
		},
		(world) => {
			// The seed's own row, with its entitlement gate opened: this case is about the tax
			// treatment of the pay, not the 105-day grant (covered by leave-entitlement-golden).
			world.leave_catalogue.push({
				id: MATERNITY,
				settings_id: PH_2026,
				code: 'MATERNITY_LEAVE',
				name: 'Maternity leave',
				eligibility: '',
				evidence: 'NONE',
				evidence_after_days: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				is_npl: false,
				can_encash: false,
				bands: [],
				approval_id: null
			});
			const employment = world.employments[0]!;
			const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
			const dates: string[] = [];
			// The run's attendance window, 21 January – 20 February: an entry settles in one period.
			for (let day = new Date('2026-01-21T00:00:00Z'); day <= new Date('2026-02-20T00:00:00Z');) {
				if (![0, 6].includes(day.getUTCDay())) dates.push(day.toISOString().slice(0, 10));
				day.setUTCDate(day.getUTCDate() + 1);
			}
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-00000000ma01',
				employment_id: employment.id,
				catalogue_id: MATERNITY,
				leave_code: 'MATERNITY_LEAVE',
				reference: 'MAT-2026',
				from_date: dates[0]!,
				to_date: dates.at(-1)!,
				half_day_start: false,
				half_day_end: false,
				days: dates.length,
				effective_on: dates[0]!,
				reason: 'childbirth',
				allocations: [],
				charges: dates.map((date) => ({
					date,
					days: 1,
					catalogue_id: MATERNITY,
					employment_term_id: term.id,
					holiday_id: null,
					shift_definition_id: null,
					work_day_id: null
				})),
				approval_id: null,
				payslip_id: null
			});
		}
	);
	// The whole month's pay is the SSS benefit plus the salary differential — both exempt — so
	// the withholding base is nil and nothing is withheld. (Outside the leave the same ₱30,000
	// withholds 15% × (27,550 − 20,833) = 1,007.55.)
	const wtax = slips.get('MAT-30000')!.statutory.find((row) => row.scheme_code === 'WTAX');
	assert.equal(wtax?.employee_amount ?? 0, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Retirement pay (RA 7641, Labor Code art.302; Handbook ch.15) and separation pay (arts.298–299)
// at the six-month fraction.
// ─────────────────────────────────────────────────────────────────────────────

test('PH audit 2026-01: retirement pay is 22.5 days a year, six months counting a year; separation at the same seam', () => {
	const leaver = (key: string, hire: string, reason: string, age: number, wage = 26_100) => ({
		key,
		wage,
		age,
		hire_date: hire,
		exit_date: '2026-01-31',
		exit_reason: reason
	});
	const people = [
		leaver('RET-10Y8M', '2015-06-01', 'RETIREMENT', 62),
		leaver('RET-5Y5M', '2020-09-01', 'RETIREMENT', 62),
		leaver('RET-5Y6M', '2020-08-01', 'RETIREMENT', 62),
		leaver('RET-59', '2015-06-01', 'RETIREMENT', 59),
		leaver('RED-5Y6M', '2020-08-01', 'REDUNDANCY', 40, 30_000)
	];
	const { slips } = buildStatutory({ code: 'PH', period: '2026-01', people }, (world) => {
		const rows = Object.fromEntries(
			['RETIREMENT_PAY', 'SEPARATION_PAY'].map((code) => [
				code,
				world.adhoc_catalogue!.find(
					(item) => item.code === code && item.settings_id === PH_2026_JAN6
				)!
			])
		);
		for (const [index, person] of people.entries()) {
			const employment = world.employments.find((row) => row.employee_number === person.key)!;
			// Labor Code art.298: the authorised cause, recorded on the departure.
			if (person.exit_reason === 'REDUNDANCY')
				employment.exit_facts = { termination_cause: 'REDUNDANCY' };
			world.adhoc_requests!.push({
				id: `a2000000-0000-4000-8000-00000000000${index}`,
				employment_id: employment.id,
				catalogue_id:
					rows[person.exit_reason === 'REDUNDANCY' ? 'SEPARATION_PAY' : 'RETIREMENT_PAY'].id,
				amount: 0,
				event_date: '2026-01-31',
				pay_period: '2026-01',
				payslip_id: null,
				reason: 'separation',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	});
	const paid = (key: string, code: string) =>
		slips
			.get(key)!
			.adjustments.filter((row) => row.component_code === code)
			.reduce((sum, row) => sum + row.amount, 0);
	// ₱26,100 a month on the 261 factor (the fixture's five-day week): 26,100 × 12 ÷ 261 = 1,200
	// a day; half a month's salary is 22.5 days = 27,000 a year of service.
	// 1 Jun 2015 – 31 Jan 2026 is 10 years 8 months → 11 years: 11 × 27,000 = 297,000.
	// 1 Sep 2020 – 31 Jan 2026 is 5 years 5 months → 5 years: 135,000.
	// 1 Aug 2020 – 31 Jan 2026 is 5 years 6 months → the fraction of six months is a year: 6 ×
	// 27,000 = 162,000.
	// Under sixty RA 7641 owes nothing.
	// Redundancy, 5 years 6 months at ₱30,000: 6 × 30,000 = 180,000 (art.298).
	assert.deepEqual(
		[
			paid('RET-10Y8M', 'RETIREMENT_PAY'),
			paid('RET-5Y5M', 'RETIREMENT_PAY'),
			paid('RET-5Y6M', 'RETIREMENT_PAY'),
			paid('RET-59', 'RETIREMENT_PAY'),
			paid('RED-5Y6M', 'SEPARATION_PAY')
		],
		[297_000, 135_000, 162_000, 0, 180_000]
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// The sealed data itself: wage floors and the obligation register.
// ─────────────────────────────────────────────────────────────────────────────

import { settingsVersions } from './fixtures/statutory-world.ts';

test('PH audit: wage-order floors are the daily rate × 313 ÷ 12 on each version, by area and sector', () => {
	// Wage Order NCR-26 (18 Jul 2025): ₱695 non-agriculture, ₱658 agriculture / retail-service of
	// 15 or fewer / manufacturing under 10. NCR-28 (26 Sep 2026): +₱60 → ₱755 / ₱718.
	// IVA-22 (5 Oct 2025): ₱600 EMA and component cities; ₱550 1st class; ₱510 reclassified 1st
	// and 2nd–5th class, → ₱550 / ₱525 on 1 Apr 2026; retail/service of 10 or fewer ₱485
	// (₱425 + 60), → ₱508 on 1 Apr 2026 (+23). https://nwpc.dole.gov.ph/ncr/ and /region-iva/
	const f = (daily: number) => Math.round((daily * 313 * 100) / 12) / 100;
	const expected = {
		'2025-12-01': {
			NCR: f(695),
			'NCR-AGRI-SMALL': f(658),
			'IV-A': f(600),
			'IV-A-1ST': f(550),
			'IV-A-RECLASSIFIED-1ST': f(510),
			'IV-A-2ND-5TH': f(510),
			'IV-A-RETAIL-SMALL': f(485)
		},
		'2026-01-01': {
			NCR: f(695),
			'NCR-AGRI-SMALL': f(658),
			'IV-A': f(600),
			'IV-A-1ST': f(550),
			'IV-A-RECLASSIFIED-1ST': f(510),
			'IV-A-2ND-5TH': f(510),
			'IV-A-RETAIL-SMALL': f(485)
		},
		// RR 29-2025 (6 January) and NCR-DW-06 (7 February) move no establishment floor.
		'2026-01-06': {
			NCR: f(695),
			'NCR-AGRI-SMALL': f(658),
			'IV-A': f(600),
			'IV-A-1ST': f(550),
			'IV-A-RECLASSIFIED-1ST': f(510),
			'IV-A-2ND-5TH': f(510),
			'IV-A-RETAIL-SMALL': f(485)
		},
		'2026-02-07': {
			NCR: f(695),
			'NCR-AGRI-SMALL': f(658),
			'IV-A': f(600),
			'IV-A-1ST': f(550),
			'IV-A-RECLASSIFIED-1ST': f(510),
			'IV-A-2ND-5TH': f(510),
			'IV-A-RETAIL-SMALL': f(485)
		},
		'2026-04-01': {
			NCR: f(695),
			'NCR-AGRI-SMALL': f(658),
			'IV-A': f(600),
			'IV-A-1ST': f(550),
			'IV-A-RECLASSIFIED-1ST': f(550),
			'IV-A-2ND-5TH': f(525),
			'IV-A-RETAIL-SMALL': f(508)
		},
		'2026-09-26': {
			NCR: f(755),
			'NCR-AGRI-SMALL': f(718),
			'IV-A': f(600),
			'IV-A-1ST': f(550),
			'IV-A-RECLASSIFIED-1ST': f(550),
			'IV-A-2ND-5TH': f(525),
			'IV-A-RETAIL-SMALL': f(508)
		}
	};
	for (const version of settingsVersions('PH')) {
		const start = String(version.effective_range.start).slice(0, 10);
		assert.deepEqual(version.work_rules.wages.by_region, expected[start], start);
	}
});

test('PH audit: every version carries the same dated obligation register, each row with an authority', () => {
	const registers = settingsVersions('PH').map((version) => version.obligations);
	for (const register of registers) {
		assert.deepEqual(register, registers[0]);
		const codes = register.map((row) => row.code);
		assert.equal(new Set(codes).size, codes.length, 'codes unique');
		for (const row of register) assert.match(row.code, /^[A-Z0-9_]+$/);
	}
	const codes = registers[0]!.map((row) => row.code);
	for (const code of [
		'SSS_CONTRIBUTION_REMITTANCE',
		'PHILHEALTH_PREMIUM_REMITTANCE',
		'HDMF_CONTRIBUTION_REMITTANCE',
		'BIR_1601C_MONTHLY_REMITTANCE',
		'BIR_2316_CERTIFICATE',
		'BIR_1604C_ANNUAL_ALPHALIST',
		'THIRTEENTH_MONTH_PAY_AND_REPORT',
		'FINAL_PAY_AND_CERTIFICATE'
	])
		assert.ok(codes.includes(code), code);
});
