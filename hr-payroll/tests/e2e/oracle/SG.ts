/**
 * Independent Singapore payslip oracle: the expected payslip computed from the LAW alone.
 *
 * Built from docs/inventory/singapore.csv and the official texts it cites, re-read 2026-09-30.
 * Nothing here is read from src/**, seed/** or the probes. Where the law is silent the tracker's recorded owner
 * default is followed and marked `DEFAULT (law silent)` with its row id.
 *
 * Sources (all read 2026-09-30):
 *  [CPFA]   CPF Act 1953 First Schedule paras 1, 1A–1D, 2, 4A, 5 — https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=Sc1-
 *  [CPF25]  CPF Board rate tables from 1 Jan 2025 (Tables 1–5) —
 *           https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPF_contribution_rates_from_1_Jan_2025.pdf
 *  [CPF26]  CPF Board rate tables from 1 Jan 2026 —
 *           https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
 *  [CPF27]  CPF Board rate tables from 1 Jan 2027 —
 *           https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf
 *  [SDLA]   Skills Development Levy Act 1979 ss.2–3 — https://sso.agc.gov.sg/Act/SDLA1979?ProvIds=pr2-,pr3-
 *  [SHG]    CPF Board SHG rates (CDAC, ECF, MBMF, SINDA; page updated 22 Sep 2026) —
 *           https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups
 *           (Rules: https://sso.agc.gov.sg/SL/CPFA1953-R6 CDAC, -R5 SINDA, -R7 ECF; AMLA 1966 s.78 Third Schedule MBMF)
 *  [EA]     Employment Act 1968 ss.2, 10, 11, 20A, 28, 35, 37, 38, 88, 107A, Third and Fourth Schedules —
 *           https://sso.agc.gov.sg/Act/EmA1968?WholeDoc=1
 *  [PT]     Employment (Part-Time Employees) Regulations regs.2, 5 — https://sso.agc.gov.sg/SL/EmA1968-RG8?WholeDoc=1
 *  [HA]     Holidays Act 1998 s.4 and MOM public-holiday lists 2025–2027 (SG-HOL01, SG-HOL02) —
 *           https://sso.agc.gov.sg/Act/HA1998 ; https://www.mom.gov.sg/employment-practices/public-holidays
 *
 * Pure TypeScript; no imports.
 */

// ---------------------------------------------------------------------------------------------------------------
// Scenario shape (a semantic payroll month; tests/e2e/profiles/SG.ts generates these)
// ---------------------------------------------------------------------------------------------------------------

export type Residency = 'CITIZEN' | 'SPR' | 'FOREIGNER';
/** SPR joint election (CPFA First Schedule paras 1A–1D; CPF Board Tables 2–5): graduated/graduated, full employer/graduated employee, full/full. */
export type SprRates = 'GRADUATED' | 'FULL_EMPLOYER' | 'FULL';
export type ExitCause = 'RESIGNATION' | 'DISMISSAL' | 'RETRENCHMENT' | 'CONTRACT_END' | 'DEATH';

export type Scenario = {
	/** unique; also usable as the probe case id */
	id: string;
	profile: 'SG';
	/** tracker row ids this scenario exercises */
	rows: readonly string[];
	/** the named branches of those rows */
	branches: readonly string[];
	description: string;
	/** the payroll month, `YYYY-MM` (monthly pay, pay_cutoff_day 1) */
	period: string;
	/** weekday public holidays of the period the case relies on (the harness publishes them as rows) */
	holidays: readonly string[];
	employee: {
		birth_date: string;
		residency: Residency;
		/** the day SPR status was granted (never inside the period: conversion months are not generated) */
		spr_granted_on?: string;
		spr_rates?: SprRates;
		pass?: 'EP' | 'S_PASS' | 'WORK_PERMIT';
		/** first race on the NRIC / pass (ICA RaceCode spelling) */
		race: string;
		second_race?: string;
		religion?: string;
		/** recorded election to add the second race's fund (SG-SHG04(c)) */
		shg_dual_election?: boolean;
		/** funds the employee has opted out of (Rules r.4) */
		shg_opt_out?: readonly ('CDAC' | 'ECF' | 'MBMF' | 'SINDA')[];
	};
	employment: {
		start: string;
		/** last day of employment, inclusive */
		end?: string;
		exit_cause?: ExitCause;
		/** EA s.2 basic rate of pay, monthly */
		monthly_basic: number;
		/** fixed monthly allowance: part of the gross rate (EA s.2), not the basic rate */
		monthly_allowance?: number;
		/** EA s.2 "workman" (manual labour) */
		workman: boolean;
		/** managerial or executive position (EA s.35(b)) */
		managerial: boolean;
		/** Mon–Fri working days, Sat off day, Sun rest day; own normal hours a day (8 full-time) */
		daily_hours: number;
		/** part-time (< 35 h a week, PT reg.2): the contract's stated hourly basic rate (PT reg.2 "(a)") */
		part_time?: { weekly_hours: number; hourly_basic: number };
	};
	month: {
		/** employee-requested no-pay leave, each a working day (EA s.20A(1)(c); a holiday inside it is unpaid, s.88(2)) */
		no_pay_leave?: readonly string[];
		/** absence without consent or excuse on a working day (EA s.28; s.88(3)) */
		absent?: readonly string[];
		/** hours beyond the normal day on a working day, at the employer's request (EA s.38(4); PT reg.5) */
		overtime?: readonly { date: string; hours: number }[];
		/** work on the Sunday rest day (EA s.37) */
		rest_day_work?: readonly { date: string; hours: number; requested_by: 'EMPLOYEE' | 'EMPLOYER' }[];
		/** work on a public holiday at the employer's request (EA s.88(4)) */
		holiday_work?: readonly { date: string; hours: number }[];
		/** contractual bonus paid this month: an Additional Wage (CPFA para 5(d); SG-AWS01) */
		bonus?: number;
		/** unused annual leave paid on exit: days at the gross rate (EA s.88A; an AW, SG-CPF04) */
		leave_days_paid_on_exit?: number;
		/** salary in lieu of notice (EA s.11): weeks of notice not served, per s.10(3) */
		notice_in_lieu_weeks?: number;
		/** notice in lieu of one day (s.10(3)(a), service under 26 weeks) */
		notice_in_lieu_days?: number;
	};
	/** this employer's earlier CPF wages in the calendar year (CPFA para 2: the AW ceiling is per employer and year) */
	cpf_opening?: { ordinary_wages_ytd: number; additional_wages_ytd: number };
};

export type Charge = { code: string; employee: number; employer: number; base: number };
export type Payslip = {
	gross: number;
	net: number;
	total_deductions: number;
	employer_cost: number;
	/** earned components by meaning (the harness maps these to its component codes) */
	components: Record<string, number>;
	charges: Charge[];
	/** ProbeExpectation lines: gross, net, total_deductions, employer_cost and every NON-ZERO `<scheme>.employee|employer` */
	lines: Record<string, number>;
	notes: string[];
};

// ---------------------------------------------------------------------------------------------------------------
// Arithmetic (money is positive here; epsilon absorbs binary representation error)
// ---------------------------------------------------------------------------------------------------------------

const EPS = 1e-7;
/** half-up to the cent */
export const cents = (x: number) => Math.floor(x * 100 + 0.5 + EPS) / 100;
/** CPFA para 5(b): "rounded off to the nearest dollar except, where the fraction of a dollar is 50 cents, it is to be regarded as a dollar" */
const dollarHalfUp = (x: number) => Math.floor(x + 0.5 + EPS);
/** CPFA para 5(c): "a fraction of a dollar is to be ignored" */
const dollarDown = (x: number) => Math.floor(x + EPS);
const pct = (amount: number, rate: number) => (amount * rate) / 100;

// ---------------------------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------------------------

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const daysOfMonth = (period: string): string[] => {
	const [y, m] = period.split('-').map(Number) as [number, number];
	const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return Array.from({ length: n }, (_, i) => iso(new Date(Date.UTC(y, m - 1, i + 1))));
};
/** 0 = Sunday … 6 = Saturday */
export const weekday = (day: string) => toDate(day).getUTCDay();
/** The contract: Monday to Friday working days, Saturday the off day, Sunday the rest day. */
export const isWorkingDay = (day: string) => weekday(day) >= 1 && weekday(day) <= 5;

/**
 * Public holidays as the employer observes them [HA s.4(2) Sunday → next day; EA s.88(1)(b)], from SG-HOL01/SG-HOL02.
 * Saturday holidays (21 Mar 2026, 6 Feb 2027, 1 May 2027, 25 Dec 2027) are s.88(1)(c) off-day holidays whose pay/
 * day-off choice is the employer's; the generator avoids those months.
 */
export const PUBLIC_HOLIDAYS: readonly string[] = [
	'2025-12-25',
	'2026-01-01',
	'2026-02-17',
	'2026-02-18',
	'2026-03-21',
	'2026-04-03',
	'2026-05-01',
	'2026-05-27',
	'2026-06-01', // Vesak Sun 31 May → Mon
	'2026-08-10', // National Day Sun 9 Aug → Mon
	'2026-11-09', // Deepavali Sun 8 Nov → Mon
	'2026-12-25',
	'2027-01-01',
	'2027-02-06',
	'2027-02-08', // CNY day 2 Sun 7 Feb → Mon
	'2027-03-10',
	'2027-03-26',
	'2027-05-01',
	'2027-05-17',
	'2027-05-20',
	'2027-08-09',
	'2027-10-28',
	'2027-12-25'
];
export const weekdayHolidays = (period: string) =>
	PUBLIC_HOLIDAYS.filter((d) => d.startsWith(period) && isWorkingDay(d));

// ---------------------------------------------------------------------------------------------------------------
// EA day and hour rates
// ---------------------------------------------------------------------------------------------------------------

/** EA s.107A, Third Schedule item 2 (fixed days a week): gross day = 12 × monthly gross ÷ (52 × days a week); basic day likewise on basic. */
const DAYS_A_WEEK = 5;
export const grossDay = (monthlyGross: number) => (12 * monthlyGross) / (52 * DAYS_A_WEEK);
export const basicDay = (monthlyBasic: number) => (12 * monthlyBasic) / (52 * DAYS_A_WEEK);
/** EA Fourth Schedule (monthly-rated): hourly basic = 12 × monthly basic ÷ (52 × 44). DEFAULT (law silent, SG-EA46-R01): unrounded. */
export const hourlyBasic = (monthlyBasic: number) => (12 * monthlyBasic) / (52 * 44);

/**
 * Salary in lieu of notice [EA s.11(1)]: the gross salary that would have accrued in the notice period, a day of it at
 * the Third Schedule gross day (item 5(a) names s.11(1)). Notice length absent agreement is s.10(3): 1 day below 26
 * weeks' service, 1 week to 2 years, 2 weeks to 5 years, 4 weeks from 5 years.
 */
export const noticePayInLieu = (monthlyGross: number, weeks: number, days = 0) =>
	cents(grossDay(monthlyGross) * (weeks * DAYS_A_WEEK + days));
/** Leave pay at the gross rate of pay for a day [EA s.88A(7)/(8) via Third Schedule item 2]. */
export const leavePay = (monthlyGross: number, days: number) => cents(grossDay(monthlyGross) * days);

/** EA s.35: Part 4 covers a workman on salary ≤ $4,500, and any other non-managerial employee on salary ≤ $2,600 (salary excluding allowances). */
export const partFourCovers = (e: Scenario['employment']) =>
	!e.managerial && (e.workman ? e.monthly_basic <= 4500 : e.monthly_basic <= 2600);

// ---------------------------------------------------------------------------------------------------------------
// CPF [CPFA First Schedule; CPF Board Tables 1–5 of 2025, 2026, 2027]
// ---------------------------------------------------------------------------------------------------------------

/** One age cell: employer-only % (> $50–500), the employee factor (> $500–750), total % and employee % (> $750). */
type Cell = readonly [lowTotal: number, factor: number, total: number, employee: number];
type Table = readonly Cell[];
/** Table 1 has five age groups (≤55, >55–60, >60–65, >65–70, >70); Tables 2 and 3 four (≤55, >55–60, >60–65, >65). */
const T2: Table = [
	[4, 0.15, 9, 5],
	[4, 0.15, 9, 5],
	[3.5, 0.15, 8.5, 5],
	[3.5, 0.15, 8.5, 5]
];
const T3: Table = [
	[9, 0.45, 24, 15],
	[6, 0.375, 18.5, 12.5],
	[3.5, 0.225, 11, 7.5],
	[3.5, 0.15, 8.5, 5]
];
const RATES: Record<number, { owc: number; T1: Table; T2: Table; T3: Table; T4: Table; T5: Table }> = {
	// [CPF25]; OW ceiling $7,400 [CPFA para 5(ea)(iii)]
	2025: {
		owc: 7400,
		T1: [
			[17, 0.6, 37, 20],
			[15.5, 0.51, 32.5, 17],
			[12, 0.345, 23.5, 11.5],
			[9, 0.225, 16.5, 7.5],
			[7.5, 0.15, 12.5, 5]
		],
		T2,
		T3,
		T4: [
			[17, 0.15, 22, 5],
			[15.5, 0.15, 20.5, 5],
			[12, 0.15, 17, 5],
			[9, 0.15, 14, 5],
			[7.5, 0.15, 12.5, 5]
		],
		T5: [
			[17, 0.45, 32, 15],
			[15.5, 0.375, 28, 12.5],
			[12, 0.225, 19.5, 7.5],
			[9, 0.15, 14, 5],
			[7.5, 0.15, 12.5, 5]
		]
	},
	// [CPF26] and CPFA para 1 as in force from 1 Jan 2026 (S 886/2025); OW ceiling $8,000 [para 5(ea)(iv)]
	2026: {
		owc: 8000,
		T1: [
			[17, 0.6, 37, 20],
			[16, 0.54, 34, 18],
			[12.5, 0.375, 25, 12.5],
			[9, 0.225, 16.5, 7.5],
			[7.5, 0.15, 12.5, 5]
		],
		T2,
		T3,
		T4: [
			[17, 0.15, 22, 5],
			[16, 0.15, 21, 5],
			[12.5, 0.15, 17.5, 5],
			[9, 0.15, 14, 5],
			[7.5, 0.15, 12.5, 5]
		],
		T5: [
			[17, 0.45, 32, 15],
			[16, 0.375, 28.5, 12.5],
			[12.5, 0.225, 20, 7.5],
			[9, 0.15, 14, 5],
			[7.5, 0.15, 12.5, 5]
		]
	},
	// [CPF27]
	2027: {
		owc: 8000,
		T1: [
			[17, 0.6, 37, 20],
			[16.5, 0.57, 35.5, 19],
			[13, 0.39, 26, 13],
			[9, 0.225, 16.5, 7.5],
			[7.5, 0.15, 12.5, 5]
		],
		T2,
		T3,
		T4: [
			[17, 0.15, 22, 5],
			[16.5, 0.15, 21.5, 5],
			[13, 0.15, 18, 5],
			[9, 0.15, 14, 5],
			[7.5, 0.15, 12.5, 5]
		],
		T5: [
			[17, 0.45, 32, 15],
			[16.5, 0.375, 29, 12.5],
			[13, 0.225, 20.5, 7.5],
			[9, 0.15, 14, 5],
			[7.5, 0.15, 12.5, 5]
		]
	}
};
/** CPFA para 5(da): the "applicable amount" for the AW ceiling, 2016 onwards. */
const AW_APPLICABLE_AMOUNT = 102000;

const monthIndex = (period: string) => {
	const [y, m] = period.split('-').map(Number) as [number, number];
	return y * 12 + (m - 1);
};

/**
 * CPFA para 5(a): the rate for "above 55/60/65/70" applies from the first day of the month following the month in which
 * the employee attains that age; a 29 February birth attains it from 1 March of that year (the same month rule).
 * Returns the age group 0 (≤55) … 4 (>70).
 */
export const ageGroup = (birth: string, period: string) => {
	const [by, bm] = birth.split('-').map(Number) as [number, number];
	const p = monthIndex(period);
	return [55, 60, 65, 70].filter((age) => p > (by + age) * 12 + (bm - 1)).length;
};

/**
 * SPR stage [CPFA para 1A ("ending on the last day of the first anniversary month"), para 5(db)/(ec)]:
 * year 1 through the first anniversary month, year 2 through the second anniversary month, then Table 1.
 */
export const sprYear = (granted: string, period: string) => {
	const m = monthIndex(period) - monthIndex(granted.slice(0, 7));
	return m <= 12 ? 1 : m <= 24 ? 2 : 3;
};

export const cpfTable = (e: Scenario['employee'], period: string): 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | null => {
	if (e.residency === 'FOREIGNER') return null; // CPFA para 5(dc): no contribution for a foreign employee
	if (e.residency === 'CITIZEN') return 'T1';
	const year = sprYear(e.spr_granted_on!, period);
	if (year === 3 || e.spr_rates === 'FULL') return 'T1';
	if (e.spr_rates === 'FULL_EMPLOYER') return year === 1 ? 'T4' : 'T5';
	return year === 1 ? 'T2' : 'T3';
};

/** One month's CPF on OW and chargeable AW [CPFA para 1; tables' steps 1–4; para 5(b),(c)]. */
export function cpf(table: 'T1' | 'T2' | 'T3' | 'T4' | 'T5', group: number, year: number, ow: number, aw: number) {
	const r = RATES[year]!;
	const cells = r[table];
	const [lowTotal, factor, totalRate, eeRate] = cells[Math.min(group, cells.length - 1)]!;
	const tw = ow + aw; // para 5(f) Total Wages
	if (tw <= 50) return { total: 0, employee: 0, employer: 0 };
	let total: number;
	let employee: number;
	if (tw <= 500) {
		total = pct(tw, lowTotal);
		employee = 0;
	} else if (tw <= 750) {
		total = pct(tw, lowTotal) + factor * (tw - 500);
		employee = factor * (tw - 500);
	} else {
		const owc = Math.min(ow, r.owc); // "subject to a maximum of x% of the Ordinary Wage Ceiling"
		total = pct(owc, totalRate) + pct(aw, totalRate);
		employee = pct(owc, eeRate) + pct(aw, eeRate);
	}
	const t = dollarHalfUp(total);
	const ee = Math.min(dollarDown(employee), t);
	return { total: t, employee: ee, employer: t - ee };
}

// ---------------------------------------------------------------------------------------------------------------
// SDL [SDLA s.3] and self-help funds [SHG]
// ---------------------------------------------------------------------------------------------------------------

/**
 * SDLA s.3(1)–(2): the greater of 0.25% of the month's wages and $2, not chargeable on wages above $4,500.
 * DEFAULT (law silent, SG-SDL13): each employee's levy half-up to the cent. No wages paid or payable → no levy (SG-SDL02).
 */
export const sdl = (wages: number) => (wages <= 0 ? 0 : cents(Math.max(2, pct(Math.min(wages, 4500), 0.25))));

type Rung = readonly [upTo: number, amount: number];
/** Monthly total wages "exceeding" the previous rung's limit up to and including `upTo` [SHG]. */
const FUNDS: Record<'CDAC' | 'ECF' | 'MBMF' | 'SINDA', readonly Rung[]> = {
	CDAC: [
		[2000, 0.5],
		[3500, 1],
		[5000, 1.5],
		[7500, 2],
		[Infinity, 3]
	],
	ECF: [
		[1000, 2],
		[1500, 4],
		[2500, 6],
		[4000, 9],
		[7000, 12],
		[10000, 16],
		[Infinity, 20]
	],
	MBMF: [
		[1000, 3],
		[2000, 4.5],
		[3000, 6.5],
		[4000, 15],
		[6000, 19.5],
		[8000, 22],
		[10000, 24],
		[Infinity, 26]
	],
	SINDA: [
		[1000, 1],
		[1500, 3],
		[2500, 5],
		[4500, 7],
		[7500, 9],
		[10000, 12],
		[15000, 18],
		[Infinity, 30]
	]
};
export const fundAmount = (fund: keyof typeof FUNDS, wages: number) =>
	FUNDS[fund].find(([upTo]) => wages <= upTo + EPS)![1];

/** SINDA Rules r.2 "Indian community" (and SG-SHG04(a) ICA RaceCode spellings). */
const INDIAN_COMMUNITY = new Set([
	'INDIAN',
	'BANGLADESHI',
	'BENGALI',
	'GOANESE',
	'GOAN',
	'GUJARATI',
	'MALAYALEE',
	'PAKISTANI',
	'PARSEE',
	'PUNJABI',
	'SIKH',
	'SINDHI',
	'SINHALESE',
	'SRI LANKAN',
	'CEYLONESE',
	'TAMIL',
	'TELEGU',
	'TELUGU',
	'OTHER INDIAN'
]);
/**
 * Which funds deduct [SHG; Rules r.2–4]:
 *  - MBMF: every Muslim employee, any residency (AMLA s.78; CPF Board "Foreign employees" included).
 *  - CDAC / ECF: Chinese / Eurasian descent, citizen or PR only (CDAC Rules r.2; ECF Rules r.2).
 *  - SINDA: Indian community by descent, no residency or pass limit (SINDA Rules r.2; SG-SHG04(b) owner reading).
 *  - The first NRIC race selects the fund; a recorded election adds the second race's fund (SG-SHG04(c) DEFAULT).
 *  - A Muslim Indian contributes MBMF and SINDA (SG-SHG01).
 *  - An opted-out fund deducts nothing (Rules r.4).
 */
export function funds(e: Scenario['employee']) {
	const local = e.residency !== 'FOREIGNER';
	const byRace = (race: string | undefined): 'CDAC' | 'ECF' | 'SINDA' | null => {
		if (race === undefined) return null;
		if (race === 'CHINESE') return local ? 'CDAC' : null;
		if (race === 'EURASIAN') return local ? 'ECF' : null;
		if (INDIAN_COMMUNITY.has(race)) return 'SINDA';
		return null;
	};
	const out = new Set<'CDAC' | 'ECF' | 'MBMF' | 'SINDA'>();
	if (e.religion === 'ISLAM') out.add('MBMF');
	const first = byRace(e.race);
	if (first) out.add(first);
	if (e.shg_dual_election) {
		const second = byRace(e.second_race);
		if (second) out.add(second);
	}
	for (const f of e.shg_opt_out ?? []) out.delete(f);
	return [...out];
}

// ---------------------------------------------------------------------------------------------------------------
// The payslip
// ---------------------------------------------------------------------------------------------------------------

export function computePayslip(s: Scenario): Payslip {
	const notes: string[] = [];
	const e = s.employment;
	const days = daysOfMonth(s.period);
	const holidays = new Set(weekdayHolidays(s.period));
	const employed = (d: string) => d >= e.start && (e.end === undefined || d <= e.end);
	const G = e.monthly_basic + (e.monthly_allowance ?? 0); // EA s.2 gross rate of pay
	const B = e.monthly_basic; // EA s.2 basic rate of pay
	const npl = new Set(s.month.no_pay_leave ?? []);
	const absent = new Set(s.month.absent ?? []);
	const covered = partFourCovers(e);

	// EA s.20A: working days required in the month (holidays on a working day count, MOM / SG-EA10) and days worked
	// (a paid holiday counts as worked; a holiday inside requested no-pay leave is unpaid, s.88(2)).
	const required = days.filter(isWorkingDay);
	const worked = required.filter((d) => employed(d) && !npl.has(d));
	const incomplete = worked.length < required.length || e.start > days[0]! || (e.end ?? '9999') < days.at(-1)!;
	let salary = incomplete ? cents((G * worked.length) / required.length) : G;
	if (incomplete) notes.push(`EA s.20A: ${G} × ${worked.length}/${required.length}`);

	// EA s.28(2): a monthly-rated employee's deduction for a day's absence is the gross rate of pay for one day's work
	// (s.107A Third Schedule), not the s.20A fraction. EA s.88(3): an unexcused absence on the working day immediately
	// before or after a holiday forfeits that holiday's pay (a gross day), once per holiday.
	const neighbour = (h: string, step: 1 | -1) => {
		const i = required.indexOf(h);
		return required[i + step];
	};
	const forfeited = [...holidays].filter(
		(h) =>
			employed(h) &&
			!npl.has(h) &&
			!(s.month.holiday_work ?? []).some((w) => w.date === h) &&
			[neighbour(h, -1), neighbour(h, 1)].some((d) => d !== undefined && absent.has(d))
	);
	const absenceDays = [...absent].filter((d) => employed(d)).length + forfeited.length;
	const absenceDeduction = cents(grossDay(G) * absenceDays);
	if (absenceDays > 0)
		notes.push(`EA s.28(2)/s.88(3): ${absenceDays} gross day(s) of ${grossDay(G)} deducted`);
	salary = cents(Math.max(0, salary - absenceDeduction));

	// Overtime [EA s.38(4) Part 4 only, s.35]: 1.5 × the Fourth Schedule hourly basic for each hour beyond the normal day.
	// DEFAULT (law silent, SG-EA22 owner rule): overtime starts after the contract's normal day. Amount half-up to the cent (SG-EA46-R01).
	let overtime = 0;
	const otHours = (s.month.overtime ?? []).reduce((a, o) => a + o.hours, 0);
	if (covered && otHours > 0) {
		if (e.part_time) {
			// PT reg.5(1)(a): beyond own normal day up to a similar full-time day (8 h when none, reg.2) at 1×, beyond it at 1.5×,
			// "each hour or part thereof". reg.5(2): s.38(6) (Fourth Schedule) displaced; the contract's hourly basic applies.
			const room = 8 - e.daily_hours;
			for (const o of s.month.overtime!) {
				const single = Math.ceil(Math.min(o.hours, room) - EPS);
				const premium = Math.ceil(Math.max(0, o.hours - room) - EPS);
				overtime += e.part_time.hourly_basic * (single + 1.5 * premium);
			}
			overtime = cents(overtime);
		} else overtime = cents(1.5 * hourlyBasic(B) * otHours);
	}
	if (!covered && otHours > 0) notes.push('EA s.35: outside Part 4, no statutory overtime pay');

	// Rest-day work [EA s.37(2)–(3), Part 4]; basic day per Third Schedule, hourly basic per s.37(3A)(b); normal hours 8 (s.37(3A)(a)).
	let restDay = 0;
	if (covered)
		for (const w of s.month.rest_day_work ?? []) {
			const normal = e.daily_hours;
			const byEmployer = w.requested_by === 'EMPLOYER';
			const daysPaid = w.hours <= normal / 2 ? (byEmployer ? 1 : 0.5) : byEmployer ? 2 : 1;
			const excess = w.hours > normal ? Math.ceil(w.hours - normal - EPS) : 0; // "each hour or part thereof"
			restDay += cents(basicDay(B) * daysPaid + 1.5 * hourlyBasic(B) * excess);
		}

	// Holiday work [EA s.88(4)]: an extra day's salary at the basic rate on top of the day's gross pay (already inside the
	// monthly salary); hours beyond the normal day are overtime under s.38(4) at 1.5 × hourly basic (Part 4).
	let holidayWork = 0;
	for (const w of s.month.holiday_work ?? []) {
		holidayWork += cents(
			basicDay(B) + (covered ? 1.5 * hourlyBasic(B) * Math.max(0, w.hours - e.daily_hours) : 0)
		);
	}

	const bonus = s.month.bonus ?? 0;
	const leaveOnExit = s.month.leave_days_paid_on_exit ? leavePay(G, s.month.leave_days_paid_on_exit) : 0;
	const silon =
		s.month.notice_in_lieu_weeks || s.month.notice_in_lieu_days
			? noticePayInLieu(G, s.month.notice_in_lieu_weeks ?? 0, s.month.notice_in_lieu_days ?? 0)
			: 0;

	// CPF classes [CPFA para 5(d),(e)]: OW = remuneration wholly for this month's employment; AW = bonus and leave pay on
	// exit (SG-CPF04, SG-AWS01). Salary in lieu of notice is not wages for CPF (CPF Board list; SG-CPF04, SG-EA05).
	const ow = cents(salary + overtime + restDay + holidayWork);
	const aw = cents(bonus + leaveOnExit);
	const gross = cents(ow + aw + silon);

	const charges: Charge[] = [];
	const year = Number(s.period.slice(0, 4));
	const table = cpfTable(s.employee, s.period);
	if (table) {
		// AW ceiling [CPFA para 2(1)–(4), 4A(d)]: 102,000 less this employer's OW for the year (each month capped at the OWC)
		// less AW already payable. Recomputed at the last month of employment and at December on actual OW; otherwise on
		// an estimate. DEFAULT (law silent on the estimate method, para 2(3) "may"): the month's capped OW carried to December.
		const owc = RATES[year]!.owc;
		const opening = s.cpf_opening ?? { ordinary_wages_ytd: 0, additional_wages_ytd: 0 };
		const owThis = Math.min(ow, owc);
		const m = Number(s.period.slice(5, 7));
		const last = m === 12 || (e.end !== undefined && e.end <= days.at(-1)!);
		const yearOw = opening.ordinary_wages_ytd + owThis + (last ? 0 : owThis * (12 - m));
		const room = Math.max(0, AW_APPLICABLE_AMOUNT - yearOw - opening.additional_wages_ytd);
		const awc = Math.min(aw, room);
		if (awc < aw) notes.push(`CPFA para 2: AW ${aw} capped at ${awc}`);
		const c = cpf(table, ageGroup(s.employee.birth_date, s.period), year, ow, awc);
		charges.push({ code: 'CPF', employee: c.employee, employer: c.employer, base: cents(Math.min(ow, owc) + awc) });
		notes.push(`CPF ${table} group ${ageGroup(s.employee.birth_date, s.period)} rates ${year}`);
	}
	// SDL on all money remuneration including bonus and salary in lieu of notice (SDLA s.2–3; SG-SDL02, SG-EA05).
	charges.push({ code: 'SDL', employee: 0, employer: sdl(gross), base: cents(Math.min(gross, 4500)) });
	// Funds on the month's total wages (OW + AW, uncapped) [Rules Schedule Part 2]; nothing without wages (SG-EA10 D1).
	const fundWages = cents(ow + aw);
	if (fundWages > 0)
		for (const f of funds(s.employee))
			charges.push({ code: f, employee: fundAmount(f, fundWages), employer: 0, base: fundWages });

	const totalDeductions = cents(charges.reduce((a, c) => a + c.employee, 0));
	const employerCost = cents(gross + charges.reduce((a, c) => a + c.employer, 0));
	const net = cents(gross - totalDeductions);
	const lines: Record<string, number> = { gross, net, total_deductions: totalDeductions, employer_cost: employerCost };
	for (const c of charges) {
		if (c.employee !== 0) lines[`${c.code}.employee`] = c.employee;
		if (c.employer !== 0) lines[`${c.code}.employer`] = c.employer;
	}
	return {
		gross,
		net,
		total_deductions: totalDeductions,
		employer_cost: employerCost,
		components: {
			salary,
			absence_deduction: absenceDeduction,
			overtime,
			rest_day: restDay,
			holiday_work: holidayWork,
			bonus,
			leave_on_exit: leaveOnExit,
			salary_in_lieu_of_notice: silon
		},
		charges,
		lines,
		notes
	};
}
