/**
 * Independent MY payslip oracle: every figure below is computed from the law, not from the engine.
 *
 * Sources (each read 2026-09-30; the rule that uses one cites it again beside the code):
 *  [EPF]   Employees Provident Fund Act 1991 (Act 452), AGC online text as at 1 July 2022, s.2 "wages", s.43(1),(1A),(7),
 *          First Schedule para (13), Third Schedule Parts A, C, E (the table, incl. the bonus notes and the over-RM20,000
 *          paragraph) — https://www.kwsp.gov.my/en/others/resource-centre/references/epf-act-1991 (AGC text);
 *          Act A1760 (2025) s.10: Parts B and D deleted, Part F inserted —
 *          https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/2844030_BI/Act%20A1760-%20EMPLOYEES%20PROVIDED%20FUND%20(AMENDMENT)%20ACT%202025.pdf
 *  [SOCSO] Employees' Social Security Act 1969 (Act 4) s.2(24), Third Schedule, as substituted by Act A1788 s.17 (First
 *          Phase Parts I and IV, from 1 June 2026, P.U.(B)196/2026) —
 *          https://www.perkeso.gov.my/images/akta/ACT%204/Act_A1788_-_EMPLOYEES_SOCIAL_SECURITY_AMENDMENT_ACT_2026.pdf;
 *          pre-June 2026 Third Schedule, AGC text as at 1 October 2024 (same employer/employee cells) —
 *          https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf;
 *          First Schedule para (12) as amended by P.U.(A)180/2024 (Invalidity excluded: first liable at 55+, aged 60+).
 *  [EIS]   Employment Insurance System Act 2017 (Act 800) s.2 "wages", First Schedule paras 8–10, Second Schedule (RM6,000
 *          ceiling from October 2024) — https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf
 *  [SKBBK] A1788 Third Schedule Part I/IV column (4)(B) (non-employment injury, employee only), First Phase
 *          1 June 2026 – 31 May 2028; PERKESO LINDUNG 24 Jam FAQ 13 July 2026 (no age limit; foreigners mandatory; local
 *          workers participate unless released) —
 *          https://www.perkeso.gov.my/images/lindung/lindung-24-jam/130726-FAQ_LINDUNG_24_JAM.pdf
 *  [PCB]   LHDN Specification for MTD Calculations Using Computerised Calculation 2026, D(a), D.1–D.2 and Table 1, E(1)–(13)
 *          — https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf;
 *          ITA 1967 Schedule 6 para 15(1)(b) (RM10,000 per completed year) —
 *          https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3345910_BI/Act%2053%20(Online%202026).pdf
 *  [HRD]   Pembangunan Sumber Manusia Berhad Act 2001 (Act 612) reprint 2017 s.2 "employee" (a citizen) and "wages",
 *          s.14(1) 1%, s.14(2)/15 0.5% — https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20612%20-%20Reprint%202017.pdf;
 *          P.U.(A)13/2026 (education MSIC exemption, 2026 contribution months).
 *  [EA]    Employment Act 1955 (Act 265), reprint as at 1 August 2023, ss.2 "wages", 12(2), 13(1), 14(1)(a), 18A, 60(3)(b)–(c),
 *          60A(3), 60D(3)(a)(i),(aa), 60E(1),(3A), 60I(1)(b),(1A) —
 *          https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf
 *  [TLB]   Employment (Termination and Lay-Off Benefits) Regulations 1980, regs.3, 4, 6 —
 *          https://jtksm.mohr.gov.my/sites/default/files/2023-03/8.%20EMPLOYMENT%20%28TERMINATION%20%26%20LAY%20OFF%20BENEFITS%29%20REGULATIONS%201980_0.pdf
 *  [MWO]   Minimum Wages Order 2024 P.U.(A)376 paras 2, 5 (RM1,700 monthly, RM8.72 hourly from 1 August 2025) —
 *          https://gajiminimum.mohr.gov.my/wp-content/uploads/PUA%20376.pdf
 *
 * Where the text leaves a choice open the oracle takes one consistent reading, says so beside the code, and lists the
 * affected line keys in `uncertain` so a mismatch there is read as a question for the law, not as an engine defect.
 */

export type Citizenship = 'CITIZEN' | 'PERMANENT_RESIDENT' | 'FOREIGNER';
export type ExitCause =
	| 'RESIGNATION'
	| 'EMPLOYER_TERMINATION'
	| 'RETRENCHMENT'
	| 'MISCONDUCT_DISMISSAL'
	| 'CONTRACTUAL_RETIREMENT'
	| 'DEATH';
export type HrdClass = 'COMPULSORY' | 'OPTIONAL' | 'NOT_REGISTERED' | 'EDUCATION_EXEMPT';

export type Scenario = {
	id: string;
	profile: 'MY';
	/** tracker row ids with the branch exercised, `ROW:branch` */
	rows: string[];
	description: string;
	/** run period, YYYY-MM */
	period: string;
	employer: { hrd: HrdClass };
	employee: {
		birthDate: string;
		citizenship: Citizenship;
		/** '' = not recorded (LHDN D(a): not known to be resident) */
		taxResidency: 'RESIDENT' | 'NON_RESIDENT' | '';
		/** PCB category (spec D.1): 1 single, 2 spouse not working, 3 spouse working / single parent */
		taxCategory: 1 | 2 | 3;
		children: number;
		/** age at the first SOCSO contribution of the person's life; omitted = before 55 */
		socsoFirstLiableAge?: number;
		/** false = no EIS contribution was ever payable before 57 (Act 800 First Schedule para 9) */
		eisPaidBefore57: boolean;
	};
	employment: {
		hireDate: string;
		/** last day of employment, inclusive */
		exitDate?: string;
		exitCause?: ExitCause;
		/** EA s.12: true = the statutory notice was given and fully served before exitDate */
		noticeServed?: boolean;
		/** foreign worker's fixed contract length in days (LHDN D(a) note); omitted = open-ended */
		contractDays?: number;
		basis: 'MONTHLY' | 'HOURLY';
		monthlyBasic?: number;
		hourlyRate?: number;
		/** contractual daily normal hours (EA s.60A(3)(c)) */
		normalHours: number;
		/** fixed monthly cash allowance (EA/EPF/Act 4/Act 612 wages) */
		fixedAllowance?: number;
		partTime?: boolean;
	};
	inputs: {
		unpaidLeaveDays?: number;
		/** hourly basis: hours worked in the period */
		hoursWorked?: number;
		/** hours beyond normal hours on normal working days */
		overtimeHours?: number;
		/** hours worked on one rest day (the whole day's hours) */
		restDayHours?: number;
		restDayDate?: string;
		/** hours worked on one paid gazetted holiday (the whole day's hours) */
		holidayHours?: number;
		holidayDate?: string;
		overtimeDate?: string;
		annualBonus?: number;
		/** official-duty petrol/travel/toll allowance (LHDN E(9)(i)) */
		travelOfficial?: number;
		/** days of annual leave already taken in the terminating year */
		annualLeaveTakenThisYear?: number;
		/** zakat deducted through payroll this month */
		zakat?: number;
	};
};

export type Line = { code: string; employee: number; employer: number; base: number };
export type Earning = { code: string; amount: number };
export type Payslip = {
	earnings: Earning[];
	lines: Line[];
	gross: number;
	totalDeductions: number;
	net: number;
	employerCost: number;
	/** probe line keys whose figure rests on a recorded reading of silent or ambiguous law */
	uncertain: string[];
	notes: string[];
};

// ---------- arithmetic (float-safe on money) ----------
const EPS = 1e-7;
/** to the sen, half up */
const sen = (x: number) => Math.round(x * 100 + (x >= 0 ? EPS : -EPS)) / 100;
/** EPF Third Schedule: "rounded to the next ringgit" */
const nextRinggit = (x: number) => Math.ceil(x - EPS);
/** LHDN E(1): two decimals, later figures omitted */
const trunc2 = (x: number) => Math.floor(x * 100 + EPS * 100) / 100;
/** LHDN E(2): up to the next five sen */
const up5 = (x: number) => Math.ceil(Math.round(x * 100) / 5 - EPS) * 5 / 100;

// ---------- dates ----------
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (t: Date) => t.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(d(s).getTime() + n * 86400000));
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addMonths = (s: string, n: number) => {
	const [y, m, day] = s.split('-').map(Number) as [number, number, number];
	const t = new Date(Date.UTC(y, m - 1 + n, 1));
	const dim = daysInMonth(t.getUTCFullYear(), t.getUTCMonth() + 1);
	return iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, dim))));
};
const daysBetween = (a: string, b: string) => Math.round((d(b).getTime() - d(a).getTime()) / 86400000);
/** whole months from `from` to `endExclusive` and the leftover days */
function monthsAndDays(from: string, endExclusive: string) {
	let m = 0;
	while (addMonths(from, m + 1) <= endExclusive) m++;
	const anchor = addMonths(from, m);
	return { months: m, days: daysBetween(anchor, endExclusive), anchor };
}
/** EA s.2 "year of age": a year from the date of birth — age on a day */
export function ageOn(birth: string, day: string) {
	const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
	const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
	return y - by - (m < bm || (m === bm && dd < bd) ? 1 : 0);
}

// ---------- EPF (Act 452 Third Schedule) ----------
type EpfPart = 'A' | 'C' | 'E' | 'F' | null;
/** Part selection: Third Schedule Part A para 1 (citizen/PR under 60), Part C para 1 (PR at 60+), Part E para 1 (citizen
 *  at 60+), Part F (A1760 s.10: any other non-citizen), First Schedule para (13) (no liability at 75+). */
function epfPart(c: Citizenship, age: number): EpfPart {
	if (age >= 75) return null;
	if (c === 'FOREIGNER') return 'F';
	if (age < 60) return 'A';
	return c === 'CITIZEN' ? 'E' : 'C';
}
const EPF_RATES = {
	A: { erLow: 0.13, erHigh: 0.12, ee: 0.11 },
	C: { erLow: 0.065, erHigh: 0.06, ee: 0.055 },
	E: { erLow: 0.04, erHigh: 0.04, ee: 0 }
} as const;
/** The table's band: RM0.01–10 nil; RM10.01–20; RM20 steps to RM5,000; RM100 steps to RM20,000. Every Part A/C/E cell of the
 *  printed Third Schedule equals the Part's rate × the band's upper limit, rounded up to the ringgit (checked cell by
 *  cell against the AGC text, 401 rows per Part). */
function epfBandUpper(w: number) {
	if (w <= 10) return 0;
	if (w <= 5000) return Math.ceil(w / 20 - EPS) * 20;
	return Math.ceil(w / 100 - EPS) * 100;
}
/**
 * EPF shares on `wages` (Act 452 s.2 wages for the month), `nonBonus` = the same wages without bonus (for the bonus note).
 * Over RM20,000 (Parts A/C/E) and Part F: the Act fixes each share as a percentage and rounds "the total contribution
 * which includes cents" to the next ringgit. Reading (tracker MY-EPF-01, KWSP Part F example): the employee pays the
 * exact percentage to the sen, the employer the rest of the rounded total.
 */
function epf(part: EpfPart, wages: number, nonBonus: number): { ee: number; er: number; uncertain: boolean } {
	if (part === null || wages <= 0) return { ee: 0, er: 0, uncertain: false };
	if (part === 'F') {
		const ee = sen(0.02 * wages);
		return { ee, er: sen(nextRinggit(0.04 * wages) - ee), uncertain: true };
	}
	const r = EPF_RATES[part];
	if (wages > 20000) {
		const ee = sen(r.ee * wages);
		return { ee, er: sen(nextRinggit(r.ee * wages + r.erHigh * wages) - ee), uncertain: true };
	}
	const U = epfBandUpper(wages);
	if (U === 0) return { ee: 0, er: 0, uncertain: false };
	const ee = nextRinggit(r.ee * U);
	// Part A/C note under the RM5,000 row: bonus lifting a ≤RM5,000 month above RM5,000 → employer at the low rate on the
	// month's wages (not the band); total rounded to the next ringgit (ee is already whole).
	if (nonBonus <= 5000 && wages > 5000 && part !== 'E') return { ee, er: nextRinggit(r.erLow * wages), uncertain: false };
	return { ee, er: nextRinggit((U <= 5000 ? r.erLow : r.erHigh) * U), uncertain: false };
}

// ---------- SOCSO / SKBBK (Act 4 Third Schedule as substituted by A1788) ----------
// Part I First Phase columns, rows 1–65: (3)(A) employer Invalidity = (4)(A) employee Invalidity, (3)(B) employer
// Employment Injury, (4)(B) employee Non-employment Injury. Part IV (second category) repeats (3)(B) and (4)(B).
const INVALIDITY = [0.1, 0.2, 0.3, 0.4, 0.6, 0.85, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25, 4.75, 5.25, 5.75, 6.25, 6.75, 7.25, 7.75, 8.25, 8.75, 9.25, 9.75, 10.25, 10.75, 11.25, 11.75, 12.25, 12.75, 13.25, 13.75, 14.25, 14.75, 15.25, 15.75, 16.25, 16.75, 17.25, 17.75, 18.25, 18.75, 19.25, 19.75, 20.25, 20.75, 21.25, 21.75, 22.25, 22.75, 23.25, 23.75, 24.25, 24.75, 25.25, 25.75, 26.25, 26.75, 27.25, 27.75, 28.25, 28.75, 29.25, 29.75, 29.75];
const INJURY = [0.3, 0.5, 0.8, 1.1, 1.5, 2.1, 3.1, 4.4, 5.6, 6.9, 8.1, 9.4, 10.6, 11.9, 13.1, 14.4, 15.6, 16.9, 18.1, 19.4, 20.6, 21.9, 23.1, 24.4, 25.6, 26.9, 28.1, 29.4, 30.6, 31.9, 33.1, 34.4, 35.6, 36.9, 38.1, 39.4, 40.6, 41.9, 43.1, 44.4, 45.6, 46.9, 48.1, 49.4, 50.6, 51.9, 53.1, 54.4, 55.6, 56.9, 58.1, 59.4, 60.6, 61.9, 63.1, 64.4, 65.6, 66.9, 68.1, 69.4, 70.6, 71.9, 73.1, 74.4, 74.4];
const NON_EMPLOYMENT = [0.2, 0.3, 0.5, 0.65, 0.9, 1.25, 1.85, 2.65, 3.35, 4.15, 4.85, 5.65, 6.35, 7.15, 7.85, 8.65, 9.35, 10.15, 10.85, 11.65, 12.35, 13.15, 13.85, 14.65, 15.35, 16.15, 16.85, 17.65, 18.35, 19.15, 19.85, 20.65, 21.35, 22.15, 22.85, 23.65, 24.35, 25.15, 25.85, 26.65, 27.35, 28.15, 28.85, 29.65, 30.35, 31.15, 31.85, 32.65, 33.35, 34.15, 34.85, 35.65, 36.35, 37.15, 37.85, 38.65, 39.35, 40.15, 40.85, 41.65, 42.35, 43.15, 43.85, 44.65, 44.65];
/** Row of the Act 4 / Act 800 wage table: up to 30, 30–50, 50–70, 70–100, 100–140, 140–200, 200–300, then RM100 rows to
 *  RM6,000 (row 64), row 65 above RM6,000. Returns a 0-based index, or -1 for no wages. */
function ssRow(w: number) {
	if (w <= 0) return -1;
	const edges = [30, 50, 70, 100, 140, 200, 300];
	const i = edges.findIndex((e) => w <= e + EPS);
	if (i >= 0) return i;
	if (w > 6000 + EPS) return 64;
	return 6 + Math.ceil((w - 300) / 100 - EPS);
}
/** Act 800 Second Schedule rows 1–65 (PERKESO table from 1 October 2024): rows 1–6 as printed, rows 7–64 = 0.2% of the
 *  row's midpoint (every printed cell), row 65 = row 64. */
const EIS_HEAD = [0.05, 0.1, 0.15, 0.2, 0.25, 0.35];
const eisCell = (i: number) => (i < 6 ? EIS_HEAD[i]! : sen(0.002 * (200 + (Math.min(i, 63) - 6) * 100 + 50)));

// ---------- PCB (LHDN 2026 computerised specification) ----------
const TABLE_1 = [
	// [M, R, B cat 1&3, B cat 2]
	[2000000, 0.3, 528400, 528400],
	[600000, 0.28, 136400, 136400],
	[400000, 0.26, 84400, 84400],
	[100000, 0.25, 9400, 9400],
	[70000, 0.19, 3700, 3700],
	[50000, 0.11, 1500, 1500],
	[35000, 0.06, 600, 600],
	[20000, 0.03, -250, -650],
	[5000, 0.01, -400, -800]
] as const;
/** (P − M) × R + B, P below RM5,001 taxes nothing (Table 1 starts at 5,001). */
function taxOn(P: number, category: 1 | 2 | 3) {
	const row = TABLE_1.find(([M]) => P > M + EPS);
	if (!row) return 0;
	const [M, R, B13, B2] = row;
	return (P - M) * R + (category === 2 ? B2 : B13);
}
const EPF_RELIEF = 4000; // D.2(i)(d): EPF/approved scheme relief, RM4,000 a year
const D_INDIVIDUAL = 9000; // D.2(i)(a)
const S_SPOUSE = 4000; // D.2(i)(b), category 2 only
const Q_CHILD = 2000; // D.2(i)(c) per qualifying child

type PcbIn = {
	month: number;
	category: 1 | 2 | 3;
	children: number;
	Y1: number;
	K1raw: number;
	Yt: number;
	Ktraw: number;
	zakat: number;
};
/** Resident MTD, D.1 normal and D.2 additional-remuneration formulas, with no earlier month in the year (Y = K = X = Z = 0:
 *  the scenario's employer has no earlier run this year and no TP3). Y2 = Y1 ("estimated remuneration as Y1"). */
function residentMtd(p: PcbIn) {
	const n = 12 - p.month;
	const reliefs = D_INDIVIDUAL + (p.category === 2 ? S_SPOUSE : 0) + (p.category === 1 ? 0 : Q_CHILD * p.children);
	const K1 = Math.min(p.K1raw, EPF_RELIEF);
	const k2 = (Kt: number) => (n === 0 ? 0 : Math.max(0, Math.min(trunc2((EPF_RELIEF - (K1 + Kt)) / n), K1)));
	// Step 1 — normal remuneration only
	const P1 = trunc2(p.Y1 - K1 + (p.Y1 - k2(0)) * n - reliefs);
	const C = up5(trunc2(taxOn(P1, p.category) / (n + 1))); // E(1)–(2); X = Z = 0
	const normal = C < 10 ? 0 : C; // E(3)
	const netNormal = Math.max(0, sen(normal - p.zakat)); // D.1 net MTD; zakat above MTD carries forward (E(5))
	if (p.Yt <= 0) return netNormal;
	// Steps 2–5 — additional remuneration
	const yearNormal = C * (n + 1); // Step 1[E], X = 0
	const Kt = Math.max(0, Math.min(p.Ktraw, EPF_RELIEF - K1));
	const P2 = trunc2(p.Y1 - K1 + (p.Y1 - k2(Kt)) * n + (p.Yt - Kt) - reliefs);
	const extra = up5(Math.max(0, trunc2(trunc2(taxOn(P2, p.category)) - yearNormal)));
	return sen(netNormal + (extra < 10 ? 0 : extra)); // E(4)c
}

// ---------- the payslip ----------
export function computePayslip(s: Scenario): Payslip {
	const [y, m] = s.period.split('-').map(Number) as [number, number];
	const first = `${s.period}-01`;
	const dim = daysInMonth(y, m);
	const last = `${s.period}-${String(dim).padStart(2, '0')}`;
	const e = s.employment;
	const x = s.inputs;
	const who = s.employee;
	const age = ageOn(who.birthDate, first);
	const uncertain: string[] = [];
	const notes: string[] = [];
	const earnings: Earning[] = [];
	const earn = (code: string, amount: number) => amount !== 0 && earnings.push({ code, amount: sen(amount) });

	const start = e.hireDate > first ? e.hireDate : first;
	const end = e.exitDate && e.exitDate < last ? e.exitDate : last;
	const exitsNow = e.exitDate !== undefined && e.exitDate >= first && e.exitDate <= last;
	const allowance = e.fixedAllowance ?? 0;

	// EA s.60I(1A): monthly ORP = monthly rate ÷ 26; s.60I(1)(b) hourly = ORP ÷ normal hours. s.2 wages include the fixed
	// cash allowance. Hourly-rated: s.60I(1C) preceding period's wages ÷ days; scenarios keep hourly workers off rest-day,
	// holiday and exit awards, so only the hourly rate itself is used.
	const monthlyRate = (e.monthlyBasic ?? 0) + allowance;
	const orp = monthlyRate / 26;
	const hourly = e.basis === 'HOURLY' ? e.hourlyRate! : orp / e.normalHours;

	// ---- basic pay, EA s.18A (calendar days of the wage period, tracker MY-EA11 default) ----
	let basic = 0;
	let topUp = 0;
	if (e.basis === 'MONTHLY') {
		const eligible = daysBetween(start, end) + 1 - (x.unpaidLeaveDays ?? 0);
		const factor = eligible / dim;
		basic = sen(e.monthlyBasic! * factor);
		if (allowance) earn('FIXED_ALLOWANCE', allowance * factor);
		// MWO 2024 para 5(1): RM1,700 monthly basic (full-month scenarios only)
		if (factor === 1 && e.monthlyBasic! < 1700) topUp = sen(1700 - e.monthlyBasic!);
	} else {
		basic = sen(e.hourlyRate! * x.hoursWorked!);
		// MWO 2024 para 5(1): RM8.72 an hour
		if (e.hourlyRate! < 8.72) topUp = sen((8.72 - e.hourlyRate!) * x.hoursWorked!);
	}
	earn('BASIC', basic);
	earn('MINIMUM_WAGE_TOP_UP', topUp);

	// ---- work bands (EA ss.60, 60A(3), 60D(3)); each line to the sen (law silent on rounding) ----
	const normal = e.normalHours;
	const ot = sen((x.overtimeHours ?? 0) * 1.5 * hourly); // s.60A(3)(a)
	earn('OVERTIME', ot);
	let restDay = 0;
	let restOt = 0;
	if (x.restDayHours) {
		// s.60(3)(b) monthly/weekly rate: ≤ half the normal hours → half ORP; ≤ normal hours → one ORP; s.60(3)(c) beyond →
		// 2 × hourly for each hour beyond the normal hours.
		const h = x.restDayHours;
		restDay = sen(h <= normal / 2 ? orp / 2 : orp);
		restOt = sen(Math.max(0, h - normal) * 2 * hourly);
	}
	earn('REST_DAY_WORK', restDay);
	earn('REST_DAY_OVERTIME', restOt);
	let holiday = 0;
	let holidayOt = 0;
	if (x.holidayHours) {
		// s.60D(3)(a)(i): two days' wages at ORP regardless of hours, in addition to the (already paid) holiday pay;
		// s.60D(3)(aa): 3 × hourly for the hours beyond the normal hours.
		holiday = sen(2 * orp);
		holidayOt = sen(Math.max(0, x.holidayHours - normal) * 3 * hourly);
	}
	earn('HOLIDAY_WORK', holiday);
	earn('HOLIDAY_OVERTIME', holidayOt);
	earn('BONUS', x.annualBonus ?? 0);
	earn('TRAVEL_OFFICIAL', x.travelOfficial ?? 0);

	// ---- exit awards ----
	let encashment = 0;
	let indemnity = 0;
	let tb = 0;
	let completedServiceYears = 0;
	if (exitsNow) {
		const endEx = addDays(e.exitDate!, 1);
		const service = monthsAndDays(e.hireDate, endEx);
		completedServiceYears = Math.floor(service.months / 12);
		// s.60E(1): 8 / 12 / 16 days by service (<2, 2–<5, ≥5 years); in the terminating year, in direct proportion to
		// completed months of service that year; fraction < ½ disregarded, ≥ ½ one day. s.60E(3A): paid at ORP on
		// termination by either party, except dismissal under s.14(1)(a). Death is not a termination "by either party" —
		// reading: no s.60E(3A) payment in the death month (flagged).
		if (e.exitCause !== 'MISCONDUCT_DISMISSAL' && e.exitCause !== 'DEATH' && e.basis === 'MONTHLY') {
			const tier = service.months < 24 ? 8 : service.months < 60 ? 12 : 16;
			const yearStart = e.hireDate > `${y}-01-01` ? e.hireDate : `${y}-01-01`;
			const months = monthsAndDays(yearStart, endEx).months;
			const raw = (tier * months) / 12;
			const entitled = Math.floor(raw + EPS) + (raw - Math.floor(raw + EPS) >= 0.5 - EPS ? 1 : 0);
			const untaken = Math.max(0, entitled - (x.annualLeaveTakenThisYear ?? 0));
			encashment = sen(untaken * orp);
			earn('ENCASHMENT', encashment);
		}
		const byEmployer = e.exitCause === 'EMPLOYER_TERMINATION' || e.exitCause === 'RETRENCHMENT';
		// s.12(2): 4 / 6 / 8 weeks by service on the notice day (<2, 2–<5, ≥5 years); s.13(1): indemnity = the wages that
		// would have accrued during the notice term. Valuation reading (tracker MY-EA05): each day after the exit at
		// monthly rate ÷ days of its calendar month, summed, rounded once.
		if (byEmployer && e.noticeServed === false && e.basis === 'MONTHLY') {
			const weeks = service.months < 24 ? 4 : service.months < 60 ? 6 : 8;
			let sum = 0;
			for (let i = 1; i <= weeks * 7; i++) {
				const day = addDays(e.exitDate!, i);
				const [yy, mm] = day.split('-').map(Number) as [number, number];
				sum += monthlyRate / daysInMonth(yy, mm);
			}
			indemnity = sen(sum);
			earn('NOTICE_INDEMNITY', indemnity);
			uncertain.push('NOTICE_INDEMNITY');
		}
		// TLB reg.3(1): ≥ 12 months' continuous service; reg.4(1): not on contractual retirement, misconduct after inquiry,
		// or voluntary resignation; reg.6(1): 10 / 15 / 20 days' wages per year (<2, 2–<5, ≥5 years), pro rata to the nearest
		// month; reg.6(2) a day's wages = 12 completed months' wages ÷ 365 (JTKSM formula, tracker MY-SR10).
		if (byEmployer && service.months >= 12 && e.basis === 'MONTHLY') {
			const dim2 = daysInMonth(Number(service.anchor.slice(0, 4)), Number(service.anchor.slice(5, 7)));
			const nearestMonths = service.months + (service.days * 2 >= dim2 ? 1 : 0);
			const perYear = service.months < 24 ? 10 : service.months < 60 ? 15 : 20;
			tb = sen(((perYear * nearestMonths) / 12) * ((12 * monthlyRate) / 365));
			earn('TERMINATION_BENEFIT', tb);
		}
	}

	if (exitsNow && e.exitCause === 'DEATH') uncertain.push('ENCASHMENT', 'gross', 'net');
	const gross = sen(earnings.reduce((a, l) => a + l.amount, 0));
	const lines: Line[] = [];
	const deathMonth = exitsNow && e.exitCause === 'DEATH';

	// ---- EPF wages (Act 452 s.2): all money remuneration incl. bonus/allowance; not overtime, gratuity, termination benefits,
	// travelling allowance. Rest-day/holiday day awards are not "overtime" (hours beyond the normal hours, EA s.60A(3)(b)) —
	// reading, tracker MY-WAGEBASE-01. Notice indemnity read as a termination benefit (s.2(e)) — reading.
	const epfNormal = basic + topUp + sen(earnings.find((l) => l.code === 'FIXED_ALLOWANCE')?.amount ?? 0);
	const epfWages = sen(epfNormal + restDay + holiday + (x.annualBonus ?? 0) + encashment);
	const epfNonBonus = sen(epfWages - (x.annualBonus ?? 0));
	const part = deathMonth ? null : epfPart(who.citizenship, age); // s.43(7): nothing due for the death month
	const epfCode = who.citizenship === 'CITIZEN' ? 'EPF' : who.citizenship === 'PERMANENT_RESIDENT' ? 'EPF_PR' : 'EPF_NON_CITIZEN';
	const epfAll = epf(part, epfWages, epfNonBonus);
	if (epfAll.uncertain) uncertain.push(`${epfCode}.employee`, `${epfCode}.employer`);
	if (indemnity) uncertain.push(`${epfCode}.employee`, `${epfCode}.employer`);
	if (restDay || holiday) uncertain.push(`${epfCode}.employee`, `${epfCode}.employer`);
	lines.push({ code: epfCode, employee: epfAll.ee, employer: epfAll.er, base: part === null ? 0 : epfWages });

	// ---- SOCSO / EIS / SKBBK wages (Act 4 s.2(24), Act 800 s.2): include overtime, leave and holiday pay; exclude travelling
	// allowance, gratuity on discharge, annual bonus. Termination benefit and indemnity read as payments on discharge —
	// reading (tracker MY-SR10), flagged.
	const ssWages = sen(gross - (x.annualBonus ?? 0) - (x.travelOfficial ?? 0) - tb - indemnity);
	if (tb || indemnity) uncertain.push('SOCSO.employee', 'SOCSO.employer', 'EIS.employee', 'EIS.employer', 'SKBBK.employee');
	const row = ssRow(ssWages);
	// First Schedule para (12) (P.U.(A)180/2024): no Invalidity cover when first liable at 55+ or aged 60+ → second category
	const secondCategory = age >= 60 || (who.socsoFirstLiableAge ?? 0) >= 55;
	if (row >= 0)
		lines.push({
			code: 'SOCSO',
			employee: secondCategory ? 0 : INVALIDITY[row]!,
			employer: sen(INJURY[row]! + (secondCategory ? 0 : INVALIDITY[row]!)),
			base: ssWages
		});
	// Act 800 First Schedule: para 8 (under 18, 60+), para 9 (first liable at 57+), para 10 (foreign employee; a PR with
	// a para 5(3)(b) identity card is covered)
	const eisExcluded = age < 18 || age >= 60 || (age >= 57 && !who.eisPaidBefore57) || who.citizenship === 'FOREIGNER';
	if (row >= 0 && !eisExcluded) lines.push({ code: 'EIS', employee: eisCell(row), employer: eisCell(row), base: ssWages });
	// A1788 Third Schedule First Phase from the June 2026 contribution month; employee only; no age limit
	if (row >= 0 && s.period >= '2026-06')
		lines.push({ code: 'SKBBK', employee: NON_EMPLOYMENT[row]!, employer: 0, base: ssWages });

	// ---- HRD levy (Act 612): citizens only; wages = basic salary, fixed cash allowances, leave pay, arrears; not bonus,
	// overtime, travelling allowance or gratuity on discharge. s.14(1) 1% (compulsory), s.14(2) 0.5% (optional registrant).
	// P.U.(A)13/2026: education MSIC employers exempt for 2026. Part-time citizens are employees under s.2 and no s.19 order
	// excluding them was located (tracker MY-HRD12 SOURCE-BLOCKED) — levied, flagged. Rounded to the sen (law silent).
	const hrdWages = sen(basic + topUp + (earnings.find((l) => l.code === 'FIXED_ALLOWANCE')?.amount ?? 0) + encashment);
	const hrdRate =
		who.citizenship !== 'CITIZEN' || s.employer.hrd === 'NOT_REGISTERED' || (s.employer.hrd === 'EDUCATION_EXEMPT' && y === 2026)
			? 0
			: s.employer.hrd === 'OPTIONAL'
				? 0.005
				: 0.01;
	if (e.partTime && hrdRate) uncertain.push('HRDF.employer');
	if (hrdRate) lines.push({ code: 'HRDF', employee: 0, employer: sen(hrdRate * hrdWages), base: hrdWages });

	// ---- PCB ----
	// Normal remuneration Y1 (D.1): the fixed monthly pay (basic, top-up, fixed allowance, taxable travel beyond the E(9)(i)
	// RM6,000 a year). Additional remuneration Yt (D.2): bonus, leave pay on exit, notice indemnity, the termination benefit
	// above ITA Sch.6 para 15(1)(b) (RM10,000 × completed years), and overtime/rest-day/holiday pay (reading: paid in
	// addition to the fixed monthly pay, "non-fixed payment" — flagged).
	const travelTaxable = Math.max(0, (x.travelOfficial ?? 0) - 6000);
	const Y1 = sen(epfNormal + travelTaxable);
	const tbTaxable = Math.max(0, tb - 10000 * completedServiceYears);
	const Yt = sen(ot + restDay + restOt + holiday + holidayOt + (x.annualBonus ?? 0) + encashment + indemnity + tbTaxable);
	if (ot || restDay || holiday) uncertain.push('PCB.employee');
	if (indemnity) uncertain.push('PCB.employee');
	const nonResident =
		who.taxResidency !== 'RESIDENT' &&
		!(who.citizenship === 'FOREIGNER' && (e.contractDays ?? 0) >= 182); // D(a) and its August 2017 note
	let pcb: number;
	if (nonResident) {
		pcb = up5(trunc2(0.3 * (Y1 + Yt))); // D(a): 30% of remuneration
	} else {
		const K1raw = epf(part, epfNormal, epfNormal).ee; // E(13)(i)
		pcb = residentMtd({
			month: m,
			category: who.taxCategory,
			children: who.children,
			Y1,
			K1raw,
			Yt,
			Ktraw: sen(epfAll.ee - K1raw), // E(13)(ii)–(iii)
			zakat: x.zakat ?? 0
		});
	}
	lines.push({ code: 'PCB', employee: pcb, employer: 0, base: sen(Y1 + Yt) });
	if (x.zakat) {
		lines.push({ code: 'ZAKAT', employee: x.zakat, employer: 0, base: 0 });
		uncertain.push('net', 'total_deductions');
		notes.push('zakat is deducted through payroll and netted from PCB (spec D.1 net MTD)');
	}

	const totalDeductions = sen(lines.reduce((a, l) => a + l.employee, 0));
	const employerCost = sen(gross + lines.reduce((a, l) => a + l.employer, 0));
	uncertain.push('employer_cost'); // whether the HRD levy is part of employer cost is a product definition
	return {
		earnings,
		lines,
		gross,
		totalDeductions,
		net: sen(gross - totalDeductions),
		employerCost,
		uncertain: [...new Set(uncertain)],
		notes
	};
}

/** The payslip as the probe harness's line keys (`tests/e2e/payroll-probe.ts` `lines`). */
export function toProbeLines(p: Payslip): Record<string, number> {
	const out: Record<string, number> = {
		gross: p.gross,
		net: p.net,
		total_deductions: p.totalDeductions,
		employer_cost: p.employerCost
	};
	for (const l of p.earnings) out[l.code] = sen((out[l.code] ?? 0) + l.amount);
	for (const l of p.lines) {
		if (l.code === 'ZAKAT') continue;
		if (l.employee || l.code === 'PCB') out[`${l.code}.employee`] = l.employee;
		if (l.employer) out[`${l.code}.employer`] = l.employer;
	}
	return out;
}
