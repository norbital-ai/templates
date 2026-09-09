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
	expectStatutorySkipped
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

	// PROJECT: a January monthly payslip annualises to twelve months of gross. RELIEVE: the
	// 186,000,000 personal deduction (Resolution 110/2025, annual, in full) plus the insurance
	// actually paid so far — January alone, unprojected (E9). SCALE the seven-rung annual ladder,
	// SPREAD over the 12 payslips.
	//
	// VN-20M: 240,000,000 − 186,000,000 − 2,100,000 (1,600,000 + 300,000 + 200,000) = 51,900,000,
	// in the 0–60,000,000 rung at 5% → 2,595,000 → /12 = 216,250. The month's own table gives
	// 20,000,000 − 2,100,000 − 15,500,000 = 2,400,000 × 5% = 120,000.
	expectStatutory(book, 'VN-20M', 'PIT', 216_250, 0);
	// VN-46.8M: 561,600,000 − 186,000,000 − 4,914,000 = 370,686,000, in the 216,000,000–
	// 384,000,000 rung at 20% over the cumulative 23,400,000: 23,400,000 + 154,686,000 × 20% =
	// 54,337,200 → /12 = 4,528,100. The month's own table gives 26,386,000 in the 18,000,000–
	// 32,000,000 rung: 1,950,000 + 8,386,000 × 20% = 3,627,200.
	expectStatutory(book, 'VN-46.8M', 'PIT', 4_528_100, 0);
	// VN-60M: 720,000,000 − 186,000,000 − 5,046,000 = 528,954,000, in the 384,000,000–624,000,000
	// rung at 25% over 57,000,000: 57,000,000 + 144,954,000 × 25% = 93,238,500 → /12 = 7,769,875.
	// The month's own table gives 39,454,000 in the 32,000,000–52,000,000 rung: 4,750,000 +
	// 7,454,000 × 25% = 6,613,500.
	expectStatutory(book, 'VN-60M', 'PIT', 7_769_875, 0);
	// A foreign employee runs the same resident scale — the seed carries no non-resident PIT
	// branch — minus the UI they are outside: 240,000,000 − 186,000,000 − 1,900,000 = 52,100,000
	// → 5% = 2,605,000 → /12 = 217,083.333 → 217,083.33.
	expectStatutory(book, 'VN-FOREIGN', 'PIT', 217_083.33, 0);
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
	// >30–60M at 20%, >60–100M at 30%, >100M at 35%, seeded annualised. PROJECT from a standalone
	// July run covers July–December only — six payslips, no year-to-date — against the full
	// annual personal relief, plus July's insurance alone.
	// VN-20M: 120,000,000 − 186,000,000 − 2,100,000 < 0 → nothing withheld. The month's own table
	// gives (20,000,000 − 2,100,000 − 15,500,000) = 2,400,000 in the ≤10M rung at 5% = 120,000.
	expectStatutory(book, 'VN-20M', 'PIT', 0, 0);
	// VN-46.8M: 280,800,000 − 186,000,000 − 4,914,000 = 89,886,000, in the 0–120,000,000 rung at
	// 5% → 4,494,300 → /6 = 749,050.
	expectStatutory(book, 'VN-46.8M', 'PIT', 749_050, 0);
	// VN-60M: 360,000,000 − 186,000,000 − 5,407,000 = 168,593,000, in the 120,000,000–360,000,000
	// rung at 10% over the cumulative 6,000,000: 6,000,000 + 48,593,000 × 10% = 10,859,300 →
	// /6 = 1,809,883.333 → 1,809,883.33. The month's own table gives 39,093,000 in the >30–60M
	// rung at 20% over the cumulative 2,500,000: 2,500,000 + 9,093,000 × 20% = 4,318,600.
	expectStatutory(book, 'VN-60M', 'PIT', 1_809_883.33, 0);
});
