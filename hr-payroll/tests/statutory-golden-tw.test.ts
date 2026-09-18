/**
 * Taiwan: expected payslips against the law itself, with the sealed deviations pinned.
 *
 * 勞工保險條例 §13 and §15(1) with 施行細則 §28-1 and §33; 就業保險法 §40 and §41(2); 全民健康保險法
 * §27(1) and §29 with 施行細則 §52; 勞工退休金條例 §14; 勞工職業災害保險及保護法 §16, §17 and §19(1);
 * 所得稅法 §88 with 各類所得扣繳率標準 §2(1), §3(2) and §13; 勞動基準法 §24, §32(2), §35 and §39. The
 * 民國115年 grade tables run from 1 January 2026 off a minimum wage of NT$29,500.
 *
 * Every insurance premium is a whole NT$: 勞保施行細則 §33 and 健保施行細則 §52 compute to the 元, 角以下
 * 四捨五入, and the 分擔金額表 both bureaus publish — the figures an employer deducts and is billed —
 * are the per-scheme exact share rounded to the dollar. 勞保 and 就保 round separately, which is
 * exactly how the Bureau's combined table is built (29,500: 勞工 679 + 59 = 738, 單位 2,375 + 207 =
 * 2,582 — BLI Files/25697, 30-day row). Withholding tax is left to the cent; the standard states no
 * rounding.
 *
 * A part month insures at the declared grade for the enrolled days on a thirty-day month (勞保施行
 * 細則 §28-1; the scheme rules read `period.days_employed` and `period.days_in_month`), and 健保 is
 * a whole-month premium billed to the unit the person is insured with at month end (健保法 §30).
 * The one deviation pinned with the law's figure beside it: a resident withholding of exactly
 * NT$2,000 is exempt (§13, 「不超過」).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	settingsVersions,
	contributionSchemes,
	COMPANY_ID,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { evaluateNumber, expressionEngine } from '../src/lib/expressions/evaluate.ts';

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
			{ key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' },
			// The same 40,000 wage with two dependants, and with four — 健保法 §18(2) charges the
			// insured person for their dependants as well, counted to a maximum of three.
			{ key: 'TW-40000-D2', wage: 40_000, age: 55, citizenship: 'CITIZEN', children: 2 },
			{ key: 'TW-40000-D4', wage: 40_000, age: 55, citizenship: 'CITIZEN', children: 4 }
		]
	});

	// Every premium is charged on the insured salary GRADE, not the wage. From 1 January 2026 the
	// first grade is the minimum wage 29,500, so 28,590 insures at 29,500.
	//
	// Labour insurance: ordinary-risk rate 11.5%, split 20% insured / 70% insured unit / 10%
	// government (the state's leg never reaches a payslip), each leg rounded to the dollar.
	// 29,500 × 11.5% = 3,392.50 → 678.50 → 679 / 2,374.75 → 2,375.
	expectStatutory(book, 'TW-28590', 'LI', 679, 2375);
	// 40,000 insures at grade 40,100: × 11.5% = 4,611.50 → 922.30 → 922 / 3,228.05 → 3,228.
	expectStatutory(book, 'TW-40000', 'LI', 922, 3228);
	// 60,000 is above the LI ceiling grade 45,800: × 11.5% = 5,267 → 1,053.40 → 1,053 / 3,686.90 → 3,687.
	expectStatutory(book, 'TW-60000', 'LI', 1053, 3687);

	// Employment insurance: 1% on the same ladder and the same 20/70/10 split.
	// 29,500 × 1% = 295 → 59 / 206.50 → 207. Together with LI that is the 12.5% combined premium
	// BLI publishes for grade 29,500: 738 insured / 2,582 employer (Files/25697, 30 days).
	expectStatutory(book, 'TW-28590', 'EI', 59, 207);
	expectStatutory(book, 'TW-40000', 'EI', 80, 281); // 401 → 80.20 → 80 / 280.70 → 281 (table 1,002 / 3,509)
	expectStatutory(book, 'TW-60000', 'EI', 92, 321); // 458 → 91.60 → 92 / 320.60 → 321 (table 1,145 / 4,008)

	// National health insurance: 5.17%, split 30% insured / 60% insured unit / 10% government, and
	// §29 multiplies the insured unit's 60% by (1 + 平均眷口數), which has been 0.56 since 2024 —
	// so the employer leg is 5.17% × 60% × 1.56 = 4.83912% of the grade.
	// 29,500 × 5.17% = 1,525.15 → employee 457.545 → 458; employer 1,525.15 × 0.936 = 1,427.54 → 1,428.
	expectStatutory(book, 'TW-28590', 'NHI', 458, 1428);
	// 40,000 insures at NHI grade 40,100: 2,073.17 → 621.951 → 622; × 0.936 = 1,940.49 → 1,940.
	expectStatutory(book, 'TW-40000', 'NHI', 622, 1940);
	// The dependant legs, each the whole-dollar 622 the childless 40,000 earner pays. Two dependants
	// is three heads, four is capped at three, so four dependants pays the same as three. The
	// insured unit's leg never moves: it is already an average over the whole insured population
	// (眷口數 0.56), which is the ×1.56 inside the seeded rate.
	expectStatutory(book, 'TW-40000-D2', 'NHI', 1866, 1940);
	expectStatutory(book, 'TW-40000-D4', 'NHI', 2488, 1940);
	// 60,000 insures at NHI grade 60,800: 3,143.36 → 943.008 → 943; × 0.936 = 2,942.18 → 2,942.
	expectStatutory(book, 'TW-60000', 'NHI', 943, 2942);

	// Labour pension: 6% of the monthly contribution grade, employer only. Every grade is a
	// multiple of 100, so 6% is always whole.
	expectStatutory(book, 'TW-28590', 'LABOR_PENSION', 0, 1770); // 29,500 × 6%
	expectStatutory(book, 'TW-40000', 'LABOR_PENSION', 0, 2406); // 40,100 × 6%
	expectStatutory(book, 'TW-60000', 'LABOR_PENSION', 0, 3648); // 60,800 × 6%
});

test('Taiwan — labour and employment insurance end at 65, and the run still builds', () => {
	// 勞保條例 §6(1) and 就保法 §5 both cover 「年滿十五歲以上，六十五歲以下」, so cover ends at 65.
	// The limit was on the BANDS, and a band that has no row for an age refuses the whole run by
	// name — so one 65-year-old employee stopped every Taiwanese payroll, for everybody. A scheme
	// the person is outside is skipped instead: no charge, no zero row, and the payslip is built.
	//
	// 職災保險 and 健保 keep going: 災保法 covers a worker whatever their age, which is why it is a
	// separate scheme, and 健保 is residence-based rather than employment-age-based.
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-64', wage: 40_000, age: 64, citizenship: 'CITIZEN' },
			{ key: 'TW-65', wage: 40_000, age: 65, citizenship: 'CITIZEN' },
			{ key: 'TW-70', wage: 40_000, age: 70, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'TW-64', 'LI', 922, 3228);
	expectStatutory(book, 'TW-64', 'EI', 80, 281);
	for (const key of ['TW-65', 'TW-70']) {
		expectStatutorySkipped(book, key, 'LI');
		expectStatutorySkipped(book, key, 'EI');
		// Still insured for health and for occupational injury, and still priced.
		expectStatutory(book, key, 'NHI', 622, 1940);
		expectStatutory(book, key, 'OCC_INJURY', 0, 100);
	}
});

test('Taiwan — occupational-injury insurance is charged on its own grade ladder, to 72,800', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-28590', wage: 28_590, citizenship: 'CITIZEN' },
			{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' },
			{ key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' },
			// Above the 職災 ceiling, which is its own and higher than 勞保's.
			{ key: 'TW-150000', wage: 150_000, citizenship: 'CITIZEN' }
		]
	});

	// 勞工職業災害保險及保護法 §16 charges the industry rate on the 月投保薪資 and §19(1) puts the whole
	// of it on the insured unit; §17 gives 職災 its own 分級表, twenty-one grades from 29,500 to
	// 72,800 (勞動部 114年11月17日 勞動保3字第1140090499號令, BLI Files/25664). 費率編號 1 is 0.25%
	// including the 0.07% commuting rate, on the GRADE, rounded to the dollar: 28,590 insures at
	// 29,500 → 73.75 → 74; 40,000 at 40,100 → 100.25 → 100; 60,000 at 60,800 → 152; a 150,000 salary
	// at the top grade 72,800 → 182. One `GRADE_LADDER` statement says floor, ceiling and the steps
	// between.
	expectStatutory(book, 'TW-28590', 'OCC_INJURY', 0, 74);
	expectStatutory(book, 'TW-40000', 'OCC_INJURY', 0, 100);
	expectStatutory(book, 'TW-60000', 'OCC_INJURY', 0, 152);
	expectStatutory(book, 'TW-150000', 'OCC_INJURY', 0, 182);
	// The other Taiwanese schemes have their own, lower ceilings and are unmoved by this one.
	expectStatutory(book, 'TW-150000', 'LI', 1053, 3687);
});

test('Taiwan — resident withholding at the 5% election, and its NT$2,000 exemption', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'TW-28590',
				wage: 28_590,
				citizenship: 'CITIZEN',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			},
			{
				key: 'TW-40000',
				wage: 40_000,
				citizenship: 'CITIZEN',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			},
			{
				key: 'TW-60000',
				wage: 60_000,
				citizenship: 'CITIZEN',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			},
			{ key: 'TW-60000-TABLE', wage: 60_000, citizenship: 'CITIZEN' }
		]
	});

	// 所得稅法 §88 with 各類所得扣繳率標準 §2(1)(1): monthly salary is withheld by the 扣繳稅額表
	// unless the recipient elects 5% of the full month's payment (`five_percent_withholding`).
	// §13 then exempts any payment whose WITHHOLDING AMOUNT does not exceed NT$2,000 — the seed
	// declares exactly this as `<= 2000` on the resident scheme.
	//
	// Without the election the table reads 60,000: the bracket's lower bound 59,501 × 12 =
	// 714,012 − 600,000 = 114,012 × 5% = 5,700.60 ÷ 12 = 475.05 → 470, under 2,000 → nothing.
	expectStatutory(book, 'TW-60000-TABLE', 'INCOME_TAX', 0, 0);
	//
	// 5% × 28,590 = 1,429.50, below the threshold: nothing is withheld.
	expectStatutory(book, 'TW-28590', 'INCOME_TAX', 0, 0);
	// 5% × 40,000 = 2,000.00 exactly. §13's "不超過新臺幣二千元者，免予扣繳" includes equality, and
	// the scheme's own rule says `<= 2000`, so the law's figure here is 0.
	expectStatutory(book, 'TW-40000', 'INCOME_TAX', 0, 0);
	// 5% × 60,000 = 3,000, above the threshold → withheld in full.
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
	expectStatutory(book, 'TW-NR-60000', 'LI', 1053, 3687);
	expectStatutory(book, 'TW-NR-60000', 'NHI', 943, 2942);
});

test('Taiwan — the 民國114年 grade tables of the first sealed version', () => {
	// The 2025-12-01 version carries the 民國114年 tables off a minimum wage of NT$28,590, and the
	// 1 January 2026 version replaces them with the 民國115年 tables off NT$29,500. The rates are
	// identical across the seam; every figure that moves does so because the GRADE moved.
	const book = assessStatutory({
		code: 'TW',
		period: '2025-12',
		riskClass: '1',
		people: [
			{ key: 'TW-28590', wage: 28_590, citizenship: 'CITIZEN' },
			{ key: 'TW-29500', wage: 29_500, citizenship: 'CITIZEN' },
			{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' },
			// 1.5 × the basic wage is the non-resident 6%/18% breakpoint: 42,885 in 民國114年,
			// against 44,250 in 民國115年.
			{ key: 'TW-NR-42885', wage: 42_885, citizenship: 'FOREIGNER' },
			{ key: 'TW-NR-42886', wage: 42_886, citizenship: 'FOREIGNER' }
		]
	});

	// 28,590 is the first grade of this version, where 29,500 is the first grade of the next.
	// Labour insurance 11.5%, split 20% insured / 70% insured unit: 28,590 × 11.5% = 3,287.85 →
	// 657.57 → 658 / 2,301.495 → 2,301 (against 679 / 2,375 on the 民國115年 floor grade); the
	// Bureau's 114年 table (Files/24813, 30-day row) prints 658 / 2,301.
	expectStatutory(book, 'TW-28590', 'LI', 658, 2301);
	// Employment insurance 1% on the same ladder and split: 285.90 → 57.18 → 57 / 200.13 → 200.
	// BLI's 114年 combined row for 28,590 is 715 / 2,501 (still printed as a part-time grade on
	// the 115年 table): 658 + 57 and 2,301 + 200 (Files/25697).
	expectStatutory(book, 'TW-28590', 'EI', 57, 200);
	// Health insurance 5.17%, insured 30%, insured unit 60% × (1 + 0.56): 28,590 × 5.17% =
	// 1,478.10 → 443.43 → 443, and 1,478.10 × 0.936 = 1,383.50 → 1,384.
	expectStatutory(book, 'TW-28590', 'NHI', 443, 1384);
	// Labour pension 6% of the contribution grade, employer alone: 28,590 × 6% = 1,715.40 → 1,715.
	expectStatutory(book, 'TW-28590', 'LABOR_PENSION', 0, 1715);
	// On the 114年 ladder 29,500 is not a grade: 28,800 < 29,500 ≤ 30,300 insures at 30,300 on every
	// scheme — the same wage insures at its own floor grade 29,500 a month later.
	expectStatutory(book, 'TW-29500', 'LI', 697, 2439);
	expectStatutory(book, 'TW-29500', 'NHI', 470, 1466);
	expectStatutory(book, 'TW-29500', 'LABOR_PENSION', 0, 1818);
	expectStatutory(book, 'TW-29500', 'OCC_INJURY', 0, 76); // 30,300 × 0.25% = 75.75
	// The grades above the floor did not move between the two versions: 40,000 still insures at
	// 40,100 for every scheme, so these are the 民國115年 figures unchanged.
	expectStatutory(book, 'TW-40000', 'LI', 922, 3228);
	expectStatutory(book, 'TW-40000', 'NHI', 622, 1940);
	expectStatutory(book, 'TW-40000', 'LABOR_PENSION', 0, 2406);

	// 各類所得扣繳率標準 §3(2) on this version's own breakpoint: 6% at or below 1.5 × 28,590 =
	// 42,885, and 18% above it. 6% × 42,885 = 2,573.10; 18% × 42,886 = 7,719.48.
	expectStatutory(book, 'TW-NR-42885', 'INCOME_TAX_NON_RESIDENT', 2573.1, 0);
	expectStatutory(book, 'TW-NR-42886', 'INCOME_TAX_NON_RESIDENT', 7719.48, 0);
	// 就業保險法 §5 keeps employment insurance to ROC nationals on this version too.
	expectStatutorySkipped(book, 'TW-NR-42885', 'EI');
	// 職災 charges on the 民國114年 投保薪資 grade (勞動部 113-11-15 勞動保3字第1130087585號令,
	// 22 grades 28,590–72,800): 42,885 insures at the 43,900 grade → 0.25% × 43,900 = 109.75 → 110.
	expectStatutory(book, 'TW-NR-42885', 'OCC_INJURY', 0, 110);
});

test('Taiwan — the dollar above a grade insures at the next grade', () => {
	// 分級表 rows are "29,501 元至 30,300 元 → 30,300": the first cent past a grade is the next
	// grade for every insurance, and a non-resident a cent over 1.5 × the basic wage is at 18%.
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-29500.01', wage: 29_500.01, citizenship: 'CITIZEN' },
			{ key: 'TW-45801', wage: 45_801, citizenship: 'CITIZEN' },
			{ key: 'TW-NR-44250.01', wage: 44_250.01, citizenship: 'FOREIGNER' }
		]
	});
	// Grade 30,300 × 11.5% = 3,484.50 → 696.90 → 697 / 2,439.15 → 2,439; × 1% = 303 → 60.60 → 61 /
	// 212.10 → 212 (BLI 758 / 2,651).
	expectStatutory(book, 'TW-29500.01', 'LI', 697, 2439);
	expectStatutory(book, 'TW-29500.01', 'EI', 61, 212);
	// NHI 30,300 × 5.17% = 1,566.51 → 469.95 → 470 / 1,466.25 → 1,466; pension 6% = 1,818.
	expectStatutory(book, 'TW-29500.01', 'NHI', 470, 1466);
	expectStatutory(book, 'TW-29500.01', 'LABOR_PENSION', 0, 1818);
	// 45,801 is the dollar past the 勞保 ceiling: LI and EI stay on 45,800, while NHI, 勞退 and 職災
	// step to their own next grade, 48,200: NHI 2,491.94 → 747.58 → 748 / × 0.936 = 2,332.46 →
	// 2,332; 勞退 2,892; 職災 120.50 → 121 (四捨五入 on the exact half).
	expectStatutory(book, 'TW-45801', 'LI', 1053, 3687);
	expectStatutory(book, 'TW-45801', 'EI', 92, 321);
	expectStatutory(book, 'TW-45801', 'NHI', 748, 2332);
	expectStatutory(book, 'TW-45801', 'LABOR_PENSION', 0, 2892);
	expectStatutory(book, 'TW-45801', 'OCC_INJURY', 0, 121);
	// 18% × 44,250.01 = 7,965.00.
	expectStatutory(book, 'TW-NR-44250.01', 'INCOME_TAX_NON_RESIDENT', 7965, 0);
});

test('Taiwan — the 1 January 2027 version steps labour insurance to 12%', () => {
	// 勞保條例 §13(2): from the year the ordinary rate reaches 10% it rises 0.5% every two years
	// to 13% — 11.5% in 民國114年, 12% in 民國116年 (13% combined with 就保, announced 2026-08).
	// Every other scheme, and the 民國115年 grade tables, carry over unchanged until the 116年
	// minimum wage publishes.
	const book = assessStatutory({
		code: 'TW',
		period: '2027-01',
		riskClass: '1',
		people: [
			{ key: 'TW-28590', wage: 28_590, citizenship: 'CITIZEN' },
			{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' },
			{ key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' }
		]
	});
	// 29,500 × 12% = 3,540 → 708 / 2,478 (was 679 / 2,375 at 11.5%).
	expectStatutory(book, 'TW-28590', 'LI', 708, 2478);
	// 40,100 × 12% = 4,812 → 962.40 → 962 / 3,368.40 → 3,368.
	expectStatutory(book, 'TW-40000', 'LI', 962, 3368);
	// The 45,800 ceiling grade × 12% = 5,496 → 1,099.20 → 1,099 / 3,847.20 → 3,847.
	expectStatutory(book, 'TW-60000', 'LI', 1099, 3847);
	// Employment insurance, health insurance and the pension grade do not move.
	expectStatutory(book, 'TW-28590', 'EI', 59, 207);
	expectStatutory(book, 'TW-40000', 'NHI', 622, 1940);
	expectStatutory(book, 'TW-40000', 'LABOR_PENSION', 0, 2406);
});

test('Taiwan — a spouse is a health-insurance dependant, and the count still caps at three', () => {
	// 健保法 §2(2): a dependant is the insured person's spouse without their own insured status,
	// their lineal blood ascendants and their children; §18(2) charges the insured for them, counted
	// to a maximum of three. A spouse and two children is three heads over the insured's own; a
	// spouse and three children is four and pays the same three.
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'TW-40000-S-D2',
				wage: 40_000,
				citizenship: 'CITIZEN',
				spouse_status: 'WITHOUT_INCOME',
				children: 2
			},
			{
				key: 'TW-40000-S-D3',
				wage: 40_000,
				citizenship: 'CITIZEN',
				spouse_status: 'WITHOUT_INCOME',
				children: 3
			}
		]
	});
	// 4 × 622 = 2,488 on the 40,100 grade, both of them.
	expectStatutory(book, 'TW-40000-S-D2', 'NHI', 2488, 1940);
	expectStatutory(book, 'TW-40000-S-D3', 'NHI', 2488, 1940);
});

test('Taiwan — the pension and health ceilings sit far above the labour-insurance one', () => {
	// 勞退條例 §14 grades to a ceiling of 150,000; 健保投保金額分級表 runs to 313,000; 職災 to 72,800;
	// 勞保 to 45,800. One 160,000 salary crosses all four, and 313,001 is over the last of them.
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'TW-160000',
				wage: 160_000,
				citizenship: 'CITIZEN',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			},
			{
				key: 'TW-313001',
				wage: 313_001,
				citizenship: 'CITIZEN',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			}
		]
	});
	expectStatutory(book, 'TW-160000', 'LABOR_PENSION', 0, 9000); // 150,000 × 6%
	// NHI grade 162,800 × 5.17% = 8,416.76 → 2,525.028 → 2,525; × 0.936 = 7,878.09 → 7,878.
	expectStatutory(book, 'TW-160000', 'NHI', 2525, 7878);
	expectStatutory(book, 'TW-160000', 'OCC_INJURY', 0, 182); // 72,800 × 0.25%
	expectStatutory(book, 'TW-160000', 'LI', 1053, 3687); // 45,800 × 11.5%
	expectStatutory(book, 'TW-160000', 'EI', 92, 321);
	expectStatutory(book, 'TW-160000', 'INCOME_TAX', 8000, 0); // 5% election, over NT$2,000
	// The NHI ceiling grade 313,000 × 5.17% = 16,182.10 → 4,854.63 → 4,855; × 0.936 = 15,146.45 →
	// 15,146 — the top row of the 115年 負擔金額表.
	expectStatutory(book, 'TW-313001', 'NHI', 4855, 15_146);
	expectStatutory(book, 'TW-313001', 'LABOR_PENSION', 0, 9000);
	expectStatutory(book, 'TW-313001', 'INCOME_TAX', 15_650.05, 0);
});

test('Taiwan — the occupational-injury rate follows the industry class', () => {
	// 勞工職業災害保險適用行業別及費率表 (勞動部 113-11-07): 費率編號 3 (mining) is 0.89% + the 0.07%
	// commuting rate = 0.96%, the heaviest; 費率編號 18 (electronics manufacturing) is 0.05% + 0.07%
	// = 0.12%, the lightest. Both on the 40,100 grade, wholly employer-borne (災保法 §19(1)), to the
	// dollar: 384.96 → 385 and 48.12 → 48.
	const mining = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '3',
		people: [{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(mining, 'TW-40000', 'OCC_INJURY', 0, 385);
	const electronics = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '18',
		people: [{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(electronics, 'TW-40000', 'OCC_INJURY', 0, 48);
});

test('Taiwan — the 民國114年 second grade, 28,800, that the 115年 tables drop', () => {
	// The 114年 ladders step 28,590 → 28,800 → 30,300; the 115年 ones open at 29,500 and go straight
	// to 30,300. A 28,800 wage in December 2025 insures at its own grade on every scheme: LI 28,800 ×
	// 11.5% = 3,312 → 662.40 → 662 / 2,318.40 → 2,318; EI 288 → 57.60 → 58 / 201.60 → 202; NHI
	// 1,488.96 → 446.69 → 447 / 1,393.67 → 1,394; 勞退 1,728; 職災 class 1 0.25% × 28,800 = 72.
	const book = assessStatutory({
		code: 'TW',
		period: '2025-12',
		riskClass: '1',
		people: [{ key: 'TW-28800', wage: 28_800, citizenship: 'CITIZEN' }]
	});
	expectStatutory(book, 'TW-28800', 'LI', 662, 2318);
	expectStatutory(book, 'TW-28800', 'EI', 58, 202);
	expectStatutory(book, 'TW-28800', 'NHI', 447, 1394);
	expectStatutory(book, 'TW-28800', 'LABOR_PENSION', 0, 1728);
	expectStatutory(book, 'TW-28800', 'OCC_INJURY', 0, 72);
});

test('Taiwan — one national minimum wage, 28,590 in 2025 and 29,500 from 2026 (LSA §21)', () => {
	// 勞動基準法 §21(1): wages may not be below the basic wage. There is no regional table, so the
	// version states the one figure under a single key a company names as its region, the way the
	// Malaysian lineage states its national floor. 技術生 (LSA §64–69) are outside §21.
	const floors = settingsVersions('TW').map((version) => [
		version.effective_range.start.slice(0, 10),
		version.work_rules.wages.by_region,
		version.work_rules.wages.applies_when
	]);
	assert.deepEqual(floors, [
		['2025-12-01', { Taiwan: 28_590 }, 'employment.type != "INTERN"'],
		['2026-01-01', { Taiwan: 29_500 }, 'employment.type != "INTERN"'],
		['2027-01-01', { Taiwan: 29_500 }, 'employment.type != "INTERN"']
	]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 勞動基準法: the pay side. The world's shift is 09:00–18:00 with a sixty-minute break — eight
// normal hours, Monday to Friday, Saturday and Sunday 休息日/例假 — and the version's ordinary
// divisor is 30 days, so a 60,000 salary is 2,000 a day and 250 an hour (月薪 ÷ 30 ÷ 8, the 勞動部
// convention every 加班費 calculator prints). The lineage carries no allowance catalogue; the
// allowance below is planted to prove the proration rules a company that adds one would get.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const TW_2026 = '1fcfa66f-40da-5792-b925-7c2fcaa8f92c';
const holiday = (date: string, name: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name,
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});
/** A punch from `start` to `end` on `date`, in Taipei's +08:00 frame. */
const punch = (world: PayrollWorld, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		approval_id: null
	});
};
/** The work-day lines one payslip carries, as `[date, label, hours, amount]`, in date order. */
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
const charge = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};
const THIRD = 'OT-1.3333333333333333X';
const TWO_THIRDS = 'OT-1.6666666666666667X';

test('Taiwan — §24 prices 4/3 then 5/3 on a work day and a 休息日, §39 doubles a holiday', () => {
	const { slips, warnings, companyCharges } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'TW-60000',
					wage: 60_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-01-01', '開國紀念日'));
			punch(world, 'TW-60000', '2026-01-05', '09:00', '21:00'); // Monday: 11 worked, 3 extended
			punch(world, 'TW-60000', '2026-01-10', '09:00', '12:00'); // Saturday 休息日: 3 worked
			punch(world, 'TW-60000', '2026-01-01', '09:00', '18:00'); // Thursday holiday: the normal day
			punch(world, 'TW-60000', '2026-01-12', '09:00', '22:00'); // Monday: 12 worked, the §32(2) day
			punch(world, 'TW-60000', '2026-01-13', '09:00', '23:00'); // Tuesday: 13 worked, over it
		}
	);
	const slip = slips.get('TW-60000')!;
	assert.deepEqual(workLines(slip), [
		// §39: the holiday is already paid inside the month; working it earns a further day's
		// wage, 60,000 ÷ 30 = 2,000, whatever part of the day was worked.
		['2026-01-01', 'OT-1.0X', 8, 2000],
		// §24(1): 2 h × 250 × 4/3 = 666.67, then 1 h × 250 × 5/3 = 416.67.
		['2026-01-05', THIRD, 2, 666.67],
		['2026-01-05', TWO_THIRDS, 1, 416.67],
		// §24(2): a 休息日 is priced from its first hour — 2 h at 4/3, the third at 5/3.
		['2026-01-10', THIRD, 2, 666.67],
		['2026-01-10', TWO_THIRDS, 1, 416.67],
		// 12 and 13 hours: 2 h at 4/3 and the rest at 5/3; the over-limit day is still paid.
		['2026-01-12', THIRD, 2, 666.67],
		['2026-01-12', TWO_THIRDS, 2, 833.33],
		['2026-01-13', THIRD, 2, 666.67],
		['2026-01-13', TWO_THIRDS, 3, 1250]
	]);
	// §32(2): normal plus extended WORKING time may not exceed 12 hours a day, and the §35 break is
	// not working time — so twelve hours worked in a thirteen-hour clock span is lawful and only the
	// thirteenth hour worked is over the limit. The limit is stated in WORKED_HOURS for that reason.
	assert.deepEqual(warnings, [
		'DAILY_WORK_LIMIT_EXCEEDED: TW-60000 worked 13.00 hours on 2026-01-13, above the 12-hour daily limit. ' +
			'The run will still be built; correct the attendance for that day, or record why the hours stand.'
	]);
	// 勞保條例 §14 / 勞退條例 §14 / 健保法 §19: the insured amount is the declared grade of the
	// contractual monthly wage, 60,000, and a month's overtime does not re-declare it — each
	// scheme is assessed on its grade itself: 勞退 60,800 × 6% = 3,648; NHI 60,800 × 5.17% × 30%
	// = 943.01 → 943, the insuring unit's 60,800 × 5.17% × 60% × 1.56 = 2,942.28 → 2,942; 職災
	// 60,800 × 0.25% = 152. Income tax reads the whole payment: the 5% election, 3,379.17.
	assert.equal(slip.gross, 67_583.35);
	assert.deepEqual(charge(slip, 'LABOR_PENSION'), [60_800, 0, 3648]);
	assert.deepEqual(charge(slip, 'NHI'), [60_800, 943, 2942]);
	assert.deepEqual(charge(slip, 'OCC_INJURY'), [60_800, 0, 152]);
	assert.deepEqual(charge(slip, 'INCOME_TAX'), [67_583.35, 3379.17, 0]);
	assert.deepEqual(charge(slip, 'LI'), [45_800, 1053, 3687]); // the 勞保 ceiling grade
	// net = gross − every employee leg; employer cost = Σ employer legs (settle.ts).
	assert.equal(slip.total_deductions, 5467.17); // 1,053 + 92 + 943 + 3,379.17
	assert.equal(slip.net, 62_116.18); // 67,583.35 − 5,467.17
	// 健保法 §34: the insuring unit's supplementary premium is 2.11% of the month's total pay
	// above the insured amounts, netted over the establishment — a company-scope charge on no
	// payslip: (67,583.35 − 60,800) × 2.11% = 143.13 → 143. The insured's own supplement (§31) is
	// on a bonus over four times the grade, and there is none this month.
	assert.deepEqual(companyCharges.get('NHI_SUPPLEMENT_EMPLOYER'), [67_583.35, 143]);
	assert.equal(
		slip.statutory.find((row) => row.scheme_code === 'NHI_SUPPLEMENT'),
		undefined
	);
	assert.equal(slip.employer_cost, 10_750); // 3,687 + 321 + 2,942 + 3,648 + 152; the §34 levy rides on the run
});

test('Taiwan — a part month prorates on calendar days, an allowance with it, and 事假 leaves the allowance whole', () => {
	const NPL = 'c1c1c1c1-0000-4000-8000-00000000000a';
	const TRANSPORT = 'c1c1c1c1-0000-4000-8000-00000000000b';
	const { slips, entries } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'TW-WHOLE',
					wage: 40_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				},
				{ key: 'TW-NPL', wage: 40_000, citizenship: 'CITIZEN' },
				{ key: 'TW-JOINER', wage: 40_000, citizenship: 'CITIZEN', hire_date: '2026-01-16' },
				{ key: 'TW-LEAVER', wage: 40_000, citizenship: 'CITIZEN', exit_date: '2026-01-15' }
			]
		},
		(world) => {
			world.allowance_catalogue.push({
				id: TRANSPORT,
				settings_id: TW_2026,
				code: 'TRANSPORT',
				name: '交通津貼',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				approval_id: null
			});
			for (const [index, employment] of world.employments.entries())
				world.allowances.push({
					id: `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: TRANSPORT,
					amount: 3100,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: '',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			world.leave_catalogue.push({
				id: NPL,
				settings_id: TW_2026,
				code: 'PERSONAL_LEAVE',
				name: '事假',
				eligibility: '',
				evidence: 'NONE',
				evidence_after_days: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				is_npl: true,
				can_encash: false,
				bands: [],
				approval_id: null
			});
			const employment = world.employments.find((row) => row.employee_number === 'TW-NPL')!;
			const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-000000000001',
				employment_id: employment.id,
				catalogue_id: NPL,
				leave_code: 'PERSONAL_LEAVE',
				reference: 'NPL-1',
				from_date: '2026-01-14',
				to_date: '2026-01-14',
				half_day_start: false,
				half_day_end: false,
				days: 1,
				effective_on: '2026-01-14',
				reason: '事假',
				allocations: [],
				charges: [
					{
						date: '2026-01-14',
						days: 1,
						catalogue_id: NPL,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					}
				],
				approval_id: null
			});
		}
	);
	const facts = (key: string) => {
		const entry = entries.get(key)![0]!;
		const line = slips.get(key)!.adjustments.find((row) => row.family === 'ALLOWANCE')!;
		assert.equal(line.amount, entry.values.amount, `${key}: the line is the entry`);
		return [
			entry.values.days,
			entry.values.denominator,
			entry.values.unpaid_days,
			entry.values.amount
		];
	};
	// `work_rules.proration` is CALENDAR_DAYS: a joiner on the 16th takes 16 of January's 31 days
	// on the salary and on the allowance alike, one entry each, on the same basis.
	assert.deepEqual(
		slips
			.get('TW-JOINER')!
			.proration.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[16, 31, 20_645.16]]
	);
	assert.deepEqual(facts('TW-JOINER'), [16, 31, 0, 1600]);
	assert.deepEqual(
		slips
			.get('TW-LEAVER')!
			.proration.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[15, 31, 19_354.84]]
	);
	assert.deepEqual(facts('TW-LEAVER'), [15, 31, 0, 1500]);
	assert.deepEqual(facts('TW-WHOLE'), [31, 31, 0, 3100]);
	// 勞工請假規則 §7: 事假 is unpaid — one calendar day of wage, 40,000 ÷ 31 = 1,290.32, comes off
	// the salary line. `payroll.allowance_npl_prorates` is false, so the allowance stays whole.
	assert.deepEqual(facts('TW-NPL'), [31, 31, 0, 3100]);
	const absence = slips.get('TW-NPL')!.adjustments.find((row) => row.bucket === 'ABSENCE')!;
	assert.deepEqual([absence.quantity, absence.amount], [1, 1290.32]);
	assert.equal(slips.get('TW-NPL')!.gross, 40_000 - 1290.32 + 3100);
	// 勞基法 §2(3): a recurring 交通津貼 is 工資, so it is in the insured wage and the taxable pay:
	// the contractual 40,000 + 3,100 = 43,100 insures at grade 43,900 (× 11.5% = 5,048.50 →
	// 1,010 / 3,534), and a day of 事假 does not re-declare the grade; the whole month's 薪資所得
	// is 43,100.
	assert.deepEqual(charge(slips.get('TW-NPL')!, 'LI'), [43_900, 1010, 3534]);
	// 43,100 of 薪資所得 is over the 5% election's threshold, so 2,155 is withheld where 40,000 alone was not.
	assert.deepEqual(charge(slips.get('TW-WHOLE')!, 'INCOME_TAX'), [43_100, 2155, 0]);

	// The part month. 勞保施行細則 §28-1 counts the premium per enrolled day on a thirty-day month at
	// the DECLARED grade — the contract's 40,000 plus the recurring 3,100 transport allowance
	// (勞基法 §2(3)), 43,100 → grade 43,900 — never the prorated wage that would fall to the floor
	// grade. Same arithmetic as BLI Files/25697's 16-day row one grade down (40,100: 492 / 1,722):
	// 勞保 43,900 × 11.5% × 20% × 16/30 = 538.5 → 539 and × 70% = 1,884.8 → 1,885; 就保 43,900 ×
	// 1% × 20% × 16/30 = 46.8 → 47 and × 70% = 163.9 → 164; 勞退 43,900 × 6% = 2,634 × 16/30 =
	// 1,404.8 → 1,405; 健保 43,900 × 5.17% × 30% = 680.9 → 681, employer × 60% × 1.56 = 2,124;
	// the leaver's fifteen days: 勞保 504.85 → 505 / 1,767, 就保 43.9 → 44 / 153.65 → 154, 勞退 1,317. BLI Files/25697, 16-day row: 勞工 535 / 單位 1,872 for 勞保+就保
	// together, each scheme rounded once from the rate after the day fraction: 勞保 40,100 × 11.5%
	// × 20% × 16/30 = 491.89 → 492 and × 70% = 1,721.63 → 1,722; 就保 40,100 × 1% × 20% × 16/30 =
	// 42.77 → 43 and × 70% = 149.71 → 150.
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'LI'), [43_900, 539, 1885]);
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'EI'), [43_900, 47, 164]);
	// 勞退條例 §14 on the same thirty-day month: 40,100 × 6% = 2,406 × 16/30 = 1,283.2 → 1,283.
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'LABOR_PENSION'), [43_900, 0, 1405]);
	// 健保法 §30: a whole-month premium at the declared grade, billed to the unit the person is
	// insured with at month end — the joiner's employer pays January whole (622 / 1,940), the
	// leaver's pays nothing and carries no 健保 row at all.
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'NHI'), [43_900, 681, 2124]);
	assert.equal(
		slips.get('TW-LEAVER')!.statutory.find((entry) => entry.scheme_code === 'NHI'),
		undefined
	);
	// The leaver's fifteen enrolled days — BLI's 15-day row at 40,100 is 501 / 1,754 combined
	// (Files/24807): 勞保 461.15 → 461 / 1,614.025 → 1,614; 就保 40.1 → 40 / 280.7 × ½ = 140.35 →
	// 140, where the whole-month row 281 halved would round to 141; 勞退 2,406 × 15/30 = 1,203.
	assert.deepEqual(charge(slips.get('TW-LEAVER')!, 'LI'), [43_900, 505, 1767]);
	assert.deepEqual(charge(slips.get('TW-LEAVER')!, 'EI'), [43_900, 44, 154]);
	assert.deepEqual(charge(slips.get('TW-LEAVER')!, 'LABOR_PENSION'), [43_900, 0, 1317]);
});

test('every sealed version of `TW` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('TW');
});

test('Taiwan — a part-timer insures at the part-time grades, the worker’s voluntary pension is outside tax, and the table election withholds nothing under NT$90,501', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-PART', wage: 12_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
			{
				key: 'TW-VOL',
				wage: 40_000,
				citizenship: 'CITIZEN',
				registrations: {
					LABOR_PENSION: { kind: 'REGISTERED', elections: { voluntary_rate: 6 } },
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: false } }
				}
			},
			// A foreigner who has declared residency (183 days present) is withheld as a resident.
			{
				key: 'TW-DOMICILED',
				wage: 50_000,
				citizenship: 'FOREIGNER',
				tax_residency: 'RESIDENT',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			}
		]
	});
	// 12,000 sits in the 12,540 part-time grade: 勞保 12,540 × 11.5% × 20% = 288 / × 70% = 1,009;
	// 就保 12,540 × 1% × 20% = 25 / 88; 勞退 12,540 × 6% = 752.
	expectStatutory(book, 'TW-PART', 'LI', 288, 1009);
	expectStatutory(book, 'TW-PART', 'EI', 25, 88);
	expectStatutory(book, 'TW-PART', 'LABOR_PENSION', 0, 752);
	// 勞退條例 §14(3): a 6% voluntary contribution on the 40,100 grade, 2,406, beside the employer's.
	expectStatutory(book, 'TW-VOL', 'LABOR_PENSION', 2406, 2406);
	// §14(4): the voluntary contribution is outside the taxable salary — once: the income-tax base
	// is 40,000 − 2,406 = 37,594 (it was subtracted twice until 2026-09-19).
	assert.equal(book.get('TW-VOL')!.get('INCOME_TAX')!.base, 37_594);
	// The table election: 37,594 sits under the table's first withholding bracket (90,501), so
	// nothing is withheld, where the 5% election would have taken 1,880 → under 2,000 → nothing too.
	expectStatutory(book, 'TW-VOL', 'INCOME_TAX', 0, 0);
	// 所得稅法 §7(3): a foreigner resident 183 days is withheld on the resident ladder, 5% of
	// 50,000 = 2,500, not the non-resident 18%.
	expectStatutory(book, 'TW-DOMICILED', 'INCOME_TAX', 2500, 0);
	assert.equal(book.get('TW-DOMICILED')!.get('INCOME_TAX_NON_RESIDENT'), undefined);
});

test('Taiwan — the 115年度 薪資所得扣繳稅額表: every one of its 10,080 cells reproduces from the rung', () => {
	// 財政部 台財稅字第11404675280號函 (4 Dec 2025), the table and its 說明: the bracket's lower bound
	// × 12, less 101,000 for the taxpayer and each of the spouse and dependants, the married
	// standard deduction 272,000 and the salary special deduction 227,000, at the 115年度 brackets,
	// ÷ 12, cut to the ten dollars; NT$2,000 or under withholds nothing. The fixture is the
	// table as printed (25 pages, 80,001 to 500,000 in steps of 500, twelve dependant columns),
	// read from the PDF, not derived. The rung is evaluated the way the run evaluates it, on a wage
	// at the top of each bracket, so the anchor to the bracket's lower bound is what is tested.
	const table = JSON.parse(
		readFileSync(
			new URL('./fixtures/statutory/TW/withholding-table-115.json', import.meta.url),
			'utf8'
		)
	) as { from: number; to: number; withhold: number[] }[];
	const rung = contributionSchemes('TW')
		.find((row) => row.code === 'INCOME_TAX' && row.settings_id === settingsVersions('TW')[1]!.id)!
		.rules.find((row) => row.employee.includes('five_percent_withholding'))!.employee;
	const context = (base: number, dependants: number) => ({
		base,
		scheme: { elections: { five_percent_withholding: false }, rate_override: 0 },
		person: { employee: { dependents_count: dependants } },
		produced: { LABOR_PENSION: { employee: 0 } }
	});
	let cells = 0;
	for (const row of table)
		for (const [dependants, expected] of row.withhold.entries()) {
			cells += 1;
			for (const wage of [row.from, row.to])
				assert.equal(
					evaluateNumber(expressionEngine, rung, context(wage, dependants)),
					expected,
					`${row.from}–${row.to}, ${dependants} dependants, wage ${wage}`
				);
		}
	assert.equal(cells, 10_080);
	// The six cells the ten-dollar cut lands exactly on 2,000: the 說明's "不超過2,000元" withholds
	// nothing, and 2,010 is the first figure withheld.
	assert.equal(evaluateNumber(expressionEngine, rung, context(90_250, 0)), 0);
	assert.equal(evaluateNumber(expressionEngine, rung, context(90_750, 0)), 2020);
	// Above the table: the same formula on the salary itself, to the dollar (說明 (三)).
	// 600,000 × 12 = 7,200,000 − 600,000 = 6,600,000 → 1,126,900 + 1,410,000 × 40% = 1,690,900 ÷ 12 = 140,908.
	assert.equal(evaluateNumber(expressionEngine, rung, context(600_000, 0)), 140_908);
});
