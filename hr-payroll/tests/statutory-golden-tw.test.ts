/**
 * Taiwan: expected payslips against the law itself, with two sealed deviations pinned.
 *
 * 勞工保險條例 §13 and §15(1); 就業保險法 §40 and §41(2); 全民健康保險法 §27(1) and §29;
 * 勞工退休金條例 §14; 勞工職業災害保險及保護法 §16 and §19(1); 所得稅法 §88 and §13 with
 * 各類所得扣繳率標準 §2(1) and §3(2). The 民國115年 grade tables run from 1 January 2026 off a
 * minimum wage of NT$29,500.
 *
 * Two assertions below pin the sealed stack rather than the statute, each with the law's figure
 * beside it: `OCC_INJURY` charges its percent on the ungraded wage (the `RISK_CLASS` band carries
 * no grade ladder — bank README NOT APPLIED #5), and the resident 5% withholding ignores the
 * NT$2,000 exemption the seed declares (`MIN_WITHHOLD:2000` is honoured only on progressive
 * awards, never on a `PERCENT` one — an engine gap; the seed's own authority string cites §13).
 */

import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped
} from './fixtures/statutory-world.ts';

test('Taiwan — LI, EI, NHI, labour pension and occupational-injury insurance, 民國115年 tables', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		// 費率編號 1 of the 勞動部 113-11-07 industry table: 行業別費率 plus the single 0.07%
		// commuting rate = 0.25%, borne wholly by the insured unit.
		riskClass: '1',
		people: [
			{ key: 'TW-28590', wage: 28_590, age: 30, citizenship: 'CITIZEN' },
			{ key: 'TW-40000', wage: 40_000, age: 55, citizenship: 'CITIZEN' },
			{ key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' }
		]
	});

	// Every premium is charged on the insured salary GRADE, not the wage. From 1 January 2026 the
	// first grade is the minimum wage 29,500, so 28,590 insures at 29,500.
	//
	// Labour insurance: ordinary-risk rate 11.5%, split 20% insured / 70% insured unit / 10%
	// government (the state's leg never reaches a payslip).
	// 29,500 × 11.5% = 3,392.50 → 678.50 / 2,374.75.
	expectStatutory(book, 'TW-28590', 'LI', 678.5, 2374.75);
	// 40,000 insures at grade 40,100: × 11.5% = 4,611.50 → 922.30 / 3,228.05.
	expectStatutory(book, 'TW-40000', 'LI', 922.3, 3228.05);
	// 60,000 is above the LI ceiling grade 45,800: × 11.5% = 5,267 → 1,053.40 / 3,686.90.
	expectStatutory(book, 'TW-60000', 'LI', 1053.4, 3686.9);

	// Employment insurance: 1% on the same ladder and the same 20/70/10 split.
	// 29,500 × 1% = 295 → 59.00 / 206.50. Together with LI that is the 12.5% combined premium
	// BLI publishes for grade 29,500: 737.50 insured / 2,581.25 employer.
	expectStatutory(book, 'TW-28590', 'EI', 59, 206.5);
	expectStatutory(book, 'TW-40000', 'EI', 80.2, 280.7); // 40,100 × 1% = 401 → 80.20 / 280.70
	expectStatutory(book, 'TW-60000', 'EI', 91.6, 320.6); // 45,800 × 1% = 458 → 91.60 / 320.60

	// National health insurance: 5.17%, split 30% insured / 60% insured unit / 10% government, and
	// §29 multiplies the insured unit's 60% by (1 + 平均眷口數), which has been 0.56 since 2024 —
	// so the employer leg is 5.17% × 60% × 1.56 = 4.83912% of the grade.
	// 29,500 × 5.17% = 1,525.15 → employee 457.545 → 457.55; employer 1,525.15 × 0.936 = 1,427.54.
	expectStatutory(book, 'TW-28590', 'NHI', 457.55, 1427.54);
	// 40,000 insures at NHI grade 40,100: 2,073.17 → 621.951 → 621.95; × 0.936 = 1,940.48.
	expectStatutory(book, 'TW-40000', 'NHI', 621.95, 1940.48);
	// 60,000 insures at NHI grade 60,800: 3,143.36 → 943.008 → 943.01; × 0.936 = 2,942.19.
	expectStatutory(book, 'TW-60000', 'NHI', 943.01, 2942.19);

	// Labour pension: 6% of the monthly contribution grade, employer only.
	expectStatutory(book, 'TW-28590', 'LABOR_PENSION', 0, 1770); // 29,500 × 6%
	expectStatutory(book, 'TW-40000', 'LABOR_PENSION', 0, 2406); // 40,100 × 6%
	expectStatutory(book, 'TW-60000', 'LABOR_PENSION', 0, 3648); // 60,800 × 6%
});

test('Taiwan — occupational-injury insurance is charged on the wage, not the insured salary', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' },
			{ key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' }
		]
	});

	// 勞工職業災害保險及保護法 §16 charges the industry rate on the 月投保薪資 — the same graded
	// salary every other Taiwanese premium uses — and §19(1) puts the whole of it on the insured
	// unit. But a `RISK_CLASS` band carries only the class: the seed has no 職災 grade ladder
	// (floor at the minimum wage, ceiling NT$72,800, 21 grades in 2026 — bank README NOT APPLIED
	// #5), so `OCC_INJURY` charges its percent against the uncapped, un-graded base. 費率編號 1
	// is 0.25% including the 0.07% commuting rate: 0.25% × 40,000 = 100 and 0.25% × 60,000 = 150.
	// (The law's graded figures would be 0.25% × 40,100 = 100.25 and, above the 職災 ladder's own
	// reach here, unassertable for 60,000.)
	//
	// 28,590 is deliberately absent: 0.25% × 28,590 floats to 71.47500000000001 under the scheme's
	// `NONE` rounding, which no exact assertion can pin — the two wages here are exactly
	// representable and carry the branch.
	expectStatutory(book, 'TW-40000', 'OCC_INJURY', 0, 100);
	expectStatutory(book, 'TW-60000', 'OCC_INJURY', 0, 150);
});

test('Taiwan — resident withholding at the 5% election, and its NT$2,000 exemption', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-28590', wage: 28_590, citizenship: 'CITIZEN' },
			{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' },
			{ key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' }
		]
	});

	// 所得稅法 §88 with 各類所得扣繳率標準 §2(1): a resident may elect withholding at 5% of the
	// full month's payment. §13 then exempts any payment whose WITHHOLDING AMOUNT does not exceed
	// NT$2,000 — the seed declares exactly this as `MIN_WITHHOLD:2000` on the resident scheme.
	//
	// The engine honours that rule only inside the two progressive paths, never on a `PERCENT`
	// award, so the exemption does not fire and the figures below are the un-exempted 5%:
	// 5% × 28,590 = 1,429.50, which the law exempts (≤ NT$2,000 → nothing withheld).
	expectStatutory(book, 'TW-28590', 'INCOME_TAX', 1429.5, 0);
	// 5% × 40,000 = 2,000.00 exactly — "does not exceed" includes equality, so the law exempts
	// this payment too.
	expectStatutory(book, 'TW-40000', 'INCOME_TAX', 2000, 0);
	// 5% × 60,000 = 3,000, above the threshold → withheld in full, law and engine agreeing.
	expectStatutory(book, 'TW-60000', 'INCOME_TAX', 3000, 0);
});

test('Taiwan — a non-resident is withheld at 18%, and is outside employment insurance', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-NR-40000', wage: 40_000, citizenship: 'FOREIGNER' },
			{ key: 'TW-NR-60000', wage: 60_000, citizenship: 'FOREIGNER' }
		]
	});

	// 各類所得扣繳率標準 §3(2): a non-resident is withheld at 18%, reduced to 6% where the full
	// month's salary is at or below 1.5 × the basic wage — 1.5 × 29,500 = 44,250 from 2026.
	expectStatutory(book, 'TW-NR-40000', 'INCOME_TAX_NON_RESIDENT', 2400, 0); // 6% × 40,000
	expectStatutory(book, 'TW-NR-60000', 'INCOME_TAX_NON_RESIDENT', 10_800, 0); // 18% × 60,000
	// The §13 NT$2,000 exemption does not extend to non-residents, and the resident election is
	// not available to them at all.
	expectStatutorySkipped(book, 'TW-NR-40000', 'INCOME_TAX');
	// 就業保險法 §5 confines employment insurance to insured persons of ROC nationality aged 15–65.
	expectStatutorySkipped(book, 'TW-NR-40000', 'EI');
	// Labour insurance, health insurance and the labour pension reach them like anyone else.
	expectStatutory(book, 'TW-NR-60000', 'LI', 1053.4, 3686.9);
	expectStatutory(book, 'TW-NR-60000', 'NHI', 943.01, 2942.19);
});
