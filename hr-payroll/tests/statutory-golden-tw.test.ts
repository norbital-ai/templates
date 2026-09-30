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
 * 2,582 — BLI Files/25696, 30-day row). Withholding tax discards fractional dollars under
 * 各級公庫代理銀行代辦機構及代收稅款機構稅款解繳作業辦法 §5 (FL051526, 修正 101-08-17: 稅捐本稅…一律收至元為止，
 * 角以下免收).
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
	settingsIdOn,
	contributionSchemes,
	leaveCatalogue,
	COMPANY_ID,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import { monthsAt, priorWages } from './fixtures/prior-wages.ts';
import { refusalMessage, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { evaluateNumber, expressionEngine } from '../src/lib/expressions/evaluate.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';
import { restBreakAssessment } from '../src/lib/scheduling/rest-break.ts';
import { isEligible, personContext } from '../src/lib/payroll/run/eligibility.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import {
	id as leaveId,
	leaveContext,
	submission as leaveSubmission,
	timeOff as leaveTimeOff
} from './helpers/manual-leave-context.ts';

function declareInsuredAmount(world: PayrollWorld, employeeNumber: string, amount: number) {
	const employment = world.employments.find((row) => row.employee_number === employeeNumber)!;
	const ids = new Set(
		world.statutory_contributions
			.filter((row) =>
				['LI', 'EI', 'NHI', 'OCC_INJURY', 'LABOR_PENSION', 'WAGE_ARREARS_BASE'].includes(row.code)
			)
			.map((row) => row.id)
	);
	for (const fact of world.employment_statutory_facts)
		if (
			fact.employee_id === employment.employee_id &&
			ids.has(fact.statutory_contribution_id) &&
			fact.status.kind === 'REGISTERED'
		)
			fact.status.elections = { ...fact.status.elections, insured_amount: amount };
}

const FOREIGN_SPOUSE_EI = {
	kind: 'REGISTERED',
	elections: {
		eligibility_class: 'FOREIGN_SPOUSE',
		eligibility_document_reference: 'FIXTURE-ROC-SPOUSE'
	}
} as const;

const RETAINED_OLD_PENSION = {
	kind: 'NOT_REGISTERED',
	declaration_reference: 'FIXTURE-2005-OLD-ELECTION-AND-SAME-UNIT-SERVICE',
	elections: { old_system_retained: true }
} as const;

test('Taiwan — a last-day February exit completes the pension month but LI charges actual exit days', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-02',
		riskClass: '1',
		people: [
			{
				key: 'FEB-EXIT',
				wage: 40_000,
				citizenship: 'CITIZEN',
				hire_date: '2020-01-01',
				exit_date: '2026-02-28',
				exit_ground: 'RESIGNATION'
			}
		]
	});
	const slip = book.get('FEB-EXIT')!;
	assert.equal(slip.get('LABOR_PENSION')!.employer, 2406);
	assert.equal(slip.get('LI')!.employee, 861);
});

for (const period of ['2025-12', '2026-01'])
	test(`Taiwan ${period} — part-time NHI uses its own minimum insured grade for supplementary premiums`, () => {
		const { slips, companyCharges } = buildStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				people: [{ key: 'PART', wage: 12000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' }]
			},
			(world) => {
				const settings = settingsVersions('TW').find((row) =>
					String(row.effective_range.start).startsWith(period)
				)!;
				const bonus = world.adhoc_catalogue!.find(
					(row) => row.code === 'bonus' && row.settings_id === settings.id
				)!;
				world.adhoc_requests!.push({
					id: 'd3000000-0000-4000-8000-000000000001',
					employment_id: world.employments[0]!.id,
					catalogue_id: bonus.id,
					amount: 60000,
					event_date: `${period}-01`,
					pay_period: null,
					payslip_id: null,
					reason: 'Bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		const rows = slips.get('PART')!.statutory;
		assert.equal(
			rows.find((row) => row.scheme_code === 'NHI')?.base_amount,
			period === '2025-12' ? 28590 : 29500
		);
		assert.equal(rows.find((row) => row.scheme_code === 'NHI_SUPPLEMENT')?.employee_amount ?? 0, 0);
		// The 12,000 contract for a 20-hour week is below the part-time floor, so 最低工資法 §5 pays
		// the floor: 28,590 × 20/40 = 14,295 (29,500 × 20/40 = 14,750 from 2026). The employer's
		// supplementary premium is 2.11% of the month's salaries over the insured grade:
		// (14,295 + 60,000 − 28,590) × 2.11% = 964.38 → 964; (14,750 + 60,000 − 29,500) × 2.11% = 954.78 → 955.
		assert.deepEqual(companyCharges.get('NHI_SUPPLEMENT_EMPLOYER'), [
			period === '2025-12' ? 74_295 : 74_750,
			period === '2025-12' ? 964 : 955
		]);
	});

for (const period of ['2025-12', '2026-01'])
	test(`Taiwan ${period} — NHI counts enrolled dependants independently of family records`, () => {
		const book = assessStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [
				{
					key: 'FAMILY_ELSEWHERE',
					wage: 40000,
					citizenship: 'CITIZEN',
					children: 4,
					spouse_status: 'WITHOUT_INCOME',
					registrations: { NHI: { kind: 'REGISTERED', elections: { enrolled_dependants: 0 } } }
				},
				{
					key: 'ENROLLED',
					wage: 40000,
					citizenship: 'CITIZEN',
					children: 0,
					registrations: { NHI: { kind: 'REGISTERED', elections: { enrolled_dependants: 2 } } }
				},
				{
					key: 'CAPPED',
					wage: 40000,
					citizenship: 'CITIZEN',
					children: 0,
					registrations: { NHI: { kind: 'REGISTERED', elections: { enrolled_dependants: 5 } } }
				}
			]
		});
		// Published NT$40,100 grade: NT$622 per insured person/dependant, maximum four heads.
		expectStatutory(book, 'FAMILY_ELSEWHERE', 'NHI', 622, 1940);
		expectStatutory(book, 'ENROLLED', 'NHI', 1866, 1940);
		expectStatutory(book, 'CAPPED', 'NHI', 2488, 1940);
		for (const count of [undefined, -1, 0.5])
			assert.throws(
				() =>
					assessStatutory(
						{
							code: 'TW',
							period,
							riskClass: '1',
							people: [{ key: 'UNKNOWN', wage: 40000, citizenship: 'CITIZEN' }]
						},
						(world) => {
							const ids = new Set(
								world.statutory_contributions
									.filter((row) => row.code === 'NHI')
									.map((row) => row.id)
							);
							for (const fact of world.employment_statutory_facts)
								if (ids.has(fact.statutory_contribution_id))
									fact.status.elections =
										count === undefined
											? { insured_amount: 40100 }
											: { insured_amount: 40100, enrolled_dependants: count };
						}
					),
				count === undefined
					? /NHI enrolled dependants is required/
					: count < 0
						? /NHI enrolled dependants must be at least 0/
						: /NHI enrolled dependants must be a whole number/
			);
	});

for (const period of ['2025-12', '2026-01'])
	test(`Taiwan ${period} — tax residence is declared independently of citizenship`, () => {
		for (const citizenship of ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER']) {
			const ei = citizenship === 'CITIZEN' ? {} : { EI: FOREIGN_SPOUSE_EI };
			assert.throws(
				() =>
					assessStatutory({
						code: 'TW',
						period,
						riskClass: '1',
						people: [
							{
								key: 'UNKNOWN',
								wage: 60000,
								citizenship,
								tax_residency: null,
								registrations: ei
							}
						]
					}),
				/Record tax residency/
			);
			const book = assessStatutory({
				code: 'TW',
				period,
				riskClass: '1',
				people: [
					{
						key: 'RESIDENT',
						wage: 60000,
						citizenship,
						tax_residency: 'RESIDENT',
						registrations: {
							...ei,
							INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
						}
					},
					{
						key: 'NONRESIDENT',
						wage: 60000,
						citizenship,
						tax_residency: 'NON_RESIDENT',
						registrations: ei
					}
				]
			});
			expectStatutory(book, 'RESIDENT', 'INCOME_TAX', 3000, 0);
			expectStatutorySkipped(book, 'RESIDENT', 'INCOME_TAX_NON_RESIDENT');
			expectStatutory(book, 'NONRESIDENT', 'INCOME_TAX_NON_RESIDENT', 10800, 0);
			expectStatutorySkipped(book, 'NONRESIDENT', 'INCOME_TAX');
		}
	});

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
	// BLI publishes for grade 29,500: 738 insured / 2,582 employer (Files/25696, 30 days).
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

test('Taiwan — registered labour insurance continues after 65; employment insurance ends at 65', () => {
	// Labor Insurance Act article 9 permits continued LI. EI stops on the 65th birthday.

	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'TW-64', wage: 40_000, age: 64, citizenship: 'CITIZEN' },
			// EI charges January 1–14: 40,100 × 1% × 14/30 × the 20%/70% shares.
			{ key: 'TW-65', wage: 40_000, birth_date: '1961-01-15', citizenship: 'CITIZEN' },
			// Sixty-five on the 31st: thirty enrolled days is the whole month.
			{ key: 'TW-65-LAST', wage: 40_000, birth_date: '1961-01-31', citizenship: 'CITIZEN' },
			{ key: 'TW-70', wage: 40_000, age: 70, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'TW-64', 'LI', 922, 3228);
	expectStatutory(book, 'TW-64', 'EI', 80, 281);
	expectStatutory(book, 'TW-65', 'LI', 922, 3228);
	expectStatutory(book, 'TW-65', 'EI', 37, 131);
	expectStatutory(book, 'TW-65-LAST', 'LI', 922, 3228);
	expectStatutory(book, 'TW-70', 'LI', 922, 3228);
	expectStatutorySkipped(book, 'TW-70', 'EI');
	for (const key of ['TW-65', 'TW-70']) {
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

for (const period of ['2025-12', '2026-01']) {
	test(`Taiwan ${period} — a withholding declaration selects the table and its dependant count`, () => {
		// 薪資所得扣繳辦法 §§3–6: table withholding requires the declaration. Without it,
		// regular salary follows 5%; a family record alone is not a declared tax exemption.
		const missing = assessStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [
				{
					key: 'MISSING',
					wage: 60000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { table_declaration_reference: '' } }
					}
				}
			]
		});
		expectStatutory(missing, 'MISSING', 'INCOME_TAX', 3000, 0);
		const noRegistration = assessStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				people: [{ key: 'NONE', wage: 60000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				const incomeSchemes = new Set(
					contributionSchemes('TW')
						.filter((row) => row.code === 'INCOME_TAX')
						.map((row) => row.id)
				);
				world.employment_statutory_facts = world.employment_statutory_facts.filter(
					(row) => !incomeSchemes.has(String(row.statutory_contribution_id))
				);
			}
		);
		expectStatutory(noRegistration, 'NONE', 'INCOME_TAX', 3000, 0);
		const declared = assessStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [
				{
					key: 'DECLARED',
					wage: 60000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: {
							kind: 'REGISTERED',
							elections: { table_declaration_reference: 'DECL-01', table_dependants: 0 }
						}
					}
				},
				{
					key: 'DECLARED-12',
					wage: 300250,
					citizenship: 'CITIZEN',
					children: 0,
					registrations: {
						INCOME_TAX: {
							kind: 'REGISTERED',
							elections: { table_declaration_reference: 'DECL-12', table_dependants: 12 }
						}
					}
				}
			]
		});
		expectStatutory(declared, 'DECLARED', 'INCOME_TAX', 0, 0);
		assert.throws(
			() =>
				assessStatutory(
					{
						code: 'TW',
						period,
						riskClass: '1',
						people: [{ key: 'NO-COUNT', wage: 60000, citizenship: 'CITIZEN' }]
					},
					(world) => {
						for (const fact of world.employment_statutory_facts) {
							if (fact.status?.kind !== 'REGISTERED') continue;
							const { table_dependants: _count, ...elections } = fact.status.elections ?? {};
							fact.status = { ...fact.status, elections };
						}
					}
				),
			/Declared spouse and dependants is required/
		);
		expectStatutory(declared, 'DECLARED-12', 'INCOME_TAX', period === '2025-12' ? 18725 : 17091, 0);
		for (const count of [-1, 1.5])
			assert.throws(
				() =>
					assessStatutory({
						code: 'TW',
						period,
						riskClass: '1',
						people: [
							{
								key: 'INVALID',
								wage: 60000,
								citizenship: 'CITIZEN',
								registrations: {
									INCOME_TAX: {
										kind: 'REGISTERED',
										elections: {
											table_declaration_reference: 'DECL-INVALID',
											table_dependants: count
										}
									}
								}
							}
						]
					}),
				count < 0
					? /Declared spouse and dependants must be at least 0/
					: /Declared spouse and dependants must be a whole number/
			);
	});

	test(`Taiwan ${period} — withholding discards fractions before the exemption test`, () => {
		// Tax remittance rules §5 discard fractions of NT$1. The published salary threshold
		// is NT$40,020: NT$40,019 × 5% truncates to NT$2,000 and remains exempt.
		// https://law-out.mof.gov.tw/LawContent.aspx?id=FL051526
		// https://ga.ntc.edu.tw/p/405-1003-25441,c610.php?Lang=zh-tw
		const cases = [
			{ key: 'EXACT', wage: 40000, tax: 0 },
			{ key: 'CENT', wage: 40001, tax: 0 },
			{ key: 'BELOW', wage: 40019.99, tax: 0 },
			{ key: 'THRESHOLD', wage: 40020, tax: 2001 },
			{ key: 'FRACTION', wage: 56352, tax: 2817 }
		];
		const bonus = period === '2025-12' ? 88519 : 90519;
		const book = assessStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				people: [
					...cases.map(({ key, wage }) => ({
						key,
						wage,
						citizenship: 'CITIZEN',
						registrations: {
							INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
						}
					})),
					{
						key: 'NR-6',
						wage: 40019,
						citizenship: 'FOREIGNER',
						registrations: { EI: FOREIGN_SPOUSE_EI }
					},
					{
						key: 'NR-18',
						wage: 60009,
						citizenship: 'FOREIGNER',
						registrations: { EI: FOREIGN_SPOUSE_EI }
					},
					{ key: 'TABLE', wage: 600001, citizenship: 'CITIZEN' },
					{ key: 'TABLE-12', wage: 300250, citizenship: 'CITIZEN', children: 12 },
					{ key: 'BONUS', wage: 60000, citizenship: 'CITIZEN' }
				]
			},
			(world) => {
				const settings = settingsVersions('TW').find((row) =>
					String(row.effective_range.start).startsWith(period)
				)!;
				const catalogue = world.adhoc_catalogue!.find(
					(row) => row.code === 'bonus' && row.settings_id === settings.id
				)!;
				world.adhoc_requests!.push({
					id: 'd2000000-0000-4000-8000-000000000001',
					employment_id: world.employments.find((row) => row.employee_number === 'BONUS')!.id,
					catalogue_id: catalogue.id,
					amount: bonus,
					event_date: `${period}-01`,
					pay_period: null,
					payslip_id: null,
					reason: 'Bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		for (const { key, tax } of cases) expectStatutory(book, key, 'INCOME_TAX', tax, 0);
		expectStatutory(book, 'NR-6', 'INCOME_TAX_NON_RESIDENT', 2401, 0);
		expectStatutory(book, 'NR-18', 'INCOME_TAX_NON_RESIDENT', 10801, 0);
		expectStatutory(book, 'TABLE', 'INCOME_TAX', period === '2025-12' ? 144792 : 140908, 0);
		// Table explanation (3) uses actual salary when the dependant count exceeds 11.
		// 2026: (300,250 × 12 − 600,000 − 12 × 101,000) = 1,791,000 taxable annually;
		// (122,900 + (1,791,000 − 1,380,000) × 20%) / 12 truncates to NT$17,091.
		expectStatutory(book, 'TABLE-12', 'INCOME_TAX', period === '2025-12' ? 18725 : 17091, 0);
		expectStatutory(book, 'BONUS', 'INCOME_TAX_BONUS', period === '2025-12' ? 4425 : 4525, 0);
	});
}

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

test('Taiwan — withholding cuts to the 元 under 稅款解繳作業辦法 §5, the one authority every version cites', () => {
	// 各級公庫代理銀行代辦機構及代收稅款機構稅款解繳作業辦法 §5 (修正 101-08-17): 稅捐本稅…一律收至元為止，
	// 角以下免收 — the 角 are dropped, never rounded. 5% × 45,019 = 2,250.95 → 2,250 (not 2,251),
	// above §13's NT$2,000, so withheld.
	for (const row of contributionSchemes('TW').filter((row) => row.code.startsWith('INCOME_TAX'))) {
		const cited = JSON.stringify(row);
		assert.ok(cited.includes('FL051526'), String(row.id));
		assert.ok(!cited.includes('代印繳款書'), String(row.id));
	}
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'TW-45019',
				wage: 45_019,
				citizenship: 'CITIZEN',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			}
		]
	});
	expectStatutory(book, 'TW-45019', 'INCOME_TAX', 2250, 0);
});

test('Taiwan — a non-resident foreign spouse is withheld at 6% or 18% and remains EI-covered', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'TW-NR-40000',
				wage: 40_000,
				citizenship: 'FOREIGNER',
				registrations: { EI: FOREIGN_SPOUSE_EI }
			},
			{
				key: 'TW-NR-60000',
				wage: 60_000,
				citizenship: 'FOREIGNER',
				registrations: { EI: FOREIGN_SPOUSE_EI }
			}
		]
	});

	// 各類所得扣繳率標準 §3(2): a non-resident is withheld at 18%, reduced to 6% where the full
	// month's salary is at or below 1.5 × the basic wage — 1.5 × 29,500 = 44,250 from 2026.
	expectStatutory(book, 'TW-NR-40000', 'INCOME_TAX_NON_RESIDENT', 2400, 0); // 6% × 40,000
	expectStatutory(book, 'TW-NR-60000', 'INCOME_TAX_NON_RESIDENT', 10_800, 0); // 18% × 60,000
	// The §13 NT$2,000 exemption does not extend to non-residents, and the resident election is
	// not available to them at all.
	expectStatutorySkipped(book, 'TW-NR-40000', 'INCOME_TAX');
	// 就業保險法 §5 also covers a documented ROC-national spouse, regardless of tax residence.
	expectStatutory(book, 'TW-NR-40000', 'EI', 80, 281);
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
			{
				key: 'TW-NR-42885',
				wage: 42_885,
				citizenship: 'FOREIGNER',
				registrations: { EI: FOREIGN_SPOUSE_EI }
			},
			{
				key: 'TW-NR-42886',
				wage: 42_886,
				citizenship: 'FOREIGNER',
				registrations: { EI: FOREIGN_SPOUSE_EI }
			}
		]
	});

	// 28,590 is the first grade of this version, where 29,500 is the first grade of the next.
	// Labour insurance 11.5%, split 20% insured / 70% insured unit: 28,590 × 11.5% = 3,287.85 →
	// 657.57 → 658 / 2,301.495 → 2,301 (against 679 / 2,375 on the 民國115年 floor grade); the
	// Bureau's 114年 table (Files/24813, 30-day row) prints 658 / 2,301.
	expectStatutory(book, 'TW-28590', 'LI', 658, 2301);
	// Employment insurance 1% on the same ladder and split: 285.90 → 57.18 → 57 / 200.13 → 200.
	// BLI's 114年 combined row for 28,590 is 715 / 2,501 (still printed as a part-time grade on
	// the 115年 table): 658 + 57 and 2,301 + 200 (Files/25696).
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
	// 42,885, and 18% above it. Tax truncates to whole NT dollars: 2,573 and 7,719.
	expectStatutory(book, 'TW-NR-42885', 'INCOME_TAX_NON_RESIDENT', 2573, 0);
	expectStatutory(book, 'TW-NR-42886', 'INCOME_TAX_NON_RESIDENT', 7719, 0);
	// A documented foreign spouse also has EI coverage in this 2025 version.
	expectStatutory(book, 'TW-NR-42885', 'EI', 88, 307);
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
			{
				key: 'TW-NR-44250.01',
				wage: 44_250.01,
				citizenship: 'FOREIGNER',
				registrations: { EI: FOREIGN_SPOUSE_EI }
			}
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

test('Taiwan — 2027 payroll refuses without a sealed 116年 statutory version', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: 'TW',
				period: '2027-01',
				riskClass: '1',
				people: [{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' }]
			}),
		/no sealed version covering 2027-01-31/
	);
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
	expectStatutory(book, 'TW-313001', 'INCOME_TAX', 15_650, 0);
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
	// Malaysian lineage states its national floor. Training status needs separate evidence.
	const floors = settingsVersions('TW').map((version) => [
		version.effective_range.start.slice(0, 10),
		version.work_rules.wages.by_region,
		version.work_rules.wages.applies_when
	]);
	assert.deepEqual(floors, [
		['2025-12-01', { Taiwan: 28_590 }, ''],
		['2026-01-01', { Taiwan: 29_500 }, '']
	]);
	assert.throws(() => settingsIdOn('TW', '2027-01-01'), /No sealed TW settings on 2027-01-01/);
});

test('Taiwan — a wage agreed below the minimum is paid the minimum (最低工資法 §5)', () => {
	// §5: 議定之工資低於最低工資者，以本法所定之最低工資為其工資數額. The wage of a monthly contract
	// at 7,777.77 is 29,500 by law, and the part month from 17 May is 29,500 × 15/30 = 14,750.
	// https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030028&flno=5
	const { slips, warnings } = buildStatutory({
		code: 'TW',
		period: '2026-05',
		riskClass: '1',
		people: [{ key: 'TW-BELOW', wage: 7_777.77, citizenship: 'CITIZEN', hire_date: '2026-05-17' }]
	});
	const slip = slips.get('TW-BELOW')!;
	assert.deepEqual(
		slip.proration.map((row) => [
			row.component_code,
			row.days,
			row.denominator,
			row.prorated_amount
		]),
		[['BASIC', 15, 30, 14_750]]
	);
	assert.equal(slip.gross, 14_750);
	// The insured legs were already on the 29,500 first grade, for the 14 enrolled days of a
	// thirty-day month (勞保施行細則 §28-1: 30 − 17 + 1): LI 679 × 14/30 = 316.87 → 317 and
	// 2,374.75 × 14/30 = 1,108.22 → 1,108; EI 59 × 14/30 = 27.53 → 28 and 206.50 × 14/30 = 96.37 → 96;
	// pension 1,770 × 14/30 = 826; NHI is the whole month, 458 / 1,428.
	assert.deepEqual(charge(slip, 'LI'), [29_500, 317, 1_108]);
	assert.deepEqual(charge(slip, 'EI'), [29_500, 28, 96]);
	assert.deepEqual(charge(slip, 'LABOR_PENSION'), [29_500, 0, 826]);
	assert.deepEqual(charge(slip, 'NHI'), [29_500, 458, 1_428]);
	assert.ok(
		warnings.some((line) =>
			/^MINIMUM_WAGE_BELOW: TW-BELOW is contracted at 7777\.77 a month.*the run pays 29500 in place of the agreed 7777\.77/.test(
				line
			)
		),
		warnings.join('\n')
	);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 勞動基準法: the pay side. The world's shift is 09:00–18:00 with a sixty-minute break — eight
// normal hours, Monday to Friday, Saturday and Sunday 休息日/例假 — and the version's ordinary
// divisor is 30 days, so a 60,000 salary is 2,000 a day and 250 an hour (月薪 ÷ 30 ÷ 8, the 勞動部
// convention every 加班費 calculator prints). The lineage carries no allowance catalogue; the
// allowance below is planted to prove the proration rules a company that adds one would get.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const TW_2026 = settingsIdOn('TW', '2026-01-15');
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
/**
 * A punch from `start` to `end` on `date`, in Taipei's +08:00 frame. `rest` is the §35 rest the day
 * takes, written as the gap between the worked intervals: 勞基法 §35 gives 30 minutes after four
 * continuous hours, and a rest the punches do not show is worked time.
 */
const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	rest?: readonly [string, string]
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const clock = (time: string) => `${date}T${time}:00+08:00`;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals:
			rest == null
				? [{ start: clock(start), end: clock(end) }]
				: [
						{ start: clock(start), end: clock(rest[0]) },
						{ start: clock(rest[1]), end: clock(end) }
					],
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
			punch(world, 'TW-60000', '2026-01-05', '09:00', '21:00', ['12:00', '13:00']); // Monday: 11 worked, 3 extended
			punch(world, 'TW-60000', '2026-01-10', '09:00', '12:00'); // Saturday 休息日: 3 worked
			punch(world, 'TW-60000', '2026-01-01', '09:00', '18:00', ['12:00', '13:00']); // Thursday holiday: the normal day
			punch(world, 'TW-60000', '2026-01-12', '09:00', '22:00', ['12:00', '13:00']); // Monday: 12 worked, the §32(2) day
			punch(world, 'TW-60000', '2026-01-13', '09:00', '23:00', ['12:00', '13:00']); // Tuesday: 13 worked, over it
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
		// 12 and 13 hours: 2 h at 4/3 and the rest at 5/3; the over-limit day is still paid. The
		// thirteenth hour is past §32(2)'s twelve, so the write stores it as incentive: the same
		// 5/3 on the INCENTIVE line (owner's rule, 2026-09-23).
		['2026-01-12', THIRD, 2, 666.67],
		['2026-01-12', TWO_THIRDS, 2, 833.33],
		['2026-01-13', THIRD, 2, 666.67],
		['2026-01-13', TWO_THIRDS, 2, 833.33],
		['2026-01-13', TWO_THIRDS, 1, 416.67]
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
	// 60,800 × 0.25% = 152. Income tax reads the salary alone: 所得稅法 §14(1)三(2) with 財政部 74
	// 台財稅第16713號 keeps overtime within the 勞基法 §24/§32 standard and holiday-work pay out of
	// 薪資所得, so the 7,166.68 of work-day lines within them is outside the 5% election; the
	// thirteenth hour of the 13th, past §32(2)'s twelve, is the 416.67 INCENTIVE line and inside
	// it — 60,416.67 × 5% = 3,020.83, truncated to 3,020.
	assert.equal(slip.gross, 67_583.35);
	assert.deepEqual(charge(slip, 'LABOR_PENSION'), [60_800, 0, 3648]);
	assert.deepEqual(charge(slip, 'NHI'), [60_800, 943, 2942]);
	assert.deepEqual(charge(slip, 'OCC_INJURY'), [60_800, 0, 152]);
	assert.deepEqual(charge(slip, 'INCOME_TAX'), [60_416.67, 3020, 0]);
	assert.deepEqual(charge(slip, 'LI'), [45_800, 1053, 3687]); // the 勞保 ceiling grade
	// net = gross − every employee leg; employer cost = Σ employer legs (settle.ts).
	assert.equal(slip.total_deductions, 5108); // 1,053 + 92 + 943 + 3,020
	assert.equal(slip.net, 62_475.35); // 67,583.35 − 5,108
	// 健保法 §34: the insuring unit's supplementary premium is 2.11% of the month's 薪資所得 (格式
	// 代號50) above the insured amounts. NHIA's Q&A keeps overtime within the 46-hour tax-free
	// standard out of that total, so the base is the salary and the incentive hour: 60,416.67 − 60,800 < 0, no
	// charge. The insured's own supplement (§31) is on a bonus over four times the grade; none here.
	assert.equal(companyCharges.get('NHI_SUPPLEMENT_EMPLOYER'), undefined);
	assert.equal(
		slip.statutory.find((row) => row.scheme_code === 'NHI_SUPPLEMENT'),
		undefined
	);
	assert.equal(slip.employer_cost, 10_750); // 3,687 + 321 + 2,942 + 3,648 + 152; the §34 levy rides on the run
});

test('Taiwan — a part month prorates on calendar days, an allowance with it, and 事假 leaves the allowance whole', () => {
	const NPL = 'c1c1c1c1-0000-4000-8000-00000000000a';
	const TRANSPORT = 'c1c1c1c1-0000-4000-8000-00000000000b';
	const { slips, allowances } = buildStatutory(
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
				// A recurring allowance is 工資 (勞基法 §2(3)): salary income (所得稅法 §14), and inside
				// the contractual wage the insured grades read as `terms.fixed_allowances` — each
				// scheme reading the classes that count toward it.
				counts_toward: [
					'LI',
					'EI',
					'NHI',
					'LABOR_PENSION',
					'OCC_INJURY',
					'INCOME_TAX',
					'INCOME_TAX_NON_RESIDENT',
					'NHI_SUPPLEMENT_EMPLOYER',
					'LABOR_PENSION_RESERVE'
				],
				approval_id: null
			});
			for (const [index, employment] of world.employments.entries())
				assignAllowance(world, {
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
			for (const employment of world.employments)
				declareInsuredAmount(world, employment.employee_number, 43900);
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
		const [segment, ...rest] = allowances.get(key)!;
		assert.equal(rest.length, 0, `${key}: one segment`);
		const line = slips
			.get(key)!
			.base.find((row) => row.component_code === segment!.component_code)!;
		assert.equal(line.amount, segment!.prorated_amount, `${key}: the line is the segment`);
		return [segment!.days, segment!.denominator, segment!.unpaid_days, segment!.prorated_amount];
	};
	// `work_rules.proration` is calendar days over a flat 30 (民法 §123(2); 勞動2字第1020083156號: the
	// agreed day — 30 here — prices the part month, the 事假 day and §39 alike): a joiner on the 16th
	// is paid 16 days of 40,000 ÷ 30 = 21,333.33 and of the allowance 3,100 ÷ 30 × 16 = 1,653.33.
	assert.deepEqual(
		slips
			.get('TW-JOINER')!
			.proration.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[16, 30, 21_333.33]]
	);
	assert.deepEqual(facts('TW-JOINER'), [16, 30, 0, 1653.33]);
	assert.deepEqual(
		slips
			.get('TW-LEAVER')!
			.proration.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[15, 30, 20_000]]
	);
	assert.deepEqual(facts('TW-LEAVER'), [15, 30, 0, 1550]);
	assert.deepEqual(facts('TW-WHOLE'), [30, 30, 0, 3100]);
	// 勞工請假規則 §7: 事假 is unpaid — one calendar day of wage comes off the salary line, and
	// 勞基法 §2(3) makes the recurring 交通津貼 工資, so the allowance loses its day too, both over the
	// agreed 30: 40,000 ÷ 30 = 1,333.33 off the salary and 3,100 ÷ 30 = 103.33 off the allowance.
	assert.deepEqual(facts('TW-NPL'), [29, 30, 1, 2996.67]);
	const absence = slips.get('TW-NPL')!.adjustments.find((row) => row.bucket === 'ABSENCE')!;
	assert.deepEqual([absence.quantity, absence.amount], [1, 1333.33]);
	assert.equal(slips.get('TW-NPL')!.gross, 40_000 - 1333.33 + 2996.67);
	// 勞基法 §2(3): a recurring 交通津貼 is 工資, so it is in the insured wage and the taxable pay:
	// the contractual 40,000 + 3,100 = 43,100 insures at grade 43,900 (× 11.5% = 5,048.50 →
	// 1,010 / 3,534), and a day of 事假 does not re-declare the grade; the whole month's 薪資所得
	// is 43,100.
	assert.deepEqual(charge(slips.get('TW-NPL')!, 'LI'), [43_900, 1010, 3534]);
	// 43,100 of 薪資所得 is over the 5% election's threshold, so 2,155 is withheld where 40,000 alone was not.
	assert.deepEqual(charge(slips.get('TW-WHOLE')!, 'INCOME_TAX'), [43_100, 2155, 0]);

	// BLI's thirty-day calendar gives Jan 16–31 fifteen insured days. Salary proration
	// is 16/30. Insurance uses the declared 43,900 grade, rounded after the 15/30 share.
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'LI'), [43_900, 505, 1767]);
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'EI'), [43_900, 44, 154]);
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'LABOR_PENSION'), [43_900, 0, 1317]);
	// 健保法 §30: a whole-month premium at the declared grade, billed to the unit the person is
	// insured with at month end — the joiner's employer pays January whole (622 / 1,940), the
	// leaver's pays nothing and carries no 健保 row at all.
	assert.deepEqual(charge(slips.get('TW-JOINER')!, 'NHI'), [43_900, 681, 2124]);
	assert.equal(
		slips.get('TW-LEAVER')!.statutory.find((entry) => entry.scheme_code === 'NHI'),
		undefined
	);
	// The leaver's fifteen enrolled days on the declared 43,900: 勞保 5,048.50 × 20% × ½ = 504.85 →
	// 505 / × 70% × ½ = 1,766.98 → 1,767; 就保 43.90 → 44 / 153.65 → 154; 勞退 2,634 × ½ = 1,317 —
	// the joiner's figures. (The 40,100 fifteen-day row, 461 / 1,614 and 40 / 140, is priced by the
	// mid-month leaver golden below.)
	assert.deepEqual(charge(slips.get('TW-LEAVER')!, 'LI'), [43_900, 505, 1767]);
	assert.deepEqual(charge(slips.get('TW-LEAVER')!, 'EI'), [43_900, 44, 154]);
	assert.deepEqual(charge(slips.get('TW-LEAVER')!, 'LABOR_PENSION'), [43_900, 0, 1317]);
});

test('Taiwan — a variable wage uses the recorded three-month-average declaration from its effective month', () => {
	// An hourly worker (DAILY / HOURLY / WEEKLY pay) has no fixed monthly wage to declare; 勞保條例
	// §14(2) with 施行細則 §27 grades them on the average of the three months before each
	// declaration: May–July from 1 September, November–January from 1 March. In September the
	// window is May, June, July: 30,000 + 36,000 + 33,000 = 99,000 ÷ 3 = 33,000 → the 33,300 grade.
	// August, the last month on the old declaration, reads November–January instead — and with
	// no payslip there, the contract wage (an hourly 200 over the roster week) grades the month.
	// The person is unrostered in the fixture, so the month's charge itself is the per-day rule's
	// zero; the grade is what this golden holds.
	const priorBasic: Record<string, number> = {
		'2026-05': 30_000,
		'2026-06': 36_000,
		'2026-07': 33_000
	};
	const world = (period: string) =>
		assessStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				people: [{ key: 'TW-HOURLY', wage: 200, citizenship: 'CITIZEN', pay_frequency: 'HOURLY' }]
			},
			(world) => {
				if (period === '2026-09') declareInsuredAmount(world, 'TW-HOURLY', 33300);
				const employment = world.employments.find((row) => row.employee_number === 'TW-HOURLY')!;
				for (const [month, amount] of Object.entries(priorBasic)) {
					world.payroll_runs.push({ id: `prior-${month}`, company_id: COMPANY_ID, period: month });
					world.payslips.push({
						id: `payslip-${month}`,
						payroll_run_id: `prior-${month}`,
						employment_id: employment.id,
						status: 'PAID',
						paid_at: `${month}-28T00:00:00.000Z`,
						currency: 'TWD',
						base: [{ component_code: 'BASIC', amount }],
						adjustments: [],
						statutory: []
					} as never);
				}
			}
		);
	assert.equal(world('2026-09').get('TW-HOURLY')!.get('LI')!.base, 33_300);
	assert.notEqual(world('2026-08').get('TW-HOURLY')!.get('LI')!.base, 33_300);
});

test('every sealed version of `TW` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('TW');
});

test('Taiwan — every version cites the BLI grade and 分擔金額表 PDFs, not their .docx/.ods siblings', () => {
	// BLI Files/25661 is the 115年 勞工保險投保薪資分級表 PDF (勞動保2字第1140091863號) and 25696 the
	// 合計分擔金額表 PDF (自115年1月1日起適用), whose 30-day row for grade 29,500 prints 738 / 2,582:
	// 勞保 29,500 × 11.5% = 3,392.50 → 678.50 → 679 / 2,374.75 → 2,375, plus 就保 295 → 59 / 206.50 → 207.
	// 25659 (.docx) and 25697 (.ods) are the same tables as downloads.
	for (const version of settingsVersions('TW')) {
		const cited = JSON.stringify(version.sources);
		assert.ok(
			cited.includes('25661') && cited.includes('25696'),
			String(version.effective_range.start)
		);
		assert.ok(!/\b(25659|25697)\b/.test(cited), String(version.effective_range.start));
	}
	const book = assessStatutory({
		code: 'TW',
		period: '2026-02',
		riskClass: '1',
		people: [{ key: 'TW-29500', wage: 29_500, age: 30, citizenship: 'CITIZEN' }]
	});
	expectStatutory(book, 'TW-29500', 'LI', 679, 2375);
	expectStatutory(book, 'TW-29500', 'EI', 59, 207);
});

test('Taiwan — 職災 is priced from the 行業別及費率表 (Files/24759), not the 職業工會 月負擔金額表 (25669)', () => {
	// BLI Files/24759 is the 勞工職業災害保險適用行業別及費率表 (勞動部 113-11-07 公告, from 114-01-01):
	// 編號二五 建築工程業 0.50% + 上下班 0.07% = 0.57%. An employer-insured worker on the 40,100 grade
	// is wholly employer-borne (災保法 §19(1)): 40,100 × 0.57% = 228.57 → 229, worker 0. Files/25669
	// is the table for §7(1) 職業工會 members, who bear 60%: its row 25 at 40,100 prints 137.
	for (const version of settingsVersions('TW')) {
		const urls = version.sources.urls.join(' ');
		assert.ok(urls.includes('/Files/24759'), String(version.effective_range.start));
		assert.ok(!urls.includes('/Files/25669'), String(version.effective_range.start));
	}
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '25',
		people: [{ key: 'TW-40000', wage: 40_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(book, 'TW-40000', 'OCC_INJURY', 0, 229);
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
					EI: FOREIGN_SPOUSE_EI,
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
	// ÷ 12, cut to the ten dollars; NT$2,000 or under withholds nothing. The seed file is the
	// table as printed (25 pages, 80,001 to 500,000 in steps of 500, twelve dependant columns),
	// read from the PDF, not derived. The rung is evaluated the way the run evaluates it, on a wage
	// at the top of each bracket, so the anchor to the bracket's lower bound is what is tested.
	const table = JSON.parse(
		readFileSync(new URL('./fixtures/law/tw-withholding-table-115.json', import.meta.url), 'utf8')
	) as { from: number; to: number; withhold: number[] }[];
	const rung = contributionSchemes('TW')
		.find((row) => row.code === 'INCOME_TAX' && row.settings_id === settingsVersions('TW')[1]!.id)!
		.rules.find((row) => row.employee.includes('five_percent_withholding'))!.employee;
	// The column is 配偶及受扶養親屬人數 (說明(三)): a spouse without income is one head of it.
	const context = (base: number, dependants: number) => ({
		base,
		scheme: {
			elections: {
				five_percent_withholding: false,
				table_declaration_reference: 'TABLE-115',
				table_dependants: dependants
			},
			rate_override: 0
		},
		person: {
			employee: {
				dependents_count: dependants > 0 ? dependants - 1 : 0,
				spouse_status: dependants > 0 ? 'WITHOUT_INCOME' : 'NONE'
			}
		},
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

test('Taiwan — the second review: 災保 has no grade under the basic wage, the 勞退 table reaches down to 1,500, 28,590 is a 115年 part-time grade, and a bonus is withheld on only from the 起扣點', () => {
	const bonusOf = (world: PayrollWorld, key: string, amount: number) => {
		const bonus = world.adhoc_catalogue!.find(
			(row) =>
				row.code === 'bonus' &&
				row.settings_id ===
					settingsVersions('TW').find((v) => String(v.effective_range.start).startsWith('2026-01'))!
						.id
		)!;
		const employment = world.employments.find((row) => row.employee_number === key)!;
		world.adhoc_requests!.push({
			id: `d0000000-0000-4000-8000-0000000${key.length}${amount}`.slice(0, 36).padEnd(36, '0'),
			employment_id: employment.id,
			catalogue_id: bonus.id,
			amount,
			event_date: '2026-01-01',
			pay_period: null,
			payslip_id: null,
			reason: 'bonus',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	};
	const book = assessStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{ key: 'TW-PT-12000', wage: 12_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
				{ key: 'TW-PT-28000', wage: 28_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
				{ key: 'TW-PT-5000', wage: 5_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
				{
					key: 'TW-BONUS-60000',
					wage: 40_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: false } }
					}
				},
				{
					key: 'TW-BONUS-5PCT',
					wage: 50_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		},
		(world) => {
			bonusOf(world, 'TW-BONUS-60000', 60_000);
			bonusOf(world, 'TW-BONUS-5PCT', 60_000);
		}
	);
	// 災保法 §17(5): the lowest 災保 grade is the basic wage — a part-timer at 12,000 insures at
	// 29,500: class 1, 29,500 × 0.25% = 74 (not 12,540 × 0.25% = 31).
	assert.equal(book.get('TW-PT-12000')!.get('OCC_INJURY')!.base, 29_500);
	expectStatutory(book, 'TW-PT-12000', 'OCC_INJURY', 0, 74);
	// 115年 分級表 備註二: 27,601–28,590 is the 28,590 grade — 勞保 28,590 × 11.5% × 20% = 658 /
	// × 70% = 2,301; 就保 57 / 200; 勞退 1,715.
	assert.equal(book.get('TW-PT-28000')!.get('LI')!.base, 28_590);
	expectStatutory(book, 'TW-PT-28000', 'LI', 658, 2301);
	expectStatutory(book, 'TW-PT-28000', 'EI', 57, 200);
	expectStatutory(book, 'TW-PT-28000', 'LABOR_PENSION', 0, 1715);
	// 勞退月提繳分級表 第1組: 4,501–6,000 is the 6,000 grade, 6% = 360; 勞保 keeps its 11,100 floor.
	assert.equal(book.get('TW-PT-5000')!.get('LABOR_PENSION')!.base, 6_000);
	expectStatutory(book, 'TW-PT-5000', 'LABOR_PENSION', 0, 360);
	assert.equal(book.get('TW-PT-5000')!.get('LI')!.base, 11_100);
	// 薪資所得扣繳辦法 §7(2)(1): a 60,000 bonus is under the 115年 起扣點 of 90,501, so nothing is
	// withheld on it under either election; §2(1) proviso: it never joins the monthly 5% base —
	// 50,000 × 5% = 2,500 on the salary alone.
	expectStatutory(book, 'TW-BONUS-60000', 'INCOME_TAX', 0, 0);
	expectStatutory(book, 'TW-BONUS-5PCT', 'INCOME_TAX', 2500, 0);
	// The current model has no dated proof of migrant pension or EI exclusion.
	assert.throws(
		() =>
			assessStatutory({
				code: 'TW',
				period: '2026-01',
				riskClass: '1',
				people: [
					{
						key: 'TW-MIGRANT',
						wage: 30_000,
						citizenship: 'FOREIGNER',
						pass_type: 'WORK_PERMIT',
						registrations: { EI: { kind: 'NOT_REGISTERED' } }
					}
				]
			}),
		/NOT_REGISTERED does not prove an exclusion/
	);
});

test('Taiwan — an hourly worker is insured for every enrolled day of the month, on a month’s figure (勞保條例施行細則 §27, §28-1)', () => {
	// 196 an hour, part-time, no payslip history: the grade is a month of the contract's hours —
	// 196 × 8 × 30 = 47,040 → the 48,200 grade — not the hourly rate graded as if it were a month
	// (11,100). Enrolled the whole of March, the premium is the whole month's, whatever the hours
	// punched: 勞保 45,800 (the ceiling) × 11.5% × 20% = 1,053 / × 80% × 1.1… the fixture's
	// employer share 3,687; 就保 92 / 321; 勞退 48,200 × 6% = 2,892.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-03',
			riskClass: '1',
			people: [
				{
					key: 'TW-196',
					wage: 196,
					citizenship: 'CITIZEN',
					pay_frequency: 'HOURLY',
					employment_type: 'PART_TIME'
				}
			]
		},
		(world) => {
			for (const day of ['02', '03', '04', '05', '06', '09', '10', '11'])
				punch(world, 'TW-196', `2026-03-${day}`, '09:00', '18:00');
		}
	);
	const slip = slips.get('TW-196')!;
	assert.deepEqual(charge(slip, 'LI'), [45_800, 1053, 3687]);
	assert.deepEqual(charge(slip, 'EI'), [45_800, 92, 321]);
	assert.deepEqual(charge(slip, 'LABOR_PENSION'), [48_200, 0, 2892]);
});

test('Taiwan — encashed leave is outside 薪資所得, overtime beyond the monthly limit inside it (財政部 74 台財稅第16713號)', () => {
	// 60,000 on the 5% election with five days encashed (10,000): pay for unused annual leave is
	// holiday-work pay under the ruling and outside the withholding base — 3,000 on the salary
	// alone. Fifty ordinary-day overtime hours in the month, five a day: §32(2)'s twelve-hour day
	// holds four of each day's five (8 + 4), so the tenth hour past the shift of every day — ten in
	// all — is beyond the §32 limits, the INCENTIVE line and taxable; the 40 within stay under the
	// 46-hour month and are exempt. Each incentive hour is the day's fifth, at 5/3: 10 × 416.67 =
	// 4,166.70, each line priced whole and rounded once. The taxable salary 64,166.70 × 5%
	// truncates to NT$3,208.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'TW-ENCASH',
					wage: 60_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				},
				{
					key: 'TW-FIFTY',
					wage: 60_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		},
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'TW-ENCASH')!;
			const annual = leaveCatalogue('TW').find(
				(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === settingsVersions('TW')[1]!.id
			)!;
			world.leave_catalogue.push({ ...annual, approval_id: null } as never);
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-0000000enc02',
				employment_id: employment.id,
				catalogue_id: annual.id,
				leave_code: 'ANNUAL_LEAVE',
				reference: 'ENCASH-TW',
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				half_day_start: false,
				half_day_end: false,
				days: 5,
				encash_days: 5,
				effective_on: '2026-01-15',
				due_on: '2026-01-31',
				reason: 'Year end',
				allocations: [],
				charges: [],
				approval_id: null
			} as never);
			// 施行細則 §24-1 values the days on the latest month's normal-hours wages: December 2025,
			// paid before this workspace ran payroll, recorded at 60,000 (60,000 / 30 × 5 = 10,000).
			world.employment_wage_periods = [
				{
					id: 'e1000000-0000-4000-8000-0000000enc03',
					employment_id: employment.id,
					period: { start: '2025-12-01', end: '2025-12-31' },
					currency: 'TWD',
					normal_wages: 60_000,
					ordinary_wages: null,
					ordinary_days: null,
					due_on: '2025-12-31',
					paid_on: '2025-12-31',
					reference: 'December 2025 payslip',
					approval_id: null
				} as never
			];
			// Ten weekdays of 09:00–23:00 less the 12:00–13:00 §35 rest: 13 worked, 5 beyond the day
			// — 50 in the month.
			for (const day of ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16'])
				punch(world, 'TW-FIFTY', `2026-01-${day}`, '09:00', '23:00', ['12:00', '13:00']);
		}
	);
	const encash = slips.get('TW-ENCASH')!;
	assert.equal(
		encash.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount,
		10_000
	);
	assert.deepEqual(charge(encash, 'INCOME_TAX'), [60_000, 3000, 0]);
	const fifty = slips.get('TW-FIFTY')!;
	assert.deepEqual(charge(fifty, 'INCOME_TAX'), [64_166.7, 3208, 0]);
});

test('Taiwan — thirty half-paid 普通傷病假 days a year, hospitalised or not, across entries (勞工請假規則 §4(3))', () => {
	// 60,000 a month, 2,000 a day over the agreed 30 (勞動2字第1020083156號). Thirty days of sick leave in
	// January and February on file, then ten
	// hospitalised days in March: the year's thirty half-paid days are spent, so the ten are
	// unpaid — a whole day each comes off, not a half.
	const sick = leaveCatalogue('TW').find(
		(row) => row.code === 'SICK_LEAVE' && row.settings_id === TW_2026
	)!;
	const hospitalised = leaveCatalogue('TW').find(
		(row) => row.code === 'HOSPITALISED_SICK_LEAVE' && row.settings_id === TW_2026
	)!;
	const entry = (
		world: PayrollWorld,
		key: string,
		id: string,
		catalogue: { id: string; code: string },
		dates: string[]
	) => {
		const employment = world.employments.find((row) => row.employee_number === key)!;
		const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
		world.leave_entries.push({
			id,
			employment_id: employment.id,
			catalogue_id: catalogue.id,
			leave_code: catalogue.code,
			reference: id,
			from_date: dates[0]!,
			to_date: dates.at(-1)!,
			half_day_start: false,
			half_day_end: false,
			days: dates.length,
			effective_on: dates[0]!,
			reason: '',
			allocations: [],
			charges: dates.map((date) => ({
				date,
				days: 1,
				catalogue_id: catalogue.id,
				employment_term_id: term.id,
				holiday_id: null,
				shift_definition_id: null,
				work_day_id: null
			})),
			approval_id: null
		} as never);
	};
	const weekdays = (month: string, from: number, count: number) => {
		const days: string[] = [];
		for (let day = from; days.length < count; day += 1) {
			const date = `${month}-${String(day).padStart(2, '0')}`;
			const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
			if (weekday !== 0 && weekday !== 6) days.push(date);
		}
		return days;
	};
	const build = (spent: boolean) =>
		buildStatutory(
			{
				code: 'TW',
				period: '2026-03',
				riskClass: '1',
				people: [{ key: 'TW-SICK', wage: 60_000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				world.leave_catalogue.push(
					{ ...sick, approval_id: null } as never,
					{ ...hospitalised, approval_id: null } as never
				);
				if (spent)
					entry(world, 'TW-SICK', 'e1000000-0000-4000-8000-0000000sick1', sick, [
						...weekdays('2026-01', 5, 20),
						...weekdays('2026-02', 2, 10)
					]);
				entry(
					world,
					'TW-SICK',
					'e1000000-0000-4000-8000-0000000hosp1',
					hospitalised,
					weekdays('2026-03', 2, 10)
				);
			}
		);
	const lines = (slip: BuiltPayslip) =>
		slip.adjustments
			.filter((row) => row.family === 'LEAVE')
			.map((row) => [row.quantity, row.amount, row.bucket] as const);
	const off = (slip: BuiltPayslip) => lines(slip).reduce((sum, line) => sum + line[1], 0);
	// The year's first hospitalised days: half-paid, ten days at half of 60,000 ÷ 30 = 1,000 off.
	assert.equal(lines(build(false).slips.get('TW-SICK')!).length, 10);
	assert.equal(off(build(false).slips.get('TW-SICK')!), 10_000);
	// After thirty sick days earlier in the year: unpaid, ten whole days of 2,000 off.
	assert.equal(off(build(true).slips.get('TW-SICK')!), 20_000);
});

test('Taiwan — a monthly worker retains the declared grade including regular overtime', () => {
	// 30,000 a month with 8,000 of overtime in each of November, December and January on file:
	// the March declaration reads the November–January average of 工資 — 38,000 — the 38,200
	// grade, not the 30,300 of the basic alone. A worker whose three months carried no overtime
	// stays on the contract's grade.
	const prior = (world: PayrollWorld, key: string, overtime: number) => {
		const employment = world.employments.find((row) => row.employee_number === key)!;
		for (const month of ['2025-11', '2025-12', '2026-01']) {
			world.payroll_runs.push({
				id: `prior-${month}-${key}`,
				company_id: COMPANY_ID,
				period: month
			});
			world.payslips.push({
				id: `payslip-${month}-${key}`,
				payroll_run_id: `prior-${month}-${key}`,
				employment_id: employment.id,
				status: 'PAID',
				paid_at: `${month}-28T00:00:00.000Z`,
				currency: 'TWD',
				base: [{ component_code: 'BASIC', amount: 30_000 }],
				adjustments:
					overtime > 0
						? [
								{
									family: 'WORK_DAY',
									component_code: 'OT-1.3333333333333333X',
									bucket: 'EARNING',
									amount: overtime
								}
							]
						: [],
				statutory: []
			} as never);
		}
	};
	const book = assessStatutory(
		{
			code: 'TW',
			period: '2026-03',
			riskClass: '1',
			people: [
				{ key: 'TW-OT-REG', wage: 30_000, citizenship: 'CITIZEN' },
				{ key: 'TW-OT-NONE', wage: 30_000, citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			prior(world, 'TW-OT-REG', 8_000);
			prior(world, 'TW-OT-NONE', 0);
			declareInsuredAmount(world, 'TW-OT-REG', 38200);
		}
	);
	assert.equal(book.get('TW-OT-REG')!.get('LI')!.base, 38_200);
	assert.equal(book.get('TW-OT-NONE')!.get('LI')!.base, 30_300);
});

test('Taiwan — work on the 例假 earns a further day’s wage whatever the hours (勞基法 §40); the 休息日 keeps §24(2)', () => {
	// Sunday is the REST code marked statutory (例假), Saturday the plain rest day (休息日). 60,000
	// a month, 2,000 a day. A four-hour clock on the Sunday, in an emergency, is four hours worked
	// (a §35 break owed and not taken is a breach, never unpaid time) and earns one further day's
	// wage, 2,000, not the 休息日's 4/3 and 5/3 hours (and a day off in lieu is owed, a CREDITED
	// leave row HR raises). The same clock on the Saturday: 2 × 333.33 + 2 × 416.67 = 1,500.
	const STATUTORY_REST = 'c0000000-0000-4000-8000-0000000000e9';
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [{ key: 'TW-LIJIA', wage: 60_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.shift_definitions.push({
				...world.shift_definitions[1]!,
				id: STATUTORY_REST,
				code: 'LIJIA',
				name: '例假',
				variant: { kind: 'REST', statutory: true }
			});
			world.shift_patterns[0]!.pattern.days[6] = { roster_code_id: STATUTORY_REST };
			punch(world, 'TW-LIJIA', '2026-01-10', '09:00', '13:00'); // Saturday 休息日
			punch(world, 'TW-LIJIA', '2026-01-11', '09:00', '13:00'); // Sunday 例假
		}
	);
	assert.deepEqual(workLines(slips.get('TW-LIJIA')!), [
		['2026-01-10', THIRD, 2, 666.67],
		['2026-01-10', TWO_THIRDS, 2, 833.33],
		['2026-01-11', 'REST-STATUTORY-DOUBLE', 4, 2000]
	]);
});

test('Taiwan — a 休息日 pays every worked hour beyond the provided §35 rest (勞基法 §24(2), §35)', () => {
	// 48,000 a month: 48,000 ÷ 30 ÷ 8 = 200 an hour. Two Saturday 休息日 clocks with no punched gap.
	// §24(2) prices the first two hours at 200 × 4/3 and every hour after at 200 × 5/3. §35 owes 30
	// minutes after more than four continuous hours (`consecutive_hours > 4.0` in the version's
	// `work_rules.breaks`), and the day has no shift to grant one, so the statute's 30 minutes come
	// off the span and 9.5 hours are paid. The four-hour stint crosses no trigger, so nothing is
	// deducted there.
	// 4 h: 2 × 266.67 = 533.33 + 2 × 333.33 = 666.67 → 1,200.
	// 10 h: 533.33 + 7.5 × 333.33 = 2,500 → 3,033.33.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-05',
			riskClass: '1',
			people: [{ key: 'TW-S8', wage: 48_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			punch(world, 'TW-S8', '2026-05-09', '09:00', '13:00'); // Saturday 休息日: 4 h
			punch(world, 'TW-S8', '2026-05-16', '09:00', '19:00'); // Saturday 休息日: 10 h
		}
	);
	assert.deepEqual(workLines(slips.get('TW-S8')!), [
		['2026-05-09', THIRD, 2, 533.33],
		['2026-05-09', TWO_THIRDS, 2, 666.67],
		['2026-05-16', THIRD, 2, 533.33],
		['2026-05-16', TWO_THIRDS, 7.5, 2500]
	]);
});

test('Taiwan — retained old-system pension requires dated proof and funds the employer reserve', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: 'TW',
				period: '2026-01',
				riskClass: '1',
				companyFacts: { pension_reserve_rate: 6 },
				people: [
					{
						key: 'TW-OLD',
						wage: 50_000,
						citizenship: 'CITIZEN',
						hire_date: '1998-03-01',
						registrations: { LABOR_PENSION: { kind: 'NOT_REGISTERED' } }
					}
				]
			}),
		/NOT_REGISTERED does not establish an old-system/
	);
	const { slips } = buildStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		companyFacts: { pension_reserve_rate: 6 },
		people: [
			{
				key: 'TW-OLD',
				wage: 50_000,
				citizenship: 'CITIZEN',
				hire_date: '1998-03-01',
				registrations: { LABOR_PENSION: RETAINED_OLD_PENSION }
			},
			{ key: 'TW-NEW', wage: 50_000, citizenship: 'CITIZEN' }
		]
	});
	assert.deepEqual(charge(slips.get('TW-OLD')!, 'LABOR_PENSION_RESERVE'), [50_000, 0, 3000]);
	assert.equal(charge(slips.get('TW-OLD')!, 'LABOR_PENSION')?.[2] ?? 0, 0);
	assert.equal(
		slips.get('TW-NEW')!.statutory.find((row) => row.scheme_code === 'LABOR_PENSION_RESERVE')
			?.employer_amount ?? 0,
		0
	);
});

test('Taiwan — pre-2005 pension retention applies in 2025 and refuses unsupported later hires', () => {
	const oldWorker = {
		key: 'TW-OLD-2025',
		wage: 50_000,
		citizenship: 'CITIZEN',
		hire_date: '1998-03-01',
		registrations: { LABOR_PENSION: RETAINED_OLD_PENSION }
	} as const;
	const book = assessStatutory({
		code: 'TW',
		period: '2025-12',
		riskClass: '1',
		companyFacts: { pension_reserve_rate: 6 },
		people: [oldWorker]
	});
	expectStatutory(book, 'TW-OLD-2025', 'LABOR_PENSION_RESERVE', 0, 3000);
	for (const person of [
		{ ...oldWorker, hire_date: '2005-07-01' },
		{
			...oldWorker,
			registrations: {
				LABOR_PENSION: {
					kind: 'NOT_REGISTERED',
					elections: { old_system_retained: true }
				}
			}
		}
	])
		assert.throws(
			() =>
				assessStatutory({
					code: 'TW',
					period: '2026-01',
					riskClass: '1',
					companyFacts: { pension_reserve_rate: 6 },
					people: [person]
				}),
			/NOT_REGISTERED does not establish an old-system/
		);
});

test('Taiwan — 資遣費 is 退職所得: 6% resident / 18% non-resident on the excess over the 定額免稅', () => {
	// Seven years’ service on a 1,000,000 wage pays 0.5 month per year: 3,500,000. 115年度
	// (財政部 114年11月27日 公告; DOT 115年度綜合所得稅公告重點): 206,000 × 7 = 1,442,000 is exempt, the band to 414,000 × 7 =
	// 2,898,000 half taxable, the rest whole — so 3,500,000 is taxed on 728,000 + 602,000 =
	// 1,330,000, withheld at 6% = 79,800. A 400,000 wage pays 1,400,000, under the exempt
	// ceiling: nothing withheld. A non-resident withholds 18% of the same 1,330,000.
	// 3 years 6 months of service rounds to 4 years (a tail of six months or more counts as one
	// year, 高雄國稅局): 0.5 × 3.5 = 1,750,000, taxed on (1,656,000 − 824,000)/2 +
	// (1,750,000 − 1,656,000) = 510,000, withheld 6% = 30,600 — 3.5 years of 年資 would have
	// taxed 514,500.
	const leaver = (key: string, wage: number, hire: string, exit: string, residency?: string) => ({
		key,
		wage,
		citizenship: 'CITIZEN',
		hire_date: hire,
		exit_date: exit,
		exit_ground: 'REDUNDANCY',
		...(residency != null ? { tax_residency: residency } : {})
	});
	// The off-boarding asks for the class; the band prices it from the wage, and `SEVERANCE_TAX`
	// reads the paid severance through its `assessed_on`.
	const paySeverance = (world: PayrollWorld, period: string) => {
		const version = world.jurisdiction_settings.find((row) =>
			String(row.effective_range.start).startsWith(period)
		)!;
		const catalogue = world.adhoc_catalogue!.find(
			(row) => row.code === 'SEVERANCE_PAY' && row.settings_id === version.id
		)!;
		// 平均工資 is read from the wages paid: six earlier payslips at each leaver's wage.
		const [year, month] = period.split('-').map(Number);
		const from =
			month! > 6
				? `${year}-${String(month! - 6).padStart(2, '0')}`
				: `${year! - 1}-${String(month! + 6).padStart(2, '0')}`;
		const to = month! > 1 ? `${year}-${String(month! - 1).padStart(2, '0')}` : `${year! - 1}-12`;
		for (const [index, employment] of world.employments.entries())
			priorWages(
				world,
				employment.employee_number,
				monthsAt(from, to, world.employment_terms[index]!.base_salary)
			);
		for (const [index, employment] of world.employments.entries())
			world.adhoc_requests!.push({
				id: `d0000000-0000-4000-8000-0000000000${index}c`,
				employment_id: employment.id,
				catalogue_id: catalogue.id,
				amount: 0,
				event_date: `${period}-31`,
				pay_period: period,
				payslip_id: null,
				reason: 'SEVERANCE_PAY',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
	};
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				// Service runs through the last day inclusive: 1 Feb 2019 – 31 Jan 2026 is seven
				// years exactly, 1 Aug 2022 – 31 Jan 2026 three years six months.
				leaver('TW-SEV-LARGE', 1_000_000, '2019-02-01', '2026-01-31'),
				leaver('TW-SEV-SMALL', 400_000, '2019-02-01', '2026-01-31'),
				leaver('TW-SEV-NR', 1_000_000, '2019-02-01', '2026-01-31', 'NON_RESIDENT'),
				leaver('TW-SEV-TAIL', 1_000_000, '2022-08-01', '2026-01-31')
			]
		},
		(world) => paySeverance(world, '2026-01')
	);
	const paid = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount;
	assert.equal(paid('TW-SEV-LARGE'), 3_500_000);
	assert.equal(paid('TW-SEV-SMALL'), 1_400_000);
	assert.deepEqual(charge(slips.get('TW-SEV-LARGE')!, 'SEVERANCE_TAX'), [3_500_000, 79_800, 0]);
	// The exemption: 1,400,000 sits under 206,000 × 7.
	assert.deepEqual(charge(slips.get('TW-SEV-SMALL')!, 'SEVERANCE_TAX'), [1_400_000, 0, 0]);
	assert.deepEqual(charge(slips.get('TW-SEV-NR')!, 'SEVERANCE_TAX'), [3_500_000, 239_400, 0]);
	assert.deepEqual(charge(slips.get('TW-SEV-TAIL')!, 'SEVERANCE_TAX'), [1_750_000, 30_600, 0]);
	// The class counts toward nothing: the monthly 薪資所得 withholding reads the wage alone, not
	// the severance beside it.
	const pension = slips
		.get('TW-SEV-LARGE')!
		.statutory.find((row) => row.scheme_code === 'LABOR_PENSION')!.employee_amount;
	assert.equal(charge(slips.get('TW-SEV-LARGE')!, 'INCOME_TAX')[0], 1_000_000 - pension);
	// The 民國114年 figures, 198,000 / 398,000 (財政部 113年11月28日 公告, unchanged), govern a severance
	// paid in December 2025: the same 3,500,000 is taxed on 1,414,000, withheld 84,840.
	const december = buildStatutory(
		{
			code: 'TW',
			period: '2025-12',
			riskClass: '1',
			// 1 Jan 2019 – 31 Dec 2025: seven years exactly.
			people: [leaver('TW-SEV-2025', 1_000_000, '2019-01-01', '2025-12-31')]
		},
		(world) => paySeverance(world, '2025-12')
	);
	assert.equal(
		december.slips
			.get('TW-SEV-2025')!
			.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount,
		3_500_000
	);
	assert.deepEqual(
		charge(december.slips.get('TW-SEV-2025')!, 'SEVERANCE_TAX'),
		[3_500_000, 84_840, 0]
	);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Whole payslips, computed by hand from the law (verification pass 2026-09-28). Each figure is
// the statute's; the engine is only compared with it.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Taiwan — a full month, end to end: every leg, gross, net and the employer’s cost (民國115年)', () => {
	// 50,000 a month, whole of January 2026, 5% election, 費率編號 1.
	// 勞保 §13–15 on the 45,800 ceiling (11.5%, 20/70): 5,267 → 1,053.40 → 1,053 / 3,686.90 → 3,687.
	// 就保 §40 1%: 458 → 91.60 → 92 / 320.60 → 321.
	// 健保 §27, §29: grade 50,600 × 5.17% = 2,616.02 → × 30% = 784.81 → 785; × 60% × 1.56 = 2,448.59 → 2,449.
	// 勞退 §14: 50,600 × 6% = 3,036. 職災 §16, §19: 50,600 × 0.25% = 126.50 → 127 (四捨五入).
	// 扣繳率標準 §2(1), 薪資所得扣繳辦法 §6: 50,000 × 5% = 2,500 (> 2,000).
	// 勞基法 §28 墊償基金 0.025% of the 勞保 grade, at company level: 11.45 → 11.
	const { slips, companyCharges } = buildStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'TW-FULL',
				wage: 50_000,
				citizenship: 'CITIZEN',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			}
		]
	});
	const slip = slips.get('TW-FULL')!;
	assert.equal(slip.gross, 50_000);
	assert.deepEqual(charge(slip, 'LI'), [45_800, 1053, 3687]);
	assert.deepEqual(charge(slip, 'EI'), [45_800, 92, 321]);
	assert.deepEqual(charge(slip, 'NHI'), [50_600, 785, 2449]);
	assert.deepEqual(charge(slip, 'LABOR_PENSION'), [50_600, 0, 3036]);
	assert.deepEqual(charge(slip, 'OCC_INJURY'), [50_600, 0, 127]);
	assert.deepEqual(charge(slip, 'INCOME_TAX'), [50_000, 2500, 0]);
	assert.equal(slip.total_deductions, 4430); // 1,053 + 92 + 785 + 2,500
	assert.equal(slip.net, 45_570);
	assert.equal(slip.employer_cost, 9620); // 3,687 + 321 + 2,449 + 3,036 + 127
	assert.deepEqual(companyCharges.get('WAGE_ARREARS_FUND'), [45_800, 11]);
	assert.equal(companyCharges.get('NHI_SUPPLEMENT_EMPLOYER'), undefined); // 50,000 < 50,600
});

test('Taiwan — a mid-month raise prorates each rate on calendar days; the insured grade waits for notification', () => {
	// 40,000 to 50,000 from 16 January 2026, employed the whole month: 30 days (民法 §123(2)) shared
	// by calendar day — 30 × 15/31 at 40,000 ÷ 30 = 19,354.84 and 30 × 16/31 at 50,000 ÷ 30 =
	// 25,806.45; gross 45,161.29, between the two whole months. Owner rule 2026-09-28: the law is
	// silent on a mid-month rate change; each rate takes its calendar share of the one month. 勞保條例 §14(2), 就保法 §40, 勞退條例
	// §15(2): an adjusted grade takes effect 自通知之次月一日, so January stays on the declared 40,100:
	// 勞保 922 / 3,228, 就保 80 / 281, 健保 622 / 1,940, 勞退 2,406. 5% of 45,161.29 = 2,258.06 → 2,258.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'TW-RAISE',
					wage: 40_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		},
		(world) => {
			declareInsuredAmount(world, 'TW-RAISE', 40100);
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000b001',
				base_salary: 50_000,
				effective_range: { start: '2026-01-16', end: null }
			});
			old.effective_range = { start: String(old.effective_range.start), end: '2026-01-15' };
		}
	);
	const slip = slips.get('TW-RAISE')!;
	assert.deepEqual(
		slip.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[
			[(30 * 15) / 31, 30, 19_354.84],
			[(30 * 16) / 31, 30, 25_806.45]
		]
	);
	assert.equal(slip.gross, 45_161.29);
	assert.deepEqual(charge(slip, 'LI'), [40_100, 922, 3228]);
	assert.deepEqual(charge(slip, 'EI'), [40_100, 80, 281]);
	assert.deepEqual(charge(slip, 'NHI'), [40_100, 622, 1940]);
	assert.deepEqual(charge(slip, 'LABOR_PENSION'), [40_100, 0, 2406]);
	assert.deepEqual(charge(slip, 'INCOME_TAX'), [45_161.29, 2258, 0]);
	assert.equal(slip.net, 45_161.29 - (922 + 80 + 622 + 2258));
});

test('Taiwan — a mid-month leaver: final pay, unused 特別休假 paid out, fifteen insured days and no 健保', () => {
	// Exit 15 January 2026 on 40,000 (grade 40,100), three unused days. 勞基法 §38(4) pays them on
	// termination; 施行細則 §24-1(2)(1): 一日工資 is the latest month's normal-hours wage ÷ 30 —
	// December 2025, 40,000 → 1,333.33… × 3 = 4,000. Salary 40,000 × 15/30 = 20,000 (民法 §123(2)).
	// 勞保施行細則 §28-1 (30-day month): 15 days. 勞保 4,611.50 × 20% × ½ = 461.15 → 461 / × 70% × ½ =
	// 1,614.03 → 1,614; 就保 40.10 → 40 / 140.35 → 140 (BLI 15-day row 501 / 1,754); 勞退 1,203;
	// 職災 100.25 × ½ = 50.13 → 50. 健保法 §30: not insured here at month end, no premium.
	// 5% of the salary 20,000 = 1,000 ≤ 2,000 → nothing withheld (§13).
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'TW-EXIT',
					wage: 40_000,
					citizenship: 'CITIZEN',
					hire_date: '2020-01-01',
					exit_date: '2026-01-15',
					exit_ground: 'RESIGNATION',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		},
		(world) => {
			const employment = world.employments[0]!;
			const annual = leaveCatalogue('TW').find(
				(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === TW_2026
			)!;
			world.leave_catalogue.push({ ...annual, approval_id: null } as never);
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-0000000exit2',
				employment_id: employment.id,
				catalogue_id: annual.id,
				leave_code: 'ANNUAL_LEAVE',
				reference: 'EXIT-TW',
				from_date: '2026-01-01',
				to_date: '2026-01-15',
				half_day_start: false,
				half_day_end: false,
				days: 3,
				encash_days: 3,
				effective_on: '2026-01-15',
				due_on: '2026-01-15',
				reason: 'Termination',
				allocations: [],
				charges: [],
				approval_id: null
			} as never);
			world.employment_wage_periods = [
				{
					id: 'e1000000-0000-4000-8000-0000000exit3',
					employment_id: employment.id,
					period: { start: '2025-12-01', end: '2025-12-31' },
					currency: 'TWD',
					normal_wages: 40_000,
					ordinary_wages: null,
					ordinary_days: null,
					due_on: '2025-12-31',
					paid_on: '2025-12-31',
					reference: 'December 2025 payslip',
					approval_id: null
				} as never
			];
		}
	);
	const slip = slips.get('TW-EXIT')!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount,
		4000
	);
	assert.equal(slip.gross, 24_000);
	assert.deepEqual(charge(slip, 'LI'), [40_100, 461, 1614]);
	assert.deepEqual(charge(slip, 'EI'), [40_100, 40, 140]);
	assert.deepEqual(charge(slip, 'LABOR_PENSION'), [40_100, 0, 1203]);
	assert.deepEqual(charge(slip, 'OCC_INJURY'), [40_100, 0, 50]);
	assert.equal(
		slip.statutory.find((row) => row.scheme_code === 'NHI'),
		undefined
	);
	assert.equal(
		slip.statutory.find((row) => row.scheme_code === 'INCOME_TAX')?.employee_amount ?? 0,
		0
	);
	assert.equal(slip.net, 24_000 - 501);
});

test('Taiwan — a year-end bonus: 5% withheld apart from salary, the §31 premium on the excess over four grades, the §34 employer levy', () => {
	// 40,000 (grade 40,100) with a 200,000 bonus in January 2026.
	// 扣繳辦法 §7 / etax 薪資扣繳 (115-04-10): 非每月給付之薪資 按給付額扣取5%，免併入全月給付總額 —
	// 200,000 ≥ 90,501 → 10,000; the salary alone is 40,000 × 5% = 2,000, not over 2,000 → 0.
	// 健保法 §31(1)(1): bonus over 4 × 40,100 = 160,400 → 39,600 × 2.11% = 835.56 → 836.
	// 健保法 §34: (240,000 − 40,100) × 2.11% = 4,217.89 → 4,218.
	const { slips, companyCharges } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'TW-BONUS',
					wage: 40_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === TW_2026
			)!;
			world.adhoc_requests!.push({
				id: 'd4000000-0000-4000-8000-000000000001',
				employment_id: world.employments[0]!.id,
				catalogue_id: bonus.id,
				amount: 200_000,
				event_date: '2026-01-01',
				pay_period: null,
				payslip_id: null,
				reason: 'Year-end bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	const slip = slips.get('TW-BONUS')!;
	assert.equal(slip.gross, 240_000);
	assert.deepEqual(charge(slip, 'INCOME_TAX_BONUS'), [200_000, 10_000, 0]);
	assert.equal(
		slip.statutory.find((row) => row.scheme_code === 'INCOME_TAX')?.employee_amount ?? 0,
		0
	);
	assert.deepEqual(charge(slip, 'NHI_SUPPLEMENT'), [200_000, 836, 0]);
	assert.deepEqual(companyCharges.get('NHI_SUPPLEMENT_EMPLOYER'), [240_000, 4218]);
	assert.equal(slip.net, 240_000 - (922 + 80 + 622 + 10_000 + 836));
});

test('Taiwan — the §31 bonus premium runs on the year’s accumulated bonuses, charged only on this payment’s share of the excess', () => {
	// 健保法 §31(1)(1): 全年累計逾當月投保金額四倍部分之獎金. 40,100 grade → threshold 160,400.
	// A 100,000 bonus paid in January (under it, nothing), then 100,000 in February: the year
	// reaches 200,000, 39,600 over → × 2.11% = 835.56 → 836, all of it inside this payment.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-02',
			riskClass: '1',
			people: [{ key: 'TW-BONUS-2', wage: 40_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const employment = world.employments[0]!;
			world.payroll_runs.push({ id: 'tw-jan-bonus', company_id: COMPANY_ID, period: '2026-01' });
			world.payslips.push({
				id: 'tw-jan-bonus-slip',
				payroll_run_id: 'tw-jan-bonus',
				employment_id: employment.id,
				status: 'PAID',
				paid_at: '2026-01-28T00:00:00.000Z',
				currency: 'TWD',
				base: [{ component_code: 'BASIC', amount: 40_000 }],
				adjustments: [
					{ family: 'ADHOC', component_code: 'bonus', bucket: 'EARNING', amount: 100_000 }
				],
				statutory: []
			} as never);
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === TW_2026
			)!;
			world.adhoc_requests!.push({
				id: 'd4000000-0000-4000-8000-000000000002',
				employment_id: employment.id,
				catalogue_id: bonus.id,
				amount: 100_000,
				event_date: '2026-02-01',
				pay_period: null,
				payslip_id: null,
				reason: 'Second bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	assert.deepEqual(charge(slips.get('TW-BONUS-2')!, 'NHI_SUPPLEMENT'), [100_000, 836, 0]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Round-2 gap closure (2026-09-28). Each figure is computed by hand from the cited provision.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Taiwan — 資遣費: the new system caps at six months and retained old-system years are payable', () => {
	// 勞工退休金條例 §12(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020): 每滿一年
	// 發給二分之一個月之平均工資，未滿一年者，以比例計給；最高以發給六個月平均工資為限. 勞基法 §17(1)
	// (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=17): 每滿一年發給相當於一個月
	// 平均工資之資遣費；剩餘月數…以比例計給之。未滿一個月者以一個月計 — and no ceiling. 勞退條例 §11(2)
	// keeps the pre-election seniority under §17. 平均工資 (§2(4)) is read from six earlier payslips at
	// the wage, so a month of it is that wage.
	//  - CAP: 1 Feb 2010 – 31 Jan 2026, sixteen years all new-system: 0.5 × 16 = 8 → capped at 6 ×
	//    50,000 = 300,000.
	//  - MIXED: 1 Feb 1999 – 31 Jan 2026 is 324 months; 76.5 retained old-system months (to 30 June
	//    2005, a part month at the end) count as 77 under §17: 77/12 months; the remaining 247.5 new
	//    months give 0.5 × 247.5 / 12 = 10.3125 → capped at 6. 50,000 × (77/12 + 6) = 620,833.33 →
	//    620,833. Full 30-day §16 notice given, so no notice pay. 115年度 退職所得 exempt to 206,000 ×
	//    27 = 5,562,000: nothing withheld.
	// OLD-ONLY retained the LSA system with documented 2005 election and same-unit service:
	// 40,000 × 275/12 = 916,666.67 → 916,667.
	const people = [
		{ key: 'TW-SEV-CAP', wage: 50_000, hire: '2010-02-01', facts: {} },
		{
			key: 'TW-SEV-MIXED',
			wage: 50_000,
			hire: '1999-02-01',
			facts: {
				lsa_termination_ground: 'ARTICLE_11',
				notice_days_given: 30,
				old_system_service_months: 76.5
			}
		},
		{
			key: 'TW-SEV-OLD-ONLY',
			wage: 40_000,
			hire: '2003-03-01',
			facts: { old_system_service_months: 275 },
			old: true
		}
	];
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			companyFacts: { pension_reserve_rate: 6 },
			people: people.map((person) => ({
				key: person.key,
				wage: person.wage,
				citizenship: 'CITIZEN',
				hire_date: person.hire,
				exit_date: '2026-01-31',
				exit_ground: 'REDUNDANCY',
				...('old' in person ? { registrations: { LABOR_PENSION: RETAINED_OLD_PENSION } } : {})
			}))
		},
		(world) => {
			const catalogue = world.adhoc_catalogue!.find(
				(row) => row.code === 'SEVERANCE_PAY' && row.settings_id === TW_2026
			)!;
			for (const [index, person] of people.entries()) {
				const employment = world.employments[index]! as { exit_facts?: unknown; id: string };
				employment.exit_facts = {
					...((employment.exit_facts as object | undefined) ?? {}),
					...person.facts
				};
				priorWages(world, person.key, monthsAt('2025-07', '2025-12', person.wage));
				world.adhoc_requests!.push({
					id: `d7000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
					employment_id: employment.id,
					catalogue_id: catalogue.id,
					amount: 0,
					event_date: '2026-01-31',
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
	const paid = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount;
	assert.equal(paid('TW-SEV-CAP'), 300_000);
	assert.equal(paid('TW-SEV-MIXED'), 620_833);
	assert.deepEqual(charge(slips.get('TW-SEV-MIXED')!, 'SEVERANCE_TAX'), [620_833, 0, 0]);
	assert.equal(paid('TW-SEV-OLD-ONLY'), 916_667);
});

test('Taiwan — 舊制退休金: 45-base cap, half-year rounding and job-caused disability', () => {
	// 勞基法 §55(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=55): 按其
	// 工作年資，每滿一年給與兩個基數。但超過十五年之工作年資，每滿一年給與一個基數，最高總數以四十五個
	// 基數為限。未滿半年者以半年計；滿半年者以一年計 — §55(1)(2) 加給百分之二十 for a §54(1)(2)
	// forced retirement whose disability was caused by the job; §55(2) one base is a month's average
	// wage at approved retirement. §53: 15 years at 55, 25 years, 10 years at 60; §54(1): 65, or
	// disability. 勞退條例 §11(2) pays retained old-system seniority the same on a §53/§54 end. Six
	// earlier payslips at the wage make a month's average wage that wage. All exit 31 Jan 2026.
	// OLD-43: 28 years old system: (30 + 13) × 50,000 = 2,150,000.
	// CAP: 41 years 5 months old system reaches the 45-base cap: 45 × 200,000 = 9,000,000.
	// Both have documented 2005 election and same-unit service.
	//  - HALF: 1 Aug 2000, aged 50, 25 years 6 months' service (§53(2): 25 years at any age); 63
	//    retained months = 5 years 3 months → 5.5: 11 bases × 50,000 = 550,000.
	//  - DUTY: 1 Feb 2003, aged 45, 23 years — eligible only as a §54(1)(2) disability retirement;
	//    29 retained months = 2 years 5 months → 2.5: 5 bases × 1.2 = 6 × 50,000 = 300,000.
	//  - EARLY: 1 Feb 2004, aged 54, 22 years: no §53 or §54 ground, so no retirement pay.
	const people = [
		{
			key: 'TW-RET-OLD-43',
			wage: 50_000,
			hire: '1998-02-01',
			age: 60,
			facts: { old_system_service_months: 336 },
			old: true
		},
		{
			key: 'TW-RET-CAP',
			wage: 200_000,
			hire: '1984-09-01',
			age: 65,
			facts: { old_system_service_months: 497 },
			old: true
		},
		{
			key: 'TW-RET-HALF',
			wage: 50_000,
			hire: '2000-08-01',
			age: 50,
			facts: { old_system_service_months: 63 }
		},
		{
			key: 'TW-RET-DUTY',
			wage: 50_000,
			hire: '2003-02-01',
			age: 45,
			facts: {
				old_system_service_months: 29,
				retirement_disability: true,
				retirement_disability_duty_caused: true
			}
		},
		{
			key: 'TW-RET-EARLY',
			wage: 50_000,
			hire: '2004-02-01',
			age: 54,
			facts: { old_system_service_months: 17 }
		}
	];
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			companyFacts: { pension_reserve_rate: 6 },
			people: people.map((person) => ({
				key: person.key,
				wage: person.wage,
				age: person.age,
				citizenship: 'CITIZEN',
				hire_date: person.hire,
				exit_date: '2026-01-31',
				exit_ground: 'RETIREMENT',
				...('old' in person ? { registrations: { LABOR_PENSION: RETAINED_OLD_PENSION } } : {})
			}))
		},
		(world) => {
			const catalogue = world.adhoc_catalogue!.find(
				(row) => row.code === 'RETIREMENT_PAY' && row.settings_id === TW_2026
			)!;
			for (const [index, person] of people.entries()) {
				const employment = world.employments[index]! as { exit_facts?: unknown; id: string };
				employment.exit_facts = {
					...((employment.exit_facts as object | undefined) ?? {}),
					...person.facts
				};
				priorWages(world, person.key, monthsAt('2025-07', '2025-12', person.wage));
				world.adhoc_requests!.push({
					id: `d7100000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
					employment_id: employment.id,
					catalogue_id: catalogue.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'RETIREMENT_PAY',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const paid = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'RETIREMENT_PAY')?.amount;
	assert.equal(paid('TW-RET-OLD-43'), 2_150_000);
	assert.deepEqual(charge(slips.get('TW-RET-OLD-43')!, 'SEVERANCE_TAX'), [2_150_000, 0, 0]);
	assert.equal(paid('TW-RET-CAP'), 9_000_000);
	assert.deepEqual(charge(slips.get('TW-RET-CAP')!, 'SEVERANCE_TAX'), [9_000_000, 13_530, 0]);
	assert.equal(paid('TW-RET-HALF'), 550_000);
	assert.equal(paid('TW-RET-DUTY'), 300_000);
	assert.equal(paid('TW-RET-EARLY'), undefined);
	// Outside the 薪資所得 withholding: the month's INCOME_TAX base is the wage alone.
	const pension = slips
		.get('TW-RET-HALF')!
		.statutory.find((row) => row.scheme_code === 'LABOR_PENSION')!.employee_amount;
	assert.equal(charge(slips.get('TW-RET-HALF')!, 'INCOME_TAX')[0], 50_000 - pension);
});

test('Taiwan — §16 notice by cause and service: 10 / 20 / 30 days on §11, the §13 proviso and §20; none on §14, §12, §15 or a fixed-term expiry', () => {
	// 勞基法 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001, last amended 113-07-31):
	// §16(1) 雇主依第十一條或第十三條但書規定終止勞動契約者 — 繼續工作三個月以上一年未滿者，於十日前預告;
	// 一年以上三年未滿者，於二十日前; 三年以上者，於三十日前. §16(3) 未依第一項規定期間預告而終止契約者，
	// 應給付預告期間之工資. §20 改組或轉讓: 其餘勞工應依第十六條規定期間預告終止契約，並應依第十七條
	// 規定發給勞工資遣費 — so §20 owes the notice too. §14 is the worker leaving 不經預告 (§14(4) applies
	// §17 severance only); §18: nothing on §12, §15 or 定期勞動契約期滿. The day wage is the higher of
	// monthly ÷ 30 and the average daily wage (勞動部 109年10月29日勞動關2字第1090128292A號令). New-system
	// severance (勞退條例 §12(1)): ½ month a year, pro rata, 30 × the average daily wage a month.
	// All NT$30,000 monthly (day wage 1,000), average daily wage declared 1,000, exit 31 Jan 2026:
	//  - §11, 2 months:  no notice owed;                    severance 30,000 × ½ × 2/12  =  2,500.
	//  - §11, 3 months:  10 days = 10,000 (三個月以上 includes 3); 30,000 × ½ × 3/12 = 3,750 → 13,750.
	//  - §11, 11 months: 10 days = 10,000;                  30,000 × ½ × 11/12 = 13,750 → 23,750.
	//  - §11, 12 months: 20 days = 20,000;                  30,000 × ½       = 15,000 → 35,000.
	//  - §11, 35 months: 20 days = 20,000;                  30,000 × ½ × 35/12 = 43,750 → 63,750.
	//  - §11, 36 months, 12 days' notice given, average daily wage 1,100 (above 1,000): 18 × 1,100 =
	//    19,800; 33,000 × ½ × 3 = 49,500 → 69,300.
	//  - §13 proviso, 36 months: 30 × 1,000 + 45,000 = 75,000.
	//  - §20, 36 months:         30 × 1,000 + 45,000 = 75,000.
	//  - §14, 36 months:         45,000 severance, no notice pay.
	//  - OTHER (a §12 dismissal or a §15 resignation) and END_OF_CONTRACT: no line.
	const people = [
		{ key: 'TW-N-2M', hire: '2025-12-01', ground: 'ARTICLE_11', reason: 'REDUNDANCY', paid: 2_500 },
		{
			key: 'TW-N-3M',
			hire: '2025-11-01',
			ground: 'ARTICLE_11',
			reason: 'REDUNDANCY',
			paid: 13_750
		},
		{
			key: 'TW-N-11M',
			hire: '2025-03-01',
			ground: 'ARTICLE_11',
			reason: 'REDUNDANCY',
			paid: 23_750
		},
		{
			key: 'TW-N-12M',
			hire: '2025-02-01',
			ground: 'ARTICLE_11',
			reason: 'REDUNDANCY',
			paid: 35_000
		},
		{
			key: 'TW-N-35M',
			hire: '2023-03-01',
			ground: 'ARTICLE_11',
			reason: 'REDUNDANCY',
			paid: 63_750
		},
		{
			key: 'TW-N-36M-PART',
			hire: '2023-02-01',
			ground: 'ARTICLE_11',
			reason: 'REDUNDANCY',
			given: 12,
			adw: 1_100,
			paid: 69_300
		},
		{
			key: 'TW-N-13P',
			hire: '2023-02-01',
			ground: 'ARTICLE_13_PROVISO',
			reason: 'UNILATERAL',
			paid: 75_000
		},
		{
			key: 'TW-N-20',
			hire: '2023-02-01',
			ground: 'ARTICLE_20',
			reason: 'UNILATERAL',
			paid: 75_000
		},
		{
			key: 'TW-N-14',
			hire: '2023-02-01',
			ground: 'ARTICLE_14',
			reason: 'RESIGNATION',
			paid: 45_000
		},
		{ key: 'TW-N-12', hire: '2023-02-01', ground: 'OTHER', reason: 'DISMISSAL', paid: undefined },
		// §15(2): a worker on an indefinite contract resigns on the §16 notice periods; §18(1) owes no
		// notice pay and no severance on §15, exactly as on §12, so OTHER carries both.
		{ key: 'TW-N-15', hire: '2023-02-01', ground: 'OTHER', reason: 'RESIGNATION', paid: undefined },
		{
			key: 'TW-N-FIXED',
			hire: '2023-02-01',
			ground: undefined,
			reason: 'END_OF_CONTRACT',
			paid: undefined
		}
	];
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: people.map((person) => ({
				key: person.key,
				wage: 30_000,
				citizenship: 'CITIZEN',
				hire_date: person.hire,
				exit_date: '2026-01-31',
				exit_ground: person.reason
			}))
		},
		(world) => {
			const catalogue = world.adhoc_catalogue!.find(
				(row) => row.code === 'SEVERANCE_PAY' && row.settings_id === TW_2026
			)!;
			for (const [index, person] of people.entries()) {
				const employment = world.employments[index]! as { exit_facts?: unknown; id: string };
				employment.exit_facts = {
					...((employment.exit_facts as object | undefined) ?? {}),
					...(person.ground ? { lsa_termination_ground: person.ground } : {}),
					notice_days_given: person.given ?? 0,
					average_daily_wage: person.adw ?? 1_000,
					old_system_service_months: 0
				};
				world.adhoc_requests!.push({
					id: `d7100000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
					employment_id: employment.id,
					catalogue_id: catalogue.id,
					amount: 0,
					event_date: '2026-01-31',
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
	for (const person of people)
		assert.equal(
			slips.get(person.key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')
				?.amount,
			person.paid,
			person.key
		);
});

test('Taiwan — §13: no §11 or §20 termination inside the §59 medical period; the proviso still severs (勞基法 §13, §16, §17)', () => {
	// 勞基法 §13 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=13): 勞工在第五十條
	// 規定之停止工作期間或第五十九條規定之醫療期間，雇主不得終止契約。但雇主因天災、事變或其他不可抗力致
	// 事業不能繼續，經報主管機關核定者，不在此限. 公傷病假 (勞工請假規則 §6) is the §59 medical period, its
	// entry's own dates. NT$30,000 monthly, hired 1 Feb 2023, 公傷病假 26–31 Jan 2026, last day 31 Jan:
	//  - §11 (REDUNDANCY) on that day is refused: the departure names §13.
	//  - REDUNDANCY with no ground is not read as §11 there: the ground is required, and the request is
	//    skipped as incomplete.
	//  - §13 proviso: 36 months, no notice given, average daily wage 1,000: §16 30 days = 30,000;
	//    勞退條例 §12(1) ½ × 3 years × 30,000 = 45,000 → 75,000 (as in the §16 golden above).
	//  - §14 (the worker's own termination) is outside §13, which binds the employer: 45,000.
	const injury = leaveCatalogue('TW').find(
		(row) => row.code === 'OCCUPATIONAL_INJURY_LEAVE' && row.settings_id === TW_2026
	)!;
	const run = (ground: string | undefined, reason: string) =>
		buildStatutory(
			{
				code: 'TW',
				period: '2026-01',
				riskClass: '1',
				people: [
					{
						key: 'TW-S13',
						wage: 30_000,
						citizenship: 'CITIZEN',
						hire_date: '2023-02-01',
						exit_date: '2026-01-31',
						exit_ground: reason
					}
				]
			},
			(world) => {
				world.leave_catalogue.push({ ...injury, approval_id: null } as never);
				const employment = world.employments[0]! as { exit_facts?: unknown; id: string };
				const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				employment.exit_facts = {
					...((employment.exit_facts as object | undefined) ?? {}),
					...(ground ? { lsa_termination_ground: ground } : {}),
					notice_days_given: 0,
					average_daily_wage: 1_000,
					old_system_service_months: 0
				};
				const days = [26, 27, 28, 29, 30].map((day) => `2026-01-${day}`);
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-0000000s1301',
					employment_id: employment.id,
					catalogue_id: injury.id,
					leave_code: injury.code,
					reference: 'INJ-S13',
					from_date: '2026-01-26',
					to_date: '2026-01-31',
					half_day_start: false,
					half_day_end: false,
					days: days.length,
					effective_on: '2026-01-26',
					reason: '職業災害',
					allocations: [],
					charges: days.map((date) => ({
						date,
						days: 1,
						catalogue_id: injury.id,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				} as never);
				world.adhoc_requests!.push({
					id: 'd7200000-0000-4000-8000-000000000001',
					employment_id: employment.id,
					catalogue_id: world.adhoc_catalogue!.find(
						(row) => row.code === 'SEVERANCE_PAY' && row.settings_id === TW_2026
					)!.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'SEVERANCE_PAY',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
	const severance = (result: ReturnType<typeof run>) =>
		result.slips.get('TW-S13')!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')
			?.amount;
	assert.throws(() => run('ARTICLE_11', 'REDUNDANCY'), /§13/);
	assert.throws(() => run('ARTICLE_20', 'UNILATERAL'), /§13/);
	const unstated = run(undefined, 'REDUNDANCY');
	assert.equal(severance(unstated), undefined);
	assert.ok(unstated.warnings.some((warning) => /termination ground is required/.test(warning)));
	assert.equal(severance(run('ARTICLE_13_PROVISO', 'UNILATERAL')), 75_000);
	assert.equal(severance(run('ARTICLE_14', 'RESIGNATION')), 45_000);
});

test('Taiwan — an insured PR foreign professional owes the new pension; old-system election needs proof', () => {
	// BLI 2026 notice (https://www.bli.gov.tw/0109916.html, updated 2026-08-06): 外國專業人才及外國
	// 特定專業人才，無論是否取得永久居留身分，自115年1月1日起適用勞退新制; one employed before may keep
	// the old system by electing in writing by 30 June 2026, 屆期未選擇者一律適用勞退新制.
	// A professional with PR and documented EI cover owes 6% on the 40,100 pension grade: 2,406.
	// An old-system election requires dated evidence; NOT_REGISTERED alone cannot price its reserve.
	const { slips } = buildStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		companyFacts: { pension_reserve_rate: 6 },
		people: [
			{
				key: 'TW-FP-NEW',
				wage: 40_000,
				citizenship: 'PERMANENT_RESIDENT',
				pass_type: 'EMPLOYMENT_PASS',
				registrations: {
					EI: {
						kind: 'REGISTERED',
						elections: {
							eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
							eligibility_document_reference: 'FIXTURE-PR-PROFESSIONAL'
						}
					}
				}
			}
		]
	});
	assert.deepEqual(charge(slips.get('TW-FP-NEW')!, 'LABOR_PENSION'), [40_100, 0, 2406]);
	assert.equal(
		slips.get('TW-FP-NEW')!.statutory.find((row) => row.scheme_code === 'LABOR_PENSION_RESERVE')
			?.employer_amount ?? 0,
		0
	);
	assert.throws(
		() =>
			assessStatutory({
				code: 'TW',
				period: '2026-01',
				riskClass: '1',
				companyFacts: { pension_reserve_rate: 6 },
				people: [
					{
						key: 'TW-FP-OLD',
						wage: 40_000,
						citizenship: 'PERMANENT_RESIDENT',
						pass_type: 'EMPLOYMENT_PASS',
						hire_date: '2020-01-01',
						registrations: {
							EI: {
								kind: 'REGISTERED',
								elections: {
									eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
									eligibility_document_reference: 'FIXTURE-PR-PROFESSIONAL'
								}
							},
							LABOR_PENSION: { kind: 'NOT_REGISTERED' }
						}
					}
				]
			}),
		/NOT_REGISTERED does not establish an old-system/
	);
});

test('Taiwan — a documented pre-2026 foreign professional may keep the old pension system', () => {
	const person = {
		key: 'TW-FP-ELECTED',
		wage: 40_000,
		citizenship: 'PERMANENT_RESIDENT',
		pass_type: 'EMPLOYMENT_PASS',
		hire_date: '2020-01-01',
		registrations: {
			EI: {
				kind: 'REGISTERED',
				elections: {
					eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
					eligibility_document_reference: 'FIXTURE-PR-PROFESSIONAL'
				}
			},
			LABOR_PENSION: {
				kind: 'NOT_REGISTERED',
				declaration_reference: 'FIXTURE-2026-06-30-WRITTEN-ELECTION-AND-SAME-UNIT',
				elections: {
					professional_work_class: 'FOREIGN_PROFESSIONAL',
					professional_old_election_on: '2026-06-30'
				}
			}
		}
	} as const;
	const run = (candidate: Parameters<typeof buildStatutory>[0]['people'][number]) =>
		buildStatutory({
			code: 'TW',
			period: '2026-07',
			riskClass: '1',
			companyFacts: { pension_reserve_rate: 6 },
			people: [candidate]
		});
	const { slips } = run(person);
	assert.equal(charge(slips.get(person.key)!, 'LABOR_PENSION')?.[2] ?? 0, 0);
	assert.deepEqual(charge(slips.get(person.key)!, 'LABOR_PENSION_RESERVE'), [40_000, 0, 2400]);
	for (const candidate of [
		{ ...person, hire_date: '2026-01-01' },
		{
			...person,
			registrations: {
				...person.registrations,
				LABOR_PENSION: {
					...person.registrations.LABOR_PENSION,
					elections: {
						...person.registrations.LABOR_PENSION.elections,
						professional_old_election_on: '2026-07-01'
					}
				}
			}
		},
		{
			...person,
			registrations: {
				...person.registrations,
				LABOR_PENSION: {
					...person.registrations.LABOR_PENSION,
					declaration_reference: ''
				}
			}
		},
		{ ...person, pass_type: null },
		{ ...person, pass_type: 'WORK_PERMIT' }
	])
		assert.throws(() => run(candidate), /NOT_REGISTERED does not establish an old-system/);
});

for (const { period, transition, election, residencySince, passType, age } of [
	{
		period: '2025-12',
		transition: 'FOREIGN_PROFESSIONAL_2018',
		election: '2018-08-06',
		residencySince: '2017-01-01',
		passType: 'EMPLOYMENT_PASS',
		age: 40
	},
	{
		period: '2026-01',
		transition: 'FOREIGN_PROFESSIONAL_2018',
		election: '2018-08-06',
		residencySince: '2017-01-01',
		passType: 'EMPLOYMENT_PASS',
		age: 40
	},
	{
		period: '2025-12',
		transition: 'FOREIGN_NONPROFESSIONAL_2019',
		election: '2019-11-15',
		residencySince: '2018-01-01',
		passType: 'OTHER',
		age: 40
	},
	{
		period: '2026-01',
		transition: 'FOREIGN_NONPROFESSIONAL_2019',
		election: '2019-11-15',
		residencySince: '2018-01-01',
		passType: 'OTHER',
		age: 40
	}
])
	test(`Taiwan ${period} — documented ${transition} retains old pension at the same unit`, () => {
		// BLI transition guide §§5–6: https://www.bli.gov.tw/en/0010369.html.
		const person = {
			key: 'TW-PR-OLD',
			wage: 40_000,
			citizenship: 'PERMANENT_RESIDENT',
			residency_since: residencySince,
			pass_type: passType,
			age,
			hire_date: '2017-01-01',
			registrations: {
				EI:
					transition === 'FOREIGN_PROFESSIONAL_2018'
						? period === '2025-12'
							? {
									kind: 'NOT_REGISTERED',
									declaration_reference: 'FIXTURE-PR-PROFESSIONAL-PRE2026-NONCOVERAGE',
									elections: { pr_professional_pre2026_excluded: true }
								}
							: {
									kind: 'REGISTERED',
									elections: {
										eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
										eligibility_document_reference: 'FIXTURE-PR-PROFESSIONAL-CLASS'
									}
								}
						: {
								kind: 'NOT_REGISTERED',
								declaration_reference: 'FIXTURE-PR-NONPROFESSIONAL-NONSPOUSE-BLI-CLASS',
								elections: { pr_nonprofessional_excluded: true }
							},
				LABOR_PENSION: {
					kind: 'NOT_REGISTERED',
					declaration_reference: 'FIXTURE-PR-WRITTEN-OLD-ELECTION-SAME-UNIT',
					elections: {
						pr_old_transition_class: transition,
						pr_old_election_on: election
					}
				}
			}
		} as const;
		const run = (candidate: Parameters<typeof buildStatutory>[0]['people'][number]) =>
			buildStatutory({
				code: 'TW',
				period,
				riskClass: '1',
				companyFacts: { pension_reserve_rate: 6 },
				people: [candidate]
			});
		const { slips } = run(person);
		const slip = slips.get(person.key)!;
		assert.equal(
			charge(slip, 'EI')?.[1] ?? 0,
			transition === 'FOREIGN_PROFESSIONAL_2018' && period === '2026-01' ? 80 : 0
		);
		assert.equal(charge(slip, 'LABOR_PENSION')?.[2] ?? 0, 0);
		assert.deepEqual(charge(slip, 'LABOR_PENSION_RESERVE'), [40_000, 0, 2400]);
		for (const candidate of [
			{
				...person,
				hire_date: transition === 'FOREIGN_PROFESSIONAL_2018' ? '2018-02-08' : '2019-05-17'
			},
			{
				...person,
				residency_since: transition === 'FOREIGN_PROFESSIONAL_2018' ? '2018-02-09' : '2019-05-18'
			},
			{
				...person,
				registrations: {
					...person.registrations,
					LABOR_PENSION: {
						...person.registrations.LABOR_PENSION,
						elections: {
							...person.registrations.LABOR_PENSION.elections,
							pr_old_election_on:
								transition === 'FOREIGN_PROFESSIONAL_2018' ? '2018-08-07' : '2019-11-16'
						}
					}
				}
			},
			{
				...person,
				registrations: {
					...person.registrations,
					LABOR_PENSION: { ...person.registrations.LABOR_PENSION, declaration_reference: '' }
				}
			}
		])
			assert.throws(() => run(candidate), /NOT_REGISTERED does not establish an old-system/);
		if (transition === 'FOREIGN_PROFESSIONAL_2018' && period === '2025-12')
			assert.throws(
				() =>
					run({
						...person,
						registrations: { ...person.registrations, EI: { kind: 'NOT_REGISTERED' } }
					}),
				/NOT_REGISTERED does not prove an exclusion/
			);
	});

test('Taiwan — PR nonprofessional EI exclusion needs dated classification and evidence', () => {
	const person = {
		key: 'TW-PR-EI-EXCLUDED',
		wage: 40_000,
		citizenship: 'PERMANENT_RESIDENT',
		residency_since: '2020-01-01',
		pass_type: 'OTHER',
		registrations: {
			EI: {
				kind: 'NOT_REGISTERED',
				declaration_reference: 'FIXTURE-PR-NONPROFESSIONAL-NONSPOUSE-BLI-CLASS',
				elections: { pr_nonprofessional_excluded: true }
			}
		}
	} as const;
	const run = (candidate: Parameters<typeof buildStatutory>[0]['people'][number]) =>
		buildStatutory({ code: 'TW', period: '2026-01', riskClass: '1', people: [candidate] });
	assert.equal(charge(run(person).slips.get(person.key)!, 'EI')?.[1] ?? 0, 0);
	for (const candidate of [
		{ ...person, residency_since: '' },
		{ ...person, residency_since: '2026-02-01' },
		{
			...person,
			registrations: {
				EI: { ...person.registrations.EI, declaration_reference: '' }
			}
		},
		{
			...person,
			registrations: {
				EI: { ...person.registrations.EI, elections: { pr_nonprofessional_excluded: false } }
			}
		}
	])
		assert.throws(() => run(candidate), /NOT_REGISTERED does not prove an exclusion/);
});

for (const period of ['2025-12', '2026-01'])
	test(`Taiwan ${period} — a later PR grant opens a six-month old-pension election for a worker serving the unit before 2019-05-17`, () => {
		// 勞工退休金條例 §8-1(1)(3), (2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030020&flno=8-1):
		// a PR granted after the 2019 amendment applies the Act from the grant day; one already serving the same
		// unit before 2019-05-17 may elect the LSA system in writing 於適用本條例之日起六個月內. Grant 2024-03-01:
		// an election on 2024-08-31 is inside, on 2024-09-01 outside (default: before add_months(grant, 6)).
		// §56(1) reserve 40,000 × 6% = 2,400.
		const person = (electedOn: string) => ({
			key: 'TW-LATER-PR-OLD',
			wage: 40_000,
			citizenship: 'PERMANENT_RESIDENT',
			residency_since: '2024-03-01',
			pass_type: 'OTHER',
			hire_date: '2017-01-01',
			registrations: {
				EI: {
					kind: 'NOT_REGISTERED',
					declaration_reference: 'FIXTURE-PR-NONPROFESSIONAL-NONSPOUSE-BLI-CLASS',
					elections: { pr_nonprofessional_excluded: true }
				},
				LABOR_PENSION: {
					kind: 'NOT_REGISTERED',
					declaration_reference: 'FIXTURE-2024-PR-GRANT-WRITTEN-ELECTION',
					elections: {
						pr_old_transition_class: 'FOREIGN_LATER_PR_GRANT',
						pr_old_election_on: electedOn
					}
				}
			}
		});
		const run = (electedOn: string) =>
			buildStatutory({
				code: 'TW',
				period,
				riskClass: '1',
				companyFacts: { pension_reserve_rate: 6 },
				people: [person(electedOn)]
			});
		const slip = run('2024-08-31').slips.get('TW-LATER-PR-OLD')!;
		assert.equal(charge(slip, 'LABOR_PENSION_RESERVE')[2], 2400);
		assert.equal(charge(slip, 'LABOR_PENSION')?.[2] ?? 0, 0);
		assert.throws(() => run('2024-09-01'), /NOT_REGISTERED does not establish an old-system/);
	});

for (const period of ['2025-12', '2026-01'])
	test(`Taiwan ${period} — a documented four-worker company has EI and OCC cover without an LI unit`, () => {
		const worker = (index: number) => ({
			key: `TW-SMALL-${index}`,
			wage: 40_000,
			citizenship: 'CITIZEN',
			registrations: {
				LI: {
					kind: 'NOT_REGISTERED',
					declaration_reference: 'FIXTURE-BLI-NO-LI-UNIT-AND-EI-OCC-ENROLMENT'
				}
			}
		});
		const people = [1, 2, 3, 4].map(worker);
		const companyFacts = {
			li_unit_class: 'COMPANY_OR_SHOP',
			li_no_insurance_unit: true,
			li_unit_evidence_reference: 'FIXTURE-BLI-UNIT-HISTORY-FOUR-WORKERS'
		};
		const run = (
			candidates: Parameters<typeof buildStatutory>[0]['people'],
			facts: Parameters<typeof buildStatutory>[0]['companyFacts'] = companyFacts
		) =>
			buildStatutory({
				code: 'TW',
				period,
				riskClass: '1',
				companyFacts: facts,
				people: candidates
			});
		const { slips } = run(people);
		assert.equal(charge(slips.get('TW-SMALL-1')!, 'LI')?.[1] ?? 0, 0);
		assert.equal(charge(slips.get('TW-SMALL-1')!, 'LI')?.[2] ?? 0, 0);
		assert.ok((charge(slips.get('TW-SMALL-1')!, 'EI')?.[2] ?? 0) > 0);
		assert.ok((charge(slips.get('TW-SMALL-1')!, 'OCC_INJURY')?.[2] ?? 0) > 0);
		assert.throws(
			() => run([...people, worker(5)]),
			/NOT_REGISTERED does not prove a noncompulsory employer or worker class/
		);
		assert.throws(
			// The evidence reference is required whenever the no-LI-unit fact is declared: with no
			// reference recorded at all, the run refuses before it reads the unit class.
			() => run(people, { li_unit_class: 'COMPANY_OR_SHOP', li_no_insurance_unit: true }),
			/BLI unit-class and no-LI-unit evidence reference is required/
		);
		assert.throws(
			() => run([{ ...worker(1), registrations: {} }, ...people.slice(1)]),
			/an employer declared to have no LI unit cannot also price a registered LI worker/
		);
	});

for (const period of ['2025-12', '2026-01'])
	test(`Taiwan ${period} — employment insurance stops on the 65th birthday itself (BLI 就業保險 FAQ 承保業務 Q4)`, () => {
		// 就業保險法 §5(1): 年滿十五歲以上，六十五歲以下. BLI (https://www.bli.gov.tw/0017586.html,
		// updated 2024-05-30): 本局會主動自其滿65歲當日將其改列為不適用就業保險身分 — the birthday is the
		// first uncovered day. Born on the 15th: days 1–14 insured on the 30-day month (勞保施行細則
		// §28-1). 40,100 × 1% × 14/30 = 187.13 → 20% = 37.43 → 37; 70% = 130.99 → 131. The 1% rate
		// and the 40,100 grade stand in each sealed version.
		const [year, month] = period.split('-');
		const book = assessStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [
				{
					key: 'TW-65-MID',
					wage: 40_000,
					birth_date: `${Number(year) - 65}-${month}-15`,
					citizenship: 'CITIZEN'
				}
			]
		});
		expectStatutory(book, 'TW-65-MID', 'EI', 37, 131);
	});

test('Taiwan — a leaver: final wages are due on the last day (勞基法施行細則 §9), and the month’s 5% withholding runs on what is paid', () => {
	// 施行細則 §9 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=9): 勞雇雙方
	// 終止勞動契約時，勞工應領之工資，雇主應即結清給付 — a month-end run paying a 15 January leaver is
	// late, and the run says so, naming the rule and the day.
	// 100,000 on the 5% election, last day 15 January 2026: 100,000 × 15/30 = 50,000 (民法 §123(2)).
	// No voluntary pension. 5% = 2,500, over §13's 2,000 → withheld 2,500.
	const { slips, warnings } = buildStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'TW-LEAVER-TAX',
				wage: 100_000,
				citizenship: 'CITIZEN',
				hire_date: '2020-01-01',
				exit_date: '2026-01-15',
				exit_ground: 'RESIGNATION',
				registrations: {
					INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
				}
			}
		]
	});
	const slip = slips.get('TW-LEAVER-TAX')!;
	assert.equal(slip.gross, 50_000);
	assert.deepEqual(charge(slip, 'INCOME_TAX'), [50_000, 2500, 0]);
	const late = warnings.find((warning) => warning.includes('FINAL_PAY_LATE'));
	assert.ok(late, `expected a final-pay warning, got ${JSON.stringify(warnings)}`);
	assert.match(late, /art\.9/);
	assert.match(late, /2026-01-15/);
});

// TW-TAX-06. 營利事業所得稅查核準則 §88(2)(1) (amended 11 December 2023, from 1 January 2023;
// https://law-out.mof.gov.tw/LawContent.aspx?id=FL006027): 按月定額發給員工伙食代金…免視為員工之薪資所得
// to 職工每人每月…最高以新臺幣三千元為限, and 其超過部分…應轉列員工之薪資所得. The 伙食津貼 stays 工資
// (勞基法施行細則 §10 does not exclude it), so only the 薪資所得 bases subtract the first 3,000.
test('Taiwan — a monthly 伙食代金 is outside 薪資所得 to NT$3,000 (查核準則 §88)', () => {
	const five = {
		INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
	};
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{ key: 'TW-MEAL-3500', wage: 40_000, citizenship: 'CITIZEN', registrations: five },
				{ key: 'TW-MEAL-2000', wage: 40_000, citizenship: 'CITIZEN', registrations: five },
				{
					key: 'TW-MEAL-NR',
					wage: 40_000,
					citizenship: 'CITIZEN',
					tax_residency: 'NON_RESIDENT'
				}
			]
		},
		(world) => {
			const meal = world.allowance_catalogue.find(
				(row) => row.code === 'MEAL_ALLOWANCE' && row.settings_id === TW_2026
			)!;
			for (const [index, employment] of world.employments.entries())
				assignAllowance(world, {
					id: `d0000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: meal.id,
					amount: employment.employee_number === 'TW-MEAL-2000' ? 2000 : 3500,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: '',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			for (const employment of world.employments)
				declareInsuredAmount(world, employment.employee_number, 43900);
		}
	);
	// 40,000 + 3,500 = 43,500 paid; 薪資所得 40,000 + (3,500 − 3,000) = 40,500. 5% = 2,025, over
	// §13's 2,000, so withheld whole.
	const over = slips.get('TW-MEAL-3500')!;
	assert.equal(over.gross, 43_500);
	assert.deepEqual(charge(over, 'INCOME_TAX'), [40_500, 2025, 0]);
	// 2,000 is inside the cap: 薪資所得 40,000, 5% = 2,000, not over §13's 2,000 — nothing withheld.
	assert.deepEqual(charge(slips.get('TW-MEAL-2000')!, 'INCOME_TAX'), [40_000, 0, 0]);
	// Non-resident: 各類所得扣繳率標準 §3(1)(1) — 6% where the month's salary is at most 1.5 × the
	// 29,500 minimum wage (44,250): floor(40,500 × 6%) = 2,430.
	assert.deepEqual(charge(slips.get('TW-MEAL-NR')!, 'INCOME_TAX_NON_RESIDENT'), [40_500, 2430, 0]);
});

test('Taiwan — an elected §59 offset comes off net pay and leaves the 原領工資, gross and every statutory base whole (勞基法 §59 但書, 施行細則 §10(7))', () => {
	// 勞基法 §59 但書 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=59): 如同一事故，依勞工保險
	// 條例或其他法令規定，已由雇主支付費用補償者，雇主得予以抵充之. The benefit offset is the one the worker drew for
	// the same accident — 災保法 §42 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050031&flno=42) 傷病給付
	// from the fourth day off work; the figure is the insurer's, entered by HR (8,470 here, fixture input).
	// 施行細則 §10(7) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=10): 職業災害補償費 is not
	// 工資, so the offset reduces no wage or insured base (Owner rule 2026-09-28): same gross, same statutory
	// rows, net lower by exactly 8,470. NT$36,000 a month, ten 公傷病假 weekdays 6–17 April 2026.
	const injury = leaveCatalogue('TW').find(
		(row) => row.code === 'OCCUPATIONAL_INJURY_LEAVE' && row.settings_id === TW_2026
	)!;
	const days = [6, 13].flatMap((monday) =>
		[0, 1, 2, 3, 4].map((offset) => `2026-04-${String(monday + offset).padStart(2, '0')}`)
	);
	const run = (offset: number) =>
		buildStatutory(
			{
				code: 'TW',
				period: '2026-04',
				riskClass: '1',
				people: [{ key: 'TW-OFFSET', wage: 36_000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				world.leave_catalogue.push({ ...injury, approval_id: null } as never);
				const employment = world.employments[0]!;
				const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-0000000inj02',
					employment_id: employment.id,
					catalogue_id: injury.id,
					leave_code: injury.code,
					reference: 'INJ-2',
					from_date: days[0]!,
					to_date: days.at(-1)!,
					half_day_start: false,
					half_day_end: false,
					days: days.length,
					effective_on: days[0]!,
					reason: '職業災害',
					allocations: [],
					charges: days.map((date) => ({
						date,
						days: 1,
						catalogue_id: injury.id,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				} as never);
				if (offset === 0) return;
				const catalogue = world.adhoc_catalogue!.find(
					(row) => row.code === 'OCC_INJURY_OFFSET' && row.settings_id === TW_2026
				)!;
				world.adhoc_requests!.push({
					id: 'd4000000-0000-4000-8000-000000000059',
					employment_id: employment.id,
					catalogue_id: catalogue.id,
					amount: offset,
					event_date: '2026-04-06',
					pay_period: null,
					payslip_id: null,
					reason: '勞基法 §59 但書 抵充: 災保 傷病給付',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		).slips.get('TW-OFFSET')!;
	const whole = run(0);
	const offset = run(8_470);
	assert.equal(whole.gross, 36_000);
	assert.equal(offset.gross, 36_000);
	assert.deepEqual(offset.statutory, whole.statutory);
	assert.equal(offset.net, whole.net - 8_470);
});

test('Taiwan — a served wage garnishment comes off net pay at the ordered amount and leaves gross and every statutory line whole (強制執行法 §115-1)', () => {
	// 強制執行法 §115-1 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0010004&flno=115-1): the attachment
	// order on 自然人因提供勞務而獲得之繼續性報酬債權 不得逾各期給付數額三分之一, and the court may depart from that
	// ratio while reserving the debtor's 生活費用 — the ceiling binds the order, so the employer deducts exactly
	// what the order fixes (fixture: 12,000 a month, one third of 36,000). Owner rule 2026-09-28: law silent on
	// the booking; default a net deduction touching no wage, insured or tax base (register TW-WAGE-06).
	// NT$36,000, April 2026, declared grade 36,300 (民國115年 LI/NHI tables):
	//   LI 36,300 × 11.5% × 20% = 834.9 → 835 (勞保條例 §13, §15(1); 施行細則 §33 rounds to the 元)
	//   EI 36,300 × 1% × 20% = 72.6 → 73 (就業保險法 §40)
	//   NHI 36,300 × 5.17% × 30% = 563.013 → 563 (健保法 §27(1); 施行細則 §52)
	//   INCOME_TAX nil (36,000 is below the 115年 table's first taxable row; 5% would be 1,800, ≤ 2,000 under 扣繳率標準 §13)
	// Whole net 36,000 − (835 + 73 + 563) = 34,529; garnished net 34,529 − 12,000 = 22,529.
	const run = (ordered: number) =>
		buildStatutory(
			{
				code: 'TW',
				period: '2026-04',
				riskClass: '1',
				people: [{ key: 'TW-GARNISH', wage: 36_000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				declareInsuredAmount(world, 'TW-GARNISH', 36_300);
				if (ordered === 0) return;
				const catalogue = world.adhoc_catalogue!.find(
					(row) => row.code === 'COURT_GARNISHMENT' && row.settings_id === TW_2026
				)!;
				world.adhoc_requests!.push({
					id: 'd4000000-0000-4000-8000-000000115001',
					employment_id: world.employments[0]!.id,
					catalogue_id: catalogue.id,
					amount: ordered,
					event_date: '2026-04-30',
					// The order's April instalment: pinned, as the 30th is past the 21st cutoff.
					pay_period: '2026-04',
					payslip_id: null,
					reason: '強制執行法 §115-1 扣押命令 / 移轉命令',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		).slips.get('TW-GARNISH')!;
	const whole = run(0);
	const garnished = run(12_000);
	assert.deepEqual(charge(whole, 'LI'), [36_300, 835, charge(whole, 'LI')[2]]);
	assert.deepEqual(charge(whole, 'EI'), [36_300, 73, charge(whole, 'EI')[2]]);
	assert.deepEqual(charge(whole, 'NHI'), [36_300, 563, charge(whole, 'NHI')[2]]);
	assert.equal(whole.gross, 36_000);
	assert.equal(whole.net, 34_529);
	assert.equal(garnished.gross, 36_000);
	assert.deepEqual(garnished.statutory, whole.statutory);
	assert.equal(garnished.net, 22_529);
});

test('Taiwan — 公傷病假 keeps the 原領工資 whole in a thirty- and a thirty-one-day month, and no insurer benefit is offset (勞基法 §59(2), 施行細則 §31)', () => {
	// 勞基法 §59(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=59): 勞工在醫療中不能
	// 工作時，雇主應按其原領工資數額予以補償. 施行細則 §31(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030002):
	// 其為計月者，以遭遇職業災害前最近一個月正常工作時間所得之工資除以三十所得之金額，為其一日之工資.
	// NT$36,000 a month (unchanged the month before): 原領工資 is 36,000 ÷ 30 = 1,200 a day. Ten weekdays of
	// 公傷病假 in April 2026 (thirty days, so the calendar-day proration also values a day at 1,200) owe
	// 10 × 1,200 = 12,000 for those days, and the twenty other days are paid as worked: 36,000 in all.
	// §59 但書 lets the employer offset (得予以抵充) what it has already paid for the same accident under
	// labour or occupational-accident insurance — permissive, so paying the whole wage with no offset is
	// lawful (owner rule 2026-09-28: the offset is recorded, never computed); no line takes it off.
	// March 2026 has thirty-one days: TW `work_rules.proration` is calendar days over a flat 30, so a
	// day is still 36,000 ÷ 30 = 1,200, and ten 公傷病假 weekdays owe 12,000 beside 36,000 − 12,000
	// worked — 36,000 again, never 12,000 + 21/31 × 36,000 (the ÷ 31 a calendar-month divisor would give).
	const injury = leaveCatalogue('TW').find(
		(row) => row.code === 'OCCUPATIONAL_INJURY_LEAVE' && row.settings_id === TW_2026
	)!;
	for (const [period, first] of [
		['2026-04', [6, 13]],
		['2026-03', [9, 16]]
	] as const) {
		const days = first.flatMap((monday) =>
			[0, 1, 2, 3, 4].map((offset) => `${period}-${String(monday + offset).padStart(2, '0')}`)
		);
		const { slips } = buildStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				people: [{ key: 'TW-INJURY', wage: 36_000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				world.leave_catalogue.push({ ...injury, approval_id: null } as never);
				const employment = world.employments.find((row) => row.employee_number === 'TW-INJURY')!;
				const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-0000000inj01',
					employment_id: employment.id,
					catalogue_id: injury.id,
					leave_code: injury.code,
					reference: 'INJ-1',
					from_date: days[0]!,
					to_date: days.at(-1)!,
					half_day_start: false,
					half_day_end: false,
					days: days.length,
					effective_on: days[0]!,
					reason: '職業災害',
					allocations: [],
					charges: days.map((date) => ({
						date,
						days: 1,
						catalogue_id: injury.id,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				} as never);
			}
		);
		const slip = slips.get('TW-INJURY')!;
		assert.equal(
			slip.adjustments.filter((row) => row.family === 'LEAVE' && row.amount !== 0).length,
			0,
			`no leave line takes the 原領工資 off in ${period}`
		);
		assert.equal(slip.gross, 36_000, period);
	}
});

test('Taiwan — a joiner on the 31st is owed that day: 1/30 of the month, now or as next-run arrears', () => {
	// 勞動基準法 §22(2): the day worked is paid in full. On the calendar-month cycle (cutoff 1) the
	// 31st is 45,000 × 1/30 = 1,500, net 1,500 − LI 35 − EI 3 − NHI 710 = 752. On a cutoff-21 cycle
	// the 31st falls after the window closed, so March pays nothing and April pays 45,000 + 1,500.
	const run = (period: string, hire: string, cutoff: number) =>
		buildStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				people: [{ key: 'J31', wage: 45_000, citizenship: 'CITIZEN', hire_date: hire }]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = cutoff;
			}
		).slips.get('J31')!;
	for (const [period, hire] of [
		['2026-03', '2026-03-31'],
		['2026-05', '2026-05-31']
	] as const) {
		const slip = run(period, hire, 1);
		assert.deepEqual(
			slip.proration.map((row) => [
				row.component_code,
				row.days,
				row.denominator,
				row.prorated_amount
			]),
			[['BASIC', 1, 30, 1500]],
			period
		);
		assert.equal(slip.gross, 1500, period);
		assert.equal(slip.net, 752, period);
		assert.equal(slip.unfunded_contributions, 0, period);
	}
	assert.equal(run('2026-03', '2026-03-31', 21).gross, 0);
	assert.equal(run('2026-04', '2026-03-31', 21).gross, 46_500);
});

test('Taiwan — §35: the break follows four continuous hours; four exactly owe none (勞基法 §35)', () => {
	// 勞基法 §35 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=35): 勞工繼續工作
	// 四小時，至少應有三十分鐘之休息。但實行輪班制或其工作有連續性或緊急性者，雇主得在工作時間內，另行調配其休息時間.
	// The rest comes after the four hours: a 09:00–13:00 run owes nothing; 09:00–13:30 owed 30 minutes
	// at 13:00 and took none (shortfall 30), outside working time; on the proviso's shift or continuous
	// work the same 30 minutes is rearranged inside working time.
	for (const version of settingsVersions('TW')) {
		const run = (end: string, facts: Record<string, boolean> = {}) =>
			restBreakAssessment({
				intervals: [
					{ start: '2026-06-15T09:00:00.000+08:00', end: `2026-06-15T${end}:00.000+08:00` }
				],
				breakMinutes: 0,
				breaks: version.work_rules.breaks,
				person: { company: { facts } } as never
			});
		assert.equal(run('13:00').rule, null, version.id);
		const over = run('13:30');
		assert.equal(over.requiredMinutes, 30, version.id);
		assert.equal(over.shortfallMinutes, 30, version.id);
		assert.equal(over.rule?.counts_as_worked_time, false, version.id);
		assert.equal(
			run('13:30', { shift_or_continuous_work: true }).rule?.counts_as_worked_time,
			true
		);
		assert.equal(run('13:00', { shift_or_continuous_work: true }).rule, null, version.id);
	}
});

/** One MANUAL or SEPARATION §59 request in the run's period. */
function injuryRequest(
	world: PayrollWorld,
	code: string,
	index: number,
	event: string,
	period: string,
	amount = 0
) {
	const employment = world.employments[index]!;
	const catalogue = world.adhoc_catalogue!.find(
		(row) => row.code === code && row.settings_id === TW_2026
	)!;
	world.adhoc_requests!.push({
		id: `d5900000-0000-4000-8000-0000000${String(index).padStart(2, '0')}${code.length.toString().padStart(3, '0')}`,
		employment_id: employment.id,
		catalogue_id: catalogue.id,
		amount,
		event_date: event,
		pay_period: period,
		payslip_id: null,
		reason: `勞基法 §59: ${code}`,
		evidence_file: 'designated-hospital-assessment.pdf',
		as_adjustment_entry: false,
		approval_id: null
	});
}

// Six months before an April 2026 accident: Oct–Dec 2025 at 30,000, Jan–Mar 2026 at 36,000 — 198,000
// over 31 + 30 + 31 + 31 + 28 + 31 = 182 days. 勞基法 §2(4) 平均工資 a day = 198,000 ÷ 182; a month of
// it (勞動部 台(83)勞動二字第25564號) is 198,000 ÷ 6 = 33,000.
const INJURY_WAGES = {
	...monthsAt('2025-10', '2025-12', 30_000),
	...monthsAt('2026-01', '2026-03', 36_000)
};

test('Taiwan — §59(1) medical costs are paid as entered and touch no wage, insured or tax base (勞基法 §59(1), 施行細則 §10(7), 所得稅法 §4(1)(3))', () => {
	// 勞基法 §59(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=59): 雇主應補償其
	// 必需之醫療費用. 施行細則 §10(7) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=10):
	// 職業災害補償費 is not 工資; 所得稅法 §4(1)(3) exempts 傷害之損害賠償金. NT$36,000 a month, NT$12,345 of
	// receipts: gross and net both rise by exactly 12,345, every statutory row as without it.
	const run = (amount: number) =>
		buildStatutory(
			{
				code: 'TW',
				period: '2026-04',
				riskClass: '1',
				people: [{ key: 'TW-MED', wage: 36_000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				if (amount > 0)
					injuryRequest(world, 'OCC_INJURY_MEDICAL', 0, '2026-04-06', '2026-04', amount);
			}
		).slips.get('TW-MED')!;
	const whole = run(0);
	const paid = run(12_345);
	assert.equal(
		paid.adjustments.find((row) => row.component_code === 'OCC_INJURY_MEDICAL')?.amount,
		12_345
	);
	assert.equal(paid.gross, whole.gross + 12_345);
	assert.deepEqual(paid.statutory, whole.statutory);
	assert.equal(paid.net, whole.net + 12_345);
});

test('Taiwan — §59(2) proviso: forty months of 平均工資 at once; §59(3) disability at the occupational grade days (勞基法 §59, 勞保條例 §54, 失能給付標準 §5)', () => {
	// §59(2) 但書: 雇主得一次給付四十個月之平均工資 — 40 × 33,000 = 1,320,000.
	// §59(3): 按其平均工資及其失能程度…依勞工保險條例有關之規定. 勞保條例 §54(1)
	// (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050001&flno=54): 增給百分之五十; 勞工保險失能
	// 給付標準 §5 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050023): grade 7 = 440 days, × 1.5 =
	// 660; grade 15 = 30 days × 1.5 = 45. 660 × 198,000 ÷ 182 = 718,021.98 → 718,022; 45 × 198,000 ÷ 182 =
	// 48,956.04 → 48,956. Each not 工資 and tax-exempt: statutory rows as without it.
	const people = ['TW-LUMP', 'TW-G07', 'TW-G15', 'TW-NONE'];
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-04',
			riskClass: '1',
			people: people.map((key) => ({
				key,
				wage: 36_000,
				citizenship: 'CITIZEN',
				hire_date: '2020-01-01'
			}))
		},
		(world) => {
			for (const key of people) priorWages(world, key, INJURY_WAGES);
			injuryRequest(world, 'OCC_INJURY_LUMP_SUM', 0, '2026-04-06', '2026-04');
			injuryRequest(world, 'OCC_DISABILITY_G07', 1, '2026-04-06', '2026-04');
			injuryRequest(world, 'OCC_DISABILITY_G15', 2, '2026-04-06', '2026-04');
		}
	);
	const line = (key: string, code: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === code)?.amount;
	assert.equal(line('TW-LUMP', 'OCC_INJURY_LUMP_SUM'), 1_320_000);
	assert.equal(line('TW-G07', 'OCC_DISABILITY_G07'), 718_022);
	assert.equal(line('TW-G15', 'OCC_DISABILITY_G15'), 48_956);
	for (const key of ['TW-LUMP', 'TW-G07', 'TW-G15'])
		assert.deepEqual(slips.get(key)!.statutory, slips.get('TW-NONE')!.statutory, key);
	// Every version carries the fifteen grades at 1.5 × the 失能給付標準 §5 days.
	const days = [1800, 1500, 1260, 1110, 960, 810, 660, 540, 420, 330, 240, 150, 90, 60, 45];
	for (const version of settingsVersions('TW')) {
		const rows = readCatalogue().filter((row) => row.settings_id === version.id);
		days.forEach((day, index) => {
			const row = rows.find(
				(r) => r.code === `OCC_DISABILITY_G${String(index + 1).padStart(2, '0')}`
			)!;
			assert.ok(
				row.bands[0]!.amount.startsWith(`round(${day}.0 * `),
				`${version.id} G${index + 1}`
			);
		});
	}
});

function readCatalogue(): { settings_id: string; code: string; bands: { amount: string }[] }[] {
	return JSON.parse(
		readFileSync(new URL('../seed/jurisdiction/TW/adhoc_catalogue.json', import.meta.url), 'utf8')
	);
}

test('Taiwan — §59(4) an occupational death: five months’ funeral costs and forty months’ death compensation; an ordinary death neither', () => {
	// 勞基法 §59(4): 雇主除給與五個月平均工資之喪葬費外，並應一次給與其遺屬四十個月平均工資之死亡補償.
	// Death 15 April 2026 after the INJURY_WAGES months: 5 × 33,000 = 165,000; 40 × 33,000 = 1,320,000.
	// A stated 平均工資 of NT$1,000 a day: 5 × 30,000 = 150,000 and 40 × 30,000 = 1,200,000. A death
	// not from an occupational accident is owed neither.
	const people = [
		{ key: 'TW-DEATH', facts: { occupational_death: true } },
		{ key: 'TW-DEATH-STATED', facts: { occupational_death: true, average_daily_wage: 1_000 } },
		{ key: 'TW-DEATH-ORDINARY', facts: {} }
	];
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-04',
			riskClass: '1',
			people: people.map((person) => ({
				key: person.key,
				wage: 36_000,
				citizenship: 'CITIZEN',
				hire_date: '2020-01-01',
				exit_date: '2026-04-15',
				exit_ground: 'DEATH'
			}))
		},
		(world) => {
			for (const [index, person] of people.entries()) {
				const employment = world.employments[index]! as { exit_facts?: unknown };
				employment.exit_facts = {
					...((employment.exit_facts as object | undefined) ?? {}),
					...person.facts
				};
				priorWages(world, person.key, INJURY_WAGES);
				injuryRequest(world, 'OCC_DEATH_FUNERAL', index, '2026-04-15', '2026-04');
				injuryRequest(world, 'OCC_DEATH_COMPENSATION', index, '2026-04-15', '2026-04');
			}
		}
	);
	const line = (key: string, code: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === code)?.amount ?? 0;
	assert.equal(line('TW-DEATH', 'OCC_DEATH_FUNERAL'), 165_000);
	assert.equal(line('TW-DEATH', 'OCC_DEATH_COMPENSATION'), 1_320_000);
	assert.equal(line('TW-DEATH-STATED', 'OCC_DEATH_FUNERAL'), 150_000);
	assert.equal(line('TW-DEATH-STATED', 'OCC_DEATH_COMPENSATION'), 1_200_000);
	assert.equal(line('TW-DEATH-ORDINARY', 'OCC_DEATH_FUNERAL'), 0);
	assert.equal(line('TW-DEATH-ORDINARY', 'OCC_DEATH_COMPENSATION'), 0);
});

test('Taiwan — §16(2) paid job-search leave follows the notice ground: §11, the §13 proviso and §20, not §12, §14 or §15', () => {
	// 勞基法 §16(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=16): 勞工於接到
	// 前項預告後，為另謀工作得於工作時間請假外出…請假期間之工資照給. §16(1) is the notice of a §11 or §13-proviso
	// termination; §20 applies §16. A redundancy with no ground stated is read as §11 (as SEVERANCE_PAY
	// reads it); a §14 resignation, a §12 dismissal (OTHER) or an unexited worker gets none.
	const person = (exit_ground: string, facts: Record<string, string> = {}, exit = '2026-06-30') =>
		personContext({
			employee: null,
			employment: {
				service_start: '2020-01-01',
				exit_date: exit,
				exit_ground,
				exit_facts: { notice_days_given: 30, ...facts }
			},
			terms: null,
			company: { facts: {} },
			asOf: '2026-06-15'
		} as never);
	for (const row of leaveCatalogue('TW').filter((r) => r.code === 'JOB_SEARCH_LEAVE')) {
		const cases: [string, Record<string, string>, boolean, string?][] = [
			['REDUNDANCY', {}, true],
			['RETRENCHMENT', {}, true],
			['DISMISSAL', { lsa_termination_ground: 'ARTICLE_11' }, true],
			['UNILATERAL', { lsa_termination_ground: 'ARTICLE_13_PROVISO' }, true],
			['MUTUAL', { lsa_termination_ground: 'ARTICLE_20' }, true],
			['RESIGNATION', { lsa_termination_ground: 'ARTICLE_14' }, false],
			['DISMISSAL', { lsa_termination_ground: 'OTHER' }, false],
			['RESIGNATION', {}, false],
			['REDUNDANCY', {}, false, '']
		];
		for (const [reason, facts, expected, exit] of cases)
			assert.equal(
				isEligible(row.eligibility, person(reason, facts, exit)),
				expected,
				`${row.settings_id} ${reason} ${JSON.stringify(facts)}`
			);
		assert.equal(row.is_npl, false, 'paid: 工資照給');
	}
});

test('Taiwan — §16(2) job-search leave is capped at two working days a week and only inside the notice period', () => {
	// 勞基法 §16(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=16): 勞工於接到
	// 前項預告後，為另謀工作得於工作時間請假外出。其請假時數，每星期不得超過二日之工作時間. Exit Tue 30 Jun 2026
	// with notice_days_given 30 (the day after notice to the last day): notice on Sun 31 May, the window
	// Mon 1 Jun – Tue 30 Jun. The week is Monday to Sunday (register TW-LEAVE-08). Every day is rostered.
	for (const row of leaveCatalogue('TW').filter((r) => r.code === 'JOB_SEARCH_LEAVE'))
		assert.equal(row.entitlement.weekly_days, 2, `${row.settings_id} weekly_days`);
	const context = leaveContext();
	context.employments[0] = {
		...context.employments[0]!,
		effective_range: { start: '2020-01-01', end: '2026-06-30' },
		exit_ground: 'REDUNDANCY',
		exit_facts: { lsa_termination_ground: 'ARTICLE_11', notice_days_given: 30 }
	};
	const seeded = leaveCatalogue('TW').find((r) => r.code === 'JOB_SEARCH_LEAVE')!;
	context.catalogues.push({ ...seeded, id: leaveId(90), settings_id: leaveId(6) } as never);
	const take = (from: string, to: string, n: number) =>
		planLeaveActivity(
			context,
			{ ...leaveSubmission(leaveTimeOff(from, to), `J${n}`), catalogue_id: leaveId(90) },
			leaveId(n)
		);
	const refusalOf = (run: () => unknown): string => {
		try {
			run();
			return '';
		} catch (error) {
			return refusalMessage(error);
		}
	};
	// Mon 1 – Tue 2 Jun: two days, paid (工資照給).
	const first = take('2026-06-01', '2026-06-02', 50);
	assert.equal(first.days, 2);
	context.entries.push({ ...first, id: leaveId(50), approval_id: null });
	// A third day in the same week is over 每星期二日.
	assert.match(
		refusalOf(() => take('2026-06-03', '2026-06-03', 51)),
		/allows 2 days a week; 2 are already taken in the week of 2026-06-01/
	);
	// Mon 8 Jun is the next week.
	assert.equal(take('2026-06-08', '2026-06-08', 52).days, 1);
	// Three days asked in one fresh week: 3 > 2.
	assert.match(
		refusalOf(() => take('2026-06-15', '2026-06-17', 53)),
		/allows 2 days a week; 0 are already taken in the week of 2026-06-15/
	);
	// The exit day itself: 0 days to exit < 30.
	assert.equal(take('2026-06-30', '2026-06-30', 54).days, 1);
	// Fri 29 May (32 days to exit) and Sun 31 May, the notice day (30, not < 30), are before the window.
	assert.match(
		refusalOf(() => take('2026-05-29', '2026-05-29', 55)),
		/INELIGIBLE/
	);
	assert.match(
		refusalOf(() => take('2026-05-31', '2026-05-31', 56)),
		/INELIGIBLE/
	);
	// No notice recorded: no §16(2) leave. A notice actually given for 20 or 30 days begins on the
	// following day. A recorded zero (pay in lieu, §16(3)) gives no leave.
	const person = (start: string, asOf: string, facts: Record<string, unknown> = {}) =>
		personContext({
			employee: null,
			employment: {
				service_start: start,
				exit_date: '2026-06-30',
				exit_ground: 'REDUNDANCY',
				exit_facts: facts
			},
			terms: null,
			company: { facts: {} },
			asOf
		} as never);
	const cases: [string, string, Record<string, unknown>, boolean][] = [
		['2024-06-01', '2026-06-11', {}, false],
		['2024-06-01', '2026-06-10', { notice_days_given: 20 }, false],
		['2024-06-01', '2026-06-11', { notice_days_given: 20 }, true],
		['2020-01-01', '2026-06-01', {}, false],
		['2020-01-01', '2026-05-31', { notice_days_given: 30 }, false],
		['2020-01-01', '2026-06-01', { notice_days_given: 30 }, true],
		['2020-01-01', '2026-06-30', { notice_days_given: 0 }, false],
		['2020-01-01', '2026-06-25', { notice_days_given: 6 }, true],
		['2020-01-01', '2026-06-24', { notice_days_given: 6 }, false]
	];
	for (const [start, asOf, facts, expected] of cases)
		assert.equal(
			isEligible(seeded.eligibility, person(start, asOf, facts)),
			expected,
			`${start} ${asOf} ${JSON.stringify(facts)}`
		);
	// The same employment read with the notice struck out of its record. It is a context of its own:
	// the person cache is keyed on the context, and this one's employment was amended in place.
	const unnoticed = leaveContext();
	unnoticed.employments[0] = {
		...unnoticed.employments[0]!,
		effective_range: { start: '2020-01-01', end: '2026-06-30' },
		exit_ground: 'REDUNDANCY',
		exit_facts: { lsa_termination_ground: 'ARTICLE_11' }
	};
	unnoticed.catalogues.push({ ...seeded, id: leaveId(90), settings_id: leaveId(6) } as never);
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				unnoticed,
				{
					...leaveSubmission(leaveTimeOff('2026-06-08', '2026-06-08'), 'J57'),
					catalogue_id: leaveId(90)
				},
				leaveId(57)
			)
		),
		/INELIGIBLE/
	);
});
