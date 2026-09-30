import {
	officeWeek,
	register,
	type ProbeCase,
	type ProbeInput,
	type Row
} from '../payroll-probe.ts';

/**
 * CN-kunming cases: see the case shape at the top of payroll-probe.ts. Every figure is computed by
 * hand from the cited law; the goldens are not the source.
 *
 * Sources common to every case (register rows in docs/inventory/china.csv):
 * - Pension 16% employer / 8% worker; unemployment 2% / 1% statutory, 0.7% / 0.3% "目前延续实施";
 *   work injury employer-only, class I–VIII base 0.2–1.9%; 2026 base 4,403–22,017 for pension,
 *   unemployment and injury, with the floor examples 704.48 / 352.24, 30.82 / 13.21 and 8.81 —
 *   元谋县人社局 employer notice, read in the in-app browser 30 Sep 2026
 *   (https://www.yncxym.gov.cn/info/1011/286437.htm; CN-KM03, KM25, KM26, KM27).
 * - 2025 base 4,357–21,789 (https://www.dhlc.gov.cn/fsx/Web/_F0_0_6C9DO9USE71563368BE04C9C90.htm);
 *   medical and maternity keep it until 31 Aug 2026 and move to 4,403–22,017 from 1 Sep 2026
 *   (云人社发〔2026〕8号, https://www.yn.gov.cn/hdjl/msgq/202608/t20260829_330317.html; CN-KM03).
 *   Pension, unemployment and injury take the 2026 bounds from 1 January 2026: owner-rule default
 *   recorded on CN-KM03 (the notice names them 2026年度).
 * - Medical employer 7% (Kunming 医保局 notice of 30 Dec 2022, https://ybj.km.gov.cn/c/2023-02-08/4665265.shtml),
 *   worker 2% (Yunnan Government Order 86 art.6, https://ylbz.yn.gov.cn/index.php?c=show&id=125; CN-KM04);
 *   maternity employer 0.9%, worker nothing (https://ybj.km.gov.cn/c/2024-07-25/4882692.shtml; CN-KM32).
 * - Social-insurance shares to the fen, half-up (CN-X-SI-ROUNDING: law silent, recorded default).
 * - Housing fund: equal unit rate 5–12% each side, each side rounded to the whole yuan 四舍五入
 *   (昆公积金规〔2020〕2号 arts.10–14, https://zc.51shebao.com/detail/825467; CN-KM20); cap 32,470 in
 *   2025, 32,543 in 2026; floors 2,170 (class I) / 2,020 (class II) to 31 Aug 2026, 2,270 / 2,120 for
 *   new accounts from 1 Sep 2026 (CN-KM05).
 * - Minimum wage, gross including the worker's insurance and fund: class I 2,170, class II 2,020 from
 *   1 Oct 2025 (云人社发〔2025〕19号, https://www.ynjc.gov.cn/u/cms/jcqzfxxgk/202509/30130601xbad.pdf; CN-KM01);
 *   class I 2,270 from 1 Sep 2026 (https://www.ynjc.gov.cn/jcqzfxxgk/zcw2023j0221/20260901/1677677.html; CN-KM02).
 * - IIT: IIT Law arts.3, 6 (https://fgk.chinatax.gov.cn/zcfgk/c100009/c5193028/content.html); STA 2018
 *   No.61 art.6 (resident cumulative withholding: income − the year's 三险一金 − 5,000 × months employed
 *   here this year, on the annual table 3% ≤ 36,000, 10% − 2,520 ≤ 144,000 …) and art.9 (non-resident:
 *   month's wage − 5,000 on the monthly table 3% ≤ 3,000, 10% − 210 ≤ 12,000, 20% − 1,410 ≤ 25,000 …)
 *   (https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3963396/content.html; CN-N09, N38).
 *   Every resident case is the employee's first month of the tax year at this employer, so the
 *   cumulative figure is this month alone (the probe runs one period and has no earlier payslips).
 * - 21.75 paid days a month, 8 hours a day (人社部发〔2025〕2号,
 *   https://www.mohrss.gov.cn/SYrlzyhshbzb/laodongguanxi_/zcwj/202501/t20250101_533693.html; CN-N02).
 *   Part-month pay is the monthly wage ÷ 21.75 per working day, never above the month: law silent,
 *   recorded default (CN-N02 register reason and `work_rules.authority`).
 */

const WUHUA = '云南省/昆明市/五华区';
const FUMIN = '云南省/昆明市/富民县';
const SINCE = '2025-06-02';

/** 2026 company facts: class I injury 0.2%, the agency's 0.7 / 0.3 unemployment rates, a 12% fund. */
const FACTS_2026 = {
	injury_rate: 0.2,
	unemployment_employer_rate: 0.7,
	unemployment_employee_rate: 0.3,
	housing_fund_rate: 12
};
/** December 2025: the version seeds unemployment at the 2025 reduced 0.7 / 0.3 itself. */
const FACTS_2025 = { injury_rate: 0.2, housing_fund_rate: 12 };

type Worker = {
	ref: string;
	name: string;
	wage: number;
	/** Declared social-insurance base (prior-year average, or a new hire's first full month). */
	siBase?: number;
	/** Declared housing-fund base; `null` declares none (a first-ever account in its first month). */
	hfBase?: number | null;
	from?: string;
	to?: string | null;
	worksite?: string;
	citizenship?: 'CITIZEN' | 'FOREIGNER';
	taxResidency?: 'RESIDENT' | 'NON_RESIDENT';
	gender?: 'MALE' | 'FEMALE';
	nationality?: string;
	children?: Row[];
	employment?: Row;
	/** Extra housing-fund elections (`first_ever_account`, `voluntary_agreement`). */
	hf?: Row;
	/** Overrides the pension registration status. */
	pensionStatus?: Row;
	/** Replaces the single terms row (a mid-month rate change). */
	terms?: { wage: number; from: string; to: string | null }[];
};

/** One Kunming office worker: employee, employment, terms and the pension and fund registrations. */
function worker(w: Worker): ProbeInput[] {
	const from = w.from ?? SINCE;
	const to = w.to ?? null;
	const job = `${w.ref}_job`;
	const siBase = w.siBase ?? w.wage;
	const hfBase = w.hfBase === undefined ? siBase : w.hfBase;
	const employmentScoped = w.hf != null && 'first_ever_account' in w.hf;
	return [
		{
			collection: 'employees',
			ref: w.ref,
			values: {
				name: w.name,
				date_of_birth: '1990-05-12',
				gender: w.gender ?? 'MALE',
				nationality: w.nationality ?? 'Chinese',
				...(w.children == null ? {} : { children: w.children })
			}
		},
		{
			collection: 'employments',
			ref: job,
			values: {
				employee_id: `@${w.ref}`,
				company_id: '@company',
				employee_number: `P-KM-${w.ref}`,
				prior_service_months: 0,
				effective_range: { from, to },
				...w.employment
			}
		},
		...(w.terms ?? [{ wage: w.wage, from, to }]).map((t): ProbeInput => ({
			collection: 'employment_terms',
			values: {
				employment_id: `@${job}`,
				residency_status: w.citizenship ?? 'CITIZEN',
				tax_residency: w.taxResidency ?? 'RESIDENT',
				currency: 'CNY',
				base_salary: t.wage,
				pay_frequency: 'MONTHLY',
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: 'PERMANENT',
				worksite: w.worksite ?? WUHUA,
				shift_pattern_id: '@week',
				effective_range: { from: t.from, to: t.to }
			}
		})),
		{
			collection: 'employment_statutory_facts',
			values: {
				employee_id: `@${w.ref}`,
				statutory_contribution_id: '@law:statutory_contributions:PENSION',
				effective_range: { from, to: null },
				status: w.pensionStatus ?? {
					kind: 'REGISTERED',
					reference_number: `PROBE-SI-${w.ref}`,
					elections: { contribution_base: siBase }
				}
			}
		},
		{
			collection: 'employment_statutory_facts',
			values: {
				employee_id: `@${w.ref}`,
				...(employmentScoped ? { employment_id: `@${job}` } : {}),
				statutory_contribution_id: '@law:statutory_contributions:HOUSING_FUND',
				effective_range: { from, to: null },
				status: {
					kind: 'REGISTERED',
					reference_number: `PROBE-HF-${w.ref}`,
					elections: { ...(hfBase == null ? {} : { contribution_base: hfBase }), ...w.hf }
				}
			}
		}
	];
}

const adhoc = (
	ref: string,
	code: string,
	amount: number,
	date: string,
	reason: string
): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		reason,
		as_adjustment_entry: false
	}
});

const leave = (
	ref: string,
	code: string,
	from: string,
	to: string,
	extra: Row = {}
): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference: `${ref}-${code}`,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		reason: code,
		...extra
	}
});

/** An attended day; `overtime` is the extended hours the employer arranged (paid only as approved, as in Shanghai). */
const punch = (
	ref: string,
	date: string,
	intervals: [string, string][],
	overtime = 0
): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: `@${ref}_job`,
		work_date: date,
		worked_intervals: intervals.map(([start, end]) => ({
			start: `${date}T${start}:00+08:00`,
			end: `${date}T${end}:00+08:00`
		})),
		...(overtime > 0 ? { approved_overtime_hours: overtime, time_off_in_lieu: false } : {})
	}
});

/** Statutory lines of a resident citizen on a 21,750 declared base, both bases in bounds, fund 12%. */
const SI_21750 = {
	'PENSION.employee': 1740, // 21,750 × 8%
	'PENSION.employer': 3480, // × 16%
	'MEDICAL.employee': 435, // × 2%
	'MEDICAL.employer': 1522.5, // × 7%
	'MATERNITY.employer': 195.75, // × 0.9%
	'UNEMPLOYMENT.employee': 65.25, // × 0.3%
	'UNEMPLOYMENT.employer': 152.25, // × 0.7%
	'INJURY.employer': 43.5, // × 0.2%
	'HOUSING_FUND.employee': 2610, // × 12% = 2,610
	'HOUSING_FUND.employer': 2610
};
// Employee 1,740 + 435 + 65.25 + 2,610 = 4,850.25; employer 3,480 + 1,522.5 + 195.75 + 152.25 + 43.5 + 2,610 = 8,004.

/** January 2026, one worker on 21,750 from June 2025: the shape most cases share. */
const jan21750 = (
	id: string,
	description: string,
	citation: string[],
	extra: ProbeInput[],
	lines: Record<string, number>,
	w: Partial<Worker> = {}
): ProbeCase => ({
	id,
	profile: 'CN-kunming',
	description,
	citation,
	company: { facts: FACTS_2026 },
	inputs: [
		...officeWeek(SINCE),
		...worker({ ref: 'w', name: `Worker ${id}`, wage: 21750, ...w }),
		...extra
	],
	period: '2026-01',
	expected: [{ employment: 'w_job', lines: { ...SI_21750, employer_cost: 8004, ...lines } }]
});

register(
	{
		id: 'CN-KM-WP09-1',
		profile: 'CN-kunming',
		description:
			'Full month, January 2026, Wuhua, 10,000 on a declared 10,000 base: pension, medical, maternity, unemployment, injury and a 12% fund withheld and paid, and resident IIT on the first month of the year.',
		citation: [
			'Rates and bases: see the file header (CN-KM03, KM04, KM20, KM25, KM26, KM27, KM32).',
			'Pension 800 / 1,600; medical 200 / 700; maternity 90; unemployment 30 / 70; injury 20; fund 1,200 / 1,200.',
			'IIT (STA 2018 No.61 art.6, month 1): 10,000 − (800 + 200 + 30 + 1,200) − 5,000 = 2,770 × 3% = 83.10.',
			'昆明市工资支付条例 art.16 (CN-KM-WP09; https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=67457): the employer may withhold only personal income tax, the worker’s social insurance, court-ordered 抚养费/赡养费 and other amounts laws and regulations prescribe; the housing-fund share is withheld under that last item with the Housing Provident Fund Regulation (CN-N08). Net 10,000 − 2,230 − 83.10 = 7,686.90; employer 1,600 + 700 + 90 + 70 + 20 + 1,200 = 3,680.'
		],
		company: { facts: FACTS_2026 },
		inputs: [...officeWeek(SINCE), ...worker({ ref: 'li', name: 'Li Ming', wage: 10000 })],
		period: '2026-01',
		expected: [
			{
				employment: 'li_job',
				lines: {
					gross: 10000,
					BASIC: 10000,
					total_deductions: 2313.1,
					net: 7686.9,
					employer_cost: 3680,
					'PENSION.employee': 800,
					'PENSION.employer': 1600,
					'MEDICAL.employee': 200,
					'MEDICAL.employer': 700,
					'MATERNITY.employer': 90,
					'UNEMPLOYMENT.employee': 30,
					'UNEMPLOYMENT.employer': 70,
					'INJURY.employer': 20,
					'HOUSING_FUND.employee': 1200,
					'HOUSING_FUND.employer': 1200,
					'IIT.employee': 83.1
				}
			}
		]
	},
	{
		id: 'CN-KM25-1',
		profile: 'CN-kunming',
		description:
			'Social-insurance floor, January 2026: a 4,000 declared base lifts to 4,403 for pension, unemployment and injury (2026 bounds from 1 January) and to 4,357 for medical and maternity (2025 bounds to 31 August).',
		citation: [
			'Pension 4,403 × 16% / 8% = 704.48 / 352.24 and injury 4,403 × 0.2% = 8.81, unemployment 30.82 / 13.21: the county notice’s own floor examples (https://www.yncxym.gov.cn/info/1011/286437.htm).',
			'Medical 4,357 × 7% = 304.99, × 2% = 87.14; maternity 4,357 × 0.9% = 39.213 → 39.21 (CN-KM03, KM04, KM32).',
			'Fund 4,000 × 12% = 480 each side (above the 2,170 floor).',
			'IIT: 4,000 − 932.59 − 5,000 < 0 → nothing. Net 4,000 − 932.59 = 3,067.41; employer 704.48 + 304.99 + 39.21 + 30.82 + 8.81 + 480 = 1,568.31.'
		],
		company: { facts: FACTS_2026 },
		inputs: [...officeWeek(SINCE), ...worker({ ref: 'zhao', name: 'Zhao Lei', wage: 4000 })],
		period: '2026-01',
		expected: [
			{
				employment: 'zhao_job',
				lines: {
					gross: 4000,
					total_deductions: 932.59,
					net: 3067.41,
					employer_cost: 1568.31,
					'PENSION.employee': 352.24,
					'PENSION.employer': 704.48,
					'MEDICAL.employee': 87.14,
					'MEDICAL.employer': 304.99,
					'MATERNITY.employer': 39.21,
					'UNEMPLOYMENT.employee': 13.21,
					'UNEMPLOYMENT.employer': 30.82,
					'INJURY.employer': 8.81,
					'HOUSING_FUND.employee': 480,
					'HOUSING_FUND.employer': 480
				}
			}
		]
	},
	{
		id: 'CN-KM03-1',
		profile: 'CN-kunming',
		description:
			'Ceilings, January 2026: 30,000 declared caps at 22,017 (pension, unemployment, injury), 21,789 (medical, maternity) and a 40,000 fund base at 32,543.',
		citation: [
			'Pension 22,017 × 16% / 8% = 3,522.72 / 1,761.36 (the county notice’s own monthly maximum employer figure).',
			'Unemployment 22,017 × 0.7% = 154.119 → 154.12, × 0.3% = 66.051 → 66.05; injury × 0.2% = 44.034 → 44.03.',
			'Medical 21,789 × 7% = 1,525.23, × 2% = 435.78; maternity × 0.9% = 196.101 → 196.10.',
			'Fund 32,543 (昆公积金〔2026〕69号 cap, CN-KM05) × 12% = 3,905.16 → 3,905 each side.',
			'IIT: 30,000 − (1,761.36 + 435.78 + 66.05 + 3,905) − 5,000 = 18,831.81 × 3% = 564.9543 → 564.95. Net 30,000 − 6,733.14 = 23,266.86; employer 9,347.20.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'wang', name: 'Wang Fang', wage: 30000, hfBase: 40000 })
		],
		period: '2026-01',
		expected: [
			{
				employment: 'wang_job',
				lines: {
					gross: 30000,
					total_deductions: 6733.14,
					net: 23266.86,
					employer_cost: 9347.2,
					'PENSION.employee': 1761.36,
					'PENSION.employer': 3522.72,
					'MEDICAL.employee': 435.78,
					'MEDICAL.employer': 1525.23,
					'MATERNITY.employer': 196.1,
					'UNEMPLOYMENT.employee': 66.05,
					'UNEMPLOYMENT.employer': 154.12,
					'INJURY.employer': 44.03,
					'HOUSING_FUND.employee': 3905,
					'HOUSING_FUND.employer': 3905,
					'IIT.employee': 564.95
				}
			}
		]
	},
	{
		id: 'CN-KM03-2',
		profile: 'CN-kunming',
		description:
			'December 2025 (the first sealed version), a worker hired on Monday 1 December at 25,000: every fund at the 2025 ceiling 21,789, the reduced 2025 unemployment rates, and the 32,470 fund cap.',
		citation: [
			'2025 base 4,357–21,789 (CN-KM03); unemployment 0.7% / 0.3% through 31 Dec 2025 (county HRSS, https://www.hhpb.gov.cn/info/5861/518871.htm; CN-KM27).',
			'Pension 21,789 × 16% / 8% = 3,486.24 / 1,743.12; medical 1,525.23 / 435.78; maternity 196.10; unemployment 152.523 → 152.52 / 65.367 → 65.37; injury 43.578 → 43.58.',
			'Fund cap 32,470 for 2025 (昆公积金〔2025〕61号, CN-KM05): 33,000 declared → 32,470 × 12% = 3,896.4 → 3,896 each side.',
			'IIT (month 1 at this employer): 25,000 − 6,140.27 − 5,000 = 13,859.73 × 3% = 415.7919 → 415.79. Net 18,443.94; employer 9,299.67.'
		],
		company: { facts: FACTS_2025 },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'chen', name: 'Chen Hao', wage: 25000, hfBase: 33000, from: '2025-12-01' })
		],
		period: '2025-12',
		expected: [
			{
				employment: 'chen_job',
				lines: {
					gross: 25000,
					total_deductions: 6556.06,
					net: 18443.94,
					employer_cost: 9299.67,
					'PENSION.employee': 1743.12,
					'PENSION.employer': 3486.24,
					'MEDICAL.employee': 435.78,
					'MEDICAL.employer': 1525.23,
					'MATERNITY.employer': 196.1,
					'UNEMPLOYMENT.employee': 65.37,
					'UNEMPLOYMENT.employer': 152.52,
					'INJURY.employer': 43.58,
					'HOUSING_FUND.employee': 3896,
					'HOUSING_FUND.employer': 3896,
					'IIT.employee': 415.79
				}
			}
		]
	},
	{
		id: 'CN-KM02-1',
		profile: 'CN-kunming',
		description:
			'September 2026, a Wuhua worker transferred in on Tuesday 1 September (an existing fund account moved from a previous employer, `first_ever_account` false) at the new class I minimum 2,270: insured at the 4,403 floor (medical now included), a 2,270 fund base at 5% = 113.50 rounds up to 114 on each side.',
		citation: [
			'Minimum 2,270 from 1 Sep 2026, gross including the worker’s insurance and fund (CN-KM02): 2,270 is not below it.',
			'Medical and maternity on 4,403 from 1 Sep 2026: 308.21 / 88.06, 39.627 → 39.63; pension 704.48 / 352.24, unemployment 30.82 / 13.21, injury 8.81.',
			'Fund: a transferred worker contributes from the first month of pay at the full monthly wage (昆公积金规〔2020〕2号 art.12, https://zc.51shebao.com/detail/825467; a first-ever account would start only in the second month, CN-KM20-1); new/transferred-account floor 2,270 from 1 Sep 2026 (CN-KM05); 2,270 × 5% = 113.50 → 114 each side, 228 combined, not 227 (art.13 四舍五入 per side, CN-KM20).',
			'IIT nil. Net 2,270 − 567.51 = 1,702.49; employer 704.48 + 308.21 + 39.63 + 30.82 + 8.81 + 114 = 1,205.95.'
		],
		company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'sun',
				name: 'Sun Yan',
				wage: 2270,
				siBase: 2270,
				from: '2026-09-01',
				hf: { first_ever_account: false }
			})
		],
		period: '2026-09',
		expected: [
			{
				employment: 'sun_job',
				lines: {
					gross: 2270,
					total_deductions: 567.51,
					net: 1702.49,
					employer_cost: 1205.95,
					'PENSION.employee': 352.24,
					'PENSION.employer': 704.48,
					'MEDICAL.employee': 88.06,
					'MEDICAL.employer': 308.21,
					'MATERNITY.employer': 39.63,
					'UNEMPLOYMENT.employee': 13.21,
					'UNEMPLOYMENT.employer': 30.82,
					'INJURY.employer': 8.81,
					'HOUSING_FUND.employee': 114,
					'HOUSING_FUND.employer': 114
				}
			}
		]
	},
	{
		id: 'CN-KM01-1',
		profile: 'CN-kunming',
		description:
			'January 2026, a Fumin (class II) worker at the class II minimum 2,020 with a fund base at the class II floor 2,020 and a 5% fund.',
		citation: [
			'云人社发〔2025〕19号: Kunming’s other counties CNY2,020 from 1 Oct 2025, gross including the worker’s shares (CN-KM01).',
			'Insurance floors as CN-KM25-1: pension 704.48 / 352.24, medical 304.99 / 87.14, maternity 39.21, unemployment 30.82 / 13.21, injury 8.81.',
			'Fund class II floor 2,020 (CN-KM05) × 5% = 101 each side.',
			'IIT nil. Net 2,020 − 553.59 = 1,466.41; employer 1,189.31.'
		],
		company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'yang', name: 'Yang Jie', wage: 2020, worksite: FUMIN })
		],
		period: '2026-01',
		expected: [
			{
				employment: 'yang_job',
				lines: {
					gross: 2020,
					total_deductions: 553.59,
					net: 1466.41,
					employer_cost: 1189.31,
					'PENSION.employee': 352.24,
					'PENSION.employer': 704.48,
					'MEDICAL.employee': 87.14,
					'MEDICAL.employer': 304.99,
					'MATERNITY.employer': 39.21,
					'UNEMPLOYMENT.employee': 13.21,
					'UNEMPLOYMENT.employer': 30.82,
					'INJURY.employer': 8.81,
					'HOUSING_FUND.employee': 101,
					'HOUSING_FUND.employer': 101
				}
			}
		]
	},
	jan21750(
		'CN-KM-WP12-1',
		'One day of unpaid personal leave (Wednesday 14 January 2026) off 21,750: the absent day’s wage only, 21,750 ÷ 21.75 = 1,000.',
		[
			'昆明市工资支付条例 (CN-KM-WP12): for personal leave deduct only the absent period’s wage; 21.75-day conversion (CN-N02).',
			'Insurance on the declared 21,750, unchanged by the absence.',
			'IIT: 20,750 − 4,850.25 − 5,000 = 10,899.75 × 3% = 326.9925 → 326.99. Net 20,750 − 5,177.24 = 15,572.76.'
		],
		[leave('w', 'UNPAID_LEAVE', '2026-01-14', '2026-01-14')],
		{ gross: 20750, total_deductions: 5177.24, net: 15572.76, 'IIT.employee': 326.99 }
	),
	{
		id: 'CN-KM20-1',
		profile: 'CN-kunming',
		description:
			'Mid-month joiner, Monday 19 January 2026, 21,750, a first-ever housing-fund account: ten working days paid, full-month social insurance, no fund until the second month.',
		citation: [
			'Pay: 21,750 ÷ 21.75 × 10 working days (19–23, 26–30 January) = 10,000 (CN-N02 recorded default).',
			'Fund: a first-ever contributor starts in the second month (昆公积金规〔2020〕2号 arts.10–14, CN-KM20; Housing Provident Fund Regulation, CN-N08): no fund line.',
			'Insurance on the declared first-month base 21,750: 1,740 / 3,480, 435 / 1,522.5, 195.75, 65.25 / 152.25, 43.5.',
			'IIT: 10,000 − (1,740 + 435 + 65.25) − 5,000 = 2,759.75 × 3% = 82.7925 → 82.79. Net 10,000 − 2,323.04 = 7,676.96; employer 5,394.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'zhou',
				name: 'Zhou Min',
				wage: 21750,
				from: '2026-01-19',
				hfBase: null,
				hf: { first_ever_account: true }
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'zhou_job',
				lines: {
					gross: 10000,
					BASIC: 10000,
					total_deductions: 2323.04,
					net: 7676.96,
					employer_cost: 5394,
					'PENSION.employee': 1740,
					'PENSION.employer': 3480,
					'MEDICAL.employee': 435,
					'MEDICAL.employer': 1522.5,
					'MATERNITY.employer': 195.75,
					'UNEMPLOYMENT.employee': 65.25,
					'UNEMPLOYMENT.employer': 152.25,
					'INJURY.employer': 43.5,
					'IIT.employee': 82.79
				}
			}
		]
	},
	{
		id: 'CN-KM-WP09-2',
		profile: 'CN-kunming',
		description:
			'Mid-month leaver with final pay and 经济补偿: hired Monday 5 January 2026, ended by an employer-proposed mutual agreement on Friday 16 January, 21,750. Ten days’ wage, half a month’s compensation, no annual leave to encash, compensation exempt from IIT.',
		citation: [
			'Final pay: 21,750 ÷ 21.75 × 10 working days (5–9, 12–16 January) = 10,000 (CN-N02 recorded default), paid in the exit month (昆明市工资支付条例 art.13, CN-KM-WP06).',
			'LCL arts.46(2), 47 (https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html): an employer-proposed art.36 ending owes compensation; under six months is half a month. Implementing Regulation art.27 (https://xzfg.moj.gov.cn/front/law/detail?LawID=284): the monthly wage due, the contract month 21,750 for a leaver hired in the exit month (CN-SH-A2 recorded default); below 3 × 10,847.83 so uncapped: 0.5 × 21,750 = 10,875.',
			'Annual leave: under twelve months’ continuous work and no prior service, so none accrues and none is encashed (职工带薪年休假条例 art.2, https://xzfg.moj.gov.cn/front/law/detail?LawID=208).',
			'IIT_SEVERANCE: 财税〔2018〕164号 item 5(1) (http://szs.mof.gov.cn/zhengcefabu/201812/t20181227_3110164.htm) exempts up to 3 × 130,174 = 390,522: nothing charged.',
			'Insurance and fund for the month on the declared 21,750 (4,850.25 / 8,004). IIT on the wage: 10,000 − 4,850.25 − 5,000 = 149.75 × 3% = 4.4925 → 4.49. Gross 20,875; net 20,875 − 4,854.74 = 16,020.26.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'wu',
				name: 'Wu Qiang',
				wage: 21750,
				from: '2026-01-05',
				to: '2026-01-16',
				employment: {
					exit_ground: 'MUTUAL',
					exit_facts: { lcl_termination_ground: 'ART_36_EMPLOYER', renewal_offer_refused: false }
				}
			}),
			adhoc('wu', 'SEVERANCE_PAY', 0, '2026-01-16', 'LCL art.47 经济补偿')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'wu_job',
				lines: {
					...SI_21750,
					gross: 20875,
					BASIC: 10000,
					SEVERANCE_PAY: 10875,
					total_deductions: 4854.74,
					net: 16020.26,
					employer_cost: 8004,
					'IIT.employee': 4.49
				}
			}
		]
	},
	jan21750(
		'CN-KM-WP08-1',
		'Weekday overtime: Monday 5 January 2026, 09:00–20:00 with a one-hour break, two hours beyond eight, at 150% of the 21.75-day hour.',
		[
			'Labour Law art.44(1) (https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html): extended hours at no less than 150%; hour = 21,750 ÷ 21.75 ÷ 8 = 125: 2 × 125 × 1.5 = 375 (CN-KM-WP08, CN-N01, N02).',
			'IIT: 22,125 − 4,850.25 − 5,000 = 12,274.75 × 3% = 368.2425 → 368.24. Net 22,125 − 5,218.49 = 16,906.51.'
		],
		[
			punch(
				'w',
				'2026-01-05',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				2
			)
		],
		{ gross: 22125, total_deductions: 5218.49, net: 16906.51, 'IIT.employee': 368.24 }
	),
	jan21750(
		'CN-KM-WP08-2',
		'Rest-day work without compensatory rest: Sunday 11 January 2026, three hours, at 200%.',
		[
			'Labour Law art.44(2): rest-day work where no compensatory rest is arranged at no less than 200%: 3 × 125 × 2 = 750 (CN-KM-WP08). Three hours: the version counts rest-day hours in the art.41 three-hour daily ceiling (law silent on whether rest-day work is 延长工作时间 for the daily cap; the seed’s lawful default).',
			'IIT: 22,500 − 4,850.25 − 5,000 = 12,649.75 × 3% = 379.4925 → 379.49. Net 22,500 − 5,229.74 = 17,270.26.'
		],
		[punch('w', '2026-01-11', [['09:00', '12:00']], 3)],
		{ gross: 22500, total_deductions: 5229.74, net: 17270.26, 'IIT.employee': 379.49 }
	),
	jan21750(
		'CN-KM-WP08-3',
		'Statutory-holiday work: New Year’s Day, Thursday 1 January 2026, published by the company, eight hours at 300% on top of the month’s salary.',
		[
			'State Council Order 795 (https://www.gov.cn/zhengce/content/202411/content_6986380.htm): 1 January is a national holiday. Labour Law art.44(3): holiday work at no less than 300%: 8 × 125 × 3 = 3,000 (CN-KM-WP08).',
			'IIT: 24,750 − 4,850.25 − 5,000 = 14,899.75 × 3% = 446.9925 → 446.99. Net 24,750 − 5,297.24 = 19,452.76.'
		],
		[
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-01-01',
					name: '元旦',
					kind: 'PUBLIC_HOLIDAY',
					published_at: '2025-11-01T00:00:00.000Z'
				}
			},
			punch(
				'w',
				'2026-01-01',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				8
			)
		],
		{ gross: 24750, total_deductions: 5297.24, net: 19452.76, 'IIT.employee': 446.99 }
	),
	{
		id: 'CN-KM-WP03-1',
		profile: 'CN-kunming',
		description:
			'Mid-month rise, January 2026: 22,000 to Thursday 15 January, 26,400 from Friday 16 January; 11 of the month’s 22 working days at each rate. The insured base stays the declared 22,000.',
		citation: [
			'Pay the full wage due (昆明市工资支付条例, CN-KM-WP03). The month’s 21.75 paid days split by working days (CN-N02 recorded default): 22,000 × 11/22 + 26,400 × 11/22 = 24,200.',
			'Base: the declared prior-year average, not the new wage (CN-KM03, KM20). Pension 22,000 × 16% / 8% = 3,520 / 1,760; medical at the 21,789 cap 1,525.23 / 435.78; maternity 196.10; unemployment 154 / 66; injury 44; fund 22,000 × 12% = 2,640 each side.',
			'IIT: 24,200 − 4,901.78 − 5,000 = 14,298.22 × 3% = 428.9466 → 428.95. Net 24,200 − 5,330.73 = 18,869.27; employer 8,079.33.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'he',
				name: 'He Jing',
				wage: 22000,
				terms: [
					{ wage: 22000, from: SINCE, to: '2026-01-15' },
					{ wage: 26400, from: '2026-01-16', to: null }
				]
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'he_job',
				lines: {
					gross: 24200,
					BASIC: 24200,
					total_deductions: 5330.73,
					net: 18869.27,
					employer_cost: 8079.33,
					'PENSION.employee': 1760,
					'PENSION.employer': 3520,
					'MEDICAL.employee': 435.78,
					'MEDICAL.employer': 1525.23,
					'MATERNITY.employer': 196.1,
					'UNEMPLOYMENT.employee': 66,
					'UNEMPLOYMENT.employer': 154,
					'INJURY.employer': 44,
					'HOUSING_FUND.employee': 2640,
					'HOUSING_FUND.employer': 2640,
					'IIT.employee': 428.95
				}
			}
		]
	},
	...(
		[
			[
				'CN-KM-WP09-3',
				'BONUS',
				'A 13th-month payment of 20,000 on a 20,000 wage, paid as an ordinary bonus: it joins January’s wages.',
				'STA 2018 No.61 art.6: wage income of the month. 40,000 − (1,600 + 400 + 60 + 2,400) − 5,000 = 30,540 × 3% = 916.20. Net 40,000 − 5,376.20 = 34,623.80.',
				{
					gross: 40000,
					BONUS: 20000,
					total_deductions: 5376.2,
					net: 34623.8,
					'IIT.employee': 916.2
				}
			],
			[
				'CN-KM-WP09-4',
				'ANNUAL_BONUS_SEPARATE',
				'An annual one-off bonus of 36,001 taxed apart from the wage: 36,001 ÷ 12 = 3,000.08 crosses the 3% band into 10%.',
				'MOF/STA 2023 No.30 (https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211524/content.html; CN-N10): bonus × rate − quick deduction on the monthly table: 36,001 × 10% − 210 = 3,390.10. Wage alone 20,000 − 4,460 − 5,000 = 10,540 × 3% = 316.20. Net 56,001 − 8,166.30 = 47,834.70.',
				{
					gross: 56001,
					ANNUAL_BONUS_SEPARATE: 36001,
					total_deductions: 8166.3,
					net: 47834.7,
					'IIT.employee': 316.2,
					'IIT_BONUS.employee': 3390.1
				}
			]
		] as const
	).map(([id, code, description, iit, lines]): ProbeCase => ({
		id,
		profile: 'CN-kunming',
		description: `${description} January 2026, Wuhua, declared bases 20,000, fund 12%.`,
		citation: [
			'Insurance on 20,000 (CN-KM03, KM04, KM25–27, KM32): pension 1,600 / 3,200, medical 400 / 1,400, maternity 180, unemployment 60 / 140, injury 40; fund 2,400 each side (CN-KM20). A bonus does not move the declared base.',
			iit,
			'Employer 3,200 + 1,400 + 180 + 140 + 40 + 2,400 = 7,360.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'b', name: `Bonus ${id}`, wage: 20000 }),
			adhoc('b', code, code === 'BONUS' ? 20000 : 36001, '2026-01-20', '2025 year-end bonus')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'b_job',
				lines: {
					BASIC: 20000,
					employer_cost: 7360,
					'PENSION.employee': 1600,
					'PENSION.employer': 3200,
					'MEDICAL.employee': 400,
					'MEDICAL.employer': 1400,
					'MATERNITY.employer': 180,
					'UNEMPLOYMENT.employee': 60,
					'UNEMPLOYMENT.employer': 140,
					'INJURY.employer': 40,
					'HOUSING_FUND.employee': 2400,
					'HOUSING_FUND.employer': 2400,
					...lines
				}
			}
		]
	})),
	{
		id: 'CN-KM-A1-1',
		profile: 'CN-kunming',
		description:
			'A foreign, non-resident worker on 30,000 with a 60,000 multi-month bonus, January 2026: social insurance at the ceilings, no housing fund without agreement, wage tax on the monthly table with no insurance relief, and the bonus spread over six months.',
		citation: [
			'Foreigners employed in China join the social insurances (在中国境内就业的外国人参加社会保险暂行办法, MOHRSS Order 16, art.2; CN-N25): pension 3,522.72 / 1,761.36, medical 1,525.23 / 435.78, maternity 196.10, unemployment 154.12 / 66.05, injury 44.03.',
			'Housing fund: a foreign worker joins only by agreement (CN-N08; the fund election `voluntary_agreement` false): none.',
			'IIT wage (STA 2018 No.61 art.9; IIT Law art.6(2)): 30,000 − 5,000 = 25,000 → 25,000 × 20% − 1,410 = 3,590.',
			'Multi-month bonus (MOF/STA 2019 No.35 item 3(2), https://fgk.chinatax.gov.cn/zcfgk/c102416/c5202332/content.html; CN-KM-A1): [(60,000 ÷ 6) × 10% − 210] × 6 = 4,740.',
			'Net 90,000 − (2,263.19 + 3,590 + 4,740) = 79,406.81; employer 5,442.20.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'tom',
				name: 'Tom Becker',
				wage: 30000,
				citizenship: 'FOREIGNER',
				taxResidency: 'NON_RESIDENT',
				nationality: 'German',
				hf: { voluntary_agreement: false }
			}),
			adhoc('tom', 'ANNUAL_BONUS_SEPARATE', 60000, '2026-01-20', 'Bonus for July–December 2025')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'tom_job',
				lines: {
					gross: 90000,
					BASIC: 30000,
					ANNUAL_BONUS_SEPARATE: 60000,
					total_deductions: 10593.19,
					net: 79406.81,
					employer_cost: 5442.2,
					'PENSION.employee': 1761.36,
					'PENSION.employer': 3522.72,
					'MEDICAL.employee': 435.78,
					'MEDICAL.employer': 1525.23,
					'MATERNITY.employer': 196.1,
					'UNEMPLOYMENT.employee': 66.05,
					'UNEMPLOYMENT.employer': 154.12,
					'INJURY.employer': 44.03,
					'IIT.employee': 3590,
					'IIT_BONUS.employee': 4740
				}
			}
		]
	},
	jan21750(
		'CN-KM30-1',
		'Paid marriage leave, Monday 12 – Friday 16 January 2026 (marriage on 10 January): no deduction.',
		[
			'Yunnan Population and Family Planning Regulation art.18 (third amendment 17 Jan 2022, https://www.ynrd.gov.cn/html/2022/changweihuigonggao_0118/16355.html): 15 days on top of the national 1–3; art.35: working days inside the leave are paid (CN-KM30, CN-KM-WP12).',
			'IIT: 21,750 − 4,850.25 − 5,000 = 11,899.75 × 3% = 356.9925 → 356.99. Net 21,750 − 5,207.24 = 16,542.76.'
		],
		[
			leave('w', 'MARRIAGE_LEAVE', '2026-01-12', '2026-01-16', {
				facts: {
					event_kind: 'MARRIAGE',
					event_date: '2026-01-10'
				}
			})
		],
		{ gross: 21750, BASIC: 21750, total_deductions: 5207.24, net: 16542.76, 'IIT.employee': 356.99 }
	),
	jan21750(
		'CN-KM12-1',
		'Paid childcare leave (育儿假) for a child under three, Tuesday 6 – Wednesday 7 January 2026: no deduction.',
		[
			'Yunnan regulation (CN-KM12; https://sft.yn.gov.cn/yfzs/pages_1_3173.aspx): ten childcare days a year for each parent of a child under three, paid (CN-KM-WP12).',
			'IIT: 21,750 − 4,850.25 − 5,000 = 11,899.75 × 3% = 356.99. Net 16,542.76.'
		],
		[leave('w', 'CHILDCARE_LEAVE', '2026-01-06', '2026-01-07')],
		{
			gross: 21750,
			BASIC: 21750,
			total_deductions: 5207.24,
			net: 16542.76,
			'IIT.employee': 356.99
		},
		{
			gender: 'FEMALE',
			children: [{ child_birthdate: '2024-06-01', relationship: 'CHILD', citizenship: 'CITIZEN' }]
		}
	),
	{
		id: 'CN-KM28-1',
		profile: 'CN-kunming',
		description:
			'A worker the employer has not yet enrolled, January 2026, 10,000 declared: pension, unemployment and injury are still assessed in full; enrolment cannot be waived.',
		citation: [
			'Social Insurance Law arts.10, 44, 33 (compulsory enrolment; CN-N07) and the county HRSS notice (https://www.yncxym.gov.cn/info/1011/286437.htm; CN-KM28): probation, a waiver or a pending registration do not excuse the premiums.',
			'Same figures as CN-KM-WP09-1: pension 800 / 1,600, medical 200 / 700, maternity 90, unemployment 30 / 70, injury 20, fund 1,200 / 1,200, IIT 83.10; net 7,686.90; employer 3,680.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'ma',
				name: 'Ma Lin',
				wage: 10000,
				pensionStatus: {
					kind: 'NOT_REGISTERED',
					reason: 'Enrolment with the Kunming agency pending; the premiums are still due',
					declaration_reference: 'PROBE-KM28-PENDING',
					elections: { contribution_base: 10000 }
				}
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'ma_job',
				lines: {
					gross: 10000,
					total_deductions: 2313.1,
					net: 7686.9,
					employer_cost: 3680,
					'PENSION.employee': 800,
					'PENSION.employer': 1600,
					'MEDICAL.employee': 200,
					'MEDICAL.employer': 700,
					'MATERNITY.employer': 90,
					'UNEMPLOYMENT.employee': 30,
					'UNEMPLOYMENT.employer': 70,
					'INJURY.employer': 20,
					'HOUSING_FUND.employee': 1200,
					'HOUSING_FUND.employer': 1200,
					'IIT.employee': 83.1
				}
			}
		]
	}
);

// ─────────────────────────── Round 9 (30 Sep 2026): branches the register named as unproven ───────────

const MIN_WAGE_2025 =
	'云人社发〔2025〕19号 (https://www.ynjc.gov.cn/u/cms/jcqzfxxgk/202509/30130601xbad.pdf): from 1 October 2025 Wuhua (class I) CNY2,170 a month, gross including the worker’s insurance and fund (CN-KM01); 最低工资规定 (MOLSS Order 21) art.12 and 昆明市工资支付条例 art.8 forbid paying below it (CN-KM-WP03, CN-N50)';
const PAID_LEAVE =
	'昆明市工资支付条例 (https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=67457) and 工资支付暂行规定 art.11 (https://www.mohrss.gov.cn/xxgk2020/gzk/gz/202112/t20211228_431557.html): statutory leave is paid at the normal wage (CN-KM-WP12)';
const JAN_21750_IIT =
	'IIT: 21,750 − 4,850.25 − 5,000 = 11,899.75 × 3% = 356.9925 → 356.99. Net 21,750 − 5,207.24 = 16,542.76.';
const JAN_21750_PAID = {
	gross: 21750,
	BASIC: 21750,
	total_deductions: 5207.24,
	net: 16542.76,
	'IIT.employee': 356.99
};

/** One Wuhua worker's floor case: the run must be refused below the version's minimum wage. */
const belowFloor = (
	id: string,
	description: string,
	citation: string[],
	period: string,
	wage: number,
	refused: string
): ProbeCase => ({
	id,
	profile: 'CN-kunming',
	description,
	citation,
	company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
	inputs: [
		...officeWeek(SINCE),
		...worker({ ref: 'low', name: `Floor ${id}`, wage, siBase: 2300, hfBase: 2300 })
	],
	period,
	refused,
	expected: []
});

register(
	belowFloor(
		'CN-KM01-2',
		'January 2026, a Wuhua (class I) worker contracted at CNY2,100, under the 2,170 class I minimum: the run is refused.',
		[
			MIN_WAGE_2025,
			'2,100 < 2,170. Declared bases 2,300 (above both fund floors) so only the wage floor is in question.'
		],
		'2026-01',
		2100,
		'MINIMUM_WAGE_BELOW: P-KM-low is contracted at 2100 a month'
	),
	belowFloor(
		'CN-KM02-2',
		'September 2026, a Wuhua worker still contracted at CNY2,170 (the class I minimum to 31 August): under the new 2,270 minimum from 1 September, the run is refused.',
		[
			'Yunnan HRSS 29 Aug 2026 (https://www.ynjc.gov.cn/jcqzfxxgk/zcw2023j0221/20260901/1677677.html): from 1 September 2026 category I CNY2,270 (CN-KM02); 2,170 < 2,270',
			'Declared bases 2,300 (at or above the 2,270 fund floor) so only the wage floor is in question.'
		],
		'2026-09',
		2170,
		'MINIMUM_WAGE_BELOW: P-KM-low is contracted at 2170 a month'
	),
	{
		id: 'CN-KM01-3',
		profile: 'CN-kunming',
		description:
			'January 2026, a Wuhua (class I) worker at exactly the class I minimum CNY2,170 with a 5% fund on the class I floor: the run passes (against CN-KM01-2 at 2,100, refused).',
		citation: [
			MIN_WAGE_2025,
			'Insurance floors as CN-KM25-1: pension 704.48 / 352.24, medical 304.99 / 87.14, maternity 39.21, unemployment 30.82 / 13.21, injury 8.81.',
			'Fund class I floor 2,170 (CN-KM05) × 5% = 108.50 → 109 each side (四舍五入, CN-KM20).',
			'IIT nil. Net 2,170 − 561.59 = 1,608.41; employer 704.48 + 304.99 + 39.21 + 30.82 + 8.81 + 109 = 1,197.31.'
		],
		company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
		inputs: [...officeWeek(SINCE), ...worker({ ref: 'qi', name: 'Qi Yun', wage: 2170 })],
		period: '2026-01',
		expected: [
			{
				employment: 'qi_job',
				lines: {
					gross: 2170,
					total_deductions: 561.59,
					net: 1608.41,
					employer_cost: 1197.31,
					'PENSION.employee': 352.24,
					'PENSION.employer': 704.48,
					'MEDICAL.employee': 87.14,
					'MEDICAL.employer': 304.99,
					'MATERNITY.employer': 39.21,
					'UNEMPLOYMENT.employee': 13.21,
					'UNEMPLOYMENT.employer': 30.82,
					'INJURY.employer': 8.81,
					'HOUSING_FUND.employee': 109,
					'HOUSING_FUND.employer': 109
				}
			}
		]
	},
	{
		id: 'CN-KM-WP06-1',
		profile: 'CN-kunming',
		description:
			'January 2026, two Wuhua workers on 21,750 resign: on Thursday 15 January (final pay due Thursday 22 January) and on Tuesday 27 January (due Tuesday 3 February). The month-end run is late for the first only, and says so.',
		citation: [
			'昆明市工资支付条例 art.13 (https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=67457): wages paid in one sum within five working days of the end of the relationship (CN-KM-WP06). The run pays on 31 January: 22 January has passed, 3 February has not.',
			'Pay: 21,750 ÷ 21.75 per working day (CN-N02 recorded default; no company holiday recorded): 1–15 January 11 days = 11,000; 1–27 January 19 days = 19,000.',
			'Insurance and fund for the month on the declared 21,750 (4,850.25 / 8,004, as every jan21750 case). A resignation (LCL art.37) owes no compensation.',
			'IIT: 11,000 − 4,850.25 − 5,000 = 1,149.75 × 3% = 34.4925 → 34.49; 19,000 − 4,850.25 − 5,000 = 9,149.75 × 3% = 274.4925 → 274.49. Net 11,000 − 4,884.74 = 6,115.26 and 19,000 − 5,124.74 = 13,875.26.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...(
				[
					['mid', '2026-01-15'],
					['late', '2026-01-27']
				] as const
			).flatMap(([ref, to]) =>
				worker({
					ref,
					name: `Leaver ${ref}`,
					wage: 21750,
					to,
					employment: {
						exit_ground: 'RESIGNATION',
						exit_facts: { lcl_termination_ground: 'ART_37', renewal_offer_refused: false }
					}
				})
			)
		],
		period: '2026-01',
		warnings: ['FINAL_PAY_LATE: P-KM-mid left on 2026-01-15.*by 2026-01-22.*pays on 2026-01-31'],
		expected: [
			{
				employment: 'mid_job',
				lines: {
					...SI_21750,
					gross: 11000,
					BASIC: 11000,
					total_deductions: 4884.74,
					net: 6115.26,
					employer_cost: 8004,
					'IIT.employee': 34.49
				}
			},
			{
				employment: 'late_job',
				lines: {
					...SI_21750,
					gross: 19000,
					BASIC: 19000,
					total_deductions: 5124.74,
					net: 13875.26,
					employer_cost: 8004,
					'IIT.employee': 274.49
				}
			}
		]
	},
	jan21750(
		'CN-KM12-2',
		'Childcare leave (育儿假) for a mother of two children under three, Monday 5 – Monday 19 January 2026: eleven working days, above the one-child ten and within the fifteen; no deduction.',
		[
			'Yunnan Population and Family Planning Regulation art.18 para.2 (third amendment 17 Jan 2022, https://www.ynrd.gov.cn/html/2022/changweihuigonggao_0118/16355.html): each spouse 10 days a year while a child is under three, 5 more with two or more under three (CN-KM12); paid (CN-KM-WP12).',
			JAN_21750_IIT
		],
		[leave('w', 'CHILDCARE_LEAVE', '2026-01-05', '2026-01-19')],
		JAN_21750_PAID,
		{
			gender: 'FEMALE',
			children: [
				{ child_birthdate: '2024-06-01', relationship: 'CHILD', citizenship: 'CITIZEN' },
				{ child_birthdate: '2025-08-01', relationship: 'CHILD', citizenship: 'CITIZEN' }
			]
		}
	),
	{
		...jan21750(
			'CN-KM31-1',
			'An IUD inserted on Monday 12 January 2026: paid family-planning procedure leave Monday 12 – Friday 16 January with the certificate; no deduction.',
			[
				'Yunnan Population and Family Planning Regulation art.19 (https://www.ynrd.gov.cn/html/2022/changweihuigonggao_0118/16355.html): 放置宫内节育器 7 days of paid leave (CN-KM31); five working days are taken.',
				PAID_LEAVE,
				JAN_21750_IIT
			],
			[],
			JAN_21750_PAID,
			{ gender: 'FEMALE' }
		),
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'w', name: 'Worker CN-KM31-1', wage: 21750, gender: 'FEMALE' }),
			{
				...leave('w', 'FAMILY_PLANNING_PROCEDURE_LEAVE', '2026-01-12', '2026-01-16', {
					facts: {
						event_kind: 'IUD_INSERTION',
						event_date: '2026-01-12'
					}
				}),
				files: { certificate_file: 'iud-certificate.pdf' }
			}
		]
	},
	{
		...jan21750(
			'CN-KM-WP13-1',
			'Certified work-injury stop-work medical leave (停工留薪期), Monday 12 – Friday 16 January 2026, after a recognised injury on 9 January: the original wage continues; no deduction.',
			[
				'工伤保险条例 art.33 (https://xzfg.moj.gov.cn/front/law/detail?LawID=610): 在停工留薪期内，原工资福利待遇不变，由所在单位按月支付 (CN-N21, CN-KM-WP13; owner rule 2026-09-28: the contract wage continues).',
				JAN_21750_IIT
			],
			[],
			JAN_21750_PAID
		),
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'w', name: 'Worker CN-KM-WP13-1', wage: 21750 }),
			{
				...leave('w', 'WORK_INJURY_LEAVE', '2026-01-12', '2026-01-16', {
					facts: {
						event_kind: 'WORK_INJURY',
						event_date: '2026-01-09'
					}
				}),
				files: { certificate_file: 'injury-recognition.pdf' }
			}
		]
	},
	jan21750(
		'CN-KM-WP12-2',
		'Paid funeral leave for a parent’s death on Saturday 17 January 2026: Monday 19 – Wednesday 21 January, no deduction.',
		[
			'国劳总薪字〔1980〕29号 item 1 (one to three days for a parent, the spouse or a child; the seed grants 3, owner rule 2026-09-28, CN-N51) and 工资支付暂行规定 art.11 (https://www.mohrss.gov.cn/xxgk2020/gzk/gz/202112/t20211228_431557.html): paid at the contract standard (CN-KM-WP12).',
			JAN_21750_IIT
		],
		[
			leave('w', 'FUNERAL_LEAVE', '2026-01-19', '2026-01-21', {
				facts: {
					event_kind: 'DEATH',
					event_relationship: 'PARENT',
					event_date: '2026-01-17'
				}
			})
		],
		JAN_21750_PAID
	),
	jan21750(
		'CN-KM-WP08-4',
		'Rest-day work with compensatory rest arranged: Sunday 11 January 2026, three hours; no premium is paid.',
		[
			'Labour Law art.44(2) (https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html): 休息日安排劳动者工作又不能安排补休的 at no less than 200% — where compensatory rest is arranged, no premium (CN-KM-WP08, CN-N01, CN-N40).',
			JAN_21750_IIT
		],
		[
			{
				collection: 'work_days',
				values: {
					employment_id: '@w_job',
					work_date: '2026-01-11',
					worked_intervals: [
						{ start: '2026-01-11T09:00:00+08:00', end: '2026-01-11T12:00:00+08:00' }
					],
					approved_overtime_hours: 3,
					time_off_in_lieu: true
				}
			}
		],
		JAN_21750_PAID
	),
	{
		id: 'CN-KM26-1',
		profile: 'CN-kunming',
		description:
			'January 2026, a Wuhua unit the agency assigned to industry class VIII (1.9%): work injury on a 10,000 base is 190, employer-only; every other line as CN-KM-WP09-1.',
		citation: [
			'云人社发〔2020〕14号 (https://hrss.yn.gov.cn/Uploads/NewsPhoto/2020-03-12/b451dfd4-ba60-48d9-931e-2bed943dcef0.pdf) and the county notice (https://www.yncxym.gov.cn/info/1011/286437.htm): classes I–VIII at 0.2–1.9%, employer-only, the assigned rate recorded as `injury_rate` (CN-KM26): 10,000 × 1.9% = 190.',
			'As CN-KM-WP09-1: pension 800 / 1,600, medical 200 / 700, maternity 90, unemployment 30 / 70, fund 1,200 / 1,200, IIT 83.10; net 7,686.90; employer 1,600 + 700 + 90 + 70 + 190 + 1,200 = 3,850.'
		],
		company: { facts: { ...FACTS_2026, injury_rate: 1.9 } },
		inputs: [...officeWeek(SINCE), ...worker({ ref: 'li', name: 'Li Qiang', wage: 10000 })],
		period: '2026-01',
		expected: [
			{
				employment: 'li_job',
				lines: {
					gross: 10000,
					total_deductions: 2313.1,
					net: 7686.9,
					employer_cost: 3850,
					'PENSION.employee': 800,
					'PENSION.employer': 1600,
					'MEDICAL.employee': 200,
					'MEDICAL.employer': 700,
					'MATERNITY.employer': 90,
					'UNEMPLOYMENT.employee': 30,
					'UNEMPLOYMENT.employer': 70,
					'INJURY.employer': 190,
					'HOUSING_FUND.employee': 1200,
					'HOUSING_FUND.employer': 1200,
					'IIT.employee': 83.1
				}
			}
		]
	},
	{
		id: 'CN-KM-A1-2',
		profile: 'CN-kunming',
		description:
			'The CN-KM-A1-1 non-resident is paid a 60,000 multi-month bonus in January 2026 and another in February: the six-month method is once per non-resident per calendar year, so the February run is refused.',
		citation: [
			'MOF/STA 2019 No.35 item 3(2) (https://fgk.chinatax.gov.cn/zcfgk/c102416/c5202332/content.html): 在一个公历年度内，对每一个非居民个人，该计税办法只允许适用一次 (CN-KM-A1).'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'tom',
				name: 'Tom Becker',
				wage: 30000,
				citizenship: 'FOREIGNER',
				taxResidency: 'NON_RESIDENT',
				nationality: 'German',
				hf: { voluntary_agreement: false }
			}),
			adhoc('tom', 'ANNUAL_BONUS_SEPARATE', 60000, '2026-01-20', 'Bonus for July–December 2025'),
			{
				collection: 'payroll_runs',
				values: { company_id: '@company', period: '2026-01' }
			},
			adhoc('tom', 'ANNUAL_BONUS_SEPARATE', 60000, '2026-02-20', 'Second multi-month bonus')
		],
		period: '2026-02',
		refused: 'once per tax year',
		expected: []
	},
	{
		id: 'CN-KM20-2',
		profile: 'CN-kunming',
		description:
			'The CN-KM20-1 first-ever fund account (hired Monday 19 January 2026 at 21,750) in February, its second month: the fund now charges 12% of the month’s full wage; January runs first.',
		citation: [
			'Fund: a first-ever contributor starts in the second month on that month’s full wage (昆公积金规〔2020〕2号 arts.10–14, https://zc.51shebao.com/detail/825467; CN-KM20): 21,750 × 12% = 2,610 each side.',
			'Insurance on the declared 21,750 as SI_21750. January (CN-KM20-1): 10,000 paid, 2,240.25 employee insurance, IIT 82.79.',
			'IIT February cumulative (STA 2018 No.61 art.6): 31,750 − (2,240.25 + 4,850.25) − 10,000 = 14,659.50 × 3% = 439.785 → 439.79 − 82.79 = 357.00. Net 21,750 − 5,207.25 = 16,542.75; employer 8,004.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'zhou',
				name: 'Zhou Min',
				wage: 21750,
				from: '2026-01-19',
				hfBase: 21750,
				hf: { first_ever_account: true }
			}),
			{
				collection: 'payroll_runs',
				values: { company_id: '@company', period: '2026-01' }
			}
		],
		period: '2026-02',
		expected: [
			{
				employment: 'zhou_job',
				lines: {
					...SI_21750,
					gross: 21750,
					BASIC: 21750,
					total_deductions: 5207.25,
					net: 16542.75,
					employer_cost: 8004,
					'IIT.employee': 357
				}
			}
		]
	},
	{
		id: 'CN-KM32-1',
		profile: 'CN-kunming',
		description:
			'August 2026, a Wuhua worker on 12,000 (in service since June 2025) gives birth on Monday 3 August and is on paid maternity leave all of August’s working days; the fund paid her a 9,000 allowance for them, which comes off the leave wage and the employer tops up to the wage: gross 3,000.',
		citation: [
			'女职工劳动保护特别规定 art.7 (https://xzfg.moj.gov.cn/mobile/law/detail?LawID=343) with the Yunnan regulation (158 days, CN-N20, CN-KM12): 3 August 2026 – 7 January 2027.',
			'Kunming maternity rules (https://ybj.km.gov.cn/c/2024-07-25/4882692.shtml) item 2: the allowance is the fund’s benefit to her; recorded with its evidence. Owner rule 2026-09-28 (Yunnan silent on a shortfall): the employer tops up to the wage, lawful under 女职工劳动保护特别规定 art.5: 12,000 − 9,000 = 3,000 (CN-KM32).',
			'Insurance continues on the declared 12,000 (medical on the 2025 bounds to 31 August): pension 960 / 1,920, medical 240 / 840, maternity 108, unemployment 36 / 84, injury 24, fund 12% 1,440 each side.',
			'The allowance is exempt (财税〔2008〕8号): IIT on 3,000 − 2,676 is nil. Net 3,000 − 2,676 = 324; employer 1,920 + 840 + 108 + 84 + 24 + 1,440 = 4,416.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'xu', name: 'Xu Ying', wage: 12000, gender: 'FEMALE' }),
			leave('xu', 'MATERNITY_LEAVE', '2026-08-03', '2027-01-07', {
				facts: {
					event_kind: 'BIRTH',
					event_date: '2026-08-03'
				}
			}),
			{
				...adhoc(
					'xu',
					'MATERNITY_ALLOWANCE_OFFSET',
					9000,
					'2026-08-31',
					'生育津贴 paid by the fund'
				),
				files: { evidence_file: 'maternity-allowance-notice.pdf' }
			}
		],
		period: '2026-08',
		expected: [
			{
				employment: 'xu_job',
				lines: {
					gross: 3000,
					total_deductions: 2676,
					net: 324,
					employer_cost: 4416,
					'PENSION.employee': 960,
					'PENSION.employer': 1920,
					'MEDICAL.employee': 240,
					'MEDICAL.employer': 840,
					'MATERNITY.employer': 108,
					'UNEMPLOYMENT.employee': 36,
					'UNEMPLOYMENT.employer': 84,
					'INJURY.employer': 24,
					'HOUSING_FUND.employee': 1440,
					'HOUSING_FUND.employer': 1440
				}
			}
		]
	}
);

// ─────────────────────────── Round 9b (30 Sep 2026): further branches the register named as unproven ──

const LCL =
	'Labour Contract Law (https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html, re-read 30 Sep 2026)';

/** The CN-KM-WP09-2 leaver (hired Monday 5 January 2026, out Friday 16 January, 21,750) on another LCL ground. */
const leaverOn = (
	id: string,
	description: string,
	citation: string[],
	facts: Row,
	severance: number,
	net: number
): ProbeCase => ({
	id,
	profile: 'CN-kunming',
	description,
	citation,
	company: { facts: FACTS_2026 },
	inputs: [
		...officeWeek(SINCE),
		...worker({
			ref: 'wu',
			name: `Leaver ${id}`,
			wage: 21750,
			from: '2026-01-05',
			to: '2026-01-16',
			employment: {
				exit_ground: 'DISMISSAL',
				exit_facts: { renewal_offer_refused: false, ...facts }
			}
		}),
		adhoc('wu', 'SEVERANCE_PAY', 0, '2026-01-16', id)
	],
	period: '2026-01',
	expected: [
		{
			employment: 'wu_job',
			lines: {
				...SI_21750,
				gross: 10000 + severance,
				BASIC: 10000,
				SEVERANCE_PAY: severance,
				total_deductions: 4854.74,
				net,
				employer_cost: 8004,
				'IIT.employee': 4.49
			}
		}
	]
});

const WP09_2_WAGE =
	'Final pay 21,750 ÷ 21.75 × 10 working days = 10,000 (CN-N02); insurance and fund on the declared 21,750 (4,850.25 / 8,004); IIT on the wage 10,000 − 4,850.25 − 5,000 = 149.75 × 3% = 4.49; the compensation is inside the 财税〔2018〕164号 item 5(1) exemption 3 × 130,174 = 390,522 (http://szs.mof.gov.cn/zhengcefabu/201812/t20181227_3110164.htm): no IIT_SEVERANCE.';

register(
	{
		...jan21750(
			'CN-N40-1',
			'Labour Law art.41 on the production path, January 2026: approving 4 extended hours on one day is refused (3 a day); twelve weekdays of 3 approved hours reach the 36-hour month, and a thirteenth approval is refused. The 36 approved hours are paid at 150%.',
			[
				'Labour Law art.41 (https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html): 延长工作时间一般每日不得超过一小时；因特殊原因…每日不得超过三小时，但是每月不得超过三十六小时 (seeded `daily_ot` 3, `monthly_ot` 36; CN-N40). The work-day write refuses approved overtime above the headroom (the schedule gate).',
				'Labour Law art.44(1): 150% of the 21.75-day hour 21,750 ÷ 21.75 ÷ 8 = 125 (CN-N02): 36 × 187.50 = 6,750.',
				'IIT: 28,500 − 4,850.25 − 5,000 = 18,649.75 × 3% = 559.4925 → 559.49. Net 28,500 − 5,409.74 = 23,090.26.'
			],
			[],
			{
				gross: 28500,
				BASIC: 21750,
				OVERTIME: 6750,
				total_deductions: 5409.74,
				net: 23090.26,
				'IIT.employee': 559.49
			}
		),
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'w', name: 'Worker CN-N40-1', wage: 21750 }),
			{
				...punch(
					'w',
					'2026-01-05',
					[
						['09:00', '13:00'],
						['14:00', '22:00']
					],
					4
				),
				refused:
					'is refused: 2026-01-05 would hold 4 h of approved overtime, above the 3 h left within the 3-hour limit "daily_ot"'
			},
			...['05', '06', '07', '08', '09', '12', '13', '14', '15', '16', '19', '20'].map((day) =>
				punch(
					'w',
					`2026-01-${day}`,
					[
						['09:00', '13:00'],
						['14:00', '21:00']
					],
					3
				)
			),
			{
				...punch(
					'w',
					'2026-01-21',
					[
						['09:00', '13:00'],
						['14:00', '21:00']
					],
					3
				),
				refused:
					'is refused: 2026-01-21 would hold 3 h of approved overtime, above the 0 h left within the 36-hour limit "monthly_ot"'
			}
		]
	},
	{
		id: 'CN-KM03-3',
		profile: 'CN-kunming',
		description:
			'September 2026, the medical and maternity ceiling moves to 22,017: a Wuhua worker transferred in on Tuesday 1 September at 30,000 (fund base 40,000) is insured at 22,017 for every scheme and the fund at the 32,543 cap.',
		citation: [
			'云人社发〔2026〕8号 (https://www.yn.gov.cn/hdjl/msgq/202608/t20260829_330317.html; returned 404 on 30 Sep 2026, figures as read 29 Sep 2026): medical and maternity on 4,403–22,017 from 1 September 2026 (CN-KM03); pension, unemployment and injury on the same 2026 bounds (county notice, https://www.yncxym.gov.cn/info/1011/286437.htm).',
			'Pension 22,017 × 16% / 8% = 3,522.72 / 1,761.36; medical × 7% = 1,541.19, × 2% = 440.34; maternity × 0.9% = 198.153 → 198.15; unemployment × 0.7% = 154.119 → 154.12, × 0.3% = 66.051 → 66.05; injury × 0.2% = 44.034 → 44.03 (CN-KM04, KM25–27, KM32).',
			'Fund: a transferred account contributes from the first month (昆公积金规〔2020〕2号 art.12, CN-KM20); 40,000 capped at 32,543 (CN-KM05) × 12% = 3,905.16 → 3,905 each side.',
			'IIT (month 1 here, STA 2018 No.61 art.6): 30,000 − 6,172.75 − 5,000 = 18,827.25 × 3% = 564.8175 → 564.82. Net 30,000 − 6,737.57 = 23,262.43; employer 9,365.21.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'gao',
				name: 'Gao Peng',
				wage: 30000,
				hfBase: 40000,
				from: '2026-09-01',
				hf: { first_ever_account: false }
			})
		],
		period: '2026-09',
		expected: [
			{
				employment: 'gao_job',
				lines: {
					gross: 30000,
					total_deductions: 6737.57,
					net: 23262.43,
					employer_cost: 9365.21,
					'PENSION.employee': 1761.36,
					'PENSION.employer': 3522.72,
					'MEDICAL.employee': 440.34,
					'MEDICAL.employer': 1541.19,
					'MATERNITY.employer': 198.15,
					'UNEMPLOYMENT.employee': 66.05,
					'UNEMPLOYMENT.employer': 154.12,
					'INJURY.employer': 44.03,
					'HOUSING_FUND.employee': 3905,
					'HOUSING_FUND.employer': 3905,
					'IIT.employee': 564.82
				}
			}
		]
	},
	{
		id: 'CN-KM02-3',
		profile: 'CN-kunming',
		description:
			'September 2026, a Fumin (category II) worker contracted at CNY2,100 — above the old 2,020, below the new category II 2,120: the run is refused.',
		citation: [
			'Yunnan HRSS 29 Aug 2026 (https://www.ynjc.gov.cn/jcqzfxxgk/zcw2023j0221/20260901/1677677.html): from 1 September 2026 category II CNY2,120 (CN-KM02); 最低工资规定 art.12 and 昆明市工资支付条例 art.8 (CN-KM-WP03): 2,100 < 2,120.',
			'Declared bases 2,300 (above the 2,120 fund floor) so only the wage floor is in question.'
		],
		company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'low',
				name: 'Floor CN-KM02-3',
				wage: 2100,
				siBase: 2300,
				hfBase: 2300,
				worksite: FUMIN
			})
		],
		period: '2026-09',
		refused: 'MINIMUM_WAGE_BELOW: P-KM-low is contracted at 2100 a month',
		expected: []
	},
	jan21750(
		'CN-KM12-3',
		'Childcare leave asked on Tuesday 6 – Wednesday 7 January 2026 by a parent whose only child turned three on 1 December 2025: refused (under three only); the month is paid in full.',
		[
			'Yunnan Population and Family Planning Regulation art.18 (https://www.ynrd.gov.cn/html/2022/changweihuigonggao_0118/16355.html, re-read 30 Sep 2026): 子女不满3周岁的…每年累计10天的育儿假 (CN-KM12).',
			JAN_21750_IIT
		],
		[
			{
				...leave('w', 'CHILDCARE_LEAVE', '2026-01-06', '2026-01-07'),
				refused: 'Leave on 2026-01-06 cannot be approved: INELIGIBLE\\.'
			}
		],
		JAN_21750_PAID,
		{
			gender: 'FEMALE',
			children: [{ child_birthdate: '2022-12-01', relationship: 'CHILD', citizenship: 'CITIZEN' }]
		}
	),
	jan21750(
		'CN-KM12-4',
		'Childcare leave for one child under three, Monday 5 – Monday 19 January 2026: eleven working days against the one-child ten: refused (against CN-KM12-2, fifteen for two children).',
		[
			'Yunnan Population and Family Planning Regulation art.18 (https://www.ynrd.gov.cn/html/2022/changweihuigonggao_0118/16355.html, re-read 30 Sep 2026): 每年累计10天; 5 more only with two or more under three (CN-KM12).',
			JAN_21750_IIT
		],
		[
			{
				...leave('w', 'CHILDCARE_LEAVE', '2026-01-05', '2026-01-19'),
				refused: 'Insufficient leave in .*: 1 more days are needed'
			}
		],
		JAN_21750_PAID,
		{
			gender: 'FEMALE',
			children: [{ child_birthdate: '2024-06-01', relationship: 'CHILD', citizenship: 'CITIZEN' }]
		}
	),
	leaverOn(
		'CN-N41-1',
		'The CN-KM-WP09-2 leaver dismissed under LCL art.40 with no written notice: half a month’s 经济补偿 plus one month’s wage in lieu of notice.',
		[
			`${LCL} art.40: 提前三十日以书面形式通知…或者额外支付劳动者一个月工资; art.46(3) and art.47: under six months is half a month. Implementing Regulation art.20 (https://xzfg.moj.gov.cn/front/law/detail?LawID=284): the extra month at the previous month’s wage — the contract month 21,750 for a leaver hired in the exit month (CN-SH-A2 recorded default). 0.5 × 21,750 + 21,750 = 32,625 (CN-N12, CN-N41).`,
			WP09_2_WAGE
		],
		{ lcl_termination_ground: 'ART_40', notice_days_given: 0 },
		32625,
		37770.26 // 42,625 − 4,854.74
	),
	leaverOn(
		'CN-N41-2',
		'The CN-KM-WP09-2 leaver unlawfully dismissed: damages at twice the art.47 compensation.',
		[
			`${LCL} art.87: 依照本法第四十七条规定的经济补偿标准的二倍向劳动者支付赔偿金; art.47 half a month under six months on the contract month 21,750 (CN-SH-A2): 2 × 0.5 × 21,750 = 21,750 (CN-N12, CN-N41).`,
			WP09_2_WAGE
		],
		{ lcl_termination_ground: 'ART_87' },
		21750,
		26895.26 // 31,750 − 4,854.74
	),
	jan21750(
		'CN-N54-2',
		'A Kunming resident declares CNY1,500 of housing rent for January 2026: the provincial-capital standard, deducted in full.',
		[
			'国发〔2018〕41号, housing-rent article: CNY1,500 a month in municipalities and provincial capitals (Kunming is the capital of Yunnan; CN-N54; unchanged by 2023 No.14, which raised only the child, infant and elderly standards); the agent deducts as declared within the standard (STA 2022 No.7 arts.25–26, CN-N16).',
			'IIT: 21,750 − 4,850.25 − 5,000 − 1,500 = 10,399.75 × 3% = 311.9925 → 311.99. Net 21,750 − 5,162.24 = 16,587.76.'
		],
		[
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@w',
					employment_id: '@w_job',
					statutory_contribution_id: '@law:statutory_contributions:IIT',
					effective_range: { from: SINCE, to: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'PROBE-IIT-w',
						deduction_claims: [
							{
								period: '2026-01',
								category: 'HOUSING_RENT',
								amount: 1500,
								source: 'EMPLOYEE',
								reference: 'RENT-2026-01'
							}
						]
					}
				}
			}
		],
		{ gross: 21750, BASIC: 21750, total_deductions: 5162.24, net: 16587.76, 'IIT.employee': 311.99 }
	)
);

// ─────────────────────────── Round 10 (30 Sep 2026): exempt receipts, deductions, early retirement, fund floors ──

const iit = (claims: Row[]): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: '@w',
		employment_id: '@w_job',
		statutory_contribution_id: '@law:statutory_contributions:IIT',
		effective_range: { from: SINCE, to: null },
		status: { kind: 'REGISTERED', reference_number: 'PROBE-IIT-w', deduction_claims: claims }
	}
});

/** One Wuhua worker on 10,000 whose run the housing-fund scheme must refuse. */
const fundRefused = (
	id: string,
	description: string,
	citation: string[],
	w: Partial<Worker>,
	refused: string
): ProbeCase => ({
	id,
	profile: 'CN-kunming',
	description,
	citation,
	company: { facts: FACTS_2026 },
	inputs: [...officeWeek(SINCE), ...worker({ ref: 'hf', name: `Fund ${id}`, wage: 10000, ...w })],
	period: '2026-01',
	refused,
	expected: []
});

register(
	jan21750(
		'CN-N55-2',
		'January 2026, the 21,750 Kunming worker is also paid 独生子女补贴 100, 托儿补助费 200, 差旅费津贴 300 and 误餐补助 50: all paid, none in the IIT base.',
		[
			'国税发〔1994〕89号 item 2 (https://fgk.chinatax.gov.cn/zcfgk/c100011/c5216297/content.html): these four are 不属于工资、薪金性质的补贴、津贴, 不征税 (CN-N55); travel and meal carry their evidence.',
			'IIT on the wage alone: 21,750 − 4,850.25 − 5,000 = 11,899.75 × 3% = 356.9925 → 356.99. Gross 22,400; net 22,400 − 5,207.24 = 17,192.76.'
		],
		[
			adhoc('w', 'ONE_CHILD_SUBSIDY', 100, '2026-01-10', 'CN-N55-2'),
			adhoc('w', 'CHILDCARE_SUBSIDY', 200, '2026-01-10', 'CN-N55-2'),
			{
				...adhoc('w', 'TRAVEL_ALLOWANCE', 300, '2026-01-10', 'CN-N55-2'),
				files: { evidence_file: 'trip-record.pdf' }
			},
			{
				...adhoc('w', 'MISSED_MEAL_SUBSIDY', 50, '2026-01-10', 'CN-N55-2'),
				files: { evidence_file: 'meal-record.pdf' }
			}
		],
		{
			gross: 22400,
			BASIC: 21750,
			ONE_CHILD_SUBSIDY: 100,
			CHILDCARE_SUBSIDY: 200,
			TRAVEL_ALLOWANCE: 300,
			MISSED_MEAL_SUBSIDY: 50,
			total_deductions: 5207.24,
			net: 17192.76,
			'IIT.employee': 356.99
		}
	),
	jan21750(
		'CN-N16-2',
		'January 2026, a Kunming resident declares 3岁以下婴幼儿照护 for one child (2,000) and 学历继续教育 (400): both deducted as declared.',
		[
			'MOF/STA 2023 No.14 (https://fgk.chinatax.gov.cn/zcfgk/c100012/c5213592/content.html, re-read 30 Sep 2026): 3岁以下婴幼儿照护 每个婴幼儿每月2000元 from 1 January 2023; 国发〔2018〕41号 (continuing-education article): 学历（学位）继续教育 每月400元定额扣除; the agent deducts as declared (STA 2022 No.7 arts.25–26; CN-N16).',
			'IIT: 21,750 − 4,850.25 − 5,000 − 2,000 − 400 = 9,499.75 × 3% = 284.9925 → 284.99. Net 21,750 − 5,135.24 = 16,614.76.'
		],
		[
			iit([
				{
					period: '2026-01',
					category: 'INFANT_CARE',
					amount: 2000,
					source: 'EMPLOYEE',
					reference: 'INFANT-2026-01'
				},
				{
					period: '2026-01',
					category: 'CONTINUING_EDUCATION',
					amount: 400,
					source: 'EMPLOYEE',
					reference: 'EDU-2026-01'
				}
			])
		],
		{ gross: 21750, BASIC: 21750, total_deductions: 5135.24, net: 16614.76, 'IIT.employee': 284.99 }
	),
	{
		id: 'CN-N39-2',
		profile: 'CN-kunming',
		description:
			'A Kunming worker (21,750, hired Monday 5 January 2026) takes approved early retirement on Friday 16 January with a CNY500,000 one-off subsidy, four actual years before statutory age: the subsidy is spread over the four years and taxed alone.',
		citation: [
			'财税〔2018〕164号 item 5(2) (STA copy https://fgk.chinatax.gov.cn/zcfgk/c102416/c5202364/content.html, re-read 30 Sep 2026): 应纳税额＝{［（一次性补贴收入÷办理提前退休手续至法定退休年龄的实际年度数）－费用扣除标准］×适用税率－速算扣除数}×实际年度数, 单独适用综合所得税率表; 费用扣除标准 60,000 (IIT Law art.6(1)): (500,000 ÷ 4 − 60,000) = 65,000 × 10% − 2,520 = 3,980 × 4 = 15,920 (IIT_EARLY_RETIREMENT; the years are the recorded exit fact iit164_early_retirement_years, CN-N39).',
			'Final pay 21,750 ÷ 21.75 × 10 working days = 10,000 (CN-N02); insurance and fund on the declared 21,750 (4,850.25 / 8,004); IIT on the wage 10,000 − 4,850.25 − 5,000 = 149.75 × 3% = 4.49.',
			'Gross 510,000; deductions 4,850.25 + 4.49 + 15,920 = 20,774.74; net 489,225.26.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 're',
				name: 'Early Retiree',
				wage: 21750,
				from: '2026-01-05',
				to: '2026-01-16',
				employment: {
					exit_ground: 'RETIREMENT',
					exit_facts: { lcl_termination_ground: 'ART_44_2_3', iit164_early_retirement_years: 4 }
				}
			}),
			adhoc('re', 'EARLY_RETIREMENT_SUBSIDY', 500000, '2026-01-16', 'CN-N39-2')
		],
		period: '2026-01',
		expected: [
			{
				employment: 're_job',
				lines: {
					...SI_21750,
					gross: 510000,
					BASIC: 10000,
					EARLY_RETIREMENT_SUBSIDY: 500000,
					total_deductions: 20774.74,
					net: 489225.26,
					employer_cost: 8004,
					'IIT.employee': 4.49,
					'IIT_EARLY_RETIREMENT.employee': 15920
				}
			}
		]
	},
	fundRefused(
		'CN-KM05-1',
		'January 2026, a Wuhua worker declares a housing-fund base of 2,100, under the class I floor 2,170, and the floor of an unchanged account is unsettled: the run is refused.',
		[
			'Kunming fund centre interim notice of 4 January 2026 (https://zfgjj.km.gov.cn/c/2026-01-04/5047947.shtml): floor 2,170 (category I) / 2,020 pending the final 2026 data; the floor of an unchanged existing account is not stated, so a base below it refuses rather than guessing (CN-KM05).'
		],
		{ hfBase: 2100 },
		'The declared housing-fund base is below the published floor'
	),
	fundRefused(
		'CN-KM05-2',
		'January 2026, a worker at the Mo Han worksite (category III): the fund-centre category III floor is not authenticated, so the housing-fund charge refuses the run.',
		[
			'Mo Han–Mo Ding category III wage floor 1,870 (云人社发〔2025〕19号 appendix, https://www.ynjc.gov.cn/u/cms/jcqzfxxgk/202509/30130601xbad.pdf; CN-KM01) — 10,000 clears it; the fund floor rests only on centre-attributed reproductions (CN-KM05), so the seeded rule refuses until the issuer notice is read.'
		],
		{ worksite: '云南省/西双版纳傣族自治州/勐腊县/磨憨镇' },
		'Mo Han housing-fund category-III floor'
	)
);

// ─────────────────────────── Round 11 (30 Sep 2026): floors and qualifying pay without a probe ──

const MIN_WAGE_2026 =
	'Yunnan HRSS 29 Aug 2026 (https://www.ynjc.gov.cn/jcqzfxxgk/zcw2023j0221/20260901/1677677.html): from 1 September 2026 category I CNY2,270, gross including the worker’s insurance and fund but excluding overtime pay (CN-KM02); 最低工资规定 (MOLSS Order 21) art.12 forbids paying below it';
/** A floor case whose month also carries approved extended hours that would lift gross above the floor. */
const belowFloorWithOvertime = (
	id: string,
	description: string,
	citation: string[],
	period: string,
	wage: number,
	days: readonly string[],
	refused: string
): ProbeCase => {
	const base = belowFloor(id, description, citation, period, wage, refused);
	return {
		...base,
		inputs: [
			...base.inputs,
			...days.map((date) =>
				punch(
					'low',
					date,
					[
						['09:00', '13:00'],
						['14:00', '21:00']
					],
					3
				)
			)
		]
	};
};

register(
	{
		id: 'CN-KM03-4',
		profile: 'CN-kunming',
		description:
			'December 2025, a Wuhua worker hired Monday 1 December at CNY4,000: every insurance on the 2025 floor 4,357, the reduced 2025 unemployment rates, a 12% fund on the 4,000 wage.',
		citation: [
			'2025 base 4,357–21,789 (https://www.dhlc.gov.cn/fsx/Web/_F0_0_6C9DO9USE71563368BE04C9C90.htm; CN-KM03); unemployment 0.7% / 0.3% through 31 Dec 2025 (CN-KM27).',
			'Pension 4,357 × 16% / 8% = 697.12 / 348.56; medical × 7% = 304.99, × 2% = 87.14; maternity × 0.9% = 39.213 → 39.21; unemployment × 0.7% = 30.499 → 30.50, × 0.3% = 13.071 → 13.07; injury × 0.2% = 8.714 → 8.71 (fen half-up, CN-X-SI-ROUNDING).',
			'Fund 4,000 × 12% = 480 each side (above the 2,170 class I floor, CN-KM05).',
			'IIT (month 1 here): 4,000 − 928.77 − 5,000 < 0 → nothing. Net 4,000 − 928.77 = 3,071.23; employer 697.12 + 304.99 + 39.21 + 30.50 + 8.71 + 480 = 1,560.53.'
		],
		company: { facts: FACTS_2025 },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'fu', name: 'Fu Qiang', wage: 4000, from: '2025-12-01' })
		],
		period: '2025-12',
		expected: [
			{
				employment: 'fu_job',
				lines: {
					gross: 4000,
					total_deductions: 928.77,
					net: 3071.23,
					employer_cost: 1560.53,
					'PENSION.employee': 348.56,
					'PENSION.employer': 697.12,
					'MEDICAL.employee': 87.14,
					'MEDICAL.employer': 304.99,
					'MATERNITY.employer': 39.21,
					'UNEMPLOYMENT.employee': 13.07,
					'UNEMPLOYMENT.employer': 30.5,
					'INJURY.employer': 8.71,
					'HOUSING_FUND.employee': 480,
					'HOUSING_FUND.employer': 480
				}
			}
		]
	},
	{
		id: 'CN-KM05-3',
		profile: 'CN-kunming',
		description:
			'September 2026, a Fumin (class II) worker transferred in on Tuesday 1 September at CNY10,000 with a fund base declared at the new class II floor 2,120 and a 5% fund: 106 each side.',
		citation: [
			'New, transferred and reopened accounts from 1 September 2026: class I 2,270, class II 2,120 (CN-KM05; see the file header); 2,120 × 5% = 106 each side (昆公积金规〔2020〕2号 art.13, per side 四舍五入).',
			'Insurance on 10,000 inside 4,403–22,017: pension 800 / 1,600, medical 200 / 700, maternity 90, unemployment 30 / 70, injury 20.',
			'IIT (month 1 here): 10,000 − 1,136 − 5,000 = 3,864 × 3% = 115.92. Net 10,000 − 1,251.92 = 8,748.08; employer 1,600 + 700 + 90 + 70 + 20 + 106 = 2,586.'
		],
		company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
		inputs: [
			...officeWeek(SINCE),
			...worker({
				ref: 'fm',
				name: 'Fan Mei',
				gender: 'FEMALE',
				wage: 10000,
				hfBase: 2120,
				worksite: FUMIN,
				from: '2026-09-01',
				hf: { first_ever_account: false }
			})
		],
		period: '2026-09',
		expected: [
			{
				employment: 'fm_job',
				lines: {
					gross: 10000,
					total_deductions: 1251.92,
					net: 8748.08,
					employer_cost: 2586,
					'PENSION.employee': 800,
					'PENSION.employer': 1600,
					'MEDICAL.employee': 200,
					'MEDICAL.employer': 700,
					'MATERNITY.employer': 90,
					'UNEMPLOYMENT.employee': 30,
					'UNEMPLOYMENT.employer': 70,
					'INJURY.employer': 20,
					'HOUSING_FUND.employee': 106,
					'HOUSING_FUND.employer': 106,
					'IIT.employee': 115.92
				}
			}
		]
	},
	{
		...fundRefused(
			'CN-KM05-4',
			'September 2026, the CN-KM05-3 transfer declares a fund base of 2,100: above the old class II 2,020, below the new 2,120 — the run is refused.',
			[
				'New, transferred and reopened accounts from 1 September 2026: class II floor 2,120 (CN-KM05); 2,100 < 2,120.'
			],
			{ hfBase: 2100, worksite: FUMIN, from: '2026-09-01', hf: { first_ever_account: false } },
			'declared housing-fund base is below'
		),
		period: '2026-09'
	},
	belowFloorWithOvertime(
		'CN-KM01-4',
		'January 2026, a Wuhua worker contracted at CNY2,100 who works six approved extended hours (Tuesday 6 and Wednesday 7 January): with overtime gross would be 2,208.62, but overtime is outside the minimum-wage comparison — the run is refused.',
		[
			MIN_WAGE_2025,
			'云人社发〔2025〕19号 item on qualifying pay (CN-KM01): 延长工作时间工资 is excluded from the comparison. 2,100 ÷ 21.75 ÷ 8 × 1.5 × 6 = 108.62 (CN-N02); 2,100 < 2,170 on the contract wage alone.'
		],
		'2026-01',
		2100,
		['2026-01-06', '2026-01-07'],
		'MINIMUM_WAGE_BELOW: P-KM-low is contracted at 2100 a month'
	),
	belowFloorWithOvertime(
		'CN-KM02-4',
		'September 2026, a Wuhua worker contracted at CNY2,200 who works six approved extended hours (Tuesday 8 and Wednesday 9 September): with overtime gross would be 2,313.79, but overtime is outside the comparison — the run is refused against 2,270.',
		[
			MIN_WAGE_2026,
			'2,200 ÷ 21.75 ÷ 8 × 1.5 × 6 = 113.79 (CN-N02); 2,200 < 2,270 on the contract wage alone.'
		],
		'2026-09',
		2200,
		['2026-09-08', '2026-09-09'],
		'MINIMUM_WAGE_BELOW: P-KM-low is contracted at 2200 a month'
	)
);

register({
	id: 'CN-KM01-5',
	profile: 'CN-kunming',
	description:
		'January 2026, a Fumin (class II) worker contracted at CNY2,000, under the class II minimum 2,020: the run is refused (against CN-KM01-1 at 2,020, which passes).',
	citation: [
		'云人社发〔2025〕19号 (https://www.ynjc.gov.cn/u/cms/jcqzfxxgk/202509/30130601xbad.pdf): Kunming’s other counties CNY2,020 from 1 October 2025 (CN-KM01); 最低工资规定 art.12 and 昆明市工资支付条例 art.8 (CN-KM-WP03): 2,000 < 2,020.',
		'Declared bases 2,300 (above the 2,020 class II fund floor) so only the wage floor is in question.'
	],
	company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
	inputs: [
		...officeWeek(SINCE),
		...worker({
			ref: 'low',
			name: 'Floor CN-KM01-5',
			wage: 2000,
			siBase: 2300,
			hfBase: 2300,
			worksite: FUMIN
		})
	],
	period: '2026-01',
	refused: 'MINIMUM_WAGE_BELOW: P-KM-low is contracted at 2000 a month',
	expected: []
});

/** A part-time hourly contract at one worksite, from `from` (the terms row is the case's TERMS_CHANGE). */
const hourly = (
	ref: string,
	from: string,
	to: string | null,
	rates: { rate: number; worksite: string; refused?: string }[]
): ProbeInput[] => [
	{
		collection: 'employees',
		ref,
		values: {
			name: `Hourly ${ref}`,
			date_of_birth: '1995-03-04',
			gender: 'FEMALE',
			nationality: 'Chinese'
		}
	},
	{
		collection: 'employments',
		ref: `${ref}_job`,
		values: {
			employee_id: `@${ref}`,
			company_id: '@company',
			employee_number: `P-KM-${ref}`,
			prior_service_months: 0,
			effective_range: { from, to }
		}
	},
	...rates.map((r): ProbeInput => ({
		collection: 'employment_terms',
		values: {
			employment_id: `@${ref}_job`,
			residency_status: 'CITIZEN',
			tax_residency: 'RESIDENT',
			currency: 'CNY',
			base_salary: r.rate,
			pay_frequency: 'HOURLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PART_TIME',
			worksite: r.worksite,
			shift_pattern_id: '@week',
			effective_range: { from, to }
		},
		...(r.refused == null ? {} : { refused: r.refused })
	}))
];

const BELOW_HOURLY = 'The hourly rate is below the hourly minimum wage';

register(
	{
		...jan21750(
			'CN-KM-HOURLY-1',
			'Hourly floors (stored check HOURLY_MINIMUM_WAGE over the MINIMUM_WAGE table): a Wuhua part-timer at 20.99 in December 2025 (floor 21) and at 21.99 in October 2026 (floor 22) is refused and 22.00 is accepted; a Fumin part-timer at 20.99 in October 2026 (class II floor 21) is refused. The January 2026 payroll of the office worker is unchanged.',
			[
				'云人社发〔2025〕19号 (https://www.ynjc.gov.cn/u/cms/jcqzfxxgk/202509/30130601xbad.pdf): hourly CNY21 class I (Wuhua), 20 class II, from 1 October 2025 (CN-KM01.hourly-floors): 20.99 < 21.',
				'Yunnan HRSS 29 Aug 2026 (https://www.ynjc.gov.cn/jcqzfxxgk/zcw2023j0221/20260901/1677677.html): hourly CNY22 class I, 21 class II (Fumin) from 1 September 2026 (CN-KM02.hourly-floors): 21.99 < 22, 22.00 = 22 passes, 20.99 < 21.',
				'最低工资规定 art.5: the hourly standard applies to non-full-time employment. The office worker’s lines are the shared 21,750 January case (see jan21750).'
			],
			[
				...hourly('h1', '2025-12-01', '2025-12-31', [
					{ rate: 20.99, worksite: WUHUA, refused: BELOW_HOURLY }
				]),
				...hourly('h2', '2026-10-01', null, [
					{ rate: 21.99, worksite: WUHUA, refused: BELOW_HOURLY },
					{ rate: 22, worksite: WUHUA }
				]),
				...hourly('h3', '2026-10-01', null, [
					{ rate: 20.99, worksite: FUMIN, refused: BELOW_HOURLY }
				])
			],
			{ gross: 21750, total_deductions: 5207.24, net: 16542.76, 'IIT.employee': 356.99 }
		)
	},
	jan21750(
		'CN-KM13-1',
		'High-temperature allowance (derived line HIGH_TEMPERATURE_ALLOWANCE over the work-day fact high_temperature_day): a boiler-room worker at 33°C or above that cannot be lowered on Tuesday 6 and Wednesday 7 January 2026 is owed CNY10 a day, 20, taxed as wages.',
		[
			'云人社发〔2013〕98号 (Yunnan HRSS; register CN-KM13): CNY10 per person per working day outdoors at 35°C or above, and indoors at 33°C or above that cannot be brought lower; 防暑降温措施管理办法 art.17 (https://www.nhc.gov.cn/zhjcj/c100093/201207/2cdae24e57d04213944bcc6ef736a69b.shtml): the allowance is paid in wages. 2 × 10 = 20.',
			'IIT (wage income, STA 2018 No.61 art.6, month 1): 21,770 − 4,850.25 − 5,000 = 11,919.75 × 3% = 357.5925 → 357.59. Net 21,770 − 4,850.25 − 357.59 = 16,562.16. Bases are the declared 21,750, so contributions are unchanged.'
		],
		['2026-01-06', '2026-01-07'].map((day) => {
			const p = punch('w', day, [
				['09:00', '13:00'],
				['14:00', '18:00']
			]);
			return { ...p, values: { ...p.values, facts: { high_temperature_day: 1 } } };
		}),
		{
			gross: 21770,
			HIGH_TEMPERATURE_ALLOWANCE: 20,
			total_deductions: 5207.84,
			net: 16562.16,
			'IIT.employee': 357.59
		}
	),
	{
		id: 'CN-KM11-1',
		profile: 'CN-kunming',
		description:
			'A worker recorded pregnant from 1 May 2025 (eight months in January 2026) is given two extended hours on Monday 5 January 2026: the stored check PREGNANCY_NO_EXTENDED_HOURS refuses the run.',
		citation: [
			'云南省女职工劳动保护特别规定 (Order 232) art.10(3) (https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=105672, read 1 Oct 2026): 怀孕不满3个月和怀孕7个月以上的，不得延长劳动时间或者安排夜班劳动 (CN-KM11.overtime-night-restriction). add_months(2025-05-01, 7) = 2025-12-01 ≤ the January rule date, and the day has overtime.'
		],
		company: { facts: FACTS_2026 },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'w', name: 'Worker CN-KM11-1', wage: 21750, gender: 'FEMALE' }),
			{
				collection: 'person_facts',
				values: {
					employee_id: '@w',
					facts: { pregnancy_start: '2025-05-01' },
					effective_range: { from: '2025-05-01', to: null },
					source: 'HR'
				}
			},
			punch(
				'w',
				'2026-01-05',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				2
			)
		],
		period: '2026-01',
		refused:
			'P-KM-w: A worker under three months or from seven months pregnant cannot be given extended hours',
		expected: []
	},
	{
		...jan21750(
			'CN-KM-DUTY-1',
			'Obligation ledger, January 2026: a worker hired Thursday 1 January 2026 on 21,750 at a unionised entity. The hire raises the social-insurance and housing-fund registrations (due in 30 days); the finalised run raises the housing-fund remittance (five days after payday), the monthly social-insurance declaration (by the 20th) and the union funds (2% of wages).',
			[
				'Social Insurance Law art.58 and 云人社规〔2024〕1号 art.13 (CN-KM29.new-worker-registration): 2026-01-01 + 30 days = 2026-01-31.',
				'昆公积金规〔2020〕2号 arts.6–9 (https://zc.51shebao.com/detail/825467; CN-KM19.hire-registration): 2026-01-01 + 30 = 2026-01-31. Arts.10–14 (CN-KM20.remittance-five-days): the run’s pay date is the period’s last day, 2026-01-31, + 5 = 2026-02-05; both shares 2,610 + 2,610 = 5,220.',
				'云南税务公告〔2023〕5号 (https://ylbz.yn.gov.cn/index.php?c=show&id=3576; CN-KM17.monthly-declaration): by the 20th of the contribution month (recorded default), 2026-01-20; pension 1,740 + 3,480, medical 435 + 1,522.50, maternity 195.75, unemployment 65.25 + 152.25, injury 43.50 = 7,634.25.',
				'Yunnan Trade Union Law measure art.27 (https://www.ynrd.gov.cn/html/2022/sssjrdcwhdsswuchy_1130/19708.html; CN-KM35.union-funds-2pct): 21,750 × 2% = 435.00, due the 15th after the wage month (recorded default) = 2026-02-15; art.30 5‰ a day is the stored late charge (CN-KM35.late-fee).'
			],
			[],
			{ gross: 21750, total_deductions: 5207.24, net: 16542.76, 'IIT.employee': 356.99 },
			{ from: '2026-01-01' }
		),
		company: { facts: { ...FACTS_2026, union_established: true } },
		saved: [
			...['SI_REGISTRATION', 'HF_ACCOUNT_REGISTRATION'].map((duty_code) => ({
				collection: 'obligation_instances',
				where: { company_id: '@company', duty_code, subject_id: '@w_job' },
				rows: [
					{
						subject_kind: 'EMPLOYMENT',
						trigger_ref: 'HIRE',
						triggered_on: '2026-01-01',
						due_on: '2026-01-31',
						state: 'OPEN'
					}
				]
			})),
			...(
				[
					['HF_REMITTANCE', '2026-02-05', 5220],
					['SI_TAX_DECLARATION', '2026-01-20', 7634.25],
					['UNION_FUNDS', '2026-02-15', 435]
				] as const
			).map(([duty_code, due_on, amount_due]) => ({
				collection: 'obligation_instances',
				where: { company_id: '@company', duty_code, subject_id: '@run' },
				rows: [
					{
						subject_kind: 'RUN',
						trigger_ref: '2026-01',
						triggered_on: '2026-01-31',
						due_on,
						amount_due,
						state: 'OPEN'
					}
				]
			}))
		]
	}
);
