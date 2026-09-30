// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The membership matrix of every lineage: which schemes each allowance and ad hoc class counts
 * toward, and which part of a split base. The matrix is the law (cited beside each row); the bank is what a
 * transcription says. A row moving here without a statute moving is a bank defect.
 *
 * Every version of a lineage carries the same matrix — a class's membership is the statute's
 * definition of wages, which none of the sealed dates changed — and the lineage's README prints
 * this table under "Applied 2026-09-20".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	LINEAGES,
	adhocCatalogue,
	allowanceCatalogue,
	assessStatutoryUnvalidated,
	contributionSchemes,
	expectStatutory,
	settingsIdOn,
	settingsVersions
} from './fixtures/statutory-world.ts';

const MY_WAGES = ['EIS', 'HRDF', 'SKBBK', 'SOCSO'];
const MY_ADDITIONAL_EPF = ['EPF.ADDITIONAL', 'EPF_NON_CITIZEN.ADDITIONAL', 'EPF_PR.ADDITIONAL'];
const PH_WAGES = ['HDMF', 'SSS', 'SSS_EC', 'SSS_MPF'];
const ID_BPJS = ['JHT', 'JKK', 'JKM', 'JKP', 'JP', 'KESEHATAN'];
const RESERVED_WAGE_MARKS = new Set(['WAGES', 'FIRST_SCHEDULE_WAGES']);

const MATRIX: Record<string, Record<string, readonly string[]>> = {
	// CPF Act s.2: every allowance is wages; a bonus is Additional Wages. SHG funds and SDL read total wages.
	// EA s.11(1) salary in lieu of notice: not CPF wages (CPF Board), so outside the SHG funds; SDL Act s.2 wages.
	SG: {
		DAMAGE_RECOVERY: [],
		APPROVED_DAMAGE_RECOVERY: [],
		ACCOMMODATION_RECOVERY: [],
		AMENITIES_RECOVERY: [],
		COOPERATIVE_DUES: [],
		bonus: ['CDAC', 'CPF.ADDITIONAL', 'ECF', 'MBMF', 'SDL', 'SINDA'],
		SALARY_IN_LIEU_OF_NOTICE: ['SDL'],
		// Retrenchment benefit: CPF Board, not wages for CPF; SHG funds follow CPF; Muis Table 2; SDL Act
		// s.2 wages (Owner rule 2026-09-28, register SG-EA24-R02).
		RETRENCHMENT_BENEFIT: ['SDL']
	},
	// EPF Act s.2 (wages, no retirement/termination benefit), SOCSO/EIS s.2 wages, PSMB Act wages,
	// ITA 1967 s.13(1)(a) with PCB's additional-remuneration method for one-off pay.
	// LHDN 2026 D(b), E(13): normal/additional EPF classification controls tax-relief projection.
	MY: {
		ADJ: [...MY_WAGES.filter((code) => code !== 'HRDF'), ...MY_ADDITIONAL_EPF, 'PCB.ADDITIONAL'],
		BACKPAY_ADD_WAGES: ['EIS', 'PCB.ADDITIONAL', 'SKBBK', 'SOCSO'],
		// Annual bonus: EPF Act 452 s.2 "wages" includes "any bonus" (AGC text as at 1 Jul 2022); ITA
		// additional remuneration. Act 4 s.2(24)(e) and Act 800 s.2 "wages" (e) exclude "annual bonus"
		// (so SOCSO, EIS and SKBBK do not read it); Act 612 s.2 "wages" (e) excludes "any bonus".
		BONUS: [...MY_ADDITIONAL_EPF, 'PCB.ADDITIONAL'],
		BPAYBS: [...MY_WAGES, ...MY_ADDITIONAL_EPF, 'PCB.ADDITIONAL'],
		// EPF s.2 "wages" (c) excludes any gratuity; Act 4 s.2(24)(d) and Act 800 s.2 (d) only one on
		// discharge or retirement; Act 612 s.2 wages exclude it; ITA Sch.6 para 25C exempts RM2,000 of it.
		LONG_SERVICE_AWARD: ['EIS', 'PCB.ADDITIONAL', 'SKBBK', 'SOCSO'],
		NOTICE_IN_LIEU: ['PCB.ADDITIONAL'],
		NOTICE_INDEMNITY: [],
		ONCALL: [...MY_WAGES, ...MY_ADDITIONAL_EPF, 'PCB.ADDITIONAL', 'FIRST_SCHEDULE_WAGES'],
		SUA: [
			...MY_WAGES,
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'PCB.ORDINARY',
			'FIRST_SCHEDULE_WAGES'
		],
		TERMINATION_BENEFIT: [],
		// ITA Sch.6 para 25C past-achievement/excellence/innovation/productivity award: EPF s.2 "any
		// bonus", KWSP FAQ Q8 "Incentives"; not an annual bonus under Act 4 s.2(24)(e)/Act 800 s.2 (e),
		// so SOCSO/EIS/SKBBK wages; Act 612 s.2 (e) excludes any bonus. MTD spec 2026 E(9) v.
		EXCELLENCE_AWARD: [
			...MY_WAGES.filter((code) => code !== 'HRDF'),
			...MY_ADDITIONAL_EPF,
			'PCB.ADDITIONAL'
		],
		// Official-duty travel: KWSP FAQ Q11 non-wages, Act 4 s.2(24)(b), Act 800 s.2 (b), Act 612 s.2
		// (b), EA 1955 s.2 (c) all exclude a travelling allowance; taxable above RM6,000 (E(9) i).
		TRAVEL_OFFICIAL: ['PCB.ORDINARY'],
		TASK_MONTHLY_WAGE: [
			...MY_WAGES.filter((code) => code !== 'HRDF'),
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'PCB.ORDINARY'
		],
		TRIP_MONTHLY_WAGE: [
			...MY_WAGES.filter((code) => code !== 'HRDF'),
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'PCB.ORDINARY'
		],
		COMMISSION_MONTHLY: [
			...MY_WAGES.filter((code) => code !== 'HRDF'),
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'PCB.ORDINARY'
		],
		COMMISSION_IRREGULAR: [
			...MY_WAGES.filter((code) => code !== 'HRDF'),
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'PCB.ADDITIONAL'
		],
		RESULTS_ZERO_MONTH: [],
		// BIK/VOLA: non-cash, so no contribution wage (EPF s.2 "remuneration in money", Act 4 s.2(24),
		// Act 800 s.2 "payable in money", Act 612 and EA s.2 "in cash"); Y1 for MTD (spec 2026 E(12)).
		BIK_VOLA: ['PCB.ORDINARY'],
		// Cash allowances: EPF s.2 wages (FAQ Q8 "allowance"), Act 4/Act 800 wages (owner rule
		// 2026-09-28: not "special expenses"), Act 612 fixed cash allowance, EA s.2 wages. Child care is
		// taxable above RM3,000 (E(9) ii); meal and parking are fully exempt (E(9) vi, vii).
		CHILDCARE_ALLOWANCE: [
			...MY_WAGES,
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'PCB.ORDINARY',
			'FIRST_SCHEDULE_WAGES'
		],
		MEAL_ALLOWANCE: [
			...MY_WAGES,
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'FIRST_SCHEDULE_WAGES'
		],
		PARKING_ALLOWANCE: [
			...MY_WAGES,
			'EPF.ORDINARY',
			'EPF_NON_CITIZEN.ORDINARY',
			'EPF_PR.ORDINARY',
			'FIRST_SCHEDULE_WAGES'
		]
	},
	// RA 11199 s.8(f) compensation; NIRC s.32(B)(7)(e) 13th month and other benefits (de minimis meal).
	// RR 2-98 s.2.78.1(A)(3) as amended (RR 11-2018, RR 4-2025, RR 29-2025): each de minimis class
	// is its own WTAX part, capped by the formula (the OT meal by its own band).
	// HDMF Circular 460 (15 Jan 2024, from Feb 2024): Fund Salary is basic salary plus other allowances.
	PH: {
		ACHIEVEMENT_AWARD: ['WTAX.AWARD'],
		CBA_PRODUCTIVITY: ['WTAX.CBA'],
		CHRISTMAS_GIFT: ['WTAX.GIFT'],
		// SSS IRR Rule 12 s.6(ii), (xii): commissions are compensation; Circular 460 p.2: fund salary
		// includes pay on a commission basis. Not PhilHealth's basic salary nor the 13th-month basic.
		COMMISSION: [...PH_WAGES, 'WTAX.ORDINARY'],
		DEPENDANT_MEDICAL_ALLOWANCE: [...PH_WAGES, 'WTAX.DEP_MEDICAL'],
		LAUNDRY_ALLOWANCE: [...PH_WAGES, 'WTAX.LAUNDRY'],
		MEDICAL_ASSISTANCE: ['WTAX.MEDICAL'],
		OT_MEAL_ALLOWANCE: [...PH_WAGES, 'WTAX.OT_MEAL'],
		UNIFORM_ALLOWANCE: ['WTAX.UNIFORM'],
		BACKPAY_ADD_WAGES: [...PH_WAGES, 'WTAX.ORDINARY'],
		BACKPAY_BASIC: [...PH_WAGES, 'WTAX.ORDINARY'],
		BACKPAY_DUTY_ALLOWANCE: [...PH_WAGES, 'WTAX.ORDINARY'],
		RETIREMENT_PAY: [],
		SEPARATION_PAY: [],
		// RA 10361 s.32 indemnity: separation for a cause beyond the employee's control, NIRC s.32(B)(6)(b).
		KASAMBAHAY_INDEMNITY: [],
		KASAMBAHAY_FORFEITURE: [],
		STATUTORY_ADJUSTMENT: [],
		THIRTEENTH_MONTH_PAY: ['WTAX.SPECIAL'],
		allowance: [...PH_WAGES, 'WTAX.ORDINARY'],
		// SSS IRR (RA 11199) Rule 12 s.6(iii): compensation includes "Bonuses (except Christmas bonus)".
		// Circular 460 p.2: fund salary is remuneration "however designated" for services rendered (PH-HD02).
		bonus: [...PH_WAGES, 'WTAX.SPECIAL'],
		communication: [...PH_WAGES, 'WTAX.ORDINARY'],
		corporate_duty_allowance: [...PH_WAGES, 'WTAX.ORDINARY'],
		duty_allowance: [...PH_WAGES, 'WTAX.ORDINARY'],
		leader: [...PH_WAGES, 'WTAX.ORDINARY'],
		meal: [...PH_WAGES, 'WTAX.RICE'],
		position: [...PH_WAGES, 'WTAX.ORDINARY'],
		// RA 9262 s.8(g): the court's withholding from salary; a net deduction outside every base (ML-2).
		PROTECTION_ORDER_SUPPORT: [],
		transport: [...PH_WAGES, 'WTAX.ORDINARY']
	},
	// Circular 111/2013 art.2(2): allowances are salary income except severance and job-loss allowances.
	VN: {
		// Labour Code art.104 bonus: salary income (Circular 111/2013 art.2(2)(e); Decree 253/2026 art.8(2)(i)),
		// outside the insured salary as a performance-varying supplement (Decree 158/2025 art.7(1)(c)).
		BONUS: ['PIT'],
		INSURANCE_EQUIVALENT: ['PIT'],
		// Labour Code 45/2019 art.97(4); owner rule 2026-09-28: taxable, not insured (Decree 158/2025 art.7(1)).
		LATE_WAGE_COMPENSATION: ['PIT'],
		// Decree 253/2026 art.8(2)(g)-(h): the meal above its cap, the rent up to 15% of income.
		MEAL_ALLOWANCE: ['PIT.MEAL'],
		HOUSING: ['PIT.HOUSING'],
		JOB_LOSS_ALLOWANCE: [],
		SEVERANCE_ALLOWANCE: [],
		// Labour Code art.102: a deduction for damaged property comes out of net pay, outside every base.
		PROPERTY_DAMAGE_COMPENSATION: []
	},
	// 所得稅法 §14(1)(3): a bonus is 薪資所得; 勞退條例 §14 and NHI supplement read it; severance is outside.
	// 勞基法 §2(3) with 施行細則 §10: a monthly 伙食津貼 is 工資 (no §10 exclusion); 查核準則 §88(2)(1)
	// keeps NT$3,000 of it out of 薪資所得, which the tax and NHI-supplement bases subtract by code.
	// 勞基法 §55 retirement pay is 退休金, 退職所得 under 所得稅法 §14(1)(9): withheld through
	// SEVERANCE_TAX by code, outside every wage base like severance.
	// 勞基法 §59 但書 with 施行細則 §10(7): an elected insurer-benefit offset reduces 職業災害補償費, not
	// 工資 — a net deduction outside every base (Owner rule 2026-09-28, register TW-EXIT-05).
	TW: {
		MEAL_ALLOWANCE: [
			'EI',
			'INCOME_TAX',
			'INCOME_TAX_NON_RESIDENT',
			'LABOR_PENSION',
			'LABOR_PENSION_RESERVE',
			'LI',
			'NHI',
			'NHI_PART_TIME',
			'NHI_SUPPLEMENT_EMPLOYER',
			'OCC_INJURY'
		],
		OCC_INJURY_OFFSET: [],
		// 勞基法 §2(3): a 全勤獎金 paid for work is 工資, in every wage base like the monthly meal allowance.
		FULL_ATTENDANCE_BONUS: [
			'EI',
			'INCOME_TAX',
			'INCOME_TAX_NON_RESIDENT',
			'LABOR_PENSION',
			'LABOR_PENSION_RESERVE',
			'LI',
			'NHI',
			'NHI_PART_TIME',
			'NHI_SUPPLEMENT_EMPLOYER',
			'OCC_INJURY'
		],
		// 強制執行法 §115-1: the attached wage stays the worker's; a net deduction outside every base (TW-WAGE-06).
		COURT_GARNISHMENT: [],
		// 勞基法 §59 職業災害補償費: not 工資 (施行細則 §10(7)), exempt from income tax (所得稅法 §4(1)(3)-(4)).
		OCC_INJURY_MEDICAL: [],
		OCC_INJURY_LUMP_SUM: [],
		OCC_DISABILITY_G01: [],
		OCC_DISABILITY_G02: [],
		OCC_DISABILITY_G03: [],
		OCC_DISABILITY_G04: [],
		OCC_DISABILITY_G05: [],
		OCC_DISABILITY_G06: [],
		OCC_DISABILITY_G07: [],
		OCC_DISABILITY_G08: [],
		OCC_DISABILITY_G09: [],
		OCC_DISABILITY_G10: [],
		OCC_DISABILITY_G11: [],
		OCC_DISABILITY_G12: [],
		OCC_DISABILITY_G13: [],
		OCC_DISABILITY_G14: [],
		OCC_DISABILITY_G15: [],
		OCC_DEATH_FUNERAL: [],
		OCC_DEATH_COMPENSATION: [],
		RETIREMENT_PAY: [],
		SEVERANCE_PAY: [],
		bonus: [
			'INCOME_TAX_BONUS',
			'INCOME_TAX_NON_RESIDENT',
			'LABOR_PENSION_RESERVE',
			'NHI_SUPPLEMENT',
			'NHI_SUPPLEMENT_EMPLOYER'
		]
	},
	// PP 44/45/46 2015, Perpres 82/2018: upah pokok + tunjangan tetap; PMK 168/2023 regular vs irregular income.
	ID: {
		BACK_PAY_SALARY: ['PPH21.ADDITIONAL', 'PPH21_DAILY', 'PPH26'],
		BONUS_THR: ['PPH21.ADDITIONAL', 'PPH21_DAILY', 'PPH26'],
		CAR_ALLOWANCE: [...ID_BPJS, 'PPH21.ORDINARY', 'PPH21_DAILY', 'PPH26'],
		CLAWBACK_OVERTIME: ['PPH21.ADDITIONAL', 'PPH21_DAILY', 'PPH26'],
		COMPENSATION: [],
		DEDUCTION: [],
		HOUSE_ALLOWANCE: [...ID_BPJS, 'PPH21.ORDINARY', 'PPH21_DAILY', 'PPH26'],
		KESEHATAN_TERMINATION_MONTH_EMPLOYEE: [],
		KESEHATAN_TERMINATION_MONTH_EMPLOYER: ['PPH21.ADDITIONAL', 'PPH21_DAILY', 'PPH26'],
		MEDICAL_ALLOWANCE: ['PPH21.ADDITIONAL', 'PPH21_DAILY', 'PPH26'],
		// PP 68/2009 art.1 angka 3: its final rates reach a resident only (PPH21_FINAL_SEVERANCE reads
		// pesangon/UPMK by code); a non-resident's is PPh 26 at 20% of gross (UU PPh art.26(1)).
		PESANGON: ['PPH26'],
		PENSION_OFFSET: [],
		// PP 68/2009 art.1 angka 4: paid when the PKWT ends (PP 35/2021 art.15(2)), so it is uang
		// pesangon at the final rates (PPH21_FINAL_SEVERANCE reads it by code); only PPh 26 by membership.
		PKWT_COMPENSATION: ['PPH26'],
		RETROACTIVE_PAY: ['PPH21.ADDITIONAL', 'PPH21_DAILY', 'PPH26'],
		SPECIAL_ALLOWANCE: [...ID_BPJS, 'PPH21.ORDINARY', 'PPH21_DAILY', 'PPH26'],
		THR: ['PPH21.ADDITIONAL', 'PPH21_DAILY', 'PPH26'],
		// PP 68/2009 art.1 angka 4: uang pesangon is any payment, under whatever name, made in connection
		// with the end of service, so uang pisah carries the final severance rates like pesangon;
		// only a non-resident's enters PPh 26.
		UANG_PISAH: ['PPH26'],
		UPMK: ['PPH26']
	},
	// Revenue Code s.40(1) with Order P.96/2543 cl.1(5): a bonus is employment income withheld under
	// s.50(1). Social Security Act s.5 wages exclude a bonus; LPA s.118 severance is outside both.
	// LPA s.17/1 pay in lieu of notice is a one-time payment on leaving (DG Notification No.45
	// cl.1(ง)), withheld with severance under s.50(1) para.3, and not pay for work (SSA s.5).
	// LPA s.76(2)–(4) and last para.; Student Loan Fund Act B.E.2560 s.51: deductions from net pay,
	// outside every base.
	TH: {
		BONUS: ['PIT'],
		NOTICE_IN_LIEU: [],
		SEVERANCE_PAY: [],
		SLF_DEDUCTION: [],
		UNION_DUES: [],
		COOPERATIVE_DEDUCTION: [],
		DAMAGE_COMPENSATION: [],
		CONSENTED_DEDUCTION: []
	},
	// 个人所得税法 art.2 and 实施条例 art.6: a bonus is 工资薪金 in the cumulative withholding; the annual
	// one-time bonus may be taxed apart (财政部 税务总局公告2023年第30号, to 31 Dec 2027). The SI and
	// housing-fund base is the prior year's average wage, so neither enters a current month.
	// Both are 奖金, so both are WAGES: 劳动合同法实施条例 art.27 puts bonuses in the art.47 wage
	// (https://xzfg.moj.gov.cn/front/law/detail?LawID=284), and 企业职工带薪年休假实施办法 art.11
	// takes only overtime out of the leave day wage (https://rsj.sh.gov.cn/trlzyhshbzbgz_17256/20200617/t0035_1388390.html).
	// 财税〔2018〕164号 item 5(1) (from 1 Jan 2019): LCL art.46-47 economic compensation is exempt to
	// three times the local prior-year average wage and the excess is not added to comprehensive
	// income, taxed alone (http://szs.mof.gov.cn/zhengcefabu/201812/t20181227_3110164.htm).
	'CN-shanghai': {
		ANNUAL_BONUS_SEPARATE: ['IIT_BONUS', 'WAGES'],
		BONUS: ['IIT', 'WAGES'],
		// The allowance offset takes a fund benefit back off the wage: it leaves the IIT base (财税〔2008〕8号
		// exempts the allowance) and, being no wage, the art.47 average (Social Insurance Law art.56).
		MATERNITY_ALLOWANCE_OFFSET: ['IIT'],
		// 财税〔2008〕8号: an employer-paid maternity benefit is exempt and no wage.
		MATERNITY_BENEFIT_EMPLOYER: [],
		// LCL art.82 double wage: 工资薪金 (IIT 实施条例 art.6(1)); not WAGES (Owner rule 2026-09-28).
		NO_WRITTEN_CONTRACT_WAGE: ['IIT'],
		// LCL art.82 para.2 and art.83: the same sanction defaults (Owner rule 2026-09-28).
		OPEN_ENDED_CONTRACT_WAGE: ['IIT'],
		PROBATION_EXCESS_DAMAGES: ['IIT'],
		// LCL art.20 / Regulation art.15: probation wage arrears are wages (Regulation art.27), as BONUS.
		PROBATION_WAGE_SHORTFALL: ['IIT', 'WAGES'],
		// 财税〔2018〕164号 item 5(2): taxed alone, spread over the years to statutory retirement age.
		EARLY_RETIREMENT_SUBSIDY: ['IIT_EARLY_RETIREMENT'],
		INTERNAL_RETIREMENT_SUBSIDY: ['IIT_INTERNAL_RETIREMENT'],
		SEVERANCE_PAY: ['IIT_SEVERANCE'],
		// 沪人社规〔2019〕19号 items 1–3: in 工资总额, so wage income under IIT; a contract line, so in WAGES
		// through the contract, not by membership (register CN-SH19).
		HEAT_ALLOWANCE: ['IIT', 'IIT_INTERNAL_RETIREMENT'],
		// 国税发〔1994〕89号 item 2(1), (3), (4): not of wage nature, not taxed; outside WAGES (register CN-N55).
		ONE_CHILD_SUBSIDY: [],
		CHILDCARE_SUBSIDY: [],
		TRAVEL_ALLOWANCE: [],
		MISSED_MEAL_SUBSIDY: [],
		// 劳部发〔1994〕489号 art.16: a loss recovered from net pay reduces no insured or taxable wage.
		EMPLOYEE_DAMAGE_DEDUCTION: []
	},
	// 健康保険法 §3(5), 厚生年金保険法 §3(1)(iii): the monthly premiums are charged on the declared
	// 標準報酬月額 (HEALTH.standard_monthly_remuneration), never on the month's pay, so no class counts
	// toward HEALTH, PENSION or CHILD_CONTRIBUTION. 徴収法 §2(2): 賃金 is every payment for labour,
	// 通勤手当 and 賞与 included, so both bear EMPLOYMENT_INSURANCE and WORKERS_COMP. 所得税法 §9(1)(v)
	// with 施行令 §20の2: INCOME_TAX subtracts the exempt 通勤手当 by code. RESIDENT_TAX charges the
	// municipality's notice, not this base; its membership is the pay an exit lump collection may be
	// taken from (地方税法 §321-5(2)).
	JP: {
		COMMUTING: ['EMPLOYMENT_INSURANCE', 'INCOME_TAX', 'RESIDENT_TAX', 'WORKERS_COMP'],
		// 健康保険法 §3(6), 厚生年金保険法 §3(1)(iv): 標準賞与額; 所得税法 §186: the bonus table.
		BONUS: [
			'EMPLOYMENT_INSURANCE',
			'HEALTH_BONUS',
			'INCOME_TAX_BONUS',
			'PENSION_BONUS',
			'RESIDENT_TAX',
			'WORKERS_COMP'
		],
		// 所得税基本通達 36-38の2: the meal value is pay to INCOME_TAX; the worker's charge is no pay.
		MEAL_IN_KIND: ['INCOME_TAX'],
		MEAL_CHARGE: [],
		// 労働基準法 §26 休業手当 is 賃金 (徴収法 §2(2)) and 給与所得 (所得税法 §28).
		SHUTDOWN_ALLOWANCE: ['EMPLOYMENT_INSURANCE', 'INCOME_TAX', 'RESIDENT_TAX', 'WORKERS_COMP'],
		// 所得税法 §30(1), 地方税法 §50-2 and §328: 退職所得, taxed apart; not 報酬, 賞与 or 賃金.
		RETIREMENT_ALLOWANCE: ['RESIDENT_TAX', 'RESIDENT_TAX_RETIREMENT', 'RETIREMENT_INCOME_TAX'],
		// 労働基準法 §20 解雇予告手当: 退職所得 (所得税基本通達 30-5), not 賃金 for labour insurance.
		DISMISSAL_NOTICE_PAY: ['RESIDENT_TAX', 'RESIDENT_TAX_RETIREMENT', 'RETIREMENT_INCOME_TAX']
	}
};
MATRIX['CN-kunming'] = MATRIX['CN-shanghai'];

/** The classes the law owes on separation, raised by off-boarding for an eligible leaver. */
const SEPARATION = new Set([
	'TERMINATION_BENEFIT',
	'NOTICE_IN_LIEU',
	'SEPARATION_PAY',
	'KASAMBAHAY_INDEMNITY',
	'KASAMBAHAY_FORFEITURE',
	'OCC_DEATH_FUNERAL',
	'OCC_DEATH_COMPENSATION',
	'RETIREMENT_PAY',
	'SEVERANCE_PAY',
	'SEVERANCE_ALLOWANCE',
	'JOB_LOSS_ALLOWANCE',
	'PESANGON',
	'PENSION_OFFSET',
	'UPMK',
	'UANG_PISAH',
	'PKWT_COMPENSATION',
	'THR',
	// PH: a leaver's pro-rata 13th month (DOLE Handbook 2024 ch.13 §G; PD 851 Revised Guidelines ¶6), EM-1.
	'THIRTEENTH_MONTH_PAY'
]);

for (const lineage of LINEAGES) {
	test(`${lineage}: every version carries the membership matrix`, () => {
		const expected = MATRIX[lineage];
		assert.ok(expected, `no matrix for ${lineage}`);
		const schemes = contributionSchemes(lineage);
		for (const version of settingsVersions(lineage)) {
			const parts = new Map(
				schemes
					.filter((scheme) => scheme.settings_id === version.id)
					.map((scheme) => [scheme.code, scheme.parts ?? []])
			);
			// A version carries the classes and schemes of its date: a scheme the law added later
			// (MY SKBBK from 2026) is absent from an earlier version's memberships, not a drift.
			const rows = [...allowanceCatalogue(lineage), ...adhocCatalogue(lineage)].filter(
				(row) => row.settings_id === version.id
			);
			const actual = Object.fromEntries(
				rows.map((row) => [row.code, [...row.counts_toward].sort()])
			);
			const wanted = Object.fromEntries(
				rows.map((row) => {
					assert.ok(
						expected[row.code],
						`${lineage} ${version.code}: ${row.code} not in the matrix`
					);
					return [
						row.code,
						expected[row.code]
							.filter((entry) => parts.has(entry.split('.')[0]) || RESERVED_WAGE_MARKS.has(entry))
							.sort()
					];
				})
			);
			assert.deepEqual(actual, wanted, `${lineage} ${version.code}`);
			// The separation classes are the ones off-boarding raises; every other ad hoc class is HR's.
			for (const row of adhocCatalogue(lineage).filter((row) => row.settings_id === version.id))
				assert.equal(
					row.raised_by,
					SEPARATION.has(row.code) ? 'SEPARATION' : 'MANUAL',
					`${lineage} ${row.code}`
				);
			// Every membership names a scheme of the same version, and a part the scheme declares.
			for (const row of rows)
				for (const entry of row.counts_toward) {
					if (RESERVED_WAGE_MARKS.has(entry)) continue;
					const [code, part] = entry.split('.');
					assert.ok(parts.has(code), `${lineage} ${version.code} ${row.code} → ${entry}`);
					if (part !== undefined)
						assert.ok(parts.get(code).includes(part), `${lineage} ${row.code} → ${entry}`);
				}
		}
	});
}

test('PH-HD02 — a performance bonus is Pag-IBIG fund salary, capped at PHP10,000', () => {
	// Circular 460 p.2: fund salary is the basic salary plus remuneration "however designated";
	// employee 2% above PHP1,500, employer 2%, on at most PHP10,000. Unvalidated: the low salary
	// isolates the base, not the NCR floor.
	const run = (wage: number, bonus: number) =>
		assessStatutoryUnvalidated(
			{ code: 'PH', period: '2026-07', people: [{ key: 'B', wage }] },
			(world) => {
				const version = settingsIdOn('PH', '2026-07-15');
				world.adhoc_requests!.push({
					id: 'a5100000-0000-4000-8000-0000000000b1',
					employment_id: world.employments[0]!.id,
					catalogue_id: world.adhoc_catalogue!.find(
						(row) => row.code === 'bonus' && row.settings_id === version
					)!.id,
					amount: bonus,
					event_date: '2026-07-15',
					pay_period: '2026-07',
					payslip_id: null,
					reason: 'performance bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
	// 5,000 + 3,000 = 8,000 → 2% = 160 each (the salary alone would be 100 each).
	expectStatutory(run(5_000, 3_000), 'B', 'HDMF', 160, 160);
	// 8,000 + 5,000 = 13,000 → capped 10,000 → 200 each (the salary alone would be 160 each).
	expectStatutory(run(8_000, 5_000), 'B', 'HDMF', 200, 200);
});
