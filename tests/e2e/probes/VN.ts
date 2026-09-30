import { officeWeek, register, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * VN cases: see the case shape at the top of payroll-probe.ts. Every figure is computed by hand from the cited
 * instrument, never read off a golden; VND has no minor unit, so every amount is a whole đồng (nearest, half up).
 *
 * The law each case rests on (read 2026-09-29/30):
 * - SI: Law on Social Insurance 41/2024/QH15 art.31 (floor the reference level, ceiling 20 × it), art.33(1) employee
 *   8%, art.34(1) employer 3% sickness-maternity + 14% retirement-survivorship, arts.33(5)/34(3) no contribution for
 *   a month with 14 or more working days unworked and unpaid; Decree 58/2020/ND-CP art.4 + Law on OSH 84/2015 art.44:
 *   employer 0.5% occupational accident fund (https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm).
 *   Reference level 2,340,000 (base salary, Decree 73/2024/ND-CP) until 30 June 2026 → ceiling 46,800,000.
 * - HI: Decree 188/2025/ND-CP — 4.5% of the monthly compulsory-SI salary, employer 2/3 (3%), employee 1/3 (1.5%)
 *   (https://xaydungchinhsach.chinhphu.vn/nghi-dinh-188-2025-nd-cp-quy-dinh-moi-ve-doi-tuong-muc-dong-muc-ho-tro-dong-bao-hiem-y-te-119250711175642187.htm).
 * - UI: Law on Employment 74/2025/QH15 art.2(1) (a "người lao động" is a Vietnamese citizen), art.31 (contracts of one
 *   month or more; pensioners, probation and domestic workers excluded), art.33(1) 1% + 1%, art.33(4) the 14-day
 *   rule, art.34(2) ceiling 20 × the regional monthly minimum wage (https://xaydungchinhsach.chinhphu.vn/toan-van-luat-viec-lam-119250711173403835.htm).
 *   December 2025: Law on Employment 38/2013/QH13 arts.57–58, the same 1% + 1% on 20 × the regional minimum.
 * - Minimum wage: Decree 293/2025/ND-CP from 1 January 2026 — Region I 5,310,000, II 4,730,000, III 4,140,000,
 *   IV 3,700,000 a month (https://vanban.chinhphu.vn/?pageid=27160&docid=215832;
 *   https://xaydungchinhsach.chinhphu.vn/nghi-dinh-so-293-2025-nd-cp-quy-dinh-muc-luong-toi-thieu-doi-voi-nguoi-lao-dong-lam-viec-theo-hop-dong-lao-dong-119251110172808433.htm);
 *   Decree 74/2024/ND-CP to 31 December 2025 — Region I 4,960,000, III 3,860,000.
 * - PIT 2026: Law 109/2025/QH15 five-bracket monthly table for residents — to 10m 5%, >10–30m 10%, >30–60m 20%,
 *   >60–100m 30%, >100m 35%, applied to salary from tax year 2026 (https://xaydungchinhsach.chinhphu.vn/chi-tiet-bieu-thue-thu-nhap-ca-nhan-luy-tien-tung-phan-119260327091407544.htm);
 *   Resolution 110/2025/UBTVQH15 — personal deduction 15,500,000, each dependant 6,200,000 a month from tax year 2026
 *   (https://xaydungchinhsach.chinhphu.vn/nghi-quyet-110-2025-ubtvqh15-dieu-chinh-muc-giam-tru-gia-canh-cua-thue-thu-nhap-ca-nhan-119251110101313787.htm);
 *   taxable = income − compulsory SI/HI/UI − deductions; non-resident 20% flat (Decree 253/2026/ND-CP art.5);
 *   night and overtime pay and untaken-leave pay exempt (Law 109/2025 art.4(8),
 *   https://xaydungchinhsach.chinhphu.vn/gioi-thieu-luat-thue-thu-nhap-ca-nhan-so-109-2025-qh15-119260123145437408.htm).
 * - PIT December 2025: PIT Law 04/2007/QH12 art.22 (as amended by Law 26/2012/QH13) seven brackets 5/10/15/20/25/30/35%
 *   at 5/10/18/32/52/80m, Resolution 954/2020/UBTVQH14 deductions 11,000,000 and 4,400,000.
 * - Labour Code 45/2019/QH14 and Decree 145/2020/ND-CP (Official Gazette 1203+1204 of 28 December 2020,
 *   https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2020/12/32732/33806-1-20201203-1204145-2020-nd-cp.pdf): art.54(1)(a3)
 *   a monthly wage's day is the month over its normal working days; art.55 overtime at 150/200/300% of the hourly wage
 *   actually paid; art.57 night overtime adds 30% plus 20% of the day-time hour (150% when day-time overtime came
 *   first); art.66 part-year leave = (entitlement + seniority) ÷ 12 × months worked, a part month counting when its
 *   worked and paid-leave days are at least 50% of its normal working days; art.67(3) untaken leave at the contract
 *   wage of the month before the leaving month; art.8(3) severance/job-loss service less UI-insured time, a leftover
 *   of ≤ 6 months a half year, > 6 months a year.
 *
 * Owner rule 2026-09-28 defaults recorded in docs/inventory/vietnam.csv that these cases follow where the law is
 * silent: a part month prorates on the period's normal working days (VN-PRORATE-01); a salary payment made after a
 * contract of three months or more has ended is withheld at 10% like a payment without a labour contract (VN-PIT-06);
 * late-wage interest counts actual days over 365, rounded up (VN-LC97-01).
 */

/** A region-I (or the named region) company in the VN lineage whose shift week reaches the 2008 hires. */
const company = (region = 'I'): Row => ({
	region,
	facts: {},
	effective_range: { from: '2007-01-01', to: null }
});
/** The office week anchored on Monday 31 December 2007, so every hire in these cases is inside it. */
const WEEK = officeWeek('2007-12-31');

type Hire = {
	ref: string;
	name: string;
	number: string;
	born: string;
	gender?: 'MALE' | 'FEMALE';
	nationality?: string;
	foreigner?: boolean;
	nonResident?: boolean;
	pensioner?: boolean;
	/** One salary, or dated salary segments (a raise inside the month). */
	salary: number | readonly { amount: number; from: string; to: string | null }[];
	from: string;
	to?: string;
	type?: string;
	payFrequency?: string;
	region?: string;
	exitReason?: string;
	exitFacts?: Row;
	/** Dated protected-floor inputs (Decree 293/2025 art.5(5)); defaulted to the company region for pre-2026 hires. */
	termsFacts?: Row;
	terms?: Row;
	pattern?: string;
	member?: boolean;
	dependants?: number;
	/** Extra PIT status fields (unit assessments, deduction claims). */
	pit?: Row;
	pitElections?: Row;
	/** First day of UI cover; `null` records no UI fact (the December 2025 version declares no UI elections). */
	uiFrom?: string | null;
};

/** One person, their contract, its terms and the three declarations the VN run requires (UI, union, PIT). */
function hire(p: Hire): ProbeInput[] {
	const employment = `${p.ref}_job`;
	const segments =
		typeof p.salary === 'number'
			? [{ amount: p.salary, from: p.from, to: p.to ?? null }]
			: p.salary;
	const preHire = p.from <= '2025-12-31';
	const fact = (code: string, from: string, status: Row): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: `@${p.ref}`,
			employment_id: `@${employment}`,
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from, to: null },
			status: { kind: 'REGISTERED', reference_number: `PROBE-${code}-${p.number}`, ...status }
		}
	});
	return [
		{
			collection: 'employees',
			ref: p.ref,
			values: {
				name: p.name,
				date_of_birth: p.born,
				gender: p.gender ?? 'MALE',
				nationality: p.nationality ?? (p.foreigner ? 'Japanese' : 'Vietnamese'),
				receiving_pension: p.pensioner ?? false
			}
		},
		{
			collection: 'employments',
			ref: employment,
			values: {
				employee_id: `@${p.ref}`,
				company_id: '@company',
				employee_number: p.number,
				effective_range: { from: p.from, to: p.to ?? null },
				...(p.exitReason == null
					? {}
					: { exit_reason: p.exitReason, exit_facts: p.exitFacts ?? {} })
			}
		},
		...segments.map((segment): ProbeInput => ({
			collection: 'employment_terms',
			values: {
				employment_id: `@${employment}`,
				residency_status: p.foreigner ? 'FOREIGNER' : 'CITIZEN',
				...(p.foreigner ? { pass_type: 'WORK_PERMIT' } : {}),
				tax_residency: p.nonResident ? 'NON_RESIDENT' : 'RESIDENT',
				currency: 'VND',
				base_salary: segment.amount,
				pay_frequency: p.payFrequency ?? 'MONTHLY',
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: p.type ?? 'PERMANENT',
				facts:
					p.termsFacts ??
					(preHire ? { prior_floor_region: p.region ?? 'I', prior_floor_reclassified: false } : {}),
				shift_pattern_id: p.pattern ?? '@week',
				...p.terms,
				effective_range: { from: segment.from, to: segment.to }
			}
		})),
		...(p.uiFrom === null
			? []
			: [
					fact('UI', p.uiFrom ?? p.from, {
						// the UI registration day: the uninsured span severance counts is the service before it
						...(p.uiFrom == null ? {} : { since: p.uiFrom }),
						elections: { pension_qualified: p.pensioner ?? false }
					})
				]),
		fact('UNION_DUES', p.from, { elections: { union_member: p.member ?? false } }),
		fact('PIT', p.from, {
			elections: {
				eligible_dependents: p.dependants ?? 0,
				...(p.dependants ? { dependents_registration_reference: `PROBE-DEP-${p.number}` } : {}),
				...p.pitElections
			},
			...p.pit
		})
	];
}

/** A published holiday of the case's company. */
const holiday = (date: string, name: string): ProbeInput => ({
	collection: 'jurisdiction_holidays',
	values: {
		company_id: '@company',
		date,
		name,
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2025-11-01T00:00:00.000Z'
	}
});

/**
 * One attended day; the intervals are local Asia/Ho_Chi_Minh (UTC+7) times written as instants. `overtime` is the
 * hours the worker agreed to work beyond the normal day, on the rest day or the holiday (Labour Code art.107(1)(a)):
 * the run pays only those.
 */
const worked = (
	employment: string,
	date: string,
	spans: readonly [string, string][],
	overtime = 0
): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: `@${employment}`,
		work_date: date,
		worked_intervals: spans.map(([start, end]) => ({
			start: new Date(`${date}T${start}:00+07:00`).toISOString(),
			end: new Date(`${date}T${end}:00+07:00`).toISOString()
		})),
		...(overtime > 0 ? { approved_overtime_hours: overtime } : {})
	}
});

/** One leave entry; the transform derives its days and charges. */
const leave = (employment: string, code: string, values: Row): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${employment}`,
		catalogue_id: `@law:leave_catalogue:${code}`,
		...values
	}
});

const SI_CITE =
	'SI: Law 41/2024/QH15 art.31 (ceiling 20 × 2,340,000 = 46,800,000), art.33(1) 8%, art.34(1) 3% + 14% with Decree 58/2020/ND-CP art.4 0.5% → employer 17.5% (https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm)';
const HI_CITE =
	'HI: Decree 188/2025/ND-CP — 4.5% of the SI salary, employer 3%, employee 1.5% (https://xaydungchinhsach.chinhphu.vn/nghi-dinh-188-2025-nd-cp-quy-dinh-moi-ve-doi-tuong-muc-dong-muc-ho-tro-dong-bao-hiem-y-te-119250711175642187.htm)';
const UI_CITE =
	'UI: Law 74/2025/QH15 art.33(1) 1% + 1%, art.34(2) ceiling 20 × the regional minimum (Region I 5,310,000 → 106,200,000, Decree 293/2025/ND-CP) (https://xaydungchinhsach.chinhphu.vn/toan-van-luat-viec-lam-119250711173403835.htm)';
const PIT_CITE =
	'PIT: Law 109/2025/QH15 monthly table 5/10/20/30/35% at 10/30/60/100m (https://xaydungchinhsach.chinhphu.vn/chi-tiet-bieu-thue-thu-nhap-ca-nhan-luy-tien-tung-phan-119260327091407544.htm); Resolution 110/2025/UBTVQH15 personal deduction 15,500,000, dependant 6,200,000 (https://xaydungchinhsach.chinhphu.vn/nghi-quyet-110-2025-ubtvqh15-dieu-chinh-muc-giam-tru-gia-canh-cua-thue-thu-nhap-ca-nhan-119251110101313787.htm)';
const LC_CITE =
	'Decree 145/2020/ND-CP, Official Gazette 1203+1204 (https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2020/12/32732/33806-1-20201203-1204145-2020-nd-cp.pdf)';

register(
	{
		id: 'VN-SI-05-1',
		profile: 'VN',
		description:
			'A Vietnamese citizen on 20,000,000, the whole of March 2026 worked (22 normal working days, no holiday): SI, HI and UI on the contract salary, PIT on the 2026 resident table, no union membership.',
		citation: [
			`${SI_CITE}: 20,000,000 × 8% = 1,600,000; × 17.5% = 3,500,000`,
			`${HI_CITE}: 300,000 / 600,000`,
			`${UI_CITE}: 200,000 / 200,000`,
			`${PIT_CITE}: 20,000,000 − 2,100,000 − 15,500,000 = 2,400,000 × 5% = 120,000`,
			'Net 20,000,000 − 2,100,000 − 120,000 = 17,780,000; employer cost 3,500,000 + 600,000 + 200,000 = 4,300,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'lan',
				name: 'Nguyễn Thị Lan',
				number: 'P-VN-001',
				born: '1994-05-12',
				gender: 'FEMALE',
				salary: 20_000_000,
				from: '2025-06-02'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'lan_job',
				lines: {
					gross: 20_000_000,
					net: 17_780_000,
					total_deductions: 2_220_000,
					employer_cost: 4_300_000,
					BASIC: 20_000_000,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'UI.employee': 200_000,
					'UI.employer': 200_000,
					'PIT.employee': 120_000
				}
			}
		]
	},
	{
		id: 'VN-SI-05-2',
		profile: 'VN',
		description:
			'The SI/HI ceiling seam and the upper PIT bands, March 2026: one citizen exactly on 46,800,000 (20 × 2,340,000), one on 60,000,000 (capped SI/HI, uncapped UI) and one on 150,000,000 (UI capped at 20 × 5,310,000, the 35% band).',
		citation: [
			`${SI_CITE}: every salary ≥ 46,800,000 contributes 3,744,000 / 8,190,000`,
			`${HI_CITE}: 46,800,000 × 1.5% = 702,000; × 3% = 1,404,000`,
			`${UI_CITE}: 468,000; 600,000; 150,000,000 capped at 106,200,000 → 1,062,000 each side`,
			`${PIT_CITE}: 46.8m: 46,800,000 − 4,914,000 − 15,500,000 = 26,386,000 → 500,000 + 1,638,600 = 2,138,600; 60m: 60,000,000 − 5,046,000 − 15,500,000 = 39,454,000 → 500,000 + 2,000,000 + 1,890,800 = 4,390,800; 150m: 150,000,000 − 5,508,000 − 15,500,000 = 128,992,000 → 20,500,000 + 28,992,000 × 35% = 30,647,200`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'an',
				name: 'Trần Văn An',
				number: 'P-VN-011',
				born: '1985-02-01',
				salary: 46_800_000,
				from: '2025-06-02'
			}),
			...hire({
				ref: 'binh',
				name: 'Lê Văn Bình',
				number: 'P-VN-012',
				born: '1980-03-01',
				salary: 60_000_000,
				from: '2025-06-02'
			}),
			...hire({
				ref: 'cuong',
				name: 'Phạm Văn Cường',
				number: 'P-VN-013',
				born: '1975-04-01',
				salary: 150_000_000,
				from: '2025-06-02'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'an_job',
				lines: {
					gross: 46_800_000,
					net: 39_747_400,
					employer_cost: 10_062_000,
					'SI.employee': 3_744_000,
					'SI.employer': 8_190_000,
					'HI.employee': 702_000,
					'HI.employer': 1_404_000,
					'UI.employee': 468_000,
					'UI.employer': 468_000,
					'PIT.employee': 2_138_600
				}
			},
			{
				employment: 'binh_job',
				lines: {
					gross: 60_000_000,
					net: 50_563_200,
					employer_cost: 10_194_000,
					'SI.employee': 3_744_000,
					'SI.employer': 8_190_000,
					'HI.employee': 702_000,
					'HI.employer': 1_404_000,
					'UI.employee': 600_000,
					'UI.employer': 600_000,
					'PIT.employee': 4_390_800
				}
			},
			{
				employment: 'cuong_job',
				lines: {
					gross: 150_000_000,
					net: 113_844_800,
					employer_cost: 10_656_000,
					'SI.employee': 3_744_000,
					'SI.employer': 8_190_000,
					'HI.employee': 702_000,
					'HI.employer': 1_404_000,
					'UI.employee': 1_062_000,
					'UI.employer': 1_062_000,
					'PIT.employee': 30_647_200
				}
			}
		]
	},
	{
		id: 'VN-SI-05-3',
		profile: 'VN',
		description:
			'Rounding: a citizen on 17,777,779, March 2026 — every share is a fractional đồng before rounding, and each is rounded to the whole đồng (VND has no minor unit).',
		citation: [
			`${SI_CITE}: 1,422,222.32 → 1,422,222; 3,111,111.325 → 3,111,111`,
			`${HI_CITE}: 266,666.685 → 266,667; 533,333.37 → 533,333`,
			`${UI_CITE}: 177,777.79 → 177,778 each side`,
			`${PIT_CITE}: 17,777,779 − 1,866,667 − 15,500,000 = 411,112 × 5% = 20,555.6 → 20,556`,
			'Rounding: the đồng is the smallest unit (ISO 4217 VND, no minor unit); the law states no rounding method, so the nearest đồng, half up, is the recorded default. Net 17,777,779 − 1,866,667 − 20,556 = 15,890,556'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'dung',
				name: 'Hoàng Văn Dũng',
				number: 'P-VN-021',
				born: '1990-07-07',
				salary: 17_777_779,
				from: '2025-06-02'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'dung_job',
				lines: {
					gross: 17_777_779,
					net: 15_890_556,
					employer_cost: 3_822_222,
					'SI.employee': 1_422_222,
					'SI.employer': 3_111_111,
					'HI.employee': 266_667,
					'HI.employer': 533_333,
					'UI.employee': 177_778,
					'UI.employer': 177_778,
					'PIT.employee': 20_556
				}
			}
		]
	},
	{
		id: 'VN-PRORATE-01-1',
		profile: 'VN',
		description:
			'A mid-month joiner: hired Monday 16 March 2026 on 22,000,000, 12 of March’s 22 working days employed. Salary prorates on working days; the ten unworked days before the hire are under the 14-day threshold, so SI, HI and UI are due on the whole contract salary.',
		citation: [
			'Proration: owner rule 2026-09-28 (VN-PRORATE-01) — the period’s normal working days; Decree 145/2020 art.54(1)(a3): a monthly wage’s day is the month over its normal working days: 22,000,000 × 12 ÷ 22 = 12,000,000',
			`${SI_CITE}; arts.33(5), 34(3): no contribution only for 14 or more unworked unpaid working days — 10 here: 22,000,000 × 8% = 1,760,000, × 17.5% = 3,850,000`,
			`${HI_CITE}: 330,000 / 660,000`,
			`${UI_CITE}; art.33(4) the same 14-day rule: 220,000 / 220,000`,
			`${PIT_CITE}: 12,000,000 − 2,310,000 − 15,500,000 < 0 → 0`,
			'Net 12,000,000 − 2,310,000 = 9,690,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'em',
				name: 'Vũ Thị Em',
				number: 'P-VN-031',
				born: '1998-01-20',
				gender: 'FEMALE',
				salary: 22_000_000,
				from: '2026-03-16'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'em_job',
				lines: {
					gross: 12_000_000,
					net: 9_690_000,
					employer_cost: 4_730_000,
					'SI.employee': 1_760_000,
					'SI.employer': 3_850_000,
					'HI.employee': 330_000,
					'HI.employer': 660_000,
					'UI.employee': 220_000,
					'UI.employer': 220_000
				}
			}
		]
	},
	{
		id: 'VN-LC46-02-1',
		profile: 'VN',
		description:
			'Two mid-month leavers on Friday 17 April 2026, each hired 1 January 2008 on 22,000,000 with UI from 1 January 2009 (one uncovered year): one resigns (severance), one is made redundant (job-loss allowance). Final salary on 13 of April’s 22 working days, 5 untaken annual-leave days at March’s contract wage, and the 10% withholding on salary paid after the contract ended.',
		citation: [
			`Final salary: owner rule VN-PRORATE-01 and ${LC_CITE} art.54(1)(a3): 22,000,000 × 13 ÷ 22 = 13,000,000`,
			`Annual leave: Labour Code art.113(1) 12 days + art.114(1) one day per five years (18 full years → 3) = 15; ${LC_CITE} art.66(1)–(2): 15 ÷ 12 × 4 months (April’s 13 of 22 days is at least 50%) = 5 days; art.67(3): March contract salary 22,000,000 ÷ 22 normal working days = 1,000,000 a day → 5,000,000`,
			`Severance: Labour Code art.46 half a month per year; ${LC_CITE} art.8(1), (3)(b)–(c): service 1 January 2008 – 17 April 2026 less UI-insured time from 1 January 2009 = 12 months = 1 year; salary the six-month contractual average 22,000,000 → 11,000,000. The resignation is art.34(3); the leaver does not qualify for a pension (exit fact)`,
			`Job-loss: Labour Code art.47 one month per year, ${LC_CITE} art.8(2): at least two months where the service is under 24 months → 2 × 22,000,000 = 44,000,000 (redundancy, art.34(11))`,
			`${SI_CITE}; arts.33(5), 34(3): nine unworked days after the exit is under 14 → the whole contract salary: 1,760,000 / 3,850,000`,
			`${HI_CITE}: 330,000 / 660,000; ${UI_CITE}: 220,000 / 220,000`,
			'PIT: the April salary is paid on 30 April, after the contract ended on the 17th: owner rule 2026-09-28 (VN-PIT-06, Circular 111/2013/TT-BTC art.25(1)(i), GDT letter 51/TCT-DNNCN) withholds 10% of the payment: 13,000,000 × 10% = 1,300,000. Untaken-leave pay is exempt (Law 109/2025 art.4(8); Decree 253/2026 art.26(2)); severance and job-loss allowances are outside salary income (Decree 253/2026 art.8(3)(h))',
			'Resigner: gross 13,000,000 + 5,000,000 + 11,000,000 = 29,000,000, net 29,000,000 − 2,310,000 − 1,300,000 = 25,390,000. Redundant: gross 13,000,000 + 5,000,000 + 44,000,000 = 62,000,000, net 58,390,000',
			'Final pay due within 14 working days (Labour Code art.48(1)), 30 days for redundancy (art.48(1)(b)): a run warning, not a payslip line'
		],
		company: company(),
		inputs: [
			...WEEK,
			...(['giang', 'hai'] as const).flatMap((ref, index) => [
				...hire({
					ref,
					name: index === 0 ? 'Đỗ Thị Giang' : 'Bùi Văn Hải',
					number: `P-VN-04${index + 1}`,
					born: '1980-09-09',
					gender: index === 0 ? 'FEMALE' : 'MALE',
					salary: 22_000_000,
					from: '2008-01-01',
					to: '2026-04-17',
					uiFrom: '2009-01-01',
					exitReason: index === 0 ? 'RESIGNATION' : 'REDUNDANCY',
					exitFacts: index === 0 ? { pension_eligible: false } : {},
					pit: {
						unit_assessments: [
							{
								period: '2026-04',
								gross: 13_000_000,
								units: 1,
								reference: 'FINAL-WAGE',
								paid_on: '2026-04-30'
							}
						]
					}
				}),
				leave(`${ref}_job`, 'ANNUAL_LEAVE', {
					reference: `EXIT-AL-${ref}`,
					from_date: '2026-01-01',
					to_date: '2026-12-31',
					days: 5,
					encash_days: 5,
					effective_on: '2026-04-17',
					due_on: '2026-04-17',
					reason: 'Unused annual leave on departure 2026-04-17'
				}),
				{
					collection: 'adhoc_requests',
					values: {
						employment_id: `@${ref}_job`,
						catalogue_id:
							index === 0
								? '@law:adhoc_catalogue:SEVERANCE_ALLOWANCE'
								: '@law:adhoc_catalogue:JOB_LOSS_ALLOWANCE',
						amount: 0,
						event_date: '2026-04-17',
						pay_period: '2026-04',
						reason: 'Separation payment on departure 2026-04-17'
					}
				} satisfies ProbeInput
			])
		],
		period: '2026-04',
		expected: [
			{
				employment: 'giang_job',
				lines: {
					gross: 29_000_000,
					net: 25_390_000,
					employer_cost: 4_730_000,
					SEVERANCE_ALLOWANCE: 11_000_000,
					'SI.employee': 1_760_000,
					'SI.employer': 3_850_000,
					'HI.employee': 330_000,
					'HI.employer': 660_000,
					'UI.employee': 220_000,
					'UI.employer': 220_000,
					'PIT.employee': 1_300_000
				}
			},
			{
				employment: 'hai_job',
				lines: {
					gross: 62_000_000,
					net: 58_390_000,
					employer_cost: 4_730_000,
					JOB_LOSS_ALLOWANCE: 44_000_000,
					'SI.employee': 1_760_000,
					'SI.employer': 3_850_000,
					'HI.employee': 330_000,
					'HI.employer': 660_000,
					'UI.employee': 220_000,
					'UI.employer': 220_000,
					'PIT.employee': 1_300_000
				}
			}
		]
	},
	{
		id: 'VN-SI-02-1',
		profile: 'VN',
		description:
			'The 14-day seam, March 2026, 22,000,000: a work stoppage through the worker’s fault (unpaid) for 14 working days (2–19 March) ends the month’s SI, HI and UI; the same stoppage for 13 days (2–18 March) does not.',
		citation: [
			'Stoppage: Labour Code 45/2019 art.99(2) — a stoppage through the worker’s fault is unpaid for that worker; salary on working days: 22,000,000 × 8 ÷ 22 = 8,000,000 and × 9 ÷ 22 = 9,000,000',
			`${SI_CITE}; arts.33(5), 34(3): a month with 14 or more working days unworked and unpaid owes no SI; 13 days owes it on the whole contract salary: 1,760,000 / 3,850,000`,
			`${HI_CITE} — HI is on the SI salary of the month, none when the month owes no SI; 13 days: 330,000 / 660,000`,
			`${UI_CITE}; art.33(4): no UI for 14 or more unpaid working days; 13 days: 220,000 / 220,000`,
			`${PIT_CITE}: 8,000,000 − 15,500,000 < 0 and 9,000,000 − 2,310,000 − 15,500,000 < 0 → 0`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'khanh',
				name: 'Ngô Văn Khánh',
				number: 'P-VN-051',
				born: '1992-11-11',
				salary: 22_000_000,
				from: '2025-06-02'
			}),
			...hire({
				ref: 'linh',
				name: 'Đặng Thị Linh',
				number: 'P-VN-052',
				born: '1993-12-12',
				gender: 'FEMALE',
				salary: 22_000_000,
				from: '2025-06-02'
			}),
			// 14 unpaid working days: the parties record that SI is not continued (Law 41/2024 art.33(5), art.34(3)).
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@khanh',
					employment_id: '@khanh_job',
					statutory_contribution_id: '@law:statutory_contributions:SI',
					effective_range: { from: '2026-03-01', to: '2026-03-31' },
					status: {
						kind: 'REGISTERED',
						reference_number: 'PROBE-SI-P-VN-051',
						elections: { continue_si_unpaid: false }
					}
				}
			},
			leave('khanh_job', 'STOPPAGE_WORKER_FAULT', {
				reference: 'STOP-14',
				from_date: '2026-03-02',
				to_date: '2026-03-19',
				reason: 'Work stoppage through the worker’s fault (Labour Code art.99(2))'
			}),
			leave('linh_job', 'STOPPAGE_WORKER_FAULT', {
				reference: 'STOP-13',
				from_date: '2026-03-02',
				to_date: '2026-03-18',
				reason: 'Work stoppage through the worker’s fault (Labour Code art.99(2))'
			})
		],
		period: '2026-03',
		expected: [
			{ employment: 'khanh_job', lines: { gross: 8_000_000, net: 8_000_000, employer_cost: 0 } },
			{
				employment: 'linh_job',
				lines: {
					gross: 9_000_000,
					net: 6_690_000,
					employer_cost: 4_730_000,
					'SI.employee': 1_760_000,
					'SI.employer': 3_850_000,
					'HI.employee': 330_000,
					'HI.employer': 660_000,
					'UI.employee': 220_000,
					'UI.employer': 220_000
				}
			}
		]
	},
	{
		id: 'VN-LC115-02-1',
		profile: 'VN',
		description:
			'Unpaid and paid personal leave, March 2026, 22,000,000: one worker takes the unpaid day for a grandparent’s death (one working day off pay), the other the three paid days for their own marriage (no deduction).',
		citation: [
			'Labour Code 45/2019 art.115(1)(a) own marriage 3 paid days; art.115(2) one unpaid day for the death of a grandparent (https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf)',
			`Unpaid day at the working-day rate (owner rule VN-PRORATE-01): 22,000,000 × 21 ÷ 22 = 21,000,000; ${LC_CITE} art.67(2) the paid days at the contract wage`,
			`${SI_CITE}: one unpaid day is under 14 → 1,760,000 / 3,850,000 on the contract salary`,
			`${HI_CITE}: 330,000 / 660,000; ${UI_CITE}: 220,000 / 220,000`,
			`${PIT_CITE}: 21,000,000 − 2,310,000 − 15,500,000 = 3,190,000 × 5% = 159,500; 22,000,000 − 2,310,000 − 15,500,000 = 4,190,000 × 5% = 209,500`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'minh',
				name: 'Trịnh Văn Minh',
				number: 'P-VN-061',
				born: '1991-01-15',
				salary: 22_000_000,
				from: '2025-06-02'
			}),
			...hire({
				ref: 'nga',
				name: 'Lý Thị Nga',
				number: 'P-VN-062',
				born: '1996-06-16',
				gender: 'FEMALE',
				salary: 22_000_000,
				from: '2025-06-02'
			}),
			leave('minh_job', 'BEREAVEMENT_LEAVE_UNPAID', {
				reference: 'BRV-U-1',
				from_date: '2026-03-10',
				to_date: '2026-03-10',
				event_kind: 'DEATH',
				event_relationship: 'GRANDPARENT',
				event_date: '2026-03-09',
				reason: 'Death of a grandparent'
			}),
			leave('nga_job', 'MARRIAGE_LEAVE', {
				reference: 'MAR-1',
				from_date: '2026-03-10',
				to_date: '2026-03-12',
				event_kind: 'MARRIAGE',
				event_relationship: 'SELF',
				event_date: '2026-03-10',
				reason: 'Own marriage'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'minh_job',
				lines: {
					gross: 21_000_000,
					net: 18_530_500,
					employer_cost: 4_730_000,
					'SI.employee': 1_760_000,
					'SI.employer': 3_850_000,
					'HI.employee': 330_000,
					'HI.employer': 660_000,
					'UI.employee': 220_000,
					'UI.employer': 220_000,
					'PIT.employee': 159_500
				}
			},
			{
				employment: 'nga_job',
				lines: {
					gross: 22_000_000,
					net: 19_480_500,
					employer_cost: 4_730_000,
					'SI.employee': 1_760_000,
					'SI.employer': 3_850_000,
					'HI.employee': 330_000,
					'HI.employer': 660_000,
					'UI.employee': 220_000,
					'UI.employer': 220_000,
					'PIT.employee': 209_500
				}
			}
		]
	},
	{
		id: 'VN-LC98-02-1',
		profile: 'VN',
		description:
			'Overtime, January 2026, 17,600,000 (22 normal working days with the 1 January holiday among them → 100,000 an hour): 8 hours on the holiday, 3 hours beyond a Tuesday’s normal day, 8 hours on the Sunday rest day, and 4 hours beyond another Tuesday of which the last half hour falls after 22:00.',
		citation: [
			`${LC_CITE} art.55(1)(a): the hour is the month’s wage actually paid for normal work over the hours actually worked — (17,600,000 − 800,000 holiday pay) ÷ (21 × 8) = 100,000; art.54(1)(a4) gives the same`,
			'Labour Code 45/2019 art.98(1): at least 150% on a normal day, 200% on the weekly rest day, 300% on a public holiday (the holiday’s own pay is in the monthly salary): 8 × 300,000 = 2,400,000; 3 × 150,000 = 450,000; 8 × 200,000 = 1,600,000; 4 × 150,000 = 600,000 → OVERTIME 5,050,000',
			`Night: Labour Code art.98(2)–(3), ${LC_CITE} art.57(1)(b1): a night overtime hour after day-time overtime adds 30% + 20% × 150% = 60% of the hour: 0.5 × 60,000 = 30,000`,
			'Limits: Labour Code art.107(2) — at most 4 overtime hours on a normal day and 40 a month; 23 hours here',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}: on the 17,600,000 contract salary only — 1,408,000 / 3,080,000; 264,000 / 528,000; 176,000 / 176,000`,
			`${PIT_CITE}; Law 109/2025 art.4(8): overtime and night pay are exempt: 17,600,000 − 1,848,000 − 15,500,000 = 252,000 × 5% = 12,600`,
			'Gross 17,600,000 + 5,050,000 + 30,000 = 22,680,000; net 22,680,000 − 1,848,000 − 12,600 = 20,819,400'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'oanh',
				name: 'Mai Thị Oanh',
				number: 'P-VN-071',
				born: '1995-03-03',
				gender: 'FEMALE',
				salary: 17_600_000,
				from: '2025-06-02'
			}),
			holiday('2026-01-01', 'Tết Dương lịch'),
			worked(
				'oanh_job',
				'2026-01-01',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				8
			),
			worked(
				'oanh_job',
				'2026-01-06',
				[
					['09:00', '13:00'],
					['14:00', '18:00'],
					['18:30', '21:30']
				],
				3
			),
			worked(
				'oanh_job',
				'2026-01-11',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				8
			),
			worked(
				'oanh_job',
				'2026-01-13',
				[
					['09:00', '13:00'],
					['14:00', '18:00'],
					['18:30', '22:30']
				],
				4
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'oanh_job',
				lines: {
					gross: 22_680_000,
					net: 20_819_400,
					employer_cost: 3_784_000,
					BASIC: 17_600_000,
					OVERTIME: 5_050_000,
					NIGHT_PREMIUM: 30_000,
					'SI.employee': 1_408_000,
					'SI.employer': 3_080_000,
					'HI.employee': 264_000,
					'HI.employer': 528_000,
					'UI.employee': 176_000,
					'UI.employer': 176_000,
					'PIT.employee': 12_600
				}
			}
		]
	},
	{
		id: 'VN-LC90-01-1',
		profile: 'VN',
		description:
			'A raise inside the month for a foreign work-permit holder (tax resident): 50,000,000 to Monday 16 March 2026, 60,000,000 from Tuesday the 17th — 11 working days each. Both salaries are above the SI/HI ceiling, so the split month insures 46,800,000 whichever salary is read; a foreigner is outside UI.',
		citation: [
			'Labour Code 45/2019 art.90, art.95: the wage agreed for the time worked; owner rule VN-PRORATE-01: 50,000,000 × 11 ÷ 22 + 60,000,000 × 11 ÷ 22 = 25,000,000 + 30,000,000 = 55,000,000',
			`${SI_CITE}; art.2(2): a foreigner with a work permit on an open-ended contract is covered: 3,744,000 / 8,190,000`,
			`${HI_CITE}: 702,000 / 1,404,000`,
			'UI: Law 74/2025/QH15 art.2(1) — the worker the law covers is a Vietnamese citizen: none',
			`${PIT_CITE}: 55,000,000 − 4,446,000 − 15,500,000 = 35,054,000 → 500,000 + 2,000,000 + 1,010,800 = 3,510,800`,
			'Net 55,000,000 − 4,446,000 − 3,510,800 = 47,043,200'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'kenji',
				name: 'Tanaka Kenji',
				number: 'P-VN-081',
				born: '1982-08-08',
				foreigner: true,
				salary: [
					{ amount: 50_000_000, from: '2025-06-02', to: '2026-03-16' },
					{ amount: 60_000_000, from: '2026-03-17', to: null }
				],
				from: '2025-06-02'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'kenji_job',
				lines: {
					gross: 55_000_000,
					net: 47_043_200,
					employer_cost: 9_594_000,
					BASIC: 55_000_000,
					'SI.employee': 3_744_000,
					'SI.employer': 8_190_000,
					'HI.employee': 702_000,
					'HI.employer': 1_404_000,
					'PIT.employee': 3_510_800
				}
			}
		]
	},
	{
		id: 'VN-LC112-01-1',
		profile: 'VN',
		description:
			'A foreign work-permit holder (tax resident) on 20,000,000 takes one of the two paid home-country days (10 March 2026): pay is whole; SI and HI apply, UI does not.',
		citation: [
			'Labour Code 45/2019 art.112(2): a foreign worker also has one traditional New Year day and one national day of their country off at full pay (https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf)',
			`${SI_CITE}; art.2(2): 1,600,000 / 3,500,000`,
			`${HI_CITE}: 300,000 / 600,000; UI: Law 74/2025 art.2(1) citizens only — none`,
			`${PIT_CITE}: 20,000,000 − 1,900,000 − 15,500,000 = 2,600,000 × 5% = 130,000`,
			'Net 20,000,000 − 1,900,000 − 130,000 = 17,970,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'sato',
				name: 'Sato Hiroshi',
				number: 'P-VN-091',
				born: '1988-10-10',
				foreigner: true,
				salary: 20_000_000,
				from: '2025-06-02'
			}),
			leave('sato_job', 'FOREIGN_NATIONAL_LEAVE', {
				reference: 'FNL-1',
				from_date: '2026-03-10',
				to_date: '2026-03-10',
				reason: 'Home-country national day'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'sato_job',
				lines: {
					gross: 20_000_000,
					net: 17_970_000,
					employer_cost: 4_100_000,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'PIT.employee': 130_000
				}
			}
		]
	},
	{
		id: 'VN-PIT-03-1',
		profile: 'VN',
		description:
			'A declared non-resident foreign work-permit holder on 30,000,000, March 2026: 20% of taxable pay with no deductions; SI and HI apply, UI does not.',
		citation: [
			'PIT: Decree 253/2026/ND-CP art.5 and PIT Law 109/2025 — a non-resident’s salary is taxed at 20% with no personal, dependant or insurance deduction: 30,000,000 × 20% = 6,000,000',
			`${SI_CITE}: 2,400,000 / 5,250,000; ${HI_CITE}: 450,000 / 900,000; UI: Law 74/2025 art.2(1) — none`,
			'Net 30,000,000 − 2,850,000 − 6,000,000 = 21,150,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'park',
				name: 'Park Jisoo',
				number: 'P-VN-101',
				born: '1986-12-01',
				nationality: 'Korean',
				foreigner: true,
				nonResident: true,
				salary: 30_000_000,
				from: '2025-06-02'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'park_job',
				lines: {
					gross: 30_000_000,
					net: 21_150_000,
					employer_cost: 6_150_000,
					'SI.employee': 2_400_000,
					'SI.employer': 5_250_000,
					'HI.employee': 450_000,
					'HI.employer': 900_000,
					'PIT.employee': 6_000_000
				}
			}
		]
	},
	{
		id: 'VN-PIT-08-1',
		profile: 'VN',
		description:
			'Resident deductions, March 2026, 30,000,000: one worker with one registered dependant; one with no dependant who pays a 4,000,000 voluntary-pension premium (deductible to 3,000,000 a month).',
		citation: [
			`${PIT_CITE}: 30,000,000 − 3,150,000 − 15,500,000 − 6,200,000 = 5,150,000 × 5% = 257,500`,
			'Voluntary pension: Decree 253/2026/ND-CP — supplementary/voluntary pension and life insurance deductible up to 3,000,000 a month in total (https://xaydungchinhsach.chinhphu.vn/quy-dinh-moi-ve-khau-tru-thue-thu-nhap-ca-nhan-119260703150410707.htm): 30,000,000 − 3,150,000 − 15,500,000 − 3,000,000 = 8,350,000 × 5% = 417,500',
			`${SI_CITE}: 2,400,000 / 5,250,000; ${HI_CITE}: 450,000 / 900,000; ${UI_CITE}: 300,000 / 300,000`,
			'Net 30,000,000 − 3,150,000 − 257,500 = 26,592,500 and − 417,500 = 26,432,500 (the premium is the employee’s own, not a payroll deduction)'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'quang',
				name: 'Đinh Văn Quang',
				number: 'P-VN-111',
				born: '1987-02-02',
				salary: 30_000_000,
				from: '2025-06-02',
				dependants: 1
			}),
			...hire({
				ref: 'phuong',
				name: 'Tạ Thị Phương',
				number: 'P-VN-112',
				born: '1984-04-04',
				gender: 'FEMALE',
				salary: 30_000_000,
				from: '2025-06-02',
				pit: {
					deduction_claims: [
						{
							period: '2026-03',
							category: 'VOLUNTARY_PENSION',
							amount: 4_000_000,
							source: 'EMPLOYEE',
							reference: 'VP-2026-03'
						}
					]
				}
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'quang_job',
				lines: {
					gross: 30_000_000,
					net: 26_592_500,
					employer_cost: 6_450_000,
					'SI.employee': 2_400_000,
					'SI.employer': 5_250_000,
					'HI.employee': 450_000,
					'HI.employer': 900_000,
					'UI.employee': 300_000,
					'UI.employer': 300_000,
					'PIT.employee': 257_500
				}
			},
			{
				employment: 'phuong_job',
				lines: {
					gross: 30_000_000,
					net: 26_432_500,
					employer_cost: 6_450_000,
					'SI.employee': 2_400_000,
					'SI.employer': 5_250_000,
					'HI.employee': 450_000,
					'HI.employer': 900_000,
					'UI.employee': 300_000,
					'UI.employer': 300_000,
					'PIT.employee': 417_500
				}
			}
		]
	},
	{
		id: 'VN-UNION-01-1',
		profile: 'VN',
		description:
			'Union members in a non-State enterprise, March 2026: dues 0.5% of the SI salary, capped at 10% of the base salary — 30,000,000 pays 150,000; 60,000,000 insures 46,800,000 and pays exactly the 234,000 cap. Dues are not a PIT deduction.',
		citation: [
			'Union dues: VGCL Decision 61/QĐ-TLĐ (in force 1 July 2025), group 3 (non-State enterprises): 0.5% of the salary compulsory SI is based on, at most 10% of the base salary 2,340,000 = 234,000 (https://pbgdpl.cantho.gov.vn/quyet-dinh-61qd-tld-ve-dieu-chinh-giam-muc-dong-doan-phi-cong-doan); Trade Union Law 50/2024/QH15 art.29',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}`,
			`${PIT_CITE}: 30,000,000 − 3,150,000 − 15,500,000 = 11,350,000 → 500,000 + 135,000 = 635,000; 60,000,000 → 4,390,800`,
			'Net 30,000,000 − 3,150,000 − 635,000 − 150,000 = 26,065,000; 60,000,000 − 5,046,000 − 4,390,800 − 234,000 = 50,329,200. The employer’s 2% union fund is an establishment line, not a payslip charge (Trade Union Law art.29(1)(b))'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'son',
				name: 'Châu Văn Sơn',
				number: 'P-VN-121',
				born: '1983-05-05',
				salary: 30_000_000,
				from: '2025-06-02',
				member: true
			}),
			...hire({
				ref: 'tam',
				name: 'Quách Văn Tâm',
				number: 'P-VN-122',
				born: '1979-06-06',
				salary: 60_000_000,
				from: '2025-06-02',
				member: true
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'son_job',
				lines: {
					gross: 30_000_000,
					net: 26_065_000,
					total_deductions: 3_935_000,
					'SI.employee': 2_400_000,
					'SI.employer': 5_250_000,
					'HI.employee': 450_000,
					'HI.employer': 900_000,
					'UI.employee': 300_000,
					'UI.employer': 300_000,
					'UNION_DUES.employee': 150_000,
					'PIT.employee': 635_000
				}
			},
			{
				employment: 'tam_job',
				lines: {
					gross: 60_000_000,
					net: 50_329_200,
					'SI.employee': 3_744_000,
					'SI.employer': 8_190_000,
					'HI.employee': 702_000,
					'HI.employer': 1_404_000,
					'UI.employee': 600_000,
					'UI.employer': 600_000,
					'UNION_DUES.employee': 234_000,
					'PIT.employee': 4_390_800
				}
			}
		]
	},
	{
		id: 'VN-LC168-01-1',
		profile: 'VN',
		description:
			'A pensioner aged 63 re-employed on 20,000,000, March 2026: outside compulsory SI and UI, insured for HI by the SI agency, so the employer pays the SI 17.5% and UI 1% equivalents with the wage; the equivalent is taxable pay.',
		citation: [
			'Labour Code 45/2019 art.168(3): a worker outside compulsory SI/HI/UI is paid, with the wage, an amount equal to the employer’s contribution; Law 41/2024 art.2(7)(a): a pensioner is outside compulsory SI; Law 74/2025 art.31(2): a pension recipient is outside UI; HI Law art.12 (Law 51/2024): a pensioner is insured by the SI agency, so no HI equivalent: 20,000,000 × (17.5% + 1%) = 3,700,000',
			`${PIT_CITE}: 20,000,000 + 3,700,000 − 15,500,000 = 8,200,000 × 5% = 410,000 (no compulsory insurance deducted)`,
			'Gross 23,700,000; net 23,290,000; no statutory employer share'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'uy',
				name: 'Hà Văn Uy',
				number: 'P-VN-131',
				born: '1962-10-01',
				salary: 20_000_000,
				from: '2025-06-02',
				pensioner: true
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'uy_job',
				lines: {
					gross: 23_700_000,
					net: 23_290_000,
					employer_cost: 0,
					INSURANCE_EQUIVALENT: 3_700_000,
					'PIT.employee': 410_000
				}
			}
		]
	},
	{
		id: 'VN-LC104-01-1',
		profile: 'VN',
		description:
			'A Tết bonus of 20,000,000 paid with March 2026 salary of 20,000,000: taxed as salary income of the month paid, outside the insurance salary. The VN lineage seals no bonus class yet, so this case names BONUS (the code MY, TH and CN use) and fails at input until one is sealed.',
		citation: [
			'Labour Code 45/2019 art.104: a bonus is paid under the employer’s published regulation',
			`${SI_CITE} art.31(1)(b) with Decree 158/2025/ND-CP art.7: the insurance salary excludes bonuses → 1,600,000 / 3,500,000; ${HI_CITE}: 300,000 / 600,000; ${UI_CITE}: 200,000 / 200,000`,
			`${PIT_CITE}: bonus is salary income taxed in the month paid: 40,000,000 − 2,100,000 − 15,500,000 = 22,400,000 → 500,000 + 1,240,000 = 1,740,000`,
			'Net 40,000,000 − 2,100,000 − 1,740,000 = 36,160,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'vy',
				name: 'Kiều Thị Vy',
				number: 'P-VN-141',
				born: '1997-07-17',
				gender: 'FEMALE',
				salary: 20_000_000,
				from: '2025-06-02'
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@vy_job',
					catalogue_id: '@law:adhoc_catalogue:BONUS',
					amount: 20_000_000,
					event_date: '2026-03-20',
					pay_period: '2026-03',
					reason: 'Tết bonus'
				}
			}
		],
		period: '2026-03',
		expected: [
			{
				employment: 'vy_job',
				lines: {
					gross: 40_000_000,
					net: 36_160_000,
					BONUS: 20_000_000,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'UI.employee': 200_000,
					'UI.employer': 200_000,
					'PIT.employee': 1_740_000
				}
			}
		]
	},
	{
		id: 'VN-LC97-01-1',
		profile: 'VN',
		description:
			'February’s 20,000,000 wage, due 28 February 2026, paid 20 days late on 20 March: the March payslip adds the interest at the payroll bank’s published one-month deposit rate (a case input: 4.5% a year).',
		citation: [
			'Labour Code 45/2019 art.97(4): a wage paid 15 or more days late earns at least interest on it at the one-month deposit rate of the payroll bank on the payment day; owner rule 2026-09-28 (VN-LC97-01): actual days over 365, rounded up: 20,000,000 × 4.5% × 20 ÷ 365 = 49,315.07 → 49,316',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}: on the March salary only`,
			`${PIT_CITE}: the compensation is taxable pay (owner rule, VN-LC97-01): 20,049,316 − 2,100,000 − 15,500,000 = 2,449,316 × 5% = 122,465.8 → 122,466`,
			'Net 20,049,316 − 2,100,000 − 122,466 = 17,826,850'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'xuan',
				name: 'Lâm Văn Xuân',
				number: 'P-VN-151',
				born: '1989-09-19',
				salary: 20_000_000,
				from: '2025-06-02'
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@xuan_job',
					catalogue_id: '@law:adhoc_catalogue:LATE_WAGE_COMPENSATION',
					amount: 20_000_000,
					event_date: '2026-03-20',
					pay_period: '2026-03',
					reason: 'February wage paid late',
					late_wage: {
						due_on: '2026-02-28',
						paid_on: '2026-03-20',
						deposit_rate: 4.5,
						rate_reference: 'PROBE-BANK-NOTICE-2026-03-20',
						force_majeure: false
					}
				}
			}
		],
		period: '2026-03',
		expected: [
			{
				employment: 'xuan_job',
				lines: {
					gross: 20_049_316,
					net: 17_826_850,
					LATE_WAGE_COMPENSATION: 49_316,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'UI.employee': 200_000,
					'UI.employer': 200_000,
					'PIT.employee': 122_466
				}
			}
		]
	},
	{
		id: 'VN-PIT-06-1',
		profile: 'VN',
		description:
			'A two-month fixed-term contract (2 March – 30 April 2026) on 10,000,000: SI, HI and UI apply from one month; PIT is 10% of the payment, the resident table not applying under three months.',
		citation: [
			'PIT: Circular 111/2013/TT-BTC art.25(1)(i) — a resident on a contract under three months is withheld 10% of each payment of 2,000,000 or more, before July 2026: 10,000,000 × 10% = 1,000,000',
			`${SI_CITE}; art.2(1)(a): contracts of one month or more: 800,000 / 1,750,000; ${HI_CITE}: 150,000 / 300,000; ${UI_CITE}; art.31(1): 100,000 / 100,000`,
			'Net 10,000,000 − 1,050,000 − 1,000,000 = 7,950,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'yen',
				name: 'Tô Thị Yến',
				number: 'P-VN-161',
				born: '2001-01-01',
				gender: 'FEMALE',
				type: 'CONTRACT',
				salary: 10_000_000,
				from: '2026-03-02',
				to: '2026-04-30',
				exitReason: 'END_OF_CONTRACT',
				pit: {
					unit_assessments: [
						{
							period: '2026-03',
							gross: 10_000_000,
							units: 1,
							reference: 'MAR-WAGE',
							paid_on: '2026-03-31'
						}
					]
				}
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'yen_job',
				lines: {
					gross: 10_000_000,
					net: 7_950_000,
					employer_cost: 2_150_000,
					'SI.employee': 800_000,
					'SI.employer': 1_750_000,
					'HI.employee': 150_000,
					'HI.employer': 300_000,
					'UI.employee': 100_000,
					'UI.employer': 100_000,
					'PIT.employee': 1_000_000
				}
			}
		]
	},
	{
		id: 'VN-MW293-04-1',
		profile: 'VN',
		description:
			'The Region IV floors, March 2026: a full-timer on exactly 3,700,000; a 2025 hire on 3,860,000, the 2025 Region III floor protected after a downward reclassification; and a part-timer on exactly 2,340,000, the lowest SI salary, so inside SI, HI and UI.',
		citation: [
			'Minimum wage: Decree 293/2025/ND-CP art.3 Region IV 3,700,000 from 1 January 2026 (https://vanban.chinhphu.vn/?pageid=27160&docid=215832); art.5(5) keeps a higher 2025 floor after a downward locality reclassification — Decree 74/2024 Region III 3,860,000',
			`${SI_CITE}; art.2(1): a part-timer whose monthly salary is at least the lowest SI salary (the reference level 2,340,000) is covered: 3,700,000 → 296,000 / 647,500; 3,860,000 → 308,800 / 675,500; 2,340,000 → 187,200 / 409,500`,
			`${HI_CITE}: 55,500 / 111,000; 57,900 / 115,800; 35,100 / 70,200`,
			`${UI_CITE}; art.31(1): 37,000; 38,600; 23,400 each side`,
			`${PIT_CITE}: every salary is below 15,500,000 → 0`
		],
		company: company('IV'),
		inputs: [
			...WEEK,
			{
				collection: 'shift_definitions',
				ref: 'half',
				values: {
					company_id: '@company',
					code: 'HALF',
					name: 'Half day (0900 to 1300)',
					variant: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 },
					effective_range: { from: '2007-12-31', to: null }
				}
			},
			{
				collection: 'shift_patterns',
				ref: 'halfweek',
				values: {
					company_id: '@company',
					code: 'HALFx5-OFF-REST',
					name: '5 x HALF, OFF, REST',
					pattern: {
						days: ['@half', '@half', '@half', '@half', '@half', '@off', '@rest'].map(
							(roster_code_id) => ({ roster_code_id })
						)
					},
					effective_range: { from: '2007-12-31', to: null }
				}
			},
			...hire({
				ref: 'thu',
				name: 'Vương Thị Thu',
				number: 'P-VN-171',
				born: '1999-09-09',
				gender: 'FEMALE',
				salary: 3_700_000,
				from: '2025-06-02',
				region: 'IV'
			}),
			...hire({
				ref: 'vinh',
				name: 'Mạc Văn Vinh',
				number: 'P-VN-172',
				born: '1990-10-10',
				salary: 3_860_000,
				from: '2025-06-02',
				termsFacts: { prior_floor_region: 'III', prior_floor_reclassified: true }
			}),
			...hire({
				ref: 'xoan',
				name: 'Lục Thị Xoan',
				number: 'P-VN-173',
				born: '2000-11-11',
				gender: 'FEMALE',
				type: 'PART_TIME',
				salary: 2_340_000,
				from: '2025-06-02',
				region: 'IV',
				pattern: '@halfweek',
				terms: { ordinary_hours_per_week: 20 }
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'thu_job',
				lines: {
					gross: 3_700_000,
					net: 3_311_500,
					employer_cost: 795_500,
					'SI.employee': 296_000,
					'SI.employer': 647_500,
					'HI.employee': 55_500,
					'HI.employer': 111_000,
					'UI.employee': 37_000,
					'UI.employer': 37_000
				}
			},
			{
				employment: 'vinh_job',
				lines: {
					gross: 3_860_000,
					net: 3_454_700,
					employer_cost: 829_900,
					'SI.employee': 308_800,
					'SI.employer': 675_500,
					'HI.employee': 57_900,
					'HI.employer': 115_800,
					'UI.employee': 38_600,
					'UI.employer': 38_600
				}
			},
			{
				employment: 'xoan_job',
				lines: {
					gross: 2_340_000,
					net: 2_094_300,
					employer_cost: 503_100,
					'SI.employee': 187_200,
					'SI.employer': 409_500,
					'HI.employee': 35_100,
					'HI.employer': 70_200,
					'UI.employee': 23_400,
					'UI.employer': 23_400
				}
			}
		]
	},
	{
		id: 'VN-PIT-01-1',
		profile: 'VN',
		description:
			'December 2025 under the law then in force: a citizen on 20,000,000 withheld on the seven-bracket table with the 11,000,000 personal deduction, and a citizen on exactly the Decree 74/2024 Region I floor of 4,960,000.',
		citation: [
			'PIT: PIT Law 04/2007/QH12 art.22 (Law 26/2012/QH13) monthly table 5% to 5m, 10% to 10m, 15% to 18m …; Resolution 954/2020/UBTVQH14 personal deduction 11,000,000: 20,000,000 − 2,100,000 − 11,000,000 = 6,900,000 → 250,000 + 190,000 = 440,000',
			'Minimum wage: Decree 74/2024/ND-CP Region I 4,960,000 a month to 31 December 2025',
			`${SI_CITE}: 1,600,000 / 3,500,000; 396,800 / 868,000`,
			`${HI_CITE}: 300,000 / 600,000; 74,400 / 148,800`,
			'UI: Law on Employment 38/2013/QH13 art.57: 1% + 1% → 200,000; 49,600',
			'Net 20,000,000 − 2,100,000 − 440,000 = 17,460,000; 4,960,000 − 520,800 = 4,439,200'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'bao',
				name: 'Âu Văn Bảo',
				number: 'P-VN-181',
				born: '1991-03-13',
				salary: 20_000_000,
				from: '2025-06-02',
				uiFrom: null
			}),
			...hire({
				ref: 'cam',
				name: 'Ông Thị Cẩm',
				number: 'P-VN-182',
				born: '2002-02-22',
				gender: 'FEMALE',
				salary: 4_960_000,
				from: '2025-06-02',
				uiFrom: null
			})
		],
		period: '2025-12',
		expected: [
			{
				employment: 'bao_job',
				lines: {
					gross: 20_000_000,
					net: 17_460_000,
					employer_cost: 4_300_000,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'UI.employee': 200_000,
					'UI.employer': 200_000,
					'PIT.employee': 440_000
				}
			},
			{
				employment: 'cam_job',
				lines: {
					gross: 4_960_000,
					net: 4_439_200,
					employer_cost: 1_066_400,
					'SI.employee': 396_800,
					'SI.employer': 868_000,
					'HI.employee': 74_400,
					'HI.employer': 148_800,
					'UI.employee': 49_600,
					'UI.employer': 49_600
				}
			}
		]
	},
	{
		id: 'VN-CULT-DAY-01-1',
		profile: 'VN',
		description:
			'Vietnam Culture Day, Tuesday 24 November 2026, on the published calendar: a monthly-paid citizen on 20,000,000 has the day off at full pay; the payslip is the whole month.',
		citation: [
			'National Assembly Resolution 28/2026/QH16 art.2(1): 24 November each year is Vietnam Culture Day, a paid day off (https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/nq28phattrienvanhoa.pdf)',
			`${SI_CITE} (20,000,000 is below every ceiling), ${HI_CITE}, ${UI_CITE}: 1,600,000 / 3,500,000; 300,000 / 600,000; 200,000 / 200,000`,
			`${PIT_CITE}: 20,000,000 − 2,100,000 − 15,500,000 = 2,400,000 × 5% = 120,000`,
			'Net 17,780,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'duc',
				name: 'Giáp Văn Đức',
				number: 'P-VN-191',
				born: '1993-04-24',
				salary: 20_000_000,
				from: '2025-06-02'
			}),
			holiday('2026-11-24', 'Ngày Văn hóa Việt Nam')
		],
		period: '2026-11',
		expected: [
			{
				employment: 'duc_job',
				lines: {
					gross: 20_000_000,
					net: 17_780_000,
					employer_cost: 4_300_000,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'UI.employee': 200_000,
					'UI.employer': 200_000,
					'PIT.employee': 120_000
				}
			}
		]
	}
);
