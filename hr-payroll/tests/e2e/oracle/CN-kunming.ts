/**
 * Independent oracle for CN-kunming: an expected payslip computed from the law alone, never from `src/**` or `seed/**`.
 *
 * Every rule below cites the tracker row (`docs/inventory/china.csv`) and the official instrument that row reads. Where
 * the law is silent the owner rule applies (law silent → a lawful, consistent default); each such default is marked
 * `DEFAULT:` with the reason. Where the law needs a figure no official source gives (an agency determination, a missing
 * 2026 renewal instrument), the figure is a declared scenario fact, or the key is returned in `unpriced` and the caller
 * must not judge it.
 *
 * Line keys follow `tests/e2e/payroll-probe.ts`: `gross`, `net`, `total_deductions`, component codes (summed), and
 * `<scheme>.employee` / `<scheme>.employer` for each statutory charge. Scheme codes are the tracker's `config_path`
 * codes (PENSION, MEDICAL, MATERNITY, UNEMPLOYMENT, INJURY, HOUSING_FUND, IIT, IIT_BONUS, IIT_SEVERANCE); pay component
 * codes are the tracker's catalogue codes where it names one (OVERTIME, BONUS, ANNUAL_BONUS_SEPARATE, SEVERANCE_PAY,
 * MATERNITY_ALLOWANCE_OFFSET) and otherwise descriptive (BASIC, UNPAID_LEAVE, LEAVE_ENCASHMENT). `bases` gives the
 * contribution base per scheme. Compare `gross`, `net` and the statutory keys first; a component split may differ
 * (e.g. the engine may put overtime above the art.41 limits on INCENTIVE — the sum is what the law fixes).
 */
import type { Scenario, Region } from '../profiles/CN-kunming.ts';

export type Payslip = {
	/** the law forbids the input or the run; `stage` says where, `reason` what */
	refused?: { stage: 'input' | 'run'; reason: string };
	lines: Record<string, number>;
	bases: Record<string, number>;
	/** RegExp-ready descriptions of the warnings the law's breach reports imply */
	warnings: string[];
	/** keys the law requires but whose figure no official source in the tracker fixes (do not judge them) */
	unpriced: string[];
};

// ---------------------------------------------------------------------------------------------------------------
// Rounding. Social insurance: to the fen, half-up, per side — CN-X-SI-ROUNDING (law silent; owner-rule default, no
// instrument prescribes coarser rounding). Housing fund: each side to the whole yuan, 四舍五入, separately —
// 昆公积金规〔2020〕2号 art.13 (CN-KM05, CN-KM20). Tax: to the fen — STA 2018 No.61 (CN-N38 "Tax to the fen").
// Pay lines: DEFAULT the fen, half-up (law silent; the exact amount to the smallest unit).
const fen = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7) / 100;
const yuan = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);

// ---------------------------------------------------------------------------------------------------------------
// Calendar helpers (UTC, ISO dates).
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(ms(d) + n * 86_400_000);
const monthStart = (p: string) => `${p}-01`;
const monthEnd = (p: string) => {
	const [y, m] = p.split('-').map(Number);
	return iso(Date.UTC(y!, m!, 0));
};
const weekday = (d: string) => new Date(ms(d)).getUTCDay();
/** Mon–Fri days in [from, to]. DEFAULT: the statutory-holiday/调休 calendar is not applied (CN-N03 is a GAP); a
 * weekday holiday is a paid day inside the 21.75 conversion (人社部发〔2025〕2号 counts holidays as paid days). */
export const weekdays = (from: string, to: string) => {
	let n = 0;
	for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) % 6 !== 0) n++;
	return n;
};
const nextPeriod = (p: string) => addDays(monthEnd(p), 1).slice(0, 7);
const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);

// ---------------------------------------------------------------------------------------------------------------
// Minimum wage — CN-KM01 (云人社发〔2025〕19号, from 1 Oct 2025) and CN-KM02 (Yunnan HRSS notice of 29 Aug 2026, from
// 1 Sep 2026). Class I: Wuhua/Panlong/Xishan/Guandu/Chenggong/Jinning, Anning, Songming; class II: other Kunming
// counties and Dongchuan; class III: Mo Han (remains in Mengla County, "other counties" class). The monthly floor
// includes the worker's own SI/fund shares and excludes overtime and specified allowances (最低工资规定 art.12,
// CN-N50), so it is tested on the contract wage for normal hours. The hourly floor binds part-time (LCL art.72, CN-N27).
const MIN_WAGE = [
	{ from: '2025-10-01', monthly: { I: 2170, II: 2020, III: 1870 }, hourly: { I: 21, II: 20, III: 19 } },
	{ from: '2026-09-01', monthly: { I: 2270, II: 2120, III: 1970 }, hourly: { I: 22, II: 21, III: 20 } }
] as const;
export const minimumWage = (day: string, region: Region) => {
	const row = [...MIN_WAGE].reverse().find((r) => r.from <= day);
	if (row === undefined) throw new Error(`no Kunming minimum wage sourced before 2025-10-01 (${day})`);
	return { monthly: row.monthly[region], hourly: row.hourly[region] };
};

// ---------------------------------------------------------------------------------------------------------------
// Social-insurance bases — CN-KM03. 2025 (Yunnan 2025 parameters): 4,357–21,789 for every scheme (CN-KM04's October
// 2025 base). 云人社发〔2026〕8号: 4,403–22,017. Medical/maternity from its express start, 1 Sep 2026. Pension,
// unemployment, injury: the notice names only 2026年度 — DEFAULT (owner rule, recorded in CN-KM03) from January 2026.
type SiScheme = 'PENSION' | 'MEDICAL' | 'MATERNITY' | 'UNEMPLOYMENT' | 'INJURY';
export const siBounds = (scheme: SiScheme, day: string): [number, number] => {
	const medical = scheme === 'MEDICAL' || scheme === 'MATERNITY';
	const switchDay = medical ? '2026-09-01' : '2026-01-01';
	return day < switchDay ? [4357, 21789] : [4403, 22017];
};

// Rates. Pension 16% employer / 8% worker — Yunnan service pack Q82 and the 7 Sep 2026 county HRSS notice (CN-KM25).
// Medical 7% employer / 2% worker — Kunming NHSA/Finance notice of 30 Dec 2022 (employer 8% → 7% excl. maternity) and
// Yunnan Government Order 86 art.6 (worker 2%) (CN-KM04). Maternity 0.9% employer, worker nothing — Kunming 2024
// maternity rules item 2 (CN-KM32). Injury employer only at the agency-assigned class rate 0.2–1.9% — 云人社发〔2020〕14号
// (CN-KM26); the assigned rate is a declared fact. Unemployment 0.7% / 0.3% — the 2025 HRSS notice through 31 Dec 2025
// and the 7 Sep 2026 county notice ("目前，延续实施") (CN-KM27); January–August 2026 has no sourced instrument, so the
// rate there is the operator's declared fact, or unpriced.
const RATE = {
	PENSION: { employer: 0.16, employee: 0.08 },
	MEDICAL: { employer: 0.07, employee: 0.02 },
	MATERNITY: { employer: 0.009, employee: 0 }
} as const;
const unemploymentRates = (day: string, s: Scenario) =>
	day < '2026-01-01' || day >= '2026-09-01'
		? { employer: 0.007, employee: 0.003 }
		: s.facts.unemploymentRates;

// Housing fund — CN-KM05 / CN-KM20 / CN-N08. Cap: 32,470 for 2025 (昆公积金〔2025〕61号); 32,543 for 2026 (昆公积金〔2026〕69号,
// final, retroactive to 1 Jan 2026). Floors: 2,170 / 2,020 / 1,870 from October 2025 and kept for all contributors by
// the 4 Jan 2026 interim notice; 2,270 / 2,120 / 1,970 from 1 Sep 2026 (Mo Han–Mo Ding class III). DEFAULT: the text
// is silent on unchanged existing accounts, so the dated floor applies to every account (one consistent reading; the
// interim notice already applies its floor to all). Rate 5–12%, equal both sides (management measure arts.10–14).
export const fundBounds = (day: string, region: Region): [number, number] => {
	const cap = day < '2026-01-01' ? 32470 : 32543;
	const floor = (day < '2026-09-01' ? { I: 2170, II: 2020, III: 1870 } : { I: 2270, II: 2120, III: 1970 })[region];
	return [floor, cap];
};
const clamp = (x: number, [lo, hi]: [number, number]) => Math.min(Math.max(x, lo), hi);

// ---------------------------------------------------------------------------------------------------------------
// IIT tables — CN-N38 (STA 2018 No.61 annex tables 1 and 3). Resident annual cumulative table; the monthly table is
// the non-resident wage table and the monthly conversion table for the separate annual bonus (MOF/STA 2023 No.30) and
// the non-resident multi-month bonus (MOF/STA 2019 No.35 item 3(2), CN-KM-A1). Bands are ceiling-inclusive.
const ANNUAL = [
	[36000, 0.03, 0],
	[144000, 0.1, 2520],
	[300000, 0.2, 16920],
	[420000, 0.25, 31920],
	[660000, 0.3, 52920],
	[960000, 0.35, 85920],
	[Infinity, 0.45, 181920]
] as const;
const MONTHLY = [
	[3000, 0.03, 0],
	[12000, 0.1, 210],
	[25000, 0.2, 1410],
	[35000, 0.25, 2660],
	[55000, 0.3, 4410],
	[80000, 0.35, 7160],
	[Infinity, 0.45, 15160]
] as const;
const band = (table: typeof ANNUAL | typeof MONTHLY, x: number) => table.find(([to]) => x <= to)!;
const onTable = (table: typeof ANNUAL | typeof MONTHLY, x: number) => {
	if (x <= 0) return 0;
	const [, rate, qd] = band(table, x);
	return Math.max(0, x * rate - qd);
};

// ---------------------------------------------------------------------------------------------------------------
// One month.
type Month = {
	lines: Record<string, number>;
	bases: Record<string, number>;
	/** wage income for cumulative IIT (IIT Law art.6: 工资薪金) */
	wageIncome: number;
	/** worker SI + fund shares, deductible for a resident (IIT Law art.6(1) 专项扣除) */
	employeeShares: number;
	warnings: string[];
	unpriced: string[];
	refused?: Payslip['refused'];
};

const contractWageOn = (s: Scenario, day: string) =>
	s.employment.raise !== undefined && day >= s.employment.raise.from
		? s.employment.raise.monthlyWage
		: s.employment.monthlyWage;

/** Basic pay for the employed span of a month — CN-N02 (人社部发〔2025〕2号: 21.75 paid days a month) and CN-N04.
 * Whole month: the monthly wage; a rise inside it splits the month by working days (CN-KM-WP03, recorded default of
 * CN-N02: "a mid-month rise splits one month's 21.75 across its two rates by working days"). Part month (joiner or
 * leaver): working days in the span × monthly ÷ 21.75 (CN-N02 recorded default), DEFAULT capped at the monthly wage. */
function basicPay(s: Scenario, period: string) {
	const from = max(monthStart(period), s.employment.hireDate);
	const to = min(monthEnd(period), s.employment.exitDate ?? '9999-12-31');
	if (from > to) return 0;
	const all = weekdays(monthStart(period), monthEnd(period));
	const worked = weekdays(from, to);
	const segments: [string, string][] = [];
	const rise = s.employment.raise?.from;
	if (rise !== undefined && rise > from && rise <= to) segments.push([from, addDays(rise, -1)], [rise, to]);
	else segments.push([from, to]);
	if (worked === all)
		return segments.reduce((sum, [a, b]) => sum + (contractWageOn(s, a) * weekdays(a, b)) / all, 0);
	const pay = segments.reduce((sum, [a, b]) => sum + (contractWageOn(s, a) / 21.75) * weekdays(a, b), 0);
	return Math.min(pay, contractWageOn(s, to));
}

function month(s: Scenario, period: string, final: boolean): Month {
	const first = monthStart(period);
	const last = monthEnd(period);
	const lines: Record<string, number> = {};
	const bases: Record<string, number> = {};
	const warnings: string[] = [];
	const unpriced: string[] = [];
	const add = (code: string, amount: number) => {
		if (amount !== 0) lines[code] = fen((lines[code] ?? 0) + amount);
	};
	const pt = s.employment.partTime;
	const region = s.employment.wageRegion;

	// --- minimum wage (CN-KM01/02, CN-KM-WP03 art.8, CN-N50; part-time hourly LCL art.72, CN-N27)
	const onDay = max(first, s.employment.hireDate);
	const floor = minimumWage(onDay, region);
	if (pt !== undefined) {
		if (pt.hourlyRate < floor.hourly)
			return refusal('run', `hourly wage ${pt.hourlyRate} below the ${region} hourly minimum ${floor.hourly}`);
	} else {
		for (const day of [onDay, s.employment.raise?.from].filter((d): d is string => d !== undefined && d <= last)) {
			const need = minimumWage(max(day, first), region).monthly;
			if (contractWageOn(s, day) < need)
				return refusal('run', `monthly wage ${contractWageOn(s, day)} below the ${region} minimum ${need}`);
		}
	}

	// --- pay
	let wageIncome = 0;
	if (pt !== undefined) {
		add('BASIC', pt.hourlyRate * pt.hours);
	} else {
		add('BASIC', basicPay(s, period));
		const dayRate = contractWageOn(s, last) / 21.75; // CN-N02: 21.75 conversion days
		if (final && s.time.unpaidDays) add('UNPAID_LEAVE', -dayRate * s.time.unpaidDays); // CN-N04, CN-KM-WP12 (art.25)
		// Overtime — Labour Law art.44 (CN-N01, CN-KM-WP08): hourly = monthly ÷ 21.75 ÷ 8 (人社部发〔2025〕2号);
		// weekday 150%; rest day 200% unless compensatory rest is arranged; statutory holiday 300%, never replaced.
		const ot = final ? s.time.overtime : undefined;
		if (ot !== undefined) {
			const hour = contractWageOn(s, last) / 21.75 / 8;
			add('OVERTIME', fen(hour * 1.5 * (ot.weekdayHours ?? 0)));
			if (!ot.restDayCompensatoryRest) add('OVERTIME', fen(hour * 2 * (ot.restDayHours ?? 0)));
			add('OVERTIME', fen(hour * 3 * (ot.holidayHours ?? 0)));
			// Labour Law art.41 (CN-N40): extended hours at most 3 a day and 36 a month. Pay is still owed on
			// hours worked; the breach is a report, not a forfeit. Rest-day and holiday work are not 延长工作时间.
			if ((ot.weekdayHours ?? 0) > 36) warnings.push('monthly overtime limit|36');
			if ((ot.maxDailyWeekdayHours ?? 0) > 3) warnings.push('daily overtime limit|3');
		}
		// Paid statutory leave: no deduction (CN-KM-WP12, CN-KM30, CN-KM12, CN-KM31, CN-N51, CN-KM-WP13).
		const leave = final ? s.time.leave : undefined;
		if (leave !== undefined) {
			const over = leaveRefusal(leave);
			if (over !== undefined) return refusal('input', over);
		}
		// Maternity — CN-KM32: the fund allowance (employer prior-year average ÷ 30 × leave days, an agency
		// determination, declared) paid to the employer offsets the wage; the employer tops up to the wage (recorded
		// owner default; 女职工劳动保护特别规定 art.5). Allowance at or above the wage: nothing more is due.
		if (final && s.pay.maternityAllowance !== undefined)
			add('MATERNITY_ALLOWANCE_OFFSET', -Math.min(s.pay.maternityAllowance, lines.BASIC ?? 0));
	}
	wageIncome = Object.values(lines).reduce((a, b) => a + b, 0);

	// --- bonus (CN-N53: contractual; paid, it is wages)
	const bonus = final ? s.pay.bonus : undefined;
	if (bonus !== undefined) {
		if (bonus.kind === 'BONUS') {
			add('BONUS', bonus.amount);
			wageIncome += bonus.amount;
		} else {
			if (bonus.usedThisYear)
				return refusal('run', `${bonus.kind} already used this calendar year (once per person per year)`);
			if (bonus.kind === 'ANNUAL_BONUS_SEPARATE' && !s.employee.taxResident)
				return refusal('run', 'the separate annual-bonus method is a resident election (MOF/STA 2023 No.30)');
			if (bonus.kind === 'MULTI_MONTH_NONRESIDENT' && s.employee.taxResident)
				return refusal('run', 'the multi-month bonus spread is a non-resident method (MOF/STA 2019 No.35)');
			// both separate methods are elected through the ANNUAL_BONUS_SEPARATE class (CN-KM-A1 config_path)
			add('ANNUAL_BONUS_SEPARATE', bonus.amount);
		}
	}

	// --- social insurance
	let employeeShares = 0;
	const employed = s.employment.hireDate <= last && (s.employment.exitDate ?? '9999') >= first;
	// DEFAULT: a month in which the worker is employed on any day is a contribution month on the full declared base
	// (Social Insurance Law art.58 enrolment within 30 days of hire; law silent on part months — one consistent rule).
	// Enrolment status does not matter: an unregistered worker is still assessed (CN-KM28, CN-N37).
	const retired = s.employee.pensionRecipient === true;
	if (employed && pt === undefined && !retired) {
		const declared = s.facts.siBase ?? s.employment.monthlyWage;
		const charge = (scheme: SiScheme, rates: { employer: number; employee: number }) => {
			const base = clamp(declared, siBounds(scheme, first));
			bases[scheme] = base;
			const employee = fen(base * rates.employee);
			const employer = fen(base * rates.employer);
			if (employee !== 0) lines[`${scheme}.employee`] = employee;
			if (employer !== 0) lines[`${scheme}.employer`] = employer;
			employeeShares += employee;
		};
		charge('PENSION', RATE.PENSION);
		charge('MEDICAL', RATE.MEDICAL);
		charge('MATERNITY', RATE.MATERNITY);
		const u = unemploymentRates(first, s);
		if (u === undefined) unpriced.push('UNEMPLOYMENT.employee', 'UNEMPLOYMENT.employer');
		else charge('UNEMPLOYMENT', u);
		charge('INJURY', { employer: s.facts.injuryRate, employee: 0 });
		// CN-KM04: the major-medical employer charge (0.6% × provincial average wage per head, truncated) and the
		// worker's CNY1 a month have no verified 2026 figure or official original — not judged.
		unpriced.push('major-medical');
	}
	// Part-time: employer-only injury insurance (Yunnan injury measure art.2, CN-KM14); the base is unsourced.
	if (employed && pt !== undefined) unpriced.push('INJURY.employer');
	// Over-age managed workers from 1 Jul 2026 (Order 56, CN-N14): employer-only injury; amount unsourced.
	if (employed && retired && first >= '2026-07-01') unpriced.push('INJURY.employer');

	// --- housing fund (CN-KM05, CN-KM18, CN-KM20, CN-N08)
	const rate = s.facts.fundRate;
	if (employed && pt === undefined && !retired && rate !== null) {
		if (rate < 0.05) return refusal('input', `fund rate ${rate} below 5% needs fund-centre approval (CN-KM21)`);
		if (rate > 0.12) return refusal('input', `fund rate ${rate} above the 12% maximum (CN-KM20)`);
		const hireMonth = s.employment.hireDate.slice(0, 7);
		// First-ever account: nothing in the joining month; from the second month on that month's full wage
		// (management measure arts.10–14, CN-KM20). Transferred: from the first month on the full monthly wage.
		const firstEverJoining = s.facts.fundAccount === 'FIRST_EVER' && hireMonth === period;
		if (!firstEverJoining) {
			const declared =
				s.facts.fundAccount === 'EXISTING'
					? (s.facts.fundBase ?? s.employment.monthlyWage) // prior calendar-year average, declared
					: contractWageOn(s, last);
			const base = clamp(declared, fundBounds(first, region));
			bases.HOUSING_FUND = base;
			const share = yuan(base * rate);
			lines['HOUSING_FUND.employee'] = share;
			lines['HOUSING_FUND.employer'] = share;
			employeeShares += share;
		}
	}

	// --- exit (final month only)
	if (final && s.exit !== undefined) {
		const e = s.exit;
		const exitDay = s.employment.exitDate!;
		// Severance — LCL arts.46–47, 87 and Implementing Regulation arts.20, 27 (CN-N12, CN-N19, CN-N41).
		if (pt === undefined) {
			const due = severanceDue(s);
			if (due > 0) add('SEVERANCE_PAY', due);
		}
		// Annual-leave cash on exit — Paid Annual Leave Regulation and enterprise measure arts.10–12 (CN-N05/N06/N18):
		// floor(days worked this year ÷ 365 × full-year days) − days taken, never below 0, no clawback; paid at the
		// further 200% of the day wage (the 300% includes normal pay), day wage = the previous 12 months' average
		// excluding overtime ÷ 21.75. DEFAULT (tracker): no prior history differs from the contract wage.
		if (pt === undefined) {
			const service = (s.employee.priorServiceMonths ?? 0) + monthsBetween(s.employment.hireDate, exitDay);
			if (service >= 12) {
				const full = service >= 240 ? 15 : service >= 120 ? 10 : 5;
				const yearStart = max(`${exitDay.slice(0, 4)}-01-01`, s.employment.hireDate);
				const days = (ms(exitDay) - ms(yearStart)) / 86_400_000 + 1;
				const owed = Math.max(0, Math.floor((days / 365) * full + 1e-9) - (e.leaveTakenThisYear ?? 0));
				if (owed > 0) {
					const cash = fen(owed * (s.employment.monthlyWage / 21.75) * 2);
					add('LEAVE_ENCASHMENT', cash);
					wageIncome += cash;
				}
			}
		}
		// Final pay within five working days after the employment ends — 昆明市工资支付条例 art.13 (CN-KM-WP06).
		if (addWorkingDays(exitDay, 5) < last) warnings.push('final pay|five working days');
	}
	return { lines, bases, wageIncome, employeeShares, warnings, unpriced };
}

const refusal = (stage: 'input' | 'run', reason: string): Month => ({
	lines: {},
	bases: {},
	wageIncome: 0,
	employeeShares: 0,
	warnings: [],
	unpriced: [],
	refused: { stage, reason }
});

const addWorkingDays = (d: string, n: number) => {
	let day = d;
	while (n > 0) {
		day = addDays(day, 1);
		if (weekday(day) % 6 !== 0) n--;
	}
	return day;
};

/** Whole calendar months from `from` to `to` inclusive of the last day (a hire on the 16th and an exit on the 15th
 * six months later is 6 months). */
export function monthsBetween(from: string, to: string) {
	const end = addDays(to, 1);
	const [fy, fm, fd] = from.split('-').map(Number);
	const [ty, tm, td] = end.split('-').map(Number);
	return (ty! - fy!) * 12 + (tm! - fm!) - (td! < fd! ? 1 : 0);
}
/** true when a part month remains after the whole months */
const partMonth = (from: string, to: string) => {
	const m = monthsBetween(from, to);
	const [y, mo, d] = from.split('-').map(Number);
	const anniversary = iso(Date.UTC(y!, mo! - 1 + m, d!));
	return anniversary <= to;
};

/** Leave requests the Yunnan regulation does not grant (Yunnan Population and Family Planning Regulation arts.18, 19,
 * 35; national 国劳总薪字〔1980〕29号). Calendar-day leave: working days inside it are paid. */
function leaveRefusal(leave: NonNullable<Scenario['time']['leave']>): string | undefined {
	const grant: Record<string, number | undefined> = {
		// art.18: 15 days on top of the national 1–3 days; DEFAULT the discretionary maximum 3 (CN-N51) → 18
		MARRIAGE_LEAVE: 18,
		// art.18 para 2: each parent 10 days a year while a child is under 3; 15 with two or more under 3 (CN-KM12)
		CHILDCARE_LEAVE:
			(leave.childrenUnder3 ?? 0) >= 2 ? 15 : (leave.childrenUnder3 ?? 0) === 1 ? 10 : 0,
		// 国劳总薪字〔1980〕29号 1–3 days; DEFAULT the maximum 3 (CN-N51)
		FUNERAL_LEAVE: 3,
		// art.19: IUD insertion 7 days (CN-KM31)
		FAMILY_PLANNING_PROCEDURE_LEAVE: 7,
		// 工伤保险条例 art.33: stop-work period up to 12 + 12 months (CN-N21, CN-KM-WP13)
		WORK_INJURY_LEAVE: 731
	};
	const days = grant[leave.code];
	if (days === undefined) return undefined;
	if (leave.calendarDays > days)
		return `${leave.code}: ${leave.calendarDays} calendar days exceed the ${days} the law grants`;
	return undefined;
}

/** LCL art.47: one month per full year; a remainder of six months or more counts a year, under six months half a month;
 * the monthly wage is the prior-12-month average of the wage due (Regulation art.27), 3× the local average monthly wage
 * caps it and then the years at 12; art.87 doubles it; art.40 adds one month in lieu of 30 days' notice at the previous
 * month's wage (Regulation art.20). For a leaver hired in the exit month the average and the previous month are the
 * contract monthly wage (CN-SH-A2 recorded default). Hire dates are after 1 Jan 2008 (art.97 not exercised). */
export function severanceDue(s: Scenario) {
	const e = s.exit!;
	const hire = s.employment.hireDate;
	const exit = s.employment.exitDate!;
	const pays =
		e.cause === 'MUTUAL_EMPLOYER' ||
		e.cause === 'ART40' ||
		e.cause === 'ART41' ||
		e.cause === 'UNLAWFUL' ||
		(e.cause === 'EXPIRY' && !e.renewalOfferRefused);
	if (!pays) return 0;
	const months = monthsBetween(hire, exit);
	const years = Math.floor(months / 12);
	const rem = months % 12;
	let n = years + (rem >= 6 ? 1 : rem > 0 || partMonth(hire, exit) ? 0.5 : 0);
	// Regulation art.27 floor: not below the local minimum wage
	let avg = Math.max(s.employment.monthlyWage, minimumWage(exit, s.employment.wageRegion).monthly);
	const cap = 3 * e.localAverageMonthlyWage;
	if (avg > cap) {
		avg = cap;
		n = Math.min(n, 12);
	}
	let due = n * avg * (e.cause === 'UNLAWFUL' ? 2 : 1);
	if (e.cause === 'ART40' && (e.noticeDaysGiven ?? 0) < 30) due += s.employment.monthlyWage;
	return fen(due);
}

// ---------------------------------------------------------------------------------------------------------------
/** The expected payslip for the scenario's `period`, having run every month from `runsFrom` (cumulative IIT). */
export function computePayslip(s: Scenario): Payslip {
	// Child labour — 禁止使用童工规定 art.2 (CN-N29): no one under 16 may be recruited.
	if (ageOn(s.employee.birthDate, s.employment.hireDate) < 16)
		return { refused: { stage: 'input', reason: 'under 16 (child labour prohibited)' }, lines: {}, bases: {}, warnings: [], unpriced: [] };

	const year = s.period.slice(0, 4);
	let cumIncome = 0;
	let cumShares = 0;
	let cumWithheld = 0;
	let monthsEmployed = 0;
	let out: Month | undefined;
	for (let p = s.runsFrom; p <= s.period; p = nextPeriod(p)) {
		const final = p === s.period;
		const m = month(s, p, final);
		if (m.refused) return { refused: m.refused, lines: {}, bases: {}, warnings: [], unpriced: [] };
		if (p.slice(0, 4) === year && s.employment.hireDate <= monthEnd(p)) monthsEmployed++;
		// Resident: cumulative withholding — STA 2018 No.61 art.6 (CN-N09, CN-N38).
		let iit = 0;
		if (s.employee.taxResident) {
			cumIncome += m.wageIncome;
			cumShares += m.employeeShares;
			const monthNo = Number(p.slice(5, 7));
			// basic deduction: 5,000 × months employed at this unit this year; STA 2020 No.13 (CN-N44) first wage income
			// this year → 5,000 × months from January; STA 2020 No.19 (CN-N11) election → 60,000 from January.
			const basic = s.tax.basic60kElection
				? 60000
				: s.tax.firstIncomeThisYear
					? 5000 * monthNo
					: 5000 * monthsEmployed;
			// declared special additional deductions, deducted as declared (STA 2022 No.7 arts.25–26, CN-N16, CN-N54)
			const special = (s.tax.specialDeductionsMonthly ?? 0) * monthsEmployed;
			const taxable = fen(cumIncome - cumShares - basic - special);
			const cumTax = fen(onTable(ANNUAL, taxable));
			iit = Math.max(0, fen(cumTax - cumWithheld));
			cumWithheld = fen(cumWithheld + iit);
		} else {
			// Non-resident: (month's wage − 5,000) on the monthly table, no SI/fund relief (IIT Law art.6(2), CN-N38).
			iit = fen(onTable(MONTHLY, fen(m.wageIncome - 5000)));
		}
		if (iit > 0) m.lines['IIT.employee'] = iit;
		if (final) out = m;
	}
	const m = out!;
	// Separate bonus taxes (CN-N10, CN-KM-A1).
	const bonus = s.pay.bonus;
	if (bonus?.kind === 'ANNUAL_BONUS_SEPARATE') {
		const [, rate, qd] = band(MONTHLY, bonus.amount / 12);
		const tax = fen(Math.max(0, bonus.amount * rate - qd));
		if (tax > 0) m.lines['IIT_BONUS.employee'] = tax;
	}
	if (bonus?.kind === 'MULTI_MONTH_NONRESIDENT') {
		const tax = fen(onTable(MONTHLY, bonus.amount / 6) * 6);
		if (tax > 0) m.lines['IIT_BONUS.employee'] = tax;
	}
	// Severance tax — 财税〔2018〕164号 item 5(1) (CN-N39): exempt to 3 × the local prior-year average annual wage; the
	// excess taxed alone on the annual table. DEFAULT (owner rule, CN-N39): the same declared average as art.47.
	const severance = m.lines.SEVERANCE_PAY ?? 0;
	if (severance > 0) {
		const excess = fen(severance - 36 * s.exit!.localAverageMonthlyWage);
		const tax = fen(onTable(ANNUAL, excess));
		if (tax > 0) m.lines['IIT_SEVERANCE.employee'] = tax;
	}

	const pay = Object.entries(m.lines).filter(([k]) => !k.includes('.'));
	const gross = fen(pay.reduce((a, [, v]) => a + v, 0));
	const deductions = fen(
		Object.entries(m.lines)
			.filter(([k]) => k.endsWith('.employee'))
			.reduce((a, [, v]) => a + v, 0)
	);
	m.lines.gross = gross;
	m.lines.total_deductions = deductions;
	m.lines.net = fen(gross - deductions);
	return { lines: m.lines, bases: m.bases, warnings: m.warnings, unpriced: [...new Set(m.unpriced)] };
}

export const ageOn = (birth: string, day: string) => {
	const [by, bm, bd] = birth.split('-').map(Number);
	const [y, mo, d] = day.split('-').map(Number);
	return y! - by! - (mo! < bm! || (mo === bm && d! < bd!) ? 1 : 0);
};

/** Worker SI + fund shares for a month: the profile generator uses it to aim a resident's taxable income at a seam. */
export const employeeShares = (s: Scenario) => month(s, s.period, false).employeeShares;
