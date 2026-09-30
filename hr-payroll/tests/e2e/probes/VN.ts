import { officeWeek, register, type ProbeCase, type ProbeInput, type Row } from '../payroll-probe.ts';

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
	/** A person with a disability (`employee.disabled`). */
	disabled?: boolean;
	/** Further UI elections (the Decree 374/2025 art.5 disabled-hire reduction). */
	uiElections?: Row;
	/** Qualified for a monthly pension though not receiving one (Law 74/2025 art.31(2)); defaults to `pensioner`. */
	pensionQualified?: boolean;
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
				receiving_pension: p.pensioner ?? false,
				...(p.disabled ? { disabled: true } : {})
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
						elections: {
							pension_qualified: p.pensionQualified ?? p.pensioner ?? false,
							...p.uiElections
						}
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
	'UI: Decree 374/2025/ND-CP art.4(1)–(2) worker 1%, employer 1% (Official Gazette 48 of 23 January 2026, pp.3–4; Law 74/2025/QH15 art.33(1) sets only the 1% maximum), Law 74/2025/QH15 art.34(2) ceiling 20 × the regional minimum (Region I 5,310,000 → 106,200,000, Decree 293/2025/ND-CP) (https://xaydungchinhsach.chinhphu.vn/toan-van-luat-viec-lam-119250711173403835.htm)';
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
			'Four mid-month leavers on Friday 17 April 2026, each hired 1 January 2008 on 22,000,000: one resigns with UI from 1 January 2009 (one uncovered year, severance), one is made redundant with the same UI history (job-loss allowance), and two resign with UI from 1 July and 1 August 2009 (a 6- and a 7-month leftover). Final salary on 13 of April’s 22 working days, 5 untaken annual-leave days at March’s contract wage, and the 10% withholding on salary paid after the contract ended.',
		citation: [
			`Final salary: owner rule VN-PRORATE-01 and ${LC_CITE} art.54(1)(a3): 22,000,000 × 13 ÷ 22 = 13,000,000`,
			`Annual leave: Labour Code art.113(1) 12 days + art.114(1) one day per five years (18 full years → 3) = 15; ${LC_CITE} art.66(1)–(2): 15 ÷ 12 × 4 months (April’s 13 of 22 days is at least 50%) = 5 days; art.67(3): March contract salary 22,000,000 ÷ 22 normal working days = 1,000,000 a day → 5,000,000`,
			`Severance: Labour Code art.46 half a month per year; ${LC_CITE} art.8(1), (3)(b)–(c): service 1 January 2008 – 17 April 2026 less UI-insured time from 1 January 2009 = 12 months = 1 year; salary the six-month contractual average 22,000,000 → 11,000,000. The resignation is the worker’s unilateral termination, Labour Code art.34(9) with art.35 (Official Gazette 993+994 pp.17–18), one of the art.34 grounds Decree 145/2020 art.8(1) lists for severance; the leaver does not qualify for a pension (exit fact)`,
			`Remainders, ${LC_CITE} art.8(3)(c): a leftover of 6 months or less counts as half a year, over 6 months as a year. A resigner with UI from 1 July 2009 has 18 uncovered months = 1 year 6 months → 1.5 years × 11,000,000 = 16,500,000; one with UI from 1 August 2009 has 19 = 1 year 7 months → 2 years → 22,000,000`,
			'Calendar: 26 April 2026 (Hùng Kings, 10th day of the 3rd lunar month, a Sunday, substituted on Monday 27 April under art.111(3); Government policy portal https://xaydungchinhsach.chinhphu.vn/lich-nghi-le-gio-to-hung-vuong-30-4-1-5-quoc-khanh-2-9-nam-2026-119260222115822151.htm) and 30 April (art.112(1)(c)) are published; both fall after the 17 April exit, so April keeps 22 normal working days with the holidays among them',
			`Job-loss: Labour Code art.47 one month per year, ${LC_CITE} art.8(2): at least two months where the service is under 24 months → 2 × 22,000,000 = 44,000,000 (redundancy, art.34(11))`,
			`${SI_CITE}; arts.33(5), 34(3): nine unworked days after the exit is under 14 → the whole contract salary: 1,760,000 / 3,850,000`,
			`${HI_CITE}: 330,000 / 660,000; ${UI_CITE}: 220,000 / 220,000`,
			'PIT: the April salary is paid on 30 April, after the contract ended on the 17th: owner rule 2026-09-28 (VN-PIT-06, Circular 111/2013/TT-BTC art.25(1)(i), GDT letter 51/TCT-DNNCN) withholds 10% of the payment: 13,000,000 × 10% = 1,300,000. Untaken-leave pay is exempt (Law 109/2025 art.4(8); Decree 253/2026 art.26(2)); severance and job-loss allowances are outside salary income (Decree 253/2026 art.8(3)(h))',
			'Resigner: gross 13,000,000 + 5,000,000 + 11,000,000 = 29,000,000, net 29,000,000 − 2,310,000 − 1,300,000 = 25,390,000. Redundant: gross 13,000,000 + 5,000,000 + 44,000,000 = 62,000,000, net 58,390,000. 6-month leftover: gross 34,500,000, net 30,890,000. 7-month leftover: gross 40,000,000, net 36,390,000',
			'Final pay due within 14 working days (Labour Code art.48(1)), 30 days for redundancy (art.48(1)(b)): a run warning, not a payslip line'
		],
		company: company(),
		inputs: [
			...WEEK,
			holiday('2026-04-26', 'Giỗ Tổ Hùng Vương'),
			holiday('2026-04-30', 'Ngày Chiến thắng'),
			...(
				[
					{
						ref: 'giang',
						name: 'Đỗ Thị Giang',
						gender: 'FEMALE',
						uiFrom: '2009-01-01',
						redundant: false
					},
					{
						ref: 'hai',
						name: 'Bùi Văn Hải',
						gender: 'MALE',
						uiFrom: '2009-01-01',
						redundant: true
					},
					{
						ref: 'hoa',
						name: 'Phan Thị Hoa',
						gender: 'FEMALE',
						uiFrom: '2009-07-01',
						redundant: false
					},
					{
						ref: 'hung',
						name: 'Lương Văn Hùng',
						gender: 'MALE',
						uiFrom: '2009-08-01',
						redundant: false
					}
				] as const
			).flatMap(({ ref, name, gender, uiFrom, redundant }, index) => [
				...hire({
					ref,
					name,
					number: `P-VN-04${index + 1}`,
					born: '1980-09-09',
					gender,
					salary: 22_000_000,
					from: '2008-01-01',
					to: '2026-04-17',
					uiFrom,
					exitReason: redundant ? 'REDUNDANCY' : 'RESIGNATION',
					exitFacts: redundant ? {} : { pension_eligible: false },
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
						catalogue_id: redundant
							? '@law:adhoc_catalogue:JOB_LOSS_ALLOWANCE'
							: '@law:adhoc_catalogue:SEVERANCE_ALLOWANCE',
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
			},
			{
				employment: 'hoa_job',
				lines: {
					gross: 34_500_000,
					net: 30_890_000,
					employer_cost: 4_730_000,
					SEVERANCE_ALLOWANCE: 16_500_000,
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
				employment: 'hung_job',
				lines: {
					gross: 40_000_000,
					net: 36_390_000,
					employer_cost: 4_730_000,
					SEVERANCE_ALLOWANCE: 22_000_000,
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
			'Unpaid and paid personal leave, March 2026, 22,000,000 each: the unpaid day for a grandparent’s death and for a sibling’s marriage (one working day off pay), and the paid days for the worker’s own marriage (3), a child’s marriage (1) and a spouse’s parent’s death (3) (no deduction).',
		citation: [
			'Labour Code 45/2019 art.115(1)(a) own marriage 3 paid days, (b) a child’s marriage 1, (c) the death of a parent, a spouse’s parent, a spouse or a child 3; art.115(2) one unpaid day for the death of a grandparent or sibling or the marriage of a parent or sibling (Official Gazette 993+994 p.50, https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf)',
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
			}),
			...hire({
				ref: 'phuc',
				name: 'Kha Văn Phúc',
				number: 'P-VN-063',
				born: '1970-02-02',
				gender: 'MALE',
				salary: 22_000_000,
				from: '2025-06-02'
			}),
			...hire({
				ref: 'quyen',
				name: 'Đoàn Thị Quyên',
				number: 'P-VN-064',
				born: '1985-03-03',
				gender: 'FEMALE',
				salary: 22_000_000,
				from: '2025-06-02'
			}),
			...hire({
				ref: 'rang',
				name: 'Thân Văn Rạng',
				number: 'P-VN-065',
				born: '1994-04-04',
				gender: 'MALE',
				salary: 22_000_000,
				from: '2025-06-02'
			}),
			leave('phuc_job', 'CHILD_MARRIAGE_LEAVE', {
				reference: 'MAR-C-1',
				from_date: '2026-03-16',
				to_date: '2026-03-16',
				event_kind: 'MARRIAGE',
				event_relationship: 'CHILD',
				event_date: '2026-03-16',
				reason: 'Child’s marriage'
			}),
			leave('quyen_job', 'BEREAVEMENT_LEAVE', {
				reference: 'BRV-P-1',
				from_date: '2026-03-17',
				to_date: '2026-03-19',
				event_kind: 'DEATH',
				event_relationship: 'PARENT_IN_LAW',
				event_date: '2026-03-17',
				reason: 'Death of a spouse’s parent'
			}),
			leave('rang_job', 'BEREAVEMENT_LEAVE_UNPAID', {
				reference: 'BRV-U-2',
				from_date: '2026-03-20',
				to_date: '2026-03-20',
				event_kind: 'MARRIAGE',
				event_relationship: 'SIBLING',
				event_date: '2026-03-20',
				reason: 'Marriage of a sibling'
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
			},
			{
				employment: 'phuc_job',
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
			},
			{
				employment: 'quyen_job',
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
			},
			{
				employment: 'rang_job',
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
			`${SI_CITE}; Law 41/2024/QH15 art.2(2) (Official Gazette 987+988 pp.4–5): a foreigner with a work permit is covered on a fixed-term labour contract of 12 months or more (“hợp đồng lao động xác định thời hạn có thời hạn từ đủ 12 tháng trở lên”); Labour Code art.151(2) (Official Gazette 993+994 p.65) caps a foreign worker’s contract at the work-permit term, so the case hires on a 24-month fixed term, 2 June 2025 – 1 June 2027: 3,744,000 / 8,190,000`,
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
					{ amount: 60_000_000, from: '2026-03-17', to: '2027-06-01' }
				],
				type: 'CONTRACT',
				from: '2025-06-02',
				to: '2027-06-01'
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
			'A Greek work-permit holder (tax resident, 24-month fixed-term contract) on 20,000,000 takes the paid home-country national day, Greece’s 25 March Independence Day (Wednesday 25 March 2026): pay is whole; SI and HI apply, UI does not.',
		citation: [
			'Labour Code 45/2019 art.112(2): a foreign worker also has one traditional New Year day and one national day of their country off at full pay (https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf)',
			`${SI_CITE}; Law 41/2024/QH15 art.2(2) (Official Gazette 987+988 pp.4–5): a foreigner with a work permit is covered on a fixed-term labour contract of 12 months or more (“hợp đồng lao động xác định thời hạn có thời hạn từ đủ 12 tháng trở lên”); Labour Code art.151(2) (Official Gazette 993+994 p.65) caps a foreign worker’s contract at the work-permit term, so the case hires on a 24-month fixed term, 2 June 2025 – 1 June 2027: 1,600,000 / 3,500,000`,
			`${HI_CITE}: 300,000 / 600,000; UI: Law 74/2025 art.2(1) citizens only — none`,
			`${PIT_CITE}: 20,000,000 − 1,900,000 − 15,500,000 = 2,600,000 × 5% = 130,000`,
			'Net 20,000,000 − 1,900,000 − 130,000 = 17,970,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'nikos',
				name: 'Nikos Papadopoulos',
				number: 'P-VN-091',
				born: '1988-10-10',
				nationality: 'Greek',
				foreigner: true,
				type: 'CONTRACT',
				salary: 20_000_000,
				from: '2025-06-02',
				to: '2027-06-01'
			}),
			leave('nikos_job', 'FOREIGN_NATIONAL_LEAVE', {
				reference: 'FNL-1',
				from_date: '2026-03-25',
				to_date: '2026-03-25',
				reason: 'Home-country national day (Greece, 25 March)'
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'nikos_job',
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
			'A declared non-resident foreign work-permit holder on 30,000,000 (24-month fixed-term contract), March 2026: 20% of taxable pay with no deductions; SI and HI apply, UI does not.',
		citation: [
			'PIT: March 2026 is before Law 109/2025/QH15 takes effect (1 July 2026, art.29(1); art.29(2) brings forward only the resident salary rules), so PIT Law 04/2007/QH12 art.26 and Circular 111/2013/TT-BTC art.18(1) (Official Gazette 563+564 p.61) govern: a non-resident’s salary × 20%, with no personal, dependant or insurance deduction: 30,000,000 × 20% = 6,000,000',
			`${SI_CITE}; Law 41/2024/QH15 art.2(2) (Official Gazette 987+988 pp.4–5): a foreigner with a work permit is covered on a fixed-term labour contract of 12 months or more (“hợp đồng lao động xác định thời hạn có thời hạn từ đủ 12 tháng trở lên”); Labour Code art.151(2) (Official Gazette 993+994 p.65) caps a foreign worker’s contract at the work-permit term, so the case hires on a 24-month fixed term, 2 June 2025 – 1 June 2027: 2,400,000 / 5,250,000; ${HI_CITE}: 450,000 / 900,000; UI: Law 74/2025 art.2(1) — none`,
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
				type: 'CONTRACT',
				salary: 30_000_000,
				from: '2025-06-02',
				to: '2027-06-01'
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
			'Voluntary pension: Decree 253/2026/ND-CP art.46(2)(a) (signed text pp.29–30, https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/253m-ndcp.signed.pdf), applied to tax year 2026 by art.69(1)(a) — supplementary pension, voluntary pension and life insurance deductible up to 3,000,000 a month in total, employer and employee payments together: 30,000,000 − 3,150,000 − 15,500,000 − 3,000,000 = 8,350,000 × 5% = 417,500',
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
			'Net 30,000,000 − 3,150,000 − 635,000 − 150,000 = 26,065,000; 60,000,000 − 5,046,000 − 4,390,800 − 234,000 = 50,329,200. The employer’s 2% union fund is an establishment line, not a payslip charge (Trade Union Law art.29(1)(b))',
			'Union fund (Trade Union Law 50/2024/QH15 art.29(1)(b), https://congbao.chinhphu.vn/van-ban/luat-so-50-2024-qh15-43589.htm): 2% of the salary fund compulsory SI is paid on — (30,000,000 + 46,800,000 capped) × 2% = 1,536,000'
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
		companyLines: { 'UNION_FEE.employer': 1_536_000 },
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
			'A Tết bonus of 20,000,000 under the employer’s published bonus regulation, paid with the March 2026 salary of 20,000,000: salary income of the month paid, outside the insurance salary.',
		citation: [
			'Labour Code 45/2019 art.104 (consolidation 18/VBHN-VPQH of 12 Feb 2026): a bonus is awarded on business results and work completion under the employer’s published regulation; the law sets no amount (the request carries it)',
			`${SI_CITE} art.31(1)(b) with Decree 158/2025/ND-CP art.7(1)(c): supplements varying with performance are outside the insurance salary → 1,600,000 / 3,500,000; ${HI_CITE}: 300,000 / 600,000; ${UI_CITE}: 200,000 / 200,000`,
			`${PIT_CITE}; Decree 253/2026/ND-CP art.8(2)(i): a bonus is salary income, taxed in the month paid: 40,000,000 − 2,100,000 − 15,500,000 = 22,400,000 → 10,000,000 × 5% + 12,400,000 × 10% = 500,000 + 1,240,000 = 1,740,000`,
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
			'February’s 20,000,000 wage, due 28 February 2026, for three workers: paid 20 days late on 20 March (interest at the payroll bank’s published one-month deposit rate, a case input: 4.5% a year), paid 14 days late on 14 March (under 15 days: no compensation), and paid 20 days late through force majeure (the same compensation).',
		citation: [
			'Labour Code 45/2019 art.97(4): a wage paid 15 or more days late earns at least interest on it at the one-month deposit rate of the payroll bank on the payment day; owner rule 2026-09-28 (VN-LC97-01): actual days over 365, rounded up: 20,000,000 × 4.5% × 20 ÷ 365 = 49,315.07 → 49,316',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}: on the March salary only`,
			`${PIT_CITE}: the compensation is taxable pay (owner rule, VN-LC97-01): 20,049,316 − 2,100,000 − 15,500,000 = 2,449,316 × 5% = 122,465.8 → 122,466`,
			'Net 20,049,316 − 2,100,000 − 122,466 = 17,826,850',
			'Labour Code art.97(4): the compensation is owed for a delay “từ 15 ngày trở lên”; 14 days earns none → gross 20,000,000, PIT (20,000,000 − 2,100,000 − 15,500,000) × 5% = 120,000, net 17,780,000',
			'Force majeure: art.97(4) states the compensation in the force-majeure sentence itself, and owner rule 2026-09-28 (VN-LC97-01) applies the same compensation with or without it → 49,316, the same payslip as the first worker'
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
			},
			...hire({
				ref: 'xuyen',
				name: 'Tăng Thị Xuyến',
				number: 'P-VN-152',
				born: '1990-09-20',
				gender: 'FEMALE',
				salary: 20_000_000,
				from: '2025-06-02'
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@xuyen_job',
					catalogue_id: '@law:adhoc_catalogue:LATE_WAGE_COMPENSATION',
					amount: 20_000_000,
					event_date: '2026-03-14',
					pay_period: '2026-03',
					reason: 'February wage paid late',
					late_wage: {
						due_on: '2026-02-28',
						paid_on: '2026-03-14',
						deposit_rate: 4.5,
						rate_reference: 'PROBE-BANK-NOTICE-2026-03-14',
						force_majeure: false
					}
				}
			},
			...hire({
				ref: 'xoan2',
				name: 'Hồ Văn Xoan',
				number: 'P-VN-153',
				born: '1988-09-21',
				salary: 20_000_000,
				from: '2025-06-02'
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@xoan2_job',
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
						force_majeure: true
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
			},
			{
				employment: 'xuyen_job',
				lines: {
					gross: 20_000_000,
					net: 17_780_000,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'UI.employee': 200_000,
					'UI.employer': 200_000,
					'PIT.employee': 120_000
				}
			},
			{
				employment: 'xoan2_job',
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
			'December 2025 under the law then in force: a citizen on 20,000,000 withheld on the seven-bracket table with the 11,000,000 personal deduction, a citizen on exactly the Decree 74/2024 Region I floor of 4,960,000, and a citizen on 20,000,000 paying a 2,000,000 voluntary-pension premium (deductible to 1,000,000 a month).',
		citation: [
			'PIT: PIT Law 04/2007/QH12 art.22 (Law 26/2012/QH13) monthly table 5% to 5m, 10% to 10m, 15% to 18m …; Resolution 954/2020/UBTVQH14 personal deduction 11,000,000: 20,000,000 − 2,100,000 − 11,000,000 = 6,900,000 → 250,000 + 190,000 = 440,000',
			'Minimum wage: Decree 74/2024/ND-CP Region I 4,960,000 a month to 31 December 2025',
			`${SI_CITE}: 1,600,000 / 3,500,000; 396,800 / 868,000`,
			`${HI_CITE}: 300,000 / 600,000; 74,400 / 148,800`,
			'UI: Law on Employment 38/2013/QH13 art.57: 1% + 1% → 200,000; 49,600',
			'Net 20,000,000 − 2,100,000 − 440,000 = 17,460,000; 4,960,000 − 520,800 = 4,439,200',
			'Voluntary pension, December 2025: Circular 111/2013/TT-BTC art.9(2)(b) as replaced by Circular 92/2015/TT-BTC art.15 (Official Gazette 911+912 pp.29–30) — voluntary pension premiums deducted as paid, at most 1,000,000 a month: 20,000,000 − 2,100,000 − 11,000,000 − 1,000,000 = 5,900,000 → 250,000 + 90,000 = 340,000; net 20,000,000 − 2,100,000 − 340,000 = 17,560,000'
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
			}),
			...hire({
				ref: 'dao',
				name: 'Đào Văn Đạo',
				number: 'P-VN-183',
				born: '1986-06-06',
				salary: 20_000_000,
				from: '2025-06-02',
				uiFrom: null,
				pit: {
					deduction_claims: [
						{
							period: '2025-12',
							category: 'VOLUNTARY_PENSION',
							amount: 2_000_000,
							source: 'EMPLOYEE',
							reference: 'VP-2025-12'
						}
					]
				}
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
			},
			{
				employment: 'dao_job',
				lines: {
					gross: 20_000_000,
					net: 17_560_000,
					employer_cost: 4_300_000,
					'SI.employee': 1_600_000,
					'SI.employer': 3_500_000,
					'HI.employee': 300_000,
					'HI.employer': 600_000,
					'UI.employee': 200_000,
					'UI.employer': 200_000,
					'PIT.employee': 340_000
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
	},
	{
		id: 'VN-SI-05-4',
		profile: 'VN',
		description:
			'The 1 July 2026 reference-level step, August 2026 (no holiday): a citizen on 60,000,000 insures SI and HI on the new ceiling of 20 × 2,530,000 = 50,600,000; UI stays on the whole salary, under 20 × 5,310,000.',
		citation: [
			'SI: Law 41/2024/QH15 art.31 (ceiling 20 × the reference level) with Decree 161/2026/ND-CP art.3(2) — reference level 2,530,000 from 1 July 2026 (signed text p.3, https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/161-ndcp.signed.pdf) → 50,600,000; art.33(1) 8% = 4,048,000; art.34(1) 3% + 14% with Decree 58/2020/ND-CP art.4(1) (as amended by Decree 158/2025/ND-CP art.43(2)) 0.5% → 17.5% = 8,855,000',
			`${HI_CITE}: 50,600,000 × 1.5% = 759,000; × 3% = 1,518,000`,
			`${UI_CITE}: 60,000,000 × 1% = 600,000 each side`,
			`${PIT_CITE}: 60,000,000 − 5,407,000 − 15,500,000 = 39,093,000 → 500,000 + 2,000,000 + 9,093,000 × 20% = 4,318,600`,
			'Net 60,000,000 − 5,407,000 − 4,318,600 = 50,274,400; employer cost 8,855,000 + 1,518,000 + 600,000 = 10,973,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'giap',
				name: 'Nông Văn Giáp',
				number: 'P-VN-014',
				born: '1978-08-08',
				salary: 60_000_000,
				from: '2025-06-02'
			})
		],
		period: '2026-08',
		expected: [
			{
				employment: 'giap_job',
				lines: {
					gross: 60_000_000,
					net: 50_274_400,
					employer_cost: 10_973_000,
					'SI.employee': 4_048_000,
					'SI.employer': 8_855_000,
					'HI.employee': 759_000,
					'HI.employer': 1_518_000,
					'UI.employee': 600_000,
					'UI.employer': 600_000,
					'PIT.employee': 4_318_600
				}
			}
		]
	},
	{
		id: 'VN-PIT-09-1',
		profile: 'VN',
		description:
			'December 2025 overtime under the old PIT law: a citizen on 18,400,000 (23 normal working days, no holiday → 100,000 an hour) works 3 hours beyond Tuesday 9 December’s normal day; only the premium above normal pay is exempt.',
		citation: [
			`${LC_CITE} art.55(1)(a): 18,400,000 ÷ (23 × 8) = 100,000 an hour; Labour Code 45/2019 art.98(1)(a) 150% on a normal day: 3 × 150,000 = 450,000`,
			'PIT: PIT Law 04/2007/QH12 art.4(11) exempts only the part of overtime pay above the normal-hours wage — 3 × 50,000 = 150,000 exempt, 300,000 taxable (the whole-OT exemption of Law 109/2025 art.4(8) starts with tax year 2026); art.22 seven-bracket table, Resolution 954/2020/UBTVQH14 personal deduction 11,000,000: 18,400,000 + 300,000 − 1,932,000 − 11,000,000 = 5,768,000 → 250,000 + 76,800 = 326,800',
			`${SI_CITE}, ${HI_CITE}: on the 18,400,000 contract salary — 1,472,000 / 3,220,000; 276,000 / 552,000`,
			'UI: Law on Employment 38/2013/QH13 art.57: 1% + 1% → 184,000 / 184,000',
			'Gross 18,400,000 + 450,000 = 18,850,000; net 18,850,000 − 1,932,000 − 326,800 = 16,591,200'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'hau',
				name: 'Lò Văn Hậu',
				number: 'P-VN-072',
				born: '1992-12-09',
				salary: 18_400_000,
				from: '2025-06-02',
				uiFrom: null
			}),
			worked(
				'hau_job',
				'2025-12-09',
				[
					['09:00', '13:00'],
					['14:00', '18:00'],
					['18:30', '21:30']
				],
				3
			)
		],
		period: '2025-12',
		expected: [
			{
				employment: 'hau_job',
				lines: {
					gross: 18_850_000,
					net: 16_591_200,
					employer_cost: 3_956_000,
					BASIC: 18_400_000,
					OVERTIME: 450_000,
					'SI.employee': 1_472_000,
					'SI.employer': 3_220_000,
					'HI.employee': 276_000,
					'HI.employer': 552_000,
					'UI.employee': 184_000,
					'UI.employer': 184_000,
					'PIT.employee': 326_800
				}
			}
		]
	}
);

// ─── Closure round 2026-09-30: branches the cases above do not reach ────────────────────────────

const MW293_CITE =
	'Minimum wage: Decree 293/2025/ND-CP art.3 from 1 January 2026 — Region I 5,310,000 / 25,500 an hour, II 4,730,000 / 22,700, III 4,140,000 / 20,000, IV 3,700,000 / 17,800 (issuer record https://vanban.chinhphu.vn/?docid=215832&pageid=27160; signed text https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/11/293-cp.signed.pdf)';
const MW74_CITE =
	'Minimum wage: Decree 74/2024/ND-CP art.3, 1 July 2024 – 31 December 2025 — Region I 4,960,000 / 23,800 an hour, II 4,410,000 / 21,200, III 3,860,000 / 18,600, IV 3,450,000 / 16,600 (issuer record https://vanban.chinhphu.vn/?pageid=27160&docid=210536; signed text https://datafiles.chinhphu.vn/cpp/files/vbpq/2024/7/74-cp.signed.pdf)';
const PIT25_CITE =
	'PIT December 2025: PIT Law 04/2007/QH12 art.22 (Law 26/2012/QH13) seven brackets 5/10/15/20/25/30/35% at 5/10/18/32/52/80m; Resolution 954/2020/UBTVQH14 personal deduction 11,000,000';
const UI38_CITE =
	'UI December 2025: Law on Employment 38/2013/QH13 art.57 1% + 1%, art.58 ceiling 20 × the regional monthly minimum wage (signed text https://datafiles.chinhphu.vn/cpp/files/vbpq/2013/12/38_vieclam.pdf)';

type Slip = { readonly [key: string]: number };
/** A whole-month citizen payslip of the named figures. */
const slip = (
	gross: number,
	net: number,
	employer: number,
	[si, sie]: readonly [number, number],
	[hi, hie]: readonly [number, number],
	ui: readonly [number, number] | null,
	pit = 0
): Slip => ({
	gross,
	net,
	employer_cost: employer,
	'SI.employee': si,
	'SI.employer': sie,
	'HI.employee': hi,
	'HI.employer': hie,
	...(ui == null ? {} : { 'UI.employee': ui[0], 'UI.employer': ui[1] }),
	...(pit === 0 ? {} : { 'PIT.employee': pit })
});

/**
 * One region's monthly floor and its UI ceiling: a citizen on exactly the floor and one on 120,000,000, over every
 * SI/HI and UI ceiling. Figures computed by hand in the citation.
 */
function floorCase(
	id: string,
	period: '2025-12' | '2026-03',
	region: 'I' | 'II' | 'III' | 'IV',
	floor: number,
	atFloor: Slip,
	high: Slip,
	cites: readonly string[],
	number: number
): ProbeCase {
	const december = period === '2025-12';
	return {
		id,
		profile: 'VN',
		description: `Region ${region}, ${period}: a full-time citizen contracted at exactly the region's monthly floor of ${floor.toLocaleString('en')} settles; a citizen on 120,000,000 contributes UI on the region's ceiling of 20 × ${floor.toLocaleString('en')}.`,
		citation: [
			december ? MW74_CITE : MW293_CITE,
			`${SI_CITE}: ${floor} × 8% / 17.5%; 120,000,000 on the 46,800,000 ceiling → 3,744,000 / 8,190,000`,
			`${HI_CITE}: ${floor} × 1.5% / 3%; 46,800,000 → 702,000 / 1,404,000`,
			december ? UI38_CITE : `${UI_CITE} (the region's own minimum)`,
			december ? PIT25_CITE : PIT_CITE,
			...cites
		],
		company: company(region),
		inputs: [
			...WEEK,
			...hire({
				ref: 'floor',
				name: 'Nguyễn Văn Sàn',
				number: `P-VN-${number}`,
				born: '1996-02-02',
				salary: floor,
				from: '2025-06-02',
				region,
				...(december ? { uiFrom: null } : {})
			}),
			...hire({
				ref: 'high',
				name: 'Trần Văn Trần',
				number: `P-VN-${number + 1}`,
				born: '1976-03-03',
				salary: 120_000_000,
				from: '2025-06-02',
				region,
				...(december ? { uiFrom: null } : {})
			})
		],
		period,
		expected: [
			{ employment: 'floor_job', lines: atFloor },
			{ employment: 'high_job', lines: high }
		]
	};
}

/** A run refused because one contract is under the floor (Decree 293/2025 art.4 / Decree 74/2024 art.4). */
function underFloor(
	id: string,
	period: string,
	description: string,
	cites: readonly string[],
	salary: number,
	payFrequency: string,
	number: string,
	unit: string
): ProbeCase {
	return {
		id,
		profile: 'VN',
		description,
		citation: cites,
		company: company('I'),
		inputs: [
			...WEEK,
			...hire({
				ref: 'under',
				name: 'Phạm Thị Dưới',
				number,
				born: '1997-07-07',
				gender: 'FEMALE',
				salary,
				payFrequency,
				from: '2025-06-02',
				...(period === '2025-12' ? { uiFrom: null } : {})
			})
		],
		period,
		refused: `MINIMUM_WAGE_BELOW: ${number} is contracted at ${salary} ${unit}`,
		expected: []
	};
}

const HIGH_120M = (ui: number, pit: number, net: number, employer: number) =>
	slip(120_000_000, net, employer, [3_744_000, 8_190_000], [702_000, 1_404_000], [ui, ui], pit);

register(
	floorCase(
		'VN-MW293-02-1',
		'2026-03',
		'I',
		5_310_000,
		slip(5_310_000, 4_752_450, 1_141_650, [424_800, 929_250], [79_650, 159_300], [53_100, 53_100]),
		HIGH_120M(1_062_000, 20_197_600, 94_294_400, 10_656_000),
		[
			'5,310,000: SI 424,800 / 929,250, HI 79,650 / 159,300, UI 53,100 each; PIT (5,310,000 − 557,550 − 15,500,000) < 0 → 0; net 4,752,450',
			'120,000,000: UI 106,200,000 × 1% = 1,062,000; PIT 120,000,000 − 5,508,000 − 15,500,000 = 98,992,000 → 500,000 + 2,000,000 + 6,000,000 + 38,992,000 × 30% = 20,197,600; net 94,294,400'
		],
		201
	),
	floorCase(
		'VN-MW293-02-2',
		'2026-03',
		'II',
		4_730_000,
		slip(4_730_000, 4_233_350, 1_016_950, [378_400, 827_750], [70_950, 141_900], [47_300, 47_300]),
		HIGH_120M(946_000, 20_232_400, 94_375_600, 10_540_000),
		[
			'4,730,000: SI 378,400 / 827,750, HI 70,950 / 141,900, UI 47,300 each; PIT 0; net 4,233,350',
			'120,000,000: UI 94,600,000 × 1% = 946,000; PIT 120,000,000 − 5,392,000 − 15,500,000 = 99,108,000 → 8,500,000 + 39,108,000 × 30% = 20,232,400; net 94,375,600'
		],
		203
	),
	floorCase(
		'VN-MW293-02-3',
		'2026-03',
		'III',
		4_140_000,
		slip(4_140_000, 3_705_300, 890_100, [331_200, 724_500], [62_100, 124_200], [41_400, 41_400]),
		HIGH_120M(828_000, 20_267_800, 94_458_200, 10_422_000),
		[
			'4,140,000: SI 331,200 / 724,500, HI 62,100 / 124,200, UI 41,400 each; PIT 0; net 3,705,300',
			'120,000,000: UI 82,800,000 × 1% = 828,000; PIT 120,000,000 − 5,274,000 − 15,500,000 = 99,226,000 → 8,500,000 + 39,226,000 × 30% = 20,267,800; net 94,458,200'
		],
		205
	),
	floorCase(
		'VN-MW293-02-4',
		'2026-03',
		'IV',
		3_700_000,
		slip(3_700_000, 3_311_500, 795_500, [296_000, 647_500], [55_500, 111_000], [37_000, 37_000]),
		HIGH_120M(740_000, 20_294_200, 94_519_800, 10_334_000),
		[
			'3,700,000: SI 296,000 / 647,500, HI 55,500 / 111,000, UI 37,000 each; PIT 0; net 3,311,500',
			'120,000,000: UI 74,000,000 × 1% = 740,000; PIT 120,000,000 − 5,186,000 − 15,500,000 = 99,314,000 → 8,500,000 + 39,314,000 × 30% = 20,294,200; net 94,519,800'
		],
		207
	),
	floorCase(
		'VN-MW74-01-1',
		'2025-12',
		'I',
		4_960_000,
		slip(4_960_000, 4_439_200, 1_066_400, [396_800, 868_000], [74_400, 148_800], [49_600, 49_600]),
		HIGH_120M(992_000, 26_396_700, 88_165_300, 10_586_000),
		[
			'4,960,000: SI 396,800 / 868,000, HI 74,400 / 148,800, UI 49,600 each; PIT 0; net 4,439,200',
			'120,000,000: UI 99,200,000 × 1% = 992,000; PIT 120,000,000 − 5,438,000 − 11,000,000 = 103,562,000 → 18,150,000 (to 80m) + 23,562,000 × 35% = 26,396,700; net 88,165,300'
		],
		221
	),
	floorCase(
		'VN-MW74-01-2',
		'2025-12',
		'II',
		4_410_000,
		slip(4_410_000, 3_946_950, 948_150, [352_800, 771_750], [66_150, 132_300], [44_100, 44_100]),
		HIGH_120M(882_000, 26_435_200, 88_236_800, 10_476_000),
		[
			'4,410,000: SI 352,800 / 771,750, HI 66,150 / 132,300, UI 44,100 each; PIT 0; net 3,946,950',
			'120,000,000: UI 88,200,000 × 1% = 882,000; PIT 120,000,000 − 5,328,000 − 11,000,000 = 103,672,000 → 18,150,000 + 23,672,000 × 35% = 26,435,200; net 88,236,800'
		],
		223
	),
	floorCase(
		'VN-MW74-01-3',
		'2025-12',
		'III',
		3_860_000,
		slip(3_860_000, 3_454_700, 829_900, [308_800, 675_500], [57_900, 115_800], [38_600, 38_600]),
		HIGH_120M(772_000, 26_473_700, 88_308_300, 10_366_000),
		[
			'3,860,000: SI 308,800 / 675,500, HI 57,900 / 115,800, UI 38,600 each; PIT 0; net 3,454,700',
			'120,000,000: UI 77,200,000 × 1% = 772,000; PIT 120,000,000 − 5,218,000 − 11,000,000 = 103,782,000 → 18,150,000 + 23,782,000 × 35% = 26,473,700; net 88,308,300'
		],
		225
	),
	floorCase(
		'VN-MW74-01-4',
		'2025-12',
		'IV',
		3_450_000,
		slip(3_450_000, 3_087_750, 741_750, [276_000, 603_750], [51_750, 103_500], [34_500, 34_500]),
		HIGH_120M(690_000, 26_502_400, 88_361_600, 10_284_000),
		[
			'3,450,000: SI 276,000 / 603,750, HI 51,750 / 103,500, UI 34,500 each; PIT 0; net 3,087,750',
			'120,000,000: UI 69,000,000 × 1% = 690,000; PIT 120,000,000 − 5,136,000 − 11,000,000 = 103,864,000 → 18,150,000 + 23,864,000 × 35% = 26,502,400; net 88,361,600'
		],
		227
	),
	underFloor(
		'VN-MW293-04-2',
		'2026-03',
		'A Region I full-time monthly contract one đồng under the 2026 floor (5,309,999), March 2026: the run is refused, not paid.',
		[
			MW293_CITE,
			'Decree 293/2025/ND-CP art.4: the employer pays a monthly-paid worker who works the normal time at least the monthly minimum; Labour Code 45/2019 art.90(2): the wage may not be below the minimum wage'
		],
		5_309_999,
		'MONTHLY',
		'P-VN-212',
		'a month'
	),
	underFloor(
		'VN-MW293-04-3',
		'2026-03',
		'A Region I hourly contract at 25,000, under the 2026 hourly floor of 25,500, March 2026: the run is refused.',
		[MW293_CITE, 'Decree 293/2025/ND-CP art.4(2): an hourly-paid worker is held to the hourly minimum wage'],
		25_000,
		'HOURLY',
		'P-VN-213',
		'an hour'
	),
	underFloor(
		'VN-MW74-01-5',
		'2025-12',
		'A Region I hourly contract at 23,700, under the December 2025 hourly floor of 23,800: the run is refused.',
		[MW74_CITE, 'Decree 74/2024/ND-CP art.4(2): an hourly-paid worker is held to the hourly minimum wage'],
		23_700,
		'HOURLY',
		'P-VN-214',
		'an hour'
	),
	underFloor(
		'VN-MW74-01-6',
		'2025-12',
		'A Region I full-time monthly contract at 4,959,999, one đồng under the December 2025 floor: the run is refused.',
		[MW74_CITE, 'Decree 74/2024/ND-CP art.4(1): a monthly-paid worker is paid at least the monthly minimum'],
		4_959_999,
		'MONTHLY',
		'P-VN-215',
		'a month'
	),
	{
		id: 'VN-SI-05-5',
		profile: 'VN',
		description:
			'An employer approved for the reduced 0.3% occupational-accident rate, March 2026: citizens on 20,000,000 and 60,000,000 (over the SI ceiling); the employer SI share is 17.3%.',
		citation: [
			'Decree 58/2020/ND-CP art.4(1) as amended by Decree 158/2025/ND-CP art.43(2): the occupational accident and disease fund rate is 0.5%, or 0.3% for an employer approved under art.5 (https://vanban.chinhphu.vn/default.aspx?docid=200108&pageid=27160); with Law 41/2024/QH15 art.34(1) 3% + 14% → 17.3%',
			`${SI_CITE}: 20,000,000 × 17.3% = 3,460,000; 46,800,000 × 17.3% = 8,096,400; employee 8% unchanged`,
			`${HI_CITE}; ${UI_CITE}`,
			`${PIT_CITE}: 20,000,000 → 120,000; 60,000,000 − 5,046,000 − 15,500,000 = 39,454,000 → 4,390,800`,
			'Net 17,780,000 and 50,563,200; employer cost 3,460,000 + 600,000 + 200,000 = 4,260,000 and 8,096,400 + 1,404,000 + 600,000 = 10,100,400'
		],
		company: { ...company(), facts: { occupational_accident_reduced: true } },
		inputs: [
			...WEEK,
			...hire({ ref: 'kha', name: 'Kha Văn Ích', number: 'P-VN-231', born: '1990-01-01', salary: 20_000_000, from: '2025-06-02' }),
			...hire({ ref: 'kim', name: 'Kim Văn Lợi', number: 'P-VN-232', born: '1981-01-01', salary: 60_000_000, from: '2025-06-02' })
		],
		period: '2026-03',
		expected: [
			{
				employment: 'kha_job',
				lines: slip(20_000_000, 17_780_000, 4_260_000, [1_600_000, 3_460_000], [300_000, 600_000], [200_000, 200_000], 120_000)
			},
			{
				employment: 'kim_job',
				lines: slip(60_000_000, 50_563_200, 10_100_400, [3_744_000, 8_096_400], [702_000, 1_404_000], [600_000, 600_000], 4_390_800)
			}
		]
	},
	...(
		[
			['VN-SI-05-6', '2026-06', 'June 2026, the last month on the 2,340,000 reference level: SI and HI stop at 46,800,000', slip(60_000_000, 50_563_200, 10_194_000, [3_744_000, 8_190_000], [702_000, 1_404_000], [600_000, 600_000], 4_390_800), 'SI 3,744,000 / 8,190,000, HI 702,000 / 1,404,000, UI 600,000 each; PIT 60,000,000 − 5,046,000 − 15,500,000 = 39,454,000 → 500,000 + 2,000,000 + 9,454,000 × 20% = 4,390,800; net 50,563,200'],
			['VN-SI-05-7', '2026-07', 'July 2026, the first month on the 2,530,000 reference level (Decree 161/2026/ND-CP): SI and HI stop at 50,600,000', slip(60_000_000, 50_274_400, 10_973_000, [4_048_000, 8_855_000], [759_000, 1_518_000], [600_000, 600_000], 4_318_600), 'SI 4,048,000 / 8,855,000, HI 759,000 / 1,518,000, UI 600,000 each; PIT 60,000,000 − 5,407,000 − 15,500,000 = 39,093,000 → 4,318,600; net 50,274,400']
		] as const
	).map(
		([id, period, what, lines, figures]): ProbeCase => ({
			id,
			profile: 'VN',
			description: `The 30 June / 1 July 2026 seam, ${what}; the resident 2026 PIT table applies on both sides (Law 109/2025/QH15 art.29(2)).`,
			citation: [
				'SI: Law 41/2024/QH15 art.31 ceiling 20 × the reference level; Decree 73/2024/ND-CP base salary 2,340,000 to 30 June 2026; Decree 161/2026/ND-CP art.3(2) 2,530,000 from 1 July 2026 (signed text p.3, https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/161-ndcp.signed.pdf)',
				`${HI_CITE}; ${UI_CITE}; ${PIT_CITE}`,
				`60,000,000: ${figures}`
			],
			company: company(),
			inputs: [
				...WEEK,
				...hire({ ref: 'seam', name: 'Lê Văn Mốc', number: `P-VN-24${period.slice(-1)}`, born: '1979-09-09', salary: 60_000_000, from: '2025-06-02' })
			],
			period,
			expected: [{ employment: 'seam_job', lines }]
		})
	),
	{
		id: 'VN-LC169-02-1',
		profile: 'VN',
		description:
			'Foreign work-permit holders (tax residents) signed on 24-month fixed-term contracts on Monday 5 January 2026 at 30,000,000, March 2026: a man born 6 July 1964 (Annex I age 61y3m, reached October 2025) and a woman born 6 January 1969 (56y8m, reached September 2025) are past retirement age at signing and outside SI and HI, owed the employer’s rate as wages; a man born 6 October 1964 (61y6m, reached April 2026) is insured.',
		citation: [
			'Law 41/2024/QH15 art.2(2)(b) (Official Gazette 987+988 pp.4–5): a foreign employee who has reached the retirement age of Labour Code art.169(2) is not a compulsory participant; Decree 135/2020/ND-CP art.4 with Annex I (signed text https://datafiles.chinhphu.vn/cpp/files/vbpq/2020/11/135.signed.pdf pp.1–3, read 2026-09-30): the retirement age is fixed by month and year of birth — men born 1–9/1964 retire at 61y3m, 10/1964–6/1965 at 61y6m; women born 9/1968–4/1969 at 56y8m',
			'Ages at signing (5 January 2026): 61y5m (≥ 61y3m), 56y11m (≥ 56y8m), 61y2m (< 61y6m)',
			'Labour Code 45/2019 art.168(3): outside compulsory SI/HI the employer pays the worker its own contribution rate with the wage — 30,000,000 × (17.5% + 3%) = 6,150,000; no UI part (Law 74/2025 art.2(1): citizens only)',
			`${PIT_CITE}: 36,150,000 − 15,500,000 = 20,650,000 → 500,000 + 1,065,000 = 1,565,000; net 34,585,000`,
			`Insured man: ${SI_CITE} 2,400,000 / 5,250,000; ${HI_CITE} 450,000 / 900,000; PIT 30,000,000 − 2,850,000 − 15,500,000 = 11,650,000 → 665,000; net 26,485,000`
		],
		company: company(),
		inputs: [
			...WEEK,
			...(
				[
					['ken', 'Sato Ken', 'P-VN-251', '1964-07-06', 'MALE'],
					['yumi', 'Sato Yumi', 'P-VN-252', '1969-01-06', 'FEMALE'],
					['taro', 'Suzuki Taro', 'P-VN-253', '1964-10-06', 'MALE']
				] as const
			).flatMap(([ref, name, number, born, gender]) =>
				hire({ ref, name, number, born, gender, foreigner: true, type: 'CONTRACT', salary: 30_000_000, from: '2026-01-05', to: '2028-01-04' })
			)
		],
		period: '2026-03',
		expected: [
			...['ken_job', 'yumi_job'].map((employment) => ({
				employment,
				lines: { gross: 36_150_000, net: 34_585_000, employer_cost: 0, INSURANCE_EQUIVALENT: 6_150_000, 'PIT.employee': 1_565_000 }
			})),
			{
				employment: 'taro_job',
				lines: slip(30_000_000, 26_485_000, 6_150_000, [2_400_000, 5_250_000], [450_000, 900_000], null, 665_000)
			}
		]
	},
	{
		id: 'VN-LC168-01-2',
		profile: 'VN',
		description:
			'Two more excluded categories, Region IV, March 2026: a citizen part-timer on 2,000,000 (under the 2,340,000 lowest SI salary) and a citizen vocational trainee on 5,000,000; each is outside SI, HI and UI and owed the employer’s rates with the wage.',
		citation: [
			'Law 41/2024/QH15 art.2(1)(l): a part-timer is a compulsory participant only from the lowest contribution salary (the reference level 2,340,000); Labour Code art.61 trainee outside compulsory insurance (seed exclusion, golden “a part-timer under the floor and a trainee are outside compulsory insurance”)',
			'Labour Code 45/2019 art.168(3): the employer pays the amount of its own SI 17.5%, HI 3% and UI 1% contributions with the wage, on the salary it would have insured, floored at the reference level: part-timer 2,340,000 × 20.5% + 2,340,000 × 1% = 479,700 + 23,400 = 503,100; trainee 5,000,000 × 21.5% = 1,075,000',
			`${PIT_CITE}: 2,503,100 and 6,075,000 are below 15,500,000 → 0`
		],
		company: company('IV'),
		inputs: [
			...WEEK,
			{
				collection: 'shift_definitions',
				ref: 'half',
				values: { company_id: '@company', code: 'HALF', name: 'Half day (0900 to 1300)', variant: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 }, effective_range: { from: '2007-12-31', to: null } }
			},
			{
				collection: 'shift_patterns',
				ref: 'halfweek',
				values: {
					company_id: '@company',
					code: 'HALFx5-OFF-REST',
					name: '5 x HALF, OFF, REST',
					pattern: { days: ['@half', '@half', '@half', '@half', '@half', '@off', '@rest'].map((roster_code_id) => ({ roster_code_id })) },
					effective_range: { from: '2007-12-31', to: null }
				}
			},
			...hire({ ref: 'nhu', name: 'Lê Thị Như', number: 'P-VN-261', born: '2002-02-02', gender: 'FEMALE', type: 'PART_TIME', salary: 2_000_000, from: '2025-06-02', region: 'IV', pattern: '@halfweek', terms: { ordinary_hours_per_week: 20 } }),
			...hire({ ref: 'toan', name: 'Hồ Văn Toàn', number: 'P-VN-262', born: '2005-05-05', type: 'INTERN', salary: 5_000_000, from: '2025-06-02', region: 'IV' })
		],
		period: '2026-03',
		expected: [
			{ employment: 'nhu_job', lines: { gross: 2_503_100, net: 2_503_100, employer_cost: 0, INSURANCE_EQUIVALENT: 503_100 } },
			{ employment: 'toan_job', lines: { gross: 6_075_000, net: 6_075_000, employer_cost: 0, INSURANCE_EQUIVALENT: 1_075_000 } }
		]
	},
	{
		id: 'VN-UNION-01-2',
		profile: 'VN',
		description:
			'Union dues where SI is not charged, March 2026: a trainee member outside compulsory SI pays the set sum; a member on 22,000,000 with 15 of 22 working days on agreed unpaid leave has no SI month but still owes dues on the insurance salary.',
		citation: [
			'VGCL Decision 61/QĐ-TLĐ art.1 (https://pbgdpl.cantho.gov.vn/quyet-dinh-61qd-tld-ve-dieu-chinh-giam-muc-dong-doan-phi-cong-doan): a member outside compulsory SI pays a set sum of at least 0.5% of the base salary — owner rule 2026-09-28 (VN-UNION-01) the minimum: 2,340,000 × 0.5% = 11,700; dues stop only for a month wholly unpaid, so 15 unpaid days owe 0.5% of the 22,000,000 insurance salary = 110,000',
			'Labour Code 45/2019 art.115(3): other unpaid leave by agreement; 22,000,000 × 7 ÷ 22 = 7,000,000 (owner rule VN-PRORATE-01)',
			`${SI_CITE}; arts.33(5), 34(3): 15 wholly unpaid working days → no SI, and so no HI (${HI_CITE}) and no UI (Law 74/2025 art.33(4))`,
			'Trainee: Labour Code art.168(3) 5,000,000 × 21.5% = 1,075,000 (VN-LC168-01-2); PIT 0 on both',
			'Net 6,075,000 − 11,700 = 6,063,300 and 7,000,000 − 110,000 = 6,890,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'quan', name: 'Vi Văn Quân', number: 'P-VN-271', born: '2005-06-06', type: 'INTERN', salary: 5_000_000, from: '2025-06-02', member: true }),
			...hire({ ref: 'rin', name: 'Đồng Thị Rin', number: 'P-VN-272', born: '1990-06-06', gender: 'FEMALE', salary: 22_000_000, from: '2025-06-02', member: true }),
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@rin',
					employment_id: '@rin_job',
					statutory_contribution_id: '@law:statutory_contributions:SI',
					effective_range: { from: '2026-03-01', to: '2026-03-31' },
					status: { kind: 'REGISTERED', reference_number: 'PROBE-SI-P-VN-272', elections: { continue_si_unpaid: false } }
				}
			},
			leave('rin_job', 'UNPAID_LEAVE', { reference: 'UPL-15', from_date: '2026-03-02', to_date: '2026-03-20', reason: 'Agreed unpaid leave (Labour Code art.115(3))' })
		],
		period: '2026-03',
		expected: [
			{ employment: 'quan_job', lines: { gross: 6_075_000, net: 6_063_300, INSURANCE_EQUIVALENT: 1_075_000, 'UNION_DUES.employee': 11_700 } },
			{ employment: 'rin_job', lines: { gross: 7_000_000, net: 6_890_000, employer_cost: 0, 'UNION_DUES.employee': 110_000 } }
		]
	},
	{
		id: 'VN-LC115-02-2',
		profile: 'VN',
		description:
			'The remaining personal-leave branches, March 2026, 22,000,000 each: the death of the worker’s own parent (3 paid days), a sibling’s death (1 unpaid day) and 2 days of other unpaid leave by agreement.',
		citation: [
			'Labour Code 45/2019 art.115(1)(c): 3 paid days on the death of a parent; art.115(2): 1 unpaid day on the death of a sibling; art.115(3): other unpaid leave by agreement (Official Gazette 993+994 p.50, https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf)',
			'Unpaid days at the working-day rate (owner rule VN-PRORATE-01): 22,000,000 × 21 ÷ 22 = 21,000,000; × 20 ÷ 22 = 20,000,000',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}: under 14 unpaid days → 1,760,000 / 3,850,000; 330,000 / 660,000; 220,000 / 220,000`,
			`${PIT_CITE}: (22,000,000 − 2,310,000 − 15,500,000) × 5% = 209,500; (21,000,000 − …) = 159,500; (20,000,000 − …) = 109,500`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'sang', name: 'Tống Văn Sang', number: 'P-VN-281', born: '1988-08-08', salary: 22_000_000, from: '2025-06-02' }),
			...hire({ ref: 'tien', name: 'Ứng Thị Tiên', number: 'P-VN-282', born: '1989-09-09', gender: 'FEMALE', salary: 22_000_000, from: '2025-06-02' }),
			...hire({ ref: 'uyen', name: 'Viên Thị Uyên', number: 'P-VN-283', born: '1995-05-05', gender: 'FEMALE', salary: 22_000_000, from: '2025-06-02' }),
			leave('sang_job', 'BEREAVEMENT_LEAVE', { reference: 'BRV-OWN', from_date: '2026-03-10', to_date: '2026-03-12', event_kind: 'DEATH', event_relationship: 'PARENT', event_date: '2026-03-09', reason: 'Death of a parent' }),
			leave('tien_job', 'BEREAVEMENT_LEAVE_UNPAID', { reference: 'BRV-SIB', from_date: '2026-03-17', to_date: '2026-03-17', event_kind: 'DEATH', event_relationship: 'SIBLING', event_date: '2026-03-16', reason: 'Death of a sibling' }),
			leave('uyen_job', 'UNPAID_LEAVE', { reference: 'UPL-2', from_date: '2026-03-23', to_date: '2026-03-24', reason: 'Agreed unpaid leave (Labour Code art.115(3))' })
		],
		period: '2026-03',
		expected: [
			{ employment: 'sang_job', lines: slip(22_000_000, 19_480_500, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 209_500) },
			{ employment: 'tien_job', lines: slip(21_000_000, 18_530_500, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 159_500) },
			{ employment: 'uyen_job', lines: slip(20_000_000, 17_580_500, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 109_500) }
		]
	},
	{
		id: 'VN-LC99-01-2',
		profile: 'VN',
		description:
			'Work stoppages by cause, March 2026 (22 working days), 22,000,000 each (1,000,000 a day), Region I: the employer’s fault for 3 days (full wage), co-workers stopped by another’s fault for 5 days at an agreed 70%, and a 16-working-day utility failure at an agreed 30% (floored at the minimum wage for its first 14 working days).',
		citation: [
			'Labour Code 45/2019 art.99 (Official Gazette 993+994, https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf): (1) the employer’s fault → the full contract wage; (2) co-workers who must stop → the agreed wage, not below the minimum wage; (3) a utility failure not the employer’s fault → the agreed wage, not below the minimum wage for the first 14 working days',
			`${MW293_CITE}: the day’s floor on the wage’s own divisor 5,310,000 ÷ 22 = 241,363.64`,
			'Co-workers: 5 × 1,000,000 × 30% = 1,500,000 off → 20,500,000',
			'Utility: days 1–14 at the floor, 14 × (1,000,000 − 241,363.64) = 10,620,909.09, days 15–16 at 30%, 2 × 700,000 = 1,400,000 → 12,020,909 off (whole đồng) → 9,979,091',
			`${SI_CITE}: no day is wholly unpaid, so none counts toward the 14-day rule (owner rule VN-SI-01) — SI, HI and UI on the whole contract salary: 1,760,000 / 3,850,000; 330,000 / 660,000; 220,000 / 220,000`,
			`${PIT_CITE}: 22,000,000 → 209,500; 20,500,000 − 2,310,000 − 15,500,000 = 2,690,000 → 134,500; 9,979,091 → 0`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'vu', name: 'Vũ Văn Vũ', number: 'P-VN-291', born: '1987-07-07', salary: 22_000_000, from: '2025-06-02' }),
			...hire({ ref: 'xa', name: 'Xa Thị Xa', number: 'P-VN-292', born: '1988-08-08', gender: 'FEMALE', salary: 22_000_000, from: '2025-06-02' }),
			...hire({ ref: 'y', name: 'Y Văn Ý', number: 'P-VN-293', born: '1989-09-09', salary: 22_000_000, from: '2025-06-02' }),
			leave('vu_job', 'STOPPAGE_EMPLOYER_FAULT', { reference: 'STOP-EF', from_date: '2026-03-02', to_date: '2026-03-04', reason: 'Stoppage through the employer’s fault (Labour Code art.99(1))' }),
			leave('xa_job', 'STOPPAGE_COWORKER', { reference: 'STOP-CW', from_date: '2026-03-02', to_date: '2026-03-06', agreed_pay_fraction: 0.7, reason: 'Stopped by a co-worker’s fault (Labour Code art.99(2))' }),
			leave('y_job', 'STOPPAGE_OBJECTIVE', { reference: 'STOP-OBJ', from_date: '2026-03-02', to_date: '2026-03-23', event_date: '2026-03-02', agreed_pay_fraction: 0.3, reason: 'Power failure not the employer’s fault (Labour Code art.99(3))' })
		],
		period: '2026-03',
		expected: [
			{ employment: 'vu_job', lines: slip(22_000_000, 19_480_500, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 209_500) },
			{ employment: 'xa_job', lines: slip(20_500_000, 18_055_500, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 134_500) },
			{ employment: 'y_job', lines: slip(9_979_091, 7_669_091, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000]) }
		]
	},
	{
		id: 'VN-LC46-02-2',
		profile: 'VN',
		description:
			'Three more leavers on Friday 17 April 2026, each hired 1 January 2008 on 22,000,000: a resigner who qualifies for a pension (no severance), a worker dismissed after five consecutive working days’ unjustified absence (no severance), and a redundancy with UI only from 1 January 2011 (36 uncovered months → three months’ job-loss allowance). Final salary, untaken leave and 10% withholding as VN-LC46-02-1.',
		citation: [
			'Labour Code 45/2019 art.46(1) (Official Gazette 993+994): no severance where the worker qualifies for a pension or is dismissed under art.36(1)(e) — five consecutive working days absent without good reason',
			`Job-loss: Labour Code art.47(1) one month’s wage per year of service, at least two; ${LC_CITE} art.8(2)–(3): service 1 January 2008 – 17 April 2026 less UI-insured time from 1 January 2011 = 36 months = 3 years → 3 × 22,000,000 = 66,000,000`,
			`Final salary 22,000,000 × 13 ÷ 22 = 13,000,000; 5 untaken annual-leave days at March’s 1,000,000 a day = 5,000,000 (${LC_CITE} arts.66–67); ${SI_CITE}, ${HI_CITE}, ${UI_CITE}: 1,760,000 / 3,850,000, 330,000 / 660,000, 220,000 / 220,000`,
			'PIT: 13,000,000 × 10% = 1,300,000 on the salary paid after the contract ended (owner rule VN-PIT-06); leave pay exempt (Law 109/2025 art.4(8)); job-loss allowance outside salary income (Decree 253/2026 art.8(3)(h))',
			'No-severance leavers: gross 18,000,000, net 18,000,000 − 2,310,000 − 1,300,000 = 14,390,000. Redundancy: gross 84,000,000, net 80,390,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			holiday('2026-04-26', 'Giỗ Tổ Hùng Vương'),
			holiday('2026-04-30', 'Ngày Chiến thắng'),
			...(
				[
					{ ref: 'khoa', name: 'Khổng Văn Khoa', uiFrom: '2009-01-01', reason: 'RESIGNATION', facts: { pension_eligible: true }, code: 'SEVERANCE_ALLOWANCE' },
					{ ref: 'lam', name: 'Lâm Thị Lam', uiFrom: '2009-01-01', reason: 'UNILATERAL', facts: { pension_eligible: false, absent_five_days: true }, code: 'SEVERANCE_ALLOWANCE' },
					{ ref: 'mai', name: 'Mai Văn Mãi', uiFrom: '2011-01-01', reason: 'REDUNDANCY', facts: {}, code: 'JOB_LOSS_ALLOWANCE' }
				] as const
			).flatMap(({ ref, name, uiFrom, reason, facts, code }, index) => [
				...hire({
					ref,
					name,
					number: `P-VN-30${index + 1}`,
					born: '1980-09-09',
					salary: 22_000_000,
					from: '2008-01-01',
					to: '2026-04-17',
					uiFrom,
					exitReason: reason,
					exitFacts: facts,
					pit: { unit_assessments: [{ period: '2026-04', gross: 13_000_000, units: 1, reference: 'FINAL-WAGE', paid_on: '2026-04-30' }] }
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
						catalogue_id: `@law:adhoc_catalogue:${code}`,
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
			...['khoa_job', 'lam_job'].map((employment) => ({
				employment,
				lines: slip(18_000_000, 14_390_000, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 1_300_000)
			})),
			{
				employment: 'mai_job',
				lines: { ...slip(84_000_000, 80_390_000, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 1_300_000), JOB_LOSS_ALLOWANCE: 66_000_000 }
			}
		]
	},
	{
		id: 'VN-LC98-03-1',
		profile: 'VN',
		description:
			'Night branches, January 2026, 17,600,000 (100,000 an hour, the 1 January holiday among 22 working days): a normal shift 14:00–23:00 with no overtime (one plain night hour), one overtime hour 22:00–23:00 after a normal day with no day-time overtime before it, 5 overtime hours 18:00–23:00 on the Sunday rest day and 5 on the 1 January holiday (one night hour each).',
		citation: [
			`${LC_CITE} art.55(1)(a): the hour is 100,000 (as VN-LC98-02-1)`,
			'Labour Code 45/2019 art.98(2): night work at least +30% → 1 × 30,000',
			`Labour Code art.98(3), ${LC_CITE} art.57(1): night overtime = day-type rate + 30% + 20% of the day-time hour of that day type — a normal day with no day-time overtime before it: 150% + 30% + 20% × 100% (b2) → OVERTIME 150,000, NIGHT 50,000; the weekly rest day: 200% + 30% + 20% × 200% → OVERTIME 5 × 200,000 + 20,000 = 1,020,000, NIGHT 50,000; the holiday: 300% + 30% + 20% × 300% → OVERTIME 5 × 300,000 + 40,000 = 1,540,000, NIGHT 50,000`,
			'Labour Code art.109(1): no break is owed on a span under six hours; art.107(2): 11 overtime hours, under 40 a month',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}: on 17,600,000 — 1,408,000 / 3,080,000; 264,000 / 528,000; 176,000 / 176,000`,
			`${PIT_CITE}; Law 109/2025 art.4(8): night and overtime pay exempt: 17,600,000 − 1,848,000 − 15,500,000 = 252,000 × 5% = 12,600`,
			'Gross 17,600,000 + 2,710,000 + 180,000 = 20,490,000; net 20,490,000 − 1,848,000 − 12,600 = 18,629,400'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'dem', name: 'Đêm Văn Khuya', number: 'P-VN-311', born: '1994-04-04', salary: 17_600_000, from: '2025-06-02' }),
			holiday('2026-01-01', 'Tết Dương lịch'),
			worked('dem_job', '2026-01-01', [['18:00', '23:00']], 5),
			worked('dem_job', '2026-01-06', [['14:00', '18:00'], ['19:00', '23:00']]),
			worked('dem_job', '2026-01-11', [['18:00', '23:00']], 5),
			worked('dem_job', '2026-01-13', [['09:00', '13:00'], ['14:00', '18:00'], ['22:00', '23:00']], 1)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'dem_job',
				lines: {
					...slip(20_490_000, 18_629_400, 3_784_000, [1_408_000, 3_080_000], [264_000, 528_000], [176_000, 176_000], 12_600),
					BASIC: 17_600_000,
					OVERTIME: 2_710_000,
					NIGHT_PREMIUM: 180_000
				}
			}
		]
	},
	{
		id: 'VN-PRORATE-01-2',
		profile: 'VN',
		description:
			'A contract that states its own divisor, March 2026 (22 working days, 31 calendar days): two joiners on Monday 16 March on 22,000,000, one prorating on calendar days (16 of 31), one on a fixed 26 days (12 working days employed).',
		citation: [
			`${LC_CITE} art.55(1)(a) and owner rule 2026-09-28 (VN-PRORATE-01): no statute fixes the divisor, so the contract’s own governs (employment_terms.proration, work_rules.proration_contractual): 22,000,000 × 16 ÷ 31 = 11,354,838.71 → 11,354,839; 22,000,000 × 12 ÷ 26 = 10,153,846.15 → 10,153,846`,
			`${SI_CITE}; arts.33(5), 34(3): 10 unworked days before the hire, under 14 → 1,760,000 / 3,850,000; ${HI_CITE} 330,000 / 660,000; ${UI_CITE} 220,000 / 220,000`,
			`${PIT_CITE}: both below 2,310,000 + 15,500,000 → 0; net 9,044,839 and 7,843,846`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'cal', name: 'Lịch Văn Ngày', number: 'P-VN-321', born: '1997-03-03', salary: 22_000_000, from: '2026-03-16', terms: { proration: { by: 'CALENDAR_DAYS' } } }),
			...hire({ ref: 'fix', name: 'Cố Thị Định', number: 'P-VN-322', born: '1998-04-04', gender: 'FEMALE', salary: 22_000_000, from: '2026-03-16', terms: { proration: { by: 'FIXED_DAYS', days: 26 } } })
		],
		period: '2026-03',
		expected: [
			{ employment: 'cal_job', lines: slip(11_354_839, 9_044_839, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000]) },
			{ employment: 'fix_job', lines: slip(10_153_846, 7_843_846, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000]) }
		]
	},
	{
		id: 'VN-UI-01-2',
		profile: 'VN',
		description:
			'A citizen aged 63 who qualifies for a monthly pension but is not drawing one, on 20,000,000, March 2026: still inside SI and HI, outside UI from 2026.',
		citation: [
			'Law 74/2025/QH15 art.31(2) (https://vanban.chinhphu.vn/?docid=214560&pageid=27160): a worker who qualifies for a monthly pension is not a UI participant; Law 41/2024/QH15 art.2(1): no age exception for a Vietnamese employee not receiving a pension',
			`${SI_CITE}: 1,600,000 / 3,500,000; ${HI_CITE}: 300,000 / 600,000`,
			`${PIT_CITE}: 20,000,000 − 1,900,000 − 15,500,000 = 2,600,000 × 5% = 130,000; net 17,970,000`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'gia', name: 'Già Văn Hưu', number: 'P-VN-331', born: '1962-10-01', salary: 20_000_000, from: '2025-06-02', pensionQualified: true })
		],
		period: '2026-03',
		expected: [
			{ employment: 'gia_job', lines: slip(20_000_000, 17_970_000, 4_100_000, [1_600_000, 3_500_000], [300_000, 600_000], null, 130_000) }
		]
	},
	{
		id: 'VN-PIT-06-2',
		profile: 'VN',
		description:
			'The 1 July 2026 short-contract threshold, Region IV, August 2026: two-month fixed-term contracts (1 August – 30 September) paid 4,900,000 (under 5,000,000: no withholding) and 5,000,000 (10%).',
		citation: [
			'Decree 253/2026/ND-CP art.50(2) (https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-253-2026-nd-cp-469959.htm): a resident with no labour contract or one under three months is withheld 10% of each payment of 5,000,000 or more from 1 July 2026: 4,900,000 → 0; 5,000,000 × 10% = 500,000',
			`${MW293_CITE}: Region IV 3,700,000 is met`,
			'SI: Law 41/2024/QH15 art.2(1)(a) contracts of one month or more, reference level 2,530,000 from 1 July 2026 (floor not reached): 392,000 / 857,500 and 400,000 / 875,000; HI 73,500 / 147,000 and 75,000 / 150,000; UI (Law 74/2025 art.31(1)) 49,000 and 50,000 each side',
			'Net 4,900,000 − 514,500 = 4,385,500; 5,000,000 − 525,000 − 500,000 = 3,975,000'
		],
		company: company('IV'),
		inputs: [
			...WEEK,
			...(
				[
					['ha', 'Hạ Thị Hè', 'P-VN-341', 4_900_000],
					['thu2', 'Thu Văn Mùa', 'P-VN-342', 5_000_000]
				] as const
			).flatMap(([ref, name, number, salary]) =>
				hire({
					ref,
					name,
					number,
					born: '2001-08-08',
					type: 'CONTRACT',
					salary,
					from: '2026-08-01',
					to: '2026-09-30',
					exitReason: 'END_OF_CONTRACT',
					region: 'IV',
					pit: { unit_assessments: [{ period: '2026-08', gross: salary, units: 1, reference: 'AUG-WAGE', paid_on: '2026-08-31' }] }
				})
			)
		],
		period: '2026-08',
		expected: [
			{ employment: 'ha_job', lines: slip(4_900_000, 4_385_500, 1_053_500, [392_000, 857_500], [73_500, 147_000], [49_000, 49_000]) },
			{ employment: 'thu2_job', lines: slip(5_000_000, 3_975_000, 1_075_000, [400_000, 875_000], [75_000, 150_000], [50_000, 50_000], 500_000) }
		]
	},
	{
		id: 'VN-PIT-03-2',
		profile: 'VN',
		description:
			'A declared non-resident foreign work-permit holder on 30,000,000 (24-month fixed term), August 2026, under Law 109/2025/QH15 in force from 1 July 2026: 20% of the salary with no deduction.',
		citation: [
			'PIT Law 109/2025/QH15 art.21 (signed text https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/01/luat109-2025.pdf pp.12–13, read 2026-09-30): a non-resident’s salary and wage income × 20%, wherever paid: 30,000,000 × 20% = 6,000,000',
			'SI: Law 41/2024/QH15 art.2(2) fixed term of 12 months or more → 2,400,000 / 5,250,000 (under the 50,600,000 ceiling); HI 450,000 / 900,000; UI: Law 74/2025 art.2(1) citizens only — none',
			'Net 30,000,000 − 2,850,000 − 6,000,000 = 21,150,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'lee', name: 'Lee Minho', number: 'P-VN-351', born: '1985-05-05', nationality: 'Korean', foreigner: true, nonResident: true, type: 'CONTRACT', salary: 30_000_000, from: '2025-06-02', to: '2027-06-01' })
		],
		period: '2026-08',
		expected: [
			{ employment: 'lee_job', lines: slip(30_000_000, 21_150_000, 6_150_000, [2_400_000, 5_250_000], [450_000, 900_000], null, 6_000_000) }
		]
	}
);

// ─── Closure round 2026-09-30 (batch 9): floors, calendar, hourly base, December 2025 PIT, part-month joiner ──

const MW293_ART5_CITE =
	'Decree 293/2025/ND-CP art.5(5) (Government transcription https://xaydungchinhsach.chinhphu.vn/nghi-dinh-so-293-2025-nd-cp-quy-dinh-muc-luong-toi-thieu-doi-voi-nguoi-lao-dong-lam-viec-theo-hop-dong-lao-dong-119251110172808433.htm, read 2026-09-30): where a locality moves to a lower region, the employer keeps paying the minimum wage in force on 31 December 2025 to workers employed before that date, until the Government rules otherwise';

register(
	{
		id: 'VN-MW293-08-1',
		profile: 'VN',
		description:
			'A Region IV company, March 2026: a worker hired on 5 January 2026 at a reclassified worksite (recorded as Region III on the prior order) is held only to the 2026 Region IV floor — 3,700,000 settles, the 2025 protection reaching only workers employed before 31 December 2025.',
		citation: [
			MW293_ART5_CITE,
			`${MW293_CITE}: Region IV 3,700,000 is met`,
			`${SI_CITE}: 296,000 / 647,500; ${HI_CITE}: 55,500 / 111,000; ${UI_CITE}: 37,000 each side`,
			`${PIT_CITE}: 3,700,000 < 15,500,000 → 0; net 3,700,000 − 388,500 = 3,311,500; employer 795,500`
		],
		company: company('IV'),
		inputs: [
			...WEEK,
			...hire({
				ref: 'moi',
				name: 'Mới Văn Vào',
				number: 'P-VN-361',
				born: '2000-02-02',
				salary: 3_700_000,
				from: '2026-01-05',
				region: 'IV',
				termsFacts: { prior_floor_region: 'III', prior_floor_reclassified: true }
			})
		],
		period: '2026-03',
		expected: [
			{ employment: 'moi_job', lines: slip(3_700_000, 3_311_500, 795_500, [296_000, 647_500], [55_500, 111_000], [37_000, 37_000]) }
		]
	},
	{
		id: 'VN-MW293-08-2',
		profile: 'VN',
		description:
			'A Region IV company, March 2026: an incumbent hired in 2025 at a worksite reclassified from Region III is contracted at 3,800,000 — above the 2026 Region IV floor but under the protected 2025 Region III floor of 3,860,000 — and the run is refused.',
		citation: [
			MW293_ART5_CITE,
			`${MW74_CITE}: Region III 3,860,000 on 31 December 2025; 3,800,000 < 3,860,000`,
			'Labour Code 45/2019 art.90(2): the wage may not be below the minimum wage'
		],
		company: company('IV'),
		inputs: [
			...WEEK,
			...hire({
				ref: 'cu',
				name: 'Cũ Thị Giữ',
				number: 'P-VN-362',
				born: '1991-03-03',
				gender: 'FEMALE',
				salary: 3_800_000,
				from: '2025-06-02',
				region: 'IV',
				termsFacts: { prior_floor_region: 'III', prior_floor_reclassified: true }
			})
		],
		period: '2026-03',
		refused: 'MINIMUM_WAGE_BELOW.*P-VN-362',
		expected: []
	},
	{
		id: 'VN-MW293-05-1',
		profile: 'VN',
		description:
			'A Region I weekly-paid full-timer on 1,000,000 a week for a 40-hour week, March 2026: under the monthly floor after the 52/12 conversion and under the hourly floor after the weekly-hours conversion, so the run is refused.',
		citation: [
			MW293_CITE,
			'Decree 293/2025/ND-CP art.4 (Government transcription, read 2026-09-30): a weekly wage is converted to a month as the weekly wage × 52 ÷ 12, or to an hour over the normal weekly hours, and must meet the monthly or the hourly minimum: 1,000,000 × 52 ÷ 12 = 4,333,333 < 5,310,000; 1,000,000 ÷ 40 = 25,000 < 25,500'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'tuan',
				name: 'Tuần Văn Lương',
				number: 'P-VN-363',
				born: '1996-06-06',
				salary: 1_000_000,
				payFrequency: 'WEEKLY',
				from: '2025-06-02',
				terms: { ordinary_hours_per_week: 40 }
			})
		],
		period: '2026-03',
		refused: 'MINIMUM_WAGE_BELOW.*P-VN-363',
		expected: []
	},
	{
		id: 'VN-LC111-01-1',
		profile: 'VN',
		description:
			'Giỗ Tổ Hùng Vương 2026 falls on Sunday 26 April, the weekly rest day, and is substituted on Monday 27 April. A citizen on 17,600,000 (100,000 an hour, April’s 22 working days) works 8 hours on each: the Sunday is holiday work at 300%, the substitute Monday rest-day work at 200%.',
		citation: [
			'Labour Code 45/2019 art.111(3): a weekly rest day that coincides with an art.112(1) holiday is compensated on the next working day; Government calendar https://xaydungchinhsach.chinhphu.vn/lich-nghi-le-gio-to-hung-vuong-30-4-1-5-quoc-khanh-2-9-nam-2026-119260222115822151.htm (26 April Sunday → Monday 27 April)',
			`${LC_CITE} art.55(1)(a): 17,600,000 ÷ 22 ÷ 8 = 100,000; art.55(1)(c) holiday 300% → 8 × 300,000 = 2,400,000; art.55(3) the substitute day of a holiday on the weekly rest day is paid as weekly rest-day work, 200% → 8 × 200,000 = 1,600,000`,
			'Labour Code art.109(1): the one-hour gap each day is the break',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}: on 17,600,000 — 1,408,000 / 3,080,000; 264,000 / 528,000; 176,000 / 176,000`,
			`${PIT_CITE}; Law 109/2025 art.4(8) overtime pay exempt: 17,600,000 − 1,848,000 − 15,500,000 = 252,000 × 5% = 12,600`,
			'Gross 17,600,000 + 4,000,000 = 21,600,000; net 21,600,000 − 1,848,000 − 12,600 = 19,739,400'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'gio', name: 'Hùng Văn Giỗ', number: 'P-VN-364', born: '1990-04-26', salary: 17_600_000, from: '2025-06-02' }),
			holiday('2026-04-26', 'Giỗ Tổ Hùng Vương'),
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-04-27',
					name: 'Giỗ Tổ Hùng Vương — nghỉ bù',
					kind: 'SUBSTITUTE',
					replaces: '2026-04-26',
					published_at: '2025-11-01T00:00:00.000Z'
				}
			},
			holiday('2026-04-30', 'Ngày Chiến thắng'),
			worked('gio_job', '2026-04-26', [['09:00', '13:00'], ['14:00', '18:00']], 8),
			worked('gio_job', '2026-04-27', [['09:00', '13:00'], ['14:00', '18:00']], 8)
		],
		period: '2026-04',
		expected: [
			{
				employment: 'gio_job',
				lines: {
					...slip(21_600_000, 19_739_400, 3_784_000, [1_408_000, 3_080_000], [264_000, 528_000], [176_000, 176_000], 12_600),
					BASIC: 17_600_000,
					OVERTIME: 4_000_000
				}
			}
		]
	},
	{
		id: 'VN-LC98-02-2',
		profile: 'VN',
		description:
			'The hourly base leaves out the mid-shift meal, August 2026 (21 working days): a citizen on 21,000,000 with a 1,500,000 meal allowance works 2 overtime hours on a normal day; the hour is 125,000 on the contract wage, not on wage plus meal.',
		citation: [
			`${LC_CITE} art.55(1)(a) with art.54: the hourly wage excludes the mid-shift meal and supplements unrelated to the job — 21,000,000 ÷ 21 ÷ 8 = 125,000; Labour Code art.98(1)(a) 150% → 2 × 187,500 = 375,000`,
			'Insurance salary: Decree 158/2025/ND-CP art.7(1)(c) and Circular 10/2020/TT-BLĐTBXH art.3(5)(c): the mid-shift meal is outside — SI 1,680,000 / 3,675,000, HI 315,000 / 630,000, UI 210,000 / 210,000 on 21,000,000',
			'PIT: Decree 253/2026/ND-CP art.8(2)(g) — the meal is taxable only above 1,200,000 → 300,000; Law 109/2025 art.4(8) overtime exempt; 21,300,000 − 2,205,000 − 15,500,000 = 3,595,000 × 5% = 179,750',
			'Gross 21,000,000 + 1,500,000 + 375,000 = 22,875,000; net 22,875,000 − 2,205,000 − 179,750 = 20,490,250; employer 4,515,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'com',
				name: 'Cơm Văn Ca',
				number: 'P-VN-365',
				born: '1993-08-08',
				salary: 21_000_000,
				from: '2025-06-02',
				terms: { allowances: [{ catalogue_id: '@law:allowance_catalogue:MEAL_ALLOWANCE', amount: 1_500_000 }] }
			}),
			worked('com_job', '2026-08-04', [['09:00', '13:00'], ['14:00', '20:00']], 2)
		],
		period: '2026-08',
		expected: [
			{
				employment: 'com_job',
				lines: {
					...slip(22_875_000, 20_490_250, 4_515_000, [1_680_000, 3_675_000], [315_000, 630_000], [210_000, 210_000], 179_750),
					BASIC: 21_000_000,
					MEAL_ALLOWANCE: 1_500_000,
					OVERTIME: 375_000
				}
			}
		]
	},
	{
		id: 'VN-PIT-01-2',
		profile: 'VN',
		description:
			'December 2025 under the law then in force: a resident citizen on 20,000,000 with one registered dependant (4,400,000), and a declared non-resident foreign work-permit holder on 30,000,000 (24-month fixed term) withheld 20% flat.',
		citation: [
			`${PIT25_CITE}, dependant 4,400,000: 20,000,000 − 2,100,000 − 11,000,000 − 4,400,000 = 2,500,000 × 5% = 125,000; net 17,775,000`,
			'Non-resident: PIT Law 04/2007/QH12 art.26 and Circular 111/2013/TT-BTC art.18(1): salary × 20% → 6,000,000',
			`${SI_CITE}; art.2(2) a foreigner on a fixed term of 12 months or more: 2,400,000 / 5,250,000; ${HI_CITE}: 450,000 / 900,000`,
			`${UI38_CITE}: 200,000 each side for the citizen; Law 38/2013 art.3(1) a worker is a Vietnamese citizen — no UI for the foreigner`,
			'Net 30,000,000 − 2,850,000 − 6,000,000 = 21,150,000; employer 6,150,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'con', name: 'Nuôi Văn Con', number: 'P-VN-366', born: '1988-12-12', salary: 20_000_000, from: '2025-06-02', uiFrom: null, dependants: 1 }),
			...hire({ ref: 'park', name: 'Park Jiwoo', number: 'P-VN-367', born: '1984-04-04', nationality: 'Korean', foreigner: true, nonResident: true, type: 'CONTRACT', salary: 30_000_000, from: '2025-06-02', to: '2027-06-01', uiFrom: null })
		],
		period: '2025-12',
		expected: [
			{ employment: 'con_job', lines: slip(20_000_000, 17_775_000, 4_300_000, [1_600_000, 3_500_000], [300_000, 600_000], [200_000, 200_000], 125_000) },
			{ employment: 'park_job', lines: slip(30_000_000, 21_150_000, 6_150_000, [2_400_000, 5_250_000], [450_000, 900_000], null, 6_000_000) }
		]
	},
	{
		id: 'VN-PIT-06-3',
		profile: 'VN',
		description:
			'A two-month fixed term (Monday 23 March – 22 May 2026) on 3,700,000, Region IV: March pays 7 of 22 working days, 1,177,273, under the pre-July 2,000,000 threshold (no withholding); the 15 working days before the hire reach 14, so March owes no SI, HI or UI.',
		citation: [
			`Proration: owner rule VN-PRORATE-01 and ${LC_CITE} art.54(1)(a3): 3,700,000 × 7 ÷ 22 = 1,177,272.73 → 1,177,273`,
			'PIT: Circular 111/2013/TT-BTC art.25(1)(i) — 10% only on a payment of 2,000,000 or more to a resident on a contract under three months, before 1 July 2026 → 0',
			`${SI_CITE}; arts.33(5), 34(3), HI on the SI salary, Law 74/2025 art.33(4): 14 or more working days in the month unworked and unpaid → no contribution; 15 here (owner reading as VN-PRORATE-01-1)`,
			'Net 1,177,273; employer cost 0'
		],
		company: company('IV'),
		inputs: [
			...WEEK,
			...hire({
				ref: 'ngan',
				name: 'Ngắn Thị Hạn',
				number: 'P-VN-368',
				born: '2003-03-23',
				gender: 'FEMALE',
				type: 'CONTRACT',
				salary: 3_700_000,
				from: '2026-03-23',
				to: '2026-05-22',
				exitReason: 'END_OF_CONTRACT',
				region: 'IV',
				pit: { unit_assessments: [{ period: '2026-03', gross: 1_177_273, units: 1, reference: 'MAR-WAGE', paid_on: '2026-03-31' }] }
			})
		],
		period: '2026-03',
		expected: [{ employment: 'ngan_job', lines: { gross: 1_177_273, net: 1_177_273, employer_cost: 0 } }]
	}
);

// ─── Closure round 2026-09-30 (batch 10): disabled-hire UI relief, settlement deadline, month OT limit, sickness,
// wage deductions ──────────────────────────────────────────────────────────────────────────────────────────────────

const D374_ART5_CITE =
	'Decree 374/2025/ND-CP art.5 (Official Gazette 48 of 23 January 2026, DOCX text read 2026-09-30, https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-374-2025-nd-cp-468724.htm): (1) an employer that newly hires and employs a worker with a disability pays 0% instead of 1% of its own UI share for that worker while the worker works, for at most the first 12 months from the hire; (2) it registers the worker with the social-insurance agency with a copy of the disability certificate';
const LC_GAZETTE =
	'Labour Code 45/2019/QH14, Official Gazette 993+994 of 26 December 2019 (https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf, text layer read 2026-09-30)';

/** A dated SI or HI declaration for March 2026 (the other VN cases leave both to the run's ASSESS default). */
const registered = (ref: string, number: string, code: 'SI' | 'HI', elections: Row = {}): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: `@${ref}`,
		employment_id: `@${ref}_job`,
		statutory_contribution_id: `@law:statutory_contributions:${code}`,
		effective_range: { from: '2026-03-01', to: '2026-03-31' },
		status: { kind: 'REGISTERED', reference_number: `PROBE-${code}-${number}`, elections }
	}
});

/** One ad hoc request of the named class in March 2026. */
const adhoc = (ref: string, code: string, amount: number, values: Row = {}): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: '2026-03-10',
		pay_period: '2026-03',
		reason: code,
		...values
	}
});

const damage = (ref: string, amount: number): ProbeInput => ({
	...adhoc(ref, 'PROPERTY_DAMAGE_COMPENSATION', amount, {
		reason: 'Instalment of compensation decided for a damaged tool (Labour Code arts.129–130)'
	}),
	files: { evidence_file: 'compensation-decision.pdf' }
});

register(
	{
		id: 'VN-UI-05-1',
		profile: 'VN',
		description:
			'Three citizens with a disability on 20,000,000, Region I, March 2026: one hired Monday 5 January 2026 and registered for the Decree 374/2025 art.5 reduction with the certificate (employer UI 0%, the worker still 1%); one hired the same day without that registration (1% + 1%); one hired 2 June 2025 and registered (1% + 1%: hired before the decree took effect).',
		citation: [
			D374_ART5_CITE,
			'Owner rule 2026-09-28 defaults recorded in VN-UI-05 (the decree is silent): the 12 months are the hire month and the eleven after it — March 2026 is the third for a 5 January hire; a hire before 1 January 2026, the decree’s commencement, is not “tuyển mới” under it',
			`${SI_CITE}: 1,600,000 / 3,500,000; ${HI_CITE}: 300,000 / 600,000; ${UI_CITE}: 200,000 worker; employer 200,000, or 0 under art.5`,
			`${PIT_CITE}: 20,000,000 − 2,100,000 − 15,500,000 = 2,400,000 × 5% = 120,000; net 17,780,000`,
			'Employer cost 3,500,000 + 600,000 + 0 = 4,100,000 with the reduction, 4,300,000 without'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({
				ref: 'khuyet',
				name: 'Khuyết Văn Một',
				number: 'P-VN-381',
				born: '1995-01-15',
				disabled: true,
				salary: 20_000_000,
				from: '2026-01-05',
				uiElections: {
					disabled_new_hire_relief: true,
					disability_certificate_reference: 'GXNKT-2025-0381'
				}
			}),
			...hire({
				ref: 'khuyet2',
				name: 'Khuyết Thị Hai',
				number: 'P-VN-382',
				born: '1996-02-15',
				gender: 'FEMALE',
				disabled: true,
				salary: 20_000_000,
				from: '2026-01-05'
			}),
			...hire({
				ref: 'khuyet3',
				name: 'Khuyết Văn Ba',
				number: 'P-VN-383',
				born: '1990-03-15',
				disabled: true,
				salary: 20_000_000,
				from: '2025-06-02',
				uiElections: {
					disabled_new_hire_relief: true,
					disability_certificate_reference: 'GXNKT-2025-0383'
				}
			})
		],
		period: '2026-03',
		expected: [
			{
				employment: 'khuyet_job',
				lines: slip(20_000_000, 17_780_000, 4_100_000, [1_600_000, 3_500_000], [300_000, 600_000], [200_000, 0], 120_000)
			},
			...['khuyet2_job', 'khuyet3_job'].map((employment) => ({
				employment,
				lines: slip(20_000_000, 17_780_000, 4_300_000, [1_600_000, 3_500_000], [300_000, 600_000], [200_000, 200_000], 120_000)
			}))
		]
	},
	{
		id: 'VN-LC48-01-1',
		profile: 'VN',
		description:
			'Two leavers on Friday 6 March 2026, each hired 1 January 2022 on 22,000,000: a resignation (the final settlement due on the 14th working day, Thursday 26 March, so the 31 March run warns) and a redundancy with UI from 1 January 2024 (the art.48(1)(b) 30-day extension to 5 April: no warning). Five of March’s 22 working days are paid; the 17 after the exit take the month outside SI, HI and UI.',
		citation: [
			`${LC_GAZETTE} art.48(1) (p.24): the parties settle every amount within 14 working days of the termination, extendable to at most 30 days where the employer restructures or changes technology or for economic reasons (b); Civil Code 91/2015/QH13 art.147(3): the day of termination is not counted — 9–13, 16–20, 23–26 March → 26 March; 6 March + 30 days = 5 April`,
			`Final salary: owner rule VN-PRORATE-01 and ${LC_CITE} art.54(1)(a3): 22,000,000 × 5 ÷ 22 = 5,000,000`,
			`Annual leave: Labour Code art.113(1) 12 days, art.114(1) no seniority day before five years (4 years); ${LC_CITE} art.66(1)–(2): 12 ÷ 12 × 2 months (March’s 5 of 22 working days is under 50%, so it does not count) = 2 days; art.67(3): February’s contract salary 22,000,000 ÷ its 20 normal working days = 1,100,000 → 2,200,000`,
			`Job-loss: Labour Code art.47(1) one month’s wage per year, at least two; ${LC_CITE} art.8(2)–(3): service 1 January 2022 – 6 March 2026 less UI-insured time from 1 January 2024 = 24 months = 2 years → 2 × 22,000,000 = 44,000,000 (redundancy, art.34(11)). The resigner is UI-insured throughout, so no uncovered year owes severance (art.46)`,
			`${SI_CITE}; arts.33(5), 34(3): 17 working days of March after the exit are unworked and unpaid → no SI, and so no HI (${HI_CITE}) and no UI (Law 74/2025 art.33(4))`,
			'PIT: the March salary is paid on 31 March after the contract ended: owner rule 2026-09-28 (VN-PIT-06) 10% of the payment → 500,000; untaken-leave pay exempt (Law 109/2025 art.4(8)); job-loss allowance outside salary income (Decree 253/2026 art.8(3)(h))',
			'Resigner: gross 5,000,000 + 2,200,000 = 7,200,000, net 6,700,000. Redundant: gross 51,200,000, net 50,700,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...(
				[
					{ ref: 'roi', name: 'Rời Văn Đi', number: 'P-VN-371', uiFrom: '2022-01-01', redundant: false },
					{ ref: 'cat', name: 'Cắt Thị Giảm', number: 'P-VN-372', uiFrom: '2024-01-01', redundant: true }
				] as const
			).flatMap(({ ref, name, number, uiFrom, redundant }) => [
				...hire({
					ref,
					name,
					number,
					born: '1985-05-05',
					gender: redundant ? 'FEMALE' : 'MALE',
					salary: 22_000_000,
					from: '2022-01-01',
					to: '2026-03-06',
					uiFrom,
					exitReason: redundant ? 'REDUNDANCY' : 'RESIGNATION',
					exitFacts: redundant ? {} : { pension_eligible: false },
					pit: {
						unit_assessments: [
							{ period: '2026-03', gross: 5_000_000, units: 1, reference: 'FINAL-WAGE', paid_on: '2026-03-31' }
						]
					}
				}),
				registered(ref, number, 'SI', { continue_si_unpaid: false }),
				registered(ref, number, 'HI'),
				leave(`${ref}_job`, 'ANNUAL_LEAVE', {
					reference: `EXIT-AL-${ref}`,
					from_date: '2026-01-01',
					to_date: '2026-12-31',
					days: 2,
					encash_days: 2,
					effective_on: '2026-03-06',
					due_on: '2026-03-06',
					reason: 'Unused annual leave on departure 2026-03-06'
				}),
				adhoc(ref, redundant ? 'JOB_LOSS_ALLOWANCE' : 'SEVERANCE_ALLOWANCE', 0, {
					event_date: '2026-03-06',
					reason: 'Separation payment on departure 2026-03-06'
				})
			])
		],
		period: '2026-03',
		warnings: ['FINAL_PAY_LATE: P-VN-371 left on 2026-03-06.*by 2026-03-26.*pays on 2026-03-31'],
		expected: [
			{ employment: 'roi_job', lines: { gross: 7_200_000, net: 6_700_000, employer_cost: 0, 'PIT.employee': 500_000 } },
			{
				employment: 'cat_job',
				lines: {
					gross: 51_200_000,
					net: 50_700_000,
					employer_cost: 0,
					JOB_LOSS_ALLOWANCE: 44_000_000,
					'PIT.employee': 500_000
				}
			}
		]
	},
	{
		id: 'VN-LC107-01-1',
		profile: 'VN',
		description:
			'The 40-hour month, March 2026 (22 working days, no holiday), 17,600,000 (100,000 an hour): 3 approved overtime hours beyond the normal day on 14 weekdays (2–19 March) = 42. The first 40 are overtime at 150%, exempt from PIT; the 41st and 42nd (19 March) are paid at the same rate as taxable incentive pay.',
		citation: [
			`${LC_GAZETTE} art.107(2)(b) (p.47): overtime at most 50% of the normal daily hours and at most 40 hours a month; art.98(1)(a): at least 150% on a normal day; ${LC_CITE} art.55(1)(a): 17,600,000 ÷ 22 ÷ 8 = 100,000 → 150,000 an overtime hour`,
			'OVERTIME 40 × 150,000 = 6,000,000; the 2 hours past the monthly ceiling INCENTIVE 2 × 150,000 = 300,000 (work done is paid, but it is not overtime within art.107)',
			'PIT: Law 109/2025/QH15 art.4(8) (Official Gazette 37 DOCX, https://congbao.chinhphu.vn/van-ban/luat-so-109-2025-qh15-468671.htm, read 2026-09-30) exempts “tiền lương làm việc ban đêm, làm thêm giờ … theo quy định của pháp luật” — overtime within the labour law, applied to resident salary from tax year 2026 (art.29(2)); the 2 hours past art.107(2)(b) are taxable (the seeded reading, golden “VN — overtime past the 40-hour month … funnelled to the taxable line”)',
			`${SI_CITE}, ${HI_CITE}, ${UI_CITE}: on 17,600,000 — 1,408,000 / 3,080,000; 264,000 / 528,000; 176,000 / 176,000`,
			`${PIT_CITE}: 17,600,000 + 300,000 − 1,848,000 − 15,500,000 = 552,000 × 5% = 27,600`,
			'Labour Code art.107(2)(b): 11 hours worked a day (8 + 3) is within 12. Gross 17,600,000 + 6,300,000 = 23,900,000; net 23,900,000 − 1,848,000 − 27,600 = 22,024,400'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'gio40', name: 'Giờ Văn Trần', number: 'P-VN-391', born: '1991-01-01', salary: 17_600_000, from: '2025-06-02' }),
			...[2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17, 18, 19].map((day) =>
				worked('gio40_job', `2026-03-${String(day).padStart(2, '0')}`, [['09:00', '13:00'], ['14:00', '21:00']], 3)
			)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'gio40_job',
				lines: {
					...slip(23_900_000, 22_024_400, 3_784_000, [1_408_000, 3_080_000], [264_000, 528_000], [176_000, 176_000], 27_600),
					BASIC: 17_600_000,
					OVERTIME: 6_000_000,
					INCENTIVE: 300_000
				}
			}
		]
	},
	{
		id: 'VN-SI-07-1',
		profile: 'VN',
		description:
			'Two certified sick days (Tuesday–Wednesday 10–11 March 2026) for a citizen on 22,000,000 with sickness benefit declared: the days are paid by the SI fund, not the payroll, so the salary is 20 of 22 working days; SI, HI and UI stay on the contract salary.',
		citation: [
			'Law 41/2024/QH15 art.43(1)(a) (https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm): 30 working days a year under 15 years’ contribution; art.45: the fund pays 75% of the preceding month’s insured salary for the days — a benefit, not a wage; art.47: the certificate of leave',
			'Owner rule VN-PRORATE-01: 22,000,000 × 20 ÷ 22 = 20,000,000',
			`${SI_CITE}; arts.33(5), 34(3): only 14 or more days off in the month end its contribution — 2 here: 1,760,000 / 3,850,000; ${HI_CITE}: 330,000 / 660,000; ${UI_CITE}: 220,000 / 220,000`,
			`${PIT_CITE}: 20,000,000 − 2,310,000 − 15,500,000 = 2,190,000 × 5% = 109,500; net 17,580,500`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'om', name: 'Ốm Thị Đau', number: 'P-VN-392', born: '1992-02-02', gender: 'FEMALE', salary: 22_000_000, from: '2025-06-02' }),
			registered('om', 'P-VN-392', 'SI', { sickness_benefit_eligible: true, long_term_sickness: false, first_return_month: false }),
			{
				...leave('om_job', 'SICK_LEAVE', {
					reference: 'SICK-2',
					from_date: '2026-03-10',
					to_date: '2026-03-11',
					reason: 'Certified sickness (Law 41/2024 art.42)'
				}),
				files: { certificate_file: 'sick-leave-certificate.pdf' }
			}
		],
		period: '2026-03',
		expected: [
			{ employment: 'om_job', lines: slip(20_000_000, 17_580_500, 4_730_000, [1_760_000, 3_850_000], [330_000, 660_000], [220_000, 220_000], 109_500) }
		]
	},
	{
		id: 'VN-LC102-01-1',
		profile: 'VN',
		description:
			'A decided compensation instalment for a damaged tool, March 2026, a citizen on 20,000,000: exactly 30% of the wage after SI, HI, UI and PIT (5,334,000) is deducted.',
		citation: [
			`${LC_GAZETTE} art.102(1)–(3) (p.45): wages may be deducted only to compensate damage to tools, equipment or property under art.129; the worker is told the reason; at most 30% of the monthly wage actually paid after compulsory SI, HI, UI and PIT; art.129(1) (p.55): negligent damage is compensated by monthly deduction under art.102(3)`,
			`${SI_CITE}: 1,600,000; ${HI_CITE}: 300,000; ${UI_CITE}: 200,000; ${PIT_CITE}: 120,000 (the deduction does not reduce taxable salary, owner rule VN-LC102-01)`,
			'Ceiling (20,000,000 − 2,220,000) × 30% = 5,334,000; net 20,000,000 − 2,220,000 − 5,334,000 = 12,446,000'
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'hong', name: 'Hỏng Văn Máy', number: 'P-VN-393', born: '1989-09-09', salary: 20_000_000, from: '2025-06-02' }),
			damage('hong', 5_334_000)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'hong_job',
				lines: {
					...slip(20_000_000, 12_446_000, 4_300_000, [1_600_000, 3_500_000], [300_000, 600_000], [200_000, 200_000], 120_000),
					total_deductions: 7_554_000,
					PROPERTY_DAMAGE_COMPENSATION: 5_334_000
				}
			}
		]
	},
	{
		id: 'VN-LC102-01-2',
		profile: 'VN',
		description:
			'The same instalment one đồng over the art.102(3) ceiling (5,334,001): the run is refused, not shortened.',
		citation: [
			`${LC_GAZETTE} art.102(3) (p.45): the monthly deduction may not exceed 30% of the wage after SI, HI, UI and PIT — (20,000,000 − 2,220,000) × 30% = 5,334,000 < 5,334,001`
		],
		company: company(),
		inputs: [
			...WEEK,
			...hire({ ref: 'hong2', name: 'Hỏng Thị Thêm', number: 'P-VN-394', born: '1990-10-10', gender: 'FEMALE', salary: 20_000_000, from: '2025-06-02' }),
			damage('hong2', 5_334_001)
		],
		period: '2026-03',
		refused: 'DEDUCTION_CEILING_EXCEEDED.*P-VN-394',
		expected: []
	}
);
