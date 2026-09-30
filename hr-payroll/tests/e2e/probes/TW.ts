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
	| { kind: 'REGISTERED'; elections?: Row; since?: string }
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
	exit_ground?: string;
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
					since: standing.since ?? p.hired,
					first_contribution_due_on: standing.since ?? p.hired
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
				...(p.exit_ground === undefined ? {} : { exit_ground: p.exit_ground }),
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
	/** Per person: first-terms writes attempted (and refused) before the person's own terms. */
	attempts?: Readonly<Record<string, readonly { terms: Row; refused: string }[]>>;
};

/** A person's inputs with refused first-terms attempts ahead of the terms that stand. */
const attempted = (p: Person, attempts: readonly { terms: Row; refused: string }[] = []) => {
	const inputs = personInputs(p);
	const at = inputs.findIndex((input) => input.collection === 'employment_terms');
	const terms = inputs[at]!;
	inputs.splice(
		at,
		0,
		...attempts.map(({ terms: row, refused }) => ({
			...terms,
			values: { ...terms.values, ...row },
			refused
		}))
	);
	return inputs;
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
		...c.people.flatMap((p) => attempted(p, c.attempts?.[p.ref])),
		...(c.extra?.((person) => `@${person}_job`) ?? [])
	],
	expected: Object.entries(c.expected).map(([ref, lines]) => ({ employment: `${ref}_job`, lines })),
	...(c.warnings === undefined ? {} : { warnings: c.warnings }),
	...(c.companyLines === undefined ? {} : { companyLines: c.companyLines }),
	...(c.refused === undefined ? {} : { refused: c.refused }),
	...(c.saved === undefined ? {} : { saved: c.saved })
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
				exit_ground: 'RESIGNATION',
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
				exit_ground: 'RESIGNATION',
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
				exit_ground: 'RESIGNATION',
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
				exit_ground: 'RESIGNATION',
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
				exit_ground: 'REDUNDANCY',
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
				exit_ground: 'REDUNDANCY',
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
				exit_ground: 'REDUNDANCY',
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
					exit_ground: 'REDUNDANCY',
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
					exit_ground: 'RETIREMENT',
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
				exit_ground: 'REDUNDANCY',
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
				exit_ground: 'REDUNDANCY',
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
					exit_ground: 'REDUNDANCY',
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

// ── Round 9 (2026-09-30): branches the trackers name as unproven ──────────────────────────────────
const LSA_ALL =
	'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001 (最後修正 113-07-31, read 2026-09-30)';
const LEAVE_RULES =
	'勞工請假規則 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030006, 最後修正 114-12-09, read 2026-09-30)';
const GENDER =
	'性別平等工作法 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014, 最後修正 112-08-16, read 2026-09-30)';
const PENSION_ACT =
	'勞工退休金條例 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020, read 2026-09-30)';
const Y114 = [
	'民國114年 tables of the 2025-12-01 version: 最低工資 NT$28,590 a month / NT$190 an hour (最低工資法 §5, https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030028&flno=5); 勞保/就保 投保薪資分級表 114年 (BLI Files/24813: 第1級 28,590, 28,591–28,800 → 28,800, 28,801–30,300 → 30,300, ceiling 45,800); 勞保 11.5%, 就保 1%, shares 20/70 (勞工保險條例 §13, §15, https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050001); 健保 5.17%, 本人 30%, 單位 60% × (1 + 0.56) (全民健康保險法 §27, https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060001), 59 grades 28,590–313,000; 勞退 6% to 150,000; 災保 22 grades 28,590–72,800 at 行業 四二 0.12% (Files/24759, from 114-01-01).'
];
/** A dated standing that changes on `from`. */
const dated = (
	hired: string,
	...rest: readonly (readonly [from: string, to: string | null, standing: Standing])[]
): Piece[] => rest.map(([from, to, standing]) => [from === '' ? hired : from, to, standing]);

register(
	tw({
		id: 'TW-MW-01-2',
		description:
			'December 2025, the 114年 floor: a full-timer agreed at NT$28,000 is paid 28,590 on the 28,590 grade; a 29,500 wage is not a 114年 grade and insures at 30,300 (it insures at 29,500 a month later, TW-MW-01-1).',
		citation: [
			...Y114,
			'28,590: 勞保 3,287.85 → 657.57 → 658 / 2,301.495 → 2,301; 就保 285.90 → 57.18 → 57 / 200.13 → 200; 健保 1,478.10 × 30% = 443.43 → 443 / × 0.936 = 1,383.50 → 1,384; 勞退 1,715.40 → 1,715; 災保 34.31 → 34. Net 28,590 − 1,158 = 27,432; employer 5,634.',
			'30,300: 勞保 3,484.50 → 696.90 → 697 / 2,439.15 → 2,439; 就保 303 → 60.60 → 61 / 212.10 → 212; 健保 1,566.51 → 469.95 → 470 / 1,466.25 → 1,466; 勞退 1,818; 災保 36.36 → 36. Net 29,500 − 1,228 = 28,272; employer 5,971.'
		],
		period: '2025-12',
		people: [
			citizen('hsiao', 'Hsiao Ya-chi', 28_000, all(28_590), { gender: 'FEMALE' }),
			citizen('wei', 'Wei Cheng-en', 29_500, all(30_300))
		],
		expected: {
			hsiao: {
				gross: 28_590,
				net: 27_432,
				employer_cost: 5634,
				'LI.employee': 658,
				'LI.employer': 2301,
				'EI.employee': 57,
				'EI.employer': 200,
				'NHI.employee': 443,
				'NHI.employer': 1384,
				'LABOR_PENSION.employer': 1715,
				'OCC_INJURY.employer': 34
			},
			wei: {
				gross: 29_500,
				net: 28_272,
				employer_cost: 5971,
				'LI.employee': 697,
				'LI.employer': 2439,
				'EI.employee': 61,
				'EI.employer': 212,
				'NHI.employee': 470,
				'NHI.employer': 1466,
				'LABOR_PENSION.employer': 1818,
				'OCC_INJURY.employer': 36
			}
		}
	}),
	tw({
		id: 'TW-TAX-03-3',
		description:
			'A §11 layoff on 31 December 2025 after seven new-system years at NT$1,000,000 a month: 3.5 months of 平均工資, taxed on the 114年度 退職所得 amounts 198,000 / 398,000.',
		citation: [
			...Y114,
			SRC.fivePercent,
			`${PENSION_ACT} §12(1): 每滿一年發給二分之一個月之平均工資 … 最高以發給六個月平均工資為限 — 0.5 × 7 = 3.5 × 1,000,000 (平均工資 declared 1,000,000 ÷ 30 a day) = 3,500,000. ${SRC.lsa} §16(1)(3): 30 days’ notice given, no notice pay.`,
			'所得稅法 §14(1) 第九類 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340003&flno=14) with the 114年度 amounts (財政部 113-11-28 公告, unchanged for 114年度; tracker TW-TAX-03): 198,000 × 7 = 1,386,000 exempt, the band to 398,000 × 7 = 2,786,000 half: 所得額 700,000 + 714,000 = 1,414,000; 各類所得扣繳率標準 §2(1)(9) 6% = 84,840.',
			'Exit on the last day of the month: 30 insured days, 健保 charged (退保 1 January). 勞保 ceiling 1,053 / 3,687; 就保 92 / 321; 健保 313,000: 16,182.10 → 4,855 / 15,146; 勞退 150,000 × 6% = 9,000; 災保 72,800 × 0.12% = 87. 5% × 1,000,000 = 50,000.',
			'Gross 4,500,000; net 4,500,000 − (1,053 + 92 + 4,855 + 50,000 + 84,840) = 4,359,160; employer 3,687 + 321 + 15,146 + 9,000 + 87 = 28,241.'
		],
		period: '2025-12',
		people: [
			citizen(
				'fu',
				'Fu Chien-kuo',
				1_000_000,
				{ LI: 45_800, EI: 45_800, NHI: 313_000, LABOR_PENSION: 150_000, OCC_INJURY: 72_800 },
				{
					hired: '2019-01-01',
					left: '2025-12-31',
					tax: FIVE,
					exit_ground: 'REDUNDANCY',
					exit_facts: {
						...NOTICE,
						average_daily_wage: 1_000_000 / 30,
						old_system_service_months: 0
					}
				}
			)
		],
		extra: (job) => [
			adhoc(job('fu'), 'SEVERANCE_PAY', 0, '2025-12-31', 'SEVERANCE_PAY on departure 2025-12-31')
		],
		expected: {
			fu: {
				gross: 4_500_000,
				net: 4_359_160,
				employer_cost: 28_241,
				SEVERANCE_PAY: 3_500_000,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 4855,
				'NHI.employer': 15_146,
				'LABOR_PENSION.employer': 9000,
				'OCC_INJURY.employer': 87,
				'INCOME_TAX.employee': 50_000,
				'SEVERANCE_TAX.employee': 84_840
			}
		}
	}),
	tw({
		id: 'TW-MW-02-2',
		description:
			'An hourly part-timer agreed at NT$190 an hour works 80 hours in March 2026 (every Monday and Tuesday, 8 h): paid the NT$196 hourly floor, 15,680; 15,840 part-time grade, 健保 and 災保 at 29,500.',
		citation: [
			...EVERY,
			SRC.minimumWage,
			'最低工資法 §5: an hourly rate below NT$196 is paid 196 — 80 × 196 = 15,680 (僱用部分時間工作勞工應行注意事項 §6(2)(1), https://laws.mol.gov.tw/FLAW/FLAWDOC01.aspx?flno=6&id=FL072875: hourly pay not below the hourly minimum).',
			'15,840 (13,501–15,840): 勞保 364 / 1,275; 就保 32 / 111; 勞退 950. 健保 458 / 1,428 (16 h a week ≥ 12). 災保 35. Net 15,680 − 854 = 14,826; employer 3,799.'
		],
		period: '2026-03',
		people: [
			citizen(
				'ting',
				'Ting Yu-han',
				190,
				{ LI: 15_840, EI: 15_840, NHI: 29_500, LABOR_PENSION: 15_840, OCC_INJURY: 29_500 },
				{
					gender: 'FEMALE',
					terms: {
						employment_type: 'PART_TIME',
						pay_frequency: 'HOURLY',
						ordinary_hours_per_week: 16,
						working_days_per_week: 2
					}
				}
			)
		],
		extra: (job) =>
			['02', '03', '09', '10', '16', '17', '23', '24', '30', '31'].map((day) =>
				worked(job('ting'), `2026-03-${day}`, ['09:00', '13:00'], ['14:00', '18:00'])
			),
		expected: {
			ting: {
				gross: 15_680,
				net: 14_826,
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
		id: 'TW-HOURS-02-2',
		description:
			'NT$48,000 (200 an hour, 1,600 a day): four emergency hours on the 例假 (Sunday 8 March) earn one further day’s wage; ten hours on the 休息日 (Saturday 14 March, in stints of 4 + 4 + 2) pay 2 h at 1⅓ and 8 h at 1⅔.',
		citation: [
			...EVERY,
			SRC.table,
			`${SRC.lsa} §40(1): 停止假期之工資，應加倍發給 — 48,000 ÷ 30 = 1,600 (${LSA_ALL}).`,
			`${SRC.lsa} §24(2): 休息日 二小時以內 另再加給一又三分之一以上；工作二小時後再繼續工作者 另再加給一又三分之二以上 — hours nine and ten stay at 1⅔: 2 × 266.67 = 533.33; 8 × 333.33 = 2,666.67; 3,200. §32(2) 12-hour day not reached; §35 break owed after four continuous hours, each stint is at most four.`,
			'The table withholds nothing (52,800 < 90,501). Grades as TW-LI-01-1: net 52,800 − (1,053 + 92 + 748) = 50,907; employer 9,290.'
		],
		period: '2026-03',
		people: [citizen('ko', 'Ko Wei-ting', 48_000, all(45_800, 48_200))],
		extra: (job) => [
			asked(worked(job('ko'), '2026-03-08', ['09:00', '13:00']), 4),
			asked(
				worked(job('ko'), '2026-03-14', ['09:00', '13:00'], ['13:30', '17:30'], ['18:00', '20:00']),
				10
			)
		],
		expected: {
			ko: {
				gross: 52_800,
				net: 50_907,
				employer_cost: 9290,
				OVERTIME: 4800,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 748,
				'NHI.employer': 2332,
				'LABOR_PENSION.employer': 2892,
				'OCC_INJURY.employer': 58
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-02-2',
		description:
			'NT$60,000 (2,000 a day): ten hospitalised sick days (2–13 March) after thirty ordinary sick days in January–February are unpaid (20,000 off); the same ten as the year’s first are half-paid (10,000 off).',
		citation: [
			...EVERY,
			`${LEAVE_RULES} §4(1)–(3): 未住院者 一年內合計不得超過三十日 … 普通傷病假一年內未超過三十日部分，工資折半發給 — the thirty half-paid days count hospitalised and non-hospitalised days together; beyond them no wage is owed.`,
			'Grades 45,800 / 60,800 as TW-LEAVE-01-1: 1,053 / 3,687, 92 / 321, 943 / 2,942, 勞退 3,648, 災保 73. Net 40,000 − 2,088 = 37,912 and 50,000 − 2,088 = 47,912; employer 10,671 each.'
		],
		period: '2026-03',
		people: [
			citizen('ma', 'Ma Chia-wen', 60_000, all(45_800, 60_800), { gender: 'FEMALE' }),
			citizen('niu', 'Niu Po-han', 60_000, all(45_800, 60_800))
		],
		extra: (job) => [
			leave(job('ma'), 'SICK_LEAVE', 'SICK-TW-MA-JAN', '2026-01-05', '2026-01-30'),
			leave(job('ma'), 'SICK_LEAVE', 'SICK-TW-MA-FEB', '2026-02-02', '2026-02-13'),
			leave(job('ma'), 'HOSPITALISED_SICK_LEAVE', 'HOSP-TW-MA', '2026-03-02', '2026-03-13'),
			leave(job('niu'), 'HOSPITALISED_SICK_LEAVE', 'HOSP-TW-NIU', '2026-03-02', '2026-03-13')
		],
		expected: {
			ma: {
				gross: 40_000,
				net: 37_912,
				employer_cost: 10_671,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 943,
				'NHI.employer': 2942,
				'LABOR_PENSION.employer': 3648,
				'OCC_INJURY.employer': 73
			},
			niu: {
				gross: 50_000,
				net: 47_912,
				employer_cost: 10_671,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 943,
				'NHI.employer': 2942,
				'LABOR_PENSION.employer': 3648,
				'OCC_INJURY.employer': 73
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-03-2',
		description:
			'The 14-day 事假 year with 家庭照顧假 inside it, on NT$45,000: twelve personal days by February, two hours of family care (375 off) and one more day (1,500 off) are taken; three more days would pass fourteen and are refused; hours on ordinary 事假 are refused.',
		citation: [
			...EVERY,
			`${LEAVE_RULES} §7: 事假 一年內合計不得超過十四日。事假期間不給工資。勞工為親自照顧家庭成員 … 並得擇定以小時為請假單位 — only family care is taken by the hour.`,
			`${GENDER} §20(1): 家庭照顧假 其請假日數併入事假計算，全年以七日為限 — 12 + 0.25 + 3 = 15.25 > 14 refused; 12 + 0.25 + 1 = 13.25.`,
			'45,000 ÷ 30 = 1,500 a day, 187.50 an hour: 2 h = 375. Gross 43,125; grades 45,800: net 43,125 − 1,855 = 41,270; employer 9,027.'
		],
		period: '2026-03',
		people: [citizen('lo2', 'Lo Hsin-hui', 45_000, all(45_800), { gender: 'FEMALE' })],
		extra: (job) => [
			leave(job('lo2'), 'PERSONAL_LEAVE', 'NPL-TW-LO-JAN', '2026-01-05', '2026-01-16'),
			leave(job('lo2'), 'PERSONAL_LEAVE', 'NPL-TW-LO-FEB', '2026-02-02', '2026-02-03'),
			leave(job('lo2'), 'FAMILY_CARE_LEAVE', 'CARE-TW-LO', '2026-03-10', '2026-03-10', {
				hours: 2
			}),
			{
				...leave(job('lo2'), 'PERSONAL_LEAVE', 'NPL-TW-LO-OVER', '2026-03-11', '2026-03-13'),
				refused: 'Insufficient leave|allows 14'
			},
			{
				...leave(job('lo2'), 'PERSONAL_LEAVE', 'NPL-TW-LO-HOURS', '2026-03-16', '2026-03-16', {
					hours: 2
				}),
				refused: 'not by the hour'
			},
			leave(job('lo2'), 'PERSONAL_LEAVE', 'NPL-TW-LO-MAR', '2026-03-12', '2026-03-12')
		],
		expected: {
			lo2: {
				gross: 43_125,
				net: 41_270,
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
		id: 'TW-LEAVE-05-2',
		description:
			'Paid leaves on NT$36,000: five 陪產檢及陪產假 days, two 產檢假 days, and a March inside eight weeks of 產假 after two years’ service — each keeps the full wage.',
		citation: [
			...EVERY,
			`${GENDER} §15(4)–(5): 產檢假七日 … 陪產檢及陪產假七日。產檢假、陪產檢及陪產假期間，薪資照給.`,
			`${SRC.lsa} §50(1)–(2): 分娩前後 停止工作，給予產假八星期 … 受僱工作在六個月以上者，停止工作期間工資照給 (${LSA_ALL}).`,
			'Grades 36,300 as TW-LEAVE-02-1: net 36,000 − 1,471 = 34,529; employer 7,155 each.'
		],
		period: '2026-03',
		people: [
			citizen('chien', 'Chien Yu-lun', 36_000, all(36_300)),
			citizen('ou', 'Ou Shu-chen', 36_000, all(36_300), { gender: 'FEMALE' }),
			citizen('lan', 'Lan Pei-yu', 36_000, all(36_300), { gender: 'FEMALE' })
		],
		extra: (job) => [
			leave(job('chien'), 'PATERNITY_LEAVE', 'PAT-TW-CHIEN', '2026-03-09', '2026-03-13'),
			leave(job('ou'), 'PRENATAL_CHECKUP_LEAVE', 'PRE-TW-OU', '2026-03-16', '2026-03-17'),
			leave(job('lan'), 'MATERNITY_LEAVE', 'MAT-TW-LAN', '2026-03-01', '2026-04-25', {
				facts: {
					event_kind: 'BIRTH',
					event_date: '2026-03-01'
				}
			})
		],
		expected: Object.fromEntries(
			['chien', 'ou', 'lan'].map((ref) => [
				ref,
				{
					gross: 36_000,
					net: 34_529,
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
			])
		)
	}),
	tw({
		id: 'TW-LEAVE-08-2',
		description:
			'§16(2) limits: with 30 days’ notice to 15 March 2026, two job-search days (Mon 2 – Tue 3 March) are paid; a third that week and a day before the notice window are refused; a worker paid in lieu of notice has no job-search leave.',
		citation: [
			...EVERY,
			`${SRC.lsa} §16(2): 勞工於接到前項預告後 … 每星期不得超過二日之工作時間，請假期間之工資照給. Tracker defaults: ISO week; the window starts the day after notice (民法 §120(2)) — 12 February is 31 days before the exit, outside 30.`,
			'Pay as TW-LEAVE-08-1: 79,558 severance + 20,000 wages; net 99,057; employer 2,981.'
		],
		period: '2026-03',
		people: [
			citizen('kou', 'Kou Chia-ling', 40_000, all(40_100), {
				gender: 'FEMALE',
				hired: '2022-03-16',
				tax: FIVE,
				left: '2026-03-15',
				exit_ground: 'REDUNDANCY',
				exit_facts: { ...NOTICE, average_daily_wage: 240_000 / 181, old_system_service_months: 0 }
			}),
			citizen('jen', 'Jen Kuan-yu', 40_000, all(40_100), {
				hired: '2022-03-16',
				left: '2026-03-15',
				exit_ground: 'REDUNDANCY',
				exit_facts: {
					lsa_termination_ground: 'ARTICLE_11',
					notice_days_given: 0,
					average_daily_wage: 240_000 / 181,
					old_system_service_months: 0
				}
			})
		],
		extra: (job) => [
			leave(job('kou'), 'JOB_SEARCH_LEAVE', 'JOBSEARCH-TW-KOU-1', '2026-03-02', '2026-03-03'),
			{
				...leave(job('kou'), 'JOB_SEARCH_LEAVE', 'JOBSEARCH-TW-KOU-3', '2026-03-04', '2026-03-04'),
				refused: 'allows 2 days a week; 2 are already taken in the week of 2026-03-02'
			},
			{
				...leave(
					job('kou'),
					'JOB_SEARCH_LEAVE',
					'JOBSEARCH-TW-KOU-EARLY',
					'2026-02-12',
					'2026-02-12'
				),
				refused: 'INELIGIBLE'
			},
			{
				...leave(job('jen'), 'JOB_SEARCH_LEAVE', 'JOBSEARCH-TW-JEN', '2026-03-03', '2026-03-03'),
				refused: 'INELIGIBLE'
			},
			adhoc(job('kou'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			kou: {
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
		id: 'TW-EXIT-01-3',
		description:
			'A §14 worker termination on 15 March 2026 after two and a half new-system years at NT$45,000: severance pro rata, 1.25 months of 平均工資, and no notice pay.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			`${SRC.lsa} §14(4): 第十七條規定於本條終止契約準用之 (${LSA_ALL}); §16 notice binds the employer’s termination only.`,
			`${PENSION_ACT} §12(1): 依勞動基準法 … 第十四條 … 終止時 … 每滿一年發給二分之一個月之平均工資，未滿一年者，以比例計給 — 30 months: 0.5 × 30/12 = 1.25; 270,000 ÷ 181 × 30 × 1.25 = 55,939.23 → 55,939.`,
			'所得稅法 §14(1) 第九類: 2.5 years (a tail of six months counts one year) × 206,000 exempt → none. 15 × 1,500 = 22,500; 5% = 1,125 → 0.',
			'15 insured days on 45,800: 527 / 1,843, 46 / 160, 勞退 1,374, 災保 27. Gross 78,439; net 77,866; employer 3,404.'
		],
		period: '2026-03',
		people: [
			citizen('hou', 'Hou Mei-ling', 45_000, all(45_800), {
				gender: 'FEMALE',
				hired: '2023-09-16',
				tax: FIVE,
				left: '2026-03-15',
				exit_ground: 'RESIGNATION',
				exit_facts: {
					lsa_termination_ground: 'ARTICLE_14',
					notice_days_given: 0,
					average_daily_wage: 270_000 / 181,
					old_system_service_months: 0
				}
			})
		],
		extra: (job) => [
			adhoc(job('hou'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			hou: {
				gross: 78_439,
				net: 77_866,
				employer_cost: 3404,
				SEVERANCE_PAY: 55_939,
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
		id: 'TW-EXIT-02-3',
		description:
			'A §11 layoff on 15 March 2026 of a worker hired 16 March 2004 who kept 15.5 months of old-system seniority on moving to the new system: 16/12 months under §17 beside the new system’s six-month cap.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			`${SRC.lsa} §17(1): 每滿一年發給相當於一個月平均工資之資遣費; 未滿一年者，依比例計給之。未滿一個月者以一個月計 — 15.5 months → 16/12. ${PENSION_ACT} §11(2): the retained seniority is severed under the LSA at the termination-day 平均工資.`,
			`${PENSION_ACT} §12(1): 248.5 new-system months × ½ ÷ 12 = 10.35 → capped at 6. 270,000 ÷ 181 × 30 × (16/12 + 6) = 328,176.80 → 328,177.`,
			'30 days’ notice given; 22 years × 206,000 exempt. 15 insured days as TW-EXIT-02-1: 527 / 1,843, 46 / 160, 1,374, 27. Gross 22,500 + 328,177 = 350,677; net 350,104; employer 3,404.'
		],
		period: '2026-03',
		people: [
			citizen('shen', 'Shen Kuo-liang', 45_000, all(45_800), {
				born: '1975-04-04',
				hired: '2004-03-16',
				tax: FIVE,
				left: '2026-03-15',
				exit_ground: 'REDUNDANCY',
				exit_facts: {
					...NOTICE,
					average_daily_wage: 270_000 / 181,
					old_system_service_months: 15.5
				}
			})
		],
		extra: (job) => [
			adhoc(job('shen'), 'SEVERANCE_PAY', 0, '2026-03-15', 'SEVERANCE_PAY on departure 2026-03-15')
		],
		expected: {
			shen: {
				gross: 350_677,
				net: 350_104,
				employer_cost: 3404,
				SEVERANCE_PAY: 328_177,
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
		id: 'TW-EXIT-06-2',
		description:
			'An art. 54(1)(2) forced retirement for a duty-caused disability on 15 March 2026 after 31 years 7 months on the old system: the tail counts a whole year (32), the bases cap at 45, and 20% more — 54 bases.',
		citation: [
			...EVERY,
			`${SRC.lsa} §54(1)(2): 身心障礙不堪勝任工作者 may be retired; §55(1)(1): 每滿一年給與兩個基數 … 超過十五年 … 每滿一年給與一個基數，最高總數以四十五個基數為限。未滿半年者以半年計；滿半年者以一年計; §55(1)(2): 因執行職務所致 … 加給百分之二十 (${LSA_ALL}).`,
			'379 months = 31 years 7 months → 32 → 30 + 17 = 47 → 45 × 1.2 = 54; 270,000 ÷ 181 × 30 × 54 = 2,416,574.59 → 2,416,575.',
			'所得稅法 §14(1) 第九類: 32 × 206,000 exempt. §56(1) reserve 2% × 22,500 = 450. 15 insured days on 45,800 (age 58): 527 / 1,843, 46 / 160, 災保 27.',
			'Gross 22,500 + 2,416,575 = 2,439,075; net 2,438,502; employer 1,843 + 160 + 27 + 450 = 2,480.'
		],
		company: { facts: { pension_reserve_rate: 2 } },
		period: '2026-03',
		people: [
			citizen(
				'tai',
				'Tai Wen-chung',
				45_000,
				{ LI: 45_800, EI: 45_800, NHI: 45_800, OCC_INJURY: 45_800 },
				{
					born: '1968-01-01',
					hired: '1994-08-16',
					left: '2026-03-15',
					exit_ground: 'RETIREMENT',
					exit_facts: {
						average_daily_wage: 270_000 / 181,
						old_system_service_months: 379,
						retirement_disability: true,
						retirement_disability_duty_caused: true
					},
					standing: { LABOR_PENSION: OLD_SYSTEM }
				}
			)
		],
		extra: (job) => [
			adhoc(job('tai'), 'RETIREMENT_PAY', 0, '2026-03-15', 'RETIREMENT_PAY on departure 2026-03-15')
		],
		expected: {
			tai: {
				gross: 2_439_075,
				net: 2_438_502,
				employer_cost: 2480,
				RETIREMENT_PAY: 2_416_575,
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
		id: 'TW-EXIT-05-2',
		description:
			'An occupational injury in March 2026 on NT$40,000: 公傷病假 9–13 March keeps the wage whole, NT$12,000 of receipted medical costs are paid outside every base, and an elected NT$5,000 insurer-benefit 抵充 comes off net.',
		citation: [
			...EVERY,
			`${SRC.lsa} §59(1): 必需之醫療費用 補償; §59 但書: 同一事故 已由雇主支付費用補償者，雇主得予以抵充之 (${LSA_ALL}). 勞動基準法施行細則 §10(7): 職業災害補償費 is not 工資; 所得稅法 §4(1)(3) exempts it (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0340003).`,
			'Owner rule 2026-09-28 (tracker TW-EXIT-05): the offset is recorded as the employer elects, not computed.',
			'40,100: 922 / 3,228, 80 / 281, 622 / 1,940, 2,406, 48. Gross 40,000 + 12,000 = 52,000; net 52,000 − 1,624 − 5,000 = 45,376; employer 7,903.'
		],
		period: '2026-03',
		people: [citizen('yu', 'Yu Chih-ming', 40_000, all(40_100))],
		extra: (job) => [
			leave(job('yu'), 'OCCUPATIONAL_INJURY_LEAVE', 'OCC-TW-YU', '2026-03-09', '2026-03-13'),
			{
				...adhoc(job('yu'), 'OCC_INJURY_MEDICAL', 12_000, '2026-03-13', '§59(1) hospital receipts'),
				files: { evidence_file: 'medical-receipts.pdf' }
			},
			adhoc(job('yu'), 'OCC_INJURY_OFFSET', 5000, '2026-03-20', '§59 但書 抵充: BLI 職災傷病給付')
		],
		expected: {
			yu: {
				gross: 52_000,
				net: 45_376,
				employer_cost: 7903,
				OCC_INJURY_MEDICAL: 12_000,
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
		id: 'TW-NHI-14-3',
		description:
			'A 輕度 disability certificate on NT$36,000 with one 健保 dependant holding a 重度 certificate: a quarter of the worker’s own 勞保/就保/健保, each rounded on its own, and the whole of the dependant’s premium.',
		citation: [
			...EVERY,
			'身心障礙者參加社會保險保險費補助辦法 (https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=D0050090): 極重度、重度 全額, 中度 二分之一, 輕度 四分之一 of the insured’s own share; the NHI subsidy also covers a disabled dependant on that dependant’s own premium.',
			'36,300: 勞保 834.90 → 835 less 208.73 → 209 = 626; 就保 72.60 → 73 less 18.15 → 18 = 55; 健保 563 less 140.75 → 141 = 422, dependant 563 less 563 = 0.',
			'Net 36,000 − (626 + 55 + 422) = 34,897; employer 2,922 + 254 + 1,757 + 2,178 + 44 = 7,155.'
		],
		period: '2026-03',
		people: [
			citizen('kan', 'Kan Shu-hui', 36_000, all(36_300), {
				gender: 'FEMALE',
				dependants: 1,
				elections: {
					LI: { disability_subsidy: 25 },
					EI: { disability_subsidy: 25 },
					NHI: { disability_subsidy: 25, dependants_subsidised_full: 1 }
				}
			})
		],
		expected: {
			kan: {
				gross: 36_000,
				net: 34_897,
				employer_cost: 7155,
				'LI.employee': 626,
				'LI.employer': 2922,
				'EI.employee': 55,
				'EI.employer': 254,
				'NHI.employee': 422,
				'NHI.employer': 1757,
				'LABOR_PENSION.employer': 2178,
				'OCC_INJURY.employer': 44
			}
		}
	}),
	...(['2019-11-15', '2019-11-16'] as const).map((electedOn) =>
		tw({
			id: electedOn === '2019-11-15' ? 'TW-PEN-14-2' : 'TW-PEN-14-3',
			description:
				electedOn === '2019-11-15'
					? 'A non-professional foreign permanent resident (PR since 2018, serving since 2017) who elected the old system in writing on 15 November 2019, the last day of the window: no 勞退 6%, the reserve at 6%, no 就保.'
					: 'The same worker electing on 16 November 2019, one day after the window closed: the run is refused, not zero-charged.',
			citation: [
				...EVERY,
				'BLI old/new pension transition guide §6 (https://www.bli.gov.tw/en/0010369.html): other foreign permanent residents are on the new system from 2019-05-17; one already resident and serving the same unit before that date could elect the old system in writing within six months — before 2019-11-16 (勞工退休金條例 §9 as amended 108-05-15).',
				'就業保險法 §5(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050021): a non-professional permanent resident who is not an ROC spouse is outside 就保.',
				electedOn === '2019-11-15'
					? '40,100: 922 / 3,228, 622 / 1,940, 災保 48; §56(1) reserve 6% × 40,000 = 2,400. Net 40,000 − 1,544 = 38,456; employer 7,616.'
					: 'Tracker TW-SCOPE-02: NOT_REGISTERED without a lawful exclusion refuses the run.'
			],
			company: { facts: { pension_reserve_rate: 6 } },
			period: '2026-03',
			...(electedOn === '2019-11-16'
				? { refused: 'NOT_REGISTERED does not establish an old-system' }
				: {}),
			people: [
				citizen(
					'kim',
					'Kim Min-jun',
					40_000,
					{ LI: 40_100, NHI: 40_100, OCC_INJURY: 40_100 },
					{
						nationality: 'Korean',
						born: '1982-02-02',
						hired: '2017-01-01',
						terms: {
							residency_status: 'PERMANENT_RESIDENT',
							residency_since: '2018-01-01',
							pass_type: 'OTHER'
						},
						standing: {
							EI: {
								kind: 'NOT_REGISTERED',
								reason: 'Non-professional PR, not an ROC spouse: outside 就業保險法 §5',
								declaration_reference: 'PROBE-PR-NONPROFESSIONAL-NONSPOUSE-BLI-CLASS',
								elections: { pr_nonprofessional_excluded: true }
							},
							LABOR_PENSION: {
								kind: 'NOT_REGISTERED',
								reason: 'LSA old system elected in writing',
								declaration_reference: `PROBE-WRITTEN-OLD-ELECTION-${electedOn}-SAME-UNIT`,
								elections: {
									pr_old_transition_class: 'FOREIGN_NONPROFESSIONAL_2019',
									pr_old_election_on: electedOn
								}
							}
						}
					}
				)
			],
			expected:
				electedOn === '2019-11-15'
					? {
							kim: {
								gross: 40_000,
								net: 38_456,
								employer_cost: 7616,
								'LI.employee': 922,
								'LI.employer': 3228,
								'NHI.employee': 622,
								'NHI.employer': 1940,
								'OCC_INJURY.employer': 48,
								'LABOR_PENSION_RESERVE.employer': 2400
							}
						}
					: {}
		})
	),
	tw({
		id: 'TW-SCOPE-02-2',
		description:
			'A citizen whose 勞退 is recorded NOT_REGISTERED with no old-system, private-school or other exclusion: the run is refused rather than the compulsory 6% waived.',
		citation: [
			`${PENSION_ACT} §6(1), §7(1), §14(1): 雇主應為 … 本國籍人員 … 提繳 … 不得低於勞工每月工資百分之六 — a compulsory charge; only the §8–§9 old-system retention or a §7 exclusion lifts it.`,
			'Tracker TW-SCOPE-02: an unregistered compulsory scheme without a lawful exemption refuses payroll.'
		],
		period: '2026-03',
		refused: 'NOT_REGISTERED does not establish an old-system',
		people: [
			citizen('pao', 'Pao Chen-yu', 40_000, all(40_100), {
				standing: {
					LABOR_PENSION: { kind: 'NOT_REGISTERED', reason: 'Not yet declared to BLI' }
				}
			})
		],
		expected: {}
	}),
	tw({
		id: 'TW-EI-02-2',
		description:
			'A foreign professional employed since 2024 is granted permanent residence on 16 March 2026: 就保 starts that day, fifteen insured days of March; every other leg is the whole month.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			'外國專業人才延攬及僱用法 §25 (https://theme.ndc.gov.tw/lawout/LawContent.aspx?id=GL000273) and BLI (https://www.bli.gov.tw/0109624.html): a foreign professional holding permanent residence is insured under 就保 — from the day residence is granted; before it, outside 就業保險法 §5.',
			'就保 45,800 × 1% × 15/30: 91.60 → 45.80 → 46; 320.60 → 160.30 → 160. 勞保 ceiling 1,053 / 3,687; 健保 60,800: 943 / 2,942; 勞退 3,648 (foreign professional, new system from 2026); 災保 73. 5% × 60,000 = 3,000.',
			'Gross 60,000 (two terms rows at one rate); net 60,000 − (1,053 + 46 + 943 + 3,000) = 54,958; employer 3,687 + 160 + 2,942 + 3,648 + 73 = 10,510.'
		],
		period: '2026-03',
		people: [
			citizen('garcia', 'Lucia Garcia', 60_000, all(45_800, 60_800), {
				gender: 'FEMALE',
				nationality: 'Spanish',
				born: '1987-03-03',
				tax: FIVE,
				terms: { pass_type: 'EMPLOYMENT_PASS' },
				termsRows: [
					{
						residency_status: 'FOREIGNER',
						effective_range: { from: '2024-02-01', to: '2026-03-15' }
					},
					{
						residency_status: 'PERMANENT_RESIDENT',
						residency_since: '2026-03-16',
						effective_range: { from: '2026-03-16', to: null }
					}
				],
				elections: { LABOR_PENSION: { professional_work_class: 'FOREIGN_PROFESSIONAL' } },
				standing: {
					EI: dated(
						'2024-02-01',
						[
							'',
							'2026-03-15',
							{
								kind: 'NOT_REGISTERED',
								reason: 'Foreigner without permanent residence: outside 就業保險法 §5',
								declaration_reference: 'PROBE-ARC-NO-APRC',
								elections: { foreign_worker_excluded: true }
							}
						],
						[
							'2026-03-16',
							null,
							{
								kind: 'REGISTERED',
								since: '2026-03-16',
								elections: {
									eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
									eligibility_document_reference: 'PROBE-APRC-2026-03-16-AND-PROFESSIONAL-PERMIT'
								}
							}
						]
					)
				}
			})
		],
		expected: {
			garcia: {
				gross: 60_000,
				net: 54_958,
				employer_cost: 10_510,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 46,
				'EI.employer': 160,
				'NHI.employee': 943,
				'NHI.employer': 2942,
				'LABOR_PENSION.employer': 3648,
				'OCC_INJURY.employer': 73,
				'INCOME_TAX.employee': 3000
			}
		}
	}),
	tw({
		id: 'TW-NHI-10-2',
		description:
			'The raise of TW-NHI-10-1 (NT$40,000 → 48,000 on 16 March 2026), notified in March: from 1 April every insured grade moves — 勞保/就保 45,800, 健保/勞退/災保 48,200.',
		citation: [
			...EVERY,
			'勞工保險條例 §14(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050001&flno=14): 月投保薪資 … 調整 … 自申報之次月一日生效; 勞工退休金條例 §15(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030020&flno=15): 自通知調整之次月一日起 … 調整提繳; NHIA (https://www.nhi.gov.tw/ch/cp-3204-6ecca-2568-1.html) and 勞工職業災害保險及保護法 §17 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050031): the adjusted amount from the first of the next month.',
			'April on 48,000: 勞保 1,053 / 3,687; 就保 92 / 321; 健保 748 / 2,332; 勞退 2,892; 災保 57.84 → 58. The table withholds nothing. Net 48,000 − 1,893 = 46,107; employer 9,290.'
		],
		period: '2026-04',
		people: [
			citizen('chu2', 'Chu Ya-ting', 40_000, all(40_100), {
				gender: 'FEMALE',
				termsRows: [
					{ base_salary: 40_000, effective_range: { from: '2024-02-01', to: '2026-03-15' } },
					{ base_salary: 48_000, effective_range: { from: '2026-03-16', to: null } }
				],
				standing: Object.fromEntries(
					(
						[
							['LI', 45_800],
							['EI', 45_800],
							['WAGE_ARREARS_BASE', 45_800],
							['NHI', 48_200],
							['LABOR_PENSION', 48_200],
							['OCC_INJURY', 48_200]
						] as const
					).map(
						([code, grade]) =>
							[
								code,
								dated(
									'2024-02-01',
									['', '2026-03-31', { kind: 'REGISTERED', elections: { insured_amount: 40_100 } }],
									[
										'2026-04-01',
										null,
										{
											kind: 'REGISTERED',
											elections: {
												insured_amount: grade,
												notification_reference: 'PROBE-BLI-ADJUSTMENT-2026-03'
											}
										}
									]
								)
							] as const
					)
				)
			})
		],
		expected: {
			chu2: {
				gross: 48_000,
				net: 46_107,
				employer_cost: 9290,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 748,
				'NHI.employer': 2332,
				'LABOR_PENSION.employer': 2892,
				'OCC_INJURY.employer': 58
			}
		}
	}),
	tw({
		id: 'TW-PEN-12-2',
		description:
			'A voluntary 勞退 rate raised from 3% to 6%, filed in March: April charges the new 6% (3,036) beside the unit’s 6% on the 50,600 grade.',
		citation: [
			...EVERY,
			`${PENSION_ACT} §14(3): 得在其每月工資百分之六範圍內，自願提繳; BLI 自願提繳 FAQ (https://www.bli.gov.tw/0017599.html): a rate change takes effect from the first of the month after it is filed.`,
			'50,600: 勞退 3,036 each; 健保 785 / 2,449; 災保 61. The table withholds nothing (50,000 − 3,036 < 90,501). Net 50,000 − (1,053 + 92 + 785 + 3,036) = 45,034; employer 9,554.'
		],
		period: '2026-04',
		people: [
			citizen('wen', 'Wen Chia-hsin', 50_000, all(45_800, 50_600), {
				standing: {
					LABOR_PENSION: dated(
						'2024-02-01',
						['', '2026-03-31', { kind: 'REGISTERED', elections: { voluntary_rate: 3 } }],
						[
							'2026-04-01',
							null,
							{
								kind: 'REGISTERED',
								elections: {
									voluntary_rate: 6,
									notification_reference: 'PROBE-VOLUNTARY-6-FILED-2026-03'
								}
							}
						]
					)
				}
			})
		],
		expected: {
			wen: {
				gross: 50_000,
				net: 45_034,
				employer_cost: 9554,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 785,
				'NHI.employer': 2449,
				'LABOR_PENSION.employee': 3036,
				'LABOR_PENSION.employer': 3036,
				'OCC_INJURY.employer': 61
			}
		}
	}),
	tw({
		id: 'TW-PEN-08-2',
		description:
			'Back from a February of 育嬰留職停薪 on 1 March 2026: 勞保/就保/健保 continue, and 災保 and both 勞退 contributions resume at the prior 53,000 grade and the worker’s prior 6%.',
		citation: [
			...EVERY,
			`${PENSION_ACT} §20(2): 勞工 … 復職時，雇主應以書面向勞保局申報開始提繳; BLI (https://www.bli.gov.tw/0006915.html): 115年起 育嬰留職停薪 期滿 BLI resumes insurance and pension at the prior grade and rates.`,
			'53,000: 健保 2,740.10 × 30% = 822.03 → 822 / × 0.936 = 2,564.73 → 2,565; 勞退 3,180 each; 災保 63.60 → 64. The table withholds nothing.',
			'Net 52,000 − (1,053 + 92 + 822 + 3,180) = 46,853; employer 3,687 + 321 + 2,565 + 3,180 + 64 = 9,817.'
		],
		period: '2026-03',
		people: [
			citizen('hsieh2', 'Hsieh Yi-ling', 52_000, all(45_800, 53_000), {
				gender: 'FEMALE',
				hired: '2022-09-01',
				elections: { LABOR_PENSION: { voluntary_rate: 6 } },
				standing: Object.fromEntries([
					...(['LI', 'EI', 'NHI'] as const).map(
						(code) =>
							[
								code,
								dated(
									'2022-09-01',
									['', '2026-01-31', { kind: 'REGISTERED' }],
									[
										'2026-02-01',
										'2026-02-28',
										{ kind: 'REGISTERED', elections: { parental_leave: 'CONTINUED' } }
									],
									['2026-03-01', null, { kind: 'REGISTERED' }]
								)
							] as const
					),
					...(['OCC_INJURY', 'LABOR_PENSION'] as const).map(
						(code) =>
							[
								code,
								dated(
									'2022-09-01',
									['', '2026-01-31', { kind: 'REGISTERED' }],
									[
										'2026-02-01',
										'2026-02-28',
										{ kind: 'NOT_REGISTERED', reason: '育嬰留職停薪: stopped' }
									],
									['2026-03-01', null, { kind: 'REGISTERED' }]
								)
							] as const
					)
				])
			})
		],
		extra: (job) => [
			leave(job('hsieh2'), 'PARENTAL_LEAVE', 'PARENTAL-TW-HSIEH2', '2026-02-01', '2026-02-28')
		],
		expected: {
			hsieh2: {
				gross: 52_000,
				net: 46_853,
				employer_cost: 9817,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 822,
				'NHI.employer': 2565,
				'LABOR_PENSION.employee': 3180,
				'LABOR_PENSION.employer': 3180,
				'OCC_INJURY.employer': 64
			}
		}
	}),
	tw({
		id: 'TW-LEAVE-01-2',
		description:
			'The 年度終結 cash-out: four unused 特別休假 days at 31 December 2026 on NT$60,000 are paid at November’s normal wage ÷ 30.',
		citation: [
			...EVERY,
			`${SRC.lsa} §38(4): 勞工之特別休假，因年度終結或契約終止而未休之日數，雇主應發給工資; 勞動基準法施行細則 §24-1(2)(1)(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=24-1): 計月者 為年度終結 … 前最近一個月正常工作時間所得之工資除以三十 — 60,000 ÷ 30 × 4 = 8,000.`,
			'Grades 45,800 / 60,800 as TW-LEAVE-01-1 (still employed): net 68,000 − (1,053 + 92 + 943) = 65,912; employer 10,671. The table withholds nothing.'
		],
		period: '2026-12',
		people: [
			citizen('kang2', 'Kang Yu-chen', 60_000, all(45_800, 60_800), { hired: '2024-01-02' })
		],
		extra: (job) => [
			wageMonth(job('kang2'), '2026-11', '2026-11-30', 60_000),
			leave(job('kang2'), 'ANNUAL_LEAVE', 'YEAREND-TW-KANG2', '2026-01-01', '2026-12-31', {
				days: 4,
				encash_days: 4,
				effective_on: '2026-12-31',
				due_on: '2026-12-31'
			})
		],
		expected: {
			kang2: {
				gross: 68_000,
				net: 65_912,
				employer_cost: 10_671,
				ANNUAL_LEAVE_ENCASHMENT: 8000,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 943,
				'NHI.employer': 2942,
				'LABOR_PENSION.employer': 3648,
				'OCC_INJURY.employer': 73
			}
		}
	})
);

// ── Round 9b (2026-09-30): further branches the tracker names as unproven ─────────────────────────
const PR_EI_EXCLUDED: Standing = {
	kind: 'NOT_REGISTERED',
	reason: 'Non-professional PR, not an ROC spouse: outside 就業保險法 §5',
	declaration_reference: 'PROBE-PR-NONPROFESSIONAL-NONSPOUSE-BLI-CLASS',
	elections: { pr_nonprofessional_excluded: true }
};
const FP_EI_EXCLUDED: Standing = {
	kind: 'NOT_REGISTERED',
	reason: 'Foreigner without permanent residence: outside 就業保險法 §5',
	declaration_reference: 'PROBE-ARC-NO-APRC',
	elections: { foreign_worker_excluded: true }
};
const NHI_FORMULA =
	'全民健康保險保險費負擔金額表(三) (115.1.1生效, https://www.nhi.gov.tw/ch/cp-19418-9eefb-2576-1.html): 本人 = 投保金額 × 5.17% × 30%, 投保單位 = 投保金額 × 5.17% × 60% × (1 + 0.56), each to the 元 — the formula that reproduces every cell the cases above cite (50,600: 785 / 2,449; 72,800: 1,129 / 3,523; 80,200: 1,244 / 3,881)';

register(
	tw({
		id: 'TW-EXIT-03-2',
		description:
			'An old-system worker at a unit declaring a 16% reserve rate: outside the §56(1) 2–15% range, the run is refused rather than priced.',
		citation: [
			`${SRC.lsa} §56(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=56): 雇主應依勞工每月薪資總額百分之二至百分之十五範圍內，按月提撥勞工退休準備金 — 16% is not a rate the authority can approve.`,
			'Worker as TW-EXIT-03-1 (citizen since 2004, old system retained).'
		],
		company: { facts: { pension_reserve_rate: 16 } },
		period: '2026-03',
		refused: 'owes the monthly 勞工退休準備金 at the rate the authority approved',
		people: [
			citizen(
				'ku2',
				'Ku Wen-hsien',
				50_000,
				{ LI: 45_800, EI: 45_800, NHI: 50_600, OCC_INJURY: 50_600 },
				{ born: '1975-11-20', hired: '2004-03-01', standing: { LABOR_PENSION: OLD_SYSTEM } }
			)
		],
		expected: {}
	}),
	tw({
		id: 'TW-TAX-05-2',
		description:
			'The table on the month’s whole regular salary: NT$90,100 alone withholds 0, but with a NT$3,500 meal allowance the 500 above NT$3,000 joins it — 90,600 falls in the 90,501–91,000 cell, 2,020.',
		citation: [
			...EVERY,
			SRC.table,
			NHI_FORMULA,
			'MOF NM11BZY (https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/withheld-rule/rule/NM11BZY): 固定薪資 withholds on the month’s whole regular salary per the table; 營利事業所得稅查核準則 §88(2)(1) (https://law-out.mof.gov.tw/LawContent.aspx?id=FL006027): meal allowance over NT$3,000 a month is salary — 90,100 + 500 = 90,600 → 2,020.',
			'Grades on 93,600 of 工資: 勞保/就保 ceiling 1,053 / 3,687, 92 / 321; 健保 96,600: 4,994.22 × 30% = 1,498.27 → 1,498 / × 93.6% = 4,674.59 → 4,675; 勞退 96,600 × 6% = 5,796; 災保 72,800 → 87.',
			'Net 93,600 − (1,053 + 92 + 1,498 + 2,020) = 88,937; employer 3,687 + 321 + 4,675 + 5,796 + 87 = 14,566.'
		],
		period: '2026-03',
		people: [
			citizen('fang', 'Fang Chih-wei', 90_100, all(45_800, 96_600, 96_600, 72_800), {
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:MEAL_ALLOWANCE', amount: 3500 }]
				}
			})
		],
		expected: {
			fang: {
				gross: 93_600,
				net: 88_937,
				employer_cost: 14_566,
				BASIC: 90_100,
				MEAL_ALLOWANCE: 3500,
				'LI.employee': 1053,
				'LI.employer': 3687,
				'EI.employee': 92,
				'EI.employer': 321,
				'NHI.employee': 1498,
				'NHI.employer': 4675,
				'LABOR_PENSION.employer': 5796,
				'OCC_INJURY.employer': 87,
				'INCOME_TAX.employee': 2020
			}
		}
	}),
	tw({
		id: 'TW-ADMIN-11-1',
		description:
			'墊償 on the unit total: a whole-month worker on 42,000 and a joiner on 16 March on 45,800 (15 of 30 days) — 64,900 × 0.025% = 16.225 → 16, not 11 + 6 = 17 rounded per worker.',
		citation: [
			...EVERY,
			SRC.fivePercent,
			ARREARS,
			'BLI 積欠工資墊償基金 FAQ (https://www.bli.gov.tw/0110180.html, read 2026-09-30): 墊償提繳薪資 = 勞保投保薪資 × 在職天數 ÷ 30, summed for the unit, × 0.025%, 角以下四捨五入 on the total (its example: 140,970 → 35). 42,000 + 45,800 × 15/30 = 64,900 → 16.225 → 16.',
			'Worker 1, 42,000 on 42,000: 966 / 3,381; 84 / 294; 651 / 2,032; 勞退 2,520; 災保 50 — net 40,299; employer 8,277. Worker 2 as TW-WAGE-05-1: 24,000, net 22,717; employer 5,620.',
			`${NHI_EMPLOYER}: 66,000 paid is below the 87,800 insured, so no line.`
		],
		period: '2026-03',
		people: [
			citizen('tseng', 'Tseng Po-han', 42_000, all(42_000)),
			citizen('lee2', 'Lee Kuan-ting', 45_000, all(45_800), { hired: '2026-03-16', tax: FIVE })
		],
		companyLines: { 'WAGE_ARREARS_FUND.employer': 16 },
		expected: {
			tseng: {
				gross: 42_000,
				net: 40_299,
				employer_cost: 8277,
				'LI.employee': 966,
				'LI.employer': 3381,
				'EI.employee': 84,
				'EI.employer': 294,
				'NHI.employee': 651,
				'NHI.employer': 2032,
				'LABOR_PENSION.employer': 2520,
				'OCC_INJURY.employer': 50
			},
			lee2: {
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
		id: 'TW-NHI-05-2',
		description:
			'A part-timer at work every workday for two hours (10 a week, under 12) at NT$8,000 is still enrolled in 健保 by the employer at the 29,500 floor; 勞保/就保 at 11,100, 勞退 on 8,700.',
		citation: [
			...EVERY,
			'NHIA Q&A (https://www.nhi.gov.tw/ch/cp-2981-5ed58-3150-1.html, read 2026-09-30): 部分工時者 視同專任員工，應由雇主為其投保 when (1) 每個工作日到工者(不論工作時數) or (2) 每週工作時數滿12小時.',
			'Floor 29,500 × 10/40 = 7,375 < 8,000. 11,100: 勞保 255 / 894; 就保 22 / 78. 勞退 8,700 (7,501–8,700) × 6% = 522. 健保 458 / 1,428. 災保 35.',
			'Net 8,000 − (255 + 22 + 458) = 7,265; employer 894 + 78 + 1,428 + 522 + 35 = 2,957.'
		],
		period: '2026-03',
		people: [
			citizen(
				'yu',
				'Yu Hsiao-ling',
				8000,
				{ LI: 11_100, EI: 11_100, NHI: 29_500, LABOR_PENSION: 8700, OCC_INJURY: 29_500 },
				{
					gender: 'FEMALE',
					terms: {
						employment_type: 'PART_TIME',
						ordinary_hours_per_week: 10,
						working_days_per_week: 5
					}
				}
			)
		],
		expected: {
			yu: {
				gross: 8000,
				net: 7265,
				employer_cost: 2957,
				'LI.employee': 255,
				'LI.employer': 894,
				'EI.employee': 22,
				'EI.employer': 78,
				'NHI.employee': 458,
				'NHI.employer': 1428,
				'LABOR_PENSION.employer': 522,
				'OCC_INJURY.employer': 35
			}
		}
	}),
	...(['2026-06-30', '2026-07-01'] as const).map((electedOn) =>
		tw({
			id: electedOn === '2026-06-30' ? 'TW-PEN-02-2' : 'TW-PEN-02-3',
			description:
				electedOn === '2026-06-30'
					? 'A non-PR foreign professional employed since 2023 elects the old system in writing on 30 June 2026, the last day: July 2026 has no 勞退 6%; the unit’s §56 reserve at 5%.'
					: 'The same professional electing on 1 July 2026, after the window: the run is refused, not zero-charged (the unit owes 勞退 from 1 January 2026).',
			citation: [
				...EVERY,
				SRC.fivePercent,
				'BLI 2026 notice (https://www.bli.gov.tw/0109916.html, read 2026-09-30): 修法前已受僱者 應於修法施行之日起6個月內(即115年6月30日前)，以書面向雇主表明 選擇繼續適用舊制; otherwise 雇主 應於115年7月15日前 向勞保局申報，溯自115年1月1日起提繳 (外國專業人才延攬及僱用法 §11, https://theme.ndc.gov.tw/lawout/LawContent.aspx?id=GL000273).',
				electedOn === '2026-06-30'
					? '勞動基準法 §56(1) reserve 70,000 × 5% = 3,500. 勞保 ceiling 1,053 / 3,687; no 就保 (就業保險法 §5); 健保 72,800: 1,129 / 3,523; 災保 72,800 → 87. 5% × 70,000 = 3,500. Net 70,000 − (1,053 + 1,129 + 3,500) = 64,318; employer 3,687 + 3,523 + 87 + 3,500 = 10,797.'
					: 'Tracker TW-SCOPE-02: NOT_REGISTERED without a lawful exclusion refuses the run.'
			],
			company: { facts: { pension_reserve_rate: 5 } },
			period: '2026-07',
			...(electedOn === '2026-07-01'
				? { refused: 'NOT_REGISTERED does not establish an old-system' }
				: {}),
			people: [
				citizen(
					'smith',
					'Emma Smith',
					70_000,
					{ LI: 45_800, NHI: 72_800, OCC_INJURY: 72_800 },
					{
						gender: 'FEMALE',
						nationality: 'Canadian',
						born: '1985-04-12',
						hired: '2023-04-03',
						tax: FIVE,
						terms: { residency_status: 'FOREIGNER', pass_type: 'EMPLOYMENT_PASS' },
						standing: {
							EI: FP_EI_EXCLUDED,
							LABOR_PENSION: {
								kind: 'NOT_REGISTERED',
								reason: 'LSA old system elected in writing',
								declaration_reference: `PROBE-WRITTEN-OLD-ELECTION-${electedOn}-FOREIGN-PROFESSIONAL`,
								elections: {
									professional_work_class: 'FOREIGN_PROFESSIONAL',
									professional_old_election_on: electedOn
								}
							}
						}
					}
				)
			],
			expected:
				electedOn === '2026-06-30'
					? {
							smith: {
								gross: 70_000,
								net: 64_318,
								employer_cost: 10_797,
								'LI.employee': 1053,
								'LI.employer': 3687,
								'NHI.employee': 1129,
								'NHI.employer': 3523,
								'OCC_INJURY.employer': 87,
								'LABOR_PENSION_RESERVE.employer': 3500,
								'INCOME_TAX.employee': 3500
							}
						}
					: {}
		})
	),
	...(['2024-08-31', '2024-09-01'] as const).map((electedOn) =>
		tw({
			id: electedOn === '2024-08-31' ? 'TW-PEN-15-1' : 'TW-PEN-15-2',
			description:
				electedOn === '2024-08-31'
					? 'A foreign worker serving the unit since 2017 is granted permanent residence on 1 March 2024 and elects the old system in writing on 31 August 2024: no 勞退 6%, the reserve at 6%, no 就保.'
					: 'The same worker electing on 1 September 2024, six months after the grant: the run is refused.',
			citation: [
				...EVERY,
				`${PENSION_ACT} §8-1 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030020&flno=8-1): (1)(3) 於各該修正條文施行後始取得各該身分者，為取得身分之日; (2) 施行前已受僱且仍服務於同一事業單位者，於適用本條例之日起六個月內，得以書面向雇主表明選擇繼續適用勞動基準法之退休金規定 — the 108-04-26 amendment took effect 2019-05-17; the recorded default window is [grant, grant + 6 months).`,
				'就業保險法 §5(1) (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050021): a non-professional permanent resident who is not an ROC spouse is outside 就保.',
				electedOn === '2024-08-31'
					? '40,100: 922 / 3,228, 622 / 1,940, 災保 48; §56(1) reserve 6% × 40,000 = 2,400. Net 40,000 − 1,544 = 38,456; employer 7,616.'
					: 'Tracker TW-SCOPE-02: NOT_REGISTERED without a lawful exclusion refuses the run.'
			],
			company: { facts: { pension_reserve_rate: 6 } },
			period: '2026-03',
			...(electedOn === '2024-09-01'
				? { refused: 'NOT_REGISTERED does not establish an old-system' }
				: {}),
			people: [
				citizen(
					'nguyen',
					'Nguyen Van An',
					40_000,
					{ LI: 40_100, NHI: 40_100, OCC_INJURY: 40_100 },
					{
						nationality: 'Vietnamese',
						born: '1984-06-06',
						hired: '2017-01-01',
						terms: {
							residency_status: 'PERMANENT_RESIDENT',
							residency_since: '2024-03-01',
							pass_type: 'OTHER'
						},
						standing: {
							EI: PR_EI_EXCLUDED,
							LABOR_PENSION: {
								kind: 'NOT_REGISTERED',
								reason: 'LSA old system elected in writing after a later PR grant',
								declaration_reference: `PROBE-PR-2024-03-01-WRITTEN-OLD-ELECTION-${electedOn}-SAME-UNIT`,
								elections: {
									pr_old_transition_class: 'FOREIGN_LATER_PR_GRANT',
									pr_old_election_on: electedOn
								}
							}
						}
					}
				)
			],
			expected:
				electedOn === '2024-08-31'
					? {
							nguyen: {
								gross: 40_000,
								net: 38_456,
								employer_cost: 7616,
								'LI.employee': 922,
								'LI.employer': 3228,
								'NHI.employee': 622,
								'NHI.employer': 1940,
								'OCC_INJURY.employer': 48,
								'LABOR_PENSION_RESERVE.employer': 2400
							}
						}
					: {}
		})
	)
);

// ── Round 10 (2026-09-30): compulsory-scheme refusals, employer pension rate, welfare fund, §54 retirement ──
const WELFARE_ACT =
	'職工福利金條例 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0040001, 最後修正 104-07-01, read 2026-09-30)';
/** A citizen on NT$40,000 whose `code` fact is NOT_REGISTERED with no lawful exclusion: the run is refused. */
const unexempt = (
	id: string,
	code: 'LI' | 'EI' | 'NHI' | 'OCC_INJURY',
	law: string,
	refused: string
): ProbeCase =>
	tw({
		id,
		description: `A 35-year-old citizen at an ordinary unit whose ${code} is recorded NOT_REGISTERED with no recorded exclusion: the run is refused rather than the compulsory charge waived.`,
		citation: [
			law,
			'Tracker TW-SCOPE-02: an unregistered compulsory scheme without a lawful exemption refuses payroll.'
		],
		period: '2026-03',
		refused,
		people: [
			citizen('hsu3', 'Hsu Ming-che', 40_000, all(40_100), {
				born: '1990-05-10',
				standing: {
					[code]: { kind: 'NOT_REGISTERED', reason: 'Not yet declared to the insurer' }
				} as Person['standing']
			})
		],
		expected: {}
	});

register(
	unexempt(
		'TW-SCOPE-02-3',
		'LI',
		'勞工保險條例 §6(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050001&flno=6, read 2026-09-30): 年滿十五歲以上，六十五歲以下之左列勞工，應以其雇主 … 為投保單位，全部參加勞工保險為被保險人 — no unit-class or age exclusion is recorded.',
		'NOT_REGISTERED does not prove a noncompulsory employer or worker class'
	),
	unexempt(
		'TW-SCOPE-02-4',
		'EI',
		'就業保險法 §5(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050021&flno=5, read 2026-09-30): 年滿十五歲以上，六十五歲以下之下列受僱勞工，應以其雇主 … 為投保單位，參加本保險為被保險人 — a citizen employee.',
		'NOT_REGISTERED does not prove an exclusion'
	),
	unexempt(
		'TW-SCOPE-02-5',
		'NHI',
		'全民健康保險法 §10(1)(1)(二) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=L0060001&flno=10, read 2026-09-30): 第一類 公、民營事業、機構之受僱者 — insured through this employer unless another unit or class is evidenced.',
		'NOT_REGISTERED at this active employment does not prove insurance through another unit'
	),
	unexempt(
		'TW-SCOPE-02-6',
		'OCC_INJURY',
		'勞工職業災害保險及保護法 §6(1)(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050031&flno=6, read 2026-09-30): 年滿十五歲以上之下列勞工，應以其雇主為投保單位，參加本保險為被保險人: 受僱於 … 依法已辦理登記、設有稅籍 … 之雇主 — regardless of headcount.',
		'NOT_REGISTERED does not establish an employer/worker exception'
	),
	tw({
		id: 'TW-PEN-01-2',
		description:
			'An employer that declared an 8% 勞退 rate for a citizen on NT$40,000: 40,100 × 8% = 3,208, above the statutory 6% floor; the worker’s side is unchanged.',
		citation: [
			...EVERY,
			`${PENSION_ACT} §14(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030020&flno=14, read 2026-09-30): 雇主應為第七條第一項規定之勞工負擔提繳之退休金，不得低於勞工每月工資百分之六 — a floor, so a declared higher rate is paid as declared.`,
			'40,100 (as TW-EXIT-05-2): 勞保 922 / 3,228; 就保 80 / 281; 健保 622 / 1,940; 災保 48. 勞退 40,100 × 8% = 3,208. The table withholds nothing.',
			'Net 40,000 − (922 + 80 + 622) = 38,376; employer 3,228 + 281 + 1,940 + 3,208 + 48 = 8,705.'
		],
		period: '2026-03',
		people: [
			citizen('lu3', 'Lu Chia-wen', 40_000, all(40_100), {
				elections: { LABOR_PENSION: { employer_rate: 8 } }
			})
		],
		expected: {
			lu3: {
				gross: 40_000,
				net: 38_376,
				employer_cost: 8705,
				'LI.employee': 922,
				'LI.employer': 3228,
				'EI.employee': 80,
				'EI.employer': 281,
				'NHI.employee': 622,
				'NHI.employer': 1940,
				'LABOR_PENSION.employer': 3208,
				'OCC_INJURY.employer': 48
			}
		}
	}),
	tw({
		id: 'TW-WELFARE-01-1',
		description:
			'An entity with an established 職工福利委員會: a citizen on NT$36,000 has 0.5% of the month’s 薪津, 180, withheld for the 職工福利金; every other line is as TW-LEAVE-05-2.',
		citation: [
			...EVERY,
			`${WELFARE_ACT} §1: 凡公營、私營之工廠、礦場或其他企業組織，均應提撥職工福利金; §2(1)(3): 每月於每個職員工人薪津內各扣百分之○‧五 — 36,000 × 0.5% = 180. Tracker TW-WELFARE-01 defaults (law silent): 薪津 is the month’s salary net of unpaid days, rounded to the 元.`,
			'36,300: 835 / 2,922, 73 / 254, 563 / 1,757, 勞退 2,178, 災保 44. The table withholds nothing (所得稅法 §14 excludes no welfare deduction).',
			'Net 36,000 − (835 + 73 + 563 + 180) = 34,349; employer 7,155.'
		],
		company: { facts: { welfare_committee_established: true } },
		period: '2026-03',
		people: [citizen('wei3', 'Wei Shu-fen', 36_000, all(36_300), { gender: 'FEMALE' })],
		expected: {
			wei3: {
				gross: 36_000,
				net: 34_349,
				employer_cost: 7155,
				'WELFARE_FUND.employee': 180,
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
		id: 'TW-EXIT-06-3',
		description:
			'An art. 54(1)(2) forced retirement for a disability NOT caused by duty on 15 March 2026: aged 44 with 22 old-system years (no age/service ground of its own), 30 + 7 = 37 bases, no 20% — 1,655,801.',
		citation: [
			...EVERY,
			`${SRC.lsa} §54(1)(2): 身心障礙不堪勝任工作者 may be retired; §55(1)(1): 每滿一年給與兩個基數 … 超過十五年 … 每滿一年給與一個基數; §55(1)(2): the 20% is added only where the disability is 因執行職務所致 (${LSA_ALL}).`,
			'264 months = 22 years → 15 × 2 + 7 = 37 bases × 1.0; 270,000 ÷ 181 × 30 × 37 = 1,655,801.10 → 1,655,801.',
			'所得稅法 §14(1) 第九類: 22 × 206,000 exempt, no withholding. §56(1) reserve 2% × 22,500 = 450. 15 insured days on 45,800: 527 / 1,843, 46 / 160, 災保 27; no 健保 in the withdrawal month.',
			'Gross 22,500 + 1,655,801 = 1,678,301; net 1,677,728; employer 1,843 + 160 + 27 + 450 = 2,480.'
		],
		company: { facts: { pension_reserve_rate: 2 } },
		period: '2026-03',
		people: [
			citizen(
				'tu3',
				'Tu Kuo-hua',
				45_000,
				{ LI: 45_800, EI: 45_800, NHI: 45_800, OCC_INJURY: 45_800 },
				{
					born: '1981-06-01',
					hired: '2004-03-16',
					left: '2026-03-15',
					exit_ground: 'RETIREMENT',
					exit_facts: {
						average_daily_wage: 270_000 / 181,
						old_system_service_months: 264,
						retirement_disability: true,
						retirement_disability_duty_caused: false
					},
					standing: { LABOR_PENSION: OLD_SYSTEM }
				}
			)
		],
		extra: (job) => [
			adhoc(job('tu3'), 'RETIREMENT_PAY', 0, '2026-03-15', 'RETIREMENT_PAY on departure 2026-03-15')
		],
		expected: {
			tu3: {
				gross: 1_678_301,
				net: 1_677_728,
				employer_cost: 2480,
				RETIREMENT_PAY: 1_655_801,
				'LI.employee': 527,
				'LI.employer': 1843,
				'EI.employee': 46,
				'EI.employer': 160,
				'OCC_INJURY.employer': 27,
				'LABOR_PENSION_RESERVE.employer': 450
			}
		}
	})
);

const HOLIDAY_ACT =
	'紀念日及節日實施條例 (https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095, 公布 114-05-28, read 2026-09-30)';
/** The TW-HOURS-02-1 worker on NT$54,000 (5% election, 55,400 健保/勞退 grade); `holiday` is the §39 day. */
const holidaySlip = (holiday: number) => ({
	gross: 54_000 + holiday,
	net: 54_000 + holiday - (1053 + 92 + 859 + 2700),
	employer_cost: 10_079,
	...(holiday === 0 ? {} : { OVERTIME: holiday }),
	'LI.employee': 1053,
	'LI.employer': 3687,
	'EI.employee': 92,
	'EI.employer': 321,
	'NHI.employee': 859,
	'NHI.employer': 2681,
	'LABOR_PENSION.employer': 3324,
	'OCC_INJURY.employer': 66,
	'INCOME_TAX.employee': 2700
});
const HOLIDAY_PAY = [
	...EVERY,
	SRC.fivePercent,
	`${SRC.lsa} §37(1): 內政部所定應放假之紀念日、節日 … 均應休假; §39: 第三十七條所定之休假 … 工資應由雇主照給。雇主經徵得勞工同意於休假日工作者，工資應加倍發給 — a further day’s wage, 54,000 ÷ 30 = 1,800.`,
	'Grades as TW-HOURS-02-1: 勞保 ceiling 1,053 / 3,687, 92 / 321; 健保 55,400: 859 / 2,681; 勞退 3,324; 災保 66. 5% × 54,000 = 2,700 (holiday pay within the standard is not 薪資收入).'
];

register(
	tw({
		id: 'TW-HOURS-04-1',
		description:
			'教師節 on Monday 28 September 2026, a holiday the 2025 Act added: the worker who rests keeps the whole month’s wage; the one who works it with consent is paid a further day, 1,800.',
		citation: [
			...HOLIDAY_PAY,
			`${HOLIDAY_ACT} §6: 兒童節、清明節、勞動節、端午節、教師節及中秋節：均放假一日; §3/§4: 孔子誕辰紀念日 (九月二十八日) 放假一日.`,
			'Resting: 54,000, net 49,296. Working: 55,800, net 51,096. Employer 10,079 each.'
		],
		period: '2026-09',
		people: [
			citizen('lo3', 'Lo Chia-hui', 54_000, all(45_800, 55_400), { tax: FIVE }),
			citizen('pan3', 'Pan Yu-ting', 54_000, all(45_800, 55_400), { tax: FIVE, gender: 'FEMALE' })
		],
		extra: (job) => [
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-09-28',
					name: '教師節（孔子誕辰紀念日）',
					kind: 'PUBLIC_HOLIDAY',
					published_at: '2025-12-01T00:00:00.000Z'
				}
			},
			asked(worked(job('pan3'), '2026-09-28', ['09:00', '12:00'], ['13:00', '18:00']), 8)
		],
		expected: { lo3: holidaySlip(0), pan3: holidaySlip(1800) }
	}),
	tw({
		id: 'TW-HOURS-06-1',
		description:
			'臺灣光復暨金門古寧頭大捷紀念日 falls on Sunday 25 October 2026, the 例假: the holiday is carried to Monday 26 October (補假), so work on that Monday is paid a further day, 1,800.',
		citation: [
			...HOLIDAY_PAY,
			`${HOLIDAY_ACT} §4(5): 臺灣光復暨金門古寧頭大捷紀念日 放假一日; §8: 紀念日及節日之放假日逢例假日者，應予補假. Tracker TW-HOURS-06 default (law silent on the date): the 補假 is the next working day unless the entity publishes another agreed replacement (work_rules.holiday_rest_precedence SUBSTITUTE).`,
			'Gross 55,800; net 51,096; employer 10,079.'
		],
		period: '2026-10',
		people: [citizen('chu3', 'Chu Wei-lun', 54_000, all(45_800, 55_400), { tax: FIVE })],
		extra: (job) => [
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-10-25',
					name: '臺灣光復暨金門古寧頭大捷紀念日',
					kind: 'PUBLIC_HOLIDAY',
					published_at: '2025-12-01T00:00:00.000Z'
				}
			},
			asked(worked(job('chu3'), '2026-10-26', ['09:00', '12:00'], ['13:00', '18:00']), 8)
		],
		expected: { chu3: holidaySlip(1800) }
	})
);

const BONUS = {
	allowances: [{ catalogue_id: '@law:allowance_catalogue:FULL_ATTENDANCE_BONUS', amount: 3000 }]
};
const bonusSlip = (gross: number, bonus: number) => ({
	gross,
	net: gross - (922 + 80 + 622),
	employer_cost: 7903,
	FULL_ATTENDANCE_BONUS: bonus,
	'LI.employee': 922,
	'LI.employer': 3228,
	'EI.employee': 80,
	'EI.employer': 281,
	'NHI.employee': 622,
	'NHI.employer': 1940,
	'LABOR_PENSION.employer': 2406,
	'OCC_INJURY.employer': 48
});

register(
	tw({
		id: 'TW-LEAVE-04-1',
		description:
			'A NT$3,000 全勤獎金 on NT$36,000: two 普通傷病假 days take only 3,000 ÷ 30 × 2 = 200 of it; two 公假 days take nothing.',
		citation: [
			...EVERY,
			`${LEAVE_RULES} §9: (1)(1) 勞工請婚假、喪假、公傷病假及公假 雇主不得視為缺勤而影響其全勤獎金; (2) 普通傷病假 … 全勤獎金之扣發，應按請普通傷病假日數依比例計算. MOL Q&A (https://www.mol.gov.tw/1607/28162/28166/28180/86983/87103/post, read 2026-09-30): 3,000 元 全勤獎金, 病假一天 → 扣除不得超過100元【3,000元÷30日】.`,
			`${LEAVE_RULES} §4(3): 普通傷病假 工資折半 — 2 × 36,000 ÷ 30 × ½ = 1,200 off the salary.`,
			'39,000 of 工資 → 40,100 (as TW-EXIT-05-2): 922 / 3,228, 80 / 281, 622 / 1,940, 勞退 2,406, 災保 48. The table withholds nothing.',
			'Sick: 34,800 + 2,800 = 37,600, net 35,976. 公假: 36,000 + 3,000 = 39,000, net 37,376. Employer 7,903 each.'
		],
		period: '2026-03',
		people: [
			citizen('sun3', 'Sun Hui-ling', 36_000, all(40_100), { gender: 'FEMALE', terms: BONUS }),
			citizen('ho3', 'Ho Chien-hung', 36_000, all(40_100), { terms: BONUS })
		],
		extra: (job) => [
			leave(job('sun3'), 'SICK_LEAVE', 'SICK-TW-SUN3', '2026-03-10', '2026-03-11'),
			leave(job('ho3'), 'OFFICIAL_LEAVE', 'OFFICIAL-TW-HO3', '2026-03-10', '2026-03-11')
		],
		expected: { sun3: bonusSlip(37_600, 2800), ho3: bonusSlip(39_000, 3000) }
	})
);

// ── Phase 2 (2026-10-01): stored checks at the first terms, a DEDUCTION warning, the obligation ledger ─────────
/** NT$36,000 for a whole month on the 36,300 grades (the figures of TW-WAGE-06-1 before its garnishment). */
const PLAIN_36: Readonly<Record<string, number>> = {
	gross: 36_000,
	net: 34_529,
	total_deductions: 1471,
	employer_cost: 7155,
	BASIC: 36_000,
	'LI.employee': 835,
	'LI.employer': 2922,
	'EI.employee': 73,
	'EI.employer': 254,
	'NHI.employee': 563,
	'NHI.employer': 1757,
	'LABOR_PENSION.employer': 2178,
	'OCC_INJURY.employer': 44
};
const PLAIN_36_CITED =
	'Grades 36,300, the whole of March from the 1st: 勞保 36,300 × 11.5% = 4,174.50 → × 20% = 834.90 → 835, × 70% = 2,922.15 → 2,922; 就保 363 → 72.60 → 73, 254.10 → 254; 健保 563 / 1,757 (表(三)); 勞退 36,300 × 6% = 2,178; 災保 36,300 × 0.12% = 43.56 → 44; the table withholds nothing. Net 36,000 − (835 + 73 + 563) = 34,529; employer 2,922 + 254 + 1,757 + 2,178 + 44 = 7,155.';
const CONSENT = { guardian_consent_reference: 'PROBE-GUARDIAN-CONSENT-AND-AGE-PROOF' };

register(
	tw({
		id: 'TW-HIRE-05-1',
		description:
			'Minors hired on 1 March 2026: a 16-year-old’s first terms are refused until the guardian’s consent is on file; a 14-year-old’s until the §45(1) exception is recorded. Both are then paid the whole month; the 14-year-old outside 就保 (under fifteen) but inside 勞保, 災保, 健保 and 勞退.',
		citation: [
			...EVERY,
			`${SRC.lsa} §46: 未滿十八歲之人受僱從事工作者，雇主應置備其法定代理人同意書及其年齡證明文件 — born 2009-06-01, 16 on 2026-03-01: refused without guardian_consent_reference.`,
			`${SRC.lsa} §45(1): 雇主不得僱用未滿十五歲之人從事工作。但國民中學畢業或經主管機關認定…而許可者，不在此限 — born 2011-06-01, 14 all March: refused without under_15_exception_reference; with it (and the consent) the terms stand.`,
			'勞工保險條例 §6(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050001&flno=6): 前項規定，於經主管機關認定其工作性質及環境無礙身心健康之未滿十五歲勞工亦適用之 — 勞保 covers the permitted 14-year-old; 就業保險法 §5(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050021&flno=5): 年滿十五歲以上 — 就保 does not (NOT_REGISTERED, zero).',
			PLAIN_36_CITED,
			'The 14-year-old: 36,000 − (835 + 563) = 34,602; employer 2,922 + 1,757 + 2,178 + 44 = 6,901.'
		],
		period: '2026-03',
		people: [
			citizen('teen16', 'Lai Yu-chen', 36_000, all(36_300), {
				born: '2009-06-01',
				hired: '2026-03-01',
				terms: { facts: CONSENT }
			}),
			citizen('teen14', 'Pan Chia-hao', 36_000, all(36_300), {
				born: '2011-06-01',
				hired: '2026-03-01',
				terms: {
					facts: { ...CONSENT, under_15_exception_reference: 'PROBE-AUTHORITY-PERMIT-115-0001' }
				},
				standing: {
					EI: { kind: 'NOT_REGISTERED', reason: '就業保險法 §5(1): under fifteen' }
				}
			})
		],
		attempts: {
			teen16: [{ terms: { facts: {} }, refused: 'under eighteen at hire' }],
			teen14: [{ terms: { facts: CONSENT }, refused: 'under fifteen at hire' }]
		},
		expected: {
			teen16: PLAIN_36,
			teen14: {
				...PLAIN_36,
				net: 34_602,
				total_deductions: 1398,
				employer_cost: 6901,
				'EI.employee': 0,
				'EI.employer': 0
			}
		}
	}),
	tw({
		id: 'TW-HIRE-01-1',
		description:
			'A fixed-term (CONTRACT) hire from 1 March to 30 November 2026: refused with no fixed-term category, refused as TEMPORARY (over six months), accepted as SEASONAL (nine months at most); March is paid whole.',
		citation: [
			...EVERY,
			`${SRC.lsa} §9(1): 臨時性、短期性、季節性及特定性工作得為定期契約；有繼續性工作應為不定期契約 — no category, refused.`,
			'勞動基準法施行細則 §6 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=6): 臨時性工作…其工作期間在六個月以內者; 季節性工作…其工作期間在九個月以內者 — 1 March + 6 months = 1 September ≤ 30 November: TEMPORARY refused; + 9 months = 1 December > 30 November: SEASONAL stands.',
			PLAIN_36_CITED
		],
		period: '2026-03',
		people: [
			citizen('chou', 'Chou Mei-ling', 36_000, all(36_300), {
				hired: '2026-03-01',
				left: '2026-11-30',
				exit_ground: 'END_OF_CONTRACT',
				terms: { employment_type: 'CONTRACT', facts: { fixed_term_category: 'SEASONAL' } }
			})
		],
		attempts: {
			chou: [
				{
					terms: { employment_type: 'CONTRACT', facts: {} },
					refused: 'states which fixed-term work it is'
				},
				{
					terms: { employment_type: 'CONTRACT', facts: { fixed_term_category: 'TEMPORARY' } },
					refused: 'six months at most'
				}
			]
		},
		expected: { chou: PLAIN_36 }
	}),
	tw({
		id: 'TW-WAGE-06-2',
		description:
			'A NT$13,000 garnishment on a NT$36,000 March 2026 wage: deducted as ordered, with the run warning that it passes one third of the period’s wage.',
		citation: [
			...EVERY,
			'強制執行法 §115-1(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0010004&flno=115-1): 各期給付數額三分之一 — 36,000 ÷ 3 = 12,000 < 13,000: a warning (owner rule 2026-10-01: never a cap; the court may fix more). TW-WAGE-06-1’s 12,000 is exactly one third and warns nothing.',
			PLAIN_36_CITED,
			'Net 34,529 − 13,000 = 21,529.'
		],
		period: '2026-03',
		people: [citizen('yeh2', 'Yeh Shu-fen', 36_000, all(36_300), { gender: 'FEMALE' })],
		extra: (job) => [
			{
				...adhoc(
					job('yeh2'),
					'COURT_GARNISHMENT',
					13_000,
					'2026-03-10',
					'強制執行法 §115-1 扣押命令 / 移轉命令'
				),
				files: { evidence_file: 'garnishment-order.pdf' }
			}
		],
		warnings: ['exceeds one third of this period’s wage'],
		expected: { yeh2: { ...PLAIN_36, net: 21_529, total_deductions: 14_471 } }
	}),
	tw({
		id: 'TW-ADMIN-01-1',
		description:
			'The obligation ledger for a §11 layoff: hired 2 March, laid off 20 March 2026 with no notice owed (under three months). The hire, the exit, the March run and the 2026 year raise their dated duties.',
		citation: [
			'勞工保險條例 §11 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050001&flno=11) and 勞工職業災害保險及保護法 §12: 到職 / 離職 之當日 — 2 March and 20 March.',
			'全民健康保險法 §15(7) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=L0060001&flno=15): 三日內 — 5 March and 23 March (民法 §120(2): 始日不算入).',
			'勞工退休金條例 §18 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030020&flno=18): 七日內 — 9 March and 27 March.',
			'勞工退休金條例 §12(2) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030020&flno=12): 資遣費 終止勞動契約後三十日內 — 19 April. 就業服務法 §33(1) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0090001&flno=33): 離職之十日前 — 10 March. 勞動基準法 §7(2): 勞工名卡 保管至離職後五年 — kept to 20 March 2031.',
			'The March run: 勞工保險條例 §16(1)(1) and 全民健康保險法 §30: 次月底前 — 30 April; 勞工退休金條例 §19(1): 再次月底前 — 31 May; 所得稅法 §92(1) 每月十日前, 健保 補充保險費 次月底, and 勞動基準法 §23(2)/§30(5) 保存五年, each from the run’s pay date.',
			'The 2026 year: 所得稅法 §92(1): 每年一月底前 彙報 — 31 January 2027; 二月十日前 填發 — 10 February 2027.'
		],
		period: '2026-03',
		people: [
			citizen('kao', 'Kao Chih-wei', 36_000, all(36_300), {
				hired: '2026-03-02',
				left: '2026-03-20',
				exit_ground: 'REDUNDANCY',
				exit_facts: {
					lsa_termination_ground: 'ARTICLE_11',
					notice_days_given: 0,
					average_daily_wage: 1200,
					old_system_service_months: 0
				}
			})
		],
		extra: (job) => [
			adhoc(job('kao'), 'SEVERANCE_PAY', 0, '2026-03-20', 'SEVERANCE_PAY on departure 2026-03-20')
		],
		expected: {},
		saved: [
			{
				collection: 'obligation_instances',
				where: { subject_kind: 'EMPLOYMENT', subject_id: '@kao_job' },
				rows: [
					{
						duty_code: 'LI_EI_OCC_ENROLMENT',
						trigger_ref: 'HIRE',
						due_on: '2026-03-02',
						state: 'OPEN'
					},
					{ duty_code: 'NHI_ENROLMENT', trigger_ref: 'HIRE', due_on: '2026-03-05' },
					{ duty_code: 'PENSION_START_NOTICE', trigger_ref: 'HIRE', due_on: '2026-03-09' },
					{ duty_code: 'LI_EI_OCC_WITHDRAWAL', trigger_ref: '2026-03-20', due_on: '2026-03-20' },
					{ duty_code: 'NHI_WITHDRAWAL', trigger_ref: '2026-03-20', due_on: '2026-03-23' },
					{ duty_code: 'PENSION_STOP_NOTICE', trigger_ref: '2026-03-20', due_on: '2026-03-27' },
					{ duty_code: 'SEVERANCE_PAYMENT', trigger_ref: '2026-03-20', due_on: '2026-04-19' },
					{ duty_code: 'LAYOFF_REPORT', trigger_ref: '2026-03-20', due_on: '2026-03-10' },
					{
						duty_code: 'PERSONNEL_RECORDS_RETENTION',
						trigger_ref: '2026-03-20',
						due_on: '2026-03-20',
						retain_until: '2031-03-20'
					}
				]
			},
			{
				collection: 'obligation_instances',
				where: { subject_kind: 'RUN', subject_id: '@run' },
				rows: [
					{
						duty_code: 'LI_EI_OCC_PREMIUM_REMITTANCE',
						trigger_ref: '2026-03',
						due_on: '2026-04-30'
					},
					{ duty_code: 'NHI_PREMIUM_REMITTANCE', trigger_ref: '2026-03', due_on: '2026-04-30' },
					{ duty_code: 'LABOUR_PENSION_REMITTANCE', trigger_ref: '2026-03', due_on: '2026-05-31' },
					{ duty_code: 'NHI_SUPPLEMENTARY_PREMIUM_REMITTANCE', trigger_ref: '2026-03' },
					{ duty_code: 'WITHHOLDING_TAX_REMITTANCE', trigger_ref: '2026-03' },
					{ duty_code: 'WAGE_AND_ATTENDANCE_RECORDS', trigger_ref: '2026-03' }
				]
			},
			{
				collection: 'obligation_instances',
				where: { subject_kind: 'COMPANY', subject_id: '@company', trigger_ref: '2026' },
				rows: [
					{ duty_code: 'ANNUAL_WITHHOLDING_RETURN', due_on: '2027-01-31' },
					{ duty_code: 'WITHHOLDING_CERTIFICATES_TO_PAYEES', due_on: '2027-02-10' }
				]
			}
		]
	})
);
