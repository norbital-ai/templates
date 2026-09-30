import { register, type ProbeCase, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * JP cases: see the case shape at the top of payroll-probe.ts. Every figure below is computed by hand from the
 * cited instrument, never read off the product or a golden.
 *
 * The JP lineage seeds work rules, the 地域別最低賃金, 社会保険 (健康保険・介護保険, 厚生年金, 子ども・子育て支援金 and
 * 拠出金), 労働保険 (雇用保険, 労災保険), 源泉所得税 (INCOME_TAX, INCOME_TAX_BONUS), 住民税 special collection (RESIDENT_TAX, from the
 * terms facts; a person with none recorded is not special-collected) and 退職所得 (RETIREMENT_INCOME_TAX,
 * RESIDENT_TAX_RETIREMENT on the RETIREMENT_ALLOWANCE class), the leave catalogue and the 休業手当 / 解雇予告手当
 * classes; these cases pin the wage, premium and withholding lines, never net. A person with no 扶養控除等申告書 recorded is
 * withheld by the 乙欄 (the terms default).
 *
 * 労働保険, cited once here (SRC.ei, SRC.wc): every company below is a GENERAL (一般の事業) employment-insurance business
 * of 労災保険率表 type 94 (その他の各種事業, 3/1,000) unless the case says otherwise, and every person is an insured
 * worker from hire. Both premiums are on the payslip's whole wage, bonus included (徴収法 §2(2), §11); the employment-
 * insurance rate is that of the fiscal year of the wage closing date. The worker share drops 50 sen and under and
 * rounds over 50 sen up; the employer share and the employer-only 労災保険 drop the sub-yen fraction (recorded default).
 *
 * 社会保険, cited once here (SRC.si*): the premium of each insurance month is charged on the recorded 標準報酬月額 and
 * the employer deducts the previous month's from this month's pay (健康保険法 §167(1), 厚生年金保険法 §84(1)); the
 * employee half deducted from pay drops 50 sen and under and rounds over 50 sen up to one yen, the employer bears
 * the rest of the month's premium (JPS rounding page). Every person below is enrolled from hire (資格取得).
 *
 * Common facts, cited once here and relied on by every case:
 *  - 労働基準法施行規則 §19(1)(iv): a monthly wage's hourly rate is the wage ÷ the annual average monthly scheduled
 *    hours — 340,000 ÷ (2,040 ÷ 12 = 170) = 2,000 an hour.
 *  - 労働基準法 §37(1) with 平成6年政令第5号: overtime at 125%, statutory rest-day work at 135%; §37(4): 22:00–05:00
 *    adds 25% of the hourly wage.
 *  - Monday–Friday 09:00–18:00 less a 60-minute break (8 scheduled hours, 40 a week), Saturday a non-statutory rest
 *    day (所定休日), Sunday the §35 statutory rest day (法定休日).
 */

const SRC = {
	lsa: '労働基準法 (https://laws.e-gov.go.jp/law/322AC0000000049) §32 (8 h a day, 40 h a week), §35 (weekly rest day), §37(1), (4)',
	premium:
		'労働基準法第三十七条第一項の時間外及び休日の割増賃金に係る率の最低限度を定める政令 (https://laws.e-gov.go.jp/law/406CO0000000005): 時間外 二割五分, 休日 三割五分',
	rate: '労働基準法施行規則 §19(1)(iv) (https://laws.e-gov.go.jp/law/322M40000100023): 月によつて定められた賃金については、その金額を月における所定労働時間数（月によつて所定労働時間数が異る場合には、一年間における一月平均所定労働時間数）で除した金額',
	minimumWage:
		'最低賃金法 §4(1)–(2) (https://laws.e-gov.go.jp/law/334AC0000000137); 最低賃金法施行規則 §2(1)(iii) (https://laws.e-gov.go.jp/law/334M50002000016): a monthly wage over the annual average monthly scheduled hours',
	tokyo:
		'MHLW quick table (https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php, read 2026-09-30): 東京都 1,226円 from 令和7.10.03, 1,280円 from 令和8.10.01; Tokyo Labour Bureau (https://jsite.mhlw.go.jp/tokyo-hellowork/list/kiba/minimum-wage-information_2026.html)',
	siHealth:
		'健康保険法 (https://laws.e-gov.go.jp/law/211AC0000000070) §40, §156, §160, §161, §167(1); 協会けんぽ 保険料額表 令和8年3月分から (https://www.kyoukaikenpo.or.jp/assets/r8ippan3.xlsx) and 令和7年3月分から (https://www.kyoukaikenpo.or.jp/assets/r7ippan3.xlsx): 東京都 9.91% to the February 2026 insurance month, 9.85% from March 2026; 大阪府 10.24% / 10.13%; 介護保険 (40–64) 1.59% / 1.62%',
	siPension:
		'厚生年金保険法 (https://laws.e-gov.go.jp/law/329AC0000000115) §20, §24-4, §81, §82, §84: 18.3% of the pension grade (JPY88,000–650,000) and standard bonus (JPY1.5m a month), half each (JPS https://www.nenkin.go.jp/service/kounen/hokenryo/ryogaku/ryogakuhyo/20200825.html)',
	siSupport:
		'子ども・子育て支援金 (https://www.cfa.go.jp/policies/kodomokosodateshienkinseido; 協会けんぽ 令和8年度 table): 0.23% of the 標準報酬月額 and 標準賞与額 from the April 2026 insurance month (May pay), half each, rounded on its own',
	siChild:
		'子ども・子育て拠出金: employer-only 0.36% of the pension grade and pension standard bonus (JPS premium table; 協会けんぽ table notes)',
	siRound:
		'JPS (https://www.nenkin.go.jp/service/kounen/hokenryo/nofu/20121026.html); 通貨の単位及び貨幣の発行等に関する法律 §3: 被保険者負担分 deducted from pay, 50銭以下切り捨て, 50銭を超える場合は切り上げ',
	siBonus:
		'健康保険法 §45(1), 厚生年金保険法 §24-4(1) (JPS https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html): 標準賞与額 = the bonus less its sub-JPY1,000 fraction; health (and support) cap JPY5,730,000 per April–March, pension cap JPY1,500,000 a month',
	ei: '雇用保険法 (https://laws.e-gov.go.jp/law/349AC0000000116) §4–§6; 労働保険の保険料の徴収等に関する法律 (https://laws.e-gov.go.jp/law/344AC0000000084) §2(2), §11, §12(4), §31, §32; MHLW 雇用保険料率 per 1,000 worker/employer — 令和7年度 (https://www.mhlw.go.jp/content/001401966.pdf) general 5.5/9, 農林水産・清酒製造 6.5/10, 建設 6.5/11; 令和8年度 from 1 April 2026 (https://www.mhlw.go.jp/content/001692566.pdf) 5/8.5, 6/9.5, 6/10.5; worker share from wages 50銭以下切り捨て、50銭を超える場合は切り上げ (https://www.mhlw.go.jp/www2/topics/seido/daijin/hoken/980916_3.htm)',
	tax: '所得税法 (https://laws.e-gov.go.jp/law/340AC0000000033) §183, §185, §190; 平成24年財務省告示第115号 令和8年分 源泉徴収税額表 月額表 (https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm, data/01-07.xls): the pay after the 社会保険料 this payslip deducts (健康保険・介護保険, 厚生年金, 子ども・子育て支援金, 雇用保険) read on the 甲欄 by the 扶養親族等の数 or on the 乙欄; the tables fold in the 2.1% 復興特別所得税',
	bonusTax:
		'所得税法 §186; 令和8年分 賞与に対する源泉徴収税額の算出率の表 (https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/15-16.xls): the bonus after its insurance × the rate the previous month’s pay after insurance reads (declared as prior_month_net_pay); sub-yen dropped (recorded default)',
	residentTax:
		'地方税法 (https://laws.e-gov.go.jp/law/325AC0000000226) §321-3–§321-5, §20-4-2(6), (8): the designated payer withholds the municipality-notified 特別徴収税額 one twelfth a month from June to the following May, the sub-JPY100 fractions in the first (June) installment; §321-5(2): a worker who stops receiving pay has the remaining installments withheld in one amount from pay exceeding them on request (event 1 June–31 December) or always (1 January–30 April), otherwise none after the event month (Shinjuku https://www.city.shinjuku.lg.jp/hoken/file04_04_00001.html; Yokohama https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/jigyosya/shizei/choshu/kirikaeiraisyo.html)',
	retirement:
		'所得税法 (https://laws.e-gov.go.jp/law/340AC0000000033) §30(2)–(6) (退職所得控除 400,000 × years to 20, then 8m + 700,000 × years over 20, at least 800,000; general (payment − deduction) × 1/2; 短期退職手当等 (non-officer service ≤ 5 years) 1/2 of the excess up to 3m plus the excess over 3m whole), §89 (5% to 1.95m; 10% to 3.3m; 20% to 6.95m; …), §201(1), (3) (sub-JPY1,000 taxable fraction dropped; without the 退職所得の受給に関する申告書 20% of the whole); 所得税法施行令 (https://laws.e-gov.go.jp/law/340CO0000000096) §69 (a part year of service is a year); 復興特別所得税 ×102.1% (20.42%), sub-yen dropped (NTA No.2732 https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2732.htm)',
	retirementLocal:
		'地方税法 §328–§328-6 (市町村民税 6%), §50-2–§50-6 (道府県民税 4%): the 退職所得割 on the 退職所得の金額 computed as 所得税法 §30(2), the declaration or not (§328-6(1)–(2)); §20-4-2(1) taxable amount to the JPY1,000, §20-4-2(3) each tax to the JPY100 below',
	wc: '労働者災害補償保険法 §3 (https://laws.e-gov.go.jp/law/322AC0000000050); 徴収法 §12(2)–(3), §31 (employer only); 労災保険率表 (https://www.mhlw.go.jp/content/rousaihokenritu_r05.pdf, 令和6年4月1日施行, unchanged for 令和8年度 per https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/rousai/rousaihoken06/rousai_hokenritsu_kaitei.html): 94 その他の各種事業 3, 95 農業又は海面漁業以外の漁業 13, 35 建築事業 9.5 per 1,000'
} as const;

const SI = [
	SRC.siHealth,
	SRC.siPension,
	SRC.siSupport,
	SRC.siChild,
	SRC.siRound,
	SRC.ei,
	SRC.wc
] as const;

/** The 労働保険 facts of a GENERAL employment-insurance business of 労災保険率表 type 94. */
const LABOUR: Row = { employment_insurance_class: 'GENERAL', workers_comp_business_type: '94' };

/** The JP week: five 8-hour office days, Saturday 所定休日, Sunday 法定休日 (a REST code marked statutory). */
const jpWeek = (from: string): ProbeInput[] => [
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
			name: '所定休日',
			variant: { kind: 'REST' },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_definitions',
		ref: 'statutory',
		values: {
			company_id: '@company',
			code: 'STATUTORY_REST',
			name: '法定休日',
			variant: { kind: 'REST', statutory: true },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_patterns',
		ref: 'week',
		values: {
			company_id: '@company',
			code: 'OFFICEx5-REST-STATUTORY',
			name: '5 x OFFICE, 所定休日, 法定休日',
			pattern: {
				days: ['@office', '@office', '@office', '@office', '@office', '@rest', '@statutory'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from, to: null }
		}
	}
];

type Person = {
	ref: string;
	name: string;
	hired: string;
	wage: number;
	annualHours: number;
	worksite?: string;
	/** The `worksites` row (an earlier input's ref) the terms name, where the case records the establishment. */
	worksiteRef?: string;
	/** 健康保険 標準報酬月額 (the grade the payslip collects); the pension grade is derived from it. */
	grade: number;
	born?: string;
	left?: string;
	/** HEALTH premium_exemption for the collected month. */
	exemption?: 'MATERNITY' | 'CHILDCARE';
	/** HEALTH_BONUS elections, where recorded. */
	bonusElections?: Row;
	/** false: no 雇用保険 registration recorded. */
	ei?: false;
	/** Extra terms facts (withholding_column, withholding_dependants, commuting…). */
	terms?: Row;
	/** Recurring allowances on the terms (`{ catalogue_id, amount }`). */
	allowances?: Row[];
	/** Tax residency on the terms; RESIDENT when omitted. */
	taxResidency?: 'RESIDENT' | 'NON_RESIDENT';
	/** The INCOME_TAX declaration: status fields beyond the reference (elections, opening, deduction_claims). */
	incomeTax?: Row;
	/** INCOME_TAX_BONUS elections (prior_month_net_pay), where a bonus is paid. */
	bonusTax?: Row;
	/** Exit facts on the employment (retirement-allowance and resident-tax exit inputs), where the person leaves. */
	exitFacts?: Row;
	/** The exit reason where the person leaves; RESIGNATION when omitted. */
	exitReason?: string;
	/** MALE when omitted. */
	gender?: 'MALE' | 'FEMALE';
	/** Extra employee fields (`children`). */
	person?: Row;
};

function personInputs(p: Person): ProbeInput[] {
	const job = `${p.ref}_job`;
	const range = { from: p.hired, to: p.left ?? null };
	const fact = (code: string, elections: Row, status: Row = {}): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: `@${p.ref}`,
			employment_id: `@${job}`,
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: range,
			status: {
				kind: 'REGISTERED',
				reference_number: `PROBE-${code}`,
				since: p.hired,
				first_contribution_due_on: p.hired,
				elections,
				...status
			}
		}
	});
	return [
		{
			collection: 'employees',
			ref: p.ref,
			values: {
				name: p.name,
				date_of_birth: p.born ?? '1990-05-10',
				gender: p.gender ?? 'MALE',
				nationality: 'Japanese',
				...p.person
			}
		},
		{
			collection: 'employments',
			ref: job,
			values: {
				employee_id: `@${p.ref}`,
				company_id: '@company',
				employee_number: `P-${p.ref.toUpperCase()}`,
				effective_range: range,
				...(p.left === undefined ? {} : { exit_ground: p.exitReason ?? 'RESIGNATION' }),
				...(p.exitFacts === undefined ? {} : { exit_facts: p.exitFacts })
			}
		},
		{
			collection: 'employment_terms',
			values: {
				employment_id: `@${job}`,
				residency_status: 'CITIZEN',
				tax_residency: p.taxResidency ?? 'RESIDENT',
				currency: 'JPY',
				base_salary: p.wage,
				pay_frequency: 'MONTHLY',
				work_classification: 'LSA_COVERED',
				employment_type: 'PERMANENT',
				worksite: p.worksite ?? '東京都',
				...(p.worksiteRef === undefined ? {} : { worksite_id: `@${p.worksiteRef}` }),
				shift_pattern_id: '@week',
				facts: { annual_scheduled_hours: p.annualHours, ...p.terms },
				...(p.allowances === undefined ? {} : { allowances: p.allowances }),
				effective_range: range
			}
		},
		fact('HEALTH', {
			standard_monthly_remuneration: p.grade,
			...(p.exemption === undefined ? {} : { premium_exemption: p.exemption })
		}),
		...(p.bonusElections === undefined ? [] : [fact('HEALTH_BONUS', p.bonusElections)]),
		...(p.ei === false ? [] : [fact('EMPLOYMENT_INSURANCE', {})]),
		...(p.bonusTax === undefined ? [] : [fact('INCOME_TAX_BONUS', p.bonusTax)]),
		...(p.incomeTax === undefined ? [] : [fact('INCOME_TAX', {}, p.incomeTax)])
	];
}

/** A 賞与 paid on the month's payslip. */
const bonus = (job: string, amount: number, date: string): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: job,
		catalogue_id: '@law:adhoc_catalogue:BONUS',
		amount,
		event_date: date,
		reason: '賞与'
	}
});

/** A 退職手当 paid on the leaver's last payslip. */
const retirementAllowance = (job: string, amount: number, date: string): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: job,
		catalogue_id: '@law:adhoc_catalogue:RETIREMENT_ALLOWANCE',
		amount,
		event_date: date,
		reason: '退職手当'
	}
});

/** A 解雇予告手当 for the notice days short of 30, at the recorded 平均賃金. */
const noticePay = (
	job: string,
	noticeDays: number,
	averageWage: number,
	date: string
): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: job,
		catalogue_id: '@law:adhoc_catalogue:DISMISSAL_NOTICE_PAY',
		amount: 0,
		event_date: date,
		reason: '解雇予告手当',
		facts: { notice_days_given: noticeDays, average_wage: averageWage }
	}
});

/** A 令和8年度 特別徴収税額の決定通知書: 180,300 a year, 15,300 in June (the sub-JPY100 fractions) and 15,000 each month to May. */
const NOTICE: Row = {
	resident_tax_collection: 'SPECIAL',
	resident_tax_fiscal_year: 2026,
	resident_tax_june_amount: 15_300,
	resident_tax_monthly_amount: 15_000,
	resident_tax_notice_reference: '新宿区 令和8年度 特別徴収税額の決定通知書'
};

/** The ordinary lines of a 30 September 2026 leaver on the 300,000 wage and grade with no 扶養控除等申告書 (JP-TAX-25-1). */
const SEPTEMBER_LEAVER = {
	'HEALTH.employee': 29_550,
	'HEALTH.employer': 29_550,
	'CHILD_SUPPORT.employee': 690,
	'CHILD_SUPPORT.employer': 690,
	'PENSION.employee': 54_900,
	'PENSION.employer': 54_900,
	'CHILD_CONTRIBUTION.employer': 2_160,
	'EMPLOYMENT_INSURANCE.employee': 1_500,
	'EMPLOYMENT_INSURANCE.employer': 2_550,
	'WORKERS_COMP.employer': 900,
	'INCOME_TAX.employee': 24_100
} as const;

/** A clocked day in Tokyo (+09:00): `[start, end]` pairs of HH:MM. */
const worked = (
	job: string,
	date: string,
	...spans: readonly (readonly [string, string])[]
): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: job,
		work_date: date,
		worked_intervals: spans.map(([from, to]) => ({
			start: new Date(`${date}T${from}:00+09:00`).toISOString(),
			end: new Date(`${date}T${to}:00+09:00`).toISOString()
		}))
	}
});
/** A clocked day whose overtime or rest-day hours the employer directed under the 36協定: the run pays those. */
const asked = (day: ProbeInput, hours: number): ProbeInput => ({
	...day,
	values: { ...day.values, approved_overtime_hours: hours }
});

type JpCase = Omit<ProbeCase, 'profile' | 'inputs' | 'expected'> & {
	people: readonly Person[];
	extra?: (job: (person: string) => string) => ProbeInput[];
	/** Rows the people's inputs name (worksites), created before them. */
	before?: readonly ProbeInput[];
	expected: Readonly<Record<string, ProbeCase['expected'][number]['lines']>>;
};

const jp = (c: JpCase): ProbeCase => ({
	id: c.id,
	profile: 'JP',
	description: c.description,
	citation: c.citation,
	company: { region: '東京都', facts: LABOUR, ...c.company },
	period: c.period,
	...(c.refused === undefined ? {} : { refused: c.refused }),
	inputs: [
		...jpWeek('2003-12-01'),
		...(c.before ?? []),
		...c.people.flatMap(personInputs),
		...(c.extra?.((person) => `@${person}_job`) ?? [])
	],
	expected: Object.entries(c.expected).map(([ref, lines]) => ({ employment: `${ref}_job`, lines }))
});

const sato = (rest: Partial<Person> = {}): Person => ({
	ref: 'sato',
	name: 'Sato Haruto',
	hired: '2024-04-01',
	wage: 340_000,
	annualHours: 2040,
	grade: 340_000,
	...rest
});

register(
	jp({
		id: 'JP-OT-02-1',
		description:
			'Tuesday 10 March 2026, 09:00–23:00 less an hour: five hours beyond the statutory eight at 125%, the last of them after 22:00 adding the 25% night premium.',
		citation: [
			SRC.lsa,
			SRC.premium,
			SRC.rate,
			'2,000 an hour: 5 × 2,000 × 1.25 = 12,500 overtime; 22:00–23:00 is one night hour, 1 × 2,000 × 0.25 = 500.',
			'Gross 340,000 + 12,500 + 500 = 353,000.',
			...SI,
			'March 2026 pay collects the February 2026 insurance month on the 340,000 grade: 健康保険 東京都 9.91% (令和7年度), 340,000 × 9.91% ÷ 2 = 16,847; 厚生年金 340,000 × 9.15% = 31,110; 拠出金 340,000 × 0.36% = 1,224 (employer). No 支援金 before the April 2026 insurance month.',
			'353,000: 雇用保険 令和7年度 × 5.5/1,000 = 1,941.5 → 1,941 (50 sen down), employer × 9/1,000 = 3,177; 労災 × 3/1,000 = 1,059.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 353,000 − (16,847 + 31,110 + 1,941) = 303,102 → 月額表 令和8年分 乙欄 302,000–305,000 → 54,500.'
		],
		period: '2026-03',
		people: [sato()],
		extra: (job) => [
			asked(worked(job('sato'), '2026-03-10', ['09:00', '12:00'], ['13:00', '23:00']), 5)
		],
		expected: {
			sato: {
				gross: 353_000,
				BASIC: 340_000,
				OVERTIME: 12_500,
				NIGHT_PREMIUM: 500,
				'HEALTH.employee': 16_847,
				'HEALTH.employer': 16_847,
				'PENSION.employee': 31_110,
				'PENSION.employer': 31_110,
				'CHILD_CONTRIBUTION.employer': 1_224,
				'EMPLOYMENT_INSURANCE.employee': 1_941,
				'EMPLOYMENT_INSURANCE.employer': 3_177,
				'WORKERS_COMP.employer': 1_059,
				'INCOME_TAX.employee': 54_500
			}
		}
	}),
	jp({
		id: 'JP-OT-03-1',
		description:
			'Saturday 14 March 2026 (所定休日) seven hours and Sunday 15 March (法定休日) eight hours: the non-statutory rest day at 125%, the statutory one at 135%.',
		citation: [
			SRC.lsa,
			SRC.premium,
			SRC.rate,
			'The Saturday lies outside a full 40-hour week, so its hours are §32 overtime at 125%: 7 × 2,000 × 1.25 = 17,500. The Sunday is the §35 rest day: 8 × 2,000 × 1.35 = 21,600.',
			'Gross 340,000 + 17,500 + 21,600 = 379,100.',
			...SI,
			'March 2026 pay collects the February 2026 insurance month on the 340,000 grade: 健康保険 東京都 9.91% (令和7年度), 340,000 × 9.91% ÷ 2 = 16,847; 厚生年金 340,000 × 9.15% = 31,110; 拠出金 340,000 × 0.36% = 1,224 (employer). No 支援金 before the April 2026 insurance month.',
			'379,100: 雇用保険 令和7年度 × 5.5/1,000 = 2,085.05 → 2,085, employer × 9/1,000 = 3,411.9 → 3,411; 労災 × 3/1,000 = 1,137.3 → 1,137.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 379,100 − (16,847 + 31,110 + 2,085) = 329,058 → 月額表 令和8年分 乙欄 329,000–332,000 → 62,600.'
		],
		period: '2026-03',
		people: [sato()],
		extra: (job) => [
			asked(worked(job('sato'), '2026-03-14', ['09:00', '12:00'], ['13:00', '17:00']), 7),
			asked(worked(job('sato'), '2026-03-15', ['09:00', '12:00'], ['13:00', '18:00']), 8)
		],
		expected: {
			sato: {
				gross: 379_100,
				BASIC: 340_000,
				OVERTIME: 39_100,
				'HEALTH.employee': 16_847,
				'HEALTH.employer': 16_847,
				'PENSION.employee': 31_110,
				'PENSION.employer': 31_110,
				'CHILD_CONTRIBUTION.employer': 1_224,
				'EMPLOYMENT_INSURANCE.employee': 2_085,
				'EMPLOYMENT_INSURANCE.employer': 3_411,
				'WORKERS_COMP.employer': 1_137,
				'INCOME_TAX.employee': 62_600
			}
		}
	}),
	jp({
		id: 'JP-MW-01-1',
		description:
			'A Tokyo worker on 220,000 a month and 2,064 annual scheduled hours in September 2026 earns 1,279.07 an hour, above the 1,226 then in force.',
		citation: [
			SRC.minimumWage,
			SRC.tokyo,
			'220,000 ÷ (2,064 ÷ 12 = 172) = 1,279.07 ≥ 1,226 (a month of 1,226 × 172 = 210,872): the contract stands.',
			...SI,
			'September 2026 pay collects the August 2026 insurance month on the 220,000 grade: 健康保険 東京都 9.85% (令和8年度), 220,000 × 9.85% ÷ 2 = 10,835; 支援金 220,000 × 0.23% ÷ 2 = 253; 厚生年金 220,000 × 9.15% = 20,130; 拠出金 220,000 × 0.36% = 792.',
			'220,000: 雇用保険 令和8年度 × 5/1,000 = 1,100, employer × 8.5/1,000 = 1,870; 労災 × 3/1,000 = 660.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 220,000 − (10,835 + 253 + 20,130 + 1,100) = 187,682 → 月額表 令和8年分 乙欄 187,000–189,000 → 15,400.'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'suzuki',
				name: 'Suzuki Aoi',
				wage: 220_000,
				annualHours: 2064,
				grade: 220_000
			})
		],
		expected: {
			suzuki: {
				gross: 220_000,
				BASIC: 220_000,
				'HEALTH.employee': 10_835,
				'HEALTH.employer': 10_835,
				'CHILD_SUPPORT.employee': 253,
				'CHILD_SUPPORT.employer': 253,
				'PENSION.employee': 20_130,
				'PENSION.employer': 20_130,
				'CHILD_CONTRIBUTION.employer': 792,
				'EMPLOYMENT_INSURANCE.employee': 1_100,
				'EMPLOYMENT_INSURANCE.employer': 1_870,
				'WORKERS_COMP.employer': 660,
				'INCOME_TAX.employee': 15_400
			}
		}
	}),
	jp({
		id: 'JP-MW-01-2',
		description:
			'The same worker in October 2026 falls below Tokyo’s 1,280 from 1 October; §4(2) replaces the wage with the floor, 1,280 × 172 = 220,160.',
		citation: [
			SRC.minimumWage,
			SRC.tokyo,
			'最低賃金法 §4(2): 最低賃金額に達しない賃金を定めるものは、その部分については無効とする。この場合において、無効となつた部分は、最低賃金と同様の定をしたものとみなす。 1,279.07 < 1,280; 1,280 × 172 = 220,160.',
			...SI,
			'October 2026 pay collects the September 2026 insurance month on the 220,000 grade: 健康保険 東京都 9.85% (令和8年度), 220,000 × 9.85% ÷ 2 = 10,835; 支援金 220,000 × 0.23% ÷ 2 = 253; 厚生年金 220,000 × 9.15% = 20,130; 拠出金 220,000 × 0.36% = 792.',
			'The floor raises the wage, not the recorded grade: a grade changes only by 定時決定 or 随時改定 (健康保険法 §41, §43).',
			'220,160: 雇用保険 令和8年度 × 5/1,000 = 1,100.8 → 1,101 (over 50 sen up), employer × 8.5/1,000 = 1,871.36 → 1,871; 労災 × 3/1,000 = 660.48 → 660.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 220,160 − (10,835 + 253 + 20,130 + 1,101) = 187,841 → 月額表 令和8年分 乙欄 187,000–189,000 → 15,400.'
		],
		period: '2026-10',
		people: [
			sato({
				ref: 'suzuki',
				name: 'Suzuki Aoi',
				wage: 220_000,
				annualHours: 2064,
				grade: 220_000
			})
		],
		expected: {
			suzuki: {
				gross: 220_160,
				'HEALTH.employee': 10_835,
				'HEALTH.employer': 10_835,
				'CHILD_SUPPORT.employee': 253,
				'CHILD_SUPPORT.employer': 253,
				'PENSION.employee': 20_130,
				'PENSION.employer': 20_130,
				'CHILD_CONTRIBUTION.employer': 792,
				'EMPLOYMENT_INSURANCE.employee': 1_101,
				'EMPLOYMENT_INSURANCE.employer': 1_871,
				'WORKERS_COMP.employer': 660,
				'INCOME_TAX.employee': 15_400
			}
		}
	}),
	jp({
		id: 'JP-PRO-01-1',
		description:
			'A joiner on Monday 16 March 2026 at 340,000 a month is paid for the 12 of March’s 22 scheduled working days.',
		citation: [
			'労働基準法 §24 (https://laws.e-gov.go.jp/law/322AC0000000049) requires full payment of the wage for the work done and prescribes no part-month method; docs/inventory/japan.csv JP-PRO-01 records the lawful default (owner rule 2026-09-28): the scheduled working days worked over the scheduled working days of the period.',
			'March 2026 has 22 Monday–Friday days; 16–20, 23–27, 30–31 March are 12. 340,000 × 12 ÷ 22 = 185,454.55 → 185,455 (通貨の単位及び貨幣の発行等に関する法律 §3: 50 銭 and over rounds up).',
			...SI,
			'Enrolled 16 March 2026: the March premium is first collected from April pay (健康保険法 §167(1): only the previous month’s premium is deducted), so the March payslip carries none.',
			'雇用保険 and 労災 are on the wage paid: 185,455 × 5.5/1,000 = 1,020.0025 → 1,020, employer × 9/1,000 = 1,669.095 → 1,669; 労災 × 3/1,000 = 556.365 → 556.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 185,455 − (1,020) = 184,435 → 月額表 令和8年分 乙欄 183,000–185,000 → 14,000.'
		],
		period: '2026-03',
		people: [sato({ ref: 'takahashi', name: 'Takahashi Ren', hired: '2026-03-16' })],
		expected: {
			takahashi: {
				gross: 185_455,
				BASIC: 185_455,
				'EMPLOYMENT_INSURANCE.employee': 1_020,
				'EMPLOYMENT_INSURANCE.employer': 1_669,
				'WORKERS_COMP.employer': 556,
				'INCOME_TAX.employee': 14_000
			}
		}
	}),
	jp({
		id: 'JP-SI-02-1',
		description:
			'April 2026 pay for a 46-year-old on the 410,000 grade collects March 2026 at 令和8年度 東京都 9.85% plus care 1.62%: the employee half 23,513.5 is deducted as 23,513 (50 sen down), the employer bears 23,514.',
		citation: [
			...SI,
			'介護保険法 §9(2): born 1980-01-15, 46 — a 第2号被保険者 for the whole month.',
			'Health + care 410,000 × 11.47% = 47,027; employee 23,513.5 → 23,513; employer 47,027 − 23,513 = 23,514. 厚生年金 410,000 × 9.15% = 37,515 each; 拠出金 410,000 × 0.36% = 1,476. The March 2026 insurance month carries no 支援金.',
			'410,000 closing 30 April 2026: 雇用保険 令和8年度 × 5/1,000 = 2,050, employer × 8.5/1,000 = 3,485; 労災 × 3/1,000 = 1,230.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 410,000 − (23,513 + 37,515 + 2,050) = 346,922 → 月額表 令和8年分 乙欄 344,000–347,000 → 67,800.'
		],
		period: '2026-04',
		people: [
			sato({ ref: 'ito', name: 'Ito Kenji', born: '1980-01-15', wage: 410_000, grade: 410_000 })
		],
		expected: {
			ito: {
				'HEALTH.employee': 23_513,
				'HEALTH.employer': 23_514,
				'PENSION.employee': 37_515,
				'PENSION.employer': 37_515,
				'CHILD_CONTRIBUTION.employer': 1_476,
				'EMPLOYMENT_INSURANCE.employee': 2_050,
				'EMPLOYMENT_INSURANCE.employer': 3_485,
				'WORKERS_COMP.employer': 1_230,
				'INCOME_TAX.employee': 67_800
			}
		}
	}),
	jp({
		id: 'JP-SI-14-1',
		description:
			'May 2026 pay collects April 2026, the first 子ども・子育て支援金 month: 410,000 × 0.23% = 943, the employee 471.5 → 471, the employer 472.',
		citation: [
			...SI,
			'Health + care as in April: 23,513 / 23,514. 支援金 410,000 × 0.23% = 943; employee 471.5 → 471 (50 sen down); employer 943 − 471 = 472.',
			'厚生年金 37,515 each; 拠出金 1,476.',
			'410,000: 雇用保険 2,050 / 3,485; 労災 1,230.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 410,000 − (23,513 + 471 + 37,515 + 2,050) = 346,451 → 月額表 令和8年分 乙欄 344,000–347,000 → 67,800.'
		],
		period: '2026-05',
		people: [
			sato({ ref: 'ito', name: 'Ito Kenji', born: '1980-01-15', wage: 410_000, grade: 410_000 })
		],
		expected: {
			ito: {
				'HEALTH.employee': 23_513,
				'HEALTH.employer': 23_514,
				'CHILD_SUPPORT.employee': 471,
				'CHILD_SUPPORT.employer': 472,
				'PENSION.employee': 37_515,
				'PENSION.employer': 37_515,
				'CHILD_CONTRIBUTION.employer': 1_476,
				'EMPLOYMENT_INSURANCE.employee': 2_050,
				'EMPLOYMENT_INSURANCE.employer': 3_485,
				'WORKERS_COMP.employer': 1_230,
				'INCOME_TAX.employee': 67_800
			}
		}
	}),
	jp({
		id: 'JP-SI-21-1',
		description:
			'Care starts with the month containing the day before the 40th birthday: born 1 May 1986, the April 2026 insurance month is care-bearing (day before is 30 April); born 2 May 1986, it is not (day before is 1 May).',
		citation: [
			...SI,
			'介護保険法 §9(2) with 年齢計算ニ関スル法律 (the age is reached on the day before the birthday) and 健康保険法 §156(3): the premium runs from the month the status is acquired.',
			'May 2026 pay, 300,000 grade: with care 300,000 × 11.47% ÷ 2 = 17,205; without 300,000 × 9.85% ÷ 2 = 14,775. 支援金 300,000 × 0.23% ÷ 2 = 345; 厚生年金 27,450; 拠出金 1,080.',
			'300,000 each: 雇用保険 令和8年度 × 5/1,000 = 1,500, employer × 8.5/1,000 = 2,550; 労災 × 3/1,000 = 900.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: Kato 300,000 − (17,205 + 345 + 27,450 + 1,500) = 253,500 → 月額表 令和8年分 乙欄 251,000–254,000 → 36,600; Mori 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		period: '2026-05',
		people: [
			sato({ ref: 'kato', name: 'Kato Mei', born: '1986-05-01', wage: 300_000, grade: 300_000 }),
			sato({ ref: 'mori', name: 'Mori Yui', born: '1986-05-02', wage: 300_000, grade: 300_000 })
		],
		expected: {
			kato: {
				'HEALTH.employee': 17_205,
				'HEALTH.employer': 17_205,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 36_600
			},
			mori: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-SI-24-1',
		description:
			'A leaver on 30 June 2026 (loss 1 July) owes May and June, both deducted from June pay; a leaver on 29 June (loss 30 June) owes May only.',
		citation: [
			...SI,
			'健康保険法 §36, §156(3), §167(1); 厚生年金保険法 §14, §19(1), §84(1): loss is the day after the last day; premiums run to the month before the month of loss; at loss the previous and the current month may be deducted.',
			'300,000 grade: two months 2 × 14,775 = 29,550, 2 × 345 = 690, 2 × 27,450 = 54,900, 拠出金 2 × 1,080 = 2,160; one month 14,775 / 345 / 27,450 / 1,080.',
			'Kimura is paid the whole June, 300,000: 雇用保険 1,500 / 2,550; 労災 900. Hayashi, last day Monday 29 June, is paid 21 of June’s 22 scheduled working days (JP-PRO-01 default): 300,000 × 21 ÷ 22 = 286,363.64 → 286,364; 雇用保険 × 5/1,000 = 1,431.82 → 1,432, employer × 8.5/1,000 = 2,434.09 → 2,434; 労災 × 3/1,000 = 859.09 → 859.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: Kimura 300,000 − (29,550 + 690 + 54,900 + 1,500) = 213,360 → 月額表 令和8年分 乙欄 213,000–215,000 → 24,100; Hayashi 286,364 − (14,775 + 345 + 27,450 + 1,432) = 242,362 → 月額表 令和8年分 乙欄 242,000–245,000 → 33,600.'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'kimura',
				name: 'Kimura Sho',
				wage: 300_000,
				grade: 300_000,
				left: '2026-06-30'
			}),
			sato({
				ref: 'hayashi',
				name: 'Hayashi Rin',
				wage: 300_000,
				grade: 300_000,
				left: '2026-06-29'
			})
		],
		expected: {
			kimura: {
				'HEALTH.employee': 29_550,
				'HEALTH.employer': 29_550,
				'CHILD_SUPPORT.employee': 690,
				'CHILD_SUPPORT.employer': 690,
				'PENSION.employee': 54_900,
				'PENSION.employer': 54_900,
				'CHILD_CONTRIBUTION.employer': 2_160,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 24_100
			},
			hayashi: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_432,
				'EMPLOYMENT_INSURANCE.employer': 2_434,
				'WORKERS_COMP.employer': 859,
				'INCOME_TAX.employee': 33_600
			}
		}
	}),
	jp({
		id: 'JP-SI-04-1',
		description:
			'A June 2026 bonus of 1,234,567: 標準賞与額 1,234,000; health 60,774.5 → 60,774 employee, 支援金 1,419.1 → 1,419, pension 112,911 each, 拠出金 on it 4,442.4, beside the May premium.',
		citation: [
			...SI,
			SRC.siBonus,
			'Health 1,234,000 × 9.85% = 121,549; employee 60,774.5 → 60,774; employer 60,775. 支援金 1,234,000 × 0.23% = 2,838.2; employee 1,419.1 → 1,419; employer 1,419.2 → 1,419. 厚生年金 1,234,000 × 9.15% = 112,911 each.',
			'拠出金 300,000 × 0.36% + 1,234,000 × 0.36% = 1,080 + 4,442.4 = 5,522.4 → 5,522. Monthly (May insurance month, 300,000): 14,775 / 345 / 27,450.',
			'The bonus is 賃金 (徴収法 §2(2)): 300,000 + 1,234,567 = 1,534,567; 雇用保険 × 5/1,000 = 7,672.835 → 7,673, employer × 8.5/1,000 = 13,043.82 → 13,043; 労災 × 3/1,000 = 4,603.70 → 4,603.',
			SRC.tax,
			SRC.bonusTax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄. The payslip’s 雇用保険 7,673 splits pro rata to the wages: 1,500.03 on the 300,000 salary, 6,172.97 on the bonus. Salary 300,000 − (14,775 + 345 + 27,450 + 1,500.03) = 255,929.97 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600. 賞与 : 1,234,567 − (60,774 + 1,419 + 112,911 + 6,172.97) = 1,053,290.03; the declared previous-month pay after insurance 255,930 (300,000 − 44,070) reads 乙欄 224千円以上295千円未満 → 20.42%; 1,053,290.03 × 20.42% = 215,081.82 → 215,081.'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'ogawa',
				name: 'Ogawa Riku',
				wage: 300_000,
				grade: 300_000,
				bonusTax: { prior_month_net_pay: 255_930 }
			})
		],
		extra: (job) => [bonus(job('ogawa'), 1_234_567, '2026-06-25')],
		expected: {
			ogawa: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'HEALTH_BONUS.employee': 60_774,
				'HEALTH_BONUS.employer': 60_775,
				'CHILD_SUPPORT_BONUS.employee': 1_419,
				'CHILD_SUPPORT_BONUS.employer': 1_419,
				'PENSION_BONUS.employee': 112_911,
				'PENSION_BONUS.employer': 112_911,
				'CHILD_CONTRIBUTION.employer': 5_522,
				'EMPLOYMENT_INSURANCE.employee': 7_673,
				'EMPLOYMENT_INSURANCE.employer': 13_043,
				'WORKERS_COMP.employer': 4_603,
				'INCOME_TAX.employee': 37_600,
				'INCOME_TAX_BONUS.employee': 215_081
			}
		}
	}),
	jp({
		id: 'JP-SI-04-2',
		description:
			'A 2,000,000 June bonus: the pension standard bonus stops at 1,500,000; health counts it whole.',
		citation: [
			...SI,
			SRC.siBonus,
			'Health 2,000,000 × 9.85% ÷ 2 = 98,500; 支援金 2,000,000 × 0.23% ÷ 2 = 2,300; 厚生年金 1,500,000 × 9.15% = 137,250; 拠出金 1,080 + 1,500,000 × 0.36% = 6,480.',
			'300,000 + 2,000,000 = 2,300,000 (no ceiling on 賃金総額): 雇用保険 11,500 / 19,550; 労災 6,900.',
			SRC.tax,
			SRC.bonusTax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄. The payslip’s 雇用保険 11,500 splits pro rata to the wages: 1,500 on the 300,000 salary, 10,000 on the bonus. Salary 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600. 賞与 : 2,000,000 − (98,500 + 2,300 + 137,250 + 10,000) = 1,751,950; the declared previous-month pay after insurance 255,930 (300,000 − 44,070) reads 乙欄 224千円以上295千円未満 → 20.42%; 1,751,950 × 20.42% = 357,748.19 → 357,748.'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'ogawa',
				name: 'Ogawa Riku',
				wage: 300_000,
				grade: 300_000,
				bonusTax: { prior_month_net_pay: 255_930 }
			})
		],
		extra: (job) => [bonus(job('ogawa'), 2_000_000, '2026-06-25')],
		expected: {
			ogawa: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'HEALTH_BONUS.employee': 98_500,
				'HEALTH_BONUS.employer': 98_500,
				'CHILD_SUPPORT_BONUS.employee': 2_300,
				'CHILD_SUPPORT_BONUS.employer': 2_300,
				'PENSION_BONUS.employee': 137_250,
				'PENSION_BONUS.employer': 137_250,
				'CHILD_CONTRIBUTION.employer': 6_480,
				'EMPLOYMENT_INSURANCE.employee': 11_500,
				'EMPLOYMENT_INSURANCE.employer': 19_550,
				'WORKERS_COMP.employer': 6_900,
				'INCOME_TAX.employee': 37_600,
				'INCOME_TAX_BONUS.employee': 357_748
			}
		}
	}),
	jp({
		id: 'JP-SI-15-1',
		description:
			'With 5,000,000 of standard bonus already counted this April–March, a 1,000,000 bonus leaves 730,000 of health (and 支援金) standard bonus; pension counts the whole 1,000,000.',
		citation: [
			...SI,
			SRC.siBonus,
			'Health 730,000 × 9.85% = 71,905; employee 35,952.5 → 35,952; employer 35,953. 支援金 730,000 × 0.23% = 1,679; employee 839.5 → 839; employer 840. 厚生年金 1,000,000 × 9.15% = 91,500; 拠出金 1,080 + 3,600 = 4,680.',
			'300,000 + 1,000,000 = 1,300,000: 雇用保険 6,500 / 11,050; 労災 3,900.',
			SRC.tax,
			SRC.bonusTax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄. The payslip’s 雇用保険 6,500 splits pro rata to the wages: 1,500 on the 300,000 salary, 5,000 on the bonus. Salary 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600. 賞与 : 1,000,000 − (35,952 + 839 + 91,500 + 5,000) = 866,709; the declared previous-month pay after insurance 255,930 (300,000 − 44,070) reads 乙欄 224千円以上295千円未満 → 20.42%; 866,709 × 20.42% = 176,981.97 → 176,981.'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'ogawa',
				name: 'Ogawa Riku',
				wage: 300_000,
				grade: 300_000,
				bonusElections: { standard_bonus_fiscal_year_prior: 5_000_000 },
				bonusTax: { prior_month_net_pay: 255_930 }
			})
		],
		extra: (job) => [bonus(job('ogawa'), 1_000_000, '2026-06-25')],
		expected: {
			ogawa: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'HEALTH_BONUS.employee': 35_952,
				'HEALTH_BONUS.employer': 35_953,
				'CHILD_SUPPORT_BONUS.employee': 839,
				'CHILD_SUPPORT_BONUS.employer': 840,
				'PENSION_BONUS.employee': 91_500,
				'PENSION_BONUS.employer': 91_500,
				'CHILD_CONTRIBUTION.employer': 4_680,
				'EMPLOYMENT_INSURANCE.employee': 6_500,
				'EMPLOYMENT_INSURANCE.employer': 11_050,
				'WORKERS_COMP.employer': 3_900,
				'INCOME_TAX.employee': 37_600,
				'INCOME_TAX_BONUS.employee': 176_981
			}
		}
	}),
	jp({
		id: 'JP-SI-12-1',
		description:
			'Born 15 June 1956: 厚生年金 cover ends on 14 June 2026 (the day before the 70th birthday), so June is not a pension month; July pay collects health and 支援金 for June but no pension or 拠出金.',
		citation: [
			...SI,
			'厚生年金保険法 §9, §14(v), §19(1); 年齢計算ニ関スル法律: the loss date is the day the age is reached, and the month of loss carries no premium. 介護保険 ends from the month containing the day before the 65th birthday.',
			'Health 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345.',
			'雇用保険法 §6 excludes no one by age and 労災 covers every worker: 300,000 → 1,500 / 2,550; 労災 900.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (14,775 + 345 + 1,500) = 283,380 → 月額表 令和8年分 乙欄 281,000–284,000 → 46,700.'
		],
		period: '2026-07',
		people: [
			sato({
				ref: 'yamada',
				name: 'Yamada Taro',
				born: '1956-06-15',
				wage: 300_000,
				grade: 300_000
			})
		],
		expected: {
			yamada: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 46_700
			}
		}
	}),
	jp({
		id: 'JP-SI-07-1',
		description:
			'A collected month recorded as a childcare-leave exemption (育児休業等取得者申出書 accepted) charges no health, 支援金, pension or 拠出金.',
		citation: [
			...SI,
			'健康保険法 §159; 厚生年金保険法 §81-2 (JPS FAQ https://www.nenkin.go.jp/section/faq/kounen/hokenryo/20140912.html): 事業主負担分、被保険者負担分が免除; 拠出金 follows the pension premium (recorded default).',
			'The exemption is 社会保険 only: 雇用保険 and 労災 fall on the wage the month pays, 300,000 → 1,500 / 2,550 and 900.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (1,500) = 298,500 → 月額表 令和8年分 乙欄 296,000–299,000 → 52,400.'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'sasaki',
				name: 'Sasaki Emi',
				wage: 300_000,
				grade: 300_000,
				exemption: 'CHILDCARE'
			})
		],
		expected: {
			sasaki: {
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 52_400
			}
		}
	}),
	jp({
		id: 'JP-KK27-1',
		description:
			'An Osaka establishment’s March 2026 pay collects February at 令和7年度 大阪府 10.24%; its April pay collects March at 令和8年度 10.13%.',
		citation: [
			...SI,
			'健康保険法 §160: the branch of the establishment’s prefecture. 300,000 × 10.24% ÷ 2 = 15,360 (March pay); 300,000 × 10.13% ÷ 2 = 15,195 (April pay). 厚生年金 27,450; 拠出金 1,080.',
			'The March wage closes on 31 March 2026, so 雇用保険 is at 令和7年度 even when paid in April: 300,000 × 5.5/1,000 = 1,650, employer × 9/1,000 = 2,700; 労災 900.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (15,360 + 27,450 + 1,650) = 255,540 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		company: { region: '大阪府' },
		period: '2026-03',
		people: [
			sato({
				ref: 'nakamura',
				name: 'Nakamura Sora',
				wage: 300_000,
				grade: 300_000,
				worksite: '大阪府'
			})
		],
		expected: {
			nakamura: {
				'HEALTH.employee': 15_360,
				'HEALTH.employer': 15_360,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_650,
				'EMPLOYMENT_INSURANCE.employer': 2_700,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-KK27-2',
		description:
			'The same Osaka worker in April 2026: the March insurance month at 令和8年度 10.13%.',
		citation: [
			...SI,
			'300,000 × 10.13% ÷ 2 = 15,195.',
			'The April wage closes in 令和8年度: 300,000 × 5/1,000 = 1,500, employer × 8.5/1,000 = 2,550; 労災 900.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (15,195 + 27,450 + 1,500) = 255,855 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		company: { region: '大阪府' },
		period: '2026-04',
		people: [
			sato({
				ref: 'nakamura',
				name: 'Nakamura Sora',
				wage: 300_000,
				grade: 300_000,
				worksite: '大阪府'
			})
		],
		expected: {
			nakamura: {
				'HEALTH.employee': 15_195,
				'HEALTH.employer': 15_195,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-EI-03-1',
		description:
			'May 2026 wages of 300,100 and 300,102: the 雇用保険 worker share 1,500.5 drops its 50 sen, 1,500.51 rounds up to 1,501.',
		citation: [
			...SI,
			'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080.',
			'300,100 × 5/1,000 = 1,500.5 → 1,500; 300,102 × 5/1,000 = 1,500.51 → 1,501. Employer × 8.5/1,000: 2,550.85 → 2,550 and 2,550.867 → 2,550. 労災 × 3/1,000: 900.3 → 900, 900.306 → 900.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: Abe 300,100 − (14,775 + 345 + 27,450 + 1,500) = 256,030 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600; Ueda 300,102 − (14,775 + 345 + 27,450 + 1,501) = 256,031 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		period: '2026-05',
		people: [
			sato({ ref: 'abe', name: 'Abe Yuto', wage: 300_100, grade: 300_000 }),
			sato({ ref: 'ueda', name: 'Ueda Nana', wage: 300_102, grade: 300_000 })
		],
		expected: {
			abe: {
				gross: 300_100,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600
			},
			ueda: {
				gross: 300_102,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_501,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-EIR-02-1',
		description:
			'An agriculture business (雇用保険 農林水産・清酒製造, 労災 type 95 農業) in May 2026: 6/9.5 per 1,000 and 労災 13 per 1,000.',
		citation: [
			...SI,
			'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080.',
			'300,000 × 6/1,000 = 1,800; employer × 9.5/1,000 = 2,850; 労災 300,000 × 13/1,000 = 3,900.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (14,775 + 345 + 27,450 + 1,800) = 255,630 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		company: {
			facts: { employment_insurance_class: 'AGRICULTURE_SAKE', workers_comp_business_type: '95' }
		},
		period: '2026-05',
		people: [sato({ ref: 'kondo', name: 'Kondo Hana', wage: 300_000, grade: 300_000 })],
		expected: {
			kondo: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_800,
				'EMPLOYMENT_INSURANCE.employer': 2_850,
				'WORKERS_COMP.employer': 3_900,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-EIR-03-1',
		description:
			'A construction business (労災 type 35 建築事業) across the fiscal boundary: the March 2026 wage at 令和7年度 6.5/11, the May 2026 wage at 令和8年度 6/10.5; 労災 9.5 per 1,000 on the payroll wage.',
		citation: [
			...SI,
			'March 2026 pay collects February on the 300,000 grade: 健康保険 東京都 9.91% ÷ 2 = 14,865; 厚生年金 27,450; 拠出金 1,080.',
			'March: 300,000 × 6.5/1,000 = 1,950; employer × 11/1,000 = 3,300; 労災 300,000 × 9.5/1,000 = 2,850.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (14,865 + 27,450 + 1,950) = 255,735 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		company: {
			facts: { employment_insurance_class: 'CONSTRUCTION', workers_comp_business_type: '35' }
		},
		period: '2026-03',
		people: [sato({ ref: 'ishii', name: 'Ishii Kaito', wage: 300_000, grade: 300_000 })],
		expected: {
			ishii: {
				'HEALTH.employee': 14_865,
				'HEALTH.employer': 14_865,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_950,
				'EMPLOYMENT_INSURANCE.employer': 3_300,
				'WORKERS_COMP.employer': 2_850,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-EIR-03-2',
		description: 'The same construction worker in May 2026: 令和8年度 6/10.5 per 1,000.',
		citation: [
			...SI,
			'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080.',
			'300,000 × 6/1,000 = 1,800; employer × 10.5/1,000 = 3,150; 労災 2,850.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (14,775 + 345 + 27,450 + 1,800) = 255,630 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		company: {
			facts: { employment_insurance_class: 'CONSTRUCTION', workers_comp_business_type: '35' }
		},
		period: '2026-05',
		people: [sato({ ref: 'ishii', name: 'Ishii Kaito', wage: 300_000, grade: 300_000 })],
		expected: {
			ishii: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_800,
				'EMPLOYMENT_INSURANCE.employer': 3_150,
				'WORKERS_COMP.employer': 2_850,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-WC-01-1',
		description:
			'A type-94 business notified a メリット制 rate of 2.5 per 1,000 (徴収法 §12(3)) pays 労災 at that rate, not the table’s 3.',
		citation: [
			...SI,
			'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080.',
			'労災 300,000 × 2.5/1,000 = 750; 雇用保険 1,500 / 2,550.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'
		],
		company: { facts: { ...LABOUR, workers_comp_merit_rate: 2.5 } },
		period: '2026-05',
		people: [sato({ ref: 'goto', name: 'Goto Mio', wage: 300_000, grade: 300_000 })],
		expected: {
			goto: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 750,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-TAX-18-1',
		description:
			'May 2026 pay of 300,000 to a worker who filed the 扶養控除等申告書 with two 扶養親族等 (甲欄) and to one who did not (乙欄): the same pay after insurance, 255,930, withholds 3,090 and 37,600.',
		citation: [
			...SI,
			'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080; 雇用保険 1,500 / 2,550; 労災 900.',
			SRC.tax,
			'所得税法 §185(1)(i)イ, (ii)イ; 月額表 令和8年分 row 254,000–257,000: 甲欄 2人 3,090, 乙欄 37,600. 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930.'
		],
		period: '2026-05',
		people: [
			sato({
				ref: 'kou',
				name: 'Kou Hiroshi',
				wage: 300_000,
				grade: 300_000,
				terms: { withholding_column: 'KOU', withholding_dependants: 2 }
			}),
			sato({ ref: 'otsu', name: 'Otsu Yuki', wage: 300_000, grade: 300_000 })
		],
		expected: {
			kou: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 3_090
			},
			otsu: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600
			}
		}
	}),
	jp({
		id: 'JP-TAX-23-1',
		description:
			'The same 甲欄 worker at a payer that elected the 電算機計算の特例: 3,100 by the formula against 3,090 by the table.',
		citation: [
			...SI,
			'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080; 雇用保険 1,500 / 2,550; 労災 900.',
			'平成24年財務省告示第116号 (令和8年分, https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf): A = 255,930; 給与所得控除 255,930 × 30% + 6,667 = 83,446 (別表第一, rounded up); 基礎控除 48,334 (別表第三); 31,667 × 2 (別表第二); B = 255,930 − 83,446 − 48,334 − 63,334 = 60,816; 60,816 × 5.105% = 3,104.66 → 3,100 (別表第四, 10円未満四捨五入).'
		],
		company: { facts: { ...LABOUR, gensen_electronic_calculation: true } },
		period: '2026-05',
		people: [
			sato({
				ref: 'kou',
				name: 'Kou Hiroshi',
				wage: 300_000,
				grade: 300_000,
				terms: { withholding_column: 'KOU', withholding_dependants: 2 }
			})
		],
		expected: {
			kou: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 3_100
			}
		}
	}),
	jp({
		id: 'JP-TAX-11-1',
		description:
			'A non-resident employee’s May 2026 pay of 300,000 is withheld at 20.42% of the whole pay: 61,260.',
		citation: [
			...SI,
			'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080; 雇用保険 1,500 / 2,550; 労災 900.',
			'所得税法 §161(1)(xii)イ, §212(1), §213(1)(i); 復興財源確保法 §28: 20% × 102.1% = 20.42% of 300,000 = 61,260 (NTA https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2884.htm); 社会保険 applies whatever the tax residence.'
		],
		period: '2026-05',
		people: [
			sato({
				ref: 'nr',
				name: 'Non Resident',
				wage: 300_000,
				grade: 300_000,
				taxResidency: 'NON_RESIDENT'
			})
		],
		expected: {
			nr: {
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 61_260
			}
		}
	}),
	jp({
		id: 'JP-TAX-20-1',
		description:
			'A day-hire taken on 18 May 2026 and withheld by the 丙欄 is paid 300,000 for June 2026’s 22 working days: 255,930 after insurance is 11,633.18 a day, 65 a day on the 日額表 丙欄, 1,430.',
		citation: [
			...SI,
			'健康保険法 §3(1)(ii)イ (https://laws.e-gov.go.jp/law/211AC0000000070): a day-hire kept on beyond one month becomes insured; the case records the enrolment from hire. June 2026 pay collects May 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080; 雇用保険 1,500 / 2,550; 労災 900.',
			'所得税法 §185(1)(iii) (https://laws.e-gov.go.jp/law/340AC0000000033): pay for each day worked to a worker employed for not more than two months is withheld on the 丙欄. 令和8年分 日額表 (平成24年財務省告示第115号別表第二, https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/08-14.xls, read 2026-09-30) row 11,600–11,700: 丙欄 65. June 2026 has 22 Monday–Friday days; 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930; ÷ 22 = 11,633.18 → 65 × 22 = 1,430 (equal daily pay, the recorded default of JP-TAX-20).'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'hei',
				name: 'Hei Daichi',
				hired: '2026-05-18',
				wage: 300_000,
				grade: 300_000,
				terms: { withholding_column: 'HEI' }
			})
		],
		expected: {
			hei: {
				gross: 300_000,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 1_430
			}
		}
	}),
	jp({
		id: 'JP-TAX-15-1',
		description:
			'A 1 December 2026 joiner on 300,000 (甲欄, no dependants) brings the prior employer’s 源泉徴収票 (3,300,000 paid, 480,000 insurance, 60,000 withheld): the December 年末調整 under the 令和8年分 rules refunds 13,200.',
		citation: [
			SRC.ei,
			SRC.wc,
			'Enrolled 1 December 2026: the December premium is first collected from January pay (健康保険法 §167(1)), so December carries only 雇用保険 300,000 × 5/1,000 = 1,500 / 2,550 and 労災 900.',
			SRC.tax,
			'所得税法 §190: the year’s pay 3,300,000 + 300,000 = 3,600,000 (the prior employer’s slip entered as the opening). 所得税法別表第五 (令和8年分, 2,200,000–6,600,000 on the pay floored to 4,000): 3,600,000 × 70% − 80,000 = 2,440,000 (NTA No.1410, https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm).',
			'社会保険料控除 480,000 + 1,500 = 481,500; 基礎控除 令和8年分 合計所得 2,440,000 ≤ 4,890,000 → 1,040,000 (NTA No.1199, https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm). 課税給与所得金額 2,440,000 − 481,500 − 1,040,000 = 918,500 → 918,000.',
			'§89: 918,000 × 5% = 45,900; × 102.1% = 46,863.9 → 46,800 (100円未満切捨て). Withheld this year 60,000 (prior employer): 46,800 − 60,000 = −13,200, refunded on the December payslip.'
		],
		period: '2026-12',
		people: [
			sato({
				ref: 'nenmatsu',
				name: 'Nenmatsu Aki',
				hired: '2026-12-01',
				wage: 300_000,
				grade: 300_000,
				terms: { withholding_column: 'KOU', withholding_dependants: 0 },
				incomeTax: {
					elections: { yearend_basic_declaration: true },
					opening: [
						{
							year: '2026',
							base: 3_300_000,
							employee: 60_000,
							employer: 0,
							months: 11,
							reference: '前職 源泉徴収票'
						}
					],
					deduction_claims: [
						{
							period: '2026-11',
							category: 'SOCIAL_INSURANCE',
							amount: 480_000,
							source: 'PRIOR_EMPLOYER',
							reference: '前職 源泉徴収票 社会保険料等の金額'
						}
					]
				}
			})
		],
		expected: {
			nenmatsu: {
				gross: 300_000,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': -13_200
			}
		}
	}),
	jp({
		id: 'JP-WC-01-2',
		description:
			'A company with no 労災保険率表 business type recorded cannot run payroll: workers’ compensation is compulsory and its rate turns on the type.',
		citation: [SRC.wc],
		company: { facts: { employment_insurance_class: 'GENERAL' } },
		period: '2026-05',
		people: [sato({ ref: 'goto', name: 'Goto Mio', wage: 300_000, grade: 300_000 })],
		refused: 'workers_comp_business_type',
		expected: {}
	}),
	jp({
		id: 'JP-EI-01-1',
		description:
			'A worker with no 雇用保険 資格取得 or exclusion recorded cannot be paid: the registration decides the premium.',
		citation: [SRC.ei],
		period: '2026-05',
		people: [
			sato({ ref: 'fujita', name: 'Fujita Sora', wage: 300_000, grade: 300_000, ei: false })
		],
		refused: '雇用保険 資格取得',
		expected: {}
	}),
	jp({
		id: 'JP-EIR-01-1',
		description:
			'A wage period closing on or after 1 April 2027 is refused while the 令和9年度 雇用保険料率 is unpublished (and its pay, due in 2027, while the 令和9年分 源泉徴収税額表 is unsealed).',
		citation: [SRC.ei],
		period: '2027-04',
		people: [sato({ ref: 'goto', name: 'Goto Mio', wage: 300_000, grade: 300_000 })],
		refused: '令和9年',
		expected: {}
	}),
	jp({
		id: 'JP-RES-01-1',
		description:
			'June 2026 pay withholds the first installment of the 令和8年度 notice (15,300); the same notice’s later months are 15,000.',
		citation: [
			...SI,
			SRC.tax,
			SRC.residentTax,
			'June 2026 pay collects the May 2026 insurance month on the 300,000 grade: 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 300,000 × 0.23% ÷ 2 = 345; 厚生年金 300,000 × 9.15% = 27,450; 拠出金 300,000 × 0.36% = 1,080. 雇用保険 300,000 × 5/1,000 = 1,500, employer × 8.5/1,000 = 2,550; 労災 × 3/1,000 = 900.',
			'源泉所得税: 乙欄 on 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.',
			'住民税: the recorded notice (令和8年度, annual 180,300 = 15,300 + 11 × 15,000) withholds its June installment 15,300 from June pay.'
		],
		period: '2026-06',
		people: [
			sato({ ref: 'mori', name: 'Mori Kaito', wage: 300_000, grade: 300_000, terms: NOTICE })
		],
		expected: {
			mori: {
				gross: 300_000,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600,
				'RESIDENT_TAX.employee': 15_300
			}
		}
	}),
	jp({
		id: 'JP-RES-04-1',
		description:
			'Four leavers on 30 September 2026: a lump-collection request (September plus October–May, 135,000), no request and a TRANSFER to a new employer (September’s 15,000 only), and a lump request the final pay cannot cover (September’s 40,000 only).',
		citation: [
			...SI,
			SRC.tax,
			SRC.residentTax,
			'健康保険法 §36, §156(3), §167(1); 厚生年金保険法 §14, §19(1), §84(1): loss on 1 October, so September pay deducts the August and September insurance months on the 300,000 grade: 2 × 14,775 = 29,550, 2 × 345 = 690, 2 × 27,450 = 54,900, 拠出金 2 × 1,080 = 2,160. 雇用保険 1,500 / 2,550; 労災 900.',
			'源泉所得税: 乙欄 on 300,000 − (29,550 + 690 + 54,900 + 1,500) = 213,360 → 月額表 令和8年分 乙欄 213,000–215,000 → 24,100.',
			'住民税: the event (30 September) falls in June–December. Nakamura requested the lump collection: the October–May installments 8 × 15,000 = 120,000 are less than the 300,000 final pay, so 15,000 + 120,000 = 135,000. Kobayashi made no request: September’s 15,000 only; the rest passes to 普通徴収.',
			'Kato moves to a new employer that continues the special collection (TRANSFER, 特別徴収継続): September’s 15,000 only; the new employer withholds October–May.',
			'Saito requested the lump collection under a notice of 40,500 (June) and 40,000 a month: the October–May installments 8 × 40,000 = 320,000 exceed the 300,000 final pay, so §321-5(2) collects none of them from it — September’s 40,000 only.'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'nakamura',
				name: 'Nakamura Yui',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				terms: NOTICE,
				exitFacts: { resident_tax_exit_collection: 'LUMP_SUM' }
			}),
			sato({
				ref: 'kobayashi',
				name: 'Kobayashi Ren',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				terms: NOTICE
			}),
			sato({
				ref: 'kato',
				name: 'Kato Riku',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				terms: NOTICE,
				exitFacts: { resident_tax_exit_collection: 'TRANSFER' }
			}),
			sato({
				ref: 'saito',
				name: 'Saito Aoi',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				terms: { ...NOTICE, resident_tax_june_amount: 40_500, resident_tax_monthly_amount: 40_000 },
				exitFacts: { resident_tax_exit_collection: 'LUMP_SUM' }
			})
		],
		expected: Object.fromEntries(
			(
				[
					['nakamura', 135_000],
					['kobayashi', 15_000],
					['kato', 15_000],
					['saito', 40_000]
				] as const
			).map(([ref, residentTax]) => [
				ref,
				{
					gross: 300_000,
					'HEALTH.employee': 29_550,
					'HEALTH.employer': 29_550,
					'CHILD_SUPPORT.employee': 690,
					'CHILD_SUPPORT.employer': 690,
					'PENSION.employee': 54_900,
					'PENSION.employer': 54_900,
					'CHILD_CONTRIBUTION.employer': 2_160,
					'EMPLOYMENT_INSURANCE.employee': 1_500,
					'EMPLOYMENT_INSURANCE.employer': 2_550,
					'WORKERS_COMP.employer': 900,
					'INCOME_TAX.employee': 24_100,
					'RESIDENT_TAX.employee': residentTax
				}
			])
		)
	}),
	jp({
		id: 'JP-TAX-25-1',
		description:
			'Three leavers on 30 September 2026 each paid a 退職手当: 16½ years with the declaration (general), 2½ years without it (20.42%), 2½ years with it (短期退職手当等).',
		citation: [
			...SI,
			SRC.tax,
			SRC.retirement,
			SRC.retirementLocal,
			'Each: September pay deducts the August and September insurance months on the 300,000 grade (loss 1 October): 29,550 / 690 / 54,900 / 拠出金 2,160; 雇用保険 1,500 / 2,550 and 労災 900 on the 300,000 wage — a 退職手当 is not 報酬, 賞与 or 賃金 — and 乙欄 on 213,360 → 24,100.',
			'Takahashi, 1 April 2010 – 30 September 2026: 16 years 6 months → 17 years; deduction 400,000 × 17 = 6,800,000; (10,000,000 − 6,800,000) ÷ 2 = 1,600,000; 1,600,000 × 5% = 80,000 × 102.1% = 81,680. 退職所得割 1,600,000 × 6% = 96,000 + × 4% = 64,000 → 160,000.',
			'Ito, 1 April 2024 – 30 September 2026, no declaration: 5,000,000 × 20.42% = 1,021,000. 退職所得割 (§328-6(2), the same computation): 2 years 6 months → 3 years, deduction 1,200,000; 5,000,000 − 1,200,000 = 3,800,000 > 3,000,000, so 短期 1,500,000 + (5,000,000 − 4,200,000) = 2,300,000; 138,000 + 92,000 = 230,000.',
			'Yamada, the same service with the declaration: 2,300,000 × 10% − 97,500 = 132,500 × 102.1% = 135,282.5 → 135,282; 退職所得割 230,000.'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'takahashi',
				name: 'Takahashi Ken',
				hired: '2010-04-01',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				exitFacts: { retirement_income_declaration: true }
			}),
			sato({ ref: 'ito', name: 'Ito Mei', wage: 300_000, grade: 300_000, left: '2026-09-30' }),
			sato({
				ref: 'yamada',
				name: 'Yamada Sota',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				exitFacts: { retirement_income_declaration: true }
			})
		],
		extra: (job) => [
			retirementAllowance(job('takahashi'), 10_000_000, '2026-09-30'),
			retirementAllowance(job('ito'), 5_000_000, '2026-09-30'),
			retirementAllowance(job('yamada'), 5_000_000, '2026-09-30')
		],
		expected: Object.fromEntries(
			(
				[
					['takahashi', 81_680, 160_000],
					['ito', 1_021_000, 230_000],
					['yamada', 135_282, 230_000]
				] as const
			).map(([ref, incomeTax, localTax]) => [
				ref,
				{
					'HEALTH.employee': 29_550,
					'HEALTH.employer': 29_550,
					'CHILD_SUPPORT.employee': 690,
					'CHILD_SUPPORT.employer': 690,
					'PENSION.employee': 54_900,
					'PENSION.employer': 54_900,
					'CHILD_CONTRIBUTION.employer': 2_160,
					'EMPLOYMENT_INSURANCE.employee': 1_500,
					'EMPLOYMENT_INSURANCE.employer': 2_550,
					'WORKERS_COMP.employer': 900,
					'INCOME_TAX.employee': 24_100,
					'RETIREMENT_INCOME_TAX.employee': incomeTax,
					'RESIDENT_TAX_RETIREMENT.employee': localTax
				}
			])
		)
	}),
	jp({
		id: 'JP-TAX-25-2',
		description:
			'A 26-year leaver retiring by reason of a disability: the over-20-year 退職所得控除 plus the 1,000,000 disability addition.',
		citation: [
			...SI,
			SRC.tax,
			SRC.retirement,
			SRC.retirementLocal,
			'所得税法 §30(6)(iii), 施行令 §71: a retirement caused directly by becoming disabled adds 1,000,000 to the deduction (NTA No.2732).',
			'Ordinary lines as JP-TAX-25-1 (September leaver on the 300,000 grade and wage, 乙欄 24,100).',
			'Kimura, 1 April 2001 – 30 September 2026: 25 years 6 months → 26 years (recorded); deduction 8,000,000 + 700,000 × (26 − 20) = 12,200,000 + 1,000,000 = 13,200,000; (21,000,000 − 13,200,000) ÷ 2 = 3,900,000; 3,900,000 × 20% − 427,500 = 352,500 × 102.1% = 359,902.5 → 359,902. 退職所得割 3,900,000 × 6% = 234,000 + × 4% = 156,000 → 390,000.'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'kimura',
				name: 'Kimura Daiki',
				hired: '2001-04-01',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				exitFacts: {
					retirement_income_declaration: true,
					retirement_service_years: 26,
					retirement_disability: true
				}
			})
		],
		extra: (job) => [retirementAllowance(job('kimura'), 21_000_000, '2026-09-30')],
		expected: {
			kimura: {
				...SEPTEMBER_LEAVER,
				'RETIREMENT_INCOME_TAX.employee': 359_902,
				'RESIDENT_TAX_RETIREMENT.employee': 390_000
			}
		}
	}),
	jp({
		id: 'JP-TAX-26-1',
		description:
			'A 特定役員退職手当等: an 役員等 for the whole four years of service is taxed on the whole excess over the deduction, no halving.',
		citation: [
			...SI,
			SRC.tax,
			SRC.retirement,
			SRC.retirementLocal,
			'所得税法 §30(5) (特定役員退職手当等: 役員等勤続年数 five years or less): 退職所得 = payment − deduction, without the 1/2 (NTA No.2732).',
			'Ordinary lines as JP-TAX-25-1 (September leaver on the 300,000 grade and wage, 乙欄 24,100).',
			'Hayashi, 1 October 2022 – 30 September 2026, 4 years all as an 役員等 (recorded): deduction 400,000 × 4 = 1,600,000; 5,000,000 − 1,600,000 = 3,400,000; 3,400,000 × 20% − 427,500 = 252,500 × 102.1% = 257,802.5 → 257,802. 退職所得割 3,400,000 × 6% = 204,000 + × 4% = 136,000 → 340,000.'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'hayashi',
				name: 'Hayashi Yuto',
				hired: '2022-10-01',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				exitFacts: {
					retirement_income_declaration: true,
					retirement_service_years: 4,
					retirement_officer_service_years: 4
				}
			})
		],
		extra: (job) => [retirementAllowance(job('hayashi'), 5_000_000, '2026-09-30')],
		expected: {
			hayashi: {
				...SEPTEMBER_LEAVER,
				'RETIREMENT_INCOME_TAX.employee': 257_802,
				'RESIDENT_TAX_RETIREMENT.employee': 340_000
			}
		}
	}),
	jp({
		id: 'JP-TAX-26-2',
		description:
			'Ten years of service of which three as an 役員等: the 施行令 §71-2 split into 特定役員 and other parts is not configured, so the run is refused.',
		citation: [
			SRC.retirement,
			'所得税法 §30(4)–(5), (7); 所得税法施行令 §71-2 (https://laws.e-gov.go.jp/law/340CO0000000096)'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'shimizu',
				name: 'Shimizu Rin',
				hired: '2016-10-01',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				exitFacts: {
					retirement_income_declaration: true,
					retirement_service_years: 10,
					retirement_officer_service_years: 3
				}
			})
		],
		extra: (job) => [retirementAllowance(job('shimizu'), 5_000_000, '2026-09-30')],
		refused: '71-2',
		expected: {}
	}),
	jp({
		id: 'JP-TAX-28-1',
		description:
			'The 施行令 §70 overlap reduction declared as years, its 800,000 floor, and an already-paid same-year allowance combined.',
		citation: [
			...SI,
			SRC.tax,
			SRC.retirement,
			SRC.retirementLocal,
			'所得税法 §30(6)(i)–(ii), 施行令 §70: the deduction less the 退職所得控除 of the overlapping years (from 1 January 2026 an allowance received in the previous nine years where a DC lump sum was, as the declaration states), at least 800,000; §201(1)(ii), 地方税法 §328-6(1)(ii): a same-year allowance already paid is added and its withheld tax deducted.',
			'Ordinary lines as JP-TAX-25-1 (September leaver on the 300,000 grade and wage, 乙欄 24,100). Each: 1 April 2014 – 30 September 2026, 13 years (recorded), 400,000 × 13 = 5,200,000.',
			'Matsumoto, 3 overlapping years: 5,200,000 − 1,200,000 = 4,000,000; (6,000,000 − 4,000,000) ÷ 2 = 1,000,000 × 5% = 50,000 × 102.1% = 51,050. 退職所得割 60,000 + 40,000 = 100,000.',
			'Inoue, 12 overlapping years: 5,200,000 − 4,800,000 = 400,000 < 800,000 → 800,000; (2,000,000 − 800,000) ÷ 2 = 600,000 × 5% = 30,000 × 102.1% = 30,630. 退職所得割 36,000 + 24,000 = 60,000.',
			'Ogawa, no overlap, a 2,000,000 GENERAL allowance already paid this year (20,420 income tax, 40,000 退職所得割 withheld): (6,000,000 + 2,000,000 − 5,200,000) ÷ 2 = 1,400,000 × 5% = 70,000 × 102.1% = 71,470 − 20,420 = 51,050; 退職所得割 84,000 + 56,000 = 140,000 − 40,000 = 100,000.'
		],
		period: '2026-09',
		people: (
			[
				['matsumoto', 'Matsumoto Hina', { retirement_deduction_reduction_years: 3 }],
				['inoue', 'Inoue Sora', { retirement_deduction_reduction_years: 12 }],
				[
					'ogawa',
					'Ogawa Aoi',
					{
						retirement_prior_same_year_amount: 2_000_000,
						retirement_prior_same_year_income_tax: 20_420,
						retirement_prior_same_year_resident_tax: 40_000,
						retirement_prior_same_year_kind: 'GENERAL'
					}
				]
			] as const
		).map(([ref, name, facts]) =>
			sato({
				ref,
				name,
				hired: '2014-04-01',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				exitFacts: { retirement_income_declaration: true, retirement_service_years: 13, ...facts }
			})
		),
		extra: (job) => [
			retirementAllowance(job('matsumoto'), 6_000_000, '2026-09-30'),
			retirementAllowance(job('inoue'), 2_000_000, '2026-09-30'),
			retirementAllowance(job('ogawa'), 6_000_000, '2026-09-30')
		],
		expected: Object.fromEntries(
			(
				[
					['matsumoto', 51_050, 100_000],
					['inoue', 30_630, 60_000],
					['ogawa', 51_050, 100_000]
				] as const
			).map(([ref, incomeTax, localTax]) => [
				ref,
				{
					...SEPTEMBER_LEAVER,
					'RETIREMENT_INCOME_TAX.employee': incomeTax,
					'RESIDENT_TAX_RETIREMENT.employee': localTax
				}
			])
		)
	}),
	jp({
		id: 'JP-RES-01-2',
		description:
			'A notice received late spreads over the months after it: a first month of August withholds its first installment in August; a first month of September withholds nothing in August.',
		citation: [
			...SI,
			SRC.tax,
			SRC.residentTax,
			'Ordinary lines as JP-RES-01-1: August 2026 pay collects the July 2026 insurance month on the 300,000 grade (14,775 / 345 / 27,450 / 拠出金 1,080; 雇用保険 1,500 / 2,550; 労災 900) and 乙欄 on 255,930 → 37,600.',
			'Ueda: a 令和8年度 notice of 166,700 over August–May (10 installments): 166,700 ÷ 10 = 16,670 → 16,600 a month, the sub-JPY100 fractions in the first: 166,700 − 9 × 16,600 = 17,300 in August. Kudo: a notice whose first month is September — nothing in August.'
		],
		period: '2026-08',
		people: [
			sato({
				ref: 'ueda',
				name: 'Ueda Mao',
				wage: 300_000,
				grade: 300_000,
				terms: {
					...NOTICE,
					resident_tax_first_month: 8,
					resident_tax_june_amount: 17_300,
					resident_tax_monthly_amount: 16_600
				}
			}),
			sato({
				ref: 'kudo',
				name: 'Kudo Itsuki',
				wage: 300_000,
				grade: 300_000,
				terms: { ...NOTICE, resident_tax_first_month: 9 }
			})
		],
		expected: Object.fromEntries(
			(
				[
					['ueda', 17_300],
					['kudo', 0]
				] as const
			).map(([ref, residentTax]) => [
				ref,
				{
					gross: 300_000,
					'HEALTH.employee': 14_775,
					'HEALTH.employer': 14_775,
					'CHILD_SUPPORT.employee': 345,
					'CHILD_SUPPORT.employer': 345,
					'PENSION.employee': 27_450,
					'PENSION.employer': 27_450,
					'CHILD_CONTRIBUTION.employer': 1_080,
					'EMPLOYMENT_INSURANCE.employee': 1_500,
					'EMPLOYMENT_INSURANCE.employer': 2_550,
					'WORKERS_COMP.employer': 900,
					'INCOME_TAX.employee': 37_600,
					...(residentTax === 0 ? {} : { 'RESIDENT_TAX.employee': residentTax })
				}
			])
		)
	}),
	jp({
		id: 'JP-WG-03-1',
		description:
			'A dismissal on 30 September 2026 with 10 days’ notice: 20 days of 平均賃金 as 解雇予告手当, a 退職手当等 within the 退職所得控除 and outside 雇用保険.',
		citation: [
			...SI,
			SRC.tax,
			SRC.retirement,
			SRC.retirementLocal,
			'労働基準法 §20(1)–(2) (https://laws.e-gov.go.jp/law/322AC0000000049): 30 days’ 平均賃金, less a day for each day of notice — 30 − 10 = 20 days.',
			'労働基準法 §12(1)–(2): the three months before the event’s month, June–August 2026, 300,000 × 3 = 900,000 over 30 + 31 + 31 = 92 days, recorded on the request as 900,000 ÷ 92 = 9,782.6086…; Kanagawa Labour Bureau (https://jsite.mhlw.go.jp/kanagawa-roudoukyoku/hourei_seido_tetsuzuki/saiteichingin_chinginseido/heikinchi.html): below one sen dropped → 9,782.60; 9,782.60 × 20 = 195,652.',
			'Kanagawa Labour Bureau 賃金早見表 (https://jsite.mhlw.go.jp/kanagawa-roudoukyoku/hourei_seido_tetsuzuki/roudou_hoken/hourei_seido/rouho_hayami.html): 解雇予告手当 is not 賃金 — 雇用保険 1,500 / 2,550 and 労災 900 stay on the 300,000 wage; September pay deducts the August and September insurance months on the 300,000 grade (loss 1 October): 29,550 / 690 / 54,900 / 拠出金 2,160; 乙欄 on 213,360 → 24,100 (as JP-TAX-25-1).',
			'所得税基本通達 30-5 (https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/04/04.htm): a 退職手当等. With the declaration, 1 April 2024 – 30 September 2026 is 3 years, deduction 1,200,000 ≥ 195,652: no 退職所得 tax and no 退職所得割.'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'yamada',
				name: 'Yamada Sota',
				wage: 300_000,
				grade: 300_000,
				left: '2026-09-30',
				exitReason: 'DISMISSAL',
				exitFacts: { retirement_income_declaration: true }
			})
		],
		extra: (job) => [noticePay(job('yamada'), 10, 900_000 / 92, '2026-09-20')],
		expected: {
			yamada: {
				DISMISSAL_NOTICE_PAY: 195_652,
				'HEALTH.employee': 29_550,
				'HEALTH.employer': 29_550,
				'CHILD_SUPPORT.employee': 690,
				'CHILD_SUPPORT.employer': 690,
				'PENSION.employee': 54_900,
				'PENSION.employer': 54_900,
				'CHILD_CONTRIBUTION.employer': 2_160,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 24_100
			}
		}
	})
);

/**
 * September 2026 in every prefecture, computed by hand per row: [JIS code, prefecture, 令和7年度 地域別最低賃金 (JPY an
 * hour), its 発効日, 協会けんぽ 令和8年度 health rate (%), recorded 標準報酬月額, 健康保険 employee / employer, 支援金
 * employee / employer, 厚生年金 each, 拠出金, 雇用保険 employee / employer, 労災, pay after insurance, the 乙欄 band's
 * lower edge, 乙欄 tax]. Sources: MHLW quick table (https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php,
 * read 2026-09-30) and 協会けんぽ 令和8年度都道府県単位保険料率
 * (https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/, read 2026-09-30).
 */
const REGIONS = [
	[
		'01',
		'北海道',
		1_075,
		'令和7.10.04',
		'10.28',
		180_000,
		9_252,
		9_252,
		207,
		207,
		16_470,
		648,
		914,
		1_553,
		548,
		155_907,
		155_000,
		9_200
	],
	[
		'02',
		'青森県',
		1_029,
		'令和7.11.21',
		'9.85',
		170_000,
		8_372,
		8_373,
		195,
		196,
		15_555,
		612,
		875,
		1_486,
		524,
		149_933,
		149_000,
		8_300
	],
	[
		'03',
		'岩手県',
		1_031,
		'令和7.12.01',
		'9.51',
		180_000,
		8_559,
		8_559,
		207,
		207,
		16_470,
		648,
		876,
		1_489,
		525,
		149_158,
		149_000,
		8_300
	],
	[
		'04',
		'宮城県',
		1_038,
		'令和7.10.04',
		'10.10',
		180_000,
		9_090,
		9_090,
		207,
		207,
		16_470,
		648,
		882,
		1_499,
		529,
		149_811,
		149_000,
		8_300
	],
	[
		'05',
		'秋田県',
		1_031,
		'令和8.03.31',
		'10.01',
		180_000,
		9_009,
		9_009,
		207,
		207,
		16_470,
		648,
		876,
		1_489,
		525,
		148_708,
		147_000,
		8_000
	],
	[
		'06',
		'山形県',
		1_032,
		'令和7.12.23',
		'9.75',
		180_000,
		8_775,
		8_775,
		207,
		207,
		16_470,
		648,
		877,
		1_491,
		526,
		149_111,
		149_000,
		8_300
	],
	[
		'07',
		'福島県',
		1_033,
		'令和8.01.01',
		'9.50',
		180_000,
		8_550,
		8_550,
		207,
		207,
		16_470,
		648,
		878,
		1_492,
		526,
		149_505,
		149_000,
		8_300
	],
	[
		'08',
		'茨城県',
		1_074,
		'令和7.10.12',
		'9.52',
		180_000,
		8_568,
		8_568,
		207,
		207,
		16_470,
		648,
		913,
		1_551,
		547,
		156_422,
		155_000,
		9_200
	],
	[
		'09',
		'栃木県',
		1_068,
		'令和7.10.01',
		'9.82',
		180_000,
		8_838,
		8_838,
		207,
		207,
		16_470,
		648,
		908,
		1_543,
		544,
		155_137,
		155_000,
		9_200
	],
	[
		'10',
		'群馬県',
		1_063,
		'令和8.03.01',
		'9.68',
		180_000,
		8_712,
		8_712,
		207,
		207,
		16_470,
		648,
		904,
		1_536,
		542,
		154_417,
		153_000,
		8_900
	],
	[
		'11',
		'埼玉県',
		1_141,
		'令和7.11.01',
		'9.67',
		190_000,
		9_186,
		9_187,
		218,
		219,
		17_385,
		684,
		970,
		1_648,
		581,
		166_211,
		165_000,
		10_700
	],
	[
		'12',
		'千葉県',
		1_140,
		'令和7.10.03',
		'9.73',
		190_000,
		9_243,
		9_244,
		218,
		219,
		17_385,
		684,
		969,
		1_647,
		581,
		165_985,
		165_000,
		10_700
	],
	[
		'13',
		'東京都',
		1_226,
		'令和7.10.03',
		'9.85',
		200_000,
		9_850,
		9_850,
		230,
		230,
		18_300,
		720,
		1042,
		1_771,
		625,
		178_998,
		177_000,
		12_500
	],
	[
		'14',
		'神奈川県',
		1_225,
		'令和7.10.04',
		'9.92',
		200_000,
		9_920,
		9_920,
		230,
		230,
		18_300,
		720,
		1041,
		1_770,
		624,
		178_759,
		177_000,
		12_500
	],
	[
		'15',
		'新潟県',
		1_050,
		'令和7.10.02',
		'9.21',
		180_000,
		8_289,
		8_289,
		207,
		207,
		16_470,
		648,
		892,
		1_517,
		535,
		152_642,
		151_000,
		8_600
	],
	[
		'16',
		'富山県',
		1_062,
		'令和7.10.12',
		'9.59',
		180_000,
		8_631,
		8_631,
		207,
		207,
		16_470,
		648,
		903,
		1_534,
		541,
		154_329,
		153_000,
		8_900
	],
	[
		'17',
		'石川県',
		1_054,
		'令和7.10.08',
		'9.70',
		180_000,
		8_730,
		8_730,
		207,
		207,
		16_470,
		648,
		896,
		1_523,
		537,
		152_877,
		151_000,
		8_600
	],
	[
		'18',
		'福井県',
		1_053,
		'令和7.10.08',
		'9.71',
		180_000,
		8_739,
		8_739,
		207,
		207,
		16_470,
		648,
		895,
		1_521,
		537,
		152_699,
		151_000,
		8_600
	],
	[
		'19',
		'山梨県',
		1_052,
		'令和7.12.01',
		'9.55',
		180_000,
		8_595,
		8_595,
		207,
		207,
		16_470,
		648,
		894,
		1_520,
		536,
		152_674,
		151_000,
		8_600
	],
	[
		'20',
		'長野県',
		1_061,
		'令和7.10.03',
		'9.63',
		180_000,
		8_667,
		8_667,
		207,
		207,
		16_470,
		648,
		902,
		1_533,
		541,
		154_124,
		153_000,
		8_900
	],
	[
		'21',
		'岐阜県',
		1_065,
		'令和7.10.18',
		'9.80',
		180_000,
		8_820,
		8_820,
		207,
		207,
		16_470,
		648,
		905,
		1_538,
		543,
		154_648,
		153_000,
		8_900
	],
	[
		'22',
		'静岡県',
		1_097,
		'令和7.11.01',
		'9.61',
		190_000,
		9_129,
		9_130,
		218,
		219,
		17_385,
		684,
		932,
		1_585,
		559,
		158_826,
		157_000,
		9_500
	],
	[
		'23',
		'愛知県',
		1_140,
		'令和7.10.18',
		'9.93',
		190_000,
		9_433,
		9_434,
		218,
		219,
		17_385,
		684,
		969,
		1_647,
		581,
		165_795,
		165_000,
		10_700
	],
	[
		'24',
		'三重県',
		1_087,
		'令和7.11.21',
		'9.77',
		180_000,
		8_793,
		8_793,
		207,
		207,
		16_470,
		648,
		924,
		1_570,
		554,
		158_396,
		157_000,
		9_500
	],
	[
		'25',
		'滋賀県',
		1_080,
		'令和7.10.05',
		'9.88',
		180_000,
		8_892,
		8_892,
		207,
		207,
		16_470,
		648,
		918,
		1_560,
		550,
		157_113,
		157_000,
		9_500
	],
	[
		'26',
		'京都府',
		1_122,
		'令和7.11.21',
		'9.89',
		190_000,
		9_395,
		9_396,
		218,
		219,
		17_385,
		684,
		954,
		1_621,
		572,
		162_788,
		161_000,
		10_100
	],
	[
		'27',
		'大阪府',
		1_177,
		'令和7.10.16',
		'10.13',
		200_000,
		10_130,
		10_130,
		230,
		230,
		18_300,
		720,
		1000,
		1_700,
		600,
		170_430,
		169_000,
		11_300
	],
	[
		'28',
		'兵庫県',
		1_116,
		'令和7.10.04',
		'10.12',
		190_000,
		9_614,
		9_614,
		218,
		219,
		17_385,
		684,
		949,
		1_612,
		569,
		161_554,
		161_000,
		10_100
	],
	[
		'29',
		'奈良県',
		1_051,
		'令和7.11.16',
		'9.91',
		180_000,
		8_919,
		8_919,
		207,
		207,
		16_470,
		648,
		893,
		1_518,
		536,
		152_181,
		151_000,
		8_600
	],
	[
		'30',
		'和歌山県',
		1_045,
		'令和7.11.01',
		'10.06',
		180_000,
		9_054,
		9_054,
		207,
		207,
		16_470,
		648,
		888,
		1_510,
		532,
		151_031,
		151_000,
		8_600
	],
	[
		'31',
		'鳥取県',
		1_030,
		'令和7.10.04',
		'9.86',
		180_000,
		8_874,
		8_874,
		207,
		207,
		16_470,
		648,
		875,
		1_488,
		525,
		148_674,
		147_000,
		8_000
	],
	[
		'32',
		'島根県',
		1_033,
		'令和7.11.17',
		'9.94',
		180_000,
		8_946,
		8_946,
		207,
		207,
		16_470,
		648,
		878,
		1_492,
		526,
		149_109,
		149_000,
		8_300
	],
	[
		'33',
		'岡山県',
		1_047,
		'令和7.12.01',
		'10.05',
		180_000,
		9_045,
		9_045,
		207,
		207,
		16_470,
		648,
		890,
		1_512,
		533,
		151_378,
		151_000,
		8_600
	],
	[
		'34',
		'広島県',
		1_085,
		'令和7.11.01',
		'9.78',
		180_000,
		8_802,
		8_802,
		207,
		207,
		16_470,
		648,
		922,
		1_567,
		553,
		158_049,
		157_000,
		9_500
	],
	[
		'35',
		'山口県',
		1_043,
		'令和7.10.16',
		'10.15',
		180_000,
		9_135,
		9_135,
		207,
		207,
		16_470,
		648,
		887,
		1_507,
		531,
		150_611,
		149_000,
		8_300
	],
	[
		'36',
		'徳島県',
		1_046,
		'令和8.01.01',
		'10.24',
		180_000,
		9_216,
		9_216,
		207,
		207,
		16_470,
		648,
		889,
		1_511,
		533,
		151_038,
		151_000,
		8_600
	],
	[
		'37',
		'香川県',
		1_036,
		'令和7.10.18',
		'10.02',
		180_000,
		9_018,
		9_018,
		207,
		207,
		16_470,
		648,
		881,
		1_497,
		528,
		149_544,
		149_000,
		8_300
	],
	[
		'38',
		'愛媛県',
		1_033,
		'令和7.12.01',
		'9.98',
		180_000,
		8_982,
		8_982,
		207,
		207,
		16_470,
		648,
		878,
		1_492,
		526,
		149_073,
		149_000,
		8_300
	],
	[
		'39',
		'高知県',
		1_023,
		'令和7.12.01',
		'10.05',
		170_000,
		8_542,
		8_543,
		195,
		196,
		15_555,
		612,
		870,
		1_478,
		521,
		148_748,
		147_000,
		8_000
	],
	[
		'40',
		'福岡県',
		1_057,
		'令和7.11.16',
		'10.11',
		180_000,
		9_099,
		9_099,
		207,
		207,
		16_470,
		648,
		898,
		1_527,
		539,
		153_016,
		153_000,
		8_900
	],
	[
		'41',
		'佐賀県',
		1_030,
		'令和7.11.21',
		'10.55',
		180_000,
		9_495,
		9_495,
		207,
		207,
		16_470,
		648,
		875,
		1_488,
		525,
		148_053,
		147_000,
		8_000
	],
	[
		'42',
		'長崎県',
		1_031,
		'令和7.12.01',
		'10.06',
		180_000,
		9_054,
		9_054,
		207,
		207,
		16_470,
		648,
		876,
		1_489,
		525,
		148_663,
		147_000,
		8_000
	],
	[
		'43',
		'熊本県',
		1_034,
		'令和8.01.01',
		'10.08',
		180_000,
		9_072,
		9_072,
		207,
		207,
		16_470,
		648,
		879,
		1_494,
		527,
		149_152,
		149_000,
		8_300
	],
	[
		'44',
		'大分県',
		1_035,
		'令和8.01.01',
		'10.08',
		180_000,
		9_072,
		9_072,
		207,
		207,
		16_470,
		648,
		880,
		1_495,
		527,
		149_321,
		149_000,
		8_300
	],
	[
		'45',
		'宮崎県',
		1_023,
		'令和7.11.16',
		'9.77',
		170_000,
		8_304,
		8_305,
		195,
		196,
		15_555,
		612,
		870,
		1_478,
		521,
		148_986,
		147_000,
		8_000
	],
	[
		'46',
		'鹿児島県',
		1_026,
		'令和7.11.01',
		'10.13',
		170_000,
		8_610,
		8_611,
		195,
		196,
		15_555,
		612,
		872,
		1_482,
		523,
		149_188,
		149_000,
		8_300
	],
	[
		'47',
		'沖縄県',
		1_023,
		'令和7.12.01',
		'9.44',
		170_000,
		8_024,
		8_024,
		195,
		196,
		15_555,
		612,
		870,
		1_478,
		521,
		149_266,
		149_000,
		8_300
	]
] as const;

/** A leave entry for the whole days `from`–`to`. */
const leave = (
	job: string,
	code: string,
	from: string,
	to: string,
	event: Row = {}
): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: job,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference: `${code}-${from}`,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		reason: code,
		...event
	}
});

const yen = (n: number) => n.toLocaleString('en-US');

register(
	...REGIONS.map(
		([
			jis,
			region,
			floor,
			since,
			rate,
			grade,
			he,
			hr,
			se,
			sr,
			pe,
			cc,
			ee,
			er,
			wc,
			after,
			band,
			tax
		]) => {
			const gross = floor * 170;
			return jp({
				id: `JP-REGION-${jis}-1`,
				description: `A ${region} establishment and worksite in September 2026: a contract of 150,000 a month on 2,040 annual hours (882.35 an hour) is below the ${region} 地域別最低賃金 of ${yen(floor)}, so the wage is ${yen(floor)} × 170 = ${yen(gross)}; August’s premium at the ${region} branch rate of ${rate}%.`,
				citation: [
					SRC.minimumWage,
					`MHLW quick table (https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php, read 2026-09-30): ${region} ${yen(floor)}円 from ${since}, in force for all of September 2026. 最低賃金法 §4(2): the wage below the floor is replaced by it — 150,000 ÷ (2,040 ÷ 12 = 170) = 882.35 < ${yen(floor)}; ${yen(floor)} × 170 = ${yen(gross)}.`,
					...SI,
					`協会けんぽ 令和8年度都道府県単位保険料率 (https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/, read 2026-09-30): ${region} ${rate}% from the March 2026 insurance month; born 1990, no 介護.`,
					`September pay collects August on the recorded ${yen(grade)} grade (健康保険法 §40 band of the ${yen(gross)} wage): health ${yen(grade)} × ${rate}% ÷ 2 → ${yen(he)} employee, ${yen(hr)} employer; 支援金 ${yen(grade)} × 0.23% ÷ 2 → ${se} / ${sr}; 厚生年金 ${yen(grade)} × 9.15% = ${yen(pe)} each; 拠出金 ${yen(grade)} × 0.36% = ${cc}.`,
					`${yen(gross)}: 雇用保険 令和8年度 × 5/1,000 → ${ee}, employer × 8.5/1,000 → ${yen(er)}; 労災 × 3/1,000 → ${wc}.`,
					SRC.tax,
					`源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on ${yen(gross)} − (${yen(he)} + ${se} + ${yen(pe)} + ${ee}) = ${yen(after)} → 月額表 令和8年分 乙欄 from ${yen(band)} → ${yen(tax)}.`
				],
				company: { region },
				period: '2026-09',
				people: [
					sato({
						ref: 'nakamura',
						name: 'Nakamura Yuto',
						wage: 150_000,
						grade,
						worksite: region
					})
				],
				expected: {
					nakamura: {
						gross,
						'HEALTH.employee': he,
						'HEALTH.employer': hr,
						'CHILD_SUPPORT.employee': se,
						'CHILD_SUPPORT.employer': sr,
						'PENSION.employee': pe,
						'PENSION.employer': pe,
						'CHILD_CONTRIBUTION.employer': cc,
						'EMPLOYMENT_INSURANCE.employee': ee,
						'EMPLOYMENT_INSURANCE.employer': er,
						'WORKERS_COMP.employer': wc,
						'INCOME_TAX.employee': tax
					}
				}
			});
		}
	),
	jp({
		id: 'JP-RF-R8-1',
		description:
			'A Tokyo company’s October 2026 payroll for four workers at worksites in 北海道, 宮城県, 神奈川県 and 大阪府 on 150,000 a month: each floor is the worksite’s 令和8年度 地域別最低賃金 from 1 October, not Tokyo’s.',
		citation: [
			SRC.minimumWage,
			'最低賃金法 §9(1) (https://laws.e-gov.go.jp/law/334AC0000000137): the 地域別最低賃金 is decided per region and binds work at a workplace there (MHLW: 事業場の所在地の最低賃金), whatever the employer’s head office.',
			'MHLW quick table (https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php, read 2026-09-30): from 令和8.10.01 北海道 1,131円, 宮城県 1,098円, 神奈川県 1,279円, 大阪府 1,231円 — in force for all of October. 150,000 ÷ 170 = 882.35 is below each: 北海道 1,131 × 170 = 192,270; 宮城県 1,098 × 170 = 186,660; 神奈川県 1,279 × 170 = 217,430; 大阪府 1,231 × 170 = 209,270.',
			...SI,
			'October pay collects September at 東京都 9.85% (the establishment’s branch): 190,000 grade — health 18,715 ÷ 2 = 9,357.5 → 9,357 / 9,358, 支援金 437 ÷ 2 = 218.5 → 218 / 219, 厚生年金 17,385 each, 拠出金 684; 220,000 grade — 10,835 each, 253 each, 20,130 each, 792; 200,000 grade — 9,850 each, 230 each, 18,300 each, 720.',
			'雇用保険 令和8年度 5/8.5 per 1,000, 労災 3: 192,270 → 961.35 → 961, 1,634, 576; 186,660 → 933.3 → 933, 1,586, 559; 217,430 → 1,087.15 → 1,087, 1,848, 652; 209,270 → 1,046.35 → 1,046, 1,778, 627.',
			SRC.tax,
			'源泉所得税 乙欄 (月額表 令和8年分): 北海道 192,270 − (9,357 + 218 + 17,385 + 961) = 164,349 → 163,000–165,000 → 10,400; 宮城県 186,660 − (9,357 + 218 + 17,385 + 933) = 158,767 → 157,000–159,000 → 9,500; 神奈川県 217,430 − (10,835 + 253 + 20,130 + 1,087) = 185,125 → 185,000–187,000 → 14,700; 大阪府 209,270 − (9,850 + 230 + 18,300 + 1,046) = 179,844 → 179,000–181,000 → 12,800.'
		],
		period: '2026-10',
		people: [
			sato({ ref: 'hk', name: 'Abe Sora', wage: 150_000, grade: 190_000, worksite: '北海道' }),
			sato({ ref: 'mg', name: 'Endo Hina', wage: 150_000, grade: 190_000, worksite: '宮城県' }),
			sato({ ref: 'kn', name: 'Fujii Kaito', wage: 150_000, grade: 220_000, worksite: '神奈川県' }),
			sato({ ref: 'os', name: 'Goto Mio', wage: 150_000, grade: 200_000, worksite: '大阪府' })
		],
		expected: {
			hk: {
				gross: 192_270,
				'HEALTH.employee': 9_357,
				'HEALTH.employer': 9_358,
				'CHILD_SUPPORT.employee': 218,
				'CHILD_SUPPORT.employer': 219,
				'PENSION.employee': 17_385,
				'PENSION.employer': 17_385,
				'CHILD_CONTRIBUTION.employer': 684,
				'EMPLOYMENT_INSURANCE.employee': 961,
				'EMPLOYMENT_INSURANCE.employer': 1_634,
				'WORKERS_COMP.employer': 576,
				'INCOME_TAX.employee': 10_400
			},
			mg: {
				gross: 186_660,
				'HEALTH.employee': 9_357,
				'HEALTH.employer': 9_358,
				'CHILD_SUPPORT.employee': 218,
				'CHILD_SUPPORT.employer': 219,
				'PENSION.employee': 17_385,
				'PENSION.employer': 17_385,
				'CHILD_CONTRIBUTION.employer': 684,
				'EMPLOYMENT_INSURANCE.employee': 933,
				'EMPLOYMENT_INSURANCE.employer': 1_586,
				'WORKERS_COMP.employer': 559,
				'INCOME_TAX.employee': 9_500
			},
			kn: {
				gross: 217_430,
				'HEALTH.employee': 10_835,
				'HEALTH.employer': 10_835,
				'CHILD_SUPPORT.employee': 253,
				'CHILD_SUPPORT.employer': 253,
				'PENSION.employee': 20_130,
				'PENSION.employer': 20_130,
				'CHILD_CONTRIBUTION.employer': 792,
				'EMPLOYMENT_INSURANCE.employee': 1_087,
				'EMPLOYMENT_INSURANCE.employer': 1_848,
				'WORKERS_COMP.employer': 652,
				'INCOME_TAX.employee': 14_700
			},
			os: {
				gross: 209_270,
				'HEALTH.employee': 9_850,
				'HEALTH.employer': 9_850,
				'CHILD_SUPPORT.employee': 230,
				'CHILD_SUPPORT.employer': 230,
				'PENSION.employee': 18_300,
				'PENSION.employer': 18_300,
				'CHILD_CONTRIBUTION.employer': 720,
				'EMPLOYMENT_INSURANCE.employee': 1_046,
				'EMPLOYMENT_INSURANCE.employer': 1_778,
				'WORKERS_COMP.employer': 627,
				'INCOME_TAX.employee': 12_800
			}
		}
	}),
	jp({
		id: 'JP-SI-02-2',
		description:
			'A full September 2026 month in Tokyo on 300,000 for a 30-year-old (health and 支援金 only) and a 45-year-old (health plus 介護 1.62%).',
		citation: [
			...SI,
			'介護保険法 §9(2) (https://laws.e-gov.go.jp/law/409AC0000000123): a 第2号被保険者 is a resident aged 40 to 64 — born 1996-04-10 (30) is not; born 1981-03-03 (45) is, for the whole of the August insurance month.',
			'September pay collects August on the 300,000 grade at 東京都 9.85% (令和8年度): age 30 — 300,000 × 9.85% ÷ 2 = 14,775; age 45 — 300,000 × 11.47% ÷ 2 = 17,205. Both: 支援金 345, 厚生年金 27,450, 拠出金 1,080.',
			'300,000: 雇用保険 令和8年度 × 5/1,000 = 1,500, employer × 8.5/1,000 = 2,550; 労災 × 3/1,000 = 900.',
			SRC.tax,
			'源泉所得税 乙欄: age 30 — 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930 → 254,000–257,000 → 37,600; age 45 — 300,000 − (17,205 + 345 + 27,450 + 1,500) = 253,500 → 251,000–254,000 → 36,600.'
		],
		period: '2026-09',
		people: [
			sato({ ref: 'ueda', name: 'Ueda Daiki', born: '1996-04-10', wage: 300_000, grade: 300_000 }),
			sato({
				ref: 'noguchi',
				name: 'Noguchi Emi',
				born: '1981-03-03',
				wage: 300_000,
				grade: 300_000
			})
		],
		expected: {
			ueda: {
				gross: 300_000,
				BASIC: 300_000,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 37_600
			},
			noguchi: {
				gross: 300_000,
				BASIC: 300_000,
				'HEALTH.employee': 17_205,
				'HEALTH.employer': 17_205,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': 36_600
			}
		}
	}),
	jp({
		id: 'JP-HR-21-1',
		description:
			'Two unpaid 介護休暇 days (Tuesday 9 and Wednesday 10 June 2026) for a worker with one family member in need of care, on 300,000: 2 of June’s 22 scheduled working days are not paid.',
		citation: [
			'育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律 §16-5(1) (https://laws.e-gov.go.jp/law/403AC0000000076): 5 working days a year for one family member; the Act does not make them paid — docs/inventory/japan.csv JP-HR-21 records the default, unpaid.',
			'Unworked scheduled days are deducted at the JP-PRO-01 rate (owner rule 2026-09-28, 労働基準法 §24 silent on the method): June 2026 has 22 Monday–Friday days; 300,000 × 20 ÷ 22 = 272,727.27 → 272,727 (通貨の単位及び貨幣の発行等に関する法律 §3).',
			...SI,
			'June pay collects May on the 300,000 grade (the grade does not move with an absence): 14,775 each, 支援金 345 each, 厚生年金 27,450 each, 拠出金 1,080.',
			'272,727: 雇用保険 令和8年度 × 5/1,000 = 1,363.635 → 1,364 (over 50 sen up), employer × 8.5/1,000 = 2,318.18 → 2,318; 労災 × 3/1,000 = 818.18 → 818.',
			SRC.tax,
			'源泉所得税 乙欄: 272,727 − (14,775 + 345 + 27,450 + 1,364) = 228,793 → 月額表 令和8年分 乙欄 227,000–230,000 → 28,500.'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'ishii',
				name: 'Ishii Nanami',
				wage: 300_000,
				grade: 300_000,
				terms: { care_family_members: 1 }
			})
		],
		extra: (job) => [leave(job('ishii'), 'FAMILY_CARE_DAYS', '2026-06-09', '2026-06-10')],
		expected: {
			ishii: {
				gross: 272_727,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_364,
				'EMPLOYMENT_INSURANCE.employer': 2_318,
				'WORKERS_COMP.employer': 818,
				'INCOME_TAX.employee': 28_500
			}
		}
	}),
	jp({
		id: 'JP-AL-04-1',
		description:
			'Two 年次有給休暇 days (9–10 June 2026) on 340,000 are paid as the ordinary wage for scheduled hours: the month is paid whole.',
		citation: [
			'労働基準法 §39(1)–(2), (9) (https://laws.e-gov.go.jp/law/322AC0000000049) with 施行規則 §25: hired 1 April 2024, at least 10 days after six months and 11 after eighteen, so two days are within the entitlement; paid at the ordinary wage for the scheduled hours — docs/inventory/japan.csv JP-AL-04 records that method.',
			...SI,
			'June pay collects May on the 340,000 grade at 東京都 9.85%: 340,000 × 9.85% ÷ 2 = 16,745; 支援金 340,000 × 0.23% ÷ 2 = 391; 厚生年金 31,110; 拠出金 1,224.',
			'340,000: 雇用保険 × 5/1,000 = 1,700, employer × 8.5/1,000 = 2,890; 労災 × 3/1,000 = 1,020.',
			SRC.tax,
			'源泉所得税 乙欄: 340,000 − (16,745 + 391 + 31,110 + 1,700) = 290,054 → 月額表 令和8年分 乙欄 290,000–293,000 → 50,000.'
		],
		period: '2026-06',
		people: [sato()],
		extra: (job) => [leave(job('sato'), 'ANNUAL_LEAVE', '2026-06-09', '2026-06-10')],
		expected: {
			sato: {
				gross: 340_000,
				BASIC: 340_000,
				'HEALTH.employee': 16_745,
				'HEALTH.employer': 16_745,
				'CHILD_SUPPORT.employee': 391,
				'CHILD_SUPPORT.employer': 391,
				'PENSION.employee': 31_110,
				'PENSION.employer': 31_110,
				'CHILD_CONTRIBUTION.employer': 1_224,
				'EMPLOYMENT_INSURANCE.employee': 1_700,
				'EMPLOYMENT_INSURANCE.employer': 2_890,
				'WORKERS_COMP.employer': 1_020,
				'INCOME_TAX.employee': 50_000
			}
		}
	}),
	jp({
		id: 'JP-LS09-1',
		description:
			'A worker on 300,000 gives birth on Monday 15 June 2026 and takes 産前産後休業 from that day to 10 August: the employer does not pay the leave (出産手当金 is the insurer’s), so June pays the 10 days worked of 22.',
		citation: [
			'労働基準法 §65(1)–(2) (https://laws.e-gov.go.jp/law/322AC0000000049): prenatal leave on request, no work for eight weeks after the birth — the birth day falls in the prenatal part, so 15 June plus the 56 days 16 June – 10 August. The Act does not make the leave paid; 健康保険法 §102 (https://laws.e-gov.go.jp/law/211AC0000000070) pays 出産手当金 outside payroll — docs/inventory/japan.csv JP-LS09 (paid_by FUND).',
			'Unworked scheduled days are deducted at the JP-PRO-01 rate: June 2026 has 22 Monday–Friday days, 1–12 June (10) worked; 300,000 × 10 ÷ 22 = 136,363.64 → 136,364 (通貨の単位及び貨幣の発行等に関する法律 §3).',
			...SI,
			'June pay collects May on the 300,000 grade; the 健康保険法 §159-3 (厚生年金保険法 §81-2-2) maternity exemption starts with the June insurance month, collected from July pay: 14,775 each, 支援金 345 each, 厚生年金 27,450 each, 拠出金 1,080.',
			'136,364: 雇用保険 令和8年度 × 5/1,000 = 681.82 → 682 (over 50 sen up), employer × 8.5/1,000 = 1,159.094 → 1,159; 労災 × 3/1,000 = 409.092 → 409.',
			SRC.tax,
			'源泉所得税 乙欄: 136,364 − (14,775 + 345 + 27,450 + 682) = 93,112, under 105,000 → 3.063% = 2,852.02 → 2,852 (sub-yen dropped, recorded default).'
		],
		period: '2026-06',
		people: [
			sato({ ref: 'mori', name: 'Mori Yui', wage: 300_000, grade: 300_000, gender: 'FEMALE' })
		],
		extra: (job) => [
			leave(job('mori'), 'MATERNITY_LEAVE', '2026-06-15', '2026-08-10', {
				facts: {
					event_kind: 'BIRTH',
					event_date: '2026-06-15'
				}
			})
		],
		expected: {
			mori: {
				gross: 136_364,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 682,
				'EMPLOYMENT_INSURANCE.employer': 1_159,
				'WORKERS_COMP.employer': 409,
				'INCOME_TAX.employee': 2_852
			}
		}
	}),
	jp({
		id: 'JP-WG-02-1',
		description:
			'An employer-caused shutdown on Tuesday 9 and Wednesday 10 June 2026 for a worker on 300,000: the two days come off the wage and 休業手当 pays 60% of the 平均賃金 for each.',
		citation: [
			'労働基準法 §26 (https://laws.e-gov.go.jp/law/322AC0000000049): at least 60% of the 平均賃金 for each day of a shutdown attributable to the employer.',
			'労働基準法 §12(1)–(2): the three months before the event’s month, March–May 2026, 300,000 × 3 = 900,000 over 31 + 30 + 31 = 92 days, recorded on the request as 900,000 ÷ 92 = 9,782.6086…; Kanagawa Labour Bureau (https://jsite.mhlw.go.jp/kanagawa-roudoukyoku/hourei_seido_tetsuzuki/saiteichingin_chinginseido/heikinchi.html): below one sen dropped → 9,782.60; 9,782.60 × 60% × 2 = 11,739.12 → 11,739.',
			'The two unworked scheduled days are deducted at the JP-PRO-01 rate: 300,000 × 20 ÷ 22 = 272,727.27 → 272,727; gross 272,727 + 11,739 = 284,466.',
			...SI,
			'June pay collects May on the 300,000 grade: 14,775 each, 支援金 345 each, 厚生年金 27,450 each, 拠出金 1,080.',
			'Kanagawa Labour Bureau 賃金早見表 (https://jsite.mhlw.go.jp/kanagawa-roudoukyoku/hourei_seido_tetsuzuki/roudou_hoken/hourei_seido/rouho_hayami.html): 休業手当 is 賃金 — 284,466 × 5/1,000 = 1,422.33 → 1,422, employer × 8.5/1,000 = 2,417.961 → 2,417; 労災 × 3/1,000 = 853.398 → 853.',
			SRC.tax,
			'所得税法 §28(1): 休業手当 is 給与. 乙欄: 284,466 − (14,775 + 345 + 27,450 + 1,422) = 240,474 → 月額表 令和8年分 乙欄 239,000–242,000 → 32,600.'
		],
		period: '2026-06',
		people: [sato({ ref: 'ono', name: 'Ono Riku', wage: 300_000, grade: 300_000 })],
		extra: (job) => [
			worked(job('ono'), '2026-06-09'),
			worked(job('ono'), '2026-06-10'),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: job('ono'),
					catalogue_id: '@law:adhoc_catalogue:SHUTDOWN_ALLOWANCE',
					amount: 0,
					event_date: '2026-06-10',
					reason: '休業手当',
					facts: { shutdown_days: 2, wages_paid: 0, average_wage: 900_000 / 92 }
				}
			}
		],
		expected: {
			ono: {
				gross: 284_466,
				SHUTDOWN_ALLOWANCE: 11_739,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_422,
				'EMPLOYMENT_INSURANCE.employer': 2_417,
				'WORKERS_COMP.employer': 853,
				'INCOME_TAX.employee': 32_600
			}
		}
	}),
	jp({
		id: 'JP-TAX-07-BANDS-1',
		description:
			'September 2026: 300,000 plus a 20,000 通勤手当 for a 20 km one-way car commute with 3,000 of parking: 16,500 is untaxed, the whole 20,000 bears 雇用保険 and 労災.',
		citation: [
			'所得税法 §9(1)(v); 所得税法施行令 §20の2; NTA 令和8年4月1日以後 table (https://www.nta.go.jp/users/gensen/2026tsukin/index.htm, read 2026-09-30): 15 km to under 25 km, 13,500 a month; parking up to 5,000 added for a vehicle distance of 2 km or more — 13,500 + 3,000 = 16,500 untaxed; 3,500 taxable.',
			'徴収法 §2(2) (https://laws.e-gov.go.jp/law/344AC0000000084): the 通勤手当 is 賃金 — 320,000 × 5/1,000 = 1,600, employer × 8.5/1,000 = 2,720; 労災 × 3/1,000 = 960.',
			...SI,
			'September pay collects August on the recorded 300,000 grade: 14,775 each, 支援金 345 each, 厚生年金 27,450 each, 拠出金 1,080.',
			SRC.tax,
			'源泉所得税 乙欄: (320,000 − 16,500) − (14,775 + 345 + 27,450 + 1,600) = 259,330 → 月額表 令和8年分 乙欄 257,000–260,000 → 38,600.'
		],
		period: '2026-09',
		people: [
			sato({
				ref: 'okada',
				name: 'Okada Shun',
				wage: 300_000,
				grade: 300_000,
				terms: { commute_vehicle_km: 20, commute_parking_fee: 3_000 },
				allowances: [{ catalogue_id: '@law:allowance_catalogue:COMMUTING', amount: 20_000 }]
			})
		],
		expected: {
			okada: {
				gross: 320_000,
				BASIC: 300_000,
				COMMUTING: 20_000,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_600,
				'EMPLOYMENT_INSURANCE.employer': 2_720,
				'WORKERS_COMP.employer': 960,
				'INCOME_TAX.employee': 38_600
			}
		}
	})
);

/**
 * The 令和8年度 floors that take effect after 1 October 2026 (JP-RF-R8-1 covers the 1 October ones): a whole pay period
 * after the prefecture's 発効日, company and worksite in the prefecture, figures as REGIONS.
 */
register(
	jp({
		id: 'JP-RF24-R8-1',
		description:
			'A 京都府 establishment and worksite in December 2026: 150,000 a month on 2,040 annual hours (882.35 an hour) is below the 令和8年度 京都府 floor of 1,180 from 16 November 2026, so the wage is 1,180 × 170 = 200,600.',
		citation: [
			SRC.minimumWage,
			'Kyoto Labour Bureau (https://jsite.mhlw.go.jp/kyoto-roudoukyoku/news_topics/houdou/_00281.html) and MHLW quick table (https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php, read 2026-09-30): 京都府 1,180円 from 令和8.11.16, in force for all of December 2026. 最低賃金法 §4(2): 150,000 ÷ 170 = 882.35 < 1,180; 1,180 × 170 = 200,600.',
			...SI,
			'協会けんぽ 令和8年度都道府県単位保険料率 (https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/, read 2026-09-30): 京都府 9.89%; born 1990, no 介護.',
			'December pay collects November on the recorded 190,000 grade: health 190,000 × 9.89% = 18,791 ÷ 2 = 9,395.5 → 9,395 employee, 9,396 employer; 支援金 437 ÷ 2 = 218.5 → 218 / 219; 厚生年金 190,000 × 9.15% = 17,385 each; 拠出金 190,000 × 0.36% = 684.',
			'200,600: 雇用保険 令和8年度 × 5/1,000 = 1,003, employer × 8.5/1,000 = 1,705.1 → 1,705; 労災 × 3/1,000 = 601.8 → 601.',
			SRC.tax,
			'源泉所得税: no 扶養控除等申告書 recorded (乙欄, so no 年末調整): 200,600 − (9,395 + 218 + 17,385 + 1,003) = 172,599 → 月額表 令和8年分 乙欄 171,000–173,000 → 11,500.'
		],
		company: { region: '京都府' },
		period: '2026-12',
		people: [
			sato({ ref: 'kyoto', name: 'Mori Aoi', wage: 150_000, grade: 190_000, worksite: '京都府' })
		],
		expected: {
			kyoto: {
				gross: 200_600,
				'HEALTH.employee': 9_395,
				'HEALTH.employer': 9_396,
				'CHILD_SUPPORT.employee': 218,
				'CHILD_SUPPORT.employer': 219,
				'PENSION.employee': 17_385,
				'PENSION.employer': 17_385,
				'CHILD_CONTRIBUTION.employer': 684,
				'EMPLOYMENT_INSURANCE.employee': 1_003,
				'EMPLOYMENT_INSURANCE.employer': 1_705,
				'WORKERS_COMP.employer': 601,
				'INCOME_TAX.employee': 11_500
			}
		}
	}),
	jp({
		id: 'JP-RF29-R8-1',
		description:
			'A 奈良県 establishment and worksite in November 2026: 150,000 a month on 2,040 annual hours is below the 令和8年度 奈良県 floor of 1,107 from 4 October 2026, so the wage is 1,107 × 170 = 188,190.',
		citation: [
			SRC.minimumWage,
			'Nara Labour Bureau (https://jsite.mhlw.go.jp/nara-roudoukyoku/newpage_01186.html) and MHLW quick table (https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php, read 2026-09-30): 奈良県 1,107円 from 令和8.10.04, in force for all of November 2026. 最低賃金法 §4(2): 150,000 ÷ 170 = 882.35 < 1,107; 1,107 × 170 = 188,190.',
			...SI,
			'協会けんぽ 令和8年度都道府県単位保険料率 (https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/, read 2026-09-30): 奈良県 9.91%; born 1990, no 介護.',
			'November pay collects October on the recorded 180,000 grade: health 180,000 × 9.91% = 17,838 ÷ 2 = 8,919 each; 支援金 414 ÷ 2 = 207 each; 厚生年金 180,000 × 9.15% = 16,470 each; 拠出金 180,000 × 0.36% = 648.',
			'188,190: 雇用保険 令和8年度 × 5/1,000 = 940.95 → 941 (over 50 sen up), employer × 8.5/1,000 = 1,599.615 → 1,599; 労災 × 3/1,000 = 564.57 → 564.',
			SRC.tax,
			'源泉所得税 乙欄: 188,190 − (8,919 + 207 + 16,470 + 941) = 161,653 → 月額表 令和8年分 乙欄 161,000–163,000 → 10,100.'
		],
		company: { region: '奈良県' },
		period: '2026-11',
		people: [
			sato({ ref: 'nara', name: 'Ishii Kanon', wage: 150_000, grade: 180_000, worksite: '奈良県' })
		],
		expected: {
			nara: {
				gross: 188_190,
				'HEALTH.employee': 8_919,
				'HEALTH.employer': 8_919,
				'CHILD_SUPPORT.employee': 207,
				'CHILD_SUPPORT.employer': 207,
				'PENSION.employee': 16_470,
				'PENSION.employer': 16_470,
				'CHILD_CONTRIBUTION.employer': 648,
				'EMPLOYMENT_INSURANCE.employee': 941,
				'EMPLOYMENT_INSURANCE.employer': 1_599,
				'WORKERS_COMP.employer': 564,
				'INCOME_TAX.employee': 10_100
			}
		}
	})
);

/** A 300,000 wage and grade in May or June 2026, born 1990: the previous month's premium and the month's 労働保険. */
const MONTH_300 = {
	'HEALTH.employee': 14_775,
	'HEALTH.employer': 14_775,
	'CHILD_SUPPORT.employee': 345,
	'CHILD_SUPPORT.employer': 345,
	'PENSION.employee': 27_450,
	'PENSION.employer': 27_450,
	'CHILD_CONTRIBUTION.employer': 1_080,
	'EMPLOYMENT_INSURANCE.employee': 1_500,
	'EMPLOYMENT_INSURANCE.employer': 2_550,
	'WORKERS_COMP.employer': 900
} as const;
const MONTH_300_CITE =
	'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 東京都 300,000 × 9.85% ÷ 2 = 14,775; 支援金 300,000 × 0.23% ÷ 2 = 345; 厚生年金 300,000 × 9.15% = 27,450; 拠出金 300,000 × 0.36% = 1,080; 雇用保険 令和8年度 300,000 × 5/1,000 = 1,500, employer × 8.5/1,000 = 2,550; 労災 × 3/1,000 = 900.';

/** An ad hoc line of the month by catalogue code. */
const adhoc = (job: string, code: string, amount: number, date: string): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: job,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		reason: code
	}
});

register(
	jp({
		id: 'JP-TAX-08-1',
		description:
			'May 2026 meals in kind worth 13,000: a worker paying 6,000 (under half) is taxed on the 7,000 difference; one paying 7,000 (half or more, 6,000 ≤ 7,500 left) is not.',
		citation: [
			...SI,
			MONTH_300_CITE,
			'NTA No.2594 (https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2594.htm, read 2026-09-30) and 令和8年度改正 (https://www.nta.go.jp/users/gensen/2026shokuji/index.htm): meals are untaxed where the worker bears half their value or more and the value less the charge (sub-JPY10 dropped) is JPY7,500 a month or less; its own example: 13,000 with 6,000 borne → 7,000 is 給与.',
			'Neither meal is 賃金 for 労働保険 or 報酬 on this payslip: the worker pays over a third of the cost (Kanagawa Labour Bureau 賃金早見表, https://jsite.mhlw.go.jp/kanagawa-roudoukyoku/hourei_seido_tetsuzuki/roudou_hoken/hourei_seido/rouho_hayami.html), and the collected premium is the recorded grade.',
			SRC.tax,
			'源泉所得税 乙欄: Kondo 300,000 + 7,000 − (14,775 + 345 + 27,450 + 1,500) = 262,930 → 月額表 令和8年分 乙欄 260,000–263,000 → 39,600; Sakai 300,000 − 44,070 = 255,930 → 254,000–257,000 → 37,600.'
		],
		period: '2026-05',
		people: [
			sato({ ref: 'kondo', name: 'Kondo Yuna', wage: 300_000, grade: 300_000 }),
			sato({ ref: 'sakai', name: 'Sakai Taichi', wage: 300_000, grade: 300_000 })
		],
		extra: (job) => [
			adhoc(job('kondo'), 'MEAL_IN_KIND', 13_000, '2026-05-29'),
			adhoc(job('kondo'), 'MEAL_CHARGE', 6_000, '2026-05-29'),
			adhoc(job('sakai'), 'MEAL_IN_KIND', 13_000, '2026-05-29'),
			adhoc(job('sakai'), 'MEAL_CHARGE', 7_000, '2026-05-29')
		],
		expected: {
			kondo: { ...MONTH_300, 'INCOME_TAX.employee': 39_600 },
			sakai: { ...MONTH_300, 'INCOME_TAX.employee': 37_600 }
		}
	}),
	jp({
		id: 'JP-TAX-13-1',
		description:
			'A company flat (building 固定資産税課税標準額 5,000,000, 66 m², land 3,000,000) has a 賃貸料相当額 of 16,840 a month: rent of 5,000 (under half) is taxed on 11,840; rent of 9,000 (half or more) is not.',
		citation: [
			...SI,
			MONTH_300_CITE,
			'NTA No.2597 (https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2597.htm, read 2026-09-30): 賃貸料相当額 = building × 0.2% + 12円 × floor area ÷ 3.3 m² + land × 0.22% = 10,000 + 240 + 6,600 = 16,840; rent of 50% (8,420) or more is untaxed, otherwise the difference is 給与: 16,840 − 5,000 = 11,840.',
			'The flat is not 賃金 for 労働保険 (no 住宅手当 is paid to others in its place; Kanagawa Labour Bureau 賃金早見表, https://jsite.mhlw.go.jp/kanagawa-roudoukyoku/hourei_seido_tetsuzuki/roudou_hoken/hourei_seido/rouho_hayami.html) and the collected premium is the recorded grade.',
			SRC.tax,
			'源泉所得税 乙欄: Nishida 300,000 + 11,840 − 44,070 = 267,770 → 月額表 令和8年分 乙欄 266,000–269,000 → 41,700; Okada 255,930 → 254,000–257,000 → 37,600.'
		],
		period: '2026-05',
		people: (
			[
				['nishida', 'Nishida Kou', 5_000],
				['okada', 'Okada Hana', 9_000]
			] as const
		).map(([ref, name, rent]) =>
			sato({
				ref,
				name,
				wage: 300_000,
				grade: 300_000,
				terms: {
					housing_provided: true,
					housing_building_tax_base: 5_000_000,
					housing_floor_area_m2: 66,
					housing_land_tax_base: 3_000_000,
					housing_employee_rent: rent
				}
			})
		),
		expected: {
			nishida: { ...MONTH_300, 'INCOME_TAX.employee': 41_700 },
			okada: { ...MONTH_300, 'INCOME_TAX.employee': 37_600 }
		}
	}),
	jp({
		id: 'JP-TAX-16-1',
		description:
			'The JP-TAX-15-1 joiner also files a 保険料控除申告書 claiming 150,000 of 生命保険料控除: the claim stops at the 120,000 total, and the December 年末調整 refunds 19,300.',
		citation: [
			SRC.ei,
			SRC.wc,
			'Enrolled 1 December 2026: December carries only 雇用保険 1,500 / 2,550 and 労災 900 (as JP-TAX-15-1).',
			SRC.tax,
			'所得税法 §76 (https://laws.e-gov.go.jp/law/340AC0000000033); NTA No.1140 (https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1140.htm): the 一般・介護医療・個人年金 deductions together are at most 120,000; the 2026 under-23 general-life bands (NTA 令和8年分 年末調整のしかた, https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/102.pdf) raise one part but not that total. 150,000 claimed → 120,000.',
			'As JP-TAX-15-1: 給与所得 2,440,000, 社会保険料控除 481,500, 基礎控除 1,040,000. 課税給与所得金額 2,440,000 − 481,500 − 120,000 − 1,040,000 = 798,500 → 798,000; §89 5% = 39,900; × 102.1% = 40,737.9 → 40,700 (100円未満切捨て); 40,700 − 60,000 withheld = −19,300.'
		],
		period: '2026-12',
		people: [
			sato({
				ref: 'hoken',
				name: 'Hoken Mai',
				hired: '2026-12-01',
				wage: 300_000,
				grade: 300_000,
				terms: { withholding_column: 'KOU', withholding_dependants: 0 },
				incomeTax: {
					elections: { yearend_basic_declaration: true },
					opening: [
						{
							year: '2026',
							base: 3_300_000,
							employee: 60_000,
							employer: 0,
							months: 11,
							reference: '前職 源泉徴収票'
						}
					],
					deduction_claims: [
						{
							period: '2026-11',
							category: 'SOCIAL_INSURANCE',
							amount: 480_000,
							source: 'PRIOR_EMPLOYER',
							reference: '前職 源泉徴収票 社会保険料等の金額'
						},
						{
							period: '2026-12',
							category: 'LIFE_INSURANCE',
							amount: 150_000,
							source: 'EMPLOYEE',
							reference: '令和8年分 保険料控除申告書 生命保険料控除'
						}
					]
				}
			})
		],
		expected: {
			hoken: {
				gross: 300_000,
				'EMPLOYMENT_INSURANCE.employee': 1_500,
				'EMPLOYMENT_INSURANCE.employer': 2_550,
				'WORKERS_COMP.employer': 900,
				'INCOME_TAX.employee': -19_300
			}
		}
	}),
	jp({
		id: 'JP-HR-22-1',
		description:
			'Two unpaid 子の看護等休暇 days (Tuesday 9 and Wednesday 10 June 2026) for a worker with one child born 2020, on 300,000: 2 of June’s 22 scheduled working days are not paid.',
		citation: [
			'育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律 §16-2(1) (https://laws.e-gov.go.jp/law/403AC0000000076): 5 working days a year for one child to the end of grade 3; the Act does not make them paid — docs/inventory/japan.csv JP-HR-22 records the default, unpaid.',
			'Unworked scheduled days are deducted at the JP-PRO-01 rate (owner rule 2026-09-28): 300,000 × 20 ÷ 22 = 272,727.27 → 272,727.',
			...SI,
			'June pay collects May on the 300,000 grade: 14,775 each, 支援金 345 each, 厚生年金 27,450 each, 拠出金 1,080. 272,727: 雇用保険 × 5/1,000 = 1,363.635 → 1,364, employer × 8.5/1,000 = 2,318.18 → 2,318; 労災 × 3/1,000 = 818.18 → 818.',
			SRC.tax,
			'源泉所得税 乙欄: 272,727 − (14,775 + 345 + 27,450 + 1,364) = 228,793 → 月額表 令和8年分 乙欄 227,000–230,000 → 28,500.'
		],
		period: '2026-06',
		people: [
			sato({
				ref: 'kodomo',
				name: 'Kodomo Rika',
				wage: 300_000,
				grade: 300_000,
				gender: 'FEMALE',
				person: { children: [{ child_birthdate: '2020-05-12', relationship: 'CHILD' }] }
			})
		],
		extra: (job) => [leave(job('kodomo'), 'CHILD_NURSING_LEAVE', '2026-06-09', '2026-06-10')],
		expected: {
			kodomo: {
				gross: 272_727,
				'HEALTH.employee': 14_775,
				'HEALTH.employer': 14_775,
				'CHILD_SUPPORT.employee': 345,
				'CHILD_SUPPORT.employer': 345,
				'PENSION.employee': 27_450,
				'PENSION.employer': 27_450,
				'CHILD_CONTRIBUTION.employer': 1_080,
				'EMPLOYMENT_INSURANCE.employee': 1_364,
				'EMPLOYMENT_INSURANCE.employer': 2_318,
				'WORKERS_COMP.employer': 818,
				'INCOME_TAX.employee': 28_500
			}
		}
	})
);

/**
 * 特定最低賃金 (Phase 2, 2026-10-01): every prefectural determination of the MHLW industry table
 * (https://saiteichingin.mhlw.go.jp/table/page_indlist_nationallist.html, read 2026-09-29; docs/inventory/japan.csv JP-SF001–223)
 * against the worksite prefecture's 地域別最低賃金 (REGIONS above). 最低賃金法 §6(1): a worker under both is owed the higher;
 * §4(2): the contract below it is replaced by it. Each worker is a non-resident (20.42% of the whole pay, JP-TAX-11) at a
 * Tokyo establishment's worksite in the determination's prefecture whose recorded industry is that determination, on
 * 150,000 a month over 2,040 annual hours (170 a month), the 300,000 grade, born 1990 (covered: 18 to under 65).
 * Per row: [determination, prefecture, specific JPY an hour, regional JPY an hour, gross, SPECIFIC_MINIMUM_WAGE line,
 * 雇用保険 employee, employer, 労災, 源泉所得税]. Gross is the higher floor × 170: BASIC is the regional floor × 170 (the
 * contract raised to it), and where the specific floor is higher the SPECIFIC_MINIMUM_WAGE line adds (specific −
 * regional) × 170. 雇用保険 令和8年度 5/1,000 (50 sen and under dropped, over rounded up) and 8.5/1,000 (sub-yen dropped),
 * 労災 3/1,000 (sub-yen dropped), tax gross × 20.42% (sub-yen dropped).
 */
type SpecificRow = readonly [string, string, number, number, number, number, number, number, number, number];
const SPECIFIC_SEPTEMBER: readonly (readonly SpecificRow[])[] = [
	[
		['SF001', '北海道', 1113, 1075, 189210, 6460, 946, 1608, 567, 38636],
		['SF002', '北海道', 1165, 1075, 198050, 15300, 990, 1683, 594, 40441],
		['SF003', '北海道', 1116, 1075, 189720, 6970, 949, 1612, 569, 38740],
		['SF004', '北海道', 1105, 1075, 187850, 5100, 939, 1596, 563, 38358],
		['SF005', '青森県', 1109, 1029, 188530, 13600, 943, 1602, 565, 38497],
		['SF006', '青森県', 1045, 1029, 177650, 2720, 888, 1510, 532, 36276],
		['SF007', '青森県', 956, 1029, 174930, 0, 875, 1486, 524, 35720],
		['SF008', '青森県', 963, 1029, 174930, 0, 875, 1486, 524, 35720],
		['SF009', '岩手県', 1072, 1031, 182240, 6970, 911, 1549, 546, 37213],
		['SF010', '岩手県', 1039, 1031, 176630, 1360, 883, 1501, 529, 36067],
	],
	[
		['SF011', '岩手県', 1052, 1031, 178840, 3570, 894, 1520, 536, 36519],
		['SF012', '岩手県', 767, 1031, 175270, 0, 876, 1489, 525, 35790],
		['SF013', '岩手県', 1068, 1031, 181560, 6290, 908, 1543, 544, 37074],
		['SF014', '岩手県', 800, 1031, 175270, 0, 876, 1489, 525, 35790],
		['SF015', '宮城県', 1125, 1038, 191250, 14790, 956, 1625, 573, 39053],
		['SF016', '宮城県', 1077, 1038, 183090, 6630, 915, 1556, 549, 37386],
		['SF017', '宮城県', 1101, 1038, 187170, 10710, 936, 1590, 561, 38220],
		['SF018', '秋田県', 1091, 1031, 185470, 10200, 927, 1576, 556, 37872],
		['SF019', '秋田県', 1032, 1031, 175440, 170, 877, 1491, 526, 35824],
		['SF020', '秋田県', 1060, 1031, 180200, 4930, 901, 1531, 540, 36796],
	],
	[
		['SF021', '秋田県', 1032, 1031, 175440, 170, 877, 1491, 526, 35824],
		['SF022', '山形県', 1070, 1032, 181900, 6460, 909, 1546, 545, 37143],
		['SF023', '山形県', 1055, 1032, 179350, 3910, 897, 1524, 538, 36623],
		['SF024', '山形県', 1070, 1032, 181900, 6460, 909, 1546, 545, 37143],
		['SF025', '山形県', 1017, 1032, 175440, 0, 877, 1491, 526, 35824],
		['SF026', '福島県', 996, 1033, 175610, 0, 878, 1492, 526, 35859],
		['SF027', '福島県', 880, 1033, 175610, 0, 878, 1492, 526, 35859],
		['SF028', '福島県', 1005, 1033, 175610, 0, 878, 1492, 526, 35859],
		['SF029', '福島県', 928, 1033, 175610, 0, 878, 1492, 526, 35859],
		['SF030', '福島県', 1098, 1033, 186660, 11050, 933, 1586, 559, 38115],
	],
	[
		['SF031', '東京都', 871, 1226, 208420, 0, 1042, 1771, 625, 42559],
		['SF032', '東京都', 832, 1226, 208420, 0, 1042, 1771, 625, 42559],
		['SF033', '東京都', 829, 1226, 208420, 0, 1042, 1771, 625, 42559],
		['SF034', '東京都', 838, 1226, 208420, 0, 1042, 1771, 625, 42559],
		['SF035', '茨城県', 1166, 1074, 198220, 15640, 991, 1684, 594, 40476],
		['SF036', '茨城県', 1105, 1074, 187850, 5270, 939, 1596, 563, 38358],
		['SF037', '茨城県', 1115, 1074, 189550, 6970, 948, 1611, 568, 38706],
		['SF038', '茨城県', 881, 1074, 182580, 0, 913, 1551, 547, 37282],
		['SF039', '栃木県', 1159, 1068, 197030, 15470, 985, 1674, 591, 40233],
		['SF040', '栃木県', 1070, 1068, 181900, 340, 909, 1546, 545, 37143],
	],
	[
		['SF041', '栃木県', 1105, 1068, 187850, 6290, 939, 1596, 563, 38358],
		['SF042', '栃木県', 1114, 1068, 189380, 7820, 947, 1609, 568, 38671],
		['SF043', '栃木県', 1104, 1068, 187680, 6120, 938, 1595, 563, 38324],
		['SF044', '栃木県', 874, 1068, 181560, 0, 908, 1543, 544, 37074],
		['SF045', '群馬県', 1131, 1063, 192270, 11560, 961, 1634, 576, 39261],
		['SF046', '群馬県', 1120, 1063, 190400, 9690, 952, 1618, 571, 38879],
		['SF047', '群馬県', 1120, 1063, 190400, 9690, 952, 1618, 571, 38879],
		['SF048', '群馬県', 1120, 1063, 190400, 9690, 952, 1618, 571, 38879],
		['SF049', '埼玉県', 1161, 1141, 197370, 3400, 987, 1677, 592, 40302],
		['SF050', '埼玉県', 1168, 1141, 198560, 4590, 993, 1687, 595, 40545],
	],
	[
		['SF051', '埼玉県', 1165, 1141, 198050, 4080, 990, 1683, 594, 40441],
		['SF052', '埼玉県', 1177, 1141, 200090, 6120, 1000, 1700, 600, 40858],
		['SF053', '埼玉県', 849, 1141, 193970, 0, 970, 1648, 581, 39608],
		['SF054', '埼玉県', 1152, 1141, 195840, 1870, 979, 1664, 587, 39990],
		['SF055', '千葉県', 889, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF056', '千葉県', 1210, 1140, 205700, 11900, 1028, 1748, 617, 42003],
		['SF057', '千葉県', 922, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF058', '千葉県', 1169, 1140, 198730, 4930, 994, 1689, 596, 40580],
		['SF059', '千葉県', 887, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF060', '千葉県', 848, 1140, 193800, 0, 969, 1647, 581, 39573],
	],
	[
		['SF061', '千葉県', 922, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF062', '神奈川県', 894, 1225, 208250, 0, 1041, 1770, 624, 42524],
		['SF063', '神奈川県', 874, 1225, 208250, 0, 1041, 1770, 624, 42524],
		['SF064', '神奈川県', 821, 1225, 208250, 0, 1041, 1770, 624, 42524],
		['SF065', '神奈川県', 857, 1225, 208250, 0, 1041, 1770, 624, 42524],
		['SF066', '神奈川県', 890, 1225, 208250, 0, 1041, 1770, 624, 42524],
		['SF067', '神奈川県', 855, 1225, 208250, 0, 1041, 1770, 624, 42524],
		['SF068', '神奈川県', 842, 1225, 208250, 0, 1041, 1770, 624, 42524],
		['SF069', '新潟県', 1005, 1050, 178500, 0, 892, 1517, 535, 36449],
		['SF070', '新潟県', 932, 1050, 178500, 0, 892, 1517, 535, 36449],
	],
	[
		['SF071', '新潟県', 1053, 1050, 179010, 510, 895, 1521, 537, 36553],
		['SF072', '富山県', 781, 1062, 180540, 0, 903, 1534, 541, 36866],
		['SF073', '富山県', 1035, 1062, 180540, 0, 903, 1534, 541, 36866],
		['SF074', '富山県', 1002, 1062, 180540, 0, 903, 1534, 541, 36866],
		['SF075', '富山県', 1003, 1062, 180540, 0, 903, 1534, 541, 36866],
		['SF076', '富山県', 769, 1062, 180540, 0, 903, 1534, 541, 36866],
		['SF077', '石川県', 782, 1054, 179180, 0, 896, 1523, 537, 36588],
		['SF078', '石川県', 763, 1054, 179180, 0, 896, 1523, 537, 36588],
		['SF079', '石川県', 1090, 1054, 185300, 6120, 926, 1575, 555, 37838],
		['SF080', '石川県', 1064, 1054, 180880, 1700, 904, 1537, 542, 36935],
	],
	[
		['SF081', '石川県', 1090, 1054, 185300, 6120, 926, 1575, 555, 37838],
		['SF082', '石川県', 1060, 1054, 180200, 1020, 901, 1531, 540, 36796],
		['SF083', '福井県', 830, 1053, 179010, 0, 895, 1521, 537, 36553],
		['SF084', '福井県', 933, 1053, 179010, 0, 895, 1521, 537, 36553],
		['SF085', '福井県', 857, 1053, 179010, 0, 895, 1521, 537, 36553],
		['SF086', '福井県', 840, 1053, 179010, 0, 895, 1521, 537, 36553],
		['SF087', '山梨県', 1100, 1052, 187000, 8160, 935, 1589, 561, 38185],
		['SF088', '山梨県', 1089, 1052, 185130, 6290, 926, 1573, 555, 37803],
		['SF089', '長野県', 850, 1061, 180370, 0, 902, 1533, 541, 36831],
		['SF090', '長野県', 1105, 1061, 187850, 7480, 939, 1596, 563, 38358],
	],
	[
		['SF091', '長野県', 1095, 1061, 186150, 5780, 931, 1582, 558, 38011],
		['SF092', '長野県', 950, 1061, 180370, 0, 902, 1533, 541, 36831],
		['SF093', '岐阜県', 965, 1065, 181050, 0, 905, 1538, 543, 36970],
		['SF094', '岐阜県', 1117, 1065, 189890, 8840, 949, 1614, 569, 38775],
		['SF095', '岐阜県', 1049, 1065, 181050, 0, 905, 1538, 543, 36970],
		['SF096', '静岡県', 786, 1097, 186490, 0, 932, 1585, 559, 38081],
		['SF097', '静岡県', 915, 1097, 186490, 0, 932, 1585, 559, 38081],
		['SF098', '静岡県', 1117, 1097, 189890, 3400, 949, 1614, 569, 38775],
		['SF099', '静岡県', 1133, 1097, 192610, 6120, 963, 1637, 577, 39330],
		['SF100', '静岡県', 1042, 1097, 186490, 0, 932, 1585, 559, 38081],
	],
	[
		['SF101', '静岡県', 886, 1097, 186490, 0, 932, 1585, 559, 38081],
		['SF102', '愛知県', 732, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF103', '愛知県', 1175, 1140, 199750, 5950, 999, 1697, 599, 40788],
		['SF104', '愛知県', 968, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF105', '愛知県', 901, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF106', '愛知県', 1146, 1140, 194820, 1020, 974, 1655, 584, 39782],
		['SF107', '愛知県', 875, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF108', '愛知県', 847, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF109', '愛知県', 800, 1140, 193800, 0, 969, 1647, 581, 39573],
		['SF110', '愛知県', 943, 1140, 193800, 0, 969, 1647, 581, 39573],
	],
	[
		['SF111', '京都府', 933, 1122, 190740, 0, 954, 1621, 572, 38949],
		['SF112', '京都府', 822, 1122, 190740, 0, 954, 1621, 572, 38949],
		['SF113', '京都府', 1136, 1122, 193120, 2380, 966, 1641, 579, 39435],
		['SF114', '京都府', 1076, 1122, 190740, 0, 954, 1621, 572, 38949],
		['SF115', '京都府', 938, 1122, 190740, 0, 954, 1621, 572, 38949],
		['SF116', '京都府', 939, 1122, 190740, 0, 954, 1621, 572, 38949],
		['SF117', '大阪府', 1191, 1177, 202470, 2380, 1012, 1720, 607, 41344],
		['SF118', '大阪府', 1185, 1177, 201450, 1360, 1007, 1712, 604, 41136],
		['SF119', '大阪府', 1180, 1177, 200600, 510, 1003, 1705, 601, 40962],
		['SF120', '大阪府', 1197, 1177, 203490, 3400, 1017, 1729, 610, 41552],
	],
	[
		['SF121', '大阪府', 1197, 1177, 203490, 3400, 1017, 1729, 610, 41552],
		['SF122', '大阪府', 1194, 1177, 202980, 2890, 1015, 1725, 608, 41448],
		['SF123', '大阪府', 993, 1177, 200090, 0, 1000, 1700, 600, 40858],
		['SF124', '三重県', 923, 1087, 184790, 0, 924, 1570, 554, 37734],
		['SF125', '三重県', 739, 1087, 184790, 0, 924, 1570, 554, 37734],
		['SF126', '三重県', 1097, 1087, 186490, 1700, 932, 1585, 559, 38081],
		['SF127', '三重県', 843, 1087, 184790, 0, 924, 1570, 554, 37734],
		['SF128', '三重県', 762, 1087, 184790, 0, 924, 1570, 554, 37734],
		['SF129', '三重県', 1031, 1087, 184790, 0, 924, 1570, 554, 37734],
		['SF130', '三重県', 1111, 1087, 188870, 4080, 944, 1605, 566, 38567],
	],
	[
		['SF131', '滋賀県', 789, 1080, 183600, 0, 918, 1560, 550, 37491],
		['SF132', '滋賀県', 1099, 1080, 186830, 3230, 934, 1588, 560, 38150],
		['SF133', '滋賀県', 1114, 1080, 189380, 5780, 947, 1609, 568, 38671],
		['SF134', '滋賀県', 1105, 1080, 187850, 4250, 939, 1596, 563, 38358],
		['SF135', '滋賀県', 1115, 1080, 189550, 5950, 948, 1611, 568, 38706],
		['SF136', '滋賀県', 840, 1080, 183600, 0, 918, 1560, 550, 37491],
		['SF137', '兵庫県', 800, 1116, 189720, 0, 949, 1612, 569, 38740],
		['SF138', '兵庫県', 1158, 1116, 196860, 7140, 984, 1673, 590, 40198],
		['SF139', '兵庫県', 1180, 1116, 200600, 10880, 1003, 1705, 601, 40962],
		['SF140', '兵庫県', 1150, 1116, 195500, 5780, 977, 1661, 586, 39921],
	],
	[
		['SF141', '兵庫県', 1117, 1116, 189890, 170, 949, 1614, 569, 38775],
		['SF142', '兵庫県', 1188, 1116, 201960, 12240, 1010, 1716, 605, 41240],
		['SF143', '兵庫県', 1117, 1116, 189890, 170, 949, 1614, 569, 38775],
		['SF144', '兵庫県', 797, 1116, 189720, 0, 949, 1612, 569, 38740],
		['SF145', '兵庫県', 963, 1116, 189720, 0, 949, 1612, 569, 38740],
		['SF146', '奈良県', 905, 1051, 178670, 0, 893, 1518, 536, 36484],
		['SF147', '奈良県', 891, 1051, 178670, 0, 893, 1518, 536, 36484],
		['SF148', '奈良県', 892, 1051, 178670, 0, 893, 1518, 536, 36484],
		['SF150', '和歌山県', 1170, 1045, 198900, 21250, 994, 1690, 596, 40615],
		['SF151', '和歌山県', 869, 1045, 177650, 0, 888, 1510, 532, 36276],
	],
	[
		['SF152', '鳥取県', 963, 1030, 175100, 0, 875, 1488, 525, 35755],
		['SF153', '鳥取県', 902, 1030, 175100, 0, 875, 1488, 525, 35755],
		['SF154', '島根県', 1163, 1033, 197710, 22100, 989, 1680, 593, 40372],
		['SF155', '島根県', 1134, 1033, 192780, 17170, 964, 1638, 578, 39365],
		['SF156', '島根県', 1058, 1033, 179860, 4250, 899, 1528, 539, 36727],
		['SF157', '島根県', 1094, 1033, 185980, 10370, 930, 1580, 557, 37977],
		['SF158', '島根県', 905, 1033, 175610, 0, 878, 1492, 526, 35859],
		['SF159', '島根県', 1069, 1033, 181730, 6120, 909, 1544, 545, 37109],
		['SF160', '岡山県', 1074, 1047, 182580, 4590, 913, 1551, 547, 37282],
		['SF161', '岡山県', 1166, 1047, 198220, 20230, 991, 1684, 594, 40476],
	],
	[
		['SF162', '岡山県', 1103, 1047, 187510, 9520, 938, 1593, 562, 38289],
		['SF163', '岡山県', 1090, 1047, 185300, 7310, 926, 1575, 555, 37838],
		['SF164', '岡山県', 1083, 1047, 184110, 6120, 921, 1564, 552, 37595],
		['SF165', '岡山県', 1159, 1047, 197030, 19040, 985, 1674, 591, 40233],
		['SF166', '岡山県', 933, 1047, 177990, 0, 890, 1512, 533, 36345],
		['SF167', '広島県', 1179, 1085, 200430, 15980, 1002, 1703, 601, 40927],
		['SF168', '広島県', 1052, 1085, 184450, 0, 922, 1567, 553, 37664],
		['SF169', '広島県', 1070, 1085, 184450, 0, 922, 1567, 553, 37664],
		['SF170', '広島県', 1110, 1085, 188700, 4250, 943, 1603, 566, 38532],
		['SF171', '広島県', 1105, 1085, 187850, 3400, 939, 1596, 563, 38358],
	],
	[
		['SF172', '広島県', 1080, 1085, 184450, 0, 922, 1567, 553, 37664],
		['SF173', '広島県', 903, 1085, 184450, 0, 922, 1567, 553, 37664],
		['SF174', '広島県', 1038, 1085, 184450, 0, 922, 1567, 553, 37664],
		['SF175', '山口県', 1180, 1043, 200600, 23290, 1003, 1705, 601, 40962],
		['SF176', '山口県', 1032, 1043, 177310, 0, 887, 1507, 531, 36206],
		['SF177', '山口県', 1141, 1043, 193970, 16660, 970, 1648, 581, 39608],
		['SF178', '山口県', 1000, 1043, 177310, 0, 887, 1507, 531, 36206],
		['SF179', '徳島県', 876, 1046, 177820, 0, 889, 1511, 533, 36310],
		['SF180', '徳島県', 1134, 1046, 192780, 14960, 964, 1638, 578, 39365],
		['SF181', '徳島県', 1105, 1046, 187850, 10030, 939, 1596, 563, 38358],
	],
	[
		['SF182', '香川県', 849, 1036, 176120, 0, 881, 1497, 528, 35963],
		['SF183', '香川県', 1158, 1036, 196860, 20740, 984, 1673, 590, 40198],
		['SF184', '香川県', 1090, 1036, 185300, 9180, 926, 1575, 555, 37838],
		['SF185', '香川県', 1159, 1036, 197030, 20910, 985, 1674, 591, 40233],
		['SF186', '愛媛県', 1113, 1033, 189210, 13600, 946, 1608, 567, 38636],
		['SF187', '愛媛県', 1114, 1033, 189380, 13770, 947, 1609, 568, 38671],
		['SF188', '愛媛県', 1107, 1033, 188190, 12580, 941, 1599, 564, 38428],
		['SF189', '愛媛県', 1136, 1033, 193120, 17510, 966, 1641, 579, 39435],
		['SF190', '愛媛県', 854, 1033, 175610, 0, 878, 1492, 526, 35859],
		['SF191', '高知県', 793, 1023, 173910, 0, 870, 1478, 521, 35512],
	],
	[
		['SF192', '高知県', 910, 1023, 173910, 0, 870, 1478, 521, 35512],
		['SF193', '福岡県', 1176, 1057, 199920, 20230, 1000, 1699, 599, 40823],
		['SF194', '福岡県', 1137, 1057, 193290, 13600, 966, 1642, 579, 39469],
		['SF195', '福岡県', 1147, 1057, 194990, 15300, 975, 1657, 584, 39816],
		['SF196', '福岡県', 1065, 1057, 181050, 1360, 905, 1538, 543, 36970],
		['SF197', '福岡県', 1131, 1057, 192270, 12580, 961, 1634, 576, 39261],
		['SF198', '佐賀県', 957, 1030, 175100, 0, 875, 1488, 525, 35755],
		['SF199', '佐賀県', 1010, 1030, 175100, 0, 875, 1488, 525, 35755],
		['SF200', '佐賀県', 996, 1030, 175100, 0, 875, 1488, 525, 35755],
		['SF201', '長崎県', 875, 1031, 175270, 0, 876, 1489, 525, 35790],
	],
	[
		['SF202', '長崎県', 864, 1031, 175270, 0, 876, 1489, 525, 35790],
		['SF203', '長崎県', 875, 1031, 175270, 0, 876, 1489, 525, 35790],
		['SF204', '大分県', 1176, 1035, 199920, 23970, 1000, 1699, 599, 40823],
		['SF205', '大分県', 1116, 1035, 189720, 13770, 949, 1612, 569, 38740],
		['SF206', '大分県', 1066, 1035, 181220, 5270, 906, 1540, 543, 37005],
		['SF207', '大分県', 1055, 1035, 179350, 3400, 897, 1524, 538, 36623],
		['SF208', '大分県', 716, 1035, 175950, 0, 880, 1495, 527, 35928],
		['SF209', '大分県', 1061, 1035, 180370, 4420, 902, 1533, 541, 36831],
		['SF210', '熊本県', 1063, 1034, 180710, 4930, 904, 1536, 542, 36900],
		['SF211', '熊本県', 1074, 1034, 182580, 6800, 913, 1551, 547, 37282],
	],
	[
		['SF212', '熊本県', 855, 1034, 175780, 0, 879, 1494, 527, 35894],
		['SF213', '宮崎県', 678, 1023, 173910, 0, 870, 1478, 521, 35512],
		['SF214', '宮崎県', 831, 1023, 173910, 0, 870, 1478, 521, 35512],
		['SF215', '宮崎県', 705, 1023, 173910, 0, 870, 1478, 521, 35512],
		['SF216', '宮崎県', 927, 1023, 173910, 0, 870, 1478, 521, 35512],
		['SF217', '鹿児島県', 842, 1026, 174420, 0, 872, 1482, 523, 35616],
		['SF218', '鹿児島県', 693, 1026, 174420, 0, 872, 1482, 523, 35616],
		['SF219', '鹿児島県', 1048, 1026, 178160, 3740, 891, 1514, 534, 36380],
		['SF220', '沖縄県', 769, 1023, 173910, 0, 870, 1478, 521, 35512],
		['SF221', '沖縄県', 879, 1023, 173910, 0, 870, 1478, 521, 35512],
	],
	[
		['SF222', '沖縄県', 770, 1023, 173910, 0, 870, 1478, 521, 35512],
		['SF223', '沖縄県', 770, 1023, 173910, 0, 870, 1478, 521, 35512],
	],
];

const SPECIFIC_SRC = [
	SRC.minimumWage,
	'最低賃金法 §6(1), §15–§19 (https://laws.e-gov.go.jp/law/334AC0000000137): 地域別最低賃金 and 特定最低賃金 both applying, the higher binds; MHLW industry table (https://saiteichingin.mhlw.go.jp/table/page_indlist_nationallist.html, read 2026-09-29).',
	SRC.ei,
	SRC.wc,
	'所得税法 §161(1)(xii)イ, §212(1), §213(1)(i); 復興財源確保法 §28: a non-resident is withheld 20.42% of the whole pay, sub-yen dropped (NTA https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2884.htm).'
] as const;

/** 150,000 a month on 2,040 hours at a worksite recorded under determination `code` in `region`. */
const specificWorker = (code: string, region: string, rest: Partial<Person> = {}): Person =>
	sato({
		ref: `w_${code.toLowerCase()}`,
		name: `Worker ${code}`,
		wage: 150_000,
		grade: 300_000,
		worksite: region,
		worksiteRef: `ws_${code.toLowerCase()}`,
		taxResidency: 'NON_RESIDENT',
		...rest
	});
const specificSite = (code: string, region: string, ref = `ws_${code.toLowerCase()}`): ProbeInput => ({
	collection: 'worksites',
	ref,
	values: {
		company_id: '@company',
		code: ref.toUpperCase(),
		name: `${region} ${code} establishment`,
		region,
		facts: { specific_mw_industry: code },
		effective_range: { from: '2024-04-01', to: null }
	}
});
/** The month's lines of one SpecificRow worker, given the premium the payslip collects on the 300,000 grade. */
const specificLines = (
	[, , , regional, gross, top, ee, er, wc, tax]: SpecificRow,
	collected: Readonly<Record<string, number>>
) => ({
	gross,
	BASIC: regional * 170,
	...(top > 0 ? { SPECIFIC_MINIMUM_WAGE: top } : {}),
	...collected,
	'EMPLOYMENT_INSURANCE.employee': ee,
	'EMPLOYMENT_INSURANCE.employer': er,
	'WORKERS_COMP.employer': wc,
	'INCOME_TAX.employee': tax
});
/** March 2026 pay collects February at the 令和7年度 東京都 9.91%, before the 支援金. */
const COLLECTED_MARCH = {
	'HEALTH.employee': 14_865,
	'HEALTH.employer': 14_865,
	'PENSION.employee': 27_450,
	'PENSION.employer': 27_450,
	'CHILD_CONTRIBUTION.employer': 1_080
} as const;
/** September 2026 pay collects August on the 300,000 grade at 東京都 9.85% (MONTH_300_CITE). */
const COLLECTED_300 = {
	'HEALTH.employee': 14_775,
	'HEALTH.employer': 14_775,
	'CHILD_SUPPORT.employee': 345,
	'CHILD_SUPPORT.employer': 345,
	'PENSION.employee': 27_450,
	'PENSION.employer': 27_450,
	'CHILD_CONTRIBUTION.employer': 1_080
} as const;
const specificCite = ([code, region, spec, regional, gross, top, ee, er, wc, tax]: SpecificRow) =>
	`${code} ${region}: specific ${yen(spec)} vs regional ${yen(regional)} → ${top > 0 ? `specific binds, BASIC ${yen(regional * 170)} + ${yen(top)} = ${yen(gross)}` : `regional binds, ${yen(regional)} × 170 = ${yen(gross)}`}; 雇用保険 ${ee} / ${yen(er)}, 労災 ${wc}, tax ${yen(tax)}.`;

register(
	...SPECIFIC_SEPTEMBER.map((group, index) =>
		jp({
			id: `JP-SFMW-${String(index + 1).padStart(2, '0')}`,
			description: `September 2026: ${group.length} workers each at a worksite recorded under one 特定最低賃金 (${group[0]![0]}–${group.at(-1)![0]}), paid the higher of it and the prefecture's 地域別最低賃金.`,
			citation: [
				...SPECIFIC_SRC,
				...SI,
				MONTH_300_CITE.replace('May 2026 pay collects April 2026', 'September 2026 pay collects August 2026').replace(/ 雇用保険.*$/, ''),
				...group.map(specificCite)
			],
			period: '2026-09',
			before: group.map(([code, region]) => specificSite(code, region)),
			people: group.map(([code, region]) => specificWorker(code, region)),
			expected: Object.fromEntries(
				group.map((row) => [`w_${row[0].toLowerCase()}`, specificLines(row, COLLECTED_300)])
			)
		})
	),
	jp({
		id: 'JP-SFMW-SCOPE',
		description:
			'September 2026 at 北海道 鉄鋼業 worksites (JP-SF002, 1,165 against the regional 1,075): a covered 36-year-old is topped up to 1,165; a 66-year-old, a 17-year-old and a worker the order excludes (recorded specific_mw_excluded) get the regional floor only; a 青森県 worksite recorded under the 北海道 determination gets 青森県’s regional floor.',
		citation: [
			...SPECIFIC_SRC,
			...SI,
			'September 2026 pay collects August on the 300,000 grade: 健康保険 東京都 9.85% → 14,775 each; 支援金 345 each; 厚生年金 27,450 each; 拠出金 1,080. Born 1960 (66) and 2009 (17): no 介護 (40–64 only), pension under 70, 雇用保険 at every age.',
			'特定最低賃金 適用除外: the decisions the register quotes exclude workers under 18 and 65 or older, trainees within a stated period of hire and those mainly on listed light tasks (docs/inventory/japan.csv JP-SF-T03, JP-SF-T04); JP-SF002 records that 18-to-under-65 bound as the default and the order’s other exclusions as the recorded terms fact specific_mw_excluded.',
			'最低賃金法 §15–§16: a specific determination binds its own prefecture’s establishments; a 青森県 worksite is under 青森県’s regional 1,029 only.',
			'Covered: BASIC 182,750 + SPECIFIC_MINIMUM_WAGE (1,165 − 1,075) × 170 = 15,300 → 198,050; 雇用保険 990 / 1,683, 労災 594, tax 40,441.',
			'Outside: 182,750; 雇用保険 914 / 1,553, 労災 548, tax 37,317. 青森県: 1,029 × 170 = 174,930; 雇用保険 875 / 1,486, 労災 524, tax 35,720.'
		],
		period: '2026-09',
		before: [
			specificSite('SF002', '北海道'),
			specificSite('SF002', '北海道', 'ws_senior'),
			specificSite('SF002', '北海道', 'ws_minor'),
			specificSite('SF002', '北海道', 'ws_trainee'),
			specificSite('SF002', '青森県', 'ws_aomori')
		],
		people: [
			specificWorker('SF002', '北海道'),
			specificWorker('SF002', '北海道', { ref: 'senior', name: 'Senior Worker', born: '1960-03-01', worksiteRef: 'ws_senior' }),
			specificWorker('SF002', '北海道', { ref: 'minor', name: 'Minor Worker', born: '2009-03-01', worksiteRef: 'ws_minor' }),
			specificWorker('SF002', '北海道', {
				ref: 'trainee',
				name: 'Trainee Worker',
				worksiteRef: 'ws_trainee',
				terms: { specific_mw_excluded: true }
			}),
			specificWorker('SF002', '青森県', { ref: 'aomori', name: 'Aomori Worker', worksiteRef: 'ws_aomori' })
		],
		expected: {
			w_sf002: specificLines(['SF002', '北海道', 1165, 1075, 198050, 15300, 990, 1683, 594, 40441], COLLECTED_300),
			senior: specificLines(['SF002', '北海道', 1165, 1075, 182750, 0, 914, 1553, 548, 37317], COLLECTED_300),
			minor: specificLines(['SF002', '北海道', 1165, 1075, 182750, 0, 914, 1553, 548, 37317], COLLECTED_300),
			trainee: specificLines(['SF002', '北海道', 1165, 1075, 182750, 0, 914, 1553, 548, 37317], COLLECTED_300),
			aomori: specificLines(['SF002', '青森県', 1165, 1029, 174930, 0, 875, 1486, 524, 35720], COLLECTED_300)
		}
	}),
	jp({
		id: 'JP-SFMW-R8',
		description:
			'October 2026, after 北海道’s 令和8年度 regional floor of 1,131 from 1 October: 乳製品 (JP-SF001, 1,113) no longer exceeds it, so the regional floor binds; 鉄鋼業 (JP-SF002, 1,165) still does.',
		citation: [
			...SPECIFIC_SRC,
			...SI,
			'October 2026 pay collects September on the 300,000 grade: 14,775 each, 支援金 345 each, 厚生年金 27,450 each, 拠出金 1,080.',
			'MHLW quick table (https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php, read 2026-09-30): 北海道 1,131円 from 令和8.10.01 (JP-RF01-R8).',
			'SF001: 1,113 < 1,131 → 192,270; 雇用保険 961 / 1,634, 労災 576, tax 39,261. SF002: 192,270 + (1,165 − 1,131) × 170 = 5,780 → 198,050; 雇用保険 990 / 1,683, 労災 594, tax 40,441.'
		],
		period: '2026-10',
		before: [specificSite('SF001', '北海道'), specificSite('SF002', '北海道')],
		people: [specificWorker('SF001', '北海道'), specificWorker('SF002', '北海道')],
		expected: {
			w_sf001: specificLines(['SF001', '北海道', 1113, 1131, 192270, 0, 961, 1634, 576, 39261], COLLECTED_300),
			w_sf002: specificLines(['SF002', '北海道', 1165, 1131, 198050, 5780, 990, 1683, 594, 40441], COLLECTED_300)
		}
	}),
	jp({
		id: 'JP-SFMW-NARA',
		description:
			'March 2026, the last month of 奈良県’s old 木材・木製品・家具 determination: its skilled 816 and ordinary 519 an hour are both below 奈良県’s regional 1,051, so both workers are paid the regional floor.',
		citation: [
			...SPECIFIC_SRC,
			...SI,
			'March 2026 pay collects February 2026 on the 300,000 grade: 健康保険 東京都 9.91% (令和7年度) 300,000 × 9.91% ÷ 2 = 14,865 each; 厚生年金 27,450 each; 拠出金 1,080; no 支援金 before the April 2026 insurance month. 雇用保険 令和7年度 5.5/1,000 and 9/1,000.',
			'JP-SF-T03 (Nara council recommendation https://jsite.mhlw.go.jp/nara-roudoukyoku/content/contents/002629442.pdf): ordinary covered workers 519円/hour, skilled workers 816円/hour, abolished by 1 April 2026; MHLW quick table: 奈良県 1,051円 from 令和7.11.16.',
			'Both: 1,051 × 170 = 178,670; 雇用保険 178,670 × 5.5/1,000 = 983 (over 50 sen up), × 9/1,000 → 1,608; 労災 536; tax 36,484.'
		],
		period: '2026-03',
		before: [specificSite('SF149', '奈良県'), specificSite('SF149_ORDINARY', '奈良県')],
		people: [specificWorker('SF149', '奈良県'), specificWorker('SF149_ORDINARY', '奈良県')],
		expected: {
			w_sf149: specificLines(['SF149', '奈良県', 816, 1051, 178670, 0, 983, 1608, 536, 36484], COLLECTED_MARCH),
			w_sf149_ordinary: specificLines(['SF149_ORDINARY', '奈良県', 519, 1051, 178670, 0, 983, 1608, 536, 36484], COLLECTED_MARCH)
		}
	})
);
