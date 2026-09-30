import { register, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * CN-shanghai cases: see the case shape at the top of payroll-probe.ts. Every figure is computed by hand from the
 * instrument each citation names; the case id is the register row (docs/inventory/china.csv) it prices.
 *
 * Held for every case (the recorded inputs, not law):
 * - `injury_rate` 0.2: an agency-assigned class I rate with no float (沪人社规〔2026〕2号 class table; the rate is an
 *   agency determination the operator records, CN-SH07).
 * - `unemployment_*_rate` 0.5 / 0.5: from 1 January 2026 the rates are the agency notice's, recorded as entity facts
 *   (no 2026 instrument was located, CN-SH06). December 2025 charges the law's own 0.5% / 0.5%.
 * - `housing_fund_rate` 7: the unit's elected equal rate inside 5–7% (沪公积金管委会〔2023〕3号 art.17).
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
				receiving_pension: h.receiving_pension ?? false
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
			`${SOURCES.injury}: 40`,
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
			`${SOURCES.injury}: 37,302 × 0.2% = 74.604 → 74.60`,
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
			'December 2025, two foreign non-resident workers in Shanghai since March 2024: one on CNY9,000 whose declared 2024 averages (6,000 insurance, 2,600 fund) sit below both floors and who agreed to join the fund; one on CNY30,000 with no fund agreement, on the 25,000 non-resident band seam.',
		citation: [
			`${SOURCES.si2025}: a declared 6,000 insures on the 7,460 floor; foreign employees are insured like citizens (Social Insurance Law art.97; CN-N25)`,
			`${SOURCES.pension}: 7,460 → 596.80 / 1,193.60; 30,000 → 2,400 / 4,800`,
			`${SOURCES.medical2025}: 149.20 / 671.40; 600 / 2,700`,
			`${SOURCES.unemployment2025}: 37.30 / 37.30; 150 / 150`,
			`${SOURCES.injury}: 7,460 × 0.2% = 14.92; 60`,
			`${SOURCES.hf2025}: a declared 2,600 contributes on the 2,690 floor, 2,690 × 7% = 188.30 → 188 each side. A foreign worker joins only by mutual agreement (沪公积金管委会〔2023〕3号 art.5; CN-SH41): the second worker, without one, pays nothing`,
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
			`${SOURCES.injury}: 43.50`,
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
	}
);
