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
				gender: 'MALE',
				nationality: 'Japanese'
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
				...(p.left === undefined ? {} : { exit_reason: p.exitReason ?? 'RESIGNATION' }),
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
const noticePay = (job: string, noticeDays: number, averageWage: number, date: string): ProbeInput => ({
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
		citation: [...SI, 'May 2026 pay collects April 2026 on the 300,000 grade (born 1990, no care): 健康保険 300,000 × 9.85% ÷ 2 = 14,775; 支援金 345; 厚生年金 27,450; 拠出金 1,080.', '労災 300,000 × 2.5/1,000 = 750; 雇用保険 1,500 / 2,550.', SRC.tax, '源泉所得税: no 扶養控除等申告書 recorded, so 乙欄 on the pay after this payslip’s insurance: 300,000 − (14,775 + 345 + 27,450 + 1,500) = 255,930 → 月額表 令和8年分 乙欄 254,000–257,000 → 37,600.'],
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
						{ year: '2026', base: 3_300_000, employee: 60_000, employer: 0, months: 11, reference: '前職 源泉徴収票' }
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
		people: [sato({ ref: 'fujita', name: 'Fujita Sora', wage: 300_000, grade: 300_000, ei: false })],
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
		people: [sato({ ref: 'mori', name: 'Mori Kaito', wage: 300_000, grade: 300_000, terms: NOTICE })],
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
			'Two leavers on 30 September 2026 under the same notice: one requested the lump collection (September plus October–May, 135,000), the other did not (September’s 15,000 only).',
		citation: [
			...SI,
			SRC.tax,
			SRC.residentTax,
			'健康保険法 §36, §156(3), §167(1); 厚生年金保険法 §14, §19(1), §84(1): loss on 1 October, so September pay deducts the August and September insurance months on the 300,000 grade: 2 × 14,775 = 29,550, 2 × 345 = 690, 2 × 27,450 = 54,900, 拠出金 2 × 1,080 = 2,160. 雇用保険 1,500 / 2,550; 労災 900.',
			'源泉所得税: 乙欄 on 300,000 − (29,550 + 690 + 54,900 + 1,500) = 213,360 → 月額表 令和8年分 乙欄 213,000–215,000 → 24,100.',
			'住民税: the event (30 September) falls in June–December. Nakamura requested the lump collection: the October–May installments 8 × 15,000 = 120,000 are less than the 300,000 final pay, so 15,000 + 120,000 = 135,000. Kobayashi made no request: September’s 15,000 only; the rest passes to 普通徴収.'
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
			})
		],
		expected: Object.fromEntries(
			(
				[
					['nakamura', 135_000],
					['kobayashi', 15_000]
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
	['01', '北海道', 1_075, '令和7.10.04', '10.28', 180_000, 9_252, 9_252, 207, 207, 16_470, 648, 914, 1_553, 548, 155_907, 155_000, 9_200],
	['02', '青森県', 1_029, '令和7.11.21', '9.85', 170_000, 8_372, 8_373, 195, 196, 15_555, 612, 875, 1_486, 524, 149_933, 149_000, 8_300],
	['03', '岩手県', 1_031, '令和7.12.01', '9.51', 180_000, 8_559, 8_559, 207, 207, 16_470, 648, 876, 1_489, 525, 149_158, 149_000, 8_300],
	['04', '宮城県', 1_038, '令和7.10.04', '10.10', 180_000, 9_090, 9_090, 207, 207, 16_470, 648, 882, 1_499, 529, 149_811, 149_000, 8_300],
	['05', '秋田県', 1_031, '令和8.03.31', '10.01', 180_000, 9_009, 9_009, 207, 207, 16_470, 648, 876, 1_489, 525, 148_708, 147_000, 8_000],
	['06', '山形県', 1_032, '令和7.12.23', '9.75', 180_000, 8_775, 8_775, 207, 207, 16_470, 648, 877, 1_491, 526, 149_111, 149_000, 8_300],
	['07', '福島県', 1_033, '令和8.01.01', '9.50', 180_000, 8_550, 8_550, 207, 207, 16_470, 648, 878, 1_492, 526, 149_505, 149_000, 8_300],
	['08', '茨城県', 1_074, '令和7.10.12', '9.52', 180_000, 8_568, 8_568, 207, 207, 16_470, 648, 913, 1_551, 547, 156_422, 155_000, 9_200],
	['09', '栃木県', 1_068, '令和7.10.01', '9.82', 180_000, 8_838, 8_838, 207, 207, 16_470, 648, 908, 1_543, 544, 155_137, 155_000, 9_200],
	['10', '群馬県', 1_063, '令和8.03.01', '9.68', 180_000, 8_712, 8_712, 207, 207, 16_470, 648, 904, 1_536, 542, 154_417, 153_000, 8_900],
	['11', '埼玉県', 1_141, '令和7.11.01', '9.67', 190_000, 9_186, 9_187, 218, 219, 17_385, 684, 970, 1_648, 581, 166_211, 165_000, 10_700],
	['12', '千葉県', 1_140, '令和7.10.03', '9.73', 190_000, 9_243, 9_244, 218, 219, 17_385, 684, 969, 1_647, 581, 165_985, 165_000, 10_700],
	['13', '東京都', 1_226, '令和7.10.03', '9.85', 200_000, 9_850, 9_850, 230, 230, 18_300, 720, 1042, 1_771, 625, 178_998, 177_000, 12_500],
	['14', '神奈川県', 1_225, '令和7.10.04', '9.92', 200_000, 9_920, 9_920, 230, 230, 18_300, 720, 1041, 1_770, 624, 178_759, 177_000, 12_500],
	['15', '新潟県', 1_050, '令和7.10.02', '9.21', 180_000, 8_289, 8_289, 207, 207, 16_470, 648, 892, 1_517, 535, 152_642, 151_000, 8_600],
	['16', '富山県', 1_062, '令和7.10.12', '9.59', 180_000, 8_631, 8_631, 207, 207, 16_470, 648, 903, 1_534, 541, 154_329, 153_000, 8_900],
	['17', '石川県', 1_054, '令和7.10.08', '9.70', 180_000, 8_730, 8_730, 207, 207, 16_470, 648, 896, 1_523, 537, 152_877, 151_000, 8_600],
	['18', '福井県', 1_053, '令和7.10.08', '9.71', 180_000, 8_739, 8_739, 207, 207, 16_470, 648, 895, 1_521, 537, 152_699, 151_000, 8_600],
	['19', '山梨県', 1_052, '令和7.12.01', '9.55', 180_000, 8_595, 8_595, 207, 207, 16_470, 648, 894, 1_520, 536, 152_674, 151_000, 8_600],
	['20', '長野県', 1_061, '令和7.10.03', '9.63', 180_000, 8_667, 8_667, 207, 207, 16_470, 648, 902, 1_533, 541, 154_124, 153_000, 8_900],
	['21', '岐阜県', 1_065, '令和7.10.18', '9.80', 180_000, 8_820, 8_820, 207, 207, 16_470, 648, 905, 1_538, 543, 154_648, 153_000, 8_900],
	['22', '静岡県', 1_097, '令和7.11.01', '9.61', 190_000, 9_129, 9_130, 218, 219, 17_385, 684, 932, 1_585, 559, 158_826, 157_000, 9_500],
	['23', '愛知県', 1_140, '令和7.10.18', '9.93', 190_000, 9_433, 9_434, 218, 219, 17_385, 684, 969, 1_647, 581, 165_795, 165_000, 10_700],
	['24', '三重県', 1_087, '令和7.11.21', '9.77', 180_000, 8_793, 8_793, 207, 207, 16_470, 648, 924, 1_570, 554, 158_396, 157_000, 9_500],
	['25', '滋賀県', 1_080, '令和7.10.05', '9.88', 180_000, 8_892, 8_892, 207, 207, 16_470, 648, 918, 1_560, 550, 157_113, 157_000, 9_500],
	['26', '京都府', 1_122, '令和7.11.21', '9.89', 190_000, 9_395, 9_396, 218, 219, 17_385, 684, 954, 1_621, 572, 162_788, 161_000, 10_100],
	['27', '大阪府', 1_177, '令和7.10.16', '10.13', 200_000, 10_130, 10_130, 230, 230, 18_300, 720, 1000, 1_700, 600, 170_430, 169_000, 11_300],
	['28', '兵庫県', 1_116, '令和7.10.04', '10.12', 190_000, 9_614, 9_614, 218, 219, 17_385, 684, 949, 1_612, 569, 161_554, 161_000, 10_100],
	['29', '奈良県', 1_051, '令和7.11.16', '9.91', 180_000, 8_919, 8_919, 207, 207, 16_470, 648, 893, 1_518, 536, 152_181, 151_000, 8_600],
	['30', '和歌山県', 1_045, '令和7.11.01', '10.06', 180_000, 9_054, 9_054, 207, 207, 16_470, 648, 888, 1_510, 532, 151_031, 151_000, 8_600],
	['31', '鳥取県', 1_030, '令和7.10.04', '9.86', 180_000, 8_874, 8_874, 207, 207, 16_470, 648, 875, 1_488, 525, 148_674, 147_000, 8_000],
	['32', '島根県', 1_033, '令和7.11.17', '9.94', 180_000, 8_946, 8_946, 207, 207, 16_470, 648, 878, 1_492, 526, 149_109, 149_000, 8_300],
	['33', '岡山県', 1_047, '令和7.12.01', '10.05', 180_000, 9_045, 9_045, 207, 207, 16_470, 648, 890, 1_512, 533, 151_378, 151_000, 8_600],
	['34', '広島県', 1_085, '令和7.11.01', '9.78', 180_000, 8_802, 8_802, 207, 207, 16_470, 648, 922, 1_567, 553, 158_049, 157_000, 9_500],
	['35', '山口県', 1_043, '令和7.10.16', '10.15', 180_000, 9_135, 9_135, 207, 207, 16_470, 648, 887, 1_507, 531, 150_611, 149_000, 8_300],
	['36', '徳島県', 1_046, '令和8.01.01', '10.24', 180_000, 9_216, 9_216, 207, 207, 16_470, 648, 889, 1_511, 533, 151_038, 151_000, 8_600],
	['37', '香川県', 1_036, '令和7.10.18', '10.02', 180_000, 9_018, 9_018, 207, 207, 16_470, 648, 881, 1_497, 528, 149_544, 149_000, 8_300],
	['38', '愛媛県', 1_033, '令和7.12.01', '9.98', 180_000, 8_982, 8_982, 207, 207, 16_470, 648, 878, 1_492, 526, 149_073, 149_000, 8_300],
	['39', '高知県', 1_023, '令和7.12.01', '10.05', 170_000, 8_542, 8_543, 195, 196, 15_555, 612, 870, 1_478, 521, 148_748, 147_000, 8_000],
	['40', '福岡県', 1_057, '令和7.11.16', '10.11', 180_000, 9_099, 9_099, 207, 207, 16_470, 648, 898, 1_527, 539, 153_016, 153_000, 8_900],
	['41', '佐賀県', 1_030, '令和7.11.21', '10.55', 180_000, 9_495, 9_495, 207, 207, 16_470, 648, 875, 1_488, 525, 148_053, 147_000, 8_000],
	['42', '長崎県', 1_031, '令和7.12.01', '10.06', 180_000, 9_054, 9_054, 207, 207, 16_470, 648, 876, 1_489, 525, 148_663, 147_000, 8_000],
	['43', '熊本県', 1_034, '令和8.01.01', '10.08', 180_000, 9_072, 9_072, 207, 207, 16_470, 648, 879, 1_494, 527, 149_152, 149_000, 8_300],
	['44', '大分県', 1_035, '令和8.01.01', '10.08', 180_000, 9_072, 9_072, 207, 207, 16_470, 648, 880, 1_495, 527, 149_321, 149_000, 8_300],
	['45', '宮崎県', 1_023, '令和7.11.16', '9.77', 170_000, 8_304, 8_305, 195, 196, 15_555, 612, 870, 1_478, 521, 148_986, 147_000, 8_000],
	['46', '鹿児島県', 1_026, '令和7.11.01', '10.13', 170_000, 8_610, 8_611, 195, 196, 15_555, 612, 872, 1_482, 523, 149_188, 149_000, 8_300],
	['47', '沖縄県', 1_023, '令和7.12.01', '9.44', 170_000, 8_024, 8_024, 195, 196, 15_555, 612, 870, 1_478, 521, 149_266, 149_000, 8_300]
] as const;

/** A leave entry for the whole days `from`–`to`. */
const leave = (job: string, code: string, from: string, to: string): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: job,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference: `${code}-${from}`,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		reason: code
	}
});

const yen = (n: number) => n.toLocaleString('en-US');

register(
	...REGIONS.map(
		([jis, region, floor, since, rate, grade, he, hr, se, sr, pe, cc, ee, er, wc, after, band, tax]) => {
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
			sato({ ref: 'noguchi', name: 'Noguchi Emi', born: '1981-03-03', wage: 300_000, grade: 300_000 })
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
		people: [sato({ ref: 'kyoto', name: 'Mori Aoi', wage: 150_000, grade: 190_000, worksite: '京都府' })],
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
		people: [sato({ ref: 'nara', name: 'Ishii Kanon', wage: 150_000, grade: 180_000, worksite: '奈良県' })],
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
