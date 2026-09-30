import { register, type ProbeCase, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * TW cases: see the case shape at the top of payroll-probe.ts. Every figure below is computed by hand from the
 * cited instrument (民國115年 tables, in force from 1 January 2026), never read off the product or a golden.
 *
 * Common facts, cited once here and relied on by every case:
 *  - 勞保 11.5% (普通事故, from 114年1月1日) and 就保 1%, shared 20% worker / 70% unit / 10% state; a month is
 *    30 days whatever its length, and a part month is the enrolled days ÷ 30 (join on the 31st = 1 day).
 *  - Each premium share is rounded to the 元, 角以下四捨五入, once, after the day proration.
 *  - 健保 is the published 負擔金額表(三) cell for the grade; the unit share carries 0.56 average dependants.
 *  - 勞退 is 6% of the 月提繳工資 grade from the unit, pro rata for a part month over 30 days.
 *  - 災保 is the unit's industry rate on the 災保 grade. The probe company is 行業 編號四二
 *    (電腦程式設計、諮詢及相關服務業、資訊服務業): 0.05% + 0.07% commuting = 0.12%.
 *  - Monthly pay is prorated over a flat 30 days, and the 時薪 is 月薪 ÷ 30 ÷ 8.
 *  - Income tax is cut to the 元.
 * The insured grade is the grade the unit declared to the insurer, which is the table grade of the wage.
 */

const SRC = {
	liRate:
		'BLI 勞保、就保、災保保險費試算 (https://www.bli.gov.tw/0014162.htm): 普通事故保險費率 自114年1月1日起為11.5%; 就業保險費率 1%; 保險費計算自加保之日起至退保當日為止，不論月份大小，一個月概以30日為計算標準 (30日或31日加保者 均為1天)',
	liShare:
		'勞工保險條例 §15(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050001): 被保險人負擔20%，投保單位負擔70%，其餘10%由中央政府補助; 就業保險法 §40 applies the same shares (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050021); 勞工保險條例施行細則 §33: 保險費以元為單位，角以下四捨五入',
	liGrades:
		'勞工保險投保薪資分級表 (勞動部 114-11-21 勞動保2字第1140091863號令, 自115年1月1日施行, https://www.bli.gov.tw/Files/25661): 第1級 29,500 元以下 → 29,500; 38,201–40,100 → 40,100; 40,101–42,000 → 42,000; 43,901 以上 → 45,800; 備註二 28,590 (27,601–28,590) for trainees below the minimum wage; 備註三 part-timers below the minimum wage 11,100 (≤11,100) and 12,540, above 12,540 覈實申報 on 備註二 (13,501–15,840 → 15,840)',
	occGrades:
		'勞工職業災害保險投保薪資分級表 (勞動部 114-11-17 勞動保3字第1140090499號令, 自115年1月1日施行, https://www.bli.gov.tw/Files/25664): 第1級 29,500 元以下 → 29,500; … 第21級 69,801 以上 → 72,800',
	occRate:
		'勞工職業災害保險適用行業別及費率表 (勞動部 113-11-07 公告, 自114年1月1日施行, https://www.bli.gov.tw/Files/24759): 編號四二 電腦程式設計、諮詢及相關服務業 0.05% + 上下班 0.07% = 0.12%; 編號二五 建築工程業 0.50% + 0.07% = 0.57%; 勞工職業災害保險及保護法 §19(1): 保險費由投保單位全額負擔 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050031)',
	pension:
		'勞工退休金條例 §14(1) 雇主提繳 不得低於每月工資6%, §14(3) 勞工得在每月工資6%範圍內自願提繳 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020); 勞工退休金月提繳分級表 (勞動部 114-11-24 勞動福3字第1140153598號令, 自115年1月1日生效, https://www.bli.gov.tw/Files/25709); BLI FAQ 9 (https://www.bli.gov.tw/0017599.html): 不分大小月份，每月均以30日計算 — 全月 = 月提繳工資×提繳率, 非全月 = 月提繳工資×提繳率×提繳天數÷30, 角以下4捨5入',
	nhi: '全民健康保險保險費負擔金額表(三) 公、民營事業、機構及有一定雇主之受僱者 (115.1.1生效, https://www.nhi.gov.tw/ch/cp-19418-9eefb-2576-1.html): per grade the 本人 / 本人+1–3眷口 shares and the 投保單位 share (0.56 average dependants, 費率 5.17%); 全民健康保險法 §18(2) 眷屬 超過三口者以三口計, §30(2) 投保當月繳納全月保險費，退保當月免繳保險費 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060001)',
	minimumWage:
		'勞動部 最低工資 notice (https://www.mol.gov.tw/1607/1632/1633/84947/post): from 115年1月1日 每月 29,500, 每小時 196; 最低工資法 §5: 議定之工資低於最低工資者，以本法所定之最低工資為其工資數額 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030028&flno=5)',
	fivePercent:
		'各類所得扣繳率標準 §2(1)(2): 薪資 按全月給付總額扣取百分之五 at the resident’s election, §13: 每次應扣繳稅額不超過新臺幣二千元者，免予扣繳 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0340028); 所得稅法 §14(1) 第三類 (四): 加班費不超過規定標準者 is not 薪資收入, (五): 自願提繳之退休金 在每月工資百分之六範圍內 不計入薪資收入 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340003&flno=14)',
	table:
		'115年度薪資所得扣繳稅額表 (財政部 114-12-04 台財稅字第11404675280號函, https://www.dot.gov.tw/singlehtml/ch_313?cntId=3783c45ec28543838fe285d06d00f3b8): no spouse or dependant, every row to 90,001–90,500 withholds 0; 90,501–91,000 → 2,020; 94,501–95,000 → 2,220; one dependant 99,501–100,000 → 2,050',
	nonResident:
		'各類所得扣繳率標準 §3(1)(2): 非中華民國境內居住之個人 薪資 按給付額扣取百分之十八; (二) 全月薪資給付總額在 每月基本工資一點五倍以下者 按給付額扣取百分之六 — 1.5 × 29,500 = 44,250 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0340028)',
	lsa: '勞動基準法 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001)'
} as const;

/** The TW week: Monday–Friday 09:00–18:00 less a 60-minute break (8 normal hours), Saturday 休息日, Sunday 例假. */
const twWeek = (from: string): ProbeInput[] => [
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
			name: '休息日',
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
			name: '例假',
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
			name: '5 x OFFICE, 休息日, 例假',
			pattern: {
				days: ['@office', '@office', '@office', '@office', '@office', '@rest', '@statutory'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from, to: null }
		}
	}
];

type Code =
	'LI' | 'EI' | 'NHI' | 'OCC_INJURY' | 'LABOR_PENSION' | 'WAGE_ARREARS_BASE' | 'INCOME_TAX';
type Standing =
	| { kind: 'REGISTERED'; elections?: Row }
	| { kind: 'NOT_REGISTERED'; reason: string; declaration_reference?: string; elections?: Row };
type Piece = readonly [from: string, to: string | null, standing: Standing];
type Person = {
	ref: string;
	name: string;
	born: string;
	gender?: 'MALE' | 'FEMALE';
	nationality?: string;
	hired: string;
	left?: string;
	exit_reason?: string;
	exit_facts?: Row;
	wage: number;
	/** Overrides of the one terms row (residency, tax residency, pass, type, hours, allowances). */
	terms?: Row;
	/** Dated terms rows instead of one (a mid-month raise). */
	termsRows?: readonly Row[];
	/** The grade the unit declared per scheme; LI's grade also stands for 墊償 unless WAGE_ARREARS_BASE is given. */
	grades: Partial<Record<Exclude<Code, 'INCOME_TAX'>, number>>;
	dependants?: number;
	/** INCOME_TAX elections; unrecorded is the table with no dependants. */
	tax?: Row;
	/** Further elections merged into a registered scheme. */
	elections?: Partial<Record<Code, Row>>;
	/** A scheme's standing when it is not the plain registration, dated pieces where it changes. */
	standing?: Partial<Record<Code, Standing | readonly Piece[]>>;
};

const TABLE: Row = {
	table_declaration_reference: 'PROBE-TW-TABLE-DECLARATION',
	table_dependants: 0
};
const FIVE: Row = { five_percent_withholding: true };

function personInputs(p: Person): ProbeInput[] {
	const job = `${p.ref}_job`;
	const range = { from: p.hired, to: p.left ?? null };
	const registered = (code: Code, elections: Row = {}): Standing => {
		const grade =
			code === 'INCOME_TAX'
				? undefined
				: code === 'WAGE_ARREARS_BASE'
					? (p.grades.WAGE_ARREARS_BASE ?? p.grades.LI)
					: p.grades[code];
		return {
			kind: 'REGISTERED',
			elections: {
				...(grade === undefined ? {} : { insured_amount: grade }),
				...(code === 'NHI' ? { enrolled_dependants: p.dependants ?? 0 } : {}),
				...(code === 'LABOR_PENSION' ? { voluntary_rate: 0 } : {}),
				...(code === 'INCOME_TAX' ? (p.tax ?? TABLE) : {}),
				...p.elections?.[code],
				...elections
			}
		};
	};
	const status = (code: Code, standing: Standing): Row =>
		standing.kind === 'REGISTERED'
			? {
					...registered(code, standing.elections),
					reference_number: `PROBE-${code}`,
					since: p.hired,
					first_contribution_due_on: p.hired
				}
			: {
					kind: 'NOT_REGISTERED',
					reason: standing.reason,
					...(standing.declaration_reference === undefined
						? {}
						: { declaration_reference: standing.declaration_reference }),
					...(standing.elections === undefined ? {} : { elections: standing.elections })
				};
	const codes: Code[] = [
		'LI',
		'EI',
		'NHI',
		'OCC_INJURY',
		'LABOR_PENSION',
		'WAGE_ARREARS_BASE',
		'INCOME_TAX'
	];
	const facts = codes.flatMap((code): ProbeInput[] => {
		const given = p.standing?.[code];
		const pieces: readonly Piece[] =
			given === undefined
				? [[p.hired, p.left ?? null, { kind: 'REGISTERED' }]]
				: Array.isArray(given)
					? (given as readonly Piece[])
					: [[p.hired, p.left ?? null, given as Standing]];
		return pieces.map(([from, to, standing]) => ({
			collection: 'employment_statutory_facts',
			values: {
				employee_id: `@${p.ref}`,
				employment_id: `@${job}`,
				statutory_contribution_id: `@law:statutory_contributions:${code}`,
				effective_range: { from, to },
				status: status(code, standing)
			}
		}));
	});
	const terms: Row = {
		employment_id: `@${job}`,
		residency_status: 'CITIZEN',
		tax_residency: 'RESIDENT',
		currency: 'TWD',
		base_salary: p.wage,
		pay_frequency: 'MONTHLY',
		work_classification: 'EA_COVERED',
		statutory_work_category: 'NON_MANUAL',
		employment_type: 'PERMANENT',
		shift_pattern_id: '@week',
		facts: {},
		effective_range: range,
		...p.terms
	};
	return [
		{
			collection: 'employees',
			ref: p.ref,
			values: {
				name: p.name,
				date_of_birth: p.born,
				gender: p.gender ?? 'MALE',
				nationality: p.nationality ?? 'Taiwanese'
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
				...(p.exit_reason === undefined ? {} : { exit_reason: p.exit_reason }),
				...(p.exit_facts === undefined ? {} : { exit_facts: p.exit_facts })
			}
		},
		...(p.termsRows ?? [{}]).map((row): ProbeInput => ({
			collection: 'employment_terms',
			values: { ...terms, ...row }
		})),
		...facts
	];
}

type TwCase = Omit<ProbeCase, 'profile' | 'inputs' | 'expected'> & {
	people: readonly Person[];
	extra?: (ref: (person: string) => string) => ProbeInput[];
	expected: Readonly<Record<string, ProbeCase['expected'][number]['lines']>>;
};

const tw = (c: TwCase): ProbeCase => ({
	id: c.id,
	profile: 'TW',
	description: c.description,
	citation: c.citation,
	company: { risk_class: '42', facts: {}, ...c.company },
	period: c.period,
	inputs: [
		...twWeek('2003-12-01'),
		...c.people.flatMap(personInputs),
		...(c.extra?.((person) => `@${person}_job`) ?? [])
	],
	expected: Object.entries(c.expected).map(([ref, lines]) => ({ employment: `${ref}_job`, lines })),
	...(c.warnings === undefined ? {} : { warnings: c.warnings }),
	...(c.companyLines === undefined ? {} : { companyLines: c.companyLines })
});

const leave = (
	job: string,
	code: string,
	reference: string,
	from: string,
	to: string,
	extra: Row = {}
): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: job,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		reason: reference,
		...extra
	}
});
/** A monthly worker's latest normal-hours month, as the approved wage record 施行細則 §24-1 reads. */
const wageMonth = (job: string, month: string, last: string, wages: number): ProbeInput => ({
	collection: 'employment_wage_periods',
	values: {
		employment_id: job,
		period: { from: `${month}-01`, to: last },
		currency: 'TWD',
		normal_wages: wages,
		due_on: last,
		paid_on: last,
		reference: `${month} payslip`
	}
});
/** A clocked day in Taipei (+08:00): `[start, end]` pairs of HH:MM. */
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
			start: new Date(`${date}T${from}:00+08:00`).toISOString(),
			end: new Date(`${date}T${to}:00+08:00`).toISOString()
		}))
	}
});
/** A clocked day whose extended, 休息日 or 休假日 hours the employer asked for with consent (§32, §39): the run pays only those. */
const asked = (day: ProbeInput, hours: number): ProbeInput => ({
	...day,
	values: { ...day.values, approved_overtime_hours: hours }
});
const adhoc = (
	job: string,
	code: string,
	amount: number,
	date: string,
	reason: string
): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: job,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		reason
	}
});

const EVERY = [
	SRC.liRate,
	SRC.liShare,
	SRC.liGrades,
	SRC.nhi,
	SRC.pension,
	SRC.occGrades,
	SRC.occRate
];
const ARREARS =
	'勞動基準法 §28(3) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=28) and BLI 積欠工資墊償基金 (https://www.bli.gov.tw/0110180.html, read 2026-09-30): 墊償提繳費 = 墊償提繳薪資總額 (the 勞保投保薪資, day-prorated) × 0.025%, 角以下四捨五入, paid by the unit alone';
const NHI_EMPLOYER =
	'全民健康保險法 §34 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=L0060001&flno=34, read 2026-09-30): 投保單位 每月支付之薪資所得總額逾其受僱者當月投保金額總額時，應按其差額及前條比率 (2.11%) 計算應負擔之補充保險費 — one establishment line, not a payslip charge';
const citizen = (
	ref: string,
	name: string,
	wage: number,
	grades: Person['grades'],
	rest: Partial<Person> = {}
): Person => ({
	ref,
	name,
	born: '1990-05-10',
	hired: '2024-02-01',
	wage,
	grades,
	...rest
});
/** One grade for every insured scheme (LI's own ceiling is 45,800, 災保's 72,800). */
const all = (li: number, nhi = li, pen = nhi, occ = pen): Person['grades'] => ({
	LI: li,
	EI: li,
	NHI: nhi,
	LABOR_PENSION: pen,
	OCC_INJURY: occ
});
const OLD_SYSTEM: Standing = {
	kind: 'NOT_REGISTERED',
	reason: 'LSA old pension system retained',
	declaration_reference: 'PROBE-OLD-SYSTEM-RETAINED-SAME-UNIT-SINCE-2004',
	elections: { old_system_retained: true }
};
const NOTICE = { lsa_termination_ground: 'ARTICLE_11', notice_days_given: 30 };

register(
	// ── Contribution schemes: floor, ceiling, seam, rate classes ───────────────────────────────────
	tw({
		id: 'TW-LI-01-1',
		description:
			'A citizen on NT$48,000, the whole of March 2026, 5% election: 勞保 and 就保 at the 45,800 ceiling, 健保/勞退/災保 on 48,200.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'勞保 45,800 × 11.5% = 5,267: × 20% = 1,053.40 → 1,053; × 70% = 3,686.90 → 3,687. 就保 458: 91.60 → 92; 320.60 → 321.',
			'健保 48,200: 748 / 2,332. 勞退 48,200 × 6% = 2,892. 災保 48,200 × 0.12% = 57.84 → 58. 5% × 48,000 = 2,400 (> 2,000).',
			'Net 48,000 − (1,053 + 92 + 748 + 2,400) = 43,707; employer 3,687 + 321 + 2,332 + 2,892 + 58 = 9,290.'
		],
		period: '2026-03',
		people: [citizen('lin', 'Lin Chih-hao', 48_000, all(45_800, 48_200), { tax: FIVE })],
		expected: {
			lin: {
				gross: 48_000,
				net: 43_707,
				total_deductions: 4293,
				employer_cost: 9290,
				BASIC: 48_000,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 748,
				'NHI.employer': 2332,
				'LABOR_PENSION.employer': 2892,
				'OCC_INJURY.employer': 58,
				'INCOME_TAX.employee': 2400
			}
		}
	}),
	tw({
		id: 'TW-EI-01-1',
		description:
			'NT$33,000 in March 2026 on the 33,300 grade of every table; the table election withholds nothing below 90,501.',
		citation: [
			...EVERY,
			SRC.table,
			'勞保 33,300 × 11.5% = 3,829.50: × 20% = 765.90 → 766; × 70% = 2,680.65 → 2,681. 就保 333: 66.60 → 67; 233.10 → 233.',
			'健保 33,300: 516 / 1,611. 勞退 1,998. 災保 39.96 → 40. Net 33,000 − 1,349 = 31,651; employer 6,563.'
		],
		period: '2026-03',
		people: [citizen('chen', 'Chen Mei-ling', 33_000, all(33_300), { gender: 'FEMALE' })],
		expected: {
			chen: {
				gross: 33_000,
				net: 31_651,
				employer_cost: 6563,
				'LI.employee': 766,
				'LI.employer': 2681,
				'EI.employee': 67,
				'EI.employer': 233,
				'NHI.employee': 516,
				'NHI.employer': 1611,
				'LABOR_PENSION.employer': 1998,
				'OCC_INJURY.employer': 40
			}
		}
	}),
	tw({
		id: 'TW-OCC-01-1',
		description:
			'A 建築工程業 unit (行業 編號二五, 0.57%): NT$60,000, 災保 on its own 60,800 grade.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'災保 60,800 × 0.57% = 346.56 → 347. 勞保 ceiling 1,053 / 3,687; 就保 92 / 321. 健保 60,800: 943 / 2,942. 勞退 3,648. 5% × 60,000 = 3,000.',
			'Net 60,000 − (1,053 + 92 + 943 + 3,000) = 54,912; employer 3,687 + 321 + 2,942 + 3,648 + 347 = 10,945.'
		],
		company: { risk_class: '25' },
		period: '2026-03',
		people: [citizen('wang', 'Wang Da-wei', 60_000, all(45_800, 60_800), { tax: FIVE })],
		expected: {
			wang: {
				gross: 60_000,
				net: 54_912,
				employer_cost: 10_945,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 943,
				'NHI.employer': 2942,
				'LABOR_PENSION.employer': 3648,
				'OCC_INJURY.employer': 347,
				'INCOME_TAX.employee': 3000
			}
		}
	}),
	tw({
		id: 'TW-OCC-04-1',
		description:
			'NT$80,000: 災保 stops at its 72,800 ceiling while 健保 and 勞退 insure at 80,200.',
		citation: [
			...EVERY,
			SRC.table,
			'災保 72,800 (69,801 以上) × 0.12% = 87.36 → 87. 健保 80,200: 1,244 / 3,881. 勞退 80,200 × 6% = 4,812. 勞保/就保 ceiling.',
			'The table withholds nothing (80,000 < 90,501). Net 80,000 − (1,053 + 92 + 1,244) = 77,611; employer 12,788.'
		],
		period: '2026-03',
		people: [citizen('huang', 'Huang Yu-ting', 80_000, all(45_800, 80_200, 80_200, 72_800))],
		expected: {
			huang: {
				gross: 80_000,
				net: 77_611,
				employer_cost: 12_788,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 1244,
				'NHI.employer': 3881,
				'LABOR_PENSION.employer': 4812,
				'OCC_INJURY.employer': 87
			}
		}
	}),
	tw({
		id: 'TW-NHI-03-1',
		description:
			'The grade seam: NT$40,100 insures at 40,100 and NT$40,101 at 42,000 in every table.',
		citation: [
			...EVERY,
			SRC.table,
			'40,100: 勞保 4,611.50 → 922.30 → 922 / 3,228.05 → 3,228; 就保 80.20 → 80 / 280.70 → 281; 健保 622 / 1,940; 勞退 2,406; 災保 48.12 → 48. Net 38,476; employer 7,903.',
			'42,000: 勞保 4,830 → 966 / 3,381; 就保 84 / 294; 健保 651 / 2,032; 勞退 2,520; 災保 50.40 → 50. Net 40,101 − 1,701 = 38,400; employer 8,277.'
		],
		period: '2026-03',
		people: [
			citizen('kao', 'Kao Chun-yi', 40_100, all(40_100)),
			citizen('liu', 'Liu Shu-fen', 40_101, all(42_000), { gender: 'FEMALE' })
		],
		expected: {
			kao: {
				gross: 40_100,
				net: 38_476,
				employer_cost: 7903,
				'LI.employee': 922,
				'LI.employer': 3228,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			},
			liu: {
				gross: 40_101,
				net: 38_400,
				employer_cost: 8277,
				'LI.employee': 966,
				'LI.employer': 3381,
				'EI.employee': 84,
				'EI.employer': 294,
				'NHI.employee': 651,
				'NHI.employer': 2032,
				'LABOR_PENSION.employer': 2520,
				'OCC_INJURY.employer': 50
			}
		}
	}),
	tw({
		id: 'TW-NHI-01-1',
		description:
			'Two enrolled 健保 dependants: the worker pays three heads at the 36,300 grade; the unit share is unchanged.',
		citation: [
			...EVERY,
			'健保 36,300 本人+2眷口 1,689 (563 × 3); unit 1,757. 勞保 4,174.50 → 834.90 → 835 / 2,922.15 → 2,922; 就保 72.60 → 73 / 254.10 → 254; 勞退 2,178; 災保 43.56 → 44.',
			'Net 36,000 − (835 + 73 + 1,689) = 33,403; employer 7,155.'
		],
		period: '2026-03',
		people: [
			citizen('tsai', 'Tsai Ming-hui', 36_000, all(36_300), {
				dependants: 2,
				tax: { ...TABLE, table_dependants: 2 }
			})
		],
		expected: {
			tsai: {
				gross: 36_000,
				net: 33_403,
				employer_cost: 7155,
				'LI.employee': 835,
				'LI.employer': 2922,
				'EI.employee': 73,
				'EI.employer': 254,
				'NHI.employee': 1689,
				'NHI.employer': 1757,
				'LABOR_PENSION.employer': 2178,
				'OCC_INJURY.employer': 44
			}
		}
	}),
	tw({
		id: 'TW-NHI-11-1',
		description: 'Four enrolled dependants are charged as three (健保法 §18(2)); 5% on NT$50,000.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'健保 50,600 本人+3眷口 3,140; unit 2,449. 勞保/就保 ceiling 1,053 / 3,687, 92 / 321. 勞退 3,036. 災保 60.72 → 61. 5% × 50,000 = 2,500.',
			'Net 50,000 − (1,053 + 92 + 3,140 + 2,500) = 43,215; employer 9,554.'
		],
		period: '2026-03',
		people: [
			citizen('hsu', 'Hsu Wen-chieh', 50_000, all(45_800, 50_600), { dependants: 4, tax: FIVE })
		],
		expected: {
			hsu: {
				gross: 50_000,
				net: 43_215,
				employer_cost: 9554,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 3140,
				'NHI.employer': 2449,
				'LABOR_PENSION.employer': 3036,
				'OCC_INJURY.employer': 61,
				'INCOME_TAX.employee': 2500
			}
		}
	}),
	tw({
		id: 'TW-NHI-14-1',
		description:
			'A 中度 disability certificate: the state pays half the worker’s own 勞保, 就保 and 健保 share, each subsidy rounded on its own; the unit share is untouched.',
		citation: [
			...EVERY,
			'身心障礙者參加社會保險保險費補助辦法 §4–5 (https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=D0050090): 中度 補助 1/2 of the insured’s own share; BLI 試算 (https://www.bli.gov.tw/0014162.htm): 中度障礙者，政府補助個人應負擔保險費1/2',
			'40,100: 勞保 922.30 → 922 less 461.15 → 461 = 461; 就保 80.20 → 80 less 40.10 → 40 = 40; 健保 622 less 311 = 311. Units: 3,228, 281, 1,940; 勞退 2,406; 災保 48.',
			'Net 40,000 − (461 + 40 + 311) = 39,188; employer 7,903.'
		],
		period: '2026-03',
		people: [
			citizen('lai', 'Lai Kuo-chiang', 40_000, all(40_100), {
				elections: {
					LI: { disability_subsidy: 50 },
					EI: { disability_subsidy: 50 },
					NHI: { disability_subsidy: 50 }
				}
			})
		],
		expected: {
			lai: {
				gross: 40_000,
				net: 39_188,
				employer_cost: 7903,
				'LI.employee': 461,
				'LI.employer': 3228,
				'EI.employee': 40,
				'EI.employer': 281,
				'NHI.employee': 311,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			}
		}
	}),
	tw({
		id: 'TW-LI-08-1',
		description: 'A recurring 伙食津貼 is 工資: NT$40,000 + 3,000 insures at the 43,900 grade.',
		citation: [
			...EVERY,
			'勞動基準法 §2(3): 工資 includes 津貼 and any 經常性給與 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=2); 勞工保險條例 §14(1) 月投保薪資 is the 月薪資總額',
			'營利事業所得稅查核準則 §88(2)(1): 按月定額 伙食代金 up to NT$3,000 免視為薪資所得 (https://law-out.mof.gov.tw/LawContent.aspx?id=FL006027); the table withholds nothing on 40,000.',
			'43,900: 勞保 5,048.50 → 1,009.70 → 1,010 / 3,533.95 → 3,534; 就保 87.80 → 88 / 307.30 → 307; 健保 681 / 2,124; 勞退 2,634; 災保 52.68 → 53.',
			'Net 43,000 − (1,010 + 88 + 681) = 41,221; employer 8,652.'
		],
		period: '2026-03',
		people: [
			citizen('pan', 'Pan Chia-hui', 40_000, all(43_900), {
				gender: 'FEMALE',
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:MEAL_ALLOWANCE', amount: 3000 }]
				}
			})
		],
		expected: {
			pan: {
				gross: 43_000,
				net: 41_221,
				employer_cost: 8652,
				MEAL_ALLOWANCE: 3000,
				'LI.employee': 1010,
				'LI.employer': 3534,
				'EI.employee': 88,
				'EI.employer': 307,
				'NHI.employee': 681,
				'NHI.employer': 2124,
				'LABOR_PENSION.employer': 2634,
				'OCC_INJURY.employer': 53
			}
		}
	}),
	tw({
		id: 'TW-PEN-11-1',
		description:
			'The 勞退 wage is the whole wage: NT$38,000 + 2,500 meal allowance = 40,500 → the 42,000 grade; the 5% on 38,000 is 1,900, not over 2,000.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'勞工退休金條例 §14(1) on 每月工資 with 勞動基準法 §2(3); 查核準則 §88(2)(1) keeps a meal allowance within NT$3,000 out of 薪資所得 (https://law-out.mof.gov.tw/LawContent.aspx?id=FL006027).',
			'42,000: 勞保 966 / 3,381; 就保 84 / 294; 健保 651 / 2,032; 勞退 2,520; 災保 50. Net 40,500 − 1,701 = 38,799; employer 8,277.'
		],
		period: '2026-03',
		people: [
			citizen('yang', 'Yang Tzu-chi', 38_000, all(42_000), {
				tax: FIVE,
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:MEAL_ALLOWANCE', amount: 2500 }]
				}
			})
		],
		expected: {
			yang: {
				gross: 40_500,
				net: 38_799,
				employer_cost: 8277,
				'LI.employee': 966,
				'LI.employer': 3381,
				'EI.employee': 84,
				'EI.employer': 294,
				'NHI.employee': 651,
				'NHI.employer': 2032,
				'LABOR_PENSION.employer': 2520,
				'OCC_INJURY.employer': 50
			}
		}
	}),
	tw({
		id: 'TW-TAX-06-1',
		description:
			'A NT$3,500 meal allowance on NT$42,000: all of it is 工資 for the grades (45,800), only the 500 above NT$3,000 is 薪資所得.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'營利事業所得稅查核準則 §88(2)(1) (https://law-out.mof.gov.tw/LawContent.aspx?id=FL006027): 按月定額發給員工伙食代金 免視為員工之薪資所得 up to NT$3,000; the excess is salary.',
			'5% × (42,000 + 500) = 2,125. 45,800: 勞保 1,053 / 3,687; 就保 92 / 321; 健保 710 / 2,216; 勞退 2,748; 災保 54.96 → 55.',
			'Net 45,500 − (1,053 + 92 + 710 + 2,125) = 41,520; employer 9,027.'
		],
		period: '2026-03',
		people: [
			citizen('ho', 'Ho Yi-chen', 42_000, all(45_800), {
				tax: FIVE,
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:MEAL_ALLOWANCE', amount: 3500 }]
				}
			})
		],
		expected: {
			ho: {
				gross: 45_500,
				net: 41_520,
				employer_cost: 9027,
				MEAL_ALLOWANCE: 3500,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 2748,
				'OCC_INJURY.employer': 55,
				'INCOME_TAX.employee': 2125
			}
		}
	}),
	tw({
		id: 'TW-PEN-01-1',
		description:
			'A 6% voluntary 勞退 on the 50,600 grade: 3,036 from the worker beside the unit’s 3,036, and outside the 5% base.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'勞退 50,600 × 6% = 3,036 each. 5% × (50,000 − 3,036) = 2,348.20 → 2,348. 健保 50,600: 785 / 2,449. 災保 60.72 → 61.',
			'Net 50,000 − (1,053 + 92 + 785 + 3,036 + 2,348) = 42,686; employer 3,687 + 321 + 2,449 + 3,036 + 61 = 9,554.'
		],
		period: '2026-03',
		people: [
			citizen('su', 'Su Chien-ming', 50_000, all(45_800, 50_600), {
				tax: FIVE,
				elections: { LABOR_PENSION: { voluntary_rate: 6 } }
			})
		],
		expected: {
			su: {
				gross: 50_000,
				net: 42_686,
				employer_cost: 9554,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 785,
				'NHI.employer': 2449,
				'LABOR_PENSION.employee': 3036,
				'LABOR_PENSION.employer': 3036,
				'OCC_INJURY.employer': 61,
				'INCOME_TAX.employee': 2348
			}
		}
	}),
	tw({
		id: 'TW-PEN-12-1',
		description:
			'A 3% voluntary rate kept apart from the unit’s 6%: NT$70,000 on the 72,800 grade.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'勞退 72,800: worker 3% = 2,184, unit 6% = 4,368. 5% × (70,000 − 2,184) = 3,390.80 → 3,390. 健保 72,800: 1,129 / 3,523. 災保 72,800 → 87.',
			'Net 70,000 − (1,053 + 92 + 1,129 + 2,184 + 3,390) = 62,152; employer 3,687 + 321 + 3,523 + 4,368 + 87 = 11,986.'
		],
		period: '2026-03',
		people: [
			citizen('cheng', 'Cheng Hsiao-wen', 70_000, all(45_800, 72_800), {
				tax: FIVE,
				elections: { LABOR_PENSION: { voluntary_rate: 3 } }
			})
		],
		expected: {
			cheng: {
				gross: 70_000,
				net: 62_152,
				employer_cost: 11_986,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 1129,
				'NHI.employer': 3523,
				'LABOR_PENSION.employee': 2184,
				'LABOR_PENSION.employer': 4368,
				'OCC_INJURY.employer': 87,
				'INCOME_TAX.employee': 3390
			}
		}
	}),

	// ── Minimum wage and part-timers ───────────────────────────────────────────────────────────────
	tw({
		id: 'TW-MW-01-1',
		description:
			'A full-timer agreed at NT$28,000 is paid the NT$29,500 minimum (最低工資法 §5); every scheme at its 29,500 floor.',
		citation: [
			...EVERY,
			SRC.minimumWage,
			'29,500: 勞保 3,392.50 → 678.50 → 679 / 2,374.75 → 2,375; 就保 59 / 206.50 → 207; 健保 458 / 1,428; 勞退 1,770; 災保 35.40 → 35.',
			'Net 29,500 − (679 + 59 + 458) = 28,304; employer 5,815.'
		],
		period: '2026-03',
		people: [citizen('wu', 'Wu Pei-shan', 28_000, all(29_500), { gender: 'FEMALE' })],
		expected: {
			wu: {
				gross: 29_500,
				net: 28_304,
				employer_cost: 5815,
				'LI.employee': 679,
				'LI.employer': 2375,
				'EI.employee': 59,
				'EI.employer': 207,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 1770,
				'OCC_INJURY.employer': 35
			}
		}
	}),
	tw({
		id: 'TW-HIRE-04-1',
		description:
			'An intern employed under an employment contract at NT$20,000 full time is owed the NT$29,500 minimum.',
		citation: [
			...EVERY,
			SRC.minimumWage,
			'勞動部 working-student guidance (https://www.mol.gov.tw/1607/1632/1633/96453/) with 勞動基準法 §2(1), §3: a student in an employment relationship is a 勞工 and the minimum wage applies.',
			'29,500 grades as TW-MW-01-1: net 28,304; employer 5,815.'
		],
		period: '2026-03',
		people: [
			citizen('kuo', 'Kuo Yu-hsuan', 20_000, all(29_500), {
				born: '2004-09-01',
				hired: '2026-01-05',
				terms: { employment_type: 'INTERN' }
			})
		],
		expected: {
			kuo: {
				gross: 29_500,
				net: 28_304,
				employer_cost: 5815,
				'LI.employee': 679,
				'LI.employer': 2375,
				'EI.employee': 59,
				'EI.employer': 207,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 1770,
				'OCC_INJURY.employer': 35
			}
		}
	}),
	tw({
		id: 'TW-MW-02-1',
		description:
			'A monthly part-timer on 20 hours a week agreed at NT$12,000 is paid 29,500 × 20/40 = 14,750; 勞保/就保/勞退 on the 15,840 part-time grade, 健保 and 災保 at their 29,500 floor.',
		citation: [
			...EVERY,
			SRC.minimumWage,
			'僱用部分時間工作勞工應行注意事項 §6(2)(1) (https://laws.mol.gov.tw/FLAW/FLAWDOC01.aspx?flno=6&id=FL072875): a monthly part-timer’s wage is not below the monthly minimum in proportion to working time; 勞動基準法 §30(1) 40 normal hours a week.',
			'15,840: 勞保 1,821.60 → 364.32 → 364 / 1,275.12 → 1,275; 就保 158.40 → 31.68 → 32 / 110.88 → 111; 勞退 950.40 → 950. 健保 29,500: 458 / 1,428. 災保 29,500 → 35.',
			'Net 14,750 − (364 + 32 + 458) = 13,896; employer 1,275 + 111 + 1,428 + 950 + 35 = 3,799.'
		],
		period: '2026-03',
		people: [
			citizen(
				'lu',
				'Lu Hsin-yi',
				12_000,
				{ LI: 15_840, EI: 15_840, NHI: 29_500, LABOR_PENSION: 15_840, OCC_INJURY: 29_500 },
				{
					gender: 'FEMALE',
					terms: { employment_type: 'PART_TIME', ordinary_hours_per_week: 20 }
				}
			)
		],
		expected: {
			lu: {
				gross: 14_750,
				net: 13_896,
				employer_cost: 3799,
				'LI.employee': 364,
				'LI.employer': 1275,
				'EI.employee': 32,
				'EI.employer': 111,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 950,
				'OCC_INJURY.employer': 35
			}
		}
	}),
	tw({
		id: 'TW-LI-05-1',
		description:
			'A continuing part-timer on 16 hours a week at NT$15,000 stays enrolled for the whole month: 15,840 for 勞保/就保/勞退, 29,500 for 災保 and 健保.',
		citation: [
			...EVERY,
			'BLI 2026 part-time enrolment guidance (https://www.bli.gov.tw/0101373.htm): a continuing part-timer is insured for the whole employment on the actual whole-month wage, 災保 at its own table (minimum 29,500).',
			'Floor 29,500 × 16/40 = 11,800 < 15,000. 15,840: 勞保 364 / 1,275; 就保 32 / 111; 勞退 950. 健保 458 / 1,428. 災保 35.',
			'Net 15,000 − 854 = 14,146; employer 3,799.'
		],
		period: '2026-03',
		people: [
			citizen(
				'chou',
				'Chou Tsung-han',
				15_000,
				{ LI: 15_840, EI: 15_840, NHI: 29_500, LABOR_PENSION: 15_840, OCC_INJURY: 29_500 },
				{
					terms: { employment_type: 'PART_TIME', ordinary_hours_per_week: 16 }
				}
			)
		],
		expected: {
			chou: {
				gross: 15_000,
				net: 14_146,
				employer_cost: 3799,
				'LI.employee': 364,
				'LI.employer': 1275,
				'EI.employee': 32,
				'EI.employer': 111,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 950,
				'OCC_INJURY.employer': 35
			}
		}
	}),
	tw({
		id: 'TW-NHI-05-1',
		description:
			'A part-timer on exactly 12 hours a week at NT$9,000 is enrolled in 健保 by the employer; 勞保/就保 at the 11,100 part-time grade, 勞退 on 9,900.',
		citation: [
			...EVERY,
			'NHIA part-time interpretation (https://www.nhi.gov.tw/ch/cp-2981-5ed58-3150-1.html): a part-timer working 12 hours or more a week is enrolled by the employer as a 第一類 insured.',
			'Floor 29,500 × 12/40 = 8,850 < 9,000. 11,100: 勞保 1,276.50 → 255.30 → 255 / 893.55 → 894; 就保 22.20 → 22 / 77.70 → 78. 勞退 9,900 (8,701–9,900) × 6% = 594. 健保 458 / 1,428. 災保 35.',
			'Net 9,000 − (255 + 22 + 458) = 8,265; employer 894 + 78 + 1,428 + 594 + 35 = 3,029.'
		],
		period: '2026-03',
		people: [
			citizen(
				'chiang',
				'Chiang Ya-wen',
				9000,
				{ LI: 11_100, EI: 11_100, NHI: 29_500, LABOR_PENSION: 9900, OCC_INJURY: 29_500 },
				{
					gender: 'FEMALE',
					terms: { employment_type: 'PART_TIME', ordinary_hours_per_week: 12 }
				}
			)
		],
		expected: {
			chiang: {
				gross: 9000,
				net: 8265,
				employer_cost: 3029,
				'LI.employee': 255,
				'LI.employer': 894,
				'EI.employee': 22,
				'EI.employer': 78,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 594,
				'OCC_INJURY.employer': 35
			}
		}
	}),
	tw({
		id: 'TW-LI-04-1',
		description:
			'A part-timer (36 h/week) at NT$28,000 insures 勞保/就保/勞退 on the 115年 28,590 grade; 災保 and 健保 have nothing below 29,500.',
		citation: [
			...EVERY,
			'Floor 29,500 × 36/40 = 26,550 < 28,000. 28,590 (27,601–28,590): 勞保 3,287.85 → 657.57 → 658 / 2,301.50 → 2,301 (2,301.495); 就保 57.18 → 57 / 200.13 → 200; 勞退 1,715.40 → 1,715. 健保 458 / 1,428; 災保 35.',
			'Net 28,000 − (658 + 57 + 458) = 26,827; employer 2,301 + 200 + 1,428 + 1,715 + 35 = 5,679.'
		],
		period: '2026-03',
		people: [
			citizen(
				'tseng',
				'Tseng Po-yu',
				28_000,
				{ LI: 28_590, EI: 28_590, NHI: 29_500, LABOR_PENSION: 28_590, OCC_INJURY: 29_500 },
				{
					terms: { employment_type: 'PART_TIME', ordinary_hours_per_week: 36 }
				}
			)
		],
		expected: {
			tseng: {
				gross: 28_000,
				net: 26_827,
				employer_cost: 5679,
				'LI.employee': 658,
				'LI.employer': 2301,
				'EI.employee': 57,
				'EI.employer': 200,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 1715,
				'OCC_INJURY.employer': 35
			}
		}
	}),
	tw({
		id: 'TW-PEN-07-1',
		description:
			'A part-timer (36 h/week) at NT$29,000, above 28,590 but below the minimum wage: 勞保 must use 第1級 29,500 and 勞退 its grade 25, 29,500.',
		citation: [
			...EVERY,
			'投保薪資分級表 備註二 (https://www.bli.gov.tw/Files/25661): 薪資總額超過 28,590 元而未達最低工資者，應依本表第一級申報; 勞退 grade 25: 28,591–29,500 → 29,500 (https://www.bli.gov.tw/Files/25709).',
			'29,500 grades: 679 / 2,375, 59 / 207, 458 / 1,428, 勞退 1,770, 災保 35. Net 29,000 − 1,196 = 27,804; employer 5,815.'
		],
		period: '2026-03',
		people: [
			citizen('yeh', 'Yeh Chia-jung', 29_000, all(29_500), {
				gender: 'FEMALE',
				terms: { employment_type: 'PART_TIME', ordinary_hours_per_week: 36 }
			})
		],
		expected: {
			yeh: {
				gross: 29_000,
				net: 27_804,
				employer_cost: 5815,
				'LI.employee': 679,
				'LI.employer': 2375,
				'EI.employee': 59,
				'EI.employer': 207,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 1770,
				'OCC_INJURY.employer': 35
			}
		}
	}),

	// ── Part months: joiners, leavers, a raise ─────────────────────────────────────────────────────
	tw({
		id: 'TW-WAGE-05-1',
		description:
			'A joiner on 16 March 2026 at NT$45,000: sixteen days of salary on the 30-day divisor, fifteen insured days, and a whole month of 健保.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'勞動部 月薪制勞工的權益 (https://www.mol.gov.tw/1607/28162/28166/28180/28182/28188/29026/): a part month of a monthly wage is paid by day at 月薪 ÷ 30 — 16 days × 1,500 = 24,000.',
			'Insured days 16–30 = 15: 勞保 45,800: 526.70 → 527 / 1,843.45 → 1,843; 就保 45.80 → 46 / 160.30 → 160; 勞退 2,748 × 15/30 = 1,374; 災保 54.96 × ½ = 27.48 → 27. 健保 (§30(2), insured at month end): 710 / 2,216.',
			'5% × 24,000 = 1,200, not over 2,000. Net 24,000 − (527 + 46 + 710) = 22,717; employer 5,620.'
		],
		period: '2026-03',
		people: [
			citizen('lee', 'Lee Kuan-ting', 45_000, all(45_800), { hired: '2026-03-16', tax: FIVE })
		],
		expected: {
			lee: {
				gross: 24_000,
				net: 22_717,
				employer_cost: 5620,
				'LI.employee': 527,
				'LI.employer': 1843,
				'EI.employee': 46,
				'EI.employer': 160,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 1374,
				'OCC_INJURY.employer': 27
			}
		}
	}),
	tw({
		id: 'TW-WAGE-01-1',
		description:
			'A joiner on 31 March 2026 at NT$36,000 is paid that day (1,200) and insured for one day; 健保 is the whole month.',
		citation: [
			...EVERY,
			'勞動基準法 §22(2): 工資應全額直接給付勞工. One day × 36,000 ÷ 30 = 1,200. BLI: 30日或31日加保者 當月保險費均為1天 (https://www.bli.gov.tw/0014162.htm).',
			'36,300 × 1/30: 勞保 834.90/30 = 27.83 → 28; 2,922.15/30 = 97.41 → 97; 就保 2.42 → 2; 8.47 → 8; 勞退 2,178/30 = 72.60 → 73; 災保 1.45 → 1. 健保 563 / 1,757.',
			'Net 1,200 − (28 + 2 + 563) = 607; employer 97 + 8 + 1,757 + 73 + 1 = 1,936.'
		],
		period: '2026-03',
		people: [citizen('lo', 'Lo Shih-wei', 36_000, all(36_300), { hired: '2026-03-31' })],
		expected: {
			lo: {
				gross: 1200,
				net: 607,
				employer_cost: 1936,
				BASIC: 1200,
				'LI.employee': 28,
				'LI.employer': 97,
				'EI.employee': 2,
				'EI.employer': 8,
				'NHI.employee': 563,
				'NHI.employer': 1757,
				'LABOR_PENSION.employer': 73,
				'OCC_INJURY.employer': 1
			}
		}
	}),
	tw({
		id: 'TW-NHI-10-1',
		description:
			'A raise from NT$40,000 to 48,000 on 16 March 2026: each rate takes its calendar share; every insured grade stays 40,100 until the notified adjustment takes effect the next month.',
		citation: [
			...EVERY,
			'Owner rule 2026-09-28 (law silent on a mid-month rate change): each rate is paid for its calendar share of the month — 40,000 × 15/31 = 19,354.84 and 48,000 × 16/31 = 24,774.19, 44,129.03. A whole month of service is one month’s pay whatever its length, so the shares sum to one; only a part month of service is paid by the day at 月薪 ÷ 30 (TW-WAGE-05-1). Recorded in tracker TW-WAGE-05.',
			'勞工保險條例 §14(2), 勞工退休金條例 §15(2) and NHIA (https://www.nhi.gov.tw/ch/cp-3204-6ecca-2568-1.html): an adjusted insured amount takes effect from the first of the month after notification — March stays on 40,100: 922 / 3,228, 80 / 281, 622 / 1,940, 2,406, 48.',
			'The table withholds nothing. Net 44,129.03 − (922 + 80 + 622) = 42,505.03; employer 7,903.'
		],
		period: '2026-03',
		people: [
			citizen('chu', 'Chu Hao-ran', 40_000, all(40_100), {
				termsRows: [
					{ base_salary: 40_000, effective_range: { from: '2024-02-01', to: '2026-03-15' } },
					{ base_salary: 48_000, effective_range: { from: '2026-03-16', to: null } }
				]
			})
		],
		expected: {
			chu: {
				gross: 44_129.03,
				net: 42_505.03,
				employer_cost: 7903,
				'LI.employee': 922,
				'LI.employer': 3228,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			}
		}
	}),
	tw({
		id: 'TW-LI-02-1',
		description:
			'A leaver on 28 February 2026 at NT$40,000: 勞保, 就保 and 災保 charge 28 insured days; 勞退 is a whole month; 健保 is charged (insured at month end).',
		citation: [
			...EVERY,
			'BLI: 保險費計算…至退保當日為止 — 1–28 February is 28 days of the 30-day month (https://www.bli.gov.tw/0014162.htm). BLI FAQ 9 (https://www.bli.gov.tw/0017599.html): 全月提繳 = 月提繳工資 × 提繳率 — a worker in service the whole of February is a whole pension month.',
			'40,100 × 28/30: 勞保 922.30 → 860.81 → 861; 3,228.05 → 3,012.85 → 3,013; 就保 74.85 → 75; 261.99 → 262; 災保 48.12 → 44.91 → 45. 勞退 2,406. 健保 (退保 on 1 March) 622 / 1,940.',
			'Net 40,000 − (861 + 75 + 622) = 38,442; employer 3,013 + 262 + 1,940 + 2,406 + 45 = 7,666.'
		],
		period: '2026-02',
		people: [
			citizen('tu', 'Tu Chih-wei', 40_000, all(40_100), {
				left: '2026-02-28',
				exit_reason: 'RESIGNATION',
				exit_facts: { lsa_termination_ground: 'OTHER' }
			})
		],
		expected: {
			tu: {
				gross: 40_000,
				net: 38_442,
				employer_cost: 7666,
				'LI.employee': 861,
				'LI.employer': 3013,
				'EI.employee': 75,
				'EI.employer': 262,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 45
			}
		}
	}),
	tw({
		id: 'TW-PEN-03-1',
		description:
			'The same last-day February exit on NT$36,000: a whole 勞退 month (2,178) beside 28 days of 勞保.',
		citation: [
			...EVERY,
			'As TW-LI-02-1. 36,300 × 28/30: 勞保 834.90 → 779.24 → 779; 2,922.15 → 2,727.34 → 2,727; 就保 67.76 → 68; 237.16 → 237; 災保 43.56 → 40.66 → 41. 勞退 2,178. 健保 563 / 1,757.',
			'Net 36,000 − (779 + 68 + 563) = 34,590; employer 2,727 + 237 + 1,757 + 2,178 + 41 = 6,940.'
		],
		period: '2026-02',
		people: [
			citizen('fang', 'Fang Li-hua', 36_000, all(36_300), {
				gender: 'FEMALE',
				left: '2026-02-28',
				exit_reason: 'RESIGNATION',
				exit_facts: { lsa_termination_ground: 'OTHER' }
			})
		],
		expected: {
			fang: {
				gross: 36_000,
				net: 34_590,
				employer_cost: 6940,
				'LI.employee': 779,
				'LI.employer': 2727,
				'EI.employee': 68,
				'EI.employer': 237,
				'NHI.employee': 563,
				'NHI.employer': 1757,
				'LABOR_PENSION.employer': 2178,
				'OCC_INJURY.employer': 41
			}
		}
	}),
	tw({
		id: 'TW-EXIT-04-1',
		description:
			'A resignation on 20 March 2026 at NT$36,000: twenty days’ final wages, twenty insured days, no 健保 for the withdrawal month.',
		citation: [
			...EVERY,
			'勞動基準法施行細則 §9: 終止勞動契約時，雇主應即結清工資給付勞工 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030002). 20 × 1,200 = 24,000.',
			'36,300 × 20/30: 勞保 556.60 → 557; 1,948.10 → 1,948; 就保 48.40 → 48; 169.40 → 169; 勞退 1,452; 災保 29.04 → 29. 健保法 §30(2): 退保當月免繳.',
			'5% × 24,000 = 1,200 → 0. Net 24,000 − (557 + 48) = 23,395; employer 1,948 + 169 + 1,452 + 29 = 3,598.'
		],
		period: '2026-03',
		people: [
			citizen('shih', 'Shih Kai-lun', 36_000, all(36_300), {
				tax: FIVE,
				left: '2026-03-20',
				exit_reason: 'RESIGNATION',
				exit_facts: { lsa_termination_ground: 'OTHER' }
			})
		],
		// 施行細則 §9 settles on the last day; the March run pays on the month end, so the run says it is late.
		warnings: [
			'^FINAL_PAY_LATE: P-SHIH left on 2026-03-20; .*by 2026-03-20, and this run pays on 2026-03-31'
		],
		expected: {
			shih: {
				gross: 24_000,
				net: 23_395,
				employer_cost: 3598,
				'LI.employee': 557,
				'LI.employer': 1948,
				'EI.employee': 48,
				'EI.employer': 169,
				'LABOR_PENSION.employer': 1452,
				'OCC_INJURY.employer': 29
			}
		}
	}),

	// ── Leave ──────────────────────────────────────────────────────────────────────────────────────
	tw({
		id: 'TW-LEAVE-01-1',
		description:
			'A resignation on 31 March 2026 at NT$60,000 with five unused 特別休假 days paid at February’s normal wage ÷ 30; still insured at month end, so a whole month everywhere.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			`${SRC.lsa} §38(4): 特別休假 因…契約終止而未休之日數，雇主應發給工資; 勞動基準法施行細則 §24-1(2)(1)(2): 計月者 為…契約終止前最近一個月正常工作時間所得之工資除以三十 — February 60,000 ÷ 30 × 5 = 10,000 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=24-1).`,
			'財政部高雄國稅局 2019-12-30 news release on the MOF portal, 未休完特別休假日折發之不休假加班費，不超過規定標準者免計入薪資所得課稅 (https://www.mof.gov.tw/singlehtml/384fb3077bb349ea973e7fc6f13b6974?cntId=a7d14ce02a444dd4a09af3efc0a524d1; read via web.archive.org 2020-09-26 capture, the live page redirects): 勞工在年度終結或契約終止時未休完特別休假之所有日數，雇主應發給工資，該不休假獎金屬加班費的一種 … 免計入薪資所得課稅, within 財政部 74-05-29 台財稅第16713號 (所得稅法 §14(1) 第三類 (四)); 高雄國稅局 Q&A 員工領取不休假加班費，需要辦理扣繳嗎？ (https://www.ntbk.gov.tw/singlehtml/8edee6a2f90d4254a5e8d38c1db38137?cntId=4cb256a9677b4f0ba2812d1e3f542213): exempt where the days are within §38 and the pay within the §39 standard. Here 5 days ≤ the §38(1)(3) 10 days for 2–3 years’ service, at the §24-1 rate, so the 5% is on the salary alone: 3,000.',
			'Exit on the 31st: 30 insured days. 勞保/就保 ceiling; 健保 60,800: 943 / 2,942; 勞退 3,648; 災保 72.96 → 73.',
			'Net 70,000 − (1,053 + 92 + 943 + 3,000) = 64,912; employer 3,687 + 321 + 2,942 + 3,648 + 73 = 10,671.'
		],
		period: '2026-03',
		people: [
			citizen('kang', 'Kang Wei-lun', 60_000, all(45_800, 60_800), {
				hired: '2024-01-02',
				tax: FIVE,
				left: '2026-03-31',
				exit_reason: 'RESIGNATION',
				exit_facts: { lsa_termination_ground: 'OTHER' }
			})
		],
		extra: (job) => [
			wageMonth(job('kang'), '2026-02', '2026-02-28', 60_000),
			leave(job('kang'), 'ANNUAL_LEAVE', 'EXIT-TW-KANG', '2026-01-01', '2026-12-31', {
				days: 5,
				encash_days: 5,
				effective_on: '2026-03-31',
				due_on: '2026-03-31'
			})
		],
		expected: {
			kang: {
				gross: 70_000,
				net: 64_912,
				employer_cost: 10_671,
				ANNUAL_LEAVE_ENCASHMENT: 10_000,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 943,
				'NHI.employer': 2942,
				'LABOR_PENSION.employer': 3648,
				'OCC_INJURY.employer': 73,
				'INCOME_TAX.employee': 3000
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-02-1',
		description:
			'Two 普通傷病假 days (10–11 March) at half wage: 2 × 1,200 × ½ = 1,200 off NT$36,000.',
		citation: [
			...EVERY,
			'勞工請假規則 §4(3): 普通傷病假一年內未超過三十日部分，工資折半發給 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030006&flno=4). Day wage 36,000 ÷ 30 = 1,200.',
			'Grades unchanged by leave (36,300): 835 / 2,922, 73 / 254, 563 / 1,757, 2,178, 44. Net 34,800 − 1,471 = 33,329; employer 7,155.'
		],
		period: '2026-03',
		people: [citizen('chao', 'Chao Mei-hua', 36_000, all(36_300), { gender: 'FEMALE' })],
		extra: (job) => [leave(job('chao'), 'SICK_LEAVE', 'SICK-TW-CHAO', '2026-03-10', '2026-03-11')],
		expected: {
			chao: {
				gross: 34_800,
				net: 33_329,
				employer_cost: 7155,
				'LI.employee': 835,
				'LI.employer': 2922,
				'EI.employee': 73,
				'EI.employer': 254,
				'NHI.employee': 563,
				'NHI.employer': 1757,
				'LABOR_PENSION.employer': 2178,
				'OCC_INJURY.employer': 44
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-03-1',
		description:
			'Three unpaid 事假 days (3–5 March) on NT$45,000: 3 × 1,500 = 4,500 off; the insured grade is unchanged.',
		citation: [
			...EVERY,
			'勞工請假規則 §7(1): 事假…一年內合計不得超過十四日。事假期間不給工資 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030006&flno=7). Day wage 45,000 ÷ 30 = 1,500.',
			'45,800: 1,053 / 3,687, 92 / 321, 710 / 2,216, 勞退 2,748, 災保 55. Net 40,500 − 1,855 = 38,645; employer 9,027.'
		],
		period: '2026-03',
		people: [citizen('hung', 'Hung Chia-hao', 45_000, all(45_800))],
		extra: (job) => [
			leave(job('hung'), 'PERSONAL_LEAVE', 'NPL-TW-HUNG', '2026-03-03', '2026-03-05')
		],
		expected: {
			hung: {
				gross: 40_500,
				net: 38_645,
				employer_cost: 9027,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 2748,
				'OCC_INJURY.employer': 55
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-05-1',
		description: 'One 生理假 day on NT$36,000 is paid at half wage: 600 off.',
		citation: [
			...EVERY,
			'性別平等工作法 §14: 生理假…其併入及不併入病假之生理假薪資，減半發給 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014). ½ × 1,200 = 600.',
			'36,300 grades as TW-LEAVE-02-1. Net 35,400 − 1,471 = 33,929; employer 7,155.'
		],
		period: '2026-03',
		people: [citizen('tang', 'Tang Hsiao-ping', 36_000, all(36_300), { gender: 'FEMALE' })],
		extra: (job) => [
			leave(job('tang'), 'MENSTRUAL_LEAVE', 'MENS-TW-TANG', '2026-03-10', '2026-03-10')
		],
		expected: {
			tang: {
				gross: 35_400,
				net: 33_929,
				employer_cost: 7155,
				'LI.employee': 835,
				'LI.employer': 2922,
				'EI.employee': 73,
				'EI.employer': 254,
				'NHI.employee': 563,
				'NHI.employer': 1757,
				'LABOR_PENSION.employer': 2178,
				'OCC_INJURY.employer': 44
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-06-1',
		description:
			'A whole March on 育嬰留職停薪: no wage, 勞保/就保/健保 continued with the employer share waived and the worker billed by the insurers, 災保 and 勞退 stopped — nothing on the payslip.',
		citation: [
			'性別平等工作法 §16(1)–(2): 育嬰留職停薪 is unpaid; 得繼續參加原有之社會保險，原由雇主負擔之保險費，免予繳納；原由受僱者負擔之保險費，得遞延三年繳納 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014)',
			'BLI (https://www.bli.gov.tw/0006915.html): 育嬰留職停薪續保 只參加勞工保險及就業保險，並不包括勞工職業災害保險; 勞工退休金條例 §20(1): 留職停薪 停止提繳 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020)',
			'Gross 0, net 0, employer cost 0; no statutory line through payroll.'
		],
		period: '2026-03',
		people: [
			citizen('yen', 'Yen Shu-ting', 45_000, all(45_800), {
				gender: 'FEMALE',
				hired: '2023-06-01',
				standing: {
					LI: [
						['2023-06-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'REGISTERED', elections: { parental_leave: 'DEFERRED' } }]
					],
					EI: [
						['2023-06-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'REGISTERED', elections: { parental_leave: 'DEFERRED' } }]
					],
					NHI: [
						['2023-06-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'REGISTERED', elections: { parental_leave: 'DEFERRED' } }]
					],
					OCC_INJURY: [
						['2023-06-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'NOT_REGISTERED', reason: '育嬰留職停薪: 災保 withdrawn' }]
					],
					LABOR_PENSION: [
						['2023-06-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'NOT_REGISTERED', reason: '育嬰留職停薪: 勞退 停止提繳' }]
					]
				}
			})
		],
		extra: (job) => [
			leave(job('yen'), 'PARENTAL_LEAVE', 'PARENTAL-TW-YEN', '2026-03-01', '2026-03-31')
		],
		expected: { yen: { gross: 0, net: 0, employer_cost: 0 } }
	}),
	tw({
		id: 'TW-PEN-08-1',
		description:
			'A worker with a 6% voluntary pension goes on 育嬰留職停薪 for the whole of March: both the unit’s and the worker’s 勞退 stop, and nothing is charged.',
		citation: [
			'勞工退休金條例 §20(1): 勞工留職停薪…雇主應於發生事由之日起七日內以書面向勞保局申報停止提繳其退休金 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020)',
			'性別平等工作法 §16(2) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014); BLI (https://www.bli.gov.tw/0006915.html): continued cover is 勞保 and 就保 only.',
			'Gross 0, net 0, employer cost 0.'
		],
		period: '2026-03',
		people: [
			citizen('hsieh', 'Hsieh Chun-hung', 52_000, all(45_800, 53_000), {
				hired: '2022-09-01',
				elections: { LABOR_PENSION: { voluntary_rate: 6 } },
				standing: {
					LI: [
						['2022-09-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'REGISTERED', elections: { parental_leave: 'CONTINUED' } }]
					],
					EI: [
						['2022-09-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'REGISTERED', elections: { parental_leave: 'CONTINUED' } }]
					],
					NHI: [
						['2022-09-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'REGISTERED', elections: { parental_leave: 'CONTINUED' } }]
					],
					OCC_INJURY: [
						['2022-09-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'NOT_REGISTERED', reason: '育嬰留職停薪: 災保 withdrawn' }]
					],
					LABOR_PENSION: [
						['2022-09-01', '2026-02-28', { kind: 'REGISTERED' }],
						['2026-03-01', null, { kind: 'NOT_REGISTERED', reason: '育嬰留職停薪: 勞退 停止提繳' }]
					]
				}
			})
		],
		extra: (job) => [
			leave(job('hsieh'), 'PARENTAL_LEAVE', 'PARENTAL-TW-HSIEH', '2026-03-01', '2026-03-31')
		],
		expected: { hsieh: { gross: 0, net: 0, employer_cost: 0 } }
	}),
	tw({
		id: 'TW-EXIT-05-1',
		description:
			'Five days of 公傷病假 (9–13 March) keep the 原領工資 whole: NT$40,000 is paid in full.',
		citation: [
			...EVERY,
			`${SRC.lsa} §59(2): 勞工在醫療中不能工作時，雇主應按其原領工資數額予以補償; 勞動基準法施行細則 §31: 原領工資 for a monthly worker is the last month’s normal-hours wage ÷ 30 a day — so no day is deducted.`,
			'40,100: 922 / 3,228, 80 / 281, 622 / 1,940, 2,406, 48. Net 40,000 − 1,624 = 38,376; employer 7,903.'
		],
		period: '2026-03',
		people: [citizen('sung', 'Sung Chih-kang', 40_000, all(40_100))],
		extra: (job) => [
			leave(job('sung'), 'OCCUPATIONAL_INJURY_LEAVE', 'OCC-TW-SUNG', '2026-03-09', '2026-03-13')
		],
		expected: {
			sung: {
				gross: 40_000,
				net: 38_376,
				employer_cost: 7903,
				'LI.employee': 922,
				'LI.employer': 3228,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			}
		}
	}),

	// ── Overtime and holiday work ──────────────────────────────────────────────────────────────────
	tw({
		id: 'TW-HOURS-01-1',
		description:
			'Four continuous hours on the 休息日 (Saturday 7 March, 09:00–13:00, no break owed): 2 h at 1⅓ and 2 h at 1⅔ extra on NT$200 an hour; outside the 5% base.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			`${SRC.lsa} §24(2): 休息日工作 二小時以內 按平日每小時工資額另再加給一又三分之一以上，二小時後再繼續工作者 另再加給一又三分之二以上; §35: 繼續工作四小時，至少應有三十分鐘之休息 — owed after four hours, so four exactly owe none.`,
			'時薪 48,000 ÷ 30 ÷ 8 = 200: 2 × 200 × 4/3 = 533.33; 2 × 200 × 5/3 = 666.67; 1,200 in all. 5% × 48,000 = 2,400.',
			'Grades as TW-LI-01-1. Net 49,200 − 4,293 = 44,907; employer 9,290.'
		],
		period: '2026-03',
		people: [citizen('liang', 'Liang Tzu-yang', 48_000, all(45_800, 48_200), { tax: FIVE })],
		extra: (job) => [asked(worked(job('liang'), '2026-03-07', ['09:00', '13:00']), 4)],
		expected: {
			liang: {
				gross: 49_200,
				net: 44_907,
				employer_cost: 9290,
				// the run's one Work line for the day's overtime; its bands (533.33 + 666.67) are its label
				OVERTIME: 1200,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 748,
				'NHI.employer': 2332,
				'LABOR_PENSION.employer': 2892,
				'OCC_INJURY.employer': 58,
				'INCOME_TAX.employee': 2400
			}
		}
	}),
	tw({
		id: 'TW-HOURS-02-1',
		description:
			'January 2026 on NT$54,000 (225 an hour): three extended hours on Monday 5 January and a full day worked on 1 January (開國紀念日), which §39 doubles.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			`${SRC.lsa} §24(1): 延長工作時間在二小時以內者 加給三分之一以上, 再延長二小時以內 加給三分之二以上: 2 × 225 × 4/3 = 600, 1 × 225 × 5/3 = 375. §39: 雇主經徵得勞工同意於休假日工作者，工資應加倍發給 — a further day’s wage, 54,000 ÷ 30 = 1,800.`,
			'紀念日及節日實施條例 §3(1), §4(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095): 中華民國開國紀念日 一月一日 放假一日 — a 勞動基準法 §37 休假.',
			'5% × 54,000 = 2,700 (overtime and holiday pay within the standard are not 薪資收入). 55,400: 勞保 ceiling; 健保 859 / 2,681; 勞退 3,324; 災保 66.48 → 66.',
			'Gross 54,000 + 600 + 375 + 1,800 = 56,775; net 56,775 − (1,053 + 92 + 859 + 2,700) = 52,071; employer 3,687 + 321 + 2,681 + 3,324 + 66 = 10,079.'
		],
		period: '2026-01',
		people: [citizen('tsao', 'Tsao Yi-fan', 54_000, all(45_800, 55_400), { tax: FIVE })],
		extra: (job) => [
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-01-01',
					name: '中華民國開國紀念日',
					kind: 'PUBLIC_HOLIDAY',
					published_at: '2025-12-01T00:00:00.000Z'
				}
			},
			asked(worked(job('tsao'), '2026-01-01', ['09:00', '12:00'], ['13:00', '18:00']), 8),
			asked(worked(job('tsao'), '2026-01-05', ['09:00', '12:00'], ['13:00', '21:00']), 3)
		],
		expected: {
			tsao: {
				gross: 56_775,
				net: 52_071,
				employer_cost: 10_079,
				// the run's one Work line for overtime and holiday work: 1,800 + 600 + 375
				OVERTIME: 2775,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 859,
				'NHI.employer': 2681,
				'LABOR_PENSION.employer': 3324,
				'OCC_INJURY.employer': 66,
				'INCOME_TAX.employee': 2700
			}
		}
	}),

	// ── Severance, notice, retirement, old pension system ──────────────────────────────────────────
	tw({
		id: 'TW-EXIT-02-1',
		description:
			'A §11 layoff on 15 March 2026 after exactly three new-system years at NT$45,000: 15 days’ final wages, three unused 特別休假 days, 1.5 months of 平均工資 as 資遣費, notice served in full.',
		citation: [
			...EVERY,
			`${SRC.lsa} §2(4): 平均工資 = 當日前六個月內所得工資總額 ÷ 該期間之總日數 — 15 Sep 2025–14 Mar 2026, 181 days, 270,000 (Sep 16 × 1,500 + 5 × 45,000 + 14 × 1,500): 270,000 ÷ 181, declared on the departure; the version counts a month of it as 30 days.`,
			'勞工退休金條例 §12(1): 每滿一年發給二分之一個月之平均工資 — 0.5 × 3 = 1.5 months: 270,000 ÷ 181 × 30 × 1.5 = 67,127.07 → 67,127 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020).',
			`${SRC.lsa} §16(1)(3): three years or more owe 30 days’ notice; 30 were given, so no notice pay. §38(4) with 施行細則 §24-1: February 45,000 ÷ 30 × 3 = 4,500.`,
			'所得稅法 §14(1) 第九類 with 財政部 115年度 退職所得 amounts (https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/taxation-scope/which-income/O9EmLJZ): 206,000 × 3 = 618,000 exempt ≥ 67,127 → no withholding. 5% × 22,500 = 1,125 → 0.',
			'15 insured days on 45,800: 527 / 1,843, 46 / 160, 勞退 1,374, 災保 27. 健保法 §30(2): none.',
			'Gross 22,500 + 4,500 + 67,127 = 94,127; net 94,127 − (527 + 46) = 93,554; employer 1,843 + 160 + 1,374 + 27 = 3,404.'
		],
		period: '2026-03',
		people: [
			citizen('lien', 'Lien Hsiu-ying', 45_000, all(45_800), {
				gender: 'FEMALE',
				hired: '2023-03-16',
				tax: FIVE,
				left: '2026-03-15',
				exit_reason: 'REDUNDANCY',
				exit_facts: { ...NOTICE, average_daily_wage: 270_000 / 181, old_system_service_months: 0 }
			})
		],
		extra: (job) => [
			wageMonth(job('lien'), '2026-02', '2026-02-28', 45_000),
			leave(job('lien'), 'ANNUAL_LEAVE', 'EXIT-TW-LIEN', '2026-01-01', '2026-12-31', {
				days: 3,
				encash_days: 3,
				effective_on: '2026-03-15',
				due_on: '2026-03-15'
			}),
			adhoc(job('lien'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			lien: {
				gross: 94_127,
				net: 93_554,
				employer_cost: 3404,
				ANNUAL_LEAVE_ENCASHMENT: 4500,
				SEVERANCE_PAY: 67_127,
				'LI.employee': 527,
				'LI.employer': 1843,
				'EI.employee': 46,
				'EI.employer': 160,
				'LABOR_PENSION.employer': 1374,
				'OCC_INJURY.employer': 27
			}
		}
	}),
	tw({
		id: 'TW-EXIT-01-1',
		description:
			'A §11 layoff on 15 March 2026 after two years, with 5 of the 20 notice days given: 15 days’ notice pay at the last day wage beside one month’s 資遣費.',
		citation: [
			...EVERY,
			`${SRC.lsa} §16(1)(2): 繼續工作一年以上三年未滿者，於二十日前預告之; §16(3): 未依第一項規定期間預告而終止契約者，應給付預告期間之工資 — 15 days × 36,000 ÷ 30 = 18,000 (the day wage 1,200 is above the 平均工資 1,193.37).`,
			'勞工退休金條例 §12(1): 0.5 × 2 years = 1 month × 216,000 ÷ 181 × 30 = 35,801.10. The one line: 35,801.10 + 18,000 = 53,801.10 → 53,801 (law silent on rounding; the tracker default rounds the one 退職所得 amount to the 元 once, TW-EXIT-01).',
			'財政部 83-08-09 台財稅第831604301號 (https://law-out.mof.gov.tw/LawContent.aspx?id=GL006450): 依勞動基準法第16條第3項規定給付勞工預告期間之工資，兼具資遣費性質 — the notice pay is 退職所得 (所得稅法 §14(1) 第九類) with the 資遣費, so both sit on the one SEVERANCE_PAY line: 206,000 × 2 = 412,000 exempt → no withholding.',
			'The separate 18,000 is the 15 days actually worked, 1–15 March (15 × 1,200), 薪資所得: 5% × 18,000 = 900, not over 2,000 → 0.',
			'15 insured days on 36,300: 勞保 417.45 → 417; 1,461.08 → 1,461; 就保 36.30 → 36; 127.05 → 127; 勞退 1,089; 災保 21.78 → 22.',
			'Gross 18,000 + 53,801 = 71,801; net 71,801 − (417 + 36) = 71,348; employer 1,461 + 127 + 1,089 + 22 = 2,699.'
		],
		period: '2026-03',
		people: [
			citizen('tsou', 'Tsou Ming-che', 36_000, all(36_300), {
				hired: '2024-03-16',
				tax: FIVE,
				left: '2026-03-15',
				exit_reason: 'REDUNDANCY',
				exit_facts: {
					lsa_termination_ground: 'ARTICLE_11',
					notice_days_given: 5,
					average_daily_wage: 216_000 / 181,
					old_system_service_months: 0
				}
			})
		],
		extra: (job) => [
			adhoc(job('tsou'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			tsou: {
				gross: 71_801,
				net: 71_348,
				employer_cost: 2699,
				SEVERANCE_PAY: 53_801,
				'LI.employee': 417,
				'LI.employer': 1461,
				'EI.employee': 36,
				'EI.employer': 127,
				'LABOR_PENSION.employer': 1089,
				'OCC_INJURY.employer': 22
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-08-1',
		description:
			'A §11 layoff on 15 March 2026 with 30 days’ notice: two paid job-search days (3–4 March) leave the wage whole; four years earn two months of 平均工資.',
		citation: [
			...EVERY,
			`${SRC.lsa} §16(2): 勞工於接到前項預告後，為另謀工作得於工作時間請假外出。其請假時數，每星期不得超過二日之工作時間，請假期間之工資照給.`,
			'勞工退休金條例 §12(1): 0.5 × 4 = 2 months; 平均工資 15 Sep 2025–14 Mar 2026: 240,000 ÷ 181: 240,000 ÷ 181 × 30 × 2 = 79,558.01 → 79,558.',
			'退職所得 206,000 × 4 exempt → no withholding. 15 days × 40,000 ÷ 30 = 20,000; 5% → 1,000 → 0.',
			'15 insured days on 40,100: 勞保 461.15 → 461; 1,614.03 → 1,614; 就保 40.10 → 40; 140.35 → 140; 勞退 1,203; 災保 24.06 → 24.',
			'Gross 99,558; net 99,558 − (461 + 40) = 99,057; employer 1,614 + 140 + 1,203 + 24 = 2,981.'
		],
		period: '2026-03',
		people: [
			citizen('pai', 'Pai Chia-ling', 40_000, all(40_100), {
				gender: 'FEMALE',
				hired: '2022-03-16',
				tax: FIVE,
				left: '2026-03-15',
				exit_reason: 'REDUNDANCY',
				exit_facts: { ...NOTICE, average_daily_wage: 240_000 / 181, old_system_service_months: 0 }
			})
		],
		extra: (job) => [
			leave(job('pai'), 'JOB_SEARCH_LEAVE', 'JOBSEARCH-TW-PAI', '2026-03-03', '2026-03-04'),
			adhoc(job('pai'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			pai: {
				gross: 99_558,
				net: 99_057,
				employer_cost: 2981,
				SEVERANCE_PAY: 79_558,
				'LI.employee': 461,
				'LI.employer': 1614,
				'EI.employee': 40,
				'EI.employer': 140,
				'LABOR_PENSION.employer': 1203,
				'OCC_INJURY.employer': 24
			}
		}
	}),
	tw({
		id: 'TW-TAX-03-1',
		description:
			'A §11 layoff on 15 March 2026 of a worker on the retained old system since 16 March 2004 at NT$300,000: 22 months’ 平均工資 under §17, withheld 6% on the half-taxable band of 退職所得.',
		citation: [
			...EVERY,
			`${SRC.lsa} §17(1): 每滿一年發給相當於一個月平均工資之資遣費 — 22 years; §2(4): 1,800,000 ÷ 181 × 30 × 22 = 6,563,535.91 → 6,563,536. 勞工退休金條例 §11(2) keeps old-system seniority under §17.`,
			'所得稅法 §14(1) 第九類 一 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340003&flno=14) with 115年 amounts 206,000 / 414,000 (財政部稅務入口網 Q&A, https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/taxation-scope/which-income/O9EmLJZ): 206,000 × 22 = 4,532,000 is 0; the rest, under 414,000 × 22, is half: 所得額 (6,563,536 − 4,532,000) ÷ 2 = 1,015,768.',
			'各類所得扣繳率標準 §2(9): 退職所得按給付額減除定額免稅後之餘額扣取百分之六 — MOF’s worked example withholds 6% of the 所得額 (8,000,000 over 20 years → 所得額 2,040,000 → 122,400, https://www.mof.gov.tw/singlehtml/384fb3077bb349ea973e7fc6f13b6974?cntId=3ba3b4157fb2402fa34d0bd892fe1f43): 1,015,768 × 6% = 60,946.08 → 60,946.',
			'勞動基準法 §56(1): old-system reserve at the approved 2% of the month’s wages: 150,000 × 2% = 3,000. 5% × 150,000 = 7,500.',
			'15 insured days: 勞保 527 / 1,843; 就保 46 / 160; 災保 72,800 × 0.12% × ½ = 43.68 → 44; no 勞退 (old system); no 健保 (§30(2)).',
			'Gross 150,000 + 6,563,536 = 6,713,536; net 6,713,536 − (527 + 46 + 7,500 + 60,946) = 6,644,517; employer 1,843 + 160 + 44 + 3,000 = 5,047.'
		],
		company: { facts: { pension_reserve_rate: 2 } },
		period: '2026-03',
		people: [
			citizen(
				'chung',
				'Chung Kuo-hua',
				300_000,
				{ LI: 45_800, EI: 45_800, NHI: 303_000, OCC_INJURY: 72_800 },
				{
					born: '1970-08-08',
					hired: '2004-03-16',
					tax: FIVE,
					left: '2026-03-15',
					exit_reason: 'REDUNDANCY',
					exit_facts: {
						...NOTICE,
						average_daily_wage: 1_800_000 / 181,
						old_system_service_months: 264
					},
					standing: { LABOR_PENSION: OLD_SYSTEM }
				}
			)
		],
		extra: (job) => [
			adhoc(job('chung'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			chung: {
				gross: 6_713_536,
				net: 6_644_517,
				employer_cost: 5047,
				SEVERANCE_PAY: 6_563_536,
				'LI.employee': 527,
				'LI.employer': 1843,
				'EI.employee': 46,
				'EI.employer': 160,
				'OCC_INJURY.employer': 44,
				'LABOR_PENSION_RESERVE.employer': 3000,
				'INCOME_TAX.employee': 7500,
				'SEVERANCE_TAX.employee': 60_946
			}
		}
	}),
	tw({
		id: 'TW-EXIT-06-1',
		description:
			'A §53(3) retirement on 15 March 2026 at 60 after 22 years and half a month on the old system: 37.5 bases of 平均工資.',
		citation: [
			...EVERY,
			`${SRC.lsa} §53(3): 工作十年以上年滿六十歲者 得自請退休; §55(1)(1): 每滿一年給與兩個基數，超過十五年之工作年資 每滿一年給與一個基數，最高 四十五個基數；未滿半年者以半年計 — 22 years and a part year = 22.5: 15 × 2 + 7.5 = 37.5; §55(2): 基數 is the 平均工資 at retirement.`,
			'§2(4): 270,000 ÷ 181 (15 Sep 2025–14 Mar 2026, as TW-EXIT-02-1) × 30 × 37.5 = 1,678,176.80 → 1,678,177.',
			'所得稅法 §14(1) 第九類: 206,000 × 22.5 = 4,635,000 exempt → no withholding. §56(1) reserve 2% × 22,500 = 450.',
			'15 insured days on 45,800: 527 / 1,843; 就保 (age 60) 46 / 160; 災保 27; no 勞退, no 健保.',
			'Gross 22,500 + 1,678,177 = 1,700,677; net 1,700,677 − 573 = 1,700,104; employer 1,843 + 160 + 27 + 450 = 2,480.'
		],
		company: { facts: { pension_reserve_rate: 2 } },
		period: '2026-03',
		people: [
			citizen(
				'kuan',
				'Kuan Te-ming',
				45_000,
				{ LI: 45_800, EI: 45_800, NHI: 45_800, OCC_INJURY: 45_800 },
				{
					born: '1966-03-01',
					hired: '2004-03-01',
					left: '2026-03-15',
					exit_reason: 'RETIREMENT',
					exit_facts: { average_daily_wage: 270_000 / 181, old_system_service_months: 264.5 },
					standing: { LABOR_PENSION: OLD_SYSTEM }
				}
			)
		],
		extra: (job) => [
			adhoc(
				job('kuan'),
				'RETIREMENT_PAY',
				0,
				'2026-03-15',
				'RETIREMENT_PAY on departure 2026-03-15'
			)
		],
		expected: {
			kuan: {
				gross: 1_700_677,
				net: 1_700_104,
				employer_cost: 2480,
				RETIREMENT_PAY: 1_678_177,
				'LI.employee': 527,
				'LI.employer': 1843,
				'EI.employee': 46,
				'EI.employer': 160,
				'OCC_INJURY.employer': 27,
				'LABOR_PENSION_RESERVE.employer': 450
			}
		}
	}),
	tw({
		id: 'TW-EXIT-03-1',
		description:
			'A citizen employed since 2004 who kept the old pension system: no 勞退 6%, and the unit funds its §56 reserve at an approved 2%.',
		citation: [
			...EVERY,
			'勞工退休金條例 §8, §9 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020): a worker employed before 1 July 2005 who continues at the same unit may keep the LSA system; 勞動基準法 §56(1): 雇主應依勞工每月薪資總額百分之二至百分之十五範圍內 按月提撥 — 50,000 × 2% = 1,000.',
			'50,600: 勞保/就保 ceiling; 健保 785 / 2,449; 災保 61. The table withholds nothing. Net 50,000 − 1,930 = 48,070; employer 3,687 + 321 + 2,449 + 61 + 1,000 = 7,518.'
		],
		company: { facts: { pension_reserve_rate: 2 } },
		period: '2026-03',
		people: [
			citizen(
				'ku',
				'Ku Wen-hsien',
				50_000,
				{ LI: 45_800, EI: 45_800, NHI: 50_600, OCC_INJURY: 50_600 },
				{
					born: '1975-11-20',
					hired: '2004-03-01',
					standing: { LABOR_PENSION: OLD_SYSTEM }
				}
			)
		],
		expected: {
			ku: {
				gross: 50_000,
				net: 48_070,
				employer_cost: 7518,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 785,
				'NHI.employer': 2449,
				'OCC_INJURY.employer': 61,
				'LABOR_PENSION_RESERVE.employer': 1000
			}
		}
	}),
	tw({
		id: 'TW-PEN-13-1',
		description:
			'The same retained old system at the 15% reserve ceiling on NT$40,000: 6,000 a month.',
		citation: [
			...EVERY,
			'勞動基準法 §56(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=56): 2%–15% of 每月薪資總額 — 40,000 × 15% = 6,000; 勞工退休金條例 §8–9 old-system retention.',
			'40,100: 922 / 3,228, 80 / 281, 622 / 1,940, 災保 48. Net 40,000 − 1,624 = 38,376; employer 3,228 + 281 + 1,940 + 48 + 6,000 = 11,497.'
		],
		company: { facts: { pension_reserve_rate: 15 } },
		period: '2026-03',
		people: [
			citizen(
				'mao',
				'Mao Hsin-yi',
				40_000,
				{ LI: 40_100, EI: 40_100, NHI: 40_100, OCC_INJURY: 40_100 },
				{
					gender: 'FEMALE',
					born: '1978-02-14',
					hired: '2005-01-03',
					standing: { LABOR_PENSION: OLD_SYSTEM }
				}
			)
		],
		expected: {
			mao: {
				gross: 40_000,
				net: 38_376,
				employer_cost: 11_497,
				'LI.employee': 922,
				'LI.employer': 3228,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'OCC_INJURY.employer': 48,
				'LABOR_PENSION_RESERVE.employer': 6000
			}
		}
	}),

	// ── Age, nationality and residency ─────────────────────────────────────────────────────────────
	tw({
		id: 'TW-SCOPE-02-1',
		description:
			'A worker aged 66 outside 勞保 and 就保 (both end at 65) stays compulsorily in 健保, 勞退 and 災保.',
		citation: [
			...EVERY,
			'勞工保險條例 §6(1): 年滿十五歲以上，六十五歲以下 compulsory (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050001); 就業保險法 §5(1): 年滿十五歲以上，六十五歲以下 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050021); 勞工職業災害保險及保護法 §6 has no upper age (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050031); 勞工退休金條例 §7 has none.',
			'40,100: 健保 622 / 1,940; 勞退 2,406; 災保 48. Net 40,000 − 622 = 39,378; employer 1,940 + 2,406 + 48 = 4,394.'
		],
		period: '2026-03',
		people: [
			citizen(
				'tsai2',
				'Tsai Chin-lung',
				40_000,
				{ NHI: 40_100, LABOR_PENSION: 40_100, OCC_INJURY: 40_100, WAGE_ARREARS_BASE: 40_100 },
				{
					born: '1959-06-01',
					hired: '2020-01-06',
					standing: {
						LI: {
							kind: 'NOT_REGISTERED',
							reason: 'Over 65: 勞保 not compulsory (勞工保險條例 §6)'
						},
						EI: { kind: 'NOT_REGISTERED', reason: 'Over 65: outside 就業保險法 §5' }
					}
				}
			)
		],
		expected: {
			tsai2: {
				gross: 40_000,
				net: 39_378,
				employer_cost: 4394,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			}
		}
	}),
	tw({
		id: 'TW-EI-03-1',
		description:
			'A four-person company with no 勞保 unit (公司 under five workers): no 勞保, but 就保 and 災保 remain compulsory.',
		citation: [
			...EVERY,
			'勞工保險條例 §6(1)(2), §8: a 公司、行號 is compulsory from five workers; below it 得 voluntarily insure (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050001). 就業保險法 §5 insures every eligible employee regardless of unit size; BLI (https://www.bli.gov.tw/0006442.html) enrols such a worker in 就保 alone. 災保法 §6 covers every employee.',
			'40,100: 就保 80 / 281; 健保 622 / 1,940; 勞退 2,406; 災保 48. Net 40,000 − 702 = 39,298; employer 4,675.'
		],
		company: {
			facts: {
				li_no_insurance_unit: true,
				li_unit_class: 'COMPANY_OR_SHOP',
				li_unit_evidence_reference: 'PROBE-BLI-UNIT-HISTORY-UNDER-FIVE'
			}
		},
		period: '2026-03',
		people: [
			citizen(
				'kan',
				'Kan Yu-chen',
				40_000,
				{
					EI: 40_100,
					NHI: 40_100,
					LABOR_PENSION: 40_100,
					OCC_INJURY: 40_100,
					WAGE_ARREARS_BASE: 40_100
				},
				{
					standing: {
						LI: {
							kind: 'NOT_REGISTERED',
							reason: 'Unit under five workers with no LI unit',
							declaration_reference: 'PROBE-BLI-UNIT-HISTORY-UNDER-FIVE'
						}
					}
				}
			)
		],
		expected: {
			kan: {
				gross: 40_000,
				net: 39_298,
				employer_cost: 4675,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			}
		}
	}),
	tw({
		id: 'TW-EI-02-1',
		description:
			'A permanent-resident foreign professional enters 就保 from 1 January 2026 with class and residence proof; 勞退 new system; tax resident on 5%.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'外國專業人才延攬及僱用法 §25 (https://theme.ndc.gov.tw/lawout/LawContent.aspx?id=GL000273) with 就業保險法施行細則 §8-1 (https://laws.mol.gov.tw/FLAW/FLAWDOC01.aspx?flno=8-1&id=FL023222) and BLI (https://www.bli.gov.tw/0109624.html): a foreign professional holding permanent residence is insured under 就保 from 115年1月1日.',
			'勞工退休金條例 §7(1): a permanent resident is on the new system. 45,800 / 60,800 grades as TW-LEAVE-01-1: net 60,000 − (1,053 + 92 + 943 + 3,000) = 54,912; employer 10,671.'
		],
		period: '2026-03',
		people: [
			citizen('smith', 'John Smith', 60_000, all(45_800, 60_800), {
				nationality: 'American',
				born: '1985-07-04',
				hired: '2019-09-02',
				tax: FIVE,
				terms: {
					residency_status: 'PERMANENT_RESIDENT',
					residency_since: '2024-05-01',
					pass_type: 'EMPLOYMENT_PASS'
				},
				elections: {
					EI: {
						eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
						eligibility_document_reference: 'PROBE-APRC-AND-PROFESSIONAL-PERMIT'
					}
				}
			})
		],
		expected: {
			smith: {
				gross: 60_000,
				net: 54_912,
				employer_cost: 10_671,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 943,
				'NHI.employer': 2942,
				'LABOR_PENSION.employer': 3648,
				'OCC_INJURY.employer': 73,
				'INCOME_TAX.employee': 3000
			}
		}
	}),
	tw({
		id: 'TW-PEN-02-1',
		description:
			'A non-PR foreign professional hired in 2026 is on the new 勞退 system; no 就保 without permanent residence; 5% as a tax resident.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'BLI 2026 notice (https://www.bli.gov.tw/0109916.html): 外國專業人才及外國特定專業人才，無論是否取得永久居留身分，自115年1月1日起適用勞退新制 (外國專業人才延攬及僱用法 §24, https://theme.ndc.gov.tw/lawout/LawContent.aspx?id=GL000273).',
			'就業保險法 §5(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050021): a foreigner without permanent residence or an ROC spouse is outside 就保.',
			'勞保 ceiling 1,053 / 3,687; 健保 80,200: 1,244 / 3,881; 勞退 80,200 × 6% = 4,812; 災保 72,800 → 87. 5% × 80,000 = 4,000.',
			'Net 80,000 − (1,053 + 1,244 + 4,000) = 73,703; employer 3,687 + 3,881 + 4,812 + 87 = 12,467.'
		],
		period: '2026-03',
		people: [
			citizen(
				'muller',
				'Anna Müller',
				80_000,
				{ LI: 45_800, NHI: 80_200, LABOR_PENSION: 80_200, OCC_INJURY: 72_800 },
				{
					gender: 'FEMALE',
					nationality: 'German',
					born: '1988-01-20',
					hired: '2026-01-05',
					tax: FIVE,
					terms: { residency_status: 'FOREIGNER', pass_type: 'EMPLOYMENT_PASS' },
					elections: { LABOR_PENSION: { professional_work_class: 'FOREIGN_PROFESSIONAL' } },
					standing: {
						EI: {
							kind: 'NOT_REGISTERED',
							reason: 'Foreigner without permanent residence: outside 就業保險法 §5',
							declaration_reference: 'PROBE-ARC-NO-APRC',
							elections: { foreign_worker_excluded: true }
						}
					}
				}
			)
		],
		expected: {
			muller: {
				gross: 80_000,
				net: 73_703,
				employer_cost: 12_467,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'NHI.employee': 1244,
				'NHI.employer': 3881,
				'LABOR_PENSION.employer': 4812,
				'OCC_INJURY.employer': 87,
				'INCOME_TAX.employee': 4000
			}
		}
	}),
	tw({
		id: 'TW-PEN-14-1',
		description:
			'A foreign professional already permanently resident and serving the unit before 8 February 2018, who elected the old system in writing on 1 June 2018: no 勞退 6%, the §56 reserve at 4%.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'BLI old/new pension transition guide §5 (https://www.bli.gov.tw/en/0010369.html): a foreign professional in service before 2018-02-08 and already a permanent resident could elect the LSA old system in writing before 2018-08-07; 勞動基準法 §56(1) reserve — 55,000 × 4% = 2,200.',
			'就保 as TW-EI-02-1. 55,400: 勞保/就保 ceiling; 健保 859 / 2,681; 災保 66.48 → 66. 5% × 55,000 = 2,750.',
			'Net 55,000 − (1,053 + 92 + 859 + 2,750) = 50,246; employer 3,687 + 321 + 2,681 + 66 + 2,200 = 8,955.'
		],
		company: { facts: { pension_reserve_rate: 4 } },
		period: '2026-03',
		people: [
			citizen(
				'tanaka',
				'Tanaka Hiroshi',
				55_000,
				{ LI: 45_800, EI: 45_800, NHI: 55_400, OCC_INJURY: 55_400 },
				{
					nationality: 'Japanese',
					born: '1980-10-10',
					hired: '2016-03-01',
					tax: FIVE,
					terms: {
						residency_status: 'PERMANENT_RESIDENT',
						residency_since: '2017-06-01',
						pass_type: 'EMPLOYMENT_PASS'
					},
					elections: {
						EI: {
							eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
							eligibility_document_reference: 'PROBE-APRC-AND-PROFESSIONAL-PERMIT'
						}
					},
					standing: {
						LABOR_PENSION: {
							kind: 'NOT_REGISTERED',
							reason: 'LSA old system elected in writing',
							declaration_reference: 'PROBE-WRITTEN-OLD-ELECTION-2018-06-01-SAME-UNIT',
							elections: {
								pr_old_transition_class: 'FOREIGN_PROFESSIONAL_2018',
								pr_old_election_on: '2018-06-01'
							}
						}
					}
				}
			)
		],
		expected: {
			tanaka: {
				gross: 55_000,
				net: 50_246,
				employer_cost: 8955,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 859,
				'NHI.employer': 2681,
				'OCC_INJURY.employer': 66,
				'LABOR_PENSION_RESERVE.employer': 2200,
				'INCOME_TAX.employee': 2750
			}
		}
	}),

	// ── Income tax ─────────────────────────────────────────────────────────────────────────────────
	tw({
		id: 'TW-TAX-01-1',
		description:
			'The resident table: NT$95,000 with no dependant withholds its cell 2,220; NT$100,000 with one withholds 2,050.',
		citation: [
			...EVERY,
			SRC.table,
			'95,000: 健保 96,600: 1,498 / 4,675; 勞退 96,600 × 6% = 5,796; 災保 72,800 → 87. Net 95,000 − (1,053 + 92 + 1,498 + 2,220) = 90,137; employer 14,566.',
			'100,000, one dependant (also enrolled in 健保): 健保 101,100 本人+1眷口 3,136 / 4,892; 勞退 6,066. Net 100,000 − (1,053 + 92 + 3,136 + 2,050) = 93,669; employer 15,053.'
		],
		period: '2026-03',
		people: [
			citizen('chien', 'Chien Po-han', 95_000, all(45_800, 96_600, 96_600, 72_800)),
			citizen('kung', 'Kung Li-wen', 100_000, all(45_800, 101_100, 101_100, 72_800), {
				gender: 'FEMALE',
				dependants: 1,
				tax: { ...TABLE, table_dependants: 1 }
			})
		],
		expected: {
			chien: {
				gross: 95_000,
				net: 90_137,
				employer_cost: 14_566,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 1498,
				'NHI.employer': 4675,
				'LABOR_PENSION.employer': 5796,
				'OCC_INJURY.employer': 87,
				'INCOME_TAX.employee': 2220
			},
			kung: {
				gross: 100_000,
				net: 93_669,
				employer_cost: 15_053,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 3136,
				'NHI.employer': 4892,
				'LABOR_PENSION.employer': 6066,
				'OCC_INJURY.employer': 87,
				'INCOME_TAX.employee': 2050
			}
		}
	}),
	tw({
		id: 'TW-TAX-02-1',
		description:
			'Bonus and 5% seams: a 90,500 bonus is under the 起扣點 and a 90,501 one withholds 5% (4,525); a 5% of exactly 2,000 is not withheld and 2,002 is.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'MOF salary-withholding guidance (https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/withheld-rule/rule/NM11BZY): 非每月給付之薪資 按給付額扣取5%，免併入全月給付總額, and not withheld where the single payment is below the table’s no-dependant start, NT$90,501 in 2026. 90,501 × 5% = 4,525.05 → 4,525.',
			'健保法 §31(1)(1): a bonus is charged only on the year’s bonuses over 4 × the grade (4 × 45,800 = 183,200); neither bonus reaches it.',
			'45,000 (45,800 grades): salary 5% = 2,250. A: net 135,500 − (1,053 + 92 + 710 + 2,250) = 131,395. B: net 135,501 − (4,105 + 4,525) = 126,871. Employer 9,027 each.',
			'40,000 × 5% = 2,000, not over 2,000 → 0: net 38,376. 40,040 × 5% = 2,002 → withheld: net 40,040 − (922 + 80 + 622 + 2,002) = 36,414. Employer 7,903 each.'
		],
		period: '2026-03',
		people: [
			citizen('lan', 'Lan Chih-ming', 45_000, all(45_800), { tax: FIVE }),
			citizen('mei', 'Mei Hsiu-chin', 45_000, all(45_800), { gender: 'FEMALE', tax: FIVE }),
			citizen('fu', 'Fu Tsung-yu', 40_000, all(40_100), { tax: FIVE }),
			citizen('jen', 'Jen Ya-hui', 40_040, all(40_100), { gender: 'FEMALE', tax: FIVE })
		],
		extra: (job) => [
			adhoc(job('lan'), 'bonus', 90_500, '2026-03-10', 'Performance bonus'),
			adhoc(job('mei'), 'bonus', 90_501, '2026-03-10', 'Performance bonus')
		],
		expected: {
			lan: {
				gross: 135_500,
				net: 131_395,
				employer_cost: 9027,
				bonus: 90_500,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 2748,
				'OCC_INJURY.employer': 55,
				'INCOME_TAX.employee': 2250
			},
			mei: {
				gross: 135_501,
				net: 126_871,
				employer_cost: 9027,
				bonus: 90_501,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 2748,
				'OCC_INJURY.employer': 55,
				'INCOME_TAX.employee': 2250,
				'INCOME_TAX_BONUS.employee': 4525
			},
			fu: {
				gross: 40_000,
				net: 38_376,
				employer_cost: 7903,
				'LI.employee': 922,
				'LI.employer': 3228,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			},
			jen: {
				gross: 40_040,
				net: 36_414,
				employer_cost: 7903,
				'LI.employee': 922,
				'LI.employer': 3228,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48,
				'INCOME_TAX.employee': 2002
			}
		}
	}),
	tw({
		id: 'TW-NHI-02-1',
		description:
			'A NT$250,000 bonus in March: 5% withheld apart from salary (12,500), and the 2.11% supplementary premium on the 66,800 over four times the 45,800 grade.',
		citation: [
			...EVERY,
			'全民健康保險法 §31(1)(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=L0060001&flno=31) and NHIA 補充保險費計算公式 (https://www.nhi.gov.tw/ch/cp-4516-74b0f-2613-1.html): 全年累計超過當月投保金額4倍部分的獎金 × 2.11% — (250,000 − 183,200) × 2.11% = 1,409.48 → 1,409.',
			'MOF NM11BZY (https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/withheld-rule/rule/NM11BZY): 非每月給付之薪資 5% — 12,500. The salary 45,000 on the table withholds 0.',
			'Net 295,000 − (1,053 + 92 + 710 + 12,500 + 1,409) = 279,236; employer 9,027.',
			ARREARS,
			NHI_EMPLOYER,
			'Establishment lines: 墊償 45,800 × 0.025% = 11.45 → 11; 補充保費(雇主) (295,000 − 45,800) × 2.11% = 5,258.12 → 5,258.'
		],
		period: '2026-03',
		people: [citizen('ting', 'Ting Shao-wei', 45_000, all(45_800))],
		extra: (job) => [adhoc(job('ting'), 'bonus', 250_000, '2026-03-10', 'Year-end bonus')],
		companyLines: {
			// 45,800 × 0.025% = 11.45 → 11
			'WAGE_ARREARS_FUND.employer': 11,
			// (295,000 salary income − 45,800 insured) × 2.11% = 5,258.12 → 5,258
			'NHI_SUPPLEMENT_EMPLOYER.employer': 5258
		},
		expected: {
			ting: {
				gross: 295_000,
				net: 279_236,
				employer_cost: 9027,
				bonus: 250_000,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 2748,
				'OCC_INJURY.employer': 55,
				'INCOME_TAX_BONUS.employee': 12_500,
				'NHI_SUPPLEMENT.employee': 1409
			}
		}
	}),
	tw({
		id: 'TW-WAGE-06-1',
		description:
			'A served wage garnishment of NT$12,000 on a NT$36,000 March 2026 wage, the order attached as evidence: net pay falls by exactly the ordered amount; gross and every statutory line stay whole.',
		citation: [
			...EVERY,
			SRC.table,
			'強制執行法 §115-1 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0010004&flno=115-1): the order on 繼續性報酬債權 不得逾各期給付數額三分之一 unless the court departs from it; the garnishee deducts what the order fixes (12,000 = one third). Owner default 2026-09-28 (tracker TW-WAGE-06): a net deduction outside every wage, insured and tax base.',
			'Grades 36,300: 勞保 835 / 2,922, 就保 73 / 254, 健保 563 / 1,757, 勞退 2,178, 災保 43.56 → 44; the table withholds nothing. Net 36,000 − (835 + 73 + 563) − 12,000 = 22,529; employer 7,155.',
			ARREARS,
			NHI_EMPLOYER,
			'Establishment lines: 墊償 36,300 × 0.025% = 9.075 → 9; 補充保費(雇主) none (36,000 paid ≤ 36,300 insured).'
		],
		period: '2026-03',
		people: [citizen('yeh', 'Yeh Chun-hung', 36_000, all(36_300))],
		extra: (job) => [
			{
				...adhoc(
					job('yeh'),
					'COURT_GARNISHMENT',
					12_000,
					'2026-03-10',
					'強制執行法 §115-1 扣押命令 / 移轉命令'
				),
				files: { evidence_file: 'garnishment-order.pdf' }
			}
		],
		companyLines: { 'WAGE_ARREARS_FUND.employer': 9 },
		expected: {
			yeh: {
				gross: 36_000,
				net: 22_529,
				employer_cost: 7155,
				'LI.employee': 835,
				'LI.employer': 2922,
				'EI.employee': 73,
				'EI.employer': 254,
				'NHI.employee': 563,
				'NHI.employer': 1757,
				'LABOR_PENSION.employer': 2178,
				'OCC_INJURY.employer': 44
			}
		}
	}),
	tw({
		id: 'TW-TAX-04-1',
		description:
			'A citizen declared non-resident for tax is withheld 18% on NT$50,000 (above 44,250), whatever the citizenship.',
		citation: [
			...EVERY,
			SRC.nonResident,
			'所得稅法 §7(2)–(3) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340003&flno=7): residence turns on domicile or 183 days, not nationality. 50,000 × 18% = 9,000.',
			'Net 50,000 − (1,053 + 92 + 785 + 9,000) = 39,070; employer 9,554.'
		],
		period: '2026-03',
		people: [
			citizen('shen', 'Shen Kuo-liang', 50_000, all(45_800, 50_600), {
				terms: { tax_residency: 'NON_RESIDENT' }
			})
		],
		expected: {
			shen: {
				gross: 50_000,
				net: 39_070,
				employer_cost: 9554,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 785,
				'NHI.employer': 2449,
				'LABOR_PENSION.employer': 3036,
				'OCC_INJURY.employer': 61,
				'INCOME_TAX_NON_RESIDENT.employee': 9000
			}
		}
	}),
	tw({
		id: 'TW-TAX-05-1',
		description:
			'The non-resident seam: NT$44,250 (1.5 × 29,500) is withheld 6%, 44,251 is withheld 18%.',
		citation: [
			...EVERY,
			SRC.nonResident,
			'44,250 × 6% = 2,655; 44,251 × 18% = 7,965.18 → 7,965. Foreign professionals without permanent residence: no 就保; new-system 勞退 (BLI https://www.bli.gov.tw/0109916.html).',
			'45,800 grades: 勞保 1,053 / 3,687; 健保 710 / 2,216; 勞退 2,748; 災保 55. Nets 39,832 and 34,523; employer 8,706 each.'
		],
		period: '2026-03',
		people: (
			[
				['garcia', 'Maria Garcia', 44_250, 'Spanish'],
				['dubois', 'Luc Dubois', 44_251, 'French']
			] as const
		).map(([ref, name, wage, nationality]) =>
			citizen(
				ref,
				name,
				wage,
				{ LI: 45_800, NHI: 45_800, LABOR_PENSION: 45_800, OCC_INJURY: 45_800 },
				{
					nationality,
					born: '1992-04-04',
					hired: '2026-01-05',
					terms: {
						residency_status: 'FOREIGNER',
						pass_type: 'EMPLOYMENT_PASS',
						tax_residency: 'NON_RESIDENT'
					},
					elections: { LABOR_PENSION: { professional_work_class: 'FOREIGN_PROFESSIONAL' } },
					standing: {
						EI: {
							kind: 'NOT_REGISTERED',
							reason: 'Foreigner without permanent residence: outside 就業保險法 §5',
							declaration_reference: 'PROBE-ARC-NO-APRC',
							elections: { foreign_worker_excluded: true }
						}
					}
				}
			)
		),
		expected: {
			garcia: {
				gross: 44_250,
				net: 39_832,
				employer_cost: 8706,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 2748,
				'OCC_INJURY.employer': 55,
				'INCOME_TAX_NON_RESIDENT.employee': 2655
			},
			dubois: {
				gross: 44_251,
				net: 34_523,
				employer_cost: 8706,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'NHI.employee': 710,
				'NHI.employer': 2216,
				'LABOR_PENSION.employer': 2748,
				'OCC_INJURY.employer': 55,
				'INCOME_TAX_NON_RESIDENT.employee': 7965
			}
		}
	}),

	// ── Branches added 2026-09-30 for PARTIAL rows ─────────────────────────────────────────────────
	tw({
		id: 'TW-NHI-14-2',
		description:
			'A 重度 disability certificate: the state pays the whole of the worker’s own 勞保, 就保 and 健保 share; the unit share is untouched.',
		citation: [
			...EVERY,
			'身心障礙者參加社會保險保險費補助辦法 §4–5, §7 (https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=D0050090): 保險費補助，以其自付者為限; 極重度及重度身心障礙者全額補助; the insurer 在其所屬投保單位保險費計算表內直接減免之.',
			'40,100: 勞保 922.30 less 922.30 = 0; 就保 80.20 less 80.20 = 0; 健保 622 less 622 = 0. Units: 3,228, 281, 1,940; 勞退 2,406; 災保 48.',
			'Net 40,000; employer 7,903.'
		],
		period: '2026-03',
		people: [
			citizen('hou', 'Hou Chih-yuan', 40_000, all(40_100), {
				elections: {
					LI: { disability_subsidy: 100 },
					EI: { disability_subsidy: 100 },
					NHI: { disability_subsidy: 100 }
				}
			})
		],
		expected: {
			hou: {
				gross: 40_000,
				net: 40_000,
				employer_cost: 7903,
				'LI.employee': 0,
				'LI.employer': 3228,
				'EI.employee': 0,
				'EI.employer': 281,
				'NHI.employee': 0,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 2406,
				'OCC_INJURY.employer': 48
			}
		}
	}),
	tw({
		id: 'TW-TAX-06-2',
		description:
			'A retained old-system worker on NT$40,000 + a 3,000 meal allowance: the whole 43,000 is the §56 reserve wage (2% = 860) and the insured wage (43,900).',
		citation: [
			...EVERY,
			'勞動基準法 §2(3), §56(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001): 工資 includes 津貼, and the reserve is 2–15% of 每月薪資總額; 施行細則 §10 does not exclude a 伙食津貼 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030002). 43,000 × 2% = 860.',
			'營利事業所得稅查核準則 §88(2)(1) (https://law-out.mof.gov.tw/LawContent.aspx?id=FL006027): the 3,000 meal allowance is not 薪資所得; the table withholds nothing on 40,000.',
			'43,900: 勞保 1,010 / 3,534; 就保 88 / 307; 健保 681 / 2,124; 災保 52.68 → 53; no 勞退 (old system).',
			'Net 43,000 − (1,010 + 88 + 681) = 41,221; employer 3,534 + 307 + 2,124 + 53 + 860 = 6,878.'
		],
		company: { facts: { pension_reserve_rate: 2 } },
		period: '2026-03',
		people: [
			citizen(
				'yu',
				'Yu Cheng-hsien',
				40_000,
				{ LI: 43_900, EI: 43_900, NHI: 43_900, OCC_INJURY: 43_900 },
				{
					born: '1975-04-12',
					hired: '2004-03-01',
					standing: { LABOR_PENSION: OLD_SYSTEM },
					terms: {
						allowances: [{ catalogue_id: '@law:allowance_catalogue:MEAL_ALLOWANCE', amount: 3000 }]
					}
				}
			)
		],
		expected: {
			yu: {
				gross: 43_000,
				net: 41_221,
				employer_cost: 6878,
				MEAL_ALLOWANCE: 3000,
				'LI.employee': 1010,
				'LI.employer': 3534,
				'EI.employee': 88,
				'EI.employer': 307,
				'NHI.employee': 681,
				'NHI.employer': 2124,
				'OCC_INJURY.employer': 53,
				'LABOR_PENSION_RESERVE.employer': 860
			}
		}
	}),
	tw({
		id: 'TW-EXIT-01-2',
		description:
			'A §11 layoff on 15 March 2026 after six months with no notice given: 10 days’ notice pay beside a quarter-month of 資遣費, on the under-six-months 平均工資.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			`${SRC.lsa} §2(4): 工作未滿六個月者，謂工作期間所得工資總額除以工作期間之總日數 — 16 Sep 2025–14 Mar 2026, 180 days: 18,000 + 5 × 36,000 + 16,800 = 214,800 ÷ 180 = 1,193.33. §16(1)(1): 繼續工作三個月以上一年未滿者，於十日前預告之; §16(3): none given → 10 × 1,200 (the last day wage, above 1,193.33) = 12,000.`,
			'勞工退休金條例 §12(1): 0.5 × 6/12 = 0.25 month × 214,800 ÷ 180 × 30 = 8,950. One 退職所得 line (財政部 83-08-09 台財稅第831604301號, https://law-out.mof.gov.tw/LawContent.aspx?id=GL006450): 8,950 + 12,000 = 20,950; 所得稅法 §14(1) 第九類 exempts 206,000 for the six months (滿六個月者，以一年計) → no withholding.',
			'1–15 March worked: 15 × 1,200 = 18,000; 5% = 900 → 0. 15 insured days on 36,300: 勞保 417 / 1,461; 就保 36 / 127; 勞退 1,089; 災保 22; 健保法 §30(2): none.',
			'Gross 18,000 + 20,950 = 38,950; net 38,950 − (417 + 36) = 38,497; employer 1,461 + 127 + 1,089 + 22 = 2,699.'
		],
		period: '2026-03',
		people: [
			citizen('hsiao', 'Hsiao Wei-ting', 36_000, all(36_300), {
				hired: '2025-09-16',
				tax: FIVE,
				left: '2026-03-15',
				exit_reason: 'REDUNDANCY',
				exit_facts: {
					lsa_termination_ground: 'ARTICLE_11',
					notice_days_given: 0,
					average_daily_wage: 214_800 / 180,
					old_system_service_months: 0
				}
			})
		],
		extra: (job) => [
			adhoc(job('hsiao'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			hsiao: {
				gross: 38_950,
				net: 38_497,
				employer_cost: 2699,
				SEVERANCE_PAY: 20_950,
				'LI.employee': 417,
				'LI.employer': 1461,
				'EI.employee': 36,
				'EI.employer': 127,
				'LABOR_PENSION.employer': 1089,
				'OCC_INJURY.employer': 22
			}
		}
	}),
	tw({
		id: 'TW-EXIT-02-2',
		description:
			'A §11 layoff on 15 March 2026 after over twenty new-system years: 資遣費 stops at six months of 平均工資.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'勞工退休金條例 §12(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020): 每滿一年發給二分之一個月之平均工資 … 最高以發給六個月平均工資為限 — 1 Jul 2005–15 Mar 2026 is over 20 years, 0.5 × 20 > 6 → 6 months: 270,000 ÷ 181 × 30 × 6 = 268,508.29 → 268,508.',
			`${SRC.lsa} §16(1)(3): 30 days’ notice given, so no notice pay. 所得稅法 §14(1) 第九類: 206,000 × 20 years and more exempt → no withholding. 15 × 1,500 = 22,500; 5% = 1,125 → 0.`,
			'15 insured days on 45,800: 527 / 1,843, 46 / 160, 勞退 1,374, 災保 27. 健保法 §30(2): none.',
			'Gross 22,500 + 268,508 = 291,008; net 291,008 − (527 + 46) = 290,435; employer 1,843 + 160 + 1,374 + 27 = 3,404.'
		],
		period: '2026-03',
		people: [
			citizen('tseng2', 'Tseng Kuo-an', 45_000, all(45_800), {
				born: '1975-05-10',
				hired: '2005-07-01',
				tax: FIVE,
				left: '2026-03-15',
				exit_reason: 'REDUNDANCY',
				exit_facts: { ...NOTICE, average_daily_wage: 270_000 / 181, old_system_service_months: 0 }
			})
		],
		extra: (job) => [
			adhoc(
				job('tseng2'),
				'SEVERANCE_PAY',
				0,
				'2026-03-15',
				'SEVERANCE_PAY on departure 2026-03-15'
			)
		],
		expected: {
			tseng2: {
				gross: 291_008,
				net: 290_435,
				employer_cost: 3404,
				SEVERANCE_PAY: 268_508,
				'LI.employee': 527,
				'LI.employer': 1843,
				'EI.employee': 46,
				'EI.employer': 160,
				'LABOR_PENSION.employer': 1374,
				'OCC_INJURY.employer': 27
			}
		}
	}),
	tw({
		id: 'TW-TAX-03-2',
		description:
			'A §11 layoff on 15 March 2026 of a retained old-system worker since 16 March 2004 at NT$450,000: 22 months’ 平均工資, part of it above the 414,000 × 22 band and wholly taxable.',
		citation: [
			...EVERY,
			`${SRC.lsa} §17(1), §2(4): 2,700,000 ÷ 181 × 30 × 22 = 9,845,303.87 → 9,845,304 (勞工退休金條例 §11(2) old-system seniority).`,
			'所得稅法 §14(1) 第九類 一 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340003&flno=14) with 115年 amounts 206,000 / 414,000 (https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/taxation-scope/which-income/O9EmLJZ): 206,000 × 22 = 4,532,000 is 0; 4,532,000–9,108,000 (414,000 × 22) is half: 2,288,000; the 737,304 above 9,108,000 is whole: 所得額 3,025,304.',
			'各類所得扣繳率標準 §2(9) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0340028): 6% of the 所得額 — 181,518.24 → 181,518.',
			'勞動基準法 §56(1) reserve 2% × 225,000 = 4,500. 15 days × 15,000 = 225,000; 5% = 11,250.',
			'15 insured days: 勞保 527 / 1,843; 就保 46 / 160; 災保 72,800 × 0.12% × ½ = 43.68 → 44; no 勞退 (old system); no 健保 (§30(2)).',
			'Gross 225,000 + 9,845,304 = 10,070,304; net 10,070,304 − (527 + 46 + 11,250 + 181,518) = 9,876,963; employer 1,843 + 160 + 44 + 4,500 = 6,547.'
		],
		company: { facts: { pension_reserve_rate: 2 } },
		period: '2026-03',
		people: [
			citizen(
				'chiu',
				'Chiu Ming-tsung',
				450_000,
				{ LI: 45_800, EI: 45_800, NHI: 313_000, OCC_INJURY: 72_800 },
				{
					born: '1970-09-09',
					hired: '2004-03-16',
					tax: FIVE,
					left: '2026-03-15',
					exit_reason: 'REDUNDANCY',
					exit_facts: {
						...NOTICE,
						average_daily_wage: 2_700_000 / 181,
						old_system_service_months: 264
					},
					standing: { LABOR_PENSION: OLD_SYSTEM }
				}
			)
		],
		extra: (job) => [
			adhoc(job('chiu'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			chiu: {
				gross: 10_070_304,
				net: 9_876_963,
				employer_cost: 6547,
				SEVERANCE_PAY: 9_845_304,
				'LI.employee': 527,
				'LI.employer': 1843,
				'EI.employee': 46,
				'EI.employer': 160,
				'OCC_INJURY.employer': 44,
				'LABOR_PENSION_RESERVE.employer': 4500,
				'INCOME_TAX.employee': 11_250,
				'SEVERANCE_TAX.employee': 181_518
			}
		}
	})
);
