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
			'昆明市工资支付条例 (CN-KM-WP09): only tax and social insurance are withheld. Net 10,000 − 2,230 − 83.10 = 7,686.90; employer 1,600 + 700 + 90 + 70 + 20 + 1,200 = 3,680.'
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
			'September 2026, a Wuhua hire on Tuesday 1 September at the new class I minimum 2,270: insured at the 4,403 floor (medical now included), a 2,270 fund base at 5% = 113.50 rounds up to 114 on each side.',
		citation: [
			'Minimum 2,270 from 1 Sep 2026, gross including the worker’s insurance and fund (CN-KM02): 2,270 is not below it.',
			'Medical and maternity on 4,403 from 1 Sep 2026: 308.21 / 88.06, 39.627 → 39.63; pension 704.48 / 352.24, unemployment 30.82 / 13.21, injury 8.81.',
			'Fund: new/transferred-account floor 2,270 from 1 Sep 2026 (CN-KM05); 2,270 × 5% = 113.50 → 114 each side, 228 combined, not 227 (art.13 四舍五入 per side, CN-KM20).',
			'IIT nil. Net 2,270 − 567.51 = 1,702.49; employer 704.48 + 308.21 + 39.63 + 30.82 + 8.81 + 114 = 1,205.95.'
		],
		company: { facts: { ...FACTS_2026, housing_fund_rate: 5 } },
		inputs: [
			...officeWeek(SINCE),
			...worker({ ref: 'sun', name: 'Sun Yan', wage: 2270, siBase: 2270, from: '2026-09-01' })
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
					exit_reason: 'MUTUAL',
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
				event_kind: 'MARRIAGE',
				event_date: '2026-01-10'
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
