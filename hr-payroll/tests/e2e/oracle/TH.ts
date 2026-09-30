/**
 * Independent TH payslip oracle: one monthly payslip computed from the law alone (no engine, no seed).
 *
 * Sources (read 2026-09-30 unless noted):
 *   LPA   Labour Protection Act B.E.2541, Council of State consolidation through Act No.9 B.E.2568
 *         https://searchlaw.ocs.go.th/council-of-state/#/public/doc/ZGN3NXk0eENvNjBSdjRnT2NsdjFTQT09
 *   No.9  Act No.9 B.E.2568, https://ratchakitcha.soc.go.th/documents/89818.pdf (maternity 120/60, ss.41, 41/1, 59–59/2)
 *   N14   Minimum Wage Notice No.14 and its explanation, https://www.mol.go.th/wp-content/uploads/sites/2/2025/07/
 *         (the TH-WAGE-01 PDF; explanation cl.7(1)–(3): Bangkok 400, hotel types 2–4 and service establishments
 *         400 nationwide; p.6 table of 17 rate groups, 337–400)
 *   SSA   Social Security Act B.E.2533 consolidation https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09
 *         ss.5, 33, 46; 2026 base regulation https://ratchakitcha.soc.go.th/documents/98728.pdf (1,650 floor, 17,500
 *         ceiling 2026–2028; 15,000 before); flood notice https://ratchakitcha.soc.go.th/documents/100888.pdf (3%)
 *   EWF   LPA ss.130–131; rate regulation B.E.2568 cl.3 (0.25% each side from 1 Oct 2026)
 *   RC    Revenue Code https://www.rd.go.th/5937.html ss.42 bis (50% ≤ 100,000), 47(1)(a) (60,000), 48(1) table,
 *         48(5) (7,000 × years, then 50%; part year ≥ 183 days = 1 year), 50(1) paras.1 and 3
 *   RATES https://www.rd.go.th/59670.html (0–150,000 exempt by Royal Decree 470; 5/10/15/20/25/30/35%)
 *   P96   Order P.96/2543 https://www.rd.go.th/3558.html cl.1(1)–(5), cl.2
 *   N45   DG Notification No.45 https://www.rd.go.th/3213.html cls.1–3 (as amended by No.252)
 *   MR2552 Guard regulation 19 Jun 2009 https://www.mol.go.th/wp-content/uploads/sites/2/2018/07/181.pdf cl.2 (s.61/s.63
 *         OT at 1× the hourly rate); MR2568 https://ratchakitcha.soc.go.th/documents/68372.pdf (Gazette 24 Apr 2025, in force
 *         365 days later) cl.3 OT ≥1.25×, holiday OT ≥2.5×; cl.4 agreed normal day > 8 h within 48 h a week, non-monthly
 *         guard ≥1.25× per hour beyond eight
 *   MR126 Ministerial Regulation No.126 cl.2(51) as amended by No.394 https://www.rd.go.th/2502.html
 *         (severance exempt up to the last 400 days' wage and THB600,000; not on retirement or contract end)
 *
 * Owner-rule defaults (law silent) are the ones recorded in docs/inventory/thailand.csv and are marked DEFAULT.
 * Pure TypeScript; nothing is imported from src.
 */

/** N14 p.6 table (read 30 Sep 2026 from the MoL PDF in the in-app browser): one worksite per base-rate group,
 *  plus every district override and the province remainder beside it (TH-WAGE-01, TH-WAGE-02). THB a day. */
export const WORKSITE_DAILY = {
	BANGKOK: 400, // group 1: Bangkok, Chachoengsao, Chonburi, Phuket, Rayong, Ko Samui district
	CHONBURI: 400,
	PHUKET: 400,
	SURAT_THANI_KO_SAMUI: 400,
	CHIANG_MAI_MUEANG: 380, // group 2: Mueang Chiang Mai and Hat Yai districts
	SONGKHLA_HAT_YAI: 380,
	NONTHABURI: 372, // group 3: Nakhon Pathom, Nonthaburi, Pathum Thani, Samut Prakan, Samut Sakhon
	NAKHON_RATCHASIMA: 359, // group 4
	SAMUT_SONGKHRAM: 358, // group 5
	CHIANG_MAI: 357, // group 6: Khon Kaen, Chiang Mai except Mueang, Prachin Buri, Ayutthaya, Saraburi
	LOPBURI: 356, // group 7
	NONG_KHAI: 355, // group 8: Nakhon Nayok, Suphan Buri, Nong Khai
	KRABI: 354, // group 9: Krabi, Trat
	SONGKHLA: 352, // group 10 (15 provinces) incl. Songkhla except Hat Yai, Surat Thani except Ko Samui
	SURAT_THANI: 352,
	CHUMPHON: 351, // group 11
	LAMPHUN: 350, // group 12
	ROI_ET: 349, // group 13
	ANG_THONG: 348, // group 14
	UDON_THANI: 347, // group 15 (16 provinces)
	NAN: 345, // group 16
	YALA: 337 // group 17: Narathiwat, Pattani, Yala
} as const;
export type Worksite = keyof typeof WORKSITE_DAILY;
export type Sector =
	| 'GENERAL'
	| 'HOTEL_TYPE_1'
	| 'HOTEL_TYPE_2'
	| 'HOTEL_TYPE_3'
	| 'HOTEL_TYPE_4'
	| 'SERVICE_ESTABLISHMENT';
/** LPA s.65: (1) authority to hire/reward/dismiss; (2) commission sales; (3)–(9) the hourly-rate classes;
 *  GUARD: s.65(9) guarding of premises or property as normal duty (MR 2552, then MR 2568 from 24 Apr 2026). */
export type WorkClass = 'ORDINARY' | 'S65_1_AUTHORITY' | 'S65_2_COMMISSION_SALES' | 'S65_3_9_HOURLY' | 'GUARD';
export type ExitCause =
	| 'RESIGNATION'
	| 'EMPLOYER_TERMINATION'
	| 'DISMISSAL_S119'
	| 'RETIREMENT'
	| 'CONTRACT_EXPIRY'
	| 'FIXED_TERM_PROJECT_EXEMPT'
	| 'RELOCATION_OBJECTION'
	| 'TECHNOLOGY_RESTRUCTURING';
export type Pay =
	| { basis: 'MONTHLY'; monthly: number }
	| { basis: 'DAILY'; daily: number; workedDays: number; paidTraditionalHolidays: number };

export type Scenario = {
	id: string;
	/** tracker row ids exercised */
	rows: string[];
	/** branch names within those rows */
	branches: string[];
	/** YYYY-MM, one calendar month, paid on its last day */
	period: string;
	company: { worksite: Worksite; sector: Sector; headcount: number; floodReliefArea: boolean };
	employee: {
		birthDate: string;
		citizenship: 'TH' | 'FOREIGN';
		taxResident: boolean;
		hireDate: string;
		pay: Pay;
		normalDailyHours: number;
		workClass: WorkClass;
		providentFundMember: boolean;
		hazardous: boolean;
		pregnant: boolean;
		/** ล.ย.01 allowances declared beyond the personal 60,000, THB a year */
		ly01: number;
	};
	time: {
		overtimeHours: number;
		holidayWork: { kind: 'WEEKLY' | 'TRADITIONAL'; hours: number; overtimeHours: number } | null;
	};
	leave: {
		unpaidDays: number;
		sick: { prior: number; days: number };
		personal: { prior: number; days: number };
		military: { prior: number; days: number };
		maternityStart: string | null;
		childCareDays: number;
		spouseBirthDays: number;
		annualLeaveDays: number;
	};
	bonus: number;
	exit: null | {
		/** last day of employment */
		date: string;
		cause: ExitCause;
		noticeGivenOn: string | null;
		carriedLeaveDays: number;
		annualLeaveTakenThisYear: number;
		relocationNoticePosted: boolean;
		technologyNotice60Days: boolean;
	};
	/** regular pay identical every month of the tax year (lets the December payment carry the P.96 remainder) */
	steadyYear: boolean;
};

export type Line = { amount?: number; employee?: number; employer?: number; base?: number };
export type Payslip = { refused: string | null; lines: Record<string, Line> };

// ---------- arithmetic ----------
const EPS = 1e-7;
/** DEFAULT: money lines kept to the satang, half up (law silent). */
export const r2 = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) * 100 + 0.5 + EPS) / 100;
/** P96 cl.1(3): the per-payment quotient; any remainder goes to the year's last payment, so truncate. */
const t2 = (x: number) => Math.floor(x * 100 + EPS) / 100;
/** SSA s.46 para.5: a fraction of 50 satang or more counts as one baht, less is dropped. */
const ssoRound = (x: number) => Math.floor(x + 0.5 + EPS);

// ---------- dates ----------
const D = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;
export const addDays = (d: string, n: number) => iso(D(d) + n * DAY);
export const addYears = (d: string, n: number) => {
	const y = +d.slice(0, 4) + n;
	const md = d.slice(5);
	// 29 Feb anniversary in a common year falls on 1 Mar
	return md === '02-29' && !isLeap(y) ? `${y}-03-01` : `${y}-${md}`;
};
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (period: string) => new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).getUTCDate();
export const monthEnd = (period: string) => `${period}-${String(daysIn(period)).padStart(2, '0')}`;
const nextPeriod = (p: string) => addDays(monthEnd(p), 1).slice(0, 7);
/** inclusive day count a..b */
const span = (a: string, b: string) => (D(b) - D(a)) / DAY + 1;
/** completed years on `on` (birthday reached) */
export const ageOn = (birth: string, on: string) => {
	let a = +on.slice(0, 4) - +birth.slice(0, 4);
	if (on.slice(5) < birth.slice(5)) a -= 1;
	return a;
};
/** Service to the last day worked, inclusive: completed years and the remaining days. */
const service = (hire: string, last: string) => {
	const end = addDays(last, 1);
	let years = 0;
	while (D(addYears(hire, years + 1)) <= D(end)) years += 1;
	return { years, restDays: (D(end) - D(addYears(hire, years))) / DAY, totalDays: span(hire, last) };
};

// ---------- statutory tables (each from the source cited) ----------
/** N14 cl.2 and table: daily floor by worksite; sector override THB400 nationwide for hotel types 2–4 and
 *  Service Establishment Act venues (TH-WAGE-03, -07); a type 1 hotel keeps the geographic rate. */
const minimumDaily = (w: Worksite, s: Sector) => {
	const geo = WORKSITE_DAILY[w];
	return s === 'HOTEL_TYPE_2' || s === 'HOTEL_TYPE_3' || s === 'HOTEL_TYPE_4' || s === 'SERVICE_ESTABLISHMENT'
		? Math.max(geo, 400)
		: geo;
};
/** SSA s.46 + base regulation (MR B.E.2568 cl.3(1)–(3)): floor 1,650; ceiling 15,000 to Dec 2025, 17,500
 *  Jan 2026–Dec 2028, 20,000 Jan 2029–Dec 2031, 23,000 from Jan 2032 (TH-SS-01). */
const ssoBase = (period: string) => {
	if (period < '2025-12') throw new Error(`no TH SSO base transcribed for ${period}`);
	const ceiling = period <= '2025-12' ? 15000 : period <= '2028-12' ? 17500 : period <= '2031-12' ? 20000 : 23000;
	return { floor: 1650, ceiling };
};
/** 2565 rate regulation Schedule B 5% each side; flood notice cl.1: 3% each side Dec 2025–May 2026 in the area. */
const ssoRate = (period: string, flood: boolean) =>
	flood && period >= '2025-12' && period <= '2026-05' ? 0.03 : 0.05;
/** EWF rate regulation B.E.2568 cl.3: 0.25% each side from 1 Oct 2026, 0.50% from 1 Oct 2031; no cap (TH-EWF-02). */
const ewfRate = (period: string) => (period < '2026-10' ? 0 : period < '2031-10' ? 0.0025 : 0.005);
/** RC s.48(1) table with the first 150,000 exempt (Royal Decree 470 s.4), RATES page. */
const BANDS: [number, number][] = [
	[150_000, 0],
	[300_000, 0.05],
	[500_000, 0.1],
	[750_000, 0.15],
	[1_000_000, 0.2],
	[2_000_000, 0.25],
	[5_000_000, 0.3],
	[Infinity, 0.35]
];
export const taxOn = (net: number) => {
	let tax = 0;
	let low = 0;
	for (const [high, rate] of BANDS) {
		if (net > low) tax += (Math.min(net, high) - low) * rate;
		low = high;
	}
	return tax;
};
/** RC s.42 bis 50% capped 100,000; s.47(1)(a) 60,000 personal; SSO contribution; ล.ย.01 (P96 cl.1(2)). */
const annualTax = (income: number, relief: number) =>
	taxOn(Math.max(0, income - Math.min(income * 0.5, 100_000) - 60_000 - relief));
/** LPA s.118 (No.7 B.E.2562) severance days by continuous service. */
const s118Days = (years: number, totalDays: number) =>
	totalDays < 120 ? 0 : years < 1 ? 30 : years < 3 ? 90 : years < 6 ? 180 : years < 10 ? 240 : years < 20 ? 300 : 400;

export function computePayslip(sc: Scenario): Payslip {
	const { employee: e, company: c, period } = sc;
	const first = `${period}-01`;
	const last = monthEnd(period);
	const lines: Record<string, Line> = {};
	const refuse = (why: string): Payslip => ({ refused: why, lines: {} });

	// ---- refusals the law states ----
	const floor = minimumDaily(c.worksite, c.sector);
	// N14: daily rate below the floor; DEFAULT (TH-WAGE-01): a monthly wage held to floor × 30 (monthly ÷ 30 per day, s.68)
	const day = e.pay.basis === 'MONTHLY' ? e.pay.monthly / 30 : e.pay.daily;
	if (day + EPS < floor) return refuse('minimum wage');
	const minor = ageOn(e.birthDate, last) < 18;
	const anyOt = sc.time.overtimeHours > 0 || (sc.time.holidayWork?.overtimeHours ?? 0) > 0;
	const anyHoliday = sc.time.holidayWork !== null;
	if (minor && (anyOt || anyHoliday)) return refuse('under-18 overtime/holiday work (LPA s.48)');
	if (e.pregnant && (anyOt || anyHoliday)) return refuse('pregnant overtime/holiday work (LPA s.39/1)');
	if (e.hazardous && (anyOt || anyHoliday)) return refuse('hazardous overtime/holiday work (LPA s.31)');
	// LPA s.23: normal day ≤ 8 hours, hazardous ≤ 7; MR 2568 cl.4 lets a guard agree a longer normal day from
	// 24 Apr 2026 (the 48-hour week it also requires is not modelled here)
	const guardNew = e.workClass === 'GUARD' && period >= '2026-05';
	if (e.workClass === 'GUARD' && period === '2026-04') throw new Error('guard April 2026 straddles the MR 2568 cutover');
	if (e.hazardous && e.normalDailyHours > 7) return refuse('hazardous normal day over 7 hours (LPA s.23)');
	if (e.normalDailyHours > 8 && !guardNew) return refuse('normal day over 8 hours (LPA s.23)');
	// No.9 ss.41 para.4, 41/1: child-care and spouse-birth leave "not more than fifteen days"
	if (sc.leave.childCareDays > 15 || sc.leave.spouseBirthDays > 15) return refuse('leave beyond 15 days');

	// ---- regular pay ----
	const start = e.hireDate > first ? e.hireDate : first;
	const end = sc.exit && sc.exit.date < last ? sc.exit.date : last;
	const employedDays = span(start, end);
	let regular: number;
	let perDay: number;
	if (e.pay.basis === 'MONTHLY') {
		perDay = e.pay.monthly / 30; // DEFAULT (TH-WORK-05): a monthly wage's day is monthly ÷ 30
		// DEFAULT (TH-WORK-05 proration.by CALENDAR_DAYS): a part month on calendar days
		const salary = employedDays === daysIn(period) ? e.pay.monthly : r2((e.pay.monthly * employedDays) / daysIn(period));
		lines.SALARY = { amount: salary, base: employedDays };
		// unpaid-day equivalents (each day at monthly ÷ 30)
		let unpaid = sc.leave.unpaidDays;
		// LPA s.57: sick leave paid up to 30 working days a year
		unpaid += Math.max(0, sc.leave.sick.prior + sc.leave.sick.days - 30) - Math.max(0, sc.leave.sick.prior - 30);
		// LPA s.57/1: personal-business leave paid up to 3 days a year; a day granted beyond is unpaid
		unpaid += Math.max(0, sc.leave.personal.prior + sc.leave.personal.days - 3) - Math.max(0, sc.leave.personal.prior - 3);
		// LPA s.58: military leave paid up to 60 days a year
		unpaid += Math.max(0, sc.leave.military.prior + sc.leave.military.days - 60) - Math.max(0, sc.leave.military.prior - 60);
		// No.9 s.59/1: child-care leave at 50% of wages
		unpaid += sc.leave.childCareDays * 0.5;
		// No.9 s.59/2: spouse-birth leave fully paid (no deduction). LPA s.56: annual leave paid.
		// No.9 ss.41, 59: maternity 120 days (calendar, holidays included), the first 60 paid by the employer
		if (sc.leave.maternityStart) {
			for (let d = start; d <= end; d = addDays(d, 1)) {
				const n = span(sc.leave.maternityStart, d);
				if (n > 60 && n <= 120) unpaid += 1;
			}
		}
		if (unpaid > 0) lines.UNPAID_LEAVE = { amount: -r2(unpaid * perDay), base: unpaid };
		regular = salary + (lines.UNPAID_LEAVE?.amount ?? 0);
	} else {
		perDay = e.pay.daily;
		// LPA s.56(2): traditional holidays paid to all; weekly holidays not paid to daily staff (s.56(1))
		lines.DAILY_WAGES = { amount: r2(e.pay.daily * e.pay.workedDays), base: e.pay.workedDays };
		if (e.pay.paidTraditionalHolidays > 0)
			lines.HOLIDAY_PAY = { amount: r2(e.pay.daily * e.pay.paidTraditionalHolidays), base: e.pay.paidTraditionalHolidays };
		regular = (lines.DAILY_WAGES.amount ?? 0) + (lines.HOLIDAY_PAY?.amount ?? 0);
		// MR 2568 cl.4: a guard not paid monthly on an agreed normal day over eight hours gets ≥ 1.25× the hourly
		// rate for each normal hour beyond eight. READING: on top of the day wage (the day wage pays the agreed
		// normal day at 1×); hourly = day ÷ agreed normal hours (s.68); DEFAULT: in the s.5 wage (normal hours).
		if (guardNew && e.normalDailyHours > 8) {
			const h = (e.normalDailyHours - 8) * e.pay.workedDays;
			lines.GUARD_NORMAL_SUPPLEMENT = { amount: r2((e.pay.daily / e.normalDailyHours) * 1.25 * h), base: h };
			regular += lines.GUARD_NORMAL_SUPPLEMENT.amount!;
		}
	}

	// ---- overtime and holiday work (LPA ss.61–66, 68) ----
	// s.68: monthly ÷ (30 × normal daily hours); a daily wage ÷ its normal hours
	const hourly = perDay / e.normalDailyHours;
	const cls = e.workClass;
	let special = 0;
	if (sc.time.overtimeHours > 0) {
		// s.61 ≥1.5×; s.65(1),(2) none; s.65(3)–(9) the hourly rate per hour; guard: MR 2552 cl.2 1× before
		// 24 Apr 2026, MR 2568 cl.3 ≥1.25× from then
		const m = cls === 'ORDINARY' ? 1.5 : cls === 'S65_3_9_HOURLY' ? 1 : cls === 'GUARD' ? (guardNew ? 1.25 : 1) : 0;
		if (m > 0) lines.OVERTIME = { amount: r2(hourly * m * sc.time.overtimeHours), base: sc.time.overtimeHours };
	}
	const hw = sc.time.holidayWork;
	if (hw) {
		// s.62(1) +1× for staff paid for the holiday; s.62(2) 2× for staff not paid (a daily wage on the weekly
		// holiday); s.66 removes s.62 only from class (1)
		const paidForHoliday = e.pay.basis === 'MONTHLY' || hw.kind === 'TRADITIONAL';
		if (cls !== 'S65_1_AUTHORITY' && hw.hours > 0)
			lines.HOLIDAY_WORK = { amount: r2(hourly * (paidForHoliday ? 1 : 2) * hw.hours), base: hw.hours };
		// s.63 ≥3×; s.65 classes as for s.61; guard: MR 2552 cl.2 1×, MR 2568 cl.3 ≥2.5×
		const m = cls === 'ORDINARY' ? 3 : cls === 'S65_3_9_HOURLY' ? 1 : cls === 'GUARD' ? (guardNew ? 2.5 : 1) : 0;
		if (m > 0 && hw.overtimeHours > 0)
			lines.HOLIDAY_OVERTIME = { amount: r2(hourly * m * hw.overtimeHours), base: hw.overtimeHours };
	}
	if (sc.bonus > 0) lines.BONUS = { amount: sc.bonus }; // LPA s.5: no statutory bonus; a paid one is income
	special = ['OVERTIME', 'HOLIDAY_WORK', 'HOLIDAY_OVERTIME', 'BONUS'].reduce((s, k) => s + (lines[k]?.amount ?? 0), 0);

	// ---- exit (LPA ss.17, 17/1, 67, 118–122) ----
	let severance = 0;
	let inLieu = 0;
	let encash = 0;
	let svc: ReturnType<typeof service> | null = null;
	const x = sc.exit;
	if (x) {
		svc = service(e.hireDate, x.date);
		const employerEnds =
			x.cause !== 'RESIGNATION' && x.cause !== 'DISMISSAL_S119'; // s.118/1: retirement is termination
		// s.118; none on s.119 cause, resignation, or the para.3–4 exempt project/seasonal fixed term
		const owesSeverance = employerEnds && x.cause !== 'FIXED_TERM_PROJECT_EXEMPT';
		if (owesSeverance) {
			let days = s118Days(svc.years, svc.totalDays);
			if (x.cause === 'TECHNOLOGY_RESTRUCTURING') {
				// s.122: service beyond six years adds 15 days per full year, a part year over 180 days counting one; ≤360
				const beyondSix = svc.years > 6 || (svc.years === 6 && svc.restDays > 0);
				if (beyondSix) days += Math.min(360, 15 * (svc.years + (svc.restDays > 180 ? 1 : 0)));
			}
			severance = r2(days * perDay);
			if (days > 0) lines.SEVERANCE_PAY = { amount: severance, base: days };
		}
		if (x.cause === 'EMPLOYER_TERMINATION') {
			// s.17 para.2: notice at or before a payday takes effect on the next payday; s.17/1 pay to that day.
			// Payday = the period's last day. DEFAULT (TH-WORK-05): each day at monthly ÷ 30. ≤ 3 months (s.17 para.2).
			const given = x.noticeGivenOn ?? x.date;
			const p1 = monthEnd(given.slice(0, 7));
			const effective = monthEnd(nextPeriod(p1.slice(0, 7)));
			const owed = Math.min(90, Math.max(0, span(x.date, effective) - 1));
			if (owed > 0) {
				inLieu = r2(owed * perDay);
				lines.NOTICE_IN_LIEU = { amount: inLieu, base: owed };
			}
		}
		// s.120 para.2: no 30 days' posted notice → special severance in lieu of 30 days' wage (DEFAULT line: TH-EXIT-06)
		if (x.cause === 'RELOCATION_OBJECTION' && !x.relocationNoticePosted) {
			inLieu = r2(30 * perDay);
			lines.NOTICE_IN_LIEU = { amount: inLieu, base: 30 };
		}
		// s.121 para.2: no 60 days' notice → 60 days' special severance in lieu (DEFAULT line: TH-EXIT-07)
		if (x.cause === 'TECHNOLOGY_RESTRUCTURING' && !x.technologyNotice60Days) {
			inLieu = r2(60 * perDay);
			lines.NOTICE_IN_LIEU = { amount: inLieu, base: 60 };
		}
		// s.67: employer termination other than s.119 → the year's leave pro rata to the s.30 entitlement (6 days after
		// one year); every exit → carried-forward leave. DEFAULT: pro rata on calendar days of the year, unrounded.
		let days = x.carriedLeaveDays;
		if (employerEnds && svc.years >= 1) {
			const y = x.date.slice(0, 4);
			const pro = (6 * span(`${y}-01-01`, x.date)) / span(`${y}-01-01`, `${y}-12-31`);
			days += Math.max(0, pro - x.annualLeaveTakenThisYear);
		}
		if (days > 0) {
			encash = r2(days * perDay);
			lines.LEAVE_ENCASHMENT = { amount: encash, base: days };
		}
	}

	const gross = r2(regular + special + severance + inLieu + encash);

	// ---- Social Security (SSA ss.5, 33, 46) ----
	// s.33: insured aged 15–60 — a hire over 60 does not enter; an insured person stays past 60; DEFAULT
	// (TH-SS-12): the lower bound read on the period end. s.5: the wage for normal work, holidays and leave;
	// OT, holiday work, bonus, severance, notice pay and s.67 leave pay are outside (DEFAULT TH-SS-13).
	const insured = ageOn(e.birthDate, e.hireDate) <= 60 && ageOn(e.birthDate, last) >= 15;
	let ssoEe = 0;
	if (insured) {
		const { floor: f, ceiling } = ssoBase(period);
		const base = Math.min(ceiling, Math.max(f, regular));
		ssoEe = ssoRound(base * ssoRate(period, c.floodReliefArea));
		lines.SSO = { employee: ssoEe, employer: ssoEe, base };
	}

	// ---- Employee Welfare Fund (LPA ss.130–131) ----
	// covered at ten or more employees; a provident-fund member is excluded; no cap; DEFAULT (TH-EWF-02) to the satang
	const er = ewfRate(period);
	let ewfEe = 0;
	if (er > 0 && c.headcount >= 10 && !e.providentFundMember) {
		ewfEe = r2(regular * er);
		lines.EWF = { employee: ewfEe, employer: ewfEe, base: regular };
	}

	// ---- PIT withholding (RC s.50(1); P96 cl.1) ----
	// residents and non-residents alike: s.50(1) makes no residence distinction (TH-PIT-19)
	const year = period.slice(0, 4);
	const hireMonth = e.hireDate.slice(0, 4) === year ? +e.hireDate.slice(5, 7) : 1;
	const n = 12 - hireMonth + 1; // P96 cl.1(1): payments actually due in the year of joining
	const relief = ssoEe * n + e.ly01; // DEFAULT (TH-PIT-02): the payment's SSO × payments due
	const A = regular * n;
	const T = annualTax(A, relief);
	let pit = t2(T / n);
	// P96 cl.1(3): the remainder joins the year's last payment
	if (sc.steadyYear && period.slice(5) === '12') pit = r2(T - (n - 1) * pit);
	// P96 cl.1(5): the occasional payment × payments per year, added to the annualised regular pay; the whole
	// tax difference is withheld on that payment (as the order's text reads)
	const withSpecial = A + special * n;
	if (special > 0) pit += r2(annualTax(withSpecial, relief) - T);

	// exit lump sums: P96 cl.1 excludes them; RC s.50(1) para.3 withholds on the s.48(5) basis when N45 cl.2(ก)
	// (service ≥ 5 years) holds; MR126 cl.2(51) exempts severance up to the last 400 days' wage and THB600,000,
	// except on retirement or contract end.
	let severanceTax = 0;
	if (x && svc) {
		const exemptible = x.cause !== 'RETIREMENT' && x.cause !== 'CONTRACT_EXPIRY';
		const exempt = exemptible ? Math.min(severance, 400 * perDay, 600_000) : 0;
		const taxableSeverance = severance - exempt; // N45 cl.1(ค)
		const other = inLieu + encash; // N45 cl.1(ง): other once-only exit payments
		let toPit = taxableSeverance + other;
		if (svc.years >= 5) {
			const years = svc.years + (svc.restDays >= 183 ? 1 : 0); // RC s.48(5) para.4
			const lastSalary = e.pay.basis === 'MONTHLY' ? e.pay.monthly : e.pay.daily * 30;
			const otherIn = Math.min(other, lastSalary * years); // N45 cl.3(2)
			const L = taxableSeverance + otherIn;
			const afterFixed = Math.max(0, L - Math.min(L, 7000 * years));
			severanceTax = r2(taxOn(afterFixed * 0.5));
			toPit = other - otherIn;
		}
		// DEFAULT (TH-PIT-05): the rest withheld whole as the increment on the annualised liability
		if (toPit > 0) pit += r2(annualTax(withSpecial + toPit, relief) - annualTax(withSpecial, relief));
		if (severanceTax > 0) lines.SEVERANCE_TAX = { employee: severanceTax };
	}
	pit = r2(pit);
	if (pit > 0) lines.PIT = { employee: pit, base: r2(A) };

	const deductions = r2(ssoEe + ewfEe + pit + severanceTax);
	lines.gross = { amount: gross };
	lines.total_deductions = { amount: deductions };
	lines.net = { amount: r2(gross - deductions) };
	lines.employer_cost = { amount: r2(gross + ssoEe + ewfEe) };
	return { refused: null, lines };
}
