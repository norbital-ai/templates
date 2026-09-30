/**
 * Independent TW payslip oracle: one monthly payslip computed from the law alone (no engine, no seed).
 *
 * Sources (official, read 2026-09-30 unless noted):
 *   LSA    Labour Standards Act https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001 arts. 2(3), 16, 17,
 *          24, 38, 39, 40, 55, 56; Enforcement Rules https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030002
 *          art. 24-1(2) (unused 特休 = last normal month's wage ÷ 30 a day)
 *   MWA    Minimum Wage Act https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030028 art. 5 (a wage agreed below
 *          the floor is paid the floor); 2026 NT$29,500 / NT$196, 2025 NT$28,590 / NT$190 (docs/inventory TW-MW-01)
 *   PTG    MOL part-time guidance §6(2)(1) https://laws.mol.gov.tw/FLAW/FLAWDOC01.aspx?flno=6&id=FL072875
 *          (monthly part-timer: monthly floor × weekly hours / 40; hourly: hourly floor)
 *   LEAVE  勞工請假規則 art. 4 (普通傷病假 first 30 days a year at half wage); 事假 unpaid (art. 7)
 *   LI     BLI 115年 (and 114年) 勞工保險普通事故及就業保險合計之保險費分擔金額表 https://www.bli.gov.tw/Files/25696
 *          (24806 for 114年): grades 11,100–28,590 part-time, 29,500–45,800; 普通事故 11.5% and 就保 1%, worker 20%,
 *          unit 70%; non-EI table https://www.bli.gov.tw/Files/25693 (still 11.5%). The table's per-day cells
 *          reproduce only when LI and EI are each rounded on their own (11,100 × 1 day: 9 + 1 = 10).
 *   LI28   LI Enforcement Rules art. 28-1 (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050002&flno=28-1):
 *          a month is 30 days; BLI FAQ https://www.bli.gov.tw/0006925.html: charged from the join day to the exit day,
 *          a continuously insured month is 30 days whatever its length.
 *   EI65   BLI FAQ https://www.bli.gov.tw/0017586.html: EI stops on the day the worker turns 65 (LI continues).
 *   OCC    Occupational Accident Insurance Act arts. 17–19 https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050031;
 *          BLI calculator https://www.bli.gov.tw/en/0014918.html (OCC grades 29,500–72,800, employer-only, industry rate)
 *   LPA    Labor Pension Act arts. 14–15 https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020; 115年 月提繳分級表
 *          https://www.bli.gov.tw/Files/25709 (1,500–150,000; 114年 https://www.bli.gov.tw/Files/24831);
 *          BLI FAQ https://www.bli.gov.tw/0017599.html: 月提繳工資 × 提繳率 × 提繳天數 ÷ 30, every month 30 days,
 *          角以下四捨五入; art. 14(3): the worker's voluntary contribution is outside that year's salary income.
 *   NHI    NHIA 115年 投保金額分級表 https://www.nhi.gov.tw/ch/cp-19421-f9533-2569-1.html (29,500–313,000) and 負擔金額表(三)
 *          https://www.nhi.gov.tw/ch/cp-19418-9eefb-2576-1.html: 5.17%, insured 30% per head (dependants ≤ 3),
 *          unit 60% × 1.56; collection principles https://www.nhi.gov.tw/ch/cp-3204-6ecca-2568-1.html (the unit covering
 *          the person at month end pays the whole month; none in a withdrawal month). 114年 59-grade table
 *          (28,590 and 28,800 below 30,300) per docs/inventory TW-NHI-03.
 *   SUPP   NHI Act art. 31 (bonus above 4 × the insured amount, cumulative in the year, 2.11%), art. 34 (unit:
 *          payroll − insured amounts, 2.11%) https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060001
 *   ARR    LSA art. 28; BLI https://www.bli.gov.tw/0007337.html, https://www.bli.gov.tw/0110180.html: 0.025% of the LI
 *          insured salary, 30-day month, unit total rounded to NT$1.
 *   WRS    各類所得扣繳率標準 https://law-out.mof.gov.tw/LawContent.aspx?id=FL005962 arts. 2(1) (table or 5%), 2(9)
 *          (退職所得: 6% of the payment less 定額免稅), 3(2) (nonresident salary 18%, 6% when the month's salary is ≤
 *          1.5 × the minimum wage), 3(11) (nonresident 退職所得 18%), 13 (resident: nothing withheld when the tax is
 *          ≤ NT$2,000)
 *   SWR    薪資所得扣繳辦法 art. 7 https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340013&flno=7: non-monthly
 *          salary 5%, nothing when the single payment is below the no-dependant table start (115年 NT$90,501)
 *   TABLE  115年度薪資所得扣繳稅額表 and 說明 https://www.dot.gov.tw/singlehtml/ch_313?cntId=3783c45ec28543838fe285d06d00f3b8
 *          (exemption 101,000 a head, married standard deduction 272,000, salary deduction 227,000; rows of NT$500 from
 *          80,001 to 500,000, 0–11 dependants; the formula outside it). MOF 115年度速算公式
 *          https://www.mof.gov.tw/download/ae68ed6e8bfd4b66b0e7bc0ab515bdd0 (5/12/20/30/40%, 610k/1.38M/2.77M/5.19M).
 *          Every one of the 10,080 cells reproduces as: salary = the row's lower bound; annual tax per the 速算公式; ÷ 12;
 *          down to the NT$10; 0 when ≤ NT$2,000 (checked against the published PDF, 2026-09-30).
 *   RET    MOF 115年度 一覽表 https://www.mof.gov.tw/download/bb34472701e4443c910788e792dae85c: 退職所得 定額免稅 206,000 ×
 *          years (114年 198,000); Income Tax Act art. 14(1)(9): a part year under six months is half a year, six
 *          months or more a whole year.
 *   MEAL   營利事業所得稅查核準則 §88(2)(1): a fixed monthly 伙食代金 is outside salary income to NT$3,000 (TW-TAX-06);
 *          it is still 工資 for the insured bases.
 *   GARN   強制執行法 §115-1: the garnishee pays the ordered amount out of each wage payment (TW-WAGE-06).
 *   SUB    身心障礙者參加社會保險保險費補助辦法 §4–5: 輕度 ¼, 中度 ½, 重度/極重度 all of the insured's own LI/EI/NHI share.
 *
 * Owner-rule defaults (law silent) are the ones docs/inventory/taiwan.csv records, marked DEFAULT below.
 * Pure TypeScript; nothing is imported from src.
 */

export type Citizenship = 'ROC' | 'FOREIGN_PR' | 'FOREIGN_PROFESSIONAL' | 'FOREIGN_SPOUSE' | 'MIGRANT_WORKER';
export type ExitCause = 'RESIGNATION' | 'DISMISSAL_S12' | 'LAYOFF_S11' | 'WORKER_S14' | 'RETIREMENT';
export type Pay =
	| { basis: 'MONTHLY'; monthly: number; raise: null | { from: string; monthly: number } }
	| { basis: 'HOURLY'; hourly: number; hours: number };

export type Scenario = {
	id: string;
	/** tracker row ids exercised */
	rows: string[];
	/** branch names within those rows */
	branches: string[];
	/** YYYY-MM, one calendar month */
	period: string;
	company: {
		/** false: fewer than five workers, no LI unit, EI enrolled on its own (TW-EI-03) */
		liUnit: boolean;
		/** the OCC industry rate of the unit, e.g. 0.0012 (class 42) */
		occRate: number;
	};
	employee: {
		birthDate: string;
		citizenship: Citizenship;
		/** a permanent residence granted on this date (EI from that day, TW-EI-02) */
		prGrantedOn: string | null;
		taxResident: boolean;
		hireDate: string;
		pay: Pay;
		/** contracted weekly hours of a part-timer; null = full-time */
		partTimeWeeklyHours: number | null;
		/** fixed monthly 伙食代金 */
		mealAllowance: number;
		/** the insurer-accepted declared wage when it differs from the month's wage (a raise not yet notified) */
		declaredWage: number | null;
		nhiDependants: number;
		/** spouse + dependants declared for the withholding table */
		taxDependants: number;
		taxMethod: 'TABLE' | 'FLAT5';
		pension: { system: 'NEW'; voluntaryRate: number } | { system: 'OLD_RETAINED'; reserveRate: number };
		disability: null | 'MILD' | 'MODERATE' | 'SEVERE';
		/** an LI enrolment that continues after 65 */
		liAfter65: boolean;
	};
	time: {
		/** weekday overtime hours, one entry per day (each ≤ 4) */
		weekdayOvertime: number[];
		/** hours worked on 休息日, one entry per day */
		restDayWork: number[];
		/** hours worked on §37 holidays, one entry per day */
		holidayWork: number[];
		/** §40 例假 days worked in an emergency */
		restDayEmergencyDays: number;
	};
	leave: { personalDays: number; sickDays: number; sickPriorDays: number; parentalWholeMonth: boolean };
	bonus: { amount: number; priorThisYear: number };
	garnishment: number;
	exit: null | {
		/** last day of employment */
		date: string;
		cause: ExitCause;
		noticeDaysGiven: number;
		annualLeaveTaken: number;
		/** LSA art. 2(4): the six months' average wage */
		averageMonthlyWage: number;
		/** LSA art. 55(1)(2): an art. 54(1)(2) retirement for a duty-caused disability */
		dutyDisability: boolean;
	};
};

export type Line = { amount?: number; employee?: number; employer?: number; base?: number };
export type Payslip = { lines: Record<string, Line>; companyLines: Record<string, number> | null };

// ---------- arithmetic ----------
const EPS = 1e-7;
/** DEFAULT (TW-WAGE-05): wage lines to the cent, half up. */
export const r2 = (x: number) => Math.sign(x) * (Math.floor(Math.abs(x) * 100 + 0.5 + EPS) / 100);
/** Premiums: 元, 角以下四捨五入 (LPA FAQ; LI/NHI tables reproduce it). */
const r0 = (x: number) => Math.floor(x + 0.5 + EPS);
/** Tax: whole dollars, truncated (TW-TAX-02). */
const f0 = (x: number) => Math.floor(x + EPS);

// ---------- dates ----------
const D = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;
export const addDays = (d: string, n: number) => iso(D(d) + n * DAY);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const addYears = (d: string, n: number) => {
	const y = +d.slice(0, 4) + n;
	return d.slice(5) === '02-29' && !isLeap(y) ? `${y}-03-01` : `${y}-${d.slice(5)}`;
};
export const addMonths = (d: string, n: number) => {
	const m0 = +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1) + n;
	const y = Math.floor(m0 / 12);
	const m = (m0 % 12) + 1;
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(+d.slice(8, 10), last)).padStart(2, '0')}`;
};
export const daysIn = (period: string) => new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).getUTCDate();
export const monthEnd = (period: string) => `${period}-${String(daysIn(period)).padStart(2, '0')}`;
const span = (a: string, b: string) => (D(b) - D(a)) / DAY + 1;
export const ageOn = (birth: string, on: string) =>
	+on.slice(0, 4) - +birth.slice(0, 4) - (on.slice(5) < birth.slice(5) ? 1 : 0);
/** Service from hire to the last day inclusive: completed years, months and the remaining days. */
export const service = (hire: string, last: string) => {
	const end = addDays(last, 1);
	let months = 0;
	while (addMonths(hire, months + 1) <= end) months++;
	const days = span(addMonths(hire, months), end) - 1;
	return { years: Math.floor(months / 12), months: months % 12, days, totalMonths: months };
};

// ---------- the dated law ----------
type Law = {
	mwMonthly: number;
	mwHourly: number;
	liGrades: number[]; // full-time ladder, lowest = the minimum grade
	partTimeGrades: number[]; // part-time grades below the minimum
	occGrades: number[];
	pensionGrades: number[];
	nhiGrades: number[];
	tax: { exemption: number; standard: number; salary: number; bands: [number, number, number][] };
	retireExempt: number;
};
const LI_TOP = [30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000, 43900, 45800];
const PT = [11100, 12540, 13500, 15840, 16500, 17280, 17880, 19047, 20008, 21009, 22000, 23100, 24000, 25250, 26400, 27600];
const OCC_TOP = [...LI_TOP, 48200, 50600, 53000, 55400, 57800, 60800, 63800, 66800, 69800, 72800];
const PEN_LOW = [1500, 3000, 4500, 6000, 7500, 8700, 9900, ...PT];
const PEN_TOP = [
	...OCC_TOP, 76500, 80200, 83900, 87600, 92100, 96600, 101100, 105600, 110100, 115500, 120900, 126300, 131700,
	137100, 142500, 147900, 150000
];
const NHI_TOP = [
	...PEN_TOP, 156400, 162800, 169200, 175600, 182000, 189500, 197000, 204500, 212000, 219500, 228200, 236900, 245600,
	254300, 263000, 273000, 283000, 293000, 303000, 313000
];
/** 速算公式: [band top, rate, 累進差額] (the difference follows from the band edges). */
const bands = (edges: number[]): [number, number, number][] => {
	const rates = [0.05, 0.12, 0.2, 0.3, 0.4];
	const out: [number, number, number][] = [];
	let diff = 0;
	for (let i = 0; i < rates.length; i++) {
		if (i > 0) diff += edges[i - 1]! * (rates[i]! - rates[i - 1]!);
		out.push([edges[i] ?? Infinity, rates[i]!, Math.round(diff)]);
	}
	return out;
};
const LAW: Record<string, Law> = {
	'2026': {
		mwMonthly: 29500,
		mwHourly: 196,
		liGrades: [29500, ...LI_TOP],
		partTimeGrades: [...PT, 28590],
		occGrades: [29500, ...OCC_TOP],
		pensionGrades: [...PEN_LOW, 28590, 29500, ...PEN_TOP],
		nhiGrades: [29500, ...NHI_TOP],
		// 115年度: 610,000 / 1,380,000 / 2,770,000 / 5,190,000 → 0 / 42,700 / 153,100 / 430,100 / 949,100
		tax: { exemption: 101000, standard: 272000, salary: 227000, bands: bands([610000, 1380000, 2770000, 5190000]) },
		retireExempt: 206000
	},
	'2025': {
		mwMonthly: 28590,
		mwHourly: 190,
		liGrades: [28590, 28800, ...LI_TOP],
		partTimeGrades: [...PT],
		occGrades: [28590, 28800, ...OCC_TOP],
		pensionGrades: [...PEN_LOW, 28590, 28800, ...PEN_TOP],
		nhiGrades: [28590, 28800, ...NHI_TOP],
		// 114年度: 97,000 exemption, 262,000 married standard, 218,000 salary; 590k / 1.33M / 2.66M / 4.98M
		tax: { exemption: 97000, standard: 262000, salary: 218000, bands: bands([590000, 1330000, 2660000, 4980000]) },
		retireExempt: 198000
	}
};
export const lawFor = (period: string) => LAW[period.slice(0, 4)]!;
/** The smallest grade at or above the wage; the top grade caps. */
const grade = (ladder: number[], wage: number) => ladder.find((g) => g >= wage) ?? ladder.at(-1)!;

const LI_RATE = 0.115; // LI 普通事故, EI-reduced (and non-EI per the Executive Yuan letter on Files/25693)
const EI_RATE = 0.01;
const NHI_RATE = 0.0517;
const NHI_AVG_DEPENDANTS = 0.56;
const SUPP_RATE = 0.0211;
const ARREARS_RATE = 0.00025;
const EMPLOYER_PENSION = 0.06;
const SUBSIDY = { MILD: 0.25, MODERATE: 0.5, SEVERE: 1 } as const;

/** 115年度 table cell: 80,001–500,000 by NT$500 rows, 0–11 dependants; the 說明 (三) formula outside. */
export function tableTax(law: Law, salary: number, dependants: number) {
	const t = law.tax;
	const annual = (s: number) => {
		const taxable = s * 12 - (t.exemption * (1 + dependants) + t.standard + t.salary);
		if (taxable <= 0) return 0;
		const [, rate, diff] = t.bands.find(([top]) => taxable <= top)!;
		return taxable * rate - diff;
	};
	let monthly: number;
	if (salary >= 80001 && salary <= 500000 && dependants <= 11) {
		const lo = 80001 + 500 * Math.floor((salary - 80001) / 500);
		monthly = Math.floor(annual(lo) / 12 / 10 + EPS) * 10;
	} else monthly = f0(annual(salary) / 12);
	return monthly <= 2000 ? 0 : monthly; // WRS art. 13
}
/** SWR art. 7: the no-dependant table's first non-zero row. */
const tableStart = (law: Law) => {
	for (let lo = 80001; lo <= 500000; lo += 500) if (tableTax(law, lo, 0) > 0) return lo;
	return Infinity;
};

// ---------- insured days ----------
/**
 * LI28 / BLI 0006925: from the join day to the exit day; a continuously insured month is 30 days. DEFAULT
 * (TW-LI-02, TW-EI-02): a day past the 30th is not counted (16 March to 31 March = 15 days); an exit on February's
 * last day is the actual 28/29 days (TW-PEN-03). Pension (BLI 0017599, TW-PEN-03): a month-end exit completes 30.
 */
const insuredDays = (period: string, from: string | null, to: string | null, pension = false) => {
	const first = `${period}-01`;
	const last = monthEnd(period);
	const s = from !== null && from > first ? +from.slice(8, 10) : 1;
	const eDate = to !== null && to < last ? to : last;
	if (s > +eDate.slice(8, 10) || (from !== null && from > last) || (to !== null && to < first)) return 0;
	const leaves = to !== null && to <= last; // an exit (or cover ending) this month
	if (s === 1 && eDate === last && (!leaves || pension)) return 30;
	const e = pension && eDate === last ? 30 : Math.min(+eDate.slice(8, 10), 30);
	return Math.max(0, e - Math.min(s, 30) + 1);
};

// ---------- the payslip ----------
export function computePayslip(sc: Scenario): Payslip {
	const law = lawFor(sc.period);
	const e = sc.employee;
	const first = `${sc.period}-01`;
	const last = monthEnd(sc.period);
	const x = sc.exit;
	const start = e.hireDate > first ? e.hireDate : first;
	const end = x && x.date < last ? x.date : last;
	const whole = start === first && end === last;
	const lines: Record<string, Line> = {};
	const earn = (code: string, amount: number) => {
		const a = r2(amount);
		if (Math.abs(a) >= 0.005) lines[code] = { amount: r2((lines[code]?.amount ?? 0) + a) };
	};

	// --- wages ---
	// MWA art. 5 / PTG: the floor for the worker's schedule replaces a lower agreed wage.
	const floorMonthly = e.partTimeWeeklyHours === null ? law.mwMonthly : r2((law.mwMonthly * e.partTimeWeeklyHours) / 40);
	let monthlyRate = 0; // the month's normal monthly wage (for ÷ 30 day rates)
	let insuredWage: number;
	const parental = sc.leave.parentalWholeMonth;
	if (e.pay.basis === 'HOURLY') {
		const hourly = Math.max(e.pay.hourly, law.mwHourly);
		earn('BASIC', parental ? 0 : hourly * e.pay.hours);
		insuredWage = hourly * e.pay.hours; // TW-LI-05: actual whole-month pay
		monthlyRate = hourly * 8 * 30; // so that a day is 8 hours at the hourly rate
	} else {
		const agreed = Math.max(e.pay.monthly, floorMonthly);
		monthlyRate = agreed;
		insuredWage = agreed + e.mealAllowance;
		if (!parental) {
			if (e.pay.raise && whole) {
				// DEFAULT (TW-WAGE-05): a mid-month rate change pays each rate its calendar-day share of the month
				const n = daysIn(sc.period);
				const d = +e.pay.raise.from.slice(8, 10);
				const raised = Math.max(e.pay.raise.monthly, floorMonthly);
				earn('BASIC', (agreed * (d - 1)) / n + (raised * (n - d + 1)) / n);
				monthlyRate = raised;
			} else if (whole) {
				earn('BASIC', agreed);
				earn('MEAL_ALLOWANCE', e.mealAllowance);
			} else {
				// DEFAULT (TW-WAGE-05): a part month of service is paid by the calendar day at 月薪 ÷ 30
				const days = span(start, end);
				earn('BASIC', Math.min(agreed, (agreed * days) / 30));
				earn('MEAL_ALLOWANCE', Math.min(e.mealAllowance, (e.mealAllowance * days) / 30));
			}
			if (e.pay.raise && whole) earn('MEAL_ALLOWANCE', e.mealAllowance);
		}
	}
	const day = monthlyRate / 30; // LSA art. 2(3); DEFAULT ÷ 30 (TW-WAGE-05)
	const hour = day / 8; // DEFAULT: 月薪 ÷ 30 ÷ 8 absent agreement
	// LEAVE art. 7: 事假 unpaid (the allowance stays whole, TW-WAGE-05 golden); art. 4(3): sick half pay to 30 days
	if (sc.leave.personalDays > 0) earn('PERSONAL_LEAVE', -day * sc.leave.personalDays);
	if (sc.leave.sickDays > 0) {
		const half = Math.min(sc.leave.sickDays, Math.max(0, 30 - sc.leave.sickPriorDays));
		earn('SICK_LEAVE', -(day / 2) * half - day * (sc.leave.sickDays - half));
	}
	// LSA art. 24(1): weekday overtime, first two hours +⅓, the next two +⅔
	const tiers = (h: number) => Math.min(h, 2) * (4 / 3) + Math.max(0, h - 2) * (5 / 3);
	const ot = sc.time.weekdayOvertime.reduce((s, h) => s + tiers(h), 0) * hour;
	earn('OT_WEEKDAY', ot);
	// LSA art. 24(2): 休息日 work, first two hours another 1⅓, after that another 1⅔ (the day's wage is in the month)
	earn('OT_REST_DAY', sc.time.restDayWork.reduce((s, h) => s + tiers(h), 0) * hour);
	// LSA art. 39: holiday work pays the day again (DEFAULT: one day's wage however few of the 8 hours; hours past
	// 8 at the art. 24(1) tiers)
	earn('HOLIDAY_WORK', sc.time.holidayWork.reduce((s, h) => s + day + tiers(Math.max(0, h - 8)) * hour, 0));
	// LSA art. 40: an emergency 例假 day pays one further day's wage (TW-HOURS-02)
	earn('REST_DAY_EMERGENCY', sc.time.restDayEmergencyDays * day);
	earn('BONUS', sc.bonus.amount);

	// --- exit ---
	let severance = 0;
	let retirement = 0;
	let retireYears = 0;
	if (x && x.date <= last && x.date >= first) {
		const svc = service(e.hireDate, x.date);
		// LSA art. 38(1): the entitlement of the service year reached; (4) and Rules art. 24-1(2): unused days paid
		// at the last normal month's wage ÷ 30
		const y = svc.years;
		const ent =
			svc.totalMonths < 6 ? 0 : y < 1 ? 3 : y < 2 ? 7 : y < 3 ? 10 : y < 5 ? 14 : y < 10 ? 15 : Math.min(30, 15 + (y - 9));
		earn('ANNUAL_LEAVE_PAYOUT', Math.max(0, ent - x.annualLeaveTaken) * day);
		// LSA arts. 16, 11: notice 10 / 20 / 30 days by service; pay in lieu of the days not given (not for 12/14/15)
		if (x.cause === 'LAYOFF_S11') {
			const required = svc.totalMonths < 3 ? 0 : y < 1 ? 10 : y < 3 ? 20 : 30;
			earn('NOTICE_PAY', Math.max(0, required - x.noticeDaysGiven) * day);
		}
		// LPA art. 12: new-system severance, half a month's average wage a year, a part year pro rata, six months at
		// most (LSA art. 14(4) applies it to a worker's art. 14 termination). DEFAULT: part year = months/12 + days/365.
		if ((x.cause === 'LAYOFF_S11' || x.cause === 'WORKER_S14') && e.pension.system === 'NEW') {
			const years = svc.years + svc.months / 12 + svc.days / 365;
			severance = r2(Math.min(6, years / 2) * x.averageMonthlyWage);
			earn('SEVERANCE_PAY', severance);
		}
		// LSA art. 55: old-system retirement pay: two bases a year to 15 years, one after, 45 at most; a part year
		// under six months is half, six months or more whole; +20% for a duty-caused disability retirement
		if (x.cause === 'RETIREMENT' && e.pension.system === 'OLD_RETAINED') {
			retireYears = svc.years + (svc.months === 0 && svc.days === 0 ? 0 : svc.months < 6 ? 0.5 : 1);
			const bases = Math.min(45, 2 * Math.min(retireYears, 15) + Math.max(0, retireYears - 15));
			retirement = r2(bases * x.averageMonthlyWage * (x.dutyDisability ? 1.2 : 1));
			earn('RETIREMENT_PAY', retirement);
		}
	}

	// --- coverage ---
	const age = (on: string) => ageOn(e.birthDate, on);
	const turns65 = addYears(e.birthDate, 65);
	const migrant = e.citizenship === 'MIGRANT_WORKER';
	const covered = !parental; // TW-PEN-08 / TW-LEAVE-06: a whole month of 育嬰留停 charges nothing through payroll
	// LI Act art. 6: 15–65 compulsory; a registration continuing after 65 stays (TW-EI-01 golden)
	const liOn = covered && sc.company.liUnit && (age(start) < 65 || e.liAfter65);
	// EI Act art. 5: ROC nationals, foreign spouses and PR holders (Foreign Professionals Act art. 25), 15 to 65
	const eiFrom =
		e.citizenship === 'ROC' || e.citizenship === 'FOREIGN_SPOUSE' || e.citizenship === 'FOREIGN_PR'
			? start
			: e.prGrantedOn !== null && e.prGrantedOn <= end
				? (e.prGrantedOn > start ? e.prGrantedOn : start)
				: null;
	const eiTo = turns65 <= end ? addDays(turns65, -1) : end; // EI65: out from the 65th birthday
	// LPA art. 7: nationals, foreign spouses, PR holders; Foreign Professionals Act art. 24 (2026): professionals
	const pensionOn = covered && e.pension.system === 'NEW' && !migrant;
	const liGrade = grade(e.partTimeWeeklyHours !== null || e.pay.basis === 'HOURLY' ? [...law.partTimeGrades, ...law.liGrades] : law.liGrades, e.declaredWage ?? insuredWage);
	const occGrade = grade(law.occGrades, e.declaredWage ?? insuredWage);
	const penGrade = grade(law.pensionGrades, e.declaredWage ?? insuredWage);
	const nhiGrade = grade(law.nhiGrades, e.declaredWage ?? insuredWage);
	const exitDate = x ? x.date : null;
	const liDays = insuredDays(sc.period, e.hireDate, exitDate);
	const eiEnd = turns65 <= end ? eiTo : exitDate;
	const eiDays = eiFrom !== null && eiFrom <= eiTo ? insuredDays(sc.period, eiFrom, eiEnd) : 0;
	const penDays = insuredDays(sc.period, e.hireDate, exitDate, true);
	const sub = e.disability === null ? 0 : SUBSIDY[e.disability];
	const charge = (code: string, ee: number, er: number, base: number) => {
		if (ee !== 0 || er !== 0) lines[code] = { employee: ee, employer: er, base };
	};
	// SUB: the subsidy is rounded on its own from the unrounded share
	const share = (unrounded: number) => r0(unrounded) - r0(unrounded * sub);
	if (liOn) {
		const u = (liGrade * LI_RATE * liDays) / 30;
		charge('LI', share(u * 0.2), r0(u * 0.7), liGrade);
	}
	if (covered && eiDays > 0 && age(start) >= 15) {
		const u = (liGrade * EI_RATE * eiDays) / 30;
		charge('EI', share(u * 0.2), r0(u * 0.7), liGrade);
	}
	// OCC Act art. 19: employer-only at the industry rate, on OCC's own ladder, every covered day
	if (covered) charge('OCC_INJURY', 0, r0((occGrade * sc.company.occRate * liDays) / 30), occGrade);
	if (pensionOn) {
		const u = (penGrade * penDays) / 30;
		const voluntary = e.pension.system === 'NEW' ? r0(u * e.pension.voluntaryRate) : 0;
		charge('LABOR_PENSION', voluntary, r0(u * EMPLOYER_PENSION), penGrade);
	}
	// LSA art. 56(1): the old-system reserve, 2–15% of the month's wages (TW-EXIT-03, TW-TAX-06-2 with the allowance)
	if (covered && e.pension.system === 'OLD_RETAINED') {
		const wages = ['BASIC', 'MEAL_ALLOWANCE', 'PERSONAL_LEAVE', 'SICK_LEAVE'].reduce((s, c) => s + (lines[c]?.amount ?? 0), 0);
		charge('LABOR_PENSION_RESERVE', 0, r0(wages * e.pension.reserveRate), wages);
	}
	// NHI: the unit covering the worker at month end pays the month (a withdrawal month pays none)
	const nhiEnrolled = e.partTimeWeeklyHours === null || e.partTimeWeeklyHours >= 12; // NHIA part-time principle
	if (covered && nhiEnrolled && end === last) {
		const own = r0(nhiGrade * NHI_RATE * 0.3);
		const ownPaid = own - r0(own * sub);
		charge('NHI', ownPaid + own * Math.min(3, e.nhiDependants), r0(nhiGrade * NHI_RATE * 0.6 * (1 + NHI_AVG_DEPENDANTS)), nhiGrade);
	}
	// SUPP art. 31: the bonus above four insured amounts, cumulative in the year
	if (sc.bonus.amount > 0 && nhiEnrolled) {
		const cum = sc.bonus.priorThisYear + sc.bonus.amount;
		const excess = Math.min(sc.bonus.amount, cum - 4 * nhiGrade, 10_000_000);
		if (excess > 0) charge('NHI_SUPPLEMENT', r0(excess * SUPP_RATE), 0, excess);
	}

	// --- tax ---
	const salaryItems = ['BASIC', 'MEAL_ALLOWANCE', 'PERSONAL_LEAVE', 'SICK_LEAVE', 'ANNUAL_LEAVE_PAYOUT', 'NOTICE_PAY'];
	const amt = (c: string) => lines[c]?.amount ?? 0;
	const mealExempt = Math.min(amt('MEAL_ALLOWANCE'), 3000); // MEAL
	const voluntary = lines.LABOR_PENSION?.employee ?? 0; // LPA art. 14(3)
	// Income Tax Act art. 14(1)(3): overtime pay within the statutory limits is exempt (the generator keeps
	// overtime inside 46 hours a month)
	const regular = salaryItems.reduce((s, c) => s + amt(c), 0) - mealExempt - voluntary;
	const exitLump = severance + retirement;
	if (e.taxResident) {
		const t =
			e.taxMethod === 'FLAT5'
				? (() => {
						const v = f0(regular * 0.05);
						return v <= 2000 ? 0 : v; // WRS arts. 2(1)(2), 13
					})()
				: tableTax(law, regular, e.taxDependants);
		if (t > 0) charge('INCOME_TAX', t, 0, r2(regular));
		// SWR art. 7: non-monthly salary 5%, none below the table start
		if (sc.bonus.amount >= tableStart(law)) charge('INCOME_TAX_BONUS', f0(sc.bonus.amount * 0.05), 0, sc.bonus.amount);
	} else {
		// WRS art. 3(2): 18%, or 6% when the month's salary total is ≤ 1.5 × the monthly minimum wage
		const total = regular + sc.bonus.amount;
		const rate = total <= 1.5 * law.mwMonthly ? 0.06 : 0.18;
		if (total > 0) charge('INCOME_TAX_NON_RESIDENT', f0(total * rate), 0, r2(total));
	}
	if (exitLump > 0) {
		// RET / WRS arts. 2(9), 3(11): withheld on the payment less the 定額免稅 (years with the half-year rule)
		const svc = service(e.hireDate, x!.date);
		const years = retireYears || svc.years + (svc.months === 0 && svc.days === 0 ? 0 : svc.months < 6 ? 0.5 : 1);
		const over = exitLump - law.retireExempt * years;
		if (over > 0) {
			const t = f0(over * (e.taxResident ? 0.06 : 0.18));
			if (!(e.taxResident && t <= 2000)) charge('SEVERANCE_TAX', t, 0, r2(over));
		}
	}

	if (sc.garnishment > 0) lines.COURT_GARNISHMENT = { amount: sc.garnishment }; // GARN: net deduction

	const gross = r2(
		Object.entries(lines)
			.filter(([, l]) => l.amount !== undefined && l.employee === undefined)
			.filter(([k]) => k !== 'COURT_GARNISHMENT')
			.reduce((s, [, l]) => s + l.amount!, 0)
	);
	const statutory = Object.values(lines).filter((l) => l.employee !== undefined);
	const deductions = r2(statutory.reduce((s, l) => s + l.employee!, 0) + sc.garnishment);
	const employer = statutory.reduce((s, l) => s + (l.employer ?? 0), 0);
	lines.gross = { amount: gross };
	lines.total_deductions = { amount: deductions };
	lines.net = { amount: r2(gross - deductions) };
	lines.employer_cost = { amount: r2(gross + employer) };

	// --- the unit's own charges (one employment per company) ---
	// ARR: 0.025% of the LI insured salary × days / 30; SUPP art. 34: payroll − insured amounts, 2.11%. Only stated
	// where the worker is LI-insured and every paid item is plain salary (DEFAULT: the art. 34 payroll is the month's
	// salary income).
	let companyLines: Payslip['companyLines'] = null;
	const plain = ot === 0 && amt('OT_REST_DAY') === 0 && amt('HOLIDAY_WORK') === 0 && amt('REST_DAY_EMERGENCY') === 0;
	if (liOn && plain && exitLump === 0 && e.mealAllowance === 0) {
		const payroll = regular + voluntary + sc.bonus.amount;
		const insured = covered && nhiEnrolled && end === last ? nhiGrade : 0;
		companyLines = {
			'WAGE_ARREARS_FUND.employer': r0((liGrade * ARREARS_RATE * liDays) / 30),
			'NHI_SUPPLEMENT_EMPLOYER.employer': Math.max(0, r0((payroll - insured) * SUPP_RATE))
		};
	}
	return { lines, companyLines };
}
