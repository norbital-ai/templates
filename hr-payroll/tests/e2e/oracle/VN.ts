/**
 * Independent VN payslip oracle: one monthly payslip computed from the law alone (no engine, no seed).
 *
 * Sources (transcriptions in docs/inventory/vietnam.csv, the row id named at each rule; Decree 145/2020 re-read
 * 2026-09-30 in Official Gazette 1203+1204, https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2020/12/32732/33806-1-20201203-1204145-2020-nd-cp.pdf):
 *   LC     Labour Code 45/2019/QH14 (consolidation 18/VBHN-VPQH), https://vanban.chinhphu.vn/?docid=217002&pageid=27160
 *          arts.46–47 (severance/job loss), 98 (OT/night), 104 (bonus), 107 (OT limits), 113 (annual leave), 168(3)
 *   D145   Decree 145/2020/ND-CP arts.8 (service count, ½-year rounding, 2-month job-loss floor), 55–57 (OT and
 *          night formulas), 66 (part-year leave, 50% month), 67(3) (encashment wage of the month before exit)
 *   D135   Decree 135/2020/ND-CP art.4, Annex I (retirement age by birth month), https://datafiles.chinhphu.vn/cpp/files/vbpq/2020/11/135.signed.pdf
 *   D74    Decree 74/2024/ND-CP art.3 (floors to 31 Dec 2025), https://vanban.chinhphu.vn/?pageid=27160&docid=210536
 *   D293   Decree 293/2025/ND-CP arts.3–4 (floors from 1 Jan 2026), https://vanban.chinhphu.vn/?docid=215832&pageid=27160
 *   SI     Social Insurance Law 41/2024/QH15 arts.2, 31, 33–34, https://vanban.chinhphu.vn/?pageid=27160&docid=211199
 *          (8% / 14%+3%+0.5%; floor = reference level; ceiling 20 × reference level; 14 unpaid working days)
 *   D161   Decree 161/2026/ND-CP art.3(2): reference level 2,530,000 from 1 July 2026 (2,340,000 before)
 *   HI     Decree 188/2025/ND-CP art.6(1)(a): 4.5% of the SI salary, employer 3%, employee 1.5%
 *   UI     Employment Law 74/2025/QH15 arts.31, 33–34 (from 2026; 1% + 1%, cap 20 × regional minimum, citizens only);
 *          Law 38/2013/QH13 arts.43, 57–58 (December 2025)
 *   TU     Trade Union Law 50/2024/QH15 art.29(1)(b) (employer fee 2% of the SI salary fund); VGCL Decision 61/QĐ-TLĐ
 *          (member dues 0.5% of the SI salary, capped at 10% of the base salary)
 *   PIT04  PIT Law 04/2007/QH12 art.22 (seven brackets), art.26 (non-resident 20%); Resolution 954/2020 (11m / 4.4m);
 *          Circular 111/2013/TT-BTC arts.2(2)(b)(b.6) (severance outside), 3(9) (OT premium exempt), 25(1)(i) (10% ≥ 2m)
 *   PIT109 PIT Law 109/2025/QH15 arts.4(8) (OT, night and untaken-leave pay exempt), 21 (non-resident 20%), 29;
 *          Resolution 110/2025/UBTVQH15 (15.5m / 6.2m); Decree 253/2026/ND-CP arts.8(3)(h), 46(2)(a) (3m pension
 *          cap), 50(2) (10% on payments ≥ 5m from 1 July 2026)
 *
 * Law-silent points use the owner defaults recorded in the tracker, marked DEFAULT with the row id.
 * Pure TypeScript; nothing is imported from src.
 */

export type Region = 'I' | 'II' | 'III' | 'IV';
export type ExitCause =
	| 'END_OF_CONTRACT' // LC art.34(1)
	| 'MUTUAL' // art.34(3)
	| 'RESIGNATION' // art.34(9) with art.35
	| 'REDUNDANCY' // art.34(11), arts.42–43 → job loss (art.47)
	| 'DISMISSAL' // art.34(8)
	| 'ABANDONMENT'; // art.36(1)(e)

export type Scenario = {
	id: string;
	/** tracker row ids exercised */
	rows: string[];
	/** branch names within those rows */
	branches: string[];
	/** YYYY-MM; a monthly run paid on the period's last day (DEFAULT: the pay date is the period end) */
	period: string;
	/** oaReduced: the approved 0.3% occupational-accident rate (Decree 58/2020 art.4(1) as amended by D158 art.43(2), art.5) */
	company: { region: Region; oaReduced?: boolean };
	employee: {
		birthDate: string;
		sex: 'M' | 'F';
		citizenship: 'VN' | 'FOREIGN';
		taxResident: boolean;
		receivingPension: boolean;
		unionMember: boolean;
		/** registered dependants (resident, progressive withholding only) */
		dependants: number;
		/** employee-paid voluntary pension premium this month, deducted for PIT only (not a payslip deduction) */
		voluntaryPension: number;
	};
	contract: {
		/** first day of employment (= contract start) */
		start: string;
		/** fixed-term contract's last day; null = indefinite */
		fixedEnd: string | null;
		/** monthly job wage (full time) */
		monthly: number;
		/** a stable, stated job allowance paid each month with the wage (insured, in the OT base, in the contract wage) */
		allowance: number;
		/** part-time on an hourly rate: gross = rate × hours; null = full time monthly */
		partTime: null | { hourly: number; hours: number };
		/** a probation contract (Labour Code art.24): outside UI from 1 January 2026 (Law 74/2025 art.31(2)) */
		probation?: boolean;
		/** date UI contributions began for this employer (citizens); null = never */
		uiFrom: string | null;
	};
	time: {
		/** working days wholly unpaid (unpaid personal leave, art.115(2)–(3)) */
		unpaidDays: number;
		/** working days on SI sickness benefit (paid by the fund, not the employer) */
		sickDays: number;
		ot: { weekday: number; rest: number; holiday: number };
		night: {
			/** normal hours worked 22:00–06:00 */
			plain: number;
			/** night OT on a weekday with / without daytime OT that day, on a rest day, on a holiday */
			weekdayAfterDayOt: number;
			weekdayNoDayOt: number;
			rest: number;
			holiday: number;
		};
	};
	bonus: number;
	exit: null | {
		/** last day of employment */
		date: string;
		cause: ExitCause;
		pensionEligible: boolean;
		/** annual-leave days already taken in the exit year */
		leaveTaken: number;
	};
};

export type Line = { amount?: number; employee?: number; employer?: number; base?: number };
export type Payslip = {
	refused: string | null;
	lines: Record<string, Line>;
	companyLines: Record<string, Line>;
};

// ---------- arithmetic and dates ----------
const EPS = 1e-7;
/** DEFAULT (VN-PRORATE-01: "no statutory VND rounding rule was found"): money to the whole đồng, half up. */
export const r0 = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + EPS);
const D = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;
export const addDays = (d: string, n: number) => iso(D(d) + n * DAY);
export const daysIn = (period: string) =>
	new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).getUTCDate();
export const monthEnd = (period: string) => `${period}-${String(daysIn(period)).padStart(2, '0')}`;
export const prevPeriod = (p: string) => addDays(`${p}-01`, -1).slice(0, 7);
/** Monday–Friday days in a..b inclusive: the officeWeek roster; a public holiday on a weekday stays a paid working day. */
export const workingDays = (a: string, b: string) => {
	let n = 0;
	for (let t = D(a); t <= D(b); t += DAY) {
		const w = new Date(t).getUTCDay();
		if (w !== 0 && w !== 6) n += 1;
	}
	return n;
};
/** whole months from a to b (b exclusive), as calendar months with the day-of-month anniversary */
export const monthsBetween = (a: string, b: string) => {
	let m = (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
	if (+b.slice(8, 10) < +a.slice(8, 10)) m -= 1;
	return Math.max(0, m);
};
const addMonths = (d: string, n: number) => {
	const y = +d.slice(0, 4);
	const m = +d.slice(5, 7) - 1 + n;
	const yy = y + Math.floor(m / 12);
	const mm = (((m % 12) + 12) % 12) + 1;
	const p = `${yy}-${String(mm).padStart(2, '0')}`;
	return `${p}-${String(Math.min(+d.slice(8, 10), daysIn(p))).padStart(2, '0')}`;
};

// ---------- statutory tables ----------
/** D74 art.3 (to 31 Dec 2025) and D293 art.3 (from 1 Jan 2026): regional monthly / hourly floors (VN-MW74-01, VN-MW293-02). */
const FLOORS: Record<'2025' | '2026', Record<Region, [number, number]>> = {
	'2025': {
		I: [4_960_000, 23_800],
		II: [4_410_000, 21_200],
		III: [3_860_000, 18_600],
		IV: [3_450_000, 16_600]
	},
	'2026': {
		I: [5_310_000, 25_500],
		II: [4_730_000, 22_700],
		III: [4_140_000, 20_000],
		IV: [3_700_000, 17_800]
	}
};
const floorsOn = (period: string) => {
	if (period < '2025-12' || period > '2026-12')
		throw new Error(`no VN floors transcribed for ${period}`);
	return FLOORS[period < '2026-01' ? '2025' : '2026'];
};
/** SI art.31(1)(đ) reference level = base salary: 2,340,000; D161 art.3(2): 2,530,000 from 1 July 2026 (VN-SI-05). */
const referenceLevel = (period: string) => (period >= '2026-07' ? 2_530_000 : 2_340_000);
/** Decree 135/2020 Annex I normal retirement age in months, by birth month (VN-LC169-02 transcription; the 2025–2027 cohorts). */
const retirementAgeMonths = (birth: string, sex: 'M' | 'F') => {
	const ym = birth.slice(0, 7);
	if (sex === 'M') {
		if (ym >= '1964-01' && ym <= '1964-09') return 61 * 12 + 3;
		if (ym >= '1964-10' && ym <= '1965-06') return 61 * 12 + 6;
		if (ym >= '1965-07' && ym <= '1966-03') return 61 * 12 + 9;
		if (ym >= '1966-04') return 62 * 12;
	} else {
		if (ym >= '1968-09' && ym <= '1969-04') return 56 * 12 + 8;
		if (ym >= '1969-05' && ym <= '1969-12') return 57 * 12;
	}
	throw new Error(`retirement age for ${sex} born ${birth} not transcribed here`);
};
/** the day the worker reaches the normal retirement age */
export const retirementDay = (birth: string, sex: 'M' | 'F') =>
	addMonths(birth, retirementAgeMonths(birth, sex));

/** PIT04 art.22 monthly ladder (December 2025) and PIT109 / 2026 ladder (VN-PIT-01, VN-PIT-05). */
const LADDER_2025: [number, number][] = [
	[5_000_000, 0.05],
	[10_000_000, 0.1],
	[18_000_000, 0.15],
	[32_000_000, 0.2],
	[52_000_000, 0.25],
	[80_000_000, 0.3],
	[Infinity, 0.35]
];
const LADDER_2026: [number, number][] = [
	[10_000_000, 0.05],
	[30_000_000, 0.1],
	[60_000_000, 0.2],
	[100_000_000, 0.3],
	[Infinity, 0.35]
];
export const ladder = (x: number, bands: [number, number][]) => {
	let tax = 0;
	let low = 0;
	for (const [high, rate] of bands) {
		if (x > low) tax += (Math.min(x, high) - low) * rate;
		low = high;
	}
	return tax;
};

export function computePayslip(sc: Scenario): Payslip {
	const { period, employee: e, contract: k, time: t } = sc;
	const lines: Record<string, Line> = {};
	const companyLines: Record<string, Line> = {};
	const refuse = (why: string): Payslip => ({ refused: why, lines: {}, companyLines: {} });
	const is2026 = period >= '2026-01';
	const first = `${period}-01`;
	const last = monthEnd(period);

	// ---- minimum wage (D293 art.4(1)–(2); D74 art.3): the job wage for normal hours, never allowances ----
	const [floorMonthly, floorHourly] = floorsOn(period)[sc.company.region];
	if (k.partTime ? k.partTime.hourly < floorHourly : k.monthly < floorMonthly)
		return refuse('minimum wage');

	// ---- employed span and working days ----
	const start = k.start > first ? k.start : first;
	const exitDate = sc.exit?.date ?? null;
	const end = exitDate && exitDate < last ? exitDate : last;
	const WD = workingDays(first, last);
	const employedWD = workingDays(start, end);
	const paidWD = employedWD - t.unpaidDays - t.sickDays;
	/** SI art.33(5)/34(3): no contributions in a month with 14 or more working days wholly without wage (VN-SI-02,
	 *  VN-PRORATE-01; days before hire / after exit are such days, VN-SI-01 batch 9). */
	const unpaidMonth = WD - paidWD >= 14;

	// ---- pay (DEFAULT VN-PRORATE-01: period working days; each unpaid working day at monthly ÷ WD) ----
	const contractWage = k.partTime
		? r0(k.partTime.hourly * k.partTime.hours)
		: k.monthly + k.allowance;
	if (k.partTime) lines.SALARY = { amount: contractWage, base: k.partTime.hours };
	else {
		lines.SALARY = { amount: r0((k.monthly * paidWD) / WD), base: paidWD };
		if (k.allowance > 0)
			lines.ALLOWANCE = { amount: r0((k.allowance * paidWD) / WD), base: paidWD };
	}

	// ---- overtime and night work (LC art.98; D145 arts.55–57) ----
	// D145 art.55(1)(a): hourly = month's wage for the job (salary + job allowance; no meal, bonus or OT) ÷ normal
	// hours (WD × 8, LC art.105 8-hour day; full-month scenarios so actual = normal hours)
	const hourly = (k.monthly + k.allowance) / (WD * 8);
	const n = t.night;
	const otParts: [string, number, number, number][] = [
		// code, hours, multiple, the normal-day pay inside it (the PIT04 taxable part, TT111 art.3(9))
		['OT_WEEKDAY', t.ot.weekday, 1.5, 1],
		['OT_REST_DAY', t.ot.rest, 2, 1],
		['OT_HOLIDAY', t.ot.holiday, 3, 1],
		['NIGHT_WORK', n.plain, 0.3, 0], // D145 art.56: +30% on normal hours at night (the 100% is in the salary)
		// D145 art.57(1): m + 30% + 20% × daytime rate (b1 100% / 150% after daytime OT; b2 200%; b3 300%)
		['NIGHT_OT_WEEKDAY', n.weekdayNoDayOt, 1.5 + 0.3 + 0.2 * 1, 1],
		['NIGHT_OT_WEEKDAY_AFTER_DAY', n.weekdayAfterDayOt, 1.5 + 0.3 + 0.2 * 1.5, 1],
		['NIGHT_OT_REST_DAY', n.rest, 2 + 0.3 + 0.2 * 2, 1],
		['NIGHT_OT_HOLIDAY', n.holiday, 3 + 0.3 + 0.2 * 3, 1]
	];
	// LC art.107(2)(b): at most 40 OT hours a month; pay beyond is still owed but is not lawful OT, so no PIT
	// exemption reaches it (PIT109 art.4(8) / TT111 art.3(9) exempt OT "theo quy định của pháp luật"; VN-LC107-01).
	const otHours =
		t.ot.weekday +
		t.ot.rest +
		t.ot.holiday +
		n.weekdayNoDayOt +
		n.weekdayAfterDayOt +
		n.rest +
		n.holiday;
	const overLimit = Math.max(0, otHours - 40); // generator puts any excess on weekday OT only
	let otPay = 0;
	let otTaxableOld = 0; // taxable under PIT04 (premium exempt)
	// DEFAULT (VN-PRORATE-01, law silent on rounding): overtime is keyed and priced per work day, each day's amount
	// rounded to the đồng (seed: the payslip carries each day's overtime amount). Scenario days: weekday overtime in
	// days of at most 4 hours (LC art.107(2)(a): 12 hours a day), rest-day overtime in days of at most 8.
	const perDay: Record<string, number> = { OT_WEEKDAY: 4, OT_REST_DAY: 8 };
	const dayRounded = (code: string, h: number, m: number) => {
		const step = perDay[code] ?? h;
		let sum = 0;
		for (let left = h; left > 0; left -= step) sum += r0(hourly * m * Math.min(step, left));
		return sum;
	};
	for (const [code, h, m, normal] of otParts) {
		if (h <= 0) continue;
		const amount = dayRounded(code, h, m);
		lines[code] = { amount, base: h };
		otPay += amount;
		otTaxableOld += hourly * normal * (code === 'OT_WEEKDAY' ? h - overLimit : h);
	}
	const overLimitPay = r0(hourly * 1.5 * overLimit); // inside OT_WEEKDAY; only its PIT treatment differs

	if (sc.bonus > 0) lines.BONUS = { amount: sc.bonus }; // LC art.104: no statutory amount (VN-LC104-02)

	// ---- insurance coverage ----
	const contractMonths = k.fixedEnd ? monthsBetween(k.start, addDays(k.fixedEnd, 1)) : Infinity;
	const foreign = e.citizenship === 'FOREIGN';
	const atRetirementAtSigning = foreign && k.start >= retirementDay(e.birthDate, e.sex);
	// SI art.2(1)(a) and HI art.12(1)(a): contracts of one full month or more; SI art.2(2): a foreigner only on a
	// fixed term of 12 months or more and not at retirement age (VN-SI-01, VN-LC169-02); a pensioner is outside
	// compulsory SI and inside HI through the SI agency, not the employer (VN-LC168-01 M1).
	let siSubject = !e.receivingPension && contractMonths >= 1;
	if (foreign) siSubject = siSubject && contractMonths >= 12 && !atRetirementAtSigning;
	const hiOnPayslip = siSubject; // HI follows the SI subject test for these classes (HI art.12(1)(a),(c))
	// UI: citizens only; not pensioners; 2026 (Law 74/2025 art.31(1)(a)) one month or more; December 2025 (Law 38/2013
	// art.43(1)(b)) every fixed term (VN-SI-01 Issue 44, VN-UI-01).
	// Law 74/2025 art.31(2): a worker on a probation contract is outside UI from 1 January 2026 (VN-UI-01 Issue 45;
	// December 2025 under Law 38/2013 left as insured, the tracker's open branch).
	const uiSubject =
		!foreign && !e.receivingPension && (is2026 ? contractMonths >= 1 && !k.probation : true);
	if (k.partTime && contractWage < referenceLevel(period))
		throw new Error(
			'part-time below the reference level is outside these scenarios (VN-LC168-01-2 unproven)'
		);

	const floor = referenceLevel(period);
	const ceiling = 20 * floor; // SI art.31(1)
	const insured = k.partTime ? contractWage : k.monthly + k.allowance; // SI art.31(1)(b), D158 art.7(1)
	const siBase = Math.min(ceiling, Math.max(floor, insured));
	// UI cap: 20 × the regional monthly minimum (Law 74/2025 art.34(2); Law 38/2013 art.58(2))
	const uiBase = Math.min(20 * floorMonthly, Math.max(floor, insured));
	let eeIns = 0;
	let erIns = 0;
	if (siSubject && !unpaidMonth) {
		// SI art.33(1)(a) 8%; art.34(1) 14% + 3% + D58 art.4(1) 0.5% (0.3% on approval, art.5; VN-SI-05)
		const ee = r0(siBase * 0.08);
		const er = r0(siBase * (sc.company.oaReduced ? 0.173 : 0.175));
		lines.SI = { employee: ee, employer: er, base: siBase };
		eeIns += ee;
		erIns += er;
	}
	if (hiOnPayslip && !unpaidMonth) {
		const ee = r0(siBase * 0.015);
		const er = r0(siBase * 0.03);
		lines.HI = { employee: ee, employer: er, base: siBase };
		eeIns += ee;
		erIns += er;
	}
	if (uiSubject && !unpaidMonth) {
		const ee = r0(uiBase * 0.01);
		lines.UI = { employee: ee, employer: ee, base: uiBase };
		eeIns += ee;
		erIns += ee;
	}
	// LC art.168(3): outside a scheme → the employer's share paid with the wage. Rates per excluded scheme as the
	// tracker records them (VN-LC168-01: pensioner 17.5% + 1%; foreigner 17.5% + 3%, no UI part; citizen under one
	// month 21.5% in 2026, 20.5% in December 2025 where UI still applies). DEFAULT (VN-LC168-01, owner rule
	// 2026-09-28): prorated like a standing allowance over paid working days.
	let eqRate = 0;
	if (!siSubject) eqRate += 0.175;
	if (!hiOnPayslip && !e.receivingPension) eqRate += 0.03;
	if (!uiSubject && !foreign) eqRate += 0.01;
	if (eqRate > 0) {
		const amount = r0((insured * eqRate * paidWD) / WD);
		lines.INSURANCE_EQUIVALENT = { amount, base: insured };
	}

	// ---- trade union (TU art.29(1)(b); Decision 61) ----
	if (lines.SI) companyLines['UNION_FEE.employer'] = { employer: r0(siBase * 0.02), base: siBase };
	if (e.unionMember && paidWD > 0) {
		// VN-UNION-01 (Issue 47, owner default): SI base; outside compulsory SI → base salary; an SI-nil month that is
		// not wholly unpaid → the insurance salary; capped at 10% of the base salary
		const duesBase = lines.SI ? siBase : !siSubject ? floor : siBase;
		const dues = r0(Math.min(duesBase * 0.005, floor * 0.1));
		lines.UNION_DUES = { employee: dues, base: duesBase };
	}

	// ---- exit: severance / job loss (LC arts.46–47; D145 art.8) and untaken leave (LC art.113(3); D145 arts.66–67) ----
	let severance = 0;
	let encash = 0;
	const x = sc.exit;
	if (x) {
		const dayAfter = addDays(x.date, 1);
		const service = monthsBetween(k.start, dayAfter);
		// D145 art.8(3)(b): UI time — citizens from uiFrom; a foreigner has none (no UI, no UI equivalent)
		const uiStart = foreign ? null : k.uiFrom;
		const uiMonths =
			uiStart && uiStart < dayAfter
				? monthsBetween(uiStart > k.start ? uiStart : k.start, dayAfter)
				: 0;
		const countable = service - uiMonths;
		// D145 art.8(3)(c): whole years; a remainder ≤ 6 months = ½ year, over 6 = 1 year
		const years =
			Math.floor(countable / 12) + (countable % 12 === 0 ? 0 : countable % 12 <= 6 ? 0.5 : 1);
		const avg = k.monthly + k.allowance; // LC art.46(3): six-month contractual average (constant here)
		if (service >= 12) {
			// D145 art.8(1): ≥ 12 months; LC art.34(1),(2),(3),(4),(6),(7),(9),(10); not pension-eligible, not art.36(1)(e)
			const severanceCause = ['END_OF_CONTRACT', 'MUTUAL', 'RESIGNATION'].includes(x.cause);
			if (severanceCause && !x.pensionEligible && years > 0) {
				severance = r0(0.5 * avg * years);
				lines.SEVERANCE_ALLOWANCE = { amount: severance, base: years };
			}
			if (x.cause === 'REDUNDANCY') {
				// LC art.47(1); D145 art.8(2): at least 2 months where the countable time is under 24 months
				const m = countable < 24 ? Math.max(2, years) : years;
				severance = r0(avg * m);
				lines.JOB_LOSS_ALLOWANCE = { amount: severance, base: m };
			}
		}
		// Annual leave: 12 days (LC art.113(1)(a)) + 1 per 5 full years (art.114(1)); the exit year's months worked
		// (D145 art.66(1)); a part month counts at ≥ 50% of its normal working days (art.66(2)).
		const y = x.date.slice(0, 4);
		const fullYears = Math.floor(service / 12);
		let months = 0;
		for (let p = `${y}-01`; p <= x.date.slice(0, 7); p = addDays(monthEnd(p), 1).slice(0, 7)) {
			const a = k.start > `${p}-01` ? k.start : `${p}-01`;
			const b = x.date < monthEnd(p) ? x.date : monthEnd(p);
			if (a > b) continue;
			let worked = workingDays(a, b);
			if (p === period) worked -= t.unpaidDays + t.sickDays; // sick days are not paid leave days (art.66(2))
			if (worked * 2 >= workingDays(`${p}-01`, monthEnd(p))) months += 1;
		}
		// LAW SILENT on rounding the day count (D145 art.66(1) states none; VN-LC113-02: none may be invented): the
		// fraction is kept to the thousandth of a day a leave entry stores (`encash_days` scale 3), never rounded up.
		const untaken = Math.max(
			0,
			Math.floor(((12 + Math.floor(fullYears / 5)) * months * 1000) / 12 + EPS) / 1000 -
				x.leaveTaken
		);
		if (untaken > 0) {
			// D145 art.67(3): the contract wage of the month before the exit month; DEFAULT (VN-LC113-03) ÷ its normal
			// working days
			const prev = prevPeriod(x.date.slice(0, 7));
			encash = r0(
				(untaken * (k.monthly + k.allowance)) / workingDays(`${prev}-01`, monthEnd(prev))
			);
			lines.ENCASHMENT = { amount: encash, base: untaken };
		}
	}

	// ---- gross ----
	const regular =
		(lines.SALARY.amount ?? 0) +
		(lines.ALLOWANCE?.amount ?? 0) +
		(lines.INSURANCE_EQUIVALENT?.amount ?? 0);
	const gross = regular + otPay + sc.bonus + severance + encash;

	// ---- PIT ----
	// Regime: December 2025 PIT04; residents from January 2026 PIT109 (art.29(2)); non-residents PIT04 to June 2026.
	const newRules = e.taxResident ? is2026 : period >= '2026-07';
	// OT/night: PIT109 art.4(8) whole pay exempt; PIT04 / TT111 art.3(9) only the part above normal pay; over-limit
	// hours taxable in full. Untaken leave on exit: exempt under PIT109 art.4(8), taxed under PIT04 (VN-PIT-11).
	// Severance and job loss: outside taxable income (TT111 art.2(2)(b)(b.6); D253 art.8(3)(h); VN-PIT-09).
	const otTaxable = (newRules ? 0 : r0(otTaxableOld)) + overLimitPay;
	const taxable = regular + sc.bonus + otTaxable + (newRules ? 0 : encash);
	let pit = 0;
	const shortContract = contractMonths < 3; // D253 art.50(2); TT111 art.25(1)(i): under three months
	const afterContract = exitDate !== null && exitDate < last; // paid on the period end, after the contract ended
	if (!e.taxResident)
		pit = r0(taxable * 0.2); // PIT04 art.26 / TT111 art.18(1); PIT109 art.21
	else if (shortContract || afterContract) {
		// TT111 art.25(1)(i) ≥ 2,000,000 before July 2026; D253 art.50(2) ≥ 5,000,000 from July; a payment after a
		// long contract ends is treated alike (VN-PIT-06 Round 12/18: D253 art.50(2) from July; owner default before)
		const threshold = period >= '2026-07' ? 5_000_000 : 2_000_000;
		if (taxable >= threshold) pit = r0(taxable * 0.1);
	} else {
		const self = is2026 ? 15_500_000 : 11_000_000; // NQ110 / NQ954
		const dep = is2026 ? 6_200_000 : 4_400_000;
		const pensionCap = is2026 ? 3_000_000 : 1_000_000; // D253 art.46(2)(a) / TT92 art.15
		const assessable =
			taxable - eeIns - self - dep * e.dependants - Math.min(e.voluntaryPension, pensionCap);
		pit = r0(ladder(Math.max(0, assessable), is2026 ? LADDER_2026 : LADDER_2025));
	}
	// the base is kept when no tax is due: it is the payment a resident payment-occasion declaration reconciles to
	lines.PIT = pit > 0 ? { employee: pit, base: taxable } : { base: taxable };

	const deductions = eeIns + pit + (lines.UNION_DUES?.employee ?? 0);
	lines.gross = { amount: gross };
	lines.total_deductions = { amount: deductions };
	lines.net = { amount: gross - deductions };
	lines.employer_cost = { amount: gross + erIns };
	return { refused: null, lines, companyLines };
}
