/**
 * Taiwan — independent audit (2026-09-23). Every expected figure below is derived by hand from the
 * statute or the authority's published table, with the arithmetic in the comment beside it; none
 * was read off the engine. Where the engine cannot reach the law's figure the case is left failing
 * and the report names the engine change (goldens hold the law).
 *
 * Sources: 勞工保險條例 §13, §15 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050001);
 * BLI premium page (https://www.bli.gov.tw/0014162.htm); 全民健康保險法 §31, §34 and the NHIA
 * formula page (https://www.nhi.gov.tw/ch/cp-4516-74b0f-2613-1.html); 勞工退休金條例 §12, §14
 * (pcode N0030020); 各類所得扣繳率標準 §2, §3; 勞動基準法 §2(4), §16, §17, §24, §39 (pcode
 * N0030001); 最低工資法 §4–§5 (pcode N0030028); 勞動部 109年10月29日勞動關2字第1090128292A號令
 * (notice pay).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	expectStatutory,
	settingsVersions,
	COMPANY_ID
} from './fixtures/statutory-world.ts';
import { monthsAt, priorWages } from './fixtures/prior-wages.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const charge = (
	slip: {
		statutory: readonly {
			scheme_code: string;
			base_amount: number;
			employee_amount: number;
			employer_amount: number;
		}[];
	},
	code: string
) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code);
	return row == null
		? undefined
		: ([row.base_amount, row.employee_amount, row.employer_amount] as const);
};

const addBonus = (world: PayrollWorld, period: string, amount: number, index = 0) => {
	const version = settingsVersions('TW').findLast(
		(row) => String(row.effective_range.start).slice(0, 7) <= period
	)!;
	const bonus = world.adhoc_catalogue!.find(
		(row) => row.code === 'bonus' && row.settings_id === version.id
	)!;
	world.adhoc_requests!.push({
		id: `d4000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
		employment_id: world.employments[index]!.id,
		catalogue_id: bonus.id,
		amount,
		event_date: `${period}-05`,
		pay_period: null,
		payslip_id: null,
		reason: 'Bonus',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
};

// ─── 勞工保險條例 §13: the 2027 step to 12% ─────────────────────────────────────────────────────
test('TW audit — 2027 labour insurance at 12% on the 115年 ladder', () => {
	// §13(2): 10% in 2019, then +0.5% every two years to 13% — 11.5% from 2025, 12% from 2027
	// (BLI 0014162 lists 11.5% from 114-01-01). Shares §15(1): 20% / 70%.
	// Grade 29,500: 29,500 × 12% = 3,540 → employee 708.00, employer 2,478.00.
	// Grade 45,800 (ceiling): 45,800 × 12% = 5,496 → 1,099.20 → 1,099; 3,847.20 → 3,847.
	// Employment insurance stays 1%: 29,500 → 59.00 / 206.50 → 207 (half-up).
	const book = assessStatutory({
		code: 'TW',
		period: '2027-01',
		riskClass: '1',
		people: [
			{ key: 'FLOOR', wage: 29_500, citizenship: 'CITIZEN' },
			{ key: 'CEILING', wage: 90_000, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'FLOOR', 'LI', 708, 2478);
	expectStatutory(book, 'CEILING', 'LI', 1099, 3847);
	expectStatutory(book, 'FLOOR', 'EI', 59, 207);
});

// ─── 勞工職業災害保險及保護法 §16(4): an experience-rated unit's notified rate ─────────────────────
test('TW audit — occupational accident premium at the table rate and at a notified experience rate', () => {
	// 行業別及費率表 (114-01-01) 編號 1 農、林、牧業: 0.18% + 0.07% commuting = 0.25%.
	// Grade 40,100: 40,100 × 0.25% = 100.25 → 100. A unit notified an experience-rated total of
	// 0.30%: 40,100 × 0.30% = 120.30 → 120. Employer only (§19(1)).
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TABLE', wage: 40_000, citizenship: 'CITIZEN' },
			{
				key: 'RATED',
				wage: 40_000,
				citizenship: 'CITIZEN',
				registrations: { OCC_INJURY: { kind: 'REGISTERED', rate_override: 0.3 } }
			}
		]
	});
	expectStatutory(book, 'TABLE', 'OCC_INJURY', 0, 100);
	expectStatutory(book, 'RATED', 'OCC_INJURY', 0, 120);
});

// ─── 勞基法 §56(1): the old-system reserve covers foreign workers outside 勞退條例 ─────────────────
test('TW audit — the §56 reserve includes old-system migrant workers, ten-year rule from April 2026', () => {
	// 勞退條例 §7 does not cover a migrant worker, so the LSA (old) pension applies and §56(1)
	// requires the monthly 2–15% reserve on their wages. 勞動部 1140153402A: from 2026-04-01 a
	// blue-collar migrant worker with under ten years at the unit is left out of the 薪資總額.
	// Entity rate 6%, wage 30,000: 30,000 × 6% = 1,800.
	//  - 2026-02, migrant hired 2023-01-01 (3 years): included → 1,800.
	//  - 2026-05, the same worker: excluded → 0.
	//  - 2026-05, migrant hired 2014-01-01 (12 years): included → 1,800.
	for (const [period, hire, expected] of [
		['2026-02', '2023-01-01', 1800],
		['2026-05', '2023-01-01', 0],
		['2026-05', '2014-01-01', 1800]
	] as const) {
		const { slips } = buildStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			companyFacts: { pension_reserve_rate: 6 },
			people: [
				{
					key: 'MIGRANT',
					wage: 30_000,
					citizenship: 'FOREIGNER',
					pass_type: 'WORK_PERMIT',
					tax_residency: 'RESIDENT',
					hire_date: hire,
					registrations: { LABOR_PENSION: { kind: 'NOT_REGISTERED' } }
				}
			]
		});
		assert.equal(
			charge(slips.get('MIGRANT')!, 'LABOR_PENSION_RESERVE')?.[2] ?? 0,
			expected,
			`${period} ${hire}`
		);
	}
});

// ─── 全民健康保險法 §31(1)(1): the four-times threshold on a bonus ─────────────────────────────────
test('TW audit — NHI bonus supplementary premium at, one dollar over and well over 4× the grade', () => {
	// A 40,000 salary insures at NHI grade 40,100 (NHIA 115 table, grade 8). 4 × 40,100 = 160,400.
	// Bonus 160,400: excess 0 → nothing. Bonus 160,448: excess 48 × 2.11% = 1.0128 → 1.
	// Bonus 200,000: excess 39,600 × 2.11% = 835.56 → 836 (元以下四捨五入).
	for (const [bonus, premium] of [
		[160_400, 0],
		[160_448, 1],
		[200_000, 836]
	] as const) {
		const { slips } = buildStatutory(
			{
				code: 'TW',
				period: '2026-03',
				riskClass: '1',
				people: [{ key: 'B', wage: 40_000, citizenship: 'CITIZEN' }]
			},
			(world) => addBonus(world, '2026-03', bonus)
		);
		assert.equal(charge(slips.get('B')!, 'NHI_SUPPLEMENT')?.[1] ?? 0, premium, `bonus ${bonus}`);
	}
});

// ─── 全民健康保險法 §34: the insuring unit's supplement is on salary income (格式代號 50) ──────────
test('TW audit — employer NHI supplement excludes tax-free overtime and the voluntary pension', () => {
	// NHIA: (每月給付之薪資所得總額 − 受僱者當月投保金額總額) × 2.11%, 薪資 = 格式代號 50, i.e. the
	// taxable salary. Overtime inside 勞基法 §32 is not salary income (所得稅法 §14(1)(3)).
	// Worker A: 60,000 salary, 3 extended hours on one day (tax-free) and a 100,000 bonus, no
	// voluntary pension. Taxable salary = 60,000 + 100,000 = 160,000. Insured amount 60,800.
	// (160,000 − 60,800) × 2.11% = 99,200 × 0.0211 = 2,093.12 → 2,093.
	// Worker B: 60,000 with a 6% voluntary pension: 60,800 × 6% = 3,648 is outside salary income
	// (勞退條例 §14(3)): taxable 56,352. Company totals: salary 160,000 + 56,352 = 216,352;
	// insured 60,800 + 60,800 = 121,600; (216,352 − 121,600) × 2.11% = 94,752 × 0.0211 =
	// 1,999.2672 → 1,999.
	const { companyCharges } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{ key: 'A', wage: 60_000, citizenship: 'CITIZEN' },
				{
					key: 'B',
					wage: 60_000,
					citizenship: 'CITIZEN',
					registrations: {
						LABOR_PENSION: { kind: 'REGISTERED', elections: { voluntary_rate: 6 } }
					}
				}
			]
		},
		(world) => {
			addBonus(world, '2026-01', 100_000, 0);
			const employment = world.employments[0]!;
			world.work_days.push({
				id: 'wd-A-2026-01-05',
				employment_id: employment.id,
				work_date: '2026-01-05',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2026-01-05T09:00:00+08:00', end: '2026-01-05T21:00:00+08:00' }
				],
				approval_id: null
			} as never);
		}
	);
	assert.deepEqual(companyCharges.get('NHI_SUPPLEMENT_EMPLOYER'), [216_352, 1999]);
});

// ─── 勞工退休金條例 §14(3): voluntary contribution outside the withholding base ─────────────────────
test('TW audit — a 6% voluntary pension is deducted before the 5% withholding', () => {
	// 60,000 salary, grade 60,800 (勞退月提繳分級表 grade 41). Voluntary 6%: 3,648; employer 6%:
	// 3,648. 5% election: (60,000 − 3,648) × 5% = 56,352 × 0.05 = 2,817.6 → 2,817 (角以下捨去),
	// above the NT$2,000 exemption (扣繳率標準 §13).
	const book = assessStatutory({
		code: 'TW',
		period: '2026-02',
		riskClass: '1',
		people: [
			{
				key: 'V',
				wage: 60_000,
				citizenship: 'CITIZEN',
				registrations: {
					LABOR_PENSION: { kind: 'REGISTERED', elections: { voluntary_rate: 6 } },
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			}
		]
	});
	expectStatutory(book, 'V', 'LABOR_PENSION', 3648, 3648);
	expectStatutory(book, 'V', 'INCOME_TAX', 2817, 0);
});

// ─── 各類所得扣繳率標準 §3: non-resident 6% up to 1.5 × the minimum wage ─────────────────────────
test('TW audit — non-resident 6% / 18% boundary in 2025 and 2026', () => {
	// 2025: 1.5 × 28,590 = 42,885. 42,885 × 6% = 2,573.1 → 2,573; 42,886 × 18% = 7,719.48 → 7,719.
	// 2026: 1.5 × 29,500 = 44,250. 44,250 × 6% = 2,655; 44,251 × 18% = 7,965.18 → 7,965.
	for (const [period, at, above, low, high] of [
		['2025-12', 42_885, 42_886, 2573, 7719],
		['2026-01', 44_250, 44_251, 2655, 7965]
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
		expectStatutory(book, 'AT', 'INCOME_TAX_NON_RESIDENT', low, 0);
		expectStatutory(book, 'ABOVE', 'INCOME_TAX_NON_RESIDENT', high, 0);
	}
});

// ─── 薪資所得扣繳辦法: a non-monthly bonus at the 115年 起扣點 ───────────────────────────────────
test('TW audit — resident bonus withholding starts at the NT$90,501 起扣點 (115年度)', () => {
	// The 115年度 table's no-dependant threshold is NT$90,501 (台財稅字第11404675280號). A bonus
	// below it is not withheld; at it, 5%: 90,501 × 5% = 4,525.05 → 4,525.
	for (const [bonus, tax] of [
		[90_500, 0],
		[90_501, 4525]
	] as const) {
		const { slips } = buildStatutory(
			{
				code: 'TW',
				period: '2026-04',
				riskClass: '1',
				people: [{ key: 'R', wage: 40_000, citizenship: 'CITIZEN' }]
			},
			(world) => addBonus(world, '2026-04', bonus)
		);
		assert.equal(charge(slips.get('R')!, 'INCOME_TAX_BONUS')?.[1] ?? 0, tax, `bonus ${bonus}`);
	}
});

// ─── 勞基法 §24(2) and §39 beyond eight hours ──────────────────────────────────────────────────
test('TW audit — ten hours on a 休息日 and on a holiday', () => {
	// 60,000 monthly: day 2,000, hour 250 (÷30 ÷8).
	// 休息日 (Saturday 2026-01-10), 09:00–13:00 and 14:00–20:00 = 10 hours: §24(2) as amended
	// 2018-03-01 (actual hours, the 4/8/12 counting deleted): 2 h × 250 × 4/3 = 666.67, then
	// 8 h × 250 × 5/3 = 3,333.33.
	// Holiday (2026-01-01, Thursday) the same two spells: §39 a further day's wage for the
	// eight hours, 2,000; hours 9–10 at §24(1) 4/3: 2 × 250 × 4/3 = 666.67.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [{ key: 'W', wage: 60_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.jurisdiction_holidays.push({
				id: 'holiday-2026-01-01',
				company_id: COMPANY_ID,
				date: '2026-01-01',
				name: '開國紀念日',
				kind: 'PUBLIC_HOLIDAY',
				replaces: null,
				source: null,
				published_at: '2025-12-01T00:00:00.000Z',
				approval_id: null
			} as never);
			for (const date of ['2026-01-01', '2026-01-10'])
				world.work_days.push({
					id: `wd-W-${date}`,
					employment_id: world.employments[0]!.id,
					work_date: date,
					shift_definition_id: null,
					worked_intervals: [
						{ start: `${date}T09:00:00+08:00`, end: `${date}T13:00:00+08:00` },
						{ start: `${date}T14:00:00+08:00`, end: `${date}T20:00:00+08:00` }
					],
					approval_id: null
				} as never);
		}
	);
	const lines = slips
		.get('W')!
		.adjustments.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount])
		.toSorted(
			(a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))
		);
	assert.deepEqual(lines, [
		['2026-01-01', 'OT-1.0X', 8, 2000],
		['2026-01-01', 'OT-1.3333333333333333X', 2, 666.67],
		['2026-01-10', 'OT-1.3333333333333333X', 2, 666.67],
		['2026-01-10', 'OT-1.6666666666666667X', 8, 3333.33]
	]);
});

// ─── 最低工資法 §4: the hourly minimum wage ────────────────────────────────────────────────────
test('TW audit — an hourly rate is held to the hourly minimum wage', () => {
	// 2026: NT$196 an hour (勞動部 114-09 審議, MOL 84947). An hourly worker on NT$195 is below it,
	// NT$196 is not — although NT$195 × 8 h × 30 = 46,800 clears the NT$29,500 monthly figure, which
	// is all the monthly comparison could see.
	// 2025-12: NT$190 an hour; NT$189 is below it.
	// A monthly salary of NT$29,499 is below the 2026 monthly floor; NT$29,500 is not.
	for (const [period, cases] of [
		[
			'2026-01',
			[
				['H195', 195, 'HOURLY', true],
				['H196', 196, 'HOURLY', false],
				['M29499', 29_499, 'MONTHLY', true],
				['M29500', 29_500, 'MONTHLY', false]
			]
		],
		[
			'2025-12',
			[
				['H189', 189, 'HOURLY', true],
				['H190', 190, 'HOURLY', false]
			]
		]
	] as const) {
		const { warnings } = buildStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				// The company names the version's one region, as a Taiwanese entity does.
				region: 'Taiwan',
				people: cases.map(([key, wage, pay_frequency]) => ({
					key,
					wage,
					pay_frequency,
					citizenship: 'CITIZEN'
				}))
			},
			// Each contract states its forty-hour, five-day week (勞基法 §30(1)).
			(world) => {
				for (const term of world.employment_terms)
					(term as { ordinary_hours_per_week?: number }).ordinary_hours_per_week = 40;
			}
		);
		for (const [key, , , below] of cases)
			assert.equal(
				warnings.some((line) => line.startsWith('MINIMUM_WAGE_BELOW') && line.includes(`${key} `)),
				below,
				`${period} ${key}`
			);
	}
});

// ─── 勞退條例 §11–§12, 勞基法 §16–§17: severance and notice pay ───────────────────────────────────
const severanceRun = (
	people: readonly {
		key: string;
		wage: number;
		hire: string;
		exit: string;
		reason?: string;
		facts?: Readonly<Record<string, string | number>>;
		/** Six earlier payslips at the wage, which 平均工資 reads; false for none. */
		history?: boolean;
	}[]
) =>
	buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: people.map((person) => ({
				key: person.key,
				wage: person.wage,
				citizenship: 'CITIZEN',
				hire_date: person.hire,
				exit_date: person.exit,
				exit_reason: person.reason ?? 'REDUNDANCY'
			}))
		},
		(world) => {
			const version = settingsVersions('TW').find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			const catalogue = world.adhoc_catalogue!.find(
				(row) => row.code === 'SEVERANCE_PAY' && row.settings_id === version.id
			)!;
			for (const [index, person] of people.entries()) {
				const employment = world.employments[index]! as { exit_facts?: unknown; id: string };
				if (person.facts != null) employment.exit_facts = person.facts;
				if (person.history !== false)
					priorWages(world, person.key, monthsAt('2025-07', '2025-12', person.wage));
				world.adhoc_requests!.push({
					id: `d5000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
					employment_id: employment.id,
					catalogue_id: catalogue.id,
					amount: 0,
					event_date: person.exit,
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'SEVERANCE_PAY',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
const paid = (
	slips: Map<
		string,
		{ adjustments: readonly { component_code?: string | null; amount: number }[] }
	>,
	key: string
) => slips.get(key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount;

test('TW audit — severance on the declared ground and average wage, with notice pay', () => {
	// All hired 2010-01-01 and leaving 2026-01-31: sixteen years of new-system service, so
	// 勞退條例 §12(1)'s half month a year (8 months) is capped at six months' average wage.
	// §16(1)(3): three years or more owes 30 days' notice.
	//
	// ART11-HIGH-AVG: 平均工資 NT$1,500 a day (§2(4)) → 45,000 a month; severance 6 × 45,000 =
	// 270,000. Notice given 10 days → 20 unserved. The day wage is the last month's normal wage
	// ÷ 30 = 42,000 ÷ 30 = 1,400, below the average daily 1,500, so 1,500 (勞動部 1090128292A):
	// 20 × 1,500 = 30,000. Total 300,000.
	// ART11-LOW-AVG: average 1,300 a day → 39,000 a month; 6 × 39,000 = 234,000. Day wage 1,400
	// > 1,300 → 20 × 1,400 = 28,000. Total 262,000.
	// ART14: the worker ends the contract under §14 — severance owed (勞退條例 §12(1)), no notice
	// pay (§16 binds the employer's termination). Average 1,000 → 30,000 × 6 = 180,000.
	// OLD-SYSTEM: hired 2000-03-01; 64 months (2000-03-01 to 2005-06-30) of retained old-system
	// seniority (勞退條例 §11(2)) at one month a year under 勞基法 §17: 64/12 = 5.3333 months; the
	// new-system remainder is far beyond twelve years, capped at 6. Average 1,200 → 36,000 a
	// month: 36,000 × (64/12 + 6) = 36,000 × 11.33333 = 408,000. Full notice given → none owed.
	const { slips } = severanceRun([
		{
			key: 'ART11-HIGH-AVG',
			wage: 42_000,
			hire: '2010-01-01',
			exit: '2026-01-31',
			facts: {
				lsa_termination_ground: 'ARTICLE_11',
				average_daily_wage: 1500,
				notice_days_given: 10
			}
		},
		{
			key: 'ART11-LOW-AVG',
			wage: 42_000,
			hire: '2010-01-01',
			exit: '2026-01-31',
			facts: {
				lsa_termination_ground: 'ARTICLE_11',
				average_daily_wage: 1300,
				notice_days_given: 10
			}
		},
		{
			key: 'ART14',
			wage: 30_000,
			hire: '2010-01-01',
			exit: '2026-01-31',
			reason: 'RESIGNATION',
			facts: { lsa_termination_ground: 'ARTICLE_14', average_daily_wage: 1000 }
		},
		{
			key: 'OLD-SYSTEM',
			wage: 36_000,
			hire: '2000-03-01',
			exit: '2026-01-31',
			facts: {
				lsa_termination_ground: 'ARTICLE_11',
				average_daily_wage: 1200,
				notice_days_given: 30,
				old_system_service_months: 64
			}
		},
		{
			// A declared ground outside §11/§13/§14/§20 owes nothing, whatever the broad reason says.
			key: 'OTHER',
			wage: 36_000,
			hire: '2010-01-01',
			exit: '2026-01-31',
			facts: { lsa_termination_ground: 'OTHER' }
		}
	]);
	assert.equal(paid(slips, 'ART11-HIGH-AVG'), 300_000);
	assert.equal(paid(slips, 'ART11-LOW-AVG'), 262_000);
	assert.equal(paid(slips, 'ART14'), 180_000);
	assert.equal(paid(slips, 'OLD-SYSTEM'), 408_000);
	assert.equal(paid(slips, 'OTHER') ?? 0, 0);
});

test('TW audit — a declared §11 ground requires the average wage', () => {
	// Neither declared nor paid: no earlier payslip holds the six months 勞基法 §2(4) reads.
	assert.throws(
		() =>
			severanceRun([
				{
					key: 'NO-AVG',
					wage: 40_000,
					history: false,
					hire: '2020-01-01',
					exit: '2026-01-31',
					facts: { lsa_termination_ground: 'ARTICLE_11', notice_days_given: 30 }
				}
			]),
		/Average daily wage/
	);
});

test('TW audit — severance accrues the part month of service (勞退條例 §12(1) 以比例計給) [engine gap]', () => {
	// Hired 2022-07-01 (年資 counts from the day of hire, 施行細則 §5), last day 2026-01-31.
	// §12(1) pays half a month a year and a part year pro rata, so the thirty days after the 42nd
	// completed month accrue too. Two day conventions bound the law's figure:
	//  - the final day inclusive: 2022-07-01..2026-01-31 is 3 years 7 months exactly —
	//    0.5 × (3 + 7/12) × 1,000,000 = 1,791,666.67 → 1,791,667;
	//  - the final day exclusive: 3 years 6 months 30 days, days over 365 —
	//    0.5 × (3.5 + 30/365) × 1,000,000 = 1,791,095.89 → 1,791,096.
	// The undeclared average wage is the constant contractual wage. The engine prices whole
	// completed months (42) and pays 1,750,000 — short under either convention.
	// A true part month: last day 2026-01-15 is 42 completed months (to 1 January) and 15 of
	// January's 31 days — 0.5 × (42 + 15/31) / 12 × 1,000,000 = 1,770,161.29 → 1,770,161.
	const { slips } = severanceRun([
		{ key: 'TAIL', wage: 1_000_000, hire: '2022-07-01', exit: '2026-01-31' },
		{ key: 'PART', wage: 1_000_000, hire: '2022-07-01', exit: '2026-01-15' }
	]);
	const amount = paid(slips, 'TAIL') ?? 0;
	assert.ok(amount >= 1_791_096 && amount <= 1_791_667, `severance ${amount}`);
	assert.equal(paid(slips, 'PART'), 1_770_161);
});
