/**
 * Independent oracle for the CN-shanghai payroll profile.
 *
 * Every figure below is transcribed from the law as the tracker `docs/inventory/china.csv` cites it (row id in each
 * comment, primary source URL beside it). Nothing here is read from `src/**` or `seed/**`: a difference between this
 * oracle and a saved payslip is a finding against one of the two, never a reason to copy the engine.
 *
 * Where the law is silent the oracle applies the lawful default the tracker records for that row (owner rule
 * 2026-09-28) and says so in a `DEFAULT:` comment. Where the law is missing (not silent) the figure is an operator-
 * recorded fact carried by the scenario (`contributions.*`) and marked `RECORDED:`. Where neither exists the scenario
 * reports the head as `unpriced` rather than inventing a figure.
 *
 * Money is exact: cents as BigInt, every rate as a decimal rational, rounding only where the law (or the recorded
 * default) rounds.
 */
import type { Scenario } from '../profiles/CN-shanghai.ts';

// ─── Law tables ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Statutory holidays (300% days) and the 2026 放假调休 schedule.
 * State Council Order 795 art.2 (https://www.gov.cn/zhengce/content/202411/content_6986380.htm), from 1 Jan 2025:
 * 元旦 1 day; 春节 4 days (除夕, 初一–初三); 清明 1; 劳动节 2 (1–2 May); 端午 1; 中秋 1; 国庆 3 (1–3 Oct).
 * Dated for 2026 by 国办发明电〔2025〕7号 (https://www.gov.cn/zhengce/content/202511/content_7047090.htm, read
 * 2026-09-30): 春节 2026-02-17 → 除夕 02-16; 清明 04-05; 端午 06-19; 中秋 09-25. CN-N03.
 */
const STATUTORY_HOLIDAYS = new Set([
	'2026-01-01',
	'2026-02-16',
	'2026-02-17',
	'2026-02-18',
	'2026-02-19',
	'2026-04-05',
	'2026-05-01',
	'2026-05-02',
	'2026-06-19',
	'2026-09-25',
	'2026-10-01',
	'2026-10-02',
	'2026-10-03'
]);
/** 国办发明电〔2025〕7号 放假 ranges (days off; the non-statutory ones are rest days, 200%). */
const DAYS_OFF_2026: readonly [string, string][] = [
	['2026-01-01', '2026-01-03'],
	['2026-02-15', '2026-02-23'],
	['2026-04-04', '2026-04-06'],
	['2026-05-01', '2026-05-05'],
	['2026-06-19', '2026-06-21'],
	['2026-09-25', '2026-09-27'],
	['2026-10-01', '2026-10-07']
];
/** 国办发明电〔2025〕7号 调整上班日 (weekend days that are working days). */
const ADJUSTED_WORKDAYS = new Set([
	'2026-01-04',
	'2026-02-14',
	'2026-02-28',
	'2026-05-09',
	'2026-09-20',
	'2026-10-10'
]);

/** 人社部发〔2025〕2号 (CN-N02): 21.75 paid days a month, 8 hours a day, for day/hour wage conversion. */
const PAID_DAYS = { n: 2175n, d: 100n };
const HOURS_PER_DAY = 8n;

/** 沪人社规〔2025〕10号 (CN-SH01), from 1 Jul 2025: monthly CNY2,740 full-time, hourly CNY25 non-full-time. */
const MIN_MONTHLY = 274000n;
const MIN_HOURLY = 2500n;

/**
 * Social-insurance base bounds by contribution year (CN-SH05).
 * 2025 year (1 Jul 2025–30 Jun 2026): 7,460–37,302, https://rsj.sh.gov.cn/tgsgg_17341/20250918/t0035_1435637.html
 * 2026 year (1 Jul 2026–): 7,546–37,731, https://rsj.sh.gov.cn/tgsgg_17341/20260818/t0035_1443203.html
 */
const SI_BOUNDS = { 2025: [746000n, 3730200n], 2026: [754600n, 3773100n] } as const;
/**
 * Housing-fund base bounds by contribution year.
 * 2025: 2,690–37,302, 沪公积金管委会〔2025〕8号 (CN-SH09). 2026: 2,740–37,731, 沪公积金管委会〔2026〕3号 (CN-SH40).
 */
const HF_BOUNDS = { 2025: [269000n, 3730200n], 2026: [274000n, 3773100n] } as const;

/**
 * Published Shanghai 全口径 monthly average wage (CN-SH50): 12,434 for 2024, 12,577 for 2025.
 * DEFAULT (CN-SH50, owner rule 2026-09-28): the calendar year before the exit — 2025 exits on 12,434, 2026 on 12,577.
 */
const CITY_AVERAGE_BY_EXIT_YEAR: Record<number, bigint> = { 2025: 1243400n, 2026: 1257700n };

/**
 * Resident cumulative withholding table, STA 2018 No. 61 annex table 1 (CN-N38,
 * https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3963396/content.html): [upper bound, rate %, QD].
 */
const ANNUAL_TABLE: readonly [bigint | null, bigint, bigint][] = [
	[3600000n, 3n, 0n],
	[14400000n, 10n, 252000n],
	[30000000n, 20n, 1692000n],
	[42000000n, 25n, 3192000n],
	[66000000n, 30n, 5292000n],
	[96000000n, 35n, 8592000n],
	[null, 45n, 18192000n]
];
/**
 * Monthly table: non-resident wages (STA 2018 No. 61 table 3, CN-N38) and the monthly-converted table used for the
 * separately taxed annual bonus (MOF/STA 2023 No. 30, CN-N10) — same bands and QDs.
 */
const MONTHLY_TABLE: readonly [bigint | null, bigint, bigint][] = [
	[300000n, 3n, 0n],
	[1200000n, 10n, 21000n],
	[2500000n, 20n, 141000n],
	[3500000n, 25n, 266000n],
	[5500000n, 30n, 441000n],
	[8000000n, 35n, 716000n],
	[null, 45n, 1516000n]
];
/** IIT Law art.6(1)/(2): CNY5,000 a month basic expense (60,000 a year). */
const BASIC_EXPENSE = 500000n;

// ─── Exact arithmetic ──────────────────────────────────────────────────────────────────────────────────────────────

type Q = { n: bigint; d: bigint };
/** A decimal number (≤ 2 dp for money, any dp for rates) as an exact rational. */
const q = (x: number): Q => {
	const s = x.toString();
	if (/e/i.test(s)) throw new Error(`oracle: ${s} is not a plain decimal`);
	const [i, f = ''] = s.split('.');
	return { n: BigInt(i + f), d: 10n ** BigInt(f.length) };
};
const cents = (yuan: number): bigint => {
	const r = q(yuan);
	return (r.n * 100n) / r.d;
};
/** n / d rounded half away from zero (四舍五入). */
const div = (n: bigint, d: bigint): bigint => {
	const neg = n < 0n !== d < 0n;
	const a = n < 0n ? -n : n;
	const b = d < 0n ? -d : d;
	const r = (2n * a + b) / (2n * b);
	return neg ? -r : r;
};
const clamp = (x: bigint, lo: bigint, hi: bigint) => (x < lo ? lo : x > hi ? hi : x);
const max0 = (x: bigint) => (x < 0n ? 0n : x);
const yuan = (c: bigint) => Number(c) / 100;

/** A table's tax on a taxable amount (cents): taxable × rate − QD, to the fen. */
const tableTax = (table: typeof ANNUAL_TABLE, taxable: bigint): bigint => {
	if (taxable <= 0n) return 0n;
	const [, rate, qd] = table.find(([upper]) => upper === null || taxable <= upper)!;
	return div(taxable * rate, 100n) - qd;
};

// ─── Calendar ──────────────────────────────────────────────────────────────────────────────────────────────────────

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86400000));
const monthStart = (ym: string) => `${ym}-01`;
const monthEnd = (ym: string) => {
	const [y, m] = ym.split('-').map(Number);
	return iso(new Date(Date.UTC(y!, m!, 0)));
};
const ymOf = (s: string) => s.slice(0, 7);
const nextYm = (ym: string) => ymOf(addDays(monthEnd(ym), 1));
const daysBetween = (a: string, b: string) => Math.round((day(b).getTime() - day(a).getTime()) / 86400000);

export type DayType = 'WORKDAY' | 'REST' | 'HOLIDAY';
/** Labour Law art.44 day classes on the dated calendar above. */
export function dayType(date: string): DayType {
	if (!date.startsWith('2026') && !date.startsWith('2025-12'))
		throw new Error(`oracle: no transcribed calendar for ${date}`);
	if (STATUTORY_HOLIDAYS.has(date)) return 'HOLIDAY';
	if (ADJUSTED_WORKDAYS.has(date)) return 'WORKDAY';
	if (DAYS_OFF_2026.some(([a, b]) => a <= date && date <= b)) return 'REST';
	const dow = day(date).getUTCDay();
	return dow === 0 || dow === 6 ? 'REST' : 'WORKDAY';
}
/** A month with no holiday, 调休 day or adjusted workday: its weekdays are exactly its working days. */
export function plainMonth(ym: string): boolean {
	for (let d = monthStart(ym); d <= monthEnd(ym); d = addDays(d, 1)) {
		const dow = day(d).getUTCDay();
		if ((dayType(d) === 'WORKDAY') !== (dow !== 0 && dow !== 6)) return false;
	}
	return true;
}
const workdays = (from: string, to: string) => {
	let n = 0;
	for (let d = from; d <= to; d = addDays(d, 1)) if (dayType(d) === 'WORKDAY') n++;
	return n;
};

/** Whole months from `from` to `toExclusive`, and the leftover days. */
function serviceSpan(from: string, toExclusive: string) {
	let months = 0;
	const at = (m: number) => {
		const [y, mo, d] = from.split('-').map(Number);
		const t = new Date(Date.UTC(y!, mo! - 1 + m, 1));
		const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
		return iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d!, last))));
	};
	while (at(months + 1) <= toExclusive) months++;
	return { months, days: daysBetween(at(months), toExclusive) };
}

// ─── Result ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Charge = { base: number; employee: number; employer: number };
export type Expected = {
	/** The run is refused (the probe's `refused`); `lines` is then empty. */
	refused?: { code: string; rows: string[] };
	/** Probe line keys: gross, net, total_deductions, employer_cost, component codes, `<scheme>.employee|employer`. */
	lines: Record<string, number>;
	components: Record<string, number>;
	statutory: Record<string, Charge>;
	/** Law-defined warnings the run must carry (codes, not engine text). */
	warnings: string[];
	/** Heads the law leaves unpriced for this scenario (no figure is invented): the tracker row and what is missing. */
	unpriced: { row: string; what: string }[];
	/** The cumulative-withholding months the answer depends on, oldest first (each must be run in order). */
	runs: string[];
};

type Month = {
	components: Record<string, bigint>;
	/** comprehensive (cumulative) wage income this month */
	wageIncome: bigint;
	si: Record<string, { base: bigint; ee: bigint; er: bigint }>;
	separate: Record<string, { base: bigint; ee: bigint }>;
	refused?: { code: string; rows: string[] };
	warnings: string[];
	unpriced: { row: string; what: string }[];
};

// ─── One month ─────────────────────────────────────────────────────────────────────────────────────────────────────

function contributionYear(ym: string): 2025 | 2026 {
	// CN-SH05 / SH09 / SH40: the contribution year runs 1 July – 30 June.
	if (ym >= '2025-07' && ym <= '2026-06') return 2025;
	if (ym >= '2026-07' && ym <= '2027-06') return 2026;
	throw new Error(`oracle: no transcribed contribution year for ${ym}`);
}

function month(s: Scenario, ym: string, isPeriod: boolean): Month {
	const out: Month = { components: {}, wageIncome: 0n, si: {}, separate: {}, warnings: [], unpriced: [] };
	const e = s.employment;
	const from = e.hireDate > monthStart(ym) ? e.hireDate : monthStart(ym);
	const exit = isPeriod ? e.exitDate : null;
	const to = exit !== null && exit < monthEnd(ym) ? exit : monthEnd(ym);
	const wholeMonth = from === monthStart(ym) && to === monthEnd(ym);
	const W = cents(e.monthlyWage);
	const add = (code: string, c: bigint, wage = true) => {
		if (c === 0n) return;
		out.components[code] = (out.components[code] ?? 0n) + c;
		if (wage) out.wageIncome += c;
	};

	// ── Pay for time ──
	if (e.kind === 'PART_TIME') {
		// LCL art.68/72 (CN-N27): hourly pay; 沪人社规〔2025〕10号 hourly floor CNY25 (CN-SH01).
		const rate = cents(e.hourlyWage ?? 0);
		if (rate < MIN_HOURLY) out.refused = { code: 'MINIMUM_WAGE_HOURLY', rows: ['CN-SH01', 'CN-N50', 'CN-N27'] };
		const h = q(s.month.partTimeHours);
		add('BASIC', div(rate * h.n, h.d));
	} else if (wholeMonth) {
		add('BASIC', W);
	} else {
		// DEFAULT (CN-N02, recorded): a part month pays its working days at the 21.75-day wage. 人社部发〔2025〕2号
		// fixes only the day-wage divisor; the calendar here is exact only in a month without 调休, so the oracle
		// refuses to guess elsewhere.
		if (!plainMonth(ym)) throw new Error(`oracle: part month ${ym} has holidays or 调休; not transcribed`);
		add('BASIC', div(W * BigInt(workdays(from, to)) * PAID_DAYS.d, PAID_DAYS.n));
	}
	if (isPeriod && s.month.unpaidLeaveDays > 0) {
		// 劳部发〔1994〕489号 / 人社部发〔2025〕2号 (CN-N02, N04): an unpaid day is monthly ÷ 21.75.
		add('UNPAID_LEAVE', -div(W * BigInt(s.month.unpaidLeaveDays) * PAID_DAYS.d, PAID_DAYS.n));
	}

	// ── Overtime, Labour Law art.44 (CN-N01, SH03, N40) ──
	if (isPeriod && s.month.overtime.length > 0) {
		// SH03 (Shanghai wage measure item 9): base is the contract monthly wage (a bonus stays out), ÷ 21.75 ÷ 8.
		// Rates: extended weekday 150%; rest day 200% unless compensatory rest is arranged (then nothing);
		// statutory holiday 300%, never replaceable by time off (art.44(3), CN-N40).
		let halfHourPercent = 0n; // Σ (hours × 2) × percent
		let weekdayHours = 0;
		const daily = new Map<string, number>();
		for (const o of s.month.overtime) {
			const t = dayType(o.date);
			const pct = t === 'HOLIDAY' ? 300n : t === 'REST' ? (o.compensatoryRest ? 0n : 200n) : 150n;
			halfHourPercent += BigInt(Math.round(o.hours * 2)) * pct;
			if (t === 'WORKDAY') {
				weekdayHours += o.hours;
				daily.set(o.date, (daily.get(o.date) ?? 0) + o.hours);
			}
		}
		// W × hours × pct / (21.75 × 8 × 100), one rounding to the fen (law silent on rounding; the fen is exact).
		add('OVERTIME', div(W * halfHourPercent * PAID_DAYS.d, PAID_DAYS.n * HOURS_PER_DAY * 2n * 100n));
		// Art.41: at most 3 h a day and 36 h a month of extended hours. Pay is still owed on every hour (art.44);
		// the cap is reported, not forfeited.
		if ([...daily.values()].some((h) => h > 3)) out.warnings.push('DAILY_OVERTIME_LIMIT_EXCEEDED');
		if (weekdayHours > 36) out.warnings.push('OVERTIME_LIMIT_EXCEEDED');
	}

	// ── Allowances and bonuses ──
	if (isPeriod && s.month.heatExposed) {
		// 沪人社规〔2019〕19号 (CN-SH19, N26): CNY300/month, June–September, for exposed work; wages, taxed; outside the
		// minimum-wage comparison (CN-SH01). A higher contract figure is paid as agreed.
		const m = Number(ym.slice(5));
		if (m >= 6 && m <= 9) add('HEAT_ALLOWANCE', cents(Math.max(300, s.month.heatAllowanceContract)));
	}
	if (isPeriod && s.month.bonus > 0) add('BONUS', cents(s.month.bonus)); // CN-N53: contractual; wages (CN-N10)
	if (isPeriod)
		for (const [code, amount] of Object.entries(s.month.nonWage))
			// 国税发〔1994〕89号 item 2 (CN-N55): not of wage nature, untaxed, outside every base.
			add(code, cents(amount ?? 0), false);

	// ── Social insurance (CN-N07, SH05, SH06, SH07) ──
	const pensioner = s.worker.pensionRecipient; // CN-N13, SH41 art.21: a pension recipient is outside SI and fund
	if (e.kind === 'PART_TIME') {
		// 劳社部发〔2003〕12号: a non-full-time employer owes work-injury insurance; its Shanghai base is not in the tracker.
		out.unpriced.push({ row: 'CN-N27', what: 'INJURY for a non-full-time worker (base not transcribed)' });
	} else if (!pensioner) {
		const year = contributionYear(ym);
		const [lo, hi] = SI_BOUNDS[year];
		const base = clamp(cents(s.contributions.siBase), lo, hi);
		// Owner rule (CN-X-SI-ROUNDING): each side to the fen, half-up.
		const share = (rate: number) => {
			const r = q(rate);
			return div(base * r.n, r.d);
		};
		// Pension 16% / 8%: HRSS employer-rate guidance (CN-SH06).
		out.si.PENSION = { base, er: share(0.16), ee: share(0.08) };
		// Medical 9% (8.5% incl. maternity + 0.5% local) / 2%: 沪医保规〔2025〕2号 to 28 Feb 2026, 〔2026〕2号 from 1 Mar
		// 2026 to 28 Feb 2027 (CN-SH06). Maternity is inside medical in Shanghai: no separate scheme.
		if (ym > '2027-02') throw new Error('oracle: no medical instrument after Feb 2027');
		out.si.MEDICAL = { base, er: share(0.09), ee: share(0.02) };
		// Unemployment: 0.5% / 0.5% to 31 Dec 2025 (2025 notice, CN-SH06). 2026: employee 0.5% per the Sep 2026
		// municipal/HRSS guide; RECORDED: the employer rate has no 2026 instrument, so it is the operator's fact.
		const erU = ym <= '2025-12' ? 0.005 : s.contributions.unemploymentEmployerRate2026;
		out.si.UNEMPLOYMENT = { base, er: share(erU), ee: share(0.005) };
		// RECORDED (CN-SH07): employer-only work injury at the assigned class/float rate (classes I–VIII 0.2–1.9%).
		out.si.INJURY = { base, er: share(s.contributions.injuryRate), ee: 0n };
	}

	// ── Housing fund (CN-N08, SH09, SH40, SH41, SH43) ──
	const hfCovered =
		e.kind !== 'PART_TIME' && // SH41 art.5: part-time workers contribute personally, outside payroll
		!pensioner &&
		(s.worker.citizenship === 'CN' || s.worker.housingFundAgreement) && // SH41 art.6: foreign/HMT by agreement
		!(s.contributions.hfFirstEver && ymOf(e.hireDate) === ym); // SH43 / Regulation art.17: first-ever from month 2
	if (hfCovered) {
		const year = contributionYear(ym);
		const [lo, hi] = HF_BOUNDS[year];
		const base = clamp(cents(s.contributions.hfBase), lo, hi);
		// SH09/SH40: each side's ordinary and supplementary share rounded separately to the whole yuan (四舍五入).
		const yuanShare = (rate: number) => {
			const r = q(rate);
			return div(base * r.n, r.d * 100n) * 100n;
		};
		const each = yuanShare(s.contributions.hfRate) + yuanShare(s.contributions.hfSupplementaryRate);
		out.si.HOUSING_FUND = { base, er: each, ee: each };
	}

	// ── Minimum wage (CN-SH01, N50) ──
	if (e.kind === 'FULL_TIME' && wholeMonth && (!isPeriod || s.month.unpaidLeaveDays === 0)) {
		// Qualifying pay = contract wage for the normal hours, less the employee's SI and fund shares; overtime and the
		// listed allowances (heat, night, meals, commute, housing) are outside by construction.
		const ee = ['PENSION', 'MEDICAL', 'UNEMPLOYMENT', 'HOUSING_FUND'].reduce(
			(t, k) => t + (out.si[k]?.ee ?? 0n),
			0n
		);
		if (W - ee < MIN_MONTHLY) out.refused = { code: 'MINIMUM_WAGE', rows: ['CN-SH01', 'CN-N50'] };
	} else if (e.kind === 'FULL_TIME') {
		out.unpriced.push({ row: 'CN-SH01', what: 'minimum-wage test on a part month or with unpaid leave' });
	}

	if (isPeriod) exitPay(s, ym, out, W);
	if (isPeriod && s.month.annualBonusSeparate > 0) annualBonus(s, out);
	return out;
}

// ─── Exit ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function exitPay(s: Scenario, ym: string, out: Month, W: bigint) {
	const e = s.employment;
	if (s.exit === null || e.exitDate === null || ymOf(e.exitDate) !== ym) return;
	const x = s.exit;
	const end = addDays(e.exitDate, 1);
	const span = serviceSpan(e.hireDate, end);
	const hiredThisMonth = ymOf(e.hireDate) === ym;
	if (!hiredThisMonth && !e.hireDate.endsWith('-01'))
		throw new Error('oracle: an average over a part first month is not transcribed; hire on the 1st');
	// Implementing Regulation art.27 (应得工资) with LCL art.47 (actual months if under 12): with every earlier month a
	// whole month at the contract wage, the average is the contract wage. DEFAULT (CN-SH-A2): hired in the exit month
	// → the contract monthly wage. Floored at the minimum wage (art.27).
	const avg = W < MIN_MONTHLY ? MIN_MONTHLY : W;

	// ── Annual leave on exit (CN-N05, N06, N18) ──
	if (e.kind === 'FULL_TIME') {
		// Regulation art.2–3 / Shanghai measure: 12 months' cumulative service to qualify; 5/10/15 days at 1/10/20
		// years' cumulative service (all employers). DEFAULT (CN-N05): the band reached is granted in full.
		const total = span.months + s.worker.priorServiceMonths;
		const E = total >= 240 ? 15 : total >= 120 ? 10 : total >= 12 ? 5 : 0;
		// Measure art.12: floor(days at this employer this year ÷ 365 × entitlement) − days taken, never negative.
		const yearStart = `${ym.slice(0, 4)}-01-01`;
		const days = daysBetween(e.hireDate > yearStart ? e.hireDate : yearStart, end);
		const payable = Math.max(0, Math.floor((days * E) / 365) - x.annualLeaveTakenThisYear);
		// Measure art.10–11 (CN-N06): unused days at 300% of the day wage, 100% already paid → a further 200%; the day
		// wage is the 12-month average excluding overtime ÷ 21.75.
		if (payable > 0)
			out.components.ANNUAL_LEAVE_ENCASHMENT = div(avg * BigInt(payable) * 2n * PAID_DAYS.d, PAID_DAYS.n);
		out.wageIncome += out.components.ANNUAL_LEAVE_ENCASHMENT ?? 0n;
	}

	// ── Economic compensation, LCL arts.46–47, 87; Implementing Regulation art.20 (CN-N41, N12, SH50) ──
	if (e.kind === 'PART_TIME') return; // LCL art.71: no economic compensation on ending non-full-time work
	const due =
		['ART36_EMPLOYER', 'ART38', 'ART40', 'ART41'].includes(x.ground) ||
		(x.ground === 'ART44_EXPIRY' && !x.renewalOfferRefused); // art.46(5)
	if (!due && x.ground !== 'ART87') return; // art.37 resignation, art.39 dismissal, employee-proposed art.36
	// Art.47: one month per full year; a remainder of six months or more counts a year, under six months half.
	const r = span.months % 12;
	let years = Math.floor(span.months / 12) + (r >= 6 ? 1 : r > 0 || span.days > 0 ? 0.5 : 0);
	const exitYear = Number(e.exitDate.slice(0, 4));
	const city = CITY_AVERAGE_BY_EXIT_YEAR[exitYear];
	if (city === undefined) throw new Error(`oracle: no city average for a ${exitYear} exit`);
	let base = avg;
	// Art.47 para.2: above 3 × the city average, the base is capped there and the years at twelve.
	if (avg > 3n * city) {
		base = 3n * city;
		years = Math.min(years, 12);
	}
	const halves = BigInt(Math.round(years * 2));
	// Art.87 (Implementing Regulation art.25): unlawful termination is twice the art.47 standard, instead of it.
	let pay = x.ground === 'ART87' ? div(base * halves * 2n, 2n) : div(base * halves, 2n);
	// Art.40 + Implementing Regulation art.20: without 30 days' written notice, one month's pay at the prior month's
	// wage (the contract wage; CN-SH-A2 for a hire in the exit month).
	if (x.ground === 'ART40' && x.noticeDaysGiven < 30) pay += W;
	if (pay === 0n) return;
	out.components.SEVERANCE_PAY = pay;
	// 财税〔2018〕164号 item 5(1) (CN-N39): exempt up to 3 × the local prior-year average annual wage (36 × the monthly
	// figure, DEFAULT CN-SH50 series); the excess taxed alone on the annual table, outside comprehensive income.
	if (!s.worker.taxResident) {
		out.unpriced.push({ row: 'CN-N39', what: 'termination lump sum of a non-resident' });
		return;
	}
	out.separate.IIT_SEVERANCE = { base: pay, ee: tableTax(ANNUAL_TABLE, max0(pay - 36n * city)) };
}

function annualBonus(s: Scenario, out: Month) {
	const B = cents(s.month.annualBonusSeparate);
	out.components.ANNUAL_BONUS_SEPARATE = B;
	// STA rule (CN-N10): the separate method at most once per person per year.
	if (s.tax.annualBonusSeparateUsedThisYear) {
		out.refused = { code: 'ANNUAL_BONUS_SEPARATE_ONCE_PER_YEAR', rows: ['CN-N10'] };
		return;
	}
	if (s.worker.taxResident) {
		// MOF/STA 2023 No. 30 (CN-N10): the rate by bonus ÷ 12 on the monthly table (compared exactly: B ≤ 12 × upper);
		// tax = bonus × rate − QD.
		const [, rate, qd] = MONTHLY_TABLE.find(([u]) => u === null || B <= u * 12n)!;
		out.separate.IIT_BONUS = { base: B, ee: max0(div(B * rate, 100n) - qd) };
	} else {
		// MOF/STA 2019 No. 35 item 3(2) (CN-N10): non-resident multi-month bonus [(B ÷ 6) × rate − QD] × 6, once a year.
		const [, rate, qd] = MONTHLY_TABLE.find(([u]) => u === null || B <= u * 6n)!;
		out.separate.IIT_BONUS = { base: B, ee: max0(div(B * rate, 100n) - 6n * qd) };
	}
}

// ─── The payslip ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Every run of this employer in the period's tax year up to the period (STA 2018 No. 61 art.6: same-employer YTD). */
export function runsFor(s: Scenario): string[] {
	const yearStart = `${s.period.slice(0, 4)}-01`;
	let ym = ymOf(s.employment.hireDate) > yearStart ? ymOf(s.employment.hireDate) : yearStart;
	if (ym < '2025-12') throw new Error(`oracle: ${s.id} needs a ${ym} run before the transcribed range`);
	const out: string[] = [];
	for (; ym <= s.period; ym = nextYm(ym)) out.push(ym);
	return out;
}

export function computePayslip(s: Scenario): Expected {
	const runs = runsFor(s);
	const months = runs.map((ym) => month(s, ym, ym === s.period));
	const now = months.at(-1)!;
	const result: Expected = {
		lines: {},
		components: {},
		statutory: {},
		warnings: now.warnings,
		unpriced: now.unpriced,
		runs
	};
	const refused = months.find((m) => m.refused)?.refused;
	// Special additional deductions (CN-N16, N54): child education and infant care 2,000/child/month (2023 No. 14),
	// elder support as declared (≤3,000); housing rent 1,500/month in Shanghai (国发〔2018〕41号), never with loan interest.
	const sd = s.tax.specialDeductions;
	const rentAndLoan = sd.rent && sd.loanInterest;
	if (refused || (rentAndLoan && s.worker.taxResident)) {
		result.refused = refused ?? { code: 'RENT_AND_LOAN_INTEREST', rows: ['CN-N54', 'CN-N16'] };
		return result;
	}

	// ── IIT on wages (CN-N09, N38, N11, N44) ──
	let iit = 0n;
	if (s.worker.taxResident) {
		const special =
			BigInt(sd.childEducationChildren + sd.infantCareChildren) * 200000n +
			cents(sd.elderSupport) +
			(sd.rent ? 150000n : 0n) +
			(sd.loanInterest ? 100000n : 0n);
		let withheld = 0n;
		for (const [i, m] of months.entries()) {
			const ym = runs[i]!;
			const n = BigInt(i + 1);
			// Basic expense: 5,000 × months at this employer this year; STA 2020 No. 13 (N44): from January for a
			// first wage income of the year; STA 2020 No. 19 (N11): 60,000 at once on the recorded election.
			const monthNo = BigInt(Number(ym.slice(5)));
			const basic = s.tax.annual60kElection
				? 12n * BASIC_EXPENSE
				: (s.tax.firstWageIncomeThisYear ? monthNo : n) * BASIC_EXPENSE;
			const upto = months.slice(0, i + 1);
			const income = upto.reduce((t, x) => t + x.wageIncome, 0n);
			const ee = upto.reduce(
				(t, x) => t + Object.values(x.si).reduce((u, c) => u + c.ee, 0n),
				0n
			);
			const taxable = income - basic - ee - special * n;
			// Period tax = cumulative taxable × rate − QD − tax already withheld, never below zero (no refund).
			const tax = max0(tableTax(ANNUAL_TABLE, taxable) - withheld);
			withheld += tax;
			if (i === months.length - 1) iit = tax;
		}
	} else {
		// IIT Law art.6(2) (CN-N38): non-resident wage income less 5,000 on the monthly table; no insurance, fund or
		// special relief (STA 2022 No. 7 annex 2 item 11(1)②).
		iit = max0(tableTax(MONTHLY_TABLE, now.wageIncome - BASIC_EXPENSE));
	}

	for (const [code, c] of Object.entries(now.components)) result.components[code] = yuan(c);
	for (const [code, c] of Object.entries(now.si))
		result.statutory[code] = { base: yuan(c.base), employee: yuan(c.ee), employer: yuan(c.er) };
	if (iit > 0n) result.statutory.IIT = { base: yuan(now.wageIncome), employee: yuan(iit), employer: 0 };
	for (const [code, c] of Object.entries(now.separate))
		result.statutory[code] = { base: yuan(c.base), employee: yuan(c.ee), employer: 0 };

	// Probe line keys. Presentation convention (not law): gross = Σ components; total_deductions = Σ employee
	// statutory; net = gross − deductions; employer_cost = gross + Σ employer statutory.
	const gross = Object.values(now.components).reduce((t, c) => t + c, 0n);
	let ee = 0n;
	let er = 0n;
	for (const [code, c] of Object.entries(result.statutory)) {
		if (c.employee !== 0) result.lines[`${code}.employee`] = c.employee;
		if (c.employer !== 0) result.lines[`${code}.employer`] = c.employer;
		ee += cents(c.employee);
		er += cents(c.employer);
	}
	Object.assign(result.lines, result.components, {
		gross: yuan(gross),
		total_deductions: yuan(ee),
		net: yuan(gross - ee),
		employer_cost: yuan(gross + er)
	});
	return result;
}
