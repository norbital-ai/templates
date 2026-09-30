import { register, type ProbeCase, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * CN-shanghai cases: see the case shape at the top of payroll-probe.ts. Every figure is computed by hand from the
 * instrument each citation names; the case id is the register row (docs/inventory/china.csv) it prices.
 *
 * Held for every case (the recorded inputs, not law):
 * - `injury_rate` 0.2: an agency-assigned class I rate with no float (沪人社规〔2026〕2号 class table; the rate is an
 *   agency determination the operator records, CN-SH07).
 * - `unemployment_*_rate` 0.5 / 0.5: from 1 January 2026 the rates are the agency notice's, recorded as entity facts
 *   (no 2026 instrument was located, CN-SH06). December 2025 charges the law's own 0.5% / 0.5%.
 * - `housing_fund_rate` 7: the unit's elected equal rate inside 5–7% (the band is the annual committee notice's,
 *   沪公积金管委会〔2023〕3号 art.33; each share is base × rate, art.18; art.17 sets only the base ceiling and floor).
 * - Social insurance rounds to the fen half-up per side (law silent; owner default, CN-X-SI-ROUNDING); each
 *   housing-fund share rounds to the whole yuan half-up per side (CN-SH09, CN-SH40).
 * - Each company works a five-day week with two rest days (its own pattern; Labour Law art.38 requires at least one).
 */

const SOURCES = {
	si2025:
		'Shanghai social-insurance base 7,460–37,302 from 1 July 2025 (HRSS 2025 notice, https://rsj.sh.gov.cn/tgsgg_17341/20250918/t0035_1435637.html)',
	si2026:
		'Shanghai social-insurance base 7,546–37,731 from 1 July 2026 (HRSS announcement of 18 August 2026, https://rsj.sh.gov.cn/tgsgg_17341/20260818/t0035_1443203.html)',
	pension:
		'Pension employer 16%, employee 8% (Social Insurance Law arts.10–12; Shanghai HRSS employer-rate guidance, https://rsj.sh.gov.cn/tdjjf_17554/20250120/t0035_1430072.html)',
	medical2025:
		'Medical employer 9%, employee 2% (沪医保规〔2025〕2号, 1 March 2025–28 February 2026, https://shanghai.chinatax.gov.cn/zzzb/zcwj/202508/t477427.html)',
	medical2026:
		'Medical employer 9%, employee 2% (沪医保规〔2026〕2号, from 1 March 2026, https://ybj.sh.gov.cn/gfxwj/20260313/921e047144694b61b6df8ca0c5ef2cfc.html)',
	unemployment2025:
		'Unemployment employer 0.5%, employee 0.5% to 31 December 2025 (https://rsj.sh.gov.cn/tshbx_17729/20250103/t0035_1429759.html)',
	unemployment2026:
		'Unemployment 0.5% / 0.5% from 1 January 2026 is the recorded agency-notice rate, not law (CN-SH06: no 2026 instrument located)',
	injury2025:
		'Work injury employer-only at the assigned class rate, 0.2% recorded (class I 0.2% from 1 January 2025, 2024 Shanghai rate notice item 2, https://rsj.sh.gov.cn/tshbx_17729/20250103/t0035_1429759.html)',
	injury:
		'Work injury employer-only at the assigned class rate, 0.2% recorded (沪人社规〔2026〕2号, https://rsj.sh.gov.cn/tshbx_17729/20260121/t0035_1438097.html)',
	hf2025:
		'Housing fund 2,690–37,302, equal rate each side, each share rounded to the yuan (沪公积金管委会〔2025〕8号; bounds rule 沪公积金管委会〔2023〕3号 art.17, https://service.shanghai.gov.cn/XingZhengWenDangKuJyh/XZGFDetails.aspx?docid=230412105807NKYzasRn8VIgegEEV4g)',
	hf2026:
		'Housing fund 2,740–37,731 from 1 July 2026, ordinary 5–7% and supplementary 1–5% equal each side, each share rounded to the yuan; published combined limits CNY384–5,282 at 7% and CNY274–3,774 at 5% (沪公积金管委会〔2026〕3号, https://www.shzfgjj.cn/html/newxxgk/zcwj/gfxwj/228478.html)',
	iitResident:
		'IIT resident cumulative withholding: year’s income − year’s employee insurance and housing fund − CNY5,000 × months employed here, on the annual table (3% to 36,000; 10% − 2,520 to 144,000), less tax withheld (IIT Law arts.3, 6, https://fgk.chinatax.gov.cn/zcfgk/c100009/c5193028/content.html; STA 2018 No.61 art.6 and annex table 1, https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3963396/content.html)',
	iitNonResident:
		'IIT non-resident: the month’s wage − CNY5,000 on the monthly table (3% to 3,000; 10% − 210 to 12,000; 20% − 1,410 to 25,000), no insurance or housing-fund relief (IIT Law art.6(1)(2); STA 2018 No.61 art.9 and annex table 3)',
	proration:
		'Part month: the monthly wage ÷ 21.75 for each working day employed, a whole month never more than the month; a rate change splits the month by its working days (人社部发〔2025〕2号, https://www.mohrss.gov.cn/SYrlzyhshbzb/laodongguanxi_/zcwj/202501/t20250101_533693.html; law silent on proration: the recorded seed default, CN-N02)'
} as const;

const FACTS = {
	injury_rate: 0.2,
	unemployment_employer_rate: 0.5,
	unemployment_employee_rate: 0.5,
	housing_fund_rate: 7,
	housing_fund_supplementary_rate: 0
};

/** A Monday-anchored week of five office days and two rest days (the case company's own pattern). */
const cnWeek = (from: string): ProbeInput[] => [
	{
		collection: 'shift_definitions',
		ref: 'office',
		values: {
			company_id: '@company',
			code: 'OFFICE',
			name: 'Office day (0900 to 1800)',
			variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_definitions',
		ref: 'rest',
		values: {
			company_id: '@company',
			code: 'REST',
			name: 'Rest day',
			variant: { kind: 'REST' },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_patterns',
		ref: 'week',
		values: {
			company_id: '@company',
			code: 'OFFICEx5-RESTx2',
			name: '5 x OFFICE, 2 x REST',
			pattern: {
				days: ['@office', '@office', '@office', '@office', '@office', '@rest', '@rest'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from, to: null }
		}
	}
];

type Hire = {
	name: string;
	gender?: 'MALE' | 'FEMALE';
	born?: string;
	nationality?: string;
	receiving_pension?: boolean;
	from: string;
	to?: string;
	/** One row per wage in force: [base salary, from, to]. */
	wages: readonly (readonly [number, string, string | null])[];
	residency?: 'CITIZEN' | 'FOREIGNER';
	tax?: 'RESIDENT' | 'NON_RESIDENT';
	/** Declared social-insurance base on the pension registration; omitted = no registration (pensioner). */
	si?: number;
	/** Housing-fund registration elections (`contribution_base`, `first_ever_account`, `voluntary_agreement`); omitted = no registration. */
	hf?: Row;
	employment?: Row;
	terms?: Row;
	/** Extra employee fields (`marital_status`, `children`). */
	employee?: Row;
};

/** An employee, the contract, its terms and its pension / housing-fund registrations. */
function hire(ref: string, h: Hire): ProbeInput[] {
	const job = `${ref}_job`;
	return [
		{
			collection: 'employees',
			ref,
			values: {
				name: h.name,
				date_of_birth: h.born ?? '1990-05-12',
				gender: h.gender ?? 'MALE',
				nationality: h.nationality ?? 'Chinese',
				receiving_pension: h.receiving_pension ?? false,
				...h.employee
			}
		},
		{
			collection: 'employments',
			ref: job,
			values: {
				employee_id: `@${ref}`,
				company_id: '@company',
				employee_number: `SH-${ref}`,
				effective_range: { from: h.from, to: h.to ?? null },
				...h.employment
			}
		},
		...h.wages.map(([base_salary, from, to]): ProbeInput => ({
			collection: 'employment_terms',
			values: {
				employment_id: `@${job}`,
				residency_status: h.residency ?? 'CITIZEN',
				tax_residency: h.tax ?? 'RESIDENT',
				currency: 'CNY',
				base_salary,
				pay_frequency: 'MONTHLY',
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: 'PERMANENT',
				worksite: 'SHANGHAI',
				shift_pattern_id: '@week',
				effective_range: { from, to },
				...h.terms
			}
		})),
		...(h.si === undefined
			? []
			: [
					{
						collection: 'employment_statutory_facts',
						values: {
							employee_id: `@${ref}`,
							employment_id: `@${job}`,
							statutory_contribution_id: '@law:statutory_contributions:PENSION',
							effective_range: { from: h.from, to: null },
							status: {
								kind: 'REGISTERED',
								reference_number: `PROBE-SI-${ref}`,
								elections: { contribution_base: h.si }
							}
						}
					}
				]),
		...(h.hf === undefined
			? []
			: [
					{
						collection: 'employment_statutory_facts',
						values: {
							employee_id: `@${ref}`,
							employment_id: `@${job}`,
							statutory_contribution_id: '@law:statutory_contributions:HOUSING_FUND',
							effective_range: { from: h.from, to: null },
							status: {
								kind: 'REGISTERED',
								reference_number: `PROBE-HF-${ref}`,
								elections: h.hf
							}
						}
					}
				])
	];
}

const run = (period: string): ProbeInput => ({
	collection: 'payroll_runs',
	values: { company_id: '@company', period }
});

/** Pension, medical, unemployment, injury and housing-fund lines of one slip, [employee, employer] each. */
const si = (
	pension: [number, number],
	medical: [number, number],
	unemployment: [number, number],
	injury: number,
	hf?: number
) => ({
	'PENSION.employee': pension[0],
	'PENSION.employer': pension[1],
	'MEDICAL.employee': medical[0],
	'MEDICAL.employer': medical[1],
	'UNEMPLOYMENT.employee': unemployment[0],
	'UNEMPLOYMENT.employer': unemployment[1],
	'INJURY.employer': injury,
	...(hf === undefined ? {} : { 'HOUSING_FUND.employee': hf, 'HOUSING_FUND.employer': hf })
});

register(
	{
		id: 'CN-SH05-1',
		profile: 'CN-shanghai',
		description:
			'A resident citizen hired 1 December 2025 on CNY20,000, the whole month worked: every scheme on a base inside the 2025 bounds, the first month of cumulative IIT.',
		citation: [
			SOURCES.si2025,
			`${SOURCES.pension}: 20,000 × 8% = 1,600 / × 16% = 3,200`,
			`${SOURCES.medical2025}: 400 / 1,800`,
			`${SOURCES.unemployment2025}: 100 / 100`,
			`${SOURCES.injury2025}: 40`,
			`${SOURCES.hf2025}; a transferred worker contributes from the first month on 本人当月工资 (Housing Provident Fund Regulation art.17, https://www.gov.cn/zhengce/content/202608/content_7078477.htm): 20,000 × 7% = 1,400 each side`,
			`${SOURCES.iitResident}: 20,000 − 3,500 − 5,000 = 11,500 × 3% = 345`,
			'Net 20,000 − 3,500 − 345 = 16,155; employer 3,200 + 1,800 + 100 + 40 + 1,400 = 6,540'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-01'),
			...hire('li', {
				name: 'Li Wei',
				from: '2025-12-01',
				wages: [[20000, '2025-12-01', null]],
				si: 20000,
				hf: { contribution_base: 20000, first_ever_account: false }
			})
		],
		period: '2025-12',
		expected: [
			{
				employment: 'li_job',
				lines: {
					gross: 20000,
					net: 16155,
					employer_cost: 6540,
					BASIC: 20000,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 345
				}
			}
		]
	},
	{
		id: 'CN-SH05-2',
		profile: 'CN-shanghai',
		description:
			'December 2025, two resident citizens hired 1 December: CNY50,000 above the 37,302 social-insurance and housing-fund ceiling, and CNY47,527.71 whose cumulative taxable income lands exactly on the 36,000 IIT band seam.',
		citation: [
			`${SOURCES.si2025}; ${SOURCES.hf2025}: both bases clamp to 37,302`,
			`${SOURCES.pension}: 37,302 × 8% = 2,984.16 / × 16% = 5,968.32`,
			`${SOURCES.medical2025}: 746.04 / 3,357.18`,
			`${SOURCES.unemployment2025}: 186.51 / 186.51`,
			`${SOURCES.injury2025}: 37,302 × 0.2% = 74.604 → 74.60`,
			'Housing fund 37,302 × 7% = 2,611.14 → 2,611 each side',
			`${SOURCES.iitResident}: 50,000 − 6,527.71 − 5,000 = 38,472.29 → × 10% − 2,520 = 1,327.23; 47,527.71 − 6,527.71 − 5,000 = 36,000.00 → × 3% = 1,080.00 (the band seam, and 10% − 2,520 gives the same)`,
			'Net 50,000 − 6,527.71 − 1,327.23 = 42,145.06 and 47,527.71 − 6,527.71 − 1,080 = 39,920.00; employer 5,968.32 + 3,357.18 + 186.51 + 74.60 + 2,611 = 12,197.61 each'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-01'),
			...hire('zhang', {
				name: 'Zhang Min',
				from: '2025-12-01',
				wages: [[50000, '2025-12-01', null]],
				si: 50000,
				hf: { contribution_base: 50000, first_ever_account: false }
			}),
			...hire('wang', {
				name: 'Wang Fang',
				gender: 'FEMALE',
				from: '2025-12-01',
				wages: [[47527.71, '2025-12-01', null]],
				si: 47527.71,
				hf: { contribution_base: 47527.71, first_ever_account: false }
			})
		],
		period: '2025-12',
		expected: [
			{
				employment: 'zhang_job',
				lines: {
					gross: 50000,
					net: 42145.06,
					employer_cost: 12197.61,
					...si([2984.16, 5968.32], [746.04, 3357.18], [186.51, 186.51], 74.6, 2611),
					'IIT.employee': 1327.23
				}
			},
			{
				employment: 'wang_job',
				lines: {
					gross: 47527.71,
					net: 39920,
					employer_cost: 12197.61,
					...si([2984.16, 5968.32], [746.04, 3357.18], [186.51, 186.51], 74.6, 2611),
					'IIT.employee': 1080
				}
			}
		]
	},
	{
		id: 'CN-SH09-1',
		profile: 'CN-shanghai',
		description:
			'December 2025, two foreign non-resident workers employed by the Shanghai unit since March 2024 but recorded as present in China fewer than 183 days in 2025 (regional roles mostly abroad; IIT Law art.1), hence non-resident for 2025: one on CNY9,000 whose declared 2024 averages (6,000 insurance, 2,600 fund) sit below both floors and who agreed to join the fund; one on CNY30,000 with no fund agreement, on the 25,000 non-resident band seam.',
		citation: [
			`${SOURCES.si2025}: a declared 6,000 insures on the 7,460 floor; foreign employees are insured like citizens (Social Insurance Law art.97; CN-N25)`,
			`${SOURCES.pension}: 7,460 → 596.80 / 1,193.60; 30,000 → 2,400 / 4,800`,
			`${SOURCES.medical2025}: 149.20 / 671.40; 600 / 2,700`,
			`${SOURCES.unemployment2025}: 37.30 / 37.30; 150 / 150`,
			`${SOURCES.injury2025}: 7,460 × 0.2% = 14.92; 60`,
			`${SOURCES.hf2025}: a declared 2,600 contributes on the 2,690 floor, 2,690 × 7% = 188.30 → 188 each side. A foreign worker joins only by mutual agreement (沪公积金管委会〔2023〕3号 art.6, 在本人与单位协商一致的基础上; CN-SH41): the second worker, without one, pays nothing`,
			`${SOURCES.iitNonResident}: 9,000 − 5,000 = 4,000 × 10% − 210 = 190; 30,000 − 5,000 = 25,000 × 20% − 1,410 = 3,590 (the band seam)`,
			'Net 9,000 − 971.30 − 190 = 7,838.70 and 30,000 − 3,150 − 3,590 = 23,260; employer 1,193.60 + 671.40 + 37.30 + 14.92 + 188 = 2,105.22 and 4,800 + 2,700 + 150 + 60 = 7,710'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2024-03-04'),
			...hire('sato', {
				name: 'Sato Kenji',
				nationality: 'Japanese',
				from: '2024-03-01',
				wages: [[9000, '2024-03-01', null]],
				residency: 'FOREIGNER',
				tax: 'NON_RESIDENT',
				si: 6000,
				hf: { contribution_base: 2600, voluntary_agreement: true }
			}),
			...hire('miller', {
				name: 'Anna Miller',
				gender: 'FEMALE',
				nationality: 'German',
				from: '2024-03-01',
				wages: [[30000, '2024-03-01', null]],
				residency: 'FOREIGNER',
				tax: 'NON_RESIDENT',
				si: 30000,
				hf: { contribution_base: 30000, voluntary_agreement: false }
			})
		],
		period: '2025-12',
		expected: [
			{
				employment: 'sato_job',
				lines: {
					gross: 9000,
					net: 7838.7,
					employer_cost: 2105.22,
					...si([596.8, 1193.6], [149.2, 671.4], [37.3, 37.3], 14.92, 188),
					'IIT.employee': 190
				}
			},
			{
				employment: 'miller_job',
				lines: {
					gross: 30000,
					net: 23260,
					employer_cost: 7710,
					...si([2400, 4800], [600, 2700], [150, 150], 60),
					'IIT.employee': 3590
				}
			}
		]
	},
	{
		id: 'CN-SH43-1',
		profile: 'CN-shanghai',
		description:
			'A first-ever housing-fund worker hired Monday 15 December 2025 on CNY21,750: thirteen working days paid, social insurance for the month on the declared first-month wage, no fund contribution in the joining month.',
		citation: [
			`${SOURCES.proration}: 15–31 December 2025 has 13 working days → 21,750 ÷ 21.75 × 13 = 13,000`,
			`${SOURCES.si2025}; ${SOURCES.pension}: 21,750 → 1,740 / 3,480`,
			`${SOURCES.medical2025}: 435 / 1,957.50`,
			`${SOURCES.unemployment2025}: 108.75 / 108.75`,
			`${SOURCES.injury2025}: 43.50`,
			'Housing fund: a new worker contributes from the second month (Housing Provident Fund Regulation art.17, https://www.gov.cn/zhengce/content/202608/content_7078477.htm; 沪公积金管委会〔2023〕3号 arts.16–21; CN-SH43): nothing in December',
			`${SOURCES.iitResident}: 13,000 − 2,283.75 − 5,000 = 5,716.25 × 3% = 171.4875 → 171.49`,
			'Net 13,000 − 2,283.75 − 171.49 = 10,544.76; employer 3,480 + 1,957.50 + 108.75 + 43.50 = 5,589.75'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-01'),
			...hire('chen', {
				name: 'Chen Jie',
				from: '2025-12-15',
				wages: [[21750, '2025-12-15', null]],
				si: 21750,
				hf: { contribution_base: 21750, first_ever_account: true }
			})
		],
		period: '2025-12',
		expected: [
			{
				employment: 'chen_job',
				lines: {
					gross: 13000,
					net: 10544.76,
					employer_cost: 5589.75,
					BASIC: 13000,
					...si([1740, 3480], [435, 1957.5], [108.75, 108.75], 43.5),
					'IIT.employee': 171.49
				}
			}
		]
	},
	{
		id: 'CN-SH09-2',
		profile: 'CN-shanghai',
		description:
			'January 2026, a resident citizen on CNY21,750 (in service since June 2025) takes two days of unpaid personal leave; the housing-fund share of 1,522.50 rounds half-up to 1,523.',
		citation: [
			'Unpaid personal leave: 劳部发〔1994〕489号 arts.11–12 list the paid absences; other personal leave is unpaid, at the monthly wage ÷ 21.75 a day (人社部发〔2025〕2号): 2 × 1,000 = 2,000 off',
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,740 / 3,480`,
			`${SOURCES.medical2025}: 435 / 1,957.50`,
			`${SOURCES.unemployment2026}: 108.75 / 108.75`,
			`${SOURCES.injury}: 43.50`,
			`${SOURCES.hf2025}: 21,750 × 7% = 1,522.50 → 1,523 (四舍五入) each side`,
			`${SOURCES.iitResident}: January is the first month of the tax year: 19,750 − 3,806.75 − 5,000 = 10,943.25 × 3% = 328.2975 → 328.30`,
			'Net 19,750 − 3,806.75 − 328.30 = 15,614.95; employer 3,480 + 1,957.50 + 108.75 + 43.50 + 1,523 = 7,112.75'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('zhao', {
				name: 'Zhao Lei',
				from: '2025-06-02',
				wages: [[21750, '2025-06-02', null]],
				si: 21750,
				hf: { contribution_base: 21750 }
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@zhao_job',
					catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
					reference: 'UL-2026-01',
					from_date: '2026-01-13',
					to_date: '2026-01-14',
					no_pay_origin: 'EMPLOYEE_REQUESTED',
					reason: 'Personal matters'
				}
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'zhao_job',
				lines: {
					gross: 19750,
					net: 15614.95,
					employer_cost: 7112.75,
					...si([1740, 3480], [435, 1957.5], [108.75, 108.75], 43.5, 1523),
					'IIT.employee': 328.3
				}
			}
		]
	},
	{
		id: 'CN-SH03-1',
		profile: 'CN-shanghai',
		description:
			'January 2026, a resident citizen on CNY21,750 works three hours on New Year’s Day, two hours beyond the day on Tuesday 6 January and three hours on rest day Saturday 10 January with no compensatory rest.',
		citation: [
			'Labour Law art.44 (https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html): at least 150% for extended hours, 200% for rest-day work without compensatory rest, 300% for statutory-holiday work; 上海市企业工资支付办法 items 9, 13–14 (CN-SH03): the base is the contract monthly wage',
			'Hour: 21,750 ÷ 21.75 ÷ 8 = 125 (人社部发〔2025〕2号, https://www.mohrss.gov.cn/SYrlzyhshbzb/laodongguanxi_/zcwj/202501/t20250101_533693.html). 1 January is a statutory holiday (State Council Order 795 art.2; CN-N03), recorded on the company calendar: 3 × 125 × 3 = 1,125; 2 × 125 × 1.5 = 375; 3 × 125 × 2 = 750; overtime 2,250 on the full 21,750',
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,740 / 3,480; ${SOURCES.medical2025}: 435 / 1,957.50; ${SOURCES.unemployment2026}: 108.75 / 108.75; ${SOURCES.injury}: 43.50; housing fund 1,522.50 → 1,523 each side`,
			`${SOURCES.iitResident}: 24,000 − 3,806.75 − 5,000 = 15,193.25 × 3% = 455.7975 → 455.80`,
			'Net 24,000 − 3,806.75 − 455.80 = 19,737.45; employer 7,112.75'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-01-01',
					name: 'New Year’s Day (元旦)',
					kind: 'PUBLIC_HOLIDAY',
					source: 'State Council Order 795 art.2',
					published_at: '2025-12-15T00:00:00.000Z'
				}
			},
			...hire('sun', {
				name: 'Sun Hao',
				from: '2025-06-02',
				wages: [[21750, '2025-06-02', null]],
				si: 21750,
				hf: { contribution_base: 21750 }
			}),
			...(
				[
					['2026-01-01', '@office', '01:00', '04:00', 3],
					['2026-01-06', '@office', '01:00', '12:00', 2],
					['2026-01-10', '@rest', '01:00', '04:00', 3]
				] as const
			).map(([date, shift, start, end, hours]): ProbeInput => ({
				collection: 'work_days',
				values: {
					employment_id: '@sun_job',
					work_date: date,
					shift_definition_id: shift,
					worked_intervals: [{ start: `${date}T${start}:00.000Z`, end: `${date}T${end}:00.000Z` }],
					approved_overtime_hours: hours,
					time_off_in_lieu: false
				}
			}))
		],
		period: '2026-01',
		expected: [
			{
				employment: 'sun_job',
				lines: {
					gross: 24000,
					net: 19737.45,
					employer_cost: 7112.75,
					BASIC: 21750,
					...si([1740, 3480], [435, 1957.5], [108.75, 108.75], 43.5, 1523),
					'IIT.employee': 455.8
				}
			}
		]
	},
	{
		id: 'CN-SH05-3',
		profile: 'CN-shanghai',
		description:
			'A resident citizen on CNY22,000 is raised to CNY26,400 from Monday 16 March 2026; January and February run first, so March withholds on the cumulative year. The social-insurance base stays the declared 22,000 for the contribution year.',
		citation: [
			`${SOURCES.proration}: March 2026 has 22 working days, 10 before the change and 12 after: 22,000 × 10/22 + 26,400 × 12/22 = 10,000 + 14,400 = 24,400`,
			`${SOURCES.si2025}: the base is fixed for the contribution year; ${SOURCES.pension}: 1,760 / 3,520; ${SOURCES.medical2026}: 440 / 1,980; ${SOURCES.unemployment2026}: 110 / 110; ${SOURCES.injury}: 44; housing fund 22,000 × 7% = 1,540 each side`,
			`${SOURCES.iitResident}: January 22,000 − 3,850 − 5,000 = 13,150 → 394.50; February cumulative 26,300 → 789 − 394.50 = 394.50; March cumulative 68,400 − 11,550 − 15,000 = 41,850 → 41,850 × 10% − 2,520 = 1,665 − 789 = 876`,
			'Net 24,400 − 3,850 − 876 = 19,674; employer 3,520 + 1,980 + 110 + 44 + 1,540 = 7,194'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('liu', {
				name: 'Liu Yang',
				from: '2025-06-02',
				wages: [
					[22000, '2025-06-02', '2026-03-15'],
					[26400, '2026-03-16', null]
				],
				si: 22000,
				hf: { contribution_base: 22000 }
			}),
			run('2026-01'),
			run('2026-02')
		],
		period: '2026-03',
		expected: [
			{
				employment: 'liu_job',
				lines: {
					gross: 24400,
					net: 19674,
					employer_cost: 7194,
					BASIC: 24400,
					...si([1760, 3520], [440, 1980], [110, 110], 44, 1540),
					'IIT.employee': 876
				}
			}
		]
	},
	{
		id: 'CN-SH50-1',
		profile: 'CN-shanghai',
		description:
			'A resident citizen hired 1 December 2025 on CNY43,500 (ten years’ earlier service) leaves on Friday 13 March 2026 by a mutual ending the employer proposed: final wages for ten days, one unused annual-leave day at the further 200%, half a month of economic compensation at the three-times cap, IIT-exempt; December to February run first.',
		citation: [
			`${SOURCES.proration}: 2–13 March has 10 working days → 43,500 ÷ 21.75 × 10 = 20,000; final wages are paid in one sum at the exit (上海市企业工资支付办法 item 7, https://rsj.sh.gov.cn/tgzfl_17732/20260731/t0035_1442850.html; CN-SH02)`,
			'Annual leave: 10 days a year after ten years’ cumulative service (职工带薪年休假条例 art.3, https://xzfg.moj.gov.cn/front/law/detail?LawID=208); a leaver’s days are (72 ÷ 365) × 10 = 1.97, the part day unpaid (企业职工带薪年休假实施办法 art.12): 1 day, paid at the further 200% of the day wage on the average of the months worked excluding overtime (arts.10–11): 43,500 ÷ 21.75 × 2 = 4,000',
			'Economic compensation (LCL arts.46(2), 47, https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html): under six months’ service is half a month; the 43,500 average exceeds three times the published 2025 city average 12,577 (https://rsj.sh.gov.cn/tgsgg_17341/20260818/t0035_1443203.html; the prior calendar year by the owner rule, CN-SH50), so 3 × 12,577 × 0.5 = 18,865.50',
			'IIT on the compensation: exempt up to three times the local prior-year average annual wage, 36 × 12,577 = 452,772 (财税〔2018〕164号 item 5(1), http://szs.mof.gov.cn/zhengcefabu/201812/t20181227_3110164.htm): nothing',
			`${SOURCES.si2025}: 43,500 clamps to 37,302; ${SOURCES.pension}: 2,984.16 / 5,968.32; ${SOURCES.medical2026}: 746.04 / 3,357.18; ${SOURCES.unemployment2026}: 186.51 / 186.51; ${SOURCES.injury}: 74.60; housing fund 2,611 each side`,
			`${SOURCES.iitResident}: January 43,500 − 6,527.71 − 5,000 = 31,972.29 → 959.17; February cumulative 63,944.58 → 3,874.458 − 959.17 = 2,915.29; March cumulative 111,000 − 19,583.13 − 15,000 = 76,416.87 → 5,121.687 − 3,874.46 = 1,247.23 (the leave pay is wages; the compensation is taxed apart)`,
			'Net 20,000 + 4,000 + 18,865.50 − 6,527.71 − 1,247.23 = 35,090.56; employer 5,968.32 + 3,357.18 + 186.51 + 74.60 + 2,611 = 12,197.61'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-01'),
			...hire('huang', {
				name: 'Huang Tao',
				from: '2025-12-01',
				to: '2026-03-13',
				wages: [[43500, '2025-12-01', '2026-03-13']],
				si: 43500,
				hf: { contribution_base: 43500, first_ever_account: false },
				employment: {
					prior_service_months: 120,
					exit_reason: 'MUTUAL',
					exit_facts: { lcl_termination_ground: 'ART_36_EMPLOYER' }
				}
			}),
			run('2025-12'),
			run('2026-01'),
			run('2026-02'),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@huang_job',
					catalogue_id: '@law:leave_catalogue:ANNUAL_LEAVE',
					reference: 'EXIT-AL-2026',
					from_date: '2026-01-01',
					to_date: '2026-12-31',
					encash_days: 1,
					effective_on: '2026-03-13',
					due_on: '2026-03-13',
					reason: 'Unused statutory annual leave at exit'
				}
			},
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@huang_job',
					catalogue_id: '@law:adhoc_catalogue:SEVERANCE_PAY',
					amount: 0,
					event_date: '2026-03-13',
					reason: 'LCL art.46(2): mutual ending proposed by the employer'
				}
			}
		],
		period: '2026-03',
		expected: [
			{
				employment: 'huang_job',
				lines: {
					gross: 42865.5,
					net: 35090.56,
					employer_cost: 12197.61,
					BASIC: 20000,
					ANNUAL_LEAVE_ENCASHMENT: 4000,
					SEVERANCE_PAY: 18865.5,
					...si([2984.16, 5968.32], [746.04, 3357.18], [186.51, 186.51], 74.6, 2611),
					'IIT.employee': 1247.23
				}
			}
		]
	},
	{
		id: 'CN-N10-1',
		profile: 'CN-shanghai',
		description:
			'January 2026, two resident citizens on CNY20,000: one is paid a CNY36,000 annual bonus taxed separately (exactly 3,000 a month, the band seam), the other a CNY20,000 13th-month bonus taxed with the month’s wages.',
		citation: [
			'Separate annual bonus: MOF/STA 2023 No.30 (to 31 December 2027, https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211524/content.html): bonus ÷ 12 picks the monthly-table rate: 36,000 ÷ 12 = 3,000 → 3%: 1,080',
			`${SOURCES.iitResident}: the separated bonus leaves the wage 20,000 − 3,500 − 5,000 = 11,500 → 345; the 13th month is ordinary wage income: 40,000 − 3,500 − 5,000 = 31,500 × 3% = 945`,
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,600 / 3,200; ${SOURCES.medical2025}: 400 / 1,800; ${SOURCES.unemployment2026}: 100 / 100; ${SOURCES.injury}: 40; housing fund 1,400 each side — on the declared base, not the bonus month`,
			'Net 56,000 − 3,500 − 345 − 1,080 = 51,075 and 40,000 − 3,500 − 945 = 35,555; employer 6,540 each'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('zhou', {
				name: 'Zhou Xin',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 }
			}),
			...hire('wu', {
				name: 'Wu Qian',
				gender: 'FEMALE',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 }
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@zhou_job',
					catalogue_id: '@law:adhoc_catalogue:ANNUAL_BONUS_SEPARATE',
					amount: 36000,
					event_date: '2026-01-20',
					reason: '2025 annual bonus, separate taxation elected'
				}
			},
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@wu_job',
					catalogue_id: '@law:adhoc_catalogue:BONUS',
					amount: 20000,
					event_date: '2026-01-20',
					reason: '13th-month pay'
				}
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'zhou_job',
				lines: {
					gross: 56000,
					net: 51075,
					employer_cost: 6540,
					ANNUAL_BONUS_SEPARATE: 36000,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 345,
					'IIT_BONUS.employee': 1080
				}
			},
			{
				employment: 'wu_job',
				lines: {
					gross: 40000,
					net: 35555,
					employer_cost: 6540,
					BONUS: 20000,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 945
				}
			}
		]
	},
	{
		id: 'CN-SH41-2',
		profile: 'CN-shanghai',
		description:
			'January 2026, a retired citizen drawing a basic pension re-employed on CNY10,000: outside social insurance and the housing fund, the wage taxed as a resident’s.',
		citation: [
			'A worker already drawing basic pension benefits is outside the ordinary insurance (CN-N13, CN-SH25; 沪人社规〔2025〕22号 gives such a worker only a separate injury-only enrolment, https://rsj.sh.gov.cn/tshbx_17729/20251027/t0035_1436399.html, not elected here) and does not contribute to the housing fund (沪公积金管委会〔2023〕3号 art.21, https://www.shanghai.gov.cn/qyzfgjjsjzc/20240927/2c95b2e3e9a542c2a32af7eddf25048a.html; CN-SH41)',
			`${SOURCES.iitResident}: a re-employed retiree’s pay is wage income (国税函〔2005〕382号): 10,000 − 0 − 5,000 = 5,000 × 3% = 150`,
			'Net 10,000 − 150 = 9,850; employer cost 0'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('ma', {
				name: 'Ma Guoqiang',
				born: '1963-04-02',
				receiving_pension: true,
				from: '2025-06-02',
				wages: [[10000, '2025-06-02', null]]
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'ma_job',
				lines: { gross: 10000, net: 9850, employer_cost: 0, 'IIT.employee': 150 }
			}
		]
	},
	{
		id: 'CN-SH40-1',
		profile: 'CN-shanghai',
		description:
			'Two resident citizens transferred in on 1 July 2026 to a unit that elected the 5% supplementary fund: CNY40,000 above both 2026 ceilings (the published maximum fund shares) and CNY4,100 on the 7,546 insurance floor; unemployment 0.5% of 37,731 rounds half-up from 188.655.',
		citation: [
			`${SOURCES.si2026}: 40,000 → 37,731; 4,100 → 7,546`,
			`${SOURCES.pension}: 3,018.48 / 6,036.96; 603.68 / 1,207.36`,
			`${SOURCES.medical2026}: 754.62 / 3,395.79; 150.92 / 679.14`,
			`${SOURCES.unemployment2026}: 188.655 → 188.66 each side (fen half-up, CN-X-SI-ROUNDING); 37.73`,
			`${SOURCES.injury}: 75.462 → 75.46; 15.092 → 15.09`,
			`${SOURCES.hf2026}: a transferred worker contributes from the first month on 本人当月工资 (Regulation art.17): 37,731 × 7% = 2,641.17 → 2,641 plus × 5% = 1,886.55 → 1,887, 4,528 each side (the published 5,282 and 3,774 combined); 4,100 × 7% = 287 plus × 5% = 205, 492 each side`,
			`${SOURCES.iitResident}: July is the first month employed here: 40,000 − 8,489.76 − 5,000 = 26,510.24 × 3% = 795.3072 → 795.31; 4,100 − 1,284.33 − 5,000 is negative: nothing`,
			'Net 40,000 − 8,489.76 − 795.31 = 30,714.93 and 4,100 − 1,284.33 = 2,815.67 (above the 2,740 net floor, 沪人社规〔2025〕10号); employer 6,036.96 + 3,395.79 + 188.66 + 75.46 + 4,528 = 14,224.87 and 1,207.36 + 679.14 + 37.73 + 15.09 + 492 = 2,431.32'
		],
		company: { facts: { ...FACTS, housing_fund_supplementary_rate: 5 } },
		inputs: [
			...cnWeek('2026-06-29'),
			...hire('gao', {
				name: 'Gao Ming',
				from: '2026-07-01',
				wages: [[40000, '2026-07-01', null]],
				si: 40000,
				hf: { contribution_base: 40000, first_ever_account: false }
			}),
			...hire('lin', {
				name: 'Lin Xiaoyu',
				gender: 'FEMALE',
				from: '2026-07-01',
				wages: [[4100, '2026-07-01', null]],
				si: 4100,
				hf: { contribution_base: 4100, first_ever_account: false }
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'gao_job',
				lines: {
					gross: 40000,
					net: 30714.93,
					employer_cost: 14224.87,
					...si([3018.48, 6036.96], [754.62, 3395.79], [188.66, 188.66], 75.46, 4528),
					'IIT.employee': 795.31
				}
			},
			{
				employment: 'lin_job',
				lines: {
					gross: 4100,
					net: 2815.67,
					employer_cost: 2431.32,
					...si([603.68, 1207.36], [150.92, 679.14], [37.73, 37.73], 15.09, 492)
				}
			}
		]
	},
	{
		id: 'CN-SH01-1',
		profile: 'CN-shanghai',
		description:
			'A resident citizen transferred in on 1 July 2026 on CNY3,798.33, the contract whose net of the employee’s insurance and fund shares is exactly the CNY2,740 monthly minimum: the run must pass.',
		citation: [
			'沪人社规〔2025〕10号 item 4 (https://rsj.sh.gov.cn/tgzfl_17732/20250714/t0035_1434097.html): from 1 July 2025 the full-time monthly minimum is CNY2,740, excluding the employee’s social insurance and housing fund; the contract less those shares must meet it: 3,798.33 − 1,058.33 = 2,740.00',
			`${SOURCES.si2026}: 3,798.33 insures on the 7,546 floor; ${SOURCES.pension}: 603.68 / 1,207.36; ${SOURCES.medical2026}: 150.92 / 679.14; ${SOURCES.unemployment2026}: 37.73 / 37.73; ${SOURCES.injury}: 15.09`,
			`${SOURCES.hf2026}: 3,798.33 × 7% = 265.88 → 266 each side`,
			`${SOURCES.iitResident}: 3,798.33 − 1,058.33 − 5,000 is negative: nothing`,
			'Net 2,740.00; employer 1,207.36 + 679.14 + 37.73 + 15.09 + 266 = 2,205.32'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2026-06-29'),
			...hire('he', {
				name: 'He Jun',
				from: '2026-07-01',
				wages: [[3798.33, '2026-07-01', null]],
				si: 3798.33,
				hf: { contribution_base: 3798.33, first_ever_account: false }
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'he_job',
				lines: {
					gross: 3798.33,
					net: 2740,
					employer_cost: 2205.32,
					...si([603.68, 1207.36], [150.92, 679.14], [37.73, 37.73], 15.09, 266)
				}
			}
		]
	},
	{
		id: 'CN-SH19-1',
		profile: 'CN-shanghai',
		description:
			'A resident citizen assigned to outdoor work, transferred in on 1 July 2026 on CNY10,000 with the CNY300 summer heat allowance: the allowance is wages for IIT, outside the declared insurance base.',
		citation: [
			'沪人社规〔2019〕19号 items 1–3 (https://service.shanghai.gov.cn/XingZhengWenDangKuJyh/XZGFDetails.aspx?docid=REPORT_NDOC_004501; in force to 31 December 2028 by 沪人社规〔2023〕29号): CNY300 a month June–September for outdoor work, part of 工资总额',
			`${SOURCES.si2026}; ${SOURCES.pension}: 800 / 1,600; ${SOURCES.medical2026}: 200 / 900; ${SOURCES.unemployment2026}: 50 / 50; ${SOURCES.injury}: 20; ${SOURCES.hf2026}: 700 each side`,
			`${SOURCES.iitResident}: 10,300 − 1,750 − 5,000 = 3,550 × 3% = 106.50`,
			'Net 10,300 − 1,750 − 106.50 = 8,443.50; employer 1,600 + 900 + 50 + 20 + 700 = 3,270'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2026-06-29'),
			...hire('xu', {
				name: 'Xu Bin',
				from: '2026-07-01',
				wages: [[10000, '2026-07-01', null]],
				si: 10000,
				hf: { contribution_base: 10000, first_ever_account: false },
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:HEAT_ALLOWANCE', amount: 300 }]
				}
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'xu_job',
				lines: {
					gross: 10300,
					net: 8443.5,
					employer_cost: 3270,
					BASIC: 10000,
					HEAT_ALLOWANCE: 300,
					...si([800, 1600], [200, 900], [50, 50], 20, 700),
					'IIT.employee': 106.5
				}
			}
		]
	},
	{
		id: 'CN-SH13-1',
		profile: 'CN-shanghai',
		description:
			'January 2026, a resident citizen on CNY20,000 marries on 17 January and takes paid marriage leave 19–28 January: the month is paid in full.',
		citation: [
			'Marriage leave at normal pay: 国劳总薪字〔1980〕29号 (1–3 days) plus seven days (上海市计划生育奖励与补助若干规定, 沪府规〔2022〕18号 art.2, https://www.shanghai.gov.cn/nw12344/20221110/87151565cd6246c99854c129797d178c.html): 10 days, no deduction',
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,600 / 3,200; ${SOURCES.medical2025}: 400 / 1,800; ${SOURCES.unemployment2026}: 100 / 100; ${SOURCES.injury}: 40; housing fund 1,400 each side`,
			`${SOURCES.iitResident}: 20,000 − 3,500 − 5,000 = 11,500 × 3% = 345`,
			'Net 16,155; employer 6,540'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('qian', {
				name: 'Qian Hui',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 }
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@qian_job',
					catalogue_id: '@law:leave_catalogue:MARRIAGE_LEAVE',
					reference: 'ML-2026-01',
					from_date: '2026-01-19',
					to_date: '2026-01-28',
					event_kind: 'MARRIAGE',
					event_date: '2026-01-17',
					reason: 'Marriage'
				}
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'qian_job',
				lines: {
					gross: 20000,
					net: 16155,
					employer_cost: 6540,
					BASIC: 20000,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 345
				}
			}
		]
	},
	{
		id: 'CN-SH05-4',
		profile: 'CN-shanghai',
		description:
			'June 2026, the last month of the 2025 contribution year: a resident citizen transferred in on Monday 1 June 2026 on CNY40,000 insures and contributes on the 2025 ceiling 37,302, not the 2026 37,731 that CN-SH40-1 charges from 1 July.',
		citation: [
			`${SOURCES.si2025} (to 30 June 2026; the 2026 bounds start 1 July, CN-SH05): 40,000 → 37,302`,
			`${SOURCES.pension}: 2,984.16 / 5,968.32; ${SOURCES.medical2026}: 746.04 / 3,357.18; ${SOURCES.unemployment2026}: 186.51 / 186.51; ${SOURCES.injury}: 74.604 → 74.60`,
			`${SOURCES.hf2025} (the 2025 contribution year runs to 30 June 2026, CN-SH09); a transferred worker contributes from the first month (Regulation art.17): 37,302 × 7% = 2,611.14 → 2,611 each side`,
			`${SOURCES.iitResident}: June is the first month employed here: 40,000 − 6,527.71 − 5,000 = 28,472.29 × 3% = 854.1687 → 854.17`,
			'Net 40,000 − 6,527.71 − 854.17 = 32,618.12; employer 5,968.32 + 3,357.18 + 186.51 + 74.60 + 2,611 = 12,197.61'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2026-06-01'),
			...hire('kong', {
				name: 'Kong Rui',
				from: '2026-06-01',
				wages: [[40000, '2026-06-01', null]],
				si: 40000,
				hf: { contribution_base: 40000, first_ever_account: false }
			})
		],
		period: '2026-06',
		expected: [
			{
				employment: 'kong_job',
				lines: {
					gross: 40000,
					net: 32618.12,
					employer_cost: 12197.61,
					BASIC: 40000,
					...si([2984.16, 5968.32], [746.04, 3357.18], [186.51, 186.51], 74.6, 2611),
					'IIT.employee': 854.17
				}
			}
		]
	},
	{
		id: 'CN-SH09-3',
		profile: 'CN-shanghai',
		description:
			'December 2025, a unit that elected the 5% supplementary fund: a resident citizen transferred in on 1 December on CNY10,010; the ordinary 700.70 and supplementary 500.50 shares round to the yuan separately (701 + 501 = 1,202, not 1,201.20 → 1,201).',
		citation: [
			`${SOURCES.si2025}; ${SOURCES.pension}: 800.80 / 1,601.60; ${SOURCES.medical2025}: 200.20 / 900.90; ${SOURCES.unemployment2025}: 50.05 / 50.05; ${SOURCES.injury2025}: 20.02`,
			`${SOURCES.hf2025}; supplementary 1–5% equal each side where the unit elected it (沪公积金管委会〔2025〕8号; CN-SH09): 10,010 × 7% = 700.70 → 701 plus × 5% = 500.50 → 501, 1,202 each side (each share 四舍五入 separately, the centre's 2025 Q&A)`,
			`${SOURCES.iitResident}: 10,010 − 2,253.05 − 5,000 = 2,756.95 × 3% = 82.7085 → 82.71`,
			'Net 10,010 − 2,253.05 − 82.71 = 7,674.24; employer 1,601.60 + 900.90 + 50.05 + 20.02 + 1,202 = 3,774.57'
		],
		company: { facts: { ...FACTS, housing_fund_supplementary_rate: 5 } },
		inputs: [
			...cnWeek('2025-12-01'),
			...hire('fang', {
				name: 'Fang Yu',
				from: '2025-12-01',
				wages: [[10010, '2025-12-01', null]],
				si: 10010,
				hf: { contribution_base: 10010, first_ever_account: false }
			})
		],
		period: '2025-12',
		expected: [
			{
				employment: 'fang_job',
				lines: {
					gross: 10010,
					net: 7674.24,
					employer_cost: 3774.57,
					BASIC: 10010,
					...si([800.8, 1601.6], [200.2, 900.9], [50.05, 50.05], 20.02, 1202),
					'IIT.employee': 82.71
				}
			}
		]
	},
	{
		id: 'CN-SH19-2',
		profile: 'CN-shanghai',
		description:
			'May 2026, a resident citizen assigned to outdoor work with the CNY300 heat allowance on the contract, transferred in on 1 May 2026 on CNY10,000: May is outside June–September, so no allowance is paid.',
		citation: [
			'沪人社规〔2019〕19号 items 1–3 (https://service.shanghai.gov.cn/XingZhengWenDangKuJyh/XZGFDetails.aspx?docid=REPORT_NDOC_004501; in force to 31 December 2028 by 沪人社规〔2023〕29号): the allowance is paid for June to September only: nothing in May',
			`${SOURCES.si2025}; ${SOURCES.pension}: 800 / 1,600; ${SOURCES.medical2026}: 200 / 900; ${SOURCES.unemployment2026}: 50 / 50; ${SOURCES.injury}: 20; ${SOURCES.hf2025}: 700 each side`,
			`${SOURCES.iitResident}: May is the first month employed here: 10,000 − 1,750 − 5,000 = 3,250 × 3% = 97.50`,
			'Net 10,000 − 1,750 − 97.50 = 8,152.50; employer 1,600 + 900 + 50 + 20 + 700 = 3,270'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2026-04-27'),
			...hire('tang', {
				name: 'Tang Wei',
				from: '2026-05-01',
				wages: [[10000, '2026-05-01', null]],
				si: 10000,
				hf: { contribution_base: 10000, first_ever_account: false },
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:HEAT_ALLOWANCE', amount: 300 }]
				}
			})
		],
		period: '2026-05',
		expected: [
			{
				employment: 'tang_job',
				lines: {
					gross: 10000,
					net: 8152.5,
					employer_cost: 3270,
					BASIC: 10000,
					...si([800, 1600], [200, 900], [50, 50], 20, 700),
					'IIT.employee': 97.5
				}
			}
		]
	},
	{
		id: 'CN-SH43-2',
		profile: 'CN-shanghai',
		description:
			'The CN-SH43-1 first-ever worker (hired Monday 15 December 2025 on CNY21,750) in January 2026, the second month: the housing fund now charges on 本人当月工资 21,750; December runs first.',
		citation: [
			'Housing fund: a new worker contributes from the second month on 本人当月工资 × rate (Housing Provident Fund Regulation art.17, https://www.gov.cn/zhengce/content/202608/content_7078477.htm; 沪公积金管委会〔2023〕3号 arts.16–21; CN-SH43): 21,750 × 7% = 1,522.50 → 1,523 each side',
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,740 / 3,480; ${SOURCES.medical2025}: 435 / 1,957.50; ${SOURCES.unemployment2026}: 108.75 / 108.75; ${SOURCES.injury}: 43.50`,
			`${SOURCES.iitResident}: January is the first month of the tax year: 21,750 − 3,806.75 − 5,000 = 12,943.25 × 3% = 388.2975 → 388.30`,
			'Net 21,750 − 3,806.75 − 388.30 = 17,554.95; employer 3,480 + 1,957.50 + 108.75 + 43.50 + 1,523 = 7,112.75'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-01'),
			...hire('chen', {
				name: 'Chen Jie',
				from: '2025-12-15',
				wages: [[21750, '2025-12-15', null]],
				si: 21750,
				hf: { contribution_base: 21750, first_ever_account: true }
			}),
			run('2025-12')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'chen_job',
				lines: {
					gross: 21750,
					net: 17554.95,
					employer_cost: 7112.75,
					BASIC: 21750,
					...si([1740, 3480], [435, 1957.5], [108.75, 108.75], 43.5, 1523),
					'IIT.employee': 388.3
				}
			}
		]
	}
);

// ─────────────────────────── Round 9 (30 Sep 2026): branches the register named as unproven ───────────

const MIN_WAGE =
	'沪人社规〔2025〕10号 items 1(2), 4 (https://rsj.sh.gov.cn/tgzfl_17732/20250714/t0035_1434097.html): from 1 July 2025 the full-time monthly minimum is CNY2,740, excluding overtime pay, the middle/night-shift, high/low-temperature, underground and hazard allowances, meals, commute and housing subsidies, and the employee’s own social insurance and housing fund; 最低工资规定 (MOLSS Order 21) art.12 forbids paying below it (CN-SH01, CN-N50)';
const LEAVE_PAY =
	'工资支付暂行规定 (劳部发〔1994〕489号) art.11 (https://www.mohrss.gov.cn/xxgk2020/gzk/gz/202112/t20211228_431557.html): during statutory leave the employer pays the wage at the contract standard: no deduction';
const JAN_20000 = [
	`${SOURCES.si2025}; ${SOURCES.pension}: 1,600 / 3,200; ${SOURCES.medical2025}: 400 / 1,800; ${SOURCES.unemployment2026}: 100 / 100; ${SOURCES.injury}: 40; housing fund 1,400 each side`,
	`${SOURCES.iitResident}: January is the first month of the tax year: 20,000 − 3,500 − 5,000 = 11,500 × 3% = 345`,
	'Net 20,000 − 3,500 − 345 = 16,155; employer 3,200 + 1,800 + 100 + 40 + 1,400 = 6,540'
];
const JAN_20000_LINES = {
	gross: 20000,
	net: 16155,
	employer_cost: 6540,
	BASIC: 20000,
	...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
	'IIT.employee': 345
};

/** January 2026, one resident citizen on CNY20,000 (in service since June 2025) taking one paid statutory leave. */
const paidLeaveJan = (
	id: string,
	description: string,
	citation: string,
	who: Partial<Hire>,
	leave: Row,
	files?: { readonly [field: string]: string }
): ProbeCase => ({
	id,
	profile: 'CN-shanghai',
	description,
	citation: [citation, LEAVE_PAY, ...JAN_20000],
	company: { facts: FACTS },
	inputs: [
		...cnWeek('2025-06-02'),
		...hire('p', {
			name: `Parent ${id}`,
			from: '2025-06-02',
			wages: [[20000, '2025-06-02', null]],
			si: 20000,
			hf: { contribution_base: 20000 },
			...who
		}),
		{
			collection: 'leave_entries',
			values: { employment_id: '@p_job', reference: id, reason: id, ...leave },
			...(files === undefined ? {} : { files })
		}
	],
	period: '2026-01',
	expected: [{ employment: 'p_job', lines: JAN_20000_LINES }]
});

const iitRegistration = (ref: string, status: Row, from = '2025-06-02'): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: `@${ref}`,
		employment_id: `@${ref}_job`,
		statutory_contribution_id: '@law:statutory_contributions:IIT',
		effective_range: { from, to: null },
		status: { kind: 'REGISTERED', reference_number: `PROBE-IIT-${ref}`, ...status }
	}
});

/** An ad hoc request of the lineage's catalogue class `code`. */
const bonus = (ref: string, code: string, amount: number, date: string): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		reason: code
	}
});

register(
	{
		id: 'CN-SH01-2',
		profile: 'CN-shanghai',
		description:
			'January 2026, a full-time resident citizen contracted at CNY2,740 gross: less the employee’s own pension, medical, unemployment and housing-fund shares it nets 1,764.70, under the 2,740 floor: the run is refused.',
		citation: [
			MIN_WAGE,
			`${SOURCES.si2025}: 2,740 insures on the 7,460 floor: pension 596.80, medical 149.20, unemployment 37.30 (the recorded 0.5%); ${SOURCES.hf2025}: 2,740 × 7% = 191.80 → 192. Shares 975.30; 2,740 − 975.30 = 1,764.70 < 2,740`
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('low', {
				name: 'Lu Xiaomei',
				gender: 'FEMALE',
				from: '2025-06-02',
				wages: [[2740, '2025-06-02', null]],
				si: 2740,
				hf: { contribution_base: 2740 }
			})
		],
		period: '2026-01',
		refused: 'MINIMUM_WAGE_BELOW: SH-low is contracted at 1764.7 a month net of 975.3 employee',
		expected: []
	},
	{
		id: 'CN-SH01-3',
		profile: 'CN-shanghai',
		description:
			'July 2026, an outdoor worker transferred in on 1 July on CNY3,700 with the CNY300 heat allowance: the allowance is outside the minimum-wage comparison, so the contract nets 2,648.67 against 2,740 and the run is refused although 3,700 + 300 would pass.',
		citation: [
			MIN_WAGE,
			'沪人社规〔2019〕19号 items 1–3 (https://service.shanghai.gov.cn/XingZhengWenDangKuJyh/XZGFDetails.aspx?docid=REPORT_NDOC_004501): the CNY300 heat allowance, June–September (CN-SH19); item 1(2) of the minimum-wage notice leaves it out of the comparison',
			`${SOURCES.si2026}: 3,700 insures on the 7,546 floor: pension 603.68, medical 150.92, unemployment 37.73; ${SOURCES.hf2026}: 3,700 × 7% = 259. Shares 1,051.33; 3,700 − 1,051.33 = 2,648.67 < 2,740 (with the allowance it would be 2,948.67)`
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2026-06-29'),
			...hire('heat', {
				name: 'Qiu Dong',
				from: '2026-07-01',
				wages: [[3700, '2026-07-01', null]],
				si: 3700,
				hf: { contribution_base: 3700, first_ever_account: false },
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:HEAT_ALLOWANCE', amount: 300 }]
				}
			})
		],
		period: '2026-07',
		refused: 'MINIMUM_WAGE_BELOW: SH-heat is contracted at 2648.67 a month net of 1051.33 employee',
		expected: []
	},
	{
		id: 'CN-SH02-1',
		profile: 'CN-shanghai',
		description:
			'January 2026, two resident citizens on CNY22,000 resign: one on Thursday 15 January, one on Saturday 31 January. The month-end run pays the first after her exit day and says so; the second is paid on time.',
		citation: [
			'上海市企业工资支付办法 item 7 (the 2016 measure in force to 31 July 2026, https://rsj.sh.gov.cn/tgzfl_17732/20260412/t0035_1439868.html; the same item in 沪人社规〔2026〕10号): on ending the contract the enterprise pays the wages in one sum 在与劳动者办妥手续时; the exit day stands for that date (recorded default, CN-SH02). The January run pays on 31 January: late for the 15 January leaver, not for the 31 January one',
			`${SOURCES.proration}: 1–15 January 2026 has 11 working days (no company holiday recorded) → 22,000 ÷ 21.75 × 11 = 11,126.44; the other a whole month 22,000`,
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,760 / 3,520; ${SOURCES.medical2025}: 440 / 1,980; ${SOURCES.unemployment2026}: 110 / 110; ${SOURCES.injury}: 44; housing fund 22,000 × 7% = 1,540 each side, due for the exit month in which wages are paid (沪公积金管委会〔2023〕3号 arts.16–21; CN-SH43)`,
			`${SOURCES.iitResident}: 11,126.44 − 3,850 − 5,000 = 2,276.44 × 3% = 68.2932 → 68.29; 22,000 − 3,850 − 5,000 = 13,150 × 3% = 394.50`,
			'Net 11,126.44 − 3,850 − 68.29 = 7,208.15 and 22,000 − 3,850 − 394.50 = 17,755.50; employer 3,520 + 1,980 + 110 + 44 + 1,540 = 7,194 each. A resignation (LCL art.37) owes no compensation (art.46)'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...(
				[
					['mid', 'Yao Jing', '2026-01-15'],
					['end', 'Guo Rui', '2026-01-31']
				] as const
			).flatMap(([ref, name, to]) =>
				hire(ref, {
					name,
					gender: 'FEMALE',
					from: '2025-06-02',
					to,
					wages: [[22000, '2025-06-02', to]],
					si: 22000,
					hf: { contribution_base: 22000 },
					employment: {
						exit_reason: 'RESIGNATION',
						exit_facts: { lcl_termination_ground: 'ART_37' }
					}
				})
			)
		],
		period: '2026-01',
		warnings: ['FINAL_PAY_LATE: SH-mid left on 2026-01-15.*by 2026-01-15.*pays on 2026-01-31'],
		expected: [
			{
				employment: 'mid_job',
				lines: {
					gross: 11126.44,
					net: 7208.15,
					employer_cost: 7194,
					BASIC: 11126.44,
					...si([1760, 3520], [440, 1980], [110, 110], 44, 1540),
					'IIT.employee': 68.29
				}
			},
			{
				employment: 'end_job',
				lines: {
					gross: 22000,
					net: 17755.5,
					employer_cost: 7194,
					BASIC: 22000,
					...si([1760, 3520], [440, 1980], [110, 110], 44, 1540),
					'IIT.employee': 394.5
				}
			}
		]
	},
	{
		id: 'CN-SH03-2',
		profile: 'CN-shanghai',
		description:
			'January 2026, two resident citizens on CNY21,750: one is paid a CNY5,000 bonus and works two extended hours on Tuesday 6 January — the overtime hour stays 125, the bonus is outside the base; the other works three hours on rest day Saturday 10 January with compensatory rest arranged — no rest-day premium.',
		citation: [
			'Labour Law art.44 (https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html): 150% for extended hours; 休息日安排劳动者工作又不能安排补休的 200% — with compensatory rest arranged, no premium (CN-N01, CN-N40). 上海市企业工资支付办法 item 9 (https://rsj.sh.gov.cn/tgzfl_17732/20260412/t0035_1439868.html; CN-SH03): the overtime base is the normal monthly wage of the post, excluding bonuses: 21,750 ÷ 21.75 ÷ 8 = 125; 2 × 125 × 1.5 = 375',
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,740 / 3,480; ${SOURCES.medical2025}: 435 / 1,957.50; ${SOURCES.unemployment2026}: 108.75 / 108.75; ${SOURCES.injury}: 43.50; housing fund 1,522.50 → 1,523 each side — the declared base, not the bonus month`,
			`${SOURCES.iitResident}: 27,125 − 3,806.75 − 5,000 = 18,318.25 × 3% = 549.5475 → 549.55; 21,750 − 3,806.75 − 5,000 = 12,943.25 × 3% = 388.2975 → 388.30`,
			'Net 27,125 − 3,806.75 − 549.55 = 22,768.70 and 21,750 − 3,806.75 − 388.30 = 17,554.95; employer 7,112.75 each'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('ye', {
				name: 'Ye Fei',
				from: '2025-06-02',
				wages: [[21750, '2025-06-02', null]],
				si: 21750,
				hf: { contribution_base: 21750 }
			}),
			...hire('mo', {
				name: 'Mo Lan',
				gender: 'FEMALE',
				from: '2025-06-02',
				wages: [[21750, '2025-06-02', null]],
				si: 21750,
				hf: { contribution_base: 21750 }
			}),
			bonus('ye', 'BONUS', 5000, '2026-01-20'),
			{
				collection: 'work_days',
				values: {
					employment_id: '@ye_job',
					work_date: '2026-01-06',
					shift_definition_id: '@office',
					worked_intervals: [
						{ start: '2026-01-06T01:00:00.000Z', end: '2026-01-06T12:00:00.000Z' }
					],
					approved_overtime_hours: 2,
					time_off_in_lieu: false
				}
			},
			{
				collection: 'work_days',
				values: {
					employment_id: '@mo_job',
					work_date: '2026-01-10',
					shift_definition_id: '@rest',
					worked_intervals: [
						{ start: '2026-01-10T01:00:00.000Z', end: '2026-01-10T04:00:00.000Z' }
					],
					approved_overtime_hours: 3,
					time_off_in_lieu: true
				}
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'ye_job',
				lines: {
					gross: 27125,
					net: 22768.7,
					employer_cost: 7112.75,
					BASIC: 21750,
					BONUS: 5000,
					...si([1740, 3480], [435, 1957.5], [108.75, 108.75], 43.5, 1523),
					'IIT.employee': 549.55
				}
			},
			{
				employment: 'mo_job',
				lines: {
					gross: 21750,
					net: 17554.95,
					employer_cost: 7112.75,
					BASIC: 21750,
					...si([1740, 3480], [435, 1957.5], [108.75, 108.75], 43.5, 1523),
					'IIT.employee': 388.3
				}
			}
		]
	},
	{
		id: 'CN-SH06-1',
		profile: 'CN-shanghai',
		description:
			'February 2026, the last month of 沪医保规〔2025〕2号: a resident citizen on CNY20,000 is charged medical 9% / 2% under the 2025 instrument (the 1 March 2026 successor keeps both rates, CN-SH05-3); January runs first.',
		citation: [
			`${SOURCES.medical2025}: 20,000 × 2% = 400, × 9% = 1,800`,
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,600 / 3,200; ${SOURCES.unemployment2026}: 100 / 100; ${SOURCES.injury}: 40; housing fund 1,400 each side`,
			`${SOURCES.iitResident}: February cumulative 40,000 − 7,000 − 10,000 = 23,000 × 3% = 690 − 345 withheld in January = 345`,
			'Net 20,000 − 3,500 − 345 = 16,155; employer 6,540'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('du', {
				name: 'Du Hong',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 }
			}),
			run('2026-01')
		],
		period: '2026-02',
		expected: [{ employment: 'du_job', lines: JAN_20000_LINES }]
	},
	{
		id: 'CN-SH07-1',
		profile: 'CN-shanghai',
		description:
			'January 2026, a unit the agency assigned to industry class VIII (1.9%, no float): work injury on CNY20,000 is 380, employer-only.',
		citation: [
			`沪人社规〔2026〕2号 (https://rsj.sh.gov.cn/tshbx_17729/20260121/t0035_1438097.html): classes I–VIII at 0.2 / 0.4 / 0.7 / 0.9 / 1.1 / 1.3 / 1.6 / 1.9%, employer-only; the assigned rate (after any float, 〔2026〕3号) is the agency notice the operator records as \`injury_rate\` (CN-SH07): 20,000 × 1.9% = 380`,
			...JAN_20000.slice(0, 2),
			'Net 16,155; employer 3,200 + 1,800 + 100 + 380 + 1,400 = 6,880'
		],
		company: { facts: { ...FACTS, injury_rate: 1.9 } },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('bai', {
				name: 'Bai Tao',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 }
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'bai_job',
				lines: { ...JAN_20000_LINES, employer_cost: 6880, 'INJURY.employer': 380 }
			}
		]
	},
	paidLeaveJan(
		'CN-SH13-2',
		'January 2026, a married father takes five days of paid partner leave (配偶陪产假), Monday 12 – Friday 16 January, for a birth on 9 January: the month is paid in full.',
		'沪府规〔2022〕18号 art.2 (https://www.shanghai.gov.cn/nw12344/20221110/87151565cd6246c99854c129797d178c.html): the husband has 10 days of 配偶陪产假 at the normal wage during the wife’s maternity leave (CN-SH13); five are taken',
		{ name: 'Hu Jian', employee: { marital_status: 'MARRIED' } },
		{
			catalogue_id: '@law:leave_catalogue:PATERNITY_LEAVE',
			from_date: '2026-01-12',
			to_date: '2026-01-16',
			event_kind: 'BIRTH',
			event_date: '2026-01-09'
		}
	),
	paidLeaveJan(
		'CN-SH13-3',
		'January 2026, a married mother of a child born 1 June 2024 takes two days of paid childcare leave (育儿假), Tuesday 6 – Wednesday 7 January: the month is paid in full.',
		'沪府规〔2022〕18号 art.3 (https://www.shanghai.gov.cn/nw12344/20221110/87151565cd6246c99854c129797d178c.html): each parent has 5 days of 育儿假 a year per child under three, the year running from the child’s birth date (1 June 2025 – 31 May 2026 here), at normal pay (CN-SH13)',
		{
			name: 'Shen Li',
			gender: 'FEMALE',
			employee: {
				marital_status: 'MARRIED',
				children: [{ child_birthdate: '2024-06-01', relationship: 'CHILD', citizenship: 'CITIZEN' }]
			}
		},
		{
			catalogue_id: '@law:leave_catalogue:CHILDCARE_LEAVE',
			from_date: '2026-01-06',
			to_date: '2026-01-07'
		}
	),
	paidLeaveJan(
		'CN-SH17-1',
		'January 2026, a resident citizen handles his father-in-law’s funeral (death on Saturday 17 January): three approved days of paid funeral leave, Monday 19 – Wednesday 21 January; the month is paid in full.',
		'沪劳资发〔87〕130号 (from 15 October 1987, kept in force to 15 August 2031 by 沪人社规〔2026〕12号; https://rsj.sh.gov.cn/tgzfl_17732/20230901/t0035_1418045.html, read 30 Sep 2026): 职工的岳父母或公婆死亡后，需要职工料理丧事的，由本单位行政领导批准，可给予一至三天的丧假 … 在批准的丧假和路程假期间，职工的工资照发; the seed grants the discretionary maximum 3 (owner rule 2026-09-28; CN-SH17)',
		{ name: 'Pan Yu', employee: { marital_status: 'MARRIED' } },
		{
			catalogue_id: '@law:leave_catalogue:FUNERAL_LEAVE',
			from_date: '2026-01-19',
			to_date: '2026-01-21',
			event_kind: 'DEATH',
			event_relationship: 'PARENT_IN_LAW',
			event_date: '2026-01-17'
		}
	),
	paidLeaveJan(
		'CN-SH51-1',
		'January 2026, a resident citizen has an IUD inserted on Tuesday 13 January and takes the two paid days, 13–14 January, with the medical certificate: the month is paid in full.',
		'沪府规〔2022〕18号 art.19 (https://www.shanghai.gov.cn/rkjsqy2/20230417/e10b476cd14d4af6b079f644c0028d60.html, 1 November 2022 – 31 October 2027): 放置宫内节育器 2 days of paid leave from the procedure date (CN-SH51)',
		{ name: 'Xie Ning', gender: 'FEMALE' },
		{
			catalogue_id: '@law:leave_catalogue:FAMILY_PLANNING_PROCEDURE_LEAVE',
			from_date: '2026-01-13',
			to_date: '2026-01-14',
			event_kind: 'IUD_INSERTION',
			event_date: '2026-01-13'
		},
		{ certificate_file: 'iud-certificate.pdf' }
	),
	{
		id: 'CN-SH14-1',
		profile: 'CN-shanghai',
		description:
			'August 2026, a resident citizen on CNY20,000 (in service since June 2025) gives birth on Monday 3 August and is on paid maternity leave all of August’s working days; the fund paid her a CNY15,000 maternity allowance for them, which comes off the leave wage: gross 5,000, the employer paying the shortfall to her wage.',
		citation: [
			'女职工劳动保护特别规定 art.7 (https://xzfg.moj.gov.cn/mobile/law/detail?LawID=343) and 沪府规〔2022〕18号 art.2: 98 + 60 = 158 days (3 August 2026 – 7 January 2027, CN-N20, CN-SH13)',
			'沪医保规〔2026〕5号 item 4 (from 1 July 2026, https://www.shanghai.gov.cn/gwk/search/content/79e981546eaf4727ae47502f4de955b8): 生育生活津贴标准低于本人产假前工资标准的，差额部分由…用人单位…支付; the allowance paid to her (the agency’s figure, recorded with its evidence) offsets the leave days’ wage: 20,000 − 15,000 = 5,000 (owner rule 2026-09-28, 产假前工资 read as the contract wage; CN-SH14)',
			'The allowance is exempt (财税〔2008〕8号) and no wage: IIT on 5,000 − 3,500 − 5,000 × months is negative: nothing',
			`${SOURCES.si2026}; ${SOURCES.pension}: 1,600 / 3,200; ${SOURCES.medical2026}: 400 / 1,800; ${SOURCES.unemployment2026}: 100 / 100; ${SOURCES.injury}: 40; ${SOURCES.hf2026}: 1,400 each side — insurance continues on the declared base during the leave`,
			'Net 5,000 − 3,500 = 1,500; employer 6,540'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('jin', {
				name: 'Jin Mei',
				gender: 'FEMALE',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 },
				employee: { marital_status: 'MARRIED' }
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@jin_job',
					catalogue_id: '@law:leave_catalogue:MATERNITY_LEAVE',
					reference: 'ML-2026-08',
					from_date: '2026-08-03',
					to_date: '2027-01-07',
					event_kind: 'BIRTH',
					event_date: '2026-08-03',
					reason: 'Maternity leave (产假及生育假)'
				}
			},
			{
				...bonus('jin', 'MATERNITY_ALLOWANCE_OFFSET', 15000, '2026-08-31'),
				files: { evidence_file: 'maternity-allowance-notice.pdf' }
			}
		],
		period: '2026-08',
		expected: [
			{
				employment: 'jin_job',
				lines: {
					gross: 5000,
					net: 1500,
					employer_cost: 6540,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400)
				}
			}
		]
	},
	{
		id: 'CN-SH19-3',
		profile: 'CN-shanghai',
		description:
			'August 2026, an outdoor worker transferred in on 1 August on CNY10,000 whose contract carries a CNY500 heat allowance: the higher contract figure is paid, not the 300 floor.',
		citation: [
			'沪人社规〔2019〕19号 items 1–3 (https://service.shanghai.gov.cn/XingZhengWenDangKuJyh/XZGFDetails.aspx?docid=REPORT_NDOC_004501; in force to 31 December 2028 by 沪人社规〔2023〕29号): at least CNY300 a month June–September; a contract figure above it is paid (CN-SH19)',
			`${SOURCES.si2026}; ${SOURCES.pension}: 800 / 1,600; ${SOURCES.medical2026}: 200 / 900; ${SOURCES.unemployment2026}: 50 / 50; ${SOURCES.injury}: 20; ${SOURCES.hf2026}: 700 each side — the allowance outside the declared base`,
			`${SOURCES.iitResident}: August is the first month employed here: 10,500 − 1,750 − 5,000 = 3,750 × 3% = 112.50`,
			'Net 10,500 − 1,750 − 112.50 = 8,637.50; employer 3,270'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2026-07-27'),
			...hire('lei', {
				name: 'Lei Zhen',
				from: '2026-08-01',
				wages: [[10000, '2026-08-01', null]],
				si: 10000,
				hf: { contribution_base: 10000, first_ever_account: false },
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:HEAT_ALLOWANCE', amount: 500 }]
				}
			})
		],
		period: '2026-08',
		expected: [
			{
				employment: 'lei_job',
				lines: {
					gross: 10500,
					net: 8637.5,
					employer_cost: 3270,
					BASIC: 10000,
					HEAT_ALLOWANCE: 500,
					...si([800, 1600], [200, 900], [50, 50], 20, 700),
					'IIT.employee': 112.5
				}
			}
		]
	},
	{
		id: 'CN-SH40-2',
		profile: 'CN-shanghai',
		description:
			'July 2026, a resident citizen on CNY4,100 hired Monday 22 December 2025, whose 2025 monthly average wage (one part month, 1,508.05) is declared as both bases: insurance lifts to the 7,546 floor and the housing fund to the new 2,740 floor.',
		citation: [
			`${SOURCES.hf2026}: the base is the 2025 monthly average wage (沪公积金管委会〔2023〕3号 art.16) — 22–31 December 2025, 8 working days: 4,100 ÷ 21.75 × 8 = 1,508.05 — clamped up to 2,740: 2,740 × 7% = 191.80 → 192 each side`,
			`${SOURCES.si2026}: 1,508.05 → 7,546; ${SOURCES.pension}: 603.68 / 1,207.36; ${SOURCES.medical2026}: 150.92 / 679.14; ${SOURCES.unemployment2026}: 37.73 / 37.73; ${SOURCES.injury}: 15.09`,
			`${MIN_WAGE}: 4,100 − 984.33 = 3,115.67 ≥ 2,740`,
			`${SOURCES.iitResident}: 4,100 − 984.33 − 5,000 is negative: nothing`,
			'Net 3,115.67; employer 1,207.36 + 679.14 + 37.73 + 15.09 + 192 = 2,131.32'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-22'),
			...hire('wen', {
				name: 'Wen Jia',
				gender: 'FEMALE',
				from: '2025-12-22',
				wages: [[4100, '2025-12-22', null]],
				si: 1508.05,
				hf: { contribution_base: 1508.05 }
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'wen_job',
				lines: {
					gross: 4100,
					net: 3115.67,
					employer_cost: 2131.32,
					...si([603.68, 1207.36], [150.92, 679.14], [37.73, 37.73], 15.09, 192)
				}
			}
		]
	},
	{
		id: 'CN-SH50-2',
		profile: 'CN-shanghai',
		description:
			'Two resident citizens hired 1 December 2025 leave on Friday 13 March 2026 by a mutual ending the employer proposed, each with service carried from a transferring employer: CNY43,500 with 180 carried months (capped wage, twelve years) and CNY20,000 with 30 carried months (uncapped, 2 years 9 months → three months); December to February run first.',
		citation: [
			'LCL arts.46(2), 47 (https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html): a month’s wage a year, six months or more a year, under six months half; above three times the city average, the wage is capped and the years at most twelve. Implementing Regulation art.10 (https://xzfg.moj.gov.cn/front/law/detail?LawID=284): service carried from the transferring employer counts (`lcl10_transferred_service_months`, CN-N41)',
			'Service 1 December 2025 – 13 March 2026 = 3 months 13 days. 180 + 3.42 = 183.42 months = 15 years 3 months → 15.5, capped at 12: 43,500 > 3 × 12,577 (2025 average, published 18 Aug 2026, the owner-rule prior calendar year, CN-SH50) → 12 × 37,731 = 452,772. 30 + 3.42 = 33.42 months = 2 years 9 months → 3 × 20,000 = 60,000',
			'财税〔2018〕164号 item 5(1) (http://szs.mof.gov.cn/zhengcefabu/201812/t20181227_3110164.htm): exempt up to 36 × 12,577 = 452,772 — both amounts are within it: no IIT_SEVERANCE (CN-N39)',
			`${SOURCES.proration}: 2–13 March has 10 working days → 43,500 ÷ 21.75 × 10 = 20,000; 20,000 ÷ 21.75 × 10 = 9,195.40`,
			`${SOURCES.si2025}: 43,500 → 37,302: 2,984.16 / 5,968.32, 746.04 / 3,357.18, 186.51 / 186.51, 74.60, fund 2,611; 20,000: 1,600 / 3,200, 400 / 1,800, 100 / 100, 40, fund 1,400`,
			`${SOURCES.iitResident}: January 959.17 and February 2,915.29 (CN-SH50-1); March cumulative 107,000 − 19,583.13 − 15,000 = 72,416.87 × 10% − 2,520 = 4,721.687 − 3,874.46 = 847.23. January 345, February 345; March cumulative 49,195.40 − 10,500 − 15,000 = 23,695.40 × 3% = 710.862 − 690 = 20.86`,
			'Net 472,772 − 6,527.71 − 847.23 = 465,397.06 and 69,195.40 − 3,500 − 20.86 = 65,674.54; employer 12,197.61 and 6,540'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-01'),
			...(
				[
					['qin', 'Qin Hao', 43500, 180],
					['lu', 'Lu Wen', 20000, 30]
				] as const
			).flatMap(([ref, name, wage, carried]) =>
				hire(ref, {
					name,
					from: '2025-12-01',
					to: '2026-03-13',
					wages: [[wage, '2025-12-01', '2026-03-13']],
					si: wage,
					hf: { contribution_base: wage, first_ever_account: false },
					employment: {
						exit_reason: 'MUTUAL',
						exit_facts: {
							lcl_termination_ground: 'ART_36_EMPLOYER',
							lcl10_transferred_service_months: carried
						}
					}
				})
			),
			run('2025-12'),
			run('2026-01'),
			run('2026-02'),
			bonus('qin', 'SEVERANCE_PAY', 0, '2026-03-13'),
			bonus('lu', 'SEVERANCE_PAY', 0, '2026-03-13')
		],
		period: '2026-03',
		expected: [
			{
				employment: 'qin_job',
				lines: {
					gross: 472772,
					net: 465397.06,
					employer_cost: 12197.61,
					BASIC: 20000,
					SEVERANCE_PAY: 452772,
					...si([2984.16, 5968.32], [746.04, 3357.18], [186.51, 186.51], 74.6, 2611),
					'IIT.employee': 847.23
				}
			},
			{
				employment: 'lu_job',
				lines: {
					gross: 69195.4,
					net: 65674.54,
					employer_cost: 6540,
					BASIC: 9195.4,
					SEVERANCE_PAY: 60000,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 20.86
				}
			}
		]
	},
	{
		id: 'CN-SH50-3',
		profile: 'CN-shanghai',
		description:
			'A resident citizen hired 1 December 2025 on CNY50,000 leaves on Wednesday 31 December 2025 by a mutual ending the employer proposed: half a month at the three-times cap on the 2024 average 12,434 (a 2025 exit), the one month worked averaged at the wage due.',
		citation: [
			'LCL arts.46(2), 47 (https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html): under six months is half a month; under twelve months the average is over the months worked, the wage due (Implementing Regulation art.27; the contract month for a leaver hired in the exit month, CN-SH-A2 recorded default): 50,000',
			'Cap: a 2025 exit reads the 2024 city average CNY12,434 (2025 HRSS notice, https://rsj.sh.gov.cn/tgsgg_17341/20250918/t0035_1435637.html; owner rule prior calendar year, CN-SH50): 3 × 12,434 = 37,302 < 50,000 → 0.5 × 37,302 = 18,651; exempt below 36 × 12,434 = 447,624 (财税〔2018〕164号 item 5(1))',
			`${SOURCES.si2025}; ${SOURCES.hf2025}: bases clamp to 37,302 (as CN-SH05-2): 2,984.16 / 5,968.32, 746.04 / 3,357.18, 186.51 / 186.51, 74.60, fund 2,611`,
			`${SOURCES.iitResident}: December is the only month employed here in 2025: 50,000 − 6,527.71 − 5,000 = 38,472.29 × 10% − 2,520 = 1,327.23`,
			'Net 68,651 − 6,527.71 − 1,327.23 = 60,796.06; employer 12,197.61'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-12-01'),
			...hire('dong', {
				name: 'Dong Xu',
				from: '2025-12-01',
				to: '2025-12-31',
				wages: [[50000, '2025-12-01', '2025-12-31']],
				si: 50000,
				hf: { contribution_base: 50000, first_ever_account: false },
				employment: {
					exit_reason: 'MUTUAL',
					exit_facts: { lcl_termination_ground: 'ART_36_EMPLOYER' }
				}
			}),
			bonus('dong', 'SEVERANCE_PAY', 0, '2025-12-31')
		],
		period: '2025-12',
		expected: [
			{
				employment: 'dong_job',
				lines: {
					gross: 68651,
					net: 60796.06,
					employer_cost: 12197.61,
					BASIC: 50000,
					SEVERANCE_PAY: 18651,
					...si([2984.16, 5968.32], [746.04, 3357.18], [186.51, 186.51], 74.6, 2611),
					'IIT.employee': 1327.23
				}
			}
		]
	},
	{
		id: 'CN-N10-2',
		profile: 'CN-shanghai',
		description:
			'January 2026, a foreign non-resident on CNY30,000 (at the Shanghai unit since March 2024, fewer than 183 days in China in 2025) is paid a CNY60,000 bonus for several months: taxed apart from the wage over six months, no insurance relief on either.',
		citation: [
			'MOF/STA 2019 No.35 item 3(2) (https://fgk.chinatax.gov.cn/zcfgk/c102416/c5202332/content.html): 当月数月奖金应纳税额=[（数月奖金收入额÷6）×适用税率－速算扣除数]×6, once per non-resident per calendar year: [(60,000 ÷ 6) × 10% − 210] × 6 = 4,740 (transcribed into every Shanghai version 30 Sep 2026; CN-N10, CN-KM-A1)',
			`${SOURCES.iitNonResident}: 30,000 − 5,000 = 25,000 × 20% − 1,410 = 3,590`,
			`${SOURCES.si2025}: 30,000 in bounds; foreign employees are insured like citizens (CN-N25): ${SOURCES.pension} 2,400 / 4,800; ${SOURCES.medical2025} 600 / 2,700; ${SOURCES.unemployment2026} 150 / 150; ${SOURCES.injury} 60. No fund without agreement (CN-SH41)`,
			'Net 90,000 − 3,150 − 3,590 − 4,740 = 78,520; employer 4,800 + 2,700 + 150 + 60 = 7,710'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2024-03-04'),
			...hire('klein', {
				name: 'Jonas Klein',
				nationality: 'German',
				from: '2024-03-01',
				wages: [[30000, '2024-03-01', null]],
				residency: 'FOREIGNER',
				tax: 'NON_RESIDENT',
				si: 30000,
				hf: { contribution_base: 30000, voluntary_agreement: false }
			}),
			bonus('klein', 'ANNUAL_BONUS_SEPARATE', 60000, '2026-01-20')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'klein_job',
				lines: {
					gross: 90000,
					net: 78520,
					employer_cost: 7710,
					BASIC: 30000,
					ANNUAL_BONUS_SEPARATE: 60000,
					...si([2400, 4800], [600, 2700], [150, 150], 60),
					'IIT.employee': 3590,
					'IIT_BONUS.employee': 4740
				}
			}
		]
	},
	{
		id: 'CN-N10-3',
		profile: 'CN-shanghai',
		description:
			'A resident citizen on CNY20,000 has a CNY12,000 annual bonus taxed separately in January 2026 and a second one requested for February: the separate method is once per tax year, so the February run is refused.',
		citation: [
			'MOF/STA 2023 No.30 (https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211524/content.html) and 国税发〔2005〕9号 item 3 (https://www.chinatax.gov.cn/n810341/n810765/n812188/n812950/c1201370/content.html): 在一个纳税年度内，对每一个纳税人，该计税办法只允许采用一次 (CN-N10)'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('feng', {
				name: 'Feng Yi',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 }
			}),
			bonus('feng', 'ANNUAL_BONUS_SEPARATE', 12000, '2026-01-20'),
			run('2026-01'),
			bonus('feng', 'ANNUAL_BONUS_SEPARATE', 12000, '2026-02-20')
		],
		period: '2026-02',
		refused: 'once per tax year',
		expected: []
	},
	{
		id: 'CN-N11-1',
		profile: 'CN-shanghai',
		description:
			'January 2026, two resident citizens with IIT declarations: one on CNY10,000 elected the 60,000 annual basic deduction from January; one on CNY20,000 declares CNY2,000 of housing rent, capped at 1,500.',
		citation: [
			'STA 2020 No.19 (https://fgk.chinatax.gov.cn/zcfgk/c100012/c5194953/content.html): a continuing employee paid no more than 60,000 by this employer last year may have 60,000 deducted from January: 10,000 − 1,750 − 60,000 is negative: nothing (the election is the operator’s record, CN-N11)',
			'国发〔2018〕41号 and 2023 No.14 (https://fgk.chinatax.gov.cn/zcfgk/c100012/c5213592/content.html): housing rent in a municipality at CNY1,500 a month; the agent deducts as declared within the standard (STA 2022 No.7 arts.25–26; CN-N16, CN-N54): 20,000 − 3,500 − 5,000 − 1,500 = 10,000 × 3% = 300',
			`${SOURCES.si2025}; 10,000: pension 800 / 1,600, medical 200 / 900, unemployment 50 / 50, injury 20, fund 700; 20,000: 1,600 / 3,200, 400 / 1,800, 100 / 100, 40, fund 1,400`,
			'Net 10,000 − 1,750 = 8,250 and 20,000 − 3,500 − 300 = 16,200; employer 3,270 and 6,540'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('tian', {
				name: 'Tian Bo',
				from: '2025-06-02',
				wages: [[10000, '2025-06-02', null]],
				si: 10000,
				hf: { contribution_base: 10000 }
			}),
			iitRegistration('tian', { elections: { annual_60000_from_january: true } }),
			...hire('yan', {
				name: 'Yan Ling',
				gender: 'FEMALE',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 }
			}),
			iitRegistration('yan', {
				deduction_claims: [
					{
						period: '2026-01',
						category: 'HOUSING_RENT',
						amount: 2000,
						source: 'EMPLOYEE',
						reference: 'RENT-2026-01'
					}
				]
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'tian_job',
				lines: {
					gross: 10000,
					net: 8250,
					employer_cost: 3270,
					...si([800, 1600], [200, 900], [50, 50], 20, 700)
				}
			},
			{
				employment: 'yan_job',
				lines: {
					gross: 20000,
					net: 16200,
					employer_cost: 6540,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 300
				}
			}
		]
	},
	{
		id: 'CN-N44-1',
		profile: 'CN-shanghai',
		description:
			'July 2026, two resident citizens transferred in on 1 July on CNY20,000: one declares July is her first wage income of the year and deducts 5,000 from January; the other does not.',
		citation: [
			'STA 2020 No.13 (https://fgk.chinatax.gov.cn/): a resident whose first wage income of the year arrives mid-year deducts 5,000 × the months from January: 20,000 − 3,500 − 35,000 is negative: nothing (CN-N44); without the declaration July is month one here: 20,000 − 3,500 − 5,000 = 11,500 × 3% = 345 (STA 2018 No.61 art.6)',
			`${SOURCES.si2026}; ${SOURCES.pension}: 1,600 / 3,200; ${SOURCES.medical2026}: 400 / 1,800; ${SOURCES.unemployment2026}: 100 / 100; ${SOURCES.injury}: 40; ${SOURCES.hf2026}: 1,400 each side (a transferred account from the first month)`,
			'Net 16,500 and 16,155; employer 6,540 each'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2026-06-29'),
			...hire('qu', {
				name: 'Qu Yue',
				gender: 'FEMALE',
				from: '2026-07-01',
				wages: [[20000, '2026-07-01', null]],
				si: 20000,
				hf: { contribution_base: 20000, first_ever_account: false }
			}),
			iitRegistration('qu', { elections: { first_wage_income_this_year: true } }, '2026-07-01'),
			...hire('rao', {
				name: 'Rao Kai',
				from: '2026-07-01',
				wages: [[20000, '2026-07-01', null]],
				si: 20000,
				hf: { contribution_base: 20000, first_ever_account: false }
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'qu_job',
				lines: {
					gross: 20000,
					net: 16500,
					employer_cost: 6540,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400)
				}
			},
			{
				employment: 'rao_job',
				lines: {
					gross: 20000,
					net: 16155,
					employer_cost: 6540,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 345
				}
			}
		]
	}
);

// ─────────────────────────── Round 9b (30 Sep 2026): further branches the register named as unproven ──

/** A January 2026 resident on CNY20,000 (in service since June 2025) with an IIT registration carrying `claims`. */
const claimant = (
	id: string,
	description: string,
	citation: string[],
	claims: Row[]
): ProbeCase => ({
	id,
	profile: 'CN-shanghai',
	description,
	citation,
	company: { facts: FACTS },
	inputs: [
		...cnWeek('2025-06-02'),
		...hire('c', {
			name: `Claimant ${id}`,
			from: '2025-06-02',
			wages: [[20000, '2025-06-02', null]],
			si: 20000,
			hf: { contribution_base: 20000 }
		}),
		iitRegistration('c', {
			deduction_claims: claims.map((claim) => ({
				period: '2026-01',
				source: 'EMPLOYEE',
				reference: `${String(claim.category)}-2026-01`,
				...claim
			}))
		})
	],
	period: '2026-01',
	expected: []
});

register(
	{
		...claimant(
			'CN-N54-1',
			'January 2026, a resident declares both CNY1,500 of housing rent and CNY1,000 of housing-loan interest: the two cannot be deducted in one year, so the run is refused.',
			[
				'国发〔2018〕41号 housing-rent article: 纳税人及其配偶在一个纳税年度内不能同时分别享受住房贷款利息和住房租金专项附加扣除 (CN-N54; the seeded IIT refusal)'
			],
			[
				{ category: 'HOUSING_RENT', amount: 1500 },
				{ category: 'HOUSING_LOAN_INTEREST', amount: 1000 }
			]
		),
		refused: 'Housing rent and housing-loan interest cannot both be deducted in one year'
	},
	{
		...claimant(
			'CN-N16-1',
			'January 2026, a resident declares CNY2,000 child education for one child and CNY3,000 elderly support as an only child: both deducted as declared.',
			[
				'国发〔2023〕13号 (https://fgk.chinatax.gov.cn/zcfgk/c100012/c5213592/content.html, re-read 30 Sep 2026): 子女教育 每个子女每月1000元提高到2000元; 赡养老人 每月2000元提高到3000元 for an only child (CN-N16); the agent deducts as declared (STA 2022 No.7 arts.25–26)',
				`${SOURCES.iitResident}: 20,000 − 3,500 − 5,000 − 2,000 − 3,000 = 6,500 × 3% = 195`,
				`${SOURCES.si2025}: pension 1,600 / 3,200, medical 400 / 1,800, unemployment 100 / 100 (recorded 0.5%), injury 40; housing fund 1,400 each side`,
				'Net 20,000 − 3,500 − 195 = 16,305; employer 6,540'
			],
			[
				{ category: 'CHILD_EDUCATION', amount: 2000 },
				{ category: 'ELDERLY_SUPPORT', amount: 3000 }
			]
		),
		expected: [
			{
				employment: 'c_job',
				lines: {
					gross: 20000,
					net: 16305,
					employer_cost: 6540,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400),
					'IIT.employee': 195
				}
			}
		]
	},
	{
		id: 'CN-SH21-1',
		profile: 'CN-shanghai',
		description:
			'June 2026, the last month of 沪医保规〔2021〕9号: a resident on CNY20,000 (in service since June 2025) gives birth on Monday 1 June and is on maternity leave every June working day; the fund paid her CNY15,000 allowance, which comes off the leave wage: gross 5,000, the employer paying the shortfall.',
		citation: [
			'沪医保规〔2021〕9号 (https://ybj.sh.gov.cn/gfxwj/20220221/896fab70895744b19f48655977d25a19.html, re-read 30 Sep 2026; valid 1 July 2021 – 30 June 2026): 从业妇女享受的生育生活津贴标准低于本人产假前工资标准的，差额部分由其生育或者流产时所在用人单位按国家规定支付 (CN-SH21): 20,000 − 15,000 = 5,000 (owner rule 2026-09-28, 产假前工资 read as the contract wage)',
			'女职工劳动保护特别规定 art.7 and 沪府规〔2022〕18号 art.2: 158 days; June’s share taken as its own entry (CN-N20, CN-SH13)',
			'The allowance is exempt (财税〔2008〕8号): IIT nothing',
			`${SOURCES.si2025}; ${SOURCES.pension}: 1,600 / 3,200; ${SOURCES.medical2026}: 400 / 1,800; ${SOURCES.unemployment2026}: 100 / 100; ${SOURCES.injury}: 40; ${SOURCES.hf2025}: 1,400 each side`,
			'Net 5,000 − 3,500 = 1,500; employer 6,540'
		],
		company: { facts: FACTS },
		inputs: [
			...cnWeek('2025-06-02'),
			...hire('lu', {
				name: 'Lu Qing',
				gender: 'FEMALE',
				from: '2025-06-02',
				wages: [[20000, '2025-06-02', null]],
				si: 20000,
				hf: { contribution_base: 20000 },
				employee: { marital_status: 'MARRIED' }
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@lu_job',
					catalogue_id: '@law:leave_catalogue:MATERNITY_LEAVE',
					reference: 'ML-2026-06',
					from_date: '2026-06-01',
					to_date: '2026-06-30',
					event_kind: 'BIRTH',
					event_date: '2026-06-01',
					reason: 'Maternity leave (产假及生育假), June share'
				}
			},
			{
				...bonus('lu', 'MATERNITY_ALLOWANCE_OFFSET', 15000, '2026-06-30'),
				files: { evidence_file: 'maternity-allowance-notice.pdf' }
			}
		],
		period: '2026-06',
		expected: [
			{
				employment: 'lu_job',
				lines: {
					gross: 5000,
					net: 1500,
					employer_cost: 6540,
					...si([1600, 3200], [400, 1800], [100, 100], 40, 1400)
				}
			}
		]
	}
);
