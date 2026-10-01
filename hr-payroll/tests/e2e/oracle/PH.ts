/**
 * Independent PH payslip oracle: every figure below is read from the primary source cited beside it, never from
 * the engine (src/**, seed/** and tests/e2e/probes/** were not read). Owner rule: law states it → follow it; law
 * silent → a lawful, consistent default, marked `DEFAULT:` here and listed in `scenario.defaults` by the generator.
 *
 * Sources (read 2026-09-30):
 *  [SSS]   SSS Circular 2024-006 schedule (business) and 2024-007 schedule (household), eff. January 2025
 *          https://www.sss.gov.ph/wp-content/uploads/2024/12/CI-2024-006-Publication.pdf p.2
 *          https://www.sss.gov.ph/wp-content/uploads/2024/12/CI-2024-007-Publication.pdf p.2
 *  [SSSIRR] RA 11199 IRR Rule 12 s.6 (compensation), Rule 13 s.1 (coverage not over 60, "up to the day of his/her
 *          60th birthday") https://www.sss.gov.ph/wp-content/uploads/2022/04/IRR-RA11199-SS-Act-of-2018_2.pdf
 *  [PHIC]  PhilHealth Circular 2020-0005 Rev.1 §IV.F (MBS excludes leave-without-pay deductions), §V.A–B; 5%,
 *          PHP10,000 floor, PHP100,000 ceiling from 2025 (RA 11223 s.10; PA2025-0002)
 *          https://www.philhealth.gov.ph/circulars/2020/circ2020-0005.pdf
 *  [HDMF]  HDMF Circular 460 pp.1–3 (DMW Advisory 37-2025 annex) https://wcms.dmw.gov.ph/uploads/DMW_ADVISORY_37_2025_01225b9fec.pdf
 *  [RR11]  RR 11-2018 s.2.78.1(B)(11)–(13), s.2.79(B) steps 1–4, (B)(5)(a) cumulative average, (B)(5)(b)
 *          annualisation and the 2023 annual table https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf
 *  [ANNEXE] RR 11-2018 Annex E monthly column (2023 onward) https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf
 *  [NIRC25] NIRC s.25(B): NRA not engaged in trade or business, 25% of gross (RR 21-2025 s.3)
 *  [NCR28] Wage Order NCR-28 (PHP695/658 through 25 Sep 2026, PHP755/718 from 26 Sep 2026)
 *          https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-NCR-28.pdf
 *  [NCRDW] Wage Order NCR-DW-06 (PHP7,000 through 6 Feb 2026, PHP7,800 from 7 Feb 2026), s.5 no exemption
 *          https://nwpc.dole.gov.ph/wp-content/uploads/2026/01/Wage-Order-No.-NCR-DW-06.pdf
 *  [EMR]   NWPC FAQ equivalent monthly rate: 261 factor for workers unpaid on weekends/rest days https://nwpc.dole.gov.ph/faqs/
 *  [HB]    DOLE Handbook on Workers' Statutory Monetary Benefits 2024 (holiday, premium, OT, ND, SIL, 13th month,
 *          separation, retirement) https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf
 *  [LC]    Labor Code arts.87, 93, 94, 95, 298–299, 302 (renumbered) https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/26/25306
 *  [RA10361] Kasambahay Law s.30 (coverage after one month's service; employer shoulders premiums below P5,000),
 *          s.32 (15 days' indemnity / forfeiture) https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/51514
 *  [RA12063] EBET apprentice at least 75% of the applicable minimum wage https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/98026
 *  [PROC]  2026 holidays (Proclamation 1006 and amendments; tracker PH-HR36)
 */
import type { PHScenario, WorkEntry } from '../profiles/PH';

export type Line = { amount?: number; employee?: number; employer?: number; base?: number };
export type Payslip = {
	refused?: string;
	warnings: string[];
	lines: Record<string, Line>;
	gross: number;
	total_deductions: number;
	net: number;
	employer_cost: number;
};

// ---------- money and dates ----------
/** DEFAULT: every line rounds half-up to the centavo once (no source states a per-line rounding). */
const r2 = (x: number) => (Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-6)) / 100;
const trunc2 = (x: number) => Math.floor(x * 100 + 1e-6) / 100;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
const dow = (s: string) => day(s).getUTCDay(); // 0 Sunday
const monthStart = (p: string) => `${p}-01`;
const monthEnd = (p: string) => {
	const [y, m] = p.split('-').map(Number) as [number, number];
	return iso(new Date(Date.UTC(y, m, 0)));
};
/** Whole calendar months from `a` to `b` (b exclusive). */
const wholeMonths = (a: string, b: string) => {
	const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
	const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
	return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
};
const ageOn = (birth: string, on: string) => Math.floor(wholeMonths(birth, on) / 12);
const addYears = (s: string, n: number) => `${Number(s.slice(0, 4)) + n}${s.slice(4)}`;

// [PROC] 2026 national holidays (tracker PH-HR36 list).
const REGULAR_HOLIDAYS = new Set([
	'2026-01-01',
	'2026-03-20',
	'2026-04-02',
	'2026-04-03',
	'2026-04-09',
	'2026-05-01',
	'2026-05-27',
	'2026-06-12',
	'2026-08-31',
	'2026-11-30',
	'2026-12-25',
	'2026-12-30'
]);
const SPECIAL_DAYS = new Set([
	'2026-02-17',
	'2026-04-04',
	'2026-08-21',
	'2026-11-01',
	'2026-11-02',
	'2026-12-08',
	'2026-12-24',
	'2026-12-31'
]);

// ---------- wage floors ----------
/** [NCR28] ss.1–3 daily floor for a normal day of at most 8 hours; [NCRDW] monthly domestic floor. */
function dailyFloor(sector: PHScenario['sector'], on: string) {
	const late = on >= '2026-09-26';
	return sector === 'NON_AGRICULTURE' ? (late ? 755 : 695) : late ? 718 : 658;
}
const domesticFloor = (on: string) => (on >= '2026-02-07' ? 7800 : 7000);

// ---------- rates ----------
/** [EMR] a 5-day-week monthly wage covers 261 paid days a year: daily = monthly × 12 / 261 (unrounded). */
const dailyRate = (s: PHScenario) => (s.employment.monthlyBasic * 12) / 261;
const hourly = (s: PHScenario) => dailyRate(s) / s.employment.hoursPerDay;

const isWeekday = (d: string) => dow(d) >= 1 && dow(d) <= 5;
function weekdays(from: string, to: string) {
	const out: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) out.push(d);
	return out;
}
/** [HB] ch.2: the workday immediately preceding a holiday, skipping non-working days. */
function precedingWorkday(d: string) {
	let p = addDays(d, -1);
	while (!isWeekday(p) || REGULAR_HOLIDAYS.has(p) || SPECIAL_DAYS.has(p)) p = addDays(p, -1);
	return p;
}

/** The employed window of `period`, clipped to hire and exit. */
function window(s: PHScenario, period: string) {
	const from =
		s.employment.hireDate > monthStart(period) ? s.employment.hireDate : monthStart(period);
	const exit = s.employment.exitDate;
	const to = exit !== undefined && exit < monthEnd(period) ? exit : monthEnd(period);
	return { from, to };
}

/**
 * Basic paid for a month. [HB] ch.2 §E / tracker PH-PR01: a part month pays the days worked.
 * DEFAULT (seed `work_rules.proration` FIXED_DAYS 21.75 on the scenario's Mon–Fri roster, kasambahay included —
 * no scenario contract declares paid rest days): a window covering every weekday of the month pays the full
 * monthly basic; otherwise the employed weekdays × daily rate, capped at the monthly basic. [HB] ch.2 §B / seed
 * `payroll.special_holiday_unworked_unpaid`: an unworked special day is "no work, no pay", so it is not among the
 * part month's paid days; an unworked regular holiday is.
 */
function basicFor(s: PHScenario, period: string) {
	const { from, to } = window(s, period);
	if (from > to) return 0;
	const all = weekdays(monthStart(period), monthEnd(period));
	const worked = weekdays(from, to).filter(
		(d) => !SPECIAL_DAYS.has(d) || s.work.some((w) => w.date === d)
	);
	// DEFAULT: never more than the full monthly basic (a month with 23 weekdays would otherwise overpay a joiner).
	return weekdays(from, to).length === all.length
		? s.employment.monthlyBasic
		: Math.min(s.employment.monthlyBasic, r2(dailyRate(s) * worked.length));
}

// ---------- statutory schedules ----------
/** [SSS] business MSC: below 5,250 → 5,000; PHP500 brackets; 34,750 and over → 35,000. */
function businessMsc(c: number) {
	if (c < 5250) return 5000;
	return Math.min(35000, 5000 + Math.floor((c - 4750) / 500 + 1e-9) * 500);
}
/** [SSS] household MSC below 5,000: below 1,250 → 1,000; PHP500 brackets to 4,750–4,999.99 → 5,000. */
function householdMsc(c: number) {
	if (c < 1250) return 1000;
	return 1000 + Math.floor((c - 750) / 500 + 1e-9) * 500;
}

type Charge = { employee: number; employer: number; base: number };
function sss(s: PHScenario, compensation: number): Record<string, Charge> {
	if (compensation <= 0 || !sssCovered(s)) return {};
	const household = s.employment.type === 'DOMESTIC' && compensation < 5000;
	const msc = household ? householdMsc(compensation) : businessMsc(compensation);
	const regular = Math.min(msc, 20000);
	const mpf = msc - regular;
	const out: Record<string, Charge> = {
		// [SSS] 15% of MSC: employer 10%, employee 5%; household below PHP5,000: employer pays all 15%, employee nothing.
		SSS: household
			? { employee: 0, employer: r2(regular * 0.15), base: regular }
			: { employee: r2(regular * 0.05), employer: r2(regular * 0.1), base: regular },
		// [SSS] EC PHP10 for MSC up to 14,500 (compensation below 14,750), PHP30 from MSC 15,000; employer only.
		SSS_EC: { employee: 0, employer: msc < 15000 ? 10 : 30, base: msc }
	};
	if (mpf > 0) out.SSS_MPF = { employee: r2(mpf * 0.05), employer: r2(mpf * 0.1), base: mpf };
	return out;
}
/**
 * [SSSIRR] Rule 13 s.1: compulsory coverage for employees not over 60 "up to the day of his/her 60th birthday";
 * tracker PH-SS10: a member first covered before 60 stays covered. The first coverage is judged at hire.
 */
const sssCovered = (s: PHScenario) =>
	s.employee.sssMemberBeforeSixty || s.employment.hireDate <= addYears(s.employee.birthDate!, 60);

/** [PHIC] 5% of MBS with PHP10,000 floor and PHP100,000 ceiling, equally shared. Tracker PH-SRC01 DEFAULT: the
 * employee half truncates to the centavo, the employer carries the remainder. */
function phic(mbs: number): Charge {
	const base = Math.min(Math.max(mbs, 10000), 100000);
	const premium = r2(base * 0.05);
	const employee = trunc2(premium / 2);
	return { employee, employer: r2(premium - employee), base };
}

/** [HDMF] Circular 460 p.1–3. Mandatory for private employees "not over sixty (60) years old" (1.1.1). */
function hdmf(s: PHScenario, fundSalary: number, periodStart: string): Charge | undefined {
	// DEFAULT: "not over sixty" read as SSS IRR reads it — up to the day of the 60th birthday — judged on the period's first day.
	if (fundSalary <= 0 || periodStart > addYears(s.employee.birthDate!, 60)) return undefined;
	if (s.employment.type === 'DOMESTIC' && fundSalary < 5000)
		// [HDMF] 1.5: kasambahay below PHP5,000: employer shoulders 3% (≤1,500) or 4% (over 1,500), kasambahay nothing.
		return {
			employee: 0,
			employer: r2(fundSalary * (fundSalary <= 1500 ? 0.03 : 0.04)),
			base: fundSalary
		};
	const base = Math.min(fundSalary, 10000); // [HDMF] maximum fund salary PHP10,000
	return {
		employee: r2(base * (base <= 1500 ? 0.01 : 0.02)), // [HDMF] C: 1% at PHP1,500 and below, 2% over
		employer: r2(base * 0.02),
		base
	};
}

/** [ANNEXE] monthly column 2023 onward. */
const MONTHLY = [
	[666667, 183541.8, 0.35],
	[166667, 33541.8, 0.3],
	[66667, 8541.8, 0.25],
	[33333, 1875, 0.2],
	[20833, 0, 0.15],
	[0, 0, 0]
] as const;
/** [RR11] s.2.79(B)(5)(b) step 3(b): annual table 2023 onward. */
const ANNUAL = [
	[8000000, 2202500, 0.35],
	[2000000, 402500, 0.3],
	[800000, 102500, 0.25],
	[400000, 22500, 0.2],
	[250000, 0, 0.15],
	[0, 0, 0]
] as const;
const rung = (table: typeof MONTHLY | typeof ANNUAL, x: number) => table.find(([lo]) => x >= lo)!;
const tableTax = (table: typeof MONTHLY | typeof ANNUAL, x: number) => {
	const [lo, fixed, rate] = rung(table, x);
	return fixed + rate * (x - lo);
};

// ---------- one month's earnings ----------
type Earnings = {
	lines: Record<string, number>;
	basic: number;
	/** hours premiums a minimum-wage earner keeps exempt ([RR11] (B)(13)) */
	premiums: number;
};

/** DEFAULT: an unpaid break is taken after the first four hours worked. */
function workedMinutes(e: WorkEntry) {
	const start = Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3));
	let end = Number(e.end.slice(0, 2)) * 60 + Number(e.end.slice(3));
	if (end <= start) end += 24 * 60;
	const out: { night: boolean }[] = [];
	for (let t = start, worked = 0; t < end; t++) {
		const span = t - start;
		if (span >= 240 && span < 240 + e.breakMinutes) continue;
		const clock = t % (24 * 60);
		out.push({ night: clock >= 22 * 60 || clock < 6 * 60 }); // [LC] art.86: 10 p.m.–6 a.m.
		worked++;
	}
	return out;
}

/**
 * [LC] arts.87, 93, 94; [HB] ch.3–5. Multipliers of the hourly rate for a monthly-paid worker whose wage already
 * pays every weekday ([EMR] 261 includes regular holidays and special days):
 *   ordinary day OT 125%; rest day 130%, its OT 130% × 130%; special day worked +30% over the paid day, its OT
 *   130% × 130%; special day on the rest day 150%, OT 150% × 130%; regular holiday worked +100% over the paid day,
 *   its OT 200% × 130%; night differential 10% of the hour's own rate.
 * DEFAULT (law silent on rounding and line names; the seed's work lines): every hours premium is one OVERTIME
 * line per work day and premium class, the night differential one NIGHT_PREMIUM line per work day, each rounded
 * to the centavo before the month sums them.
 */
function hoursPremiums(s: PHScenario) {
	const rate = hourly(s);
	const lines: Record<string, number> = {};
	let day: Record<string, number> = {};
	const add = (code: string, minutes: number, mult: number) => {
		if (minutes > 0) day[code] = (day[code] ?? 0) + rate * mult * (minutes / 60);
	};
	for (const e of s.work) {
		const rest = dow(e.date) === 0;
		const kind = REGULAR_HOLIDAYS.has(e.date)
			? 'RH'
			: SPECIAL_DAYS.has(e.date)
				? rest
					? 'SHR'
					: 'SH'
				: rest
					? 'REST'
					: 'ORD';
		// [day rate, extra paid on top of the monthly wage for normal hours, OT rate]
		const [dayRate, normalExtra, otRate, code] = {
			ORD: [1, 0, 1.25, 'OVERTIME'],
			REST: [1.3, 1.3, 1.69, 'REST_DAY'],
			SH: [1.3, 0.3, 1.69, 'SPECIAL_DAY'],
			SHR: [1.5, 1.5, 1.95, 'SPECIAL_DAY_REST'],
			RH: [2, 1, 2.6, 'REGULAR_HOLIDAY']
		}[kind] as [number, number, number, string];
		const minutes = workedMinutes(e);
		const normal = minutes.slice(0, s.employment.hoursPerDay * 60);
		const ot = minutes.slice(s.employment.hoursPerDay * 60);
		day = {};
		if (kind !== 'ORD') add(code, normal.length, normalExtra);
		add(kind === 'ORD' ? 'OVERTIME' : `${code}_OT`, ot.length, otRate);
		add('NIGHT_PREMIUM', normal.filter((m) => m.night).length, dayRate * 0.1);
		add('NIGHT_PREMIUM', ot.filter((m) => m.night).length, otRate * 0.1);
		for (const [k, v] of Object.entries(day)) {
			const line = k === 'NIGHT_PREMIUM' ? k : 'OVERTIME';
			lines[line] = r2((lines[line] ?? 0) + r2(v));
		}
	}
	return lines;
}

function unpaidDays(s: PHScenario) {
	const days = new Set(s.unpaidLeave);
	// [HB] ch.2 §A: no regular-holiday pay when absent without pay on the workday immediately preceding it.
	for (const h of REGULAR_HOLIDAYS)
		if (
			h.startsWith(s.period) &&
			isWeekday(h) &&
			days.has(precedingWorkday(h)) &&
			!s.work.some((w) => w.date === h)
		)
			days.add(h);
	const { from, to } = window(s, s.period);
	return [...days].filter((d) => d >= from && d <= to && isWeekday(d));
}

// ---------- the payslip ----------
export function computePayslip(s: PHScenario): Payslip {
	const warnings: string[] = [];
	const refuse = (why: string): Payslip => ({
		refused: why,
		warnings,
		lines: {},
		gross: 0,
		total_deductions: 0,
		net: 0,
		employer_cost: 0
	});
	// Tracker PH-SS10: an unknown birth date refuses a payable SSS assessment.
	if (s.employee.birthDate === null)
		return refuse('birth date unknown: SSS compulsory coverage age undecidable');

	const { from, to } = window(s, s.period);
	const emp = s.employment;
	const domestic = emp.type === 'DOMESTIC';

	// Minimum wage ([NCR28] ss.1–4; [NCRDW] ss.1–2, 5; [RA12063] s.13(b); tracker PH-A3, PH-WG59).
	let mwe = false;
	if (domestic) {
		// [NCRDW] s.5: no exemption from the domestic floor.
		for (let d = from; d <= to; d = addDays(d, 1))
			if (emp.monthlyBasic < domesticFloor(d)) return refuse(`below the domestic floor on ${d}`);
	} else {
		const scale = (emp.hoursPerDay / 8) * (emp.type === 'APPRENTICE' ? 0.75 : 1);
		const rate = dailyRate(s);
		const below = weekdays(from, to).find((d) => rate + 1e-9 < dailyFloor(s.sector, d) * scale);
		if (below !== undefined) {
			if (!emp.minimumWageExemption) return refuse(`below the minimum wage on ${below}`);
			warnings.push('paid below the minimum wage under a recorded board exemption');
		}
		// [RR11] (B)(13): a minimum-wage earner is one paid the statutory minimum wage (not more).
		mwe =
			emp.type !== 'APPRENTICE' &&
			!emp.minimumWageExemption &&
			weekdays(from, to).every((d) => Math.abs(rate - dailyFloor(s.sector, d) * scale) < 1e-6);
	}

	// Earnings.
	const lines: Record<string, Line> = {};
	const earn = (code: string, amount: number) => {
		if (Math.abs(amount) >= 0.005)
			lines[code] = { amount: r2((lines[code]?.amount ?? 0) + amount) };
	};
	// DEFAULT (the seed's work lines): BASIC is the part month's salary; unpaid days are a separate ABSENCE
	// deduction inside gross. The oracle leaves the ABSENCE line unnamed (gross carries it).
	const unpaid = unpaidDays(s);
	const absence = r2(dailyRate(s) * unpaid.length);
	const basic = r2(basicFor(s, s.period) - absence);
	earn('BASIC', basicFor(s, s.period));
	const premiums = hoursPremiums(s);
	for (const [k, v] of Object.entries(premiums)) earn(k, v);
	const premiumTotal = Object.values(premiums).reduce((a, b) => a + b, 0);
	earn('COMMISSION', s.commission ?? 0);
	earn('BONUS', s.performanceBonus ?? 0);

	const exiting = emp.exitDate !== undefined && emp.exitDate <= monthEnd(s.period);
	const yearStart = `${s.period.slice(0, 4)}-01-01`;
	const history = priorMonths(s);

	// [HB] ch.13 / PD 851: one twelfth of the basic salary earned in the calendar year; rank-and-file only; at least
	// one month worked. DEFAULT: "worked at least a month" judged at the year's end or the exit.
	let thirteenth = 0;
	if (s.thirteenthMonth && !emp.managerial) {
		const start = emp.hireDate > yearStart ? emp.hireDate : yearStart;
		const end = addDays(exiting ? emp.exitDate! : `${s.period.slice(0, 4)}-12-31`, 1);
		if (wholeMonths(start, end) >= 1)
			thirteenth = r2((history.reduce((a, h) => a + h.basic, 0) + basic) / 12);
	}
	earn('THIRTEENTH_MONTH_PAY', thirteenth);

	// Service for separation and retirement: [LC] arts.298–299, 302 "a fraction of at least six (6) months shall be
	// considered one (1) whole year". DEFAULT: calendar months from hire to the day after exit.
	const months = exiting ? wholeMonths(emp.hireDate, addDays(emp.exitDate!, 1)) : 0;
	const years = Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
	let separation = 0;
	if (exiting) {
		const month = emp.monthlyBasic;
		const cause = s.exitCause;
		// [LC] art.298: redundancy / labour-saving device: one month per year, at least one month.
		if (cause === 'REDUNDANCY' || cause === 'LABOUR_SAVING')
			separation = Math.max(month, month * years);
		// [LC] arts.298–299: retrenchment, closure not due to serious losses, disease: half a month per year, at least one month.
		if (cause === 'RETRENCHMENT' || cause === 'CLOSURE' || cause === 'DISEASE')
			separation = Math.max(month, (month / 2) * years);
	}
	earn('SEPARATION_PAY', separation);
	// [LC] art.302 (RA 7641): retiring at 60–65 with at least five years: 22.5 days per year of service.
	let retirement = 0;
	if (exiting && s.exitCause === 'RETIREMENT') {
		const age = ageOn(s.employee.birthDate, emp.exitDate!);
		if (age >= 60 && age <= 65 && Math.floor(months / 12) >= 5)
			retirement = 22.5 * dailyRate(s) * years;
	}
	earn('RETIREMENT_PAY', retirement);
	// [LC] art.95; [HB] ch.6: unused SIL commuted at the salary rate (days given by the scenario).
	const sil =
		exiting && (s.silDaysToEncash ?? 0) > 0 && months >= 12 ? dailyRate(s) * s.silDaysToEncash! : 0;
	earn('SIL_ENCASHMENT', sil);
	// [RA10361] s.32: unjust dismissal → 15 days' indemnity; unjustified departure → up to 15 days' unpaid pay forfeited.
	// DEFAULT (seed `ordinary_divisor_days`): fifteen days at monthly × 12/261 on the scenario's Mon–Fri roster.
	const fifteenDays = domestic ? 15 * dailyRate(s) : 0;
	if (domestic && exiting && s.exitCause === 'KASAMBAHAY_UNJUST_DISMISSAL')
		earn('KASAMBAHAY_INDEMNITY', fifteenDays);
	const forfeiture =
		domestic && exiting && s.exitCause === 'KASAMBAHAY_UNJUSTIFIED_DEPARTURE'
			? r2(Math.min(basic, fifteenDays))
			: 0;

	// Contribution bases.
	const amt = (c: string) => lines[c]?.amount ?? 0;
	// [SSSIRR] s.6: salaries, commission, bonuses (except Christmas bonus), OT, vacation leave with pay. The 13th month
	// is the Christmas-bonus exception (tracker PH-SS08). DEFAULT: separation, retirement pay and the kasambahay
	// indemnity are not remuneration for the month's work — outside SSS and Pag-IBIG.
	const hoursPay = premiumTotal;
	const sssComp = basic + hoursPay + amt('COMMISSION') + amt('BONUS') + amt('SIL_ENCASHMENT');
	// [HDMF] "Fund Salary": basic plus remuneration however designated for work done. DEFAULT: the 13th month is
	// outside it (tracker PH-A1 treats it as a non-counting class).
	const fundSalary = sssComp;
	const periodStart = monthStart(s.period);
	const charges: Record<string, Charge> = { ...sss(s, sssComp) };
	// [PHIC] §IV.F: MBS is the fixed basic, before leave-without-pay deductions; excludes commission, OT, bonus,
	// 13th month. DEFAULT: a month the employment touches is assessed on the full contractual monthly basic.
	charges.PHIC = phic(emp.monthlyBasic);
	const hd = hdmf(s, fundSalary, periodStart);
	if (hd) charges.HDMF = hd;
	if (domestic) {
		// [RA10361] s.30: a domestic worker "who has rendered at least one (1) month of service shall be covered" by
		// SSS, PhilHealth and Pag-IBIG. DEFAULT: judged at the end of the employed window (month end or exit).
		if (wholeMonths(emp.hireDate, addDays(to, 1)) < 1)
			for (const k of ['SSS', 'SSS_EC', 'SSS_MPF', 'PHIC', 'HDMF']) delete charges[k];
		// [RA10361] s.30: premiums "shall be shouldered by the employer" unless the worker is "receiving a wage of Five
		// thousand pesos (P5,000.00) and above per month" — the monthly wage, not a part month's pay. SSS (CI 2024-007)
		// and Pag-IBIG (Circular 460 1.5) carry their own household branches above.
		else if (emp.monthlyBasic < 5000 && charges.PHIC)
			charges.PHIC = {
				employee: 0,
				employer: r2(charges.PHIC.employee + charges.PHIC.employer),
				base: charges.PHIC.base
			};
	}
	const eeContrib = Object.values(charges).reduce((a, c) => a + c.employee, 0);

	// Withholding tax.
	const wtax = withholding(s, {
		basic,
		hoursPay,
		eeContrib,
		mwe,
		commission: amt('COMMISSION'),
		benefits: amt('BONUS') + thirteenth,
		exiting,
		history
	});
	if (wtax.amount !== 0) charges.WTAX = { employee: wtax.amount, employer: 0, base: wtax.base };

	for (const [code, c] of Object.entries(charges))
		lines[code] = { employee: c.employee, employer: c.employer, base: c.base };
	// DEFAULT (the seed's catalogue destinations): the forfeiture is a deduction line and the 13th month a net
	// addition (both NET), so neither is in gross; the unpaid days come off gross.
	if (forfeiture > 0) lines.KASAMBAHAY_FORFEITURE = { amount: forfeiture };
	const outsideGross = new Set(['KASAMBAHAY_FORFEITURE', 'THIRTEENTH_MONTH_PAY']);
	const gross = r2(
		Object.entries(lines).reduce(
			(a, [k, l]) =>
				k in charges || l.amount === undefined || outsideGross.has(k) ? a : a + l.amount,
			-absence
		)
	);
	const total_deductions = r2(
		Object.values(charges).reduce((a, c) => a + c.employee, 0) + forfeiture
	);
	const employer_cost = r2(gross + Object.values(charges).reduce((a, c) => a + c.employer, 0));
	return {
		warnings,
		lines,
		gross,
		total_deductions,
		net: r2(gross + thirteenth - total_deductions),
		employer_cost
	};
}

type History = { basic: number; taxable: number; withheld: number }[];
/**
 * ASSUMPTION (scenario.history = 'CONSTANT_BASIC'): each earlier month of the calendar year with this employer paid
 * only the basic (weekday-prorated in the hire month), contributions on it, and Annex E withholding on the rest;
 * no previous employer in the year. Needed only by the annualisation and cumulative-average methods.
 */
function priorMonths(s: PHScenario): History {
	const out: History = [];
	const year = Number(s.period.slice(0, 4));
	const last = Number(s.period.slice(5, 7));
	for (let m = 1; m < last; m++) {
		const p = `${year}-${String(m).padStart(2, '0')}`;
		if (s.employment.hireDate > monthEnd(p)) continue;
		const basic = basicFor(s, p);
		const charges = { ...sss(s, basic), PHIC: phic(s.employment.monthlyBasic) };
		const hd = hdmf(s, basic, monthStart(p));
		const ee = Object.values(charges).reduce((a, c) => a + c.employee, 0) + (hd?.employee ?? 0);
		const taxable = Math.max(0, basic - ee);
		out.push({ basic, taxable, withheld: r2(tableTax(MONTHLY, taxable)) });
	}
	return out;
}

function withholding(
	s: PHScenario,
	x: {
		basic: number;
		hoursPay: number;
		eeContrib: number;
		mwe: boolean;
		commission: number;
		benefits: number;
		exiting: boolean;
		history: History;
	}
) {
	// [RR11] (B)(11): 13th month and other benefits exempt up to PHP90,000 a year; the excess is supplementary.
	const excessBenefits = Math.max(0, x.benefits - 90000);
	// [NIRC25] NRA not engaged in trade or business: 25% final on gross compensation (no table, no exclusion of contributions).
	if (s.employee.residency === 'NRA_NETB') {
		const base = r2(x.basic + x.hoursPay + x.commission + excessBenefits);
		return { amount: r2(base * 0.25), base };
	}
	// [RR11] (B)(12) contributions excluded; (B)(13) an MWE's SMW and holiday/OT/night pay exempt.
	// NIRC s.32(B)(7)(f): the employee's SSS, PhilHealth and Pag-IBIG contributions are excluded from gross income,
	// so for an MWE (whose SMW is exempt anyway) they relieve the other taxable pay (RR 11-2018 Illustration 4 is
	// silent on them; the seed's WTAX base nets them from whatever is taxable).
	const regular = x.mwe ? 0 : Math.max(0, x.basic - x.eeContrib);
	const supplementary = x.mwe
		? Math.max(0, x.commission + excessBenefits - x.eeContrib)
		: x.hoursPay + x.commission + excessBenefits;
	const total = regular + supplementary;
	const priorTaxable = x.history.reduce((a, h) => a + h.taxable, 0);
	const priorWithheld = x.history.reduce((a, h) => a + h.withheld, 0);
	const isDecember = s.period.endsWith('-12');
	if (x.exiting || isDecember) {
		// [RR11] (B)(5)(b): annualise on the last month of employment or in December; excess refunded (negative).
		const annual = priorTaxable + total;
		return { amount: r2(tableTax(ANNUAL, annual) - priorWithheld), base: r2(annual) };
	}
	// [RR11] (B)(5)(a) triggers: regular exempt (below the compensation level) with supplementary paid, or
	// supplementary ≥ regular.
	const cumulative = supplementary > 0 && (regular <= 20833 || supplementary >= regular);
	if (cumulative) {
		const n = x.history.length + 1;
		const average = (priorTaxable + total) / n;
		return { amount: r2(tableTax(MONTHLY, average) * n - priorWithheld), base: r2(total) };
	}
	// [RR11] (B) steps 3–4: rung chosen on taxable regular pay, rate applied to the excess of regular + supplementary.
	const [lo, fixed, rate] = rung(MONTHLY, regular);
	return { amount: r2(fixed + rate * (total - lo)), base: r2(total) };
}

/** The probe harness's line keys ([payroll-probe.ts] `lines`): statutory keys only when non-zero. */
export function probeLines(slip: Payslip): Record<string, number> {
	const out: Record<string, number> = {
		gross: slip.gross,
		net: slip.net,
		total_deductions: slip.total_deductions,
		employer_cost: slip.employer_cost
	};
	for (const [code, l] of Object.entries(slip.lines)) {
		if (l.amount !== undefined) out[code] = l.amount;
		if (l.employee !== undefined && l.employee !== 0) out[`${code}.employee`] = l.employee;
		if (l.employer !== undefined && l.employer !== 0) out[`${code}.employer`] = l.employer;
	}
	return out;
}
