/**
 * Vietnam: expected payslips against the sealed stack.
 *
 * Law on Social Insurance 41/2024/QH15; Law on Health Insurance; Law on Employment 74/2025/QH15;
 * Trade Union Law 50/2024/QH15; PIT Law 04/2007 art.22 with Resolution 110/2025/UBTVQH15, and
 * PIT Law 109/2025/QH15 from 1 July 2026.
 *
 * The insurance figures below are the law's, straight. The PIT figures are not the month's
 * withholding-table figure, and the two tests say so beside each derivation: the engine
 * annualises every progressive withholding (PROJECT gross, RELIEVE, SCALE, SPREAD), and a
 * social-security relief counts only what has actually been paid in the year so far — the
 * deliberate asymmetry of `contribute.ts` (decision E9): a retirement-fund relief is projected
 * because the employee will certainly keep contributing, a social-security one is not. The
 * sealed PIT seed carries no `RELIEF_PROJECTED` on SI/HI/UI, so a January run relieves one
 * month of insurance against twelve months of gross, and a standalone July run annualises
 * July–December against the full annual personal relief. The year total still converges; the
 * monthly distribution is front-loaded. The law's monthly-table figure sits beside each
 * derivation so the gap is measured, not hidden.
 */

import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced
} from './fixtures/statutory-world.ts';

const VN_PEOPLE = [
	{ key: 'VN-20M', wage: 20_000_000, age: 25, citizenship: 'CITIZEN' },
	{ key: 'VN-46.8M', wage: 46_800_000, citizenship: 'CITIZEN' },
	{ key: 'VN-60M', wage: 60_000_000, age: 55, citizenship: 'CITIZEN' },
	{ key: 'VN-FOREIGN', wage: 20_000_000, citizenship: 'FOREIGNER' }
];

test('Vietnam — SI, HI, UI and the union fee under the 1 January 2026 version', () => {
	// Region I: `companies.region` picks the minimum wage the UI cap is a multiple of.
	const book = assessStatutory({ code: 'VN', period: '2026-01', people: VN_PEOPLE, region: 'I' });

	// Social insurance: employee 8%, employer 17.5% (3% sickness-maternity + 0.5% occupational +
	// 14% retirement and survivorship), capped at 20 × the reference level 2,340,000 = 46,800,000.
	expectStatutory(book, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-46.8M', 'SI', 3_744_000, 8_190_000); // exactly on the ceiling
	expectStatutory(book, 'VN-60M', 'SI', 3_744_000, 8_190_000); // capped

	// Health insurance: 4.5% total, employee 1.5% / employer 3%, on the same ceiling.
	expectStatutory(book, 'VN-20M', 'HI', 300_000, 600_000);
	expectStatutory(book, 'VN-46.8M', 'HI', 702_000, 1_404_000);
	expectStatutory(book, 'VN-60M', 'HI', 702_000, 1_404_000);

	// Unemployment insurance: 1% each side, capped at 20 × the REGIONAL minimum wage — Region I
	// from 1 January 2026 is 5,310,000, so the cap is 106,200,000 and never binds here.
	expectStatutory(book, 'VN-20M', 'UI', 200_000, 200_000);
	expectStatutory(book, 'VN-46.8M', 'UI', 468_000, 468_000);
	expectStatutory(book, 'VN-60M', 'UI', 600_000, 600_000);
	// Law 74/2025 covers Vietnamese citizens: a foreign employee is outside the scheme entirely.
	expectStatutorySkipped(book, 'VN-FOREIGN', 'UI');

	// Union budget contribution: 2% of the social-insurance salary fund, employer only, same cap.
	expectStatutory(book, 'VN-20M', 'UNION_FEE', 0, 400_000);
	expectStatutory(book, 'VN-60M', 'UNION_FEE', 0, 936_000);
});

test('Vietnam — monthly PIT withholding on the 1 January 2026 scale', () => {
	const book = assessStatutory({ code: 'VN', period: '2026-01', people: VN_PEOPLE, region: 'I' });

	// Circular 111/2013 art.25 withholds on the monthly table; the seeded scale is the five-bracket
	// table of Law 109/2025 (≤10M at 5%, >10–30M at 10%, >30–60M at 20%, >60–100M at 30%, >100M at
	// 35%), annualised. PROJECT annualises the wage and the insurance relief alike, RELIEVE the
	// 186,000,000 personal deduction (Resolution 110/2025), SCALE and SPREAD over twelve payslips —
	// which lands on the month's own table figure.
	//
	// VN-20M: 20,000,000 − 2,100,000 (1,600,000 + 300,000 + 200,000) − 15,500,000 = 2,400,000 at
	// 5% = 120,000.
	expectStatutory(book, 'VN-20M', 'PIT', 120_000, 0);
	// VN-46.8M: 46,800,000 − 4,914,000 − 15,500,000 = 26,386,000: 500,000 + 16,386,000 × 10% =
	// 2,138,600.
	expectStatutory(book, 'VN-46.8M', 'PIT', 2_138_600, 0);
	// VN-60M: 60,000,000 − 5,046,000 − 15,500,000 = 39,454,000: 500,000 + 2,000,000 + 9,454,000 ×
	// 20% = 4,390,800.
	expectStatutory(book, 'VN-60M', 'PIT', 4_390_800, 0);
	// A foreign employee runs the same resident scale minus the UI they are outside:
	// 20,000,000 − 1,900,000 − 15,500,000 = 2,600,000 at 5% = 130,000.
	expectStatutory(book, 'VN-FOREIGN', 'PIT', 130_000, 0);
});

test('Vietnam — the 1 July 2026 version raises the ceiling and replaces the PIT scale', () => {
	const book = assessStatutory({ code: 'VN', period: '2026-07', people: VN_PEOPLE, region: 'I' });

	// The reference level rises to 2,530,000, so the SI/HI ceiling becomes 20 × 2,530,000 =
	// 50,600,000: 8% = 4,048,000 and 17.5% = 8,855,000; 1.5% = 759,000 and 3% = 1,518,000.
	expectStatutory(book, 'VN-60M', 'SI', 4_048_000, 8_855_000);
	expectStatutory(book, 'VN-60M', 'HI', 759_000, 1_518_000);
	expectStatutory(book, 'VN-60M', 'UNION_FEE', 0, 1_012_000); // 2% × 50,600,000
	// The regional minimum did not move on 1 July, so UI is unchanged.
	expectStatutory(book, 'VN-60M', 'UI', 600_000, 600_000);

	// PIT Law 109/2025/QH15, five brackets from 1 July 2026: monthly ≤10M at 5%, >10–30M at 10%,
	// >30–60M at 20%, >60–100M at 30%, >100M at 35%, seeded annualised. A standalone July run has
	// no year-to-date, so PROJECT covers July–December only — six payslips against the full annual
	// personal relief (E9). These pin the engine's figures; the month's own table gives 120,000 for
	// VN-20M, 2,138,600 for VN-46.8M and 4,390,800 for VN-60M. A mid-year joiner with no history is
	// the one population this residue reaches; a run with year-to-date lands on the table.
	expectStatutory(book, 'VN-20M', 'PIT', 0, 0);
	expectStatutory(book, 'VN-46.8M', 'PIT', 544_300, 0);
	expectStatutory(book, 'VN-60M', 'PIT', 1_359_300, 0);
});

test('Vietnam — the December 2025 version, and the regional cap that moves off it', () => {
	// The first sealed version: Decree 74/2024 regional minimum wages, the 2,340,000 reference
	// level, and the Resolution 954/2020 family deductions of 132,000,000 / 52,800,000 a year.
	// A wage of 120,000,000 is the only way to see the unemployment ceiling, which is the one
	// figure the 1 January 2026 version actually moves.
	const people = [
		{ key: 'VN-20M', wage: 20_000_000, citizenship: 'CITIZEN' },
		{ key: 'VN-120M', wage: 120_000_000, citizenship: 'CITIZEN' },
		{ key: 'VN-200M', wage: 200_000_000, citizenship: 'CITIZEN' }
	];
	const december = assessStatutory({ code: 'VN', period: '2025-12', people, region: 'I' });
	const january = assessStatutory({ code: 'VN', period: '2026-01', people, region: 'I' });

	// Social and health insurance did not move: 8% / 17.5% and 1.5% / 3% on the same twenty times
	// the 2,340,000 reference level = 46,800,000 ceiling.
	expectStatutory(december, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(december, 'VN-120M', 'SI', 3_744_000, 8_190_000);
	expectStatutory(december, 'VN-120M', 'HI', 702_000, 1_404_000);
	expectStatutory(december, 'VN-120M', 'UNION_FEE', 0, 936_000); // 2% × 46,800,000

	// Unemployment insurance is 1% each side, capped at twenty times the REGIONAL minimum wage.
	// Region I is 4,960,000 to 31 December 2025 (Decree 74/2024) → cap 99,200,000 → 992,000, and
	// 5,310,000 from 1 January 2026 (Decree 293/2025, +7.2%) → cap 106,200,000 → 1,062,000.
	expectStatutory(december, 'VN-120M', 'UI', 992_000, 992_000);
	expectStatutory(january, 'VN-120M', 'UI', 1_062_000, 1_062_000);

	// PIT on the seven-rung annual ladder with the Resolution 954/2020 deduction of 132,000,000.
	// A December payslip projects no further month — the tax year is over — so the annual income
	// is the month's own. 200,000,000 − (3,744,000 + 702,000 + 992,000) − 132,000,000 =
	// 62,562,000, in the 60,000,000–120,000,000 rung: 3,000,000 + 2,562,000 × 10% = 3,256,200.
	// (On the 1 January 2026 version's 186,000,000 deduction the same month yields 428,100, so
	// this figure is the December relief and not a restatement of the later one.)
	expectStatutory(december, 'VN-200M', 'PIT', 3_256_200, 0);
	// 120,000,000 is under 132,000,000 + the insurance relief, so there is nothing to withhold.
	expectStatutory(december, 'VN-120M', 'PIT', 0, 0);
});

test('Vietnam — the đồng above the ceiling is charged on the ceiling', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [{ key: 'VN-50600000.01', wage: 50_600_000.01 }]
	});
	// 20 × 2,530,000 = 50,600,000: SI 8% / 17.5%, HI 1.5% / 3%, union 2% employer, all on the cap.
	expectStatutory(book, 'VN-50600000.01', 'SI', 4_048_000, 8_855_000);
	expectStatutory(book, 'VN-50600000.01', 'HI', 759_000, 1_518_000);
	expectStatutory(book, 'VN-50600000.01', 'UNION_FEE', 0, 1_012_000);
});

test('every sealed version of `VN` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('VN');
});
