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
 *  [EA]     Employment Act 1968 ss.2, 10, 11, 20A, 28, 29, 32, 35, 37, 38, 88, 88A, 107A, Third and Fourth Schedules —
 *           https://sso.agc.gov.sg/Act/EmA1968?WholeDoc=1 (ss.28, 29, 32 and 88 re-read on SSO 2026-09-30, current version
 *           as at 30 Sep 2026: https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr28- , pr29-, pr32-, pr88-)
 *  [CONV]   CPF Board: a foreign employee who obtains SPR status (first-year rate from the SPR day, CPF on the pro-rated OW
 *           from that day, AW only if payable on or after it); an SPR who becomes a citizen mid-month (SPR rate before the
 *           citizenship day, citizen rate from it) — cited by SG-CPF34 / SG-CPF09.conversion-month
 *  [MED]    SDL (Exclusion of medical, dental and TCM reimbursements) notification from 15 Jun 2023 —
 *           https://sso.agc.gov.sg/SL/SDLA1979-S375-2023 ; CPF exclusion from 1 Jan 2020 — https://sso.agc.gov.sg/SL/CPFA1953-N12
 *  [RETR]   CPF Board: "CPF contributions are not payable on termination benefits given for retrenchment" (SG-CPF04,
 *           SG-EA24-R02; SDL inside by the recorded owner default)
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
	/** every public holiday of the period as observed (Saturday ones included; the harness publishes them as rows) */
	holidays: readonly string[];
	/** the employer's CPF / fund registration is incomplete: still assessed (SG-CPF01.unregistered, SG-SHG01.unregistered) */
	employer_unregistered?: boolean;
	employee: {
		birth_date: string;
		/** the status at the period's end */
		residency: Residency;
		/** the day SPR status was granted; inside the period = a foreigner → SPR conversion month (SG-CPF34) */
		spr_granted_on?: string;
		/** the day citizenship was granted to an SPR; inside the period = an SPR → citizen conversion month */
		citizen_on?: string;
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
		/** a fund instruction for a different monthly amount (CDAC Rules r.8 higher; SINDA Rules r.8(2) lower) */
		shg_instruction?: { fund: 'CDAC' | 'SINDA'; amount: number };
		/** student of a listed local institution in institution-approved training: outside SDL (SG-SDL04A) */
		sdl_exempt_student?: boolean;
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
		/** dated salary changes inside the period (SG-EA10.rate-change) */
		rate_changes?: readonly { from: string; monthly_basic: number; monthly_allowance?: number }[];
		/** services wholly outside Singapore (SDLA s.2: outside SDL, SG-SDL01.outside-singapore) */
		wholly_outside_singapore?: boolean;
		/** a household role (driver, gardener) employed by the company: stays within SDL (SG-SDL01.company-household-role) */
		household_role?: boolean;
	};
	month: {
		/** employee-requested no-pay leave, each a working day (EA s.20A(1)(c); a holiday inside it is unpaid, s.88(2)) */
		no_pay_leave?: readonly string[];
		/** absence without consent or excuse on a working day (EA s.28; s.88(3)) */
		absent?: readonly string[];
		/** hours beyond the normal day on a working day, at the employer's request (EA s.38(4); PT reg.5) */
		overtime?: readonly { date: string; hours: number }[];
		/** work on the Sunday rest day (EA s.37) */
		rest_day_work?: readonly {
			date: string;
			hours: number;
			requested_by: 'EMPLOYEE' | 'EMPLOYER';
		}[];
		/** work on a public holiday at the employer's request (EA s.88(4)) */
		holiday_work?: readonly {
			date: string;
			hours: number;
			/** EA s.88(4A): outside Part 4, agreed time off in lieu replaces the extra basic day */
			time_off_in_lieu?: boolean;
		}[];
		/** EA s.88(1)(c): a holiday on the Saturday off day is paid at the gross rate (default) or given a substitute day */
		off_day_holiday?: 'PAY' | 'SUBSTITUTE';
		/** annual / sick leave taken on working days: paid at the gross rate, a monthly salary unchanged (EA ss.88A, 89) */
		paid_leave?: readonly { date: string; kind: 'ANNUAL' | 'OUTPATIENT' | 'HOSPITALISATION' }[];
		/** qualifying medical / dental / TCM reimbursement: paid, outside CPF, funds and SDL [MED] */
		medical_reimbursement?: number;
		/** contractual retrenchment benefit: outside CPF and funds, inside SDL (SG-EA24-R02 owner default) */
		retrenchment_benefit?: number;
		/** EA s.29 damage or loss recovery (after the employee could show cause) */
		damage_recovery?: { loss: number; commissioner_permitted?: boolean };
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
	cpf_opening?: {
		ordinary_wages_ytd: number;
		additional_wages_ytd: number;
		/** a former employer's OW this year: ignored (SG-CPF22.per-employer) unless a related-company single ceiling is approved */
		other_employer_ow_ytd?: number;
		related_company_approved?: boolean;
	};
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
	/** the singapore.csv row ids whose branch this computation actually took */
	rows: string[];
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
 * Saturday holidays (21 Mar 2026, 6 Feb 2027, 1 May 2027, 25 Dec 2027) fall on the contract's off day: EA s.88(1)(c)
 * "the employer may either pay the employee for that holiday at his or her gross rate of pay or give the employee a day
 * off in substitution" (SG-EA33.non-working-day, SG-HOL01.saturday: no Monday holiday).
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
/** HA s.4(2): the Monday a Sunday holiday moves to. */
const SUNDAY_SUBSTITUTES = new Set(['2026-06-01', '2026-08-10', '2026-11-09', '2027-02-08']);
export const publicHolidays = (period: string) =>
	PUBLIC_HOLIDAYS.filter((d) => d.startsWith(period));
export const weekdayHolidays = (period: string) => publicHolidays(period).filter(isWorkingDay);
/** holidays on the Saturday off day */
export const offDayHolidays = (period: string) =>
	publicHolidays(period).filter((d) => weekday(d) === 6);

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
export const leavePay = (monthlyGross: number, days: number) =>
	cents(grossDay(monthlyGross) * days);

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
const RATES: Record<
	number,
	{ owc: number; T1: Table; T2: Table; T3: Table; T4: Table; T5: Table }
> = {
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

/** The status on a day: citizen from `citizen_on`, SPR from `spr_granted_on`, a foreigner before [CONV]. */
export const statusOn = (e: Scenario['employee'], day: string): Residency => {
	if (e.citizen_on !== undefined && day >= e.citizen_on) return 'CITIZEN';
	if (e.residency === 'CITIZEN' && e.citizen_on === undefined) return 'CITIZEN';
	if (e.residency === 'FOREIGNER') return 'FOREIGNER';
	return e.spr_granted_on !== undefined && day >= e.spr_granted_on ? 'SPR' : 'FOREIGNER';
};

export const cpfTable = (
	e: Scenario['employee'],
	period: string,
	status: Residency = e.residency
): TableName | null => {
	if (status === 'FOREIGNER') return null; // CPFA para 5(dc): no contribution for a foreign employee
	if (status === 'CITIZEN') return 'T1';
	const year = sprYear(e.spr_granted_on!, period);
	if (year === 3 || e.spr_rates === 'FULL') return 'T1';
	if (e.spr_rates === 'FULL_EMPLOYER') return year === 1 ? 'T4' : 'T5';
	return year === 1 ? 'T2' : 'T3';
};

export type TableName = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
export type CpfPart = { table: TableName; ow: number; aw: number };

/**
 * One month's CPF [CPFA para 1; the tables' steps 1–4; para 5(b),(c)] on the CPF-liable parts of the month, each at its
 * table. Ordinarily one part. A conversion month has one part per status [CONV]: the band is selected on the month's
 * total wages `tw` (SG-CPF34.band-on-month-total), one OW ceiling covers the month (SG-CPF34.one-ow-ceiling), and the
 * parts' unrounded contributions are summed before the one monthly rounding (para 5(b)/(c) round "the total amount of
 * contributions" for the month). DEFAULT (law silent): the ceiling is shared pro rata across parts at different tables.
 */
export function cpf(parts: readonly CpfPart[], group: number, year: number, tw: number) {
	const r = RATES[year]!;
	const liable = parts.reduce((a, p) => a + p.ow + p.aw, 0);
	if (tw <= 50 || liable <= 0) return { total: 0, employee: 0, employer: 0 };
	const owAll = parts.reduce((a, p) => a + p.ow, 0);
	const scale = owAll > r.owc ? r.owc / owAll : 1; // "subject to a maximum of x% of the Ordinary Wage Ceiling"
	let total = 0;
	let employee = 0;
	for (const p of parts) {
		const cells = r[p.table];
		const [lowTotal, factor, totalRate, eeRate] = cells[Math.min(group, cells.length - 1)]!;
		const w = p.ow + p.aw;
		if (tw <= 500) total += pct(w, lowTotal);
		else if (tw <= 750) {
			const graduated = factor * (tw - 500) * (w / liable);
			total += pct(w, lowTotal) + graduated;
			employee += graduated;
		} else {
			total += pct(p.ow * scale, totalRate) + pct(p.aw, totalRate);
			employee += pct(p.ow * scale, eeRate) + pct(p.aw, eeRate);
		}
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
export const sdl = (wages: number) =>
	wages <= 0 ? 0 : cents(Math.max(2, pct(Math.min(wages, 4500), 0.25)));

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
/** The SG-SHG03 row of the rung `wages` falls in (e.g. `SG-SHG03.cdac-2000-3500`). */
export const fundRow = (fund: keyof typeof FUNDS, wages: number) => {
	const rungs = FUNDS[fund];
	const i = rungs.findIndex(([upTo]) => wages <= upTo + EPS);
	const name =
		i === 0
			? `le-${rungs[0]![0]}`
			: i === rungs.length - 1
				? `above-${rungs[i - 1]![0]}`
				: `${rungs[i - 1]![0]}-${rungs[i]![0]}`;
	return `SG-SHG03.${fund.toLowerCase()}-${name}`;
};

/** SINDA Rules r.2 "Indian community": the peoples r.2 names (SG-SHG04). */
const SINDA_NAMED = new Set([
	'INDIAN',
	'BANGLADESHI',
	'BENGALI',
	'GOANESE',
	'GUJARATI',
	'MALAYALEE',
	'PAKISTANI',
	'PARSEE',
	'PUNJABI',
	'SIKH',
	'SINDHI',
	'SINHALESE',
	'SRI LANKAN',
	'TAMIL',
	'TELEGU'
]);
/** ICA RaceCode spellings of "every person of Indian descent" (SG-SHG04(a) owner default (i)). */
const SINDA_DESCENT = new Set([
	'TELUGU',
	'GOAN',
	'CEYLONESE',
	'CEYLON MOOR',
	'OTHER INDIAN',
	'MALABARI',
	'MARATHI',
	'MAHRATTA',
	'HINDUSTANI',
	'BRAHMIN',
	'RAJPUT',
	'ASSAMI',
	'MANIPURI',
	'KHASI'
]);
const INDIAN_COMMUNITY = new Set([...SINDA_NAMED, ...SINDA_DESCENT]);
/** SG-SHG04(a) owner default (ii): a single mixed-descent code goes to its first-named descent's fund. */
const CHINESE_DESCENT = new Set(['CHINESE', 'SINO INDIAN', 'SINO JAPANESE', 'SINO KADAZAN']);
const EURASIAN_DESCENT = new Set([
	'EURASIAN',
	'ANGLO BURMESE',
	'ANGLO CHINESE',
	'ANGLO FILIPINO',
	'ANGLO INDIAN',
	'ANGLO THAI',
	'OTHER EURASIAN'
]);
export const shgRaceRow = (race: string) =>
	SINDA_DESCENT.has(race) || CHINESE_DESCENT.has(race) || EURASIAN_DESCENT.has(race)
		? race === 'CHINESE' || race === 'EURASIAN'
			? null
			: 'SG-SHG04(a)'
		: SINDA_NAMED.has(race) && race !== 'INDIAN'
			? 'SG-SHG04'
			: null;
export const indianCommunity = (race: string | undefined) =>
	race !== undefined && INDIAN_COMMUNITY.has(race);
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
		if (CHINESE_DESCENT.has(race)) return local ? 'CDAC' : null;
		if (EURASIAN_DESCENT.has(race)) return local ? 'ECF' : null;
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
	const traced = new Set<string>(['SG-SRC05']); // one of the five dated settings versions governs every month
	const hit = (...ids: string[]) => ids.forEach((id) => traced.add(id));
	const e = s.employment;
	const person = s.employee;
	const days = daysOfMonth(s.period);
	const first = days[0]!;
	const last = days.at(-1)!;
	const holidays = new Set(weekdayHolidays(s.period));
	const employed = (d: string) => d >= e.start && (e.end === undefined || d <= e.end);
	const endsHere = e.end !== undefined && e.end <= last;
	/** EA s.2 rates in force on a day: basic, and gross = basic + fixed allowance (SG-EA10.rate-change) */
	const rateOn = (d: string) => {
		let B = e.monthly_basic;
		let A = e.monthly_allowance ?? 0;
		for (const c of e.rate_changes ?? [])
			if (d >= c.from) {
				B = c.monthly_basic;
				A = c.monthly_allowance ?? A;
			}
		return { B, G: B + A };
	};
	const G = rateOn(e.end !== undefined && e.end < last ? e.end : last).G; // the rate at the month's (or employment's) end
	const B = rateOn(e.end !== undefined && e.end < last ? e.end : last).B;
	if (G !== B) hit('SG-EA01.rate-definitions');
	if (e.workman) hit('SG-EA01.workman');
	if (e.managerial) hit('SG-EA01.manager');
	if (s.employer_unregistered) hit('SG-CPF01.unregistered', 'SG-SHG01.unregistered');
	const npl = new Set(s.month.no_pay_leave ?? []);
	const absent = new Set(s.month.absent ?? []);
	const covered = partFourCovers(e);

	// EA s.20A: working days required in the month (a holiday on a working day counts, SG-EA10.holiday-on-working-day)
	// and days worked (a paid holiday or paid leave counts as worked; a holiday inside requested no-pay leave is
	// unpaid, s.88(2)). With a rate change each rate is priced on its own working days.
	const required = days.filter(isWorkingDay);
	const worked = required.filter((d) => employed(d) && !npl.has(d));
	const incomplete = worked.length < required.length || e.start > first || (e.end ?? '9999') < last;
	const changes = (e.rate_changes ?? []).length > 0;
	const dayShare = (d: string) => rateOn(d).G / required.length;
	let salary = incomplete || changes ? cents(worked.reduce((a, d) => a + dayShare(d), 0)) : G;
	if (incomplete || changes) {
		notes.push(`EA s.20A: ${worked.length}/${required.length} working days`);
		if (e.start > first && e.start <= last) hit('SG-EA10.join');
		if (endsHere && e.end! < last) hit('SG-EA10.exit');
		if (npl.size > 0) hit('SG-EA10.no-pay-leave', 'SG-EA14.no-pay-leave');
		if (changes) hit('SG-EA10.rate-change');
		if (worked.some((d) => holidays.has(d))) hit('SG-EA10.holiday-on-working-day');
	}
	// The holiday calendar shapes this payslip only where days are counted or a holiday is worked, forfeited or off-day.
	const calendarMatters =
		incomplete ||
		changes ||
		absent.size > 0 ||
		(s.month.holiday_work ?? []).length > 0 ||
		offDayHolidays(s.period).length > 0;
	if (calendarMatters)
		for (const h of publicHolidays(s.period).filter(employed)) {
			hit(
				h.startsWith('2025')
					? 'SG-HOL01.2025-12'
					: h.startsWith('2026')
						? 'SG-HOL01.2026'
						: 'SG-HOL02'
			);
			if (SUNDAY_SUBSTITUTES.has(h)) hit('SG-HOL01.sunday');
		}
	for (const h of holidays) if (npl.has(h)) hit('SG-EA33.no-pay-leave');
	for (const l of s.month.paid_leave ?? [])
		hit(
			l.kind === 'ANNUAL'
				? 'SG-EA34.leave-pay'
				: l.kind === 'OUTPATIENT'
					? 'SG-EA35.outpatient'
					: 'SG-EA35.hospitalisation'
		);

	// EA s.28(2): "in the case of a monthly-rated employee the amount of deduction in respect of any one day is the gross
	// rate of pay for one day's work" (s.107A Third Schedule). EA s.88(3): an absence without consent or excuse on the
	// working day immediately before or after a public holiday forfeits that holiday's pay, once per holiday.
	// DEFAULT (law silent): a public holiday is not itself a "working day" when finding the neighbour.
	const workingNeighbour = (h: string, step: 1 | -1) => {
		const pool = required.filter((d) => !holidays.has(d));
		return step === -1 ? pool.filter((d) => d < h).at(-1) : pool.find((d) => d > h);
	};
	const adjacentAbsence = (h: string) =>
		[workingNeighbour(h, -1), workingNeighbour(h, 1)].some((d) => d !== undefined && absent.has(d));
	const forfeited = [...holidays].filter(
		(h) =>
			employed(h) &&
			!npl.has(h) &&
			!(s.month.holiday_work ?? []).some((w) => w.date === h) &&
			adjacentAbsence(h)
	);
	const absenceDays = [...absent].filter((d) => employed(d));
	const absenceDeduction = cents(
		[...absenceDays, ...forfeited].reduce((a, d) => a + grossDay(rateOn(d).G), 0)
	);
	if (absenceDays.length > 0) hit('SG-EA14.unexcused-absence', 'SG-EA40.fixed-monthly');
	if (forfeited.length > 0) hit('SG-EA33.adjacent-absence');
	if (absenceDeduction > 0)
		notes.push(
			`EA s.28(2)/s.88(3): ${absenceDays.length + forfeited.length} gross day(s) deducted`
		);
	salary = cents(Math.max(0, salary - absenceDeduction));

	// EA s.88(1)(c): a holiday on the Saturday off day is paid at the gross rate for one day, or a substitute day off is
	// given (then nothing extra). s.88(3) forfeiture applies alike.
	let offDayPay = 0;
	for (const h of offDayHolidays(s.period)) {
		if (!employed(h)) continue;
		hit('SG-HOL01.saturday');
		if (s.month.off_day_holiday === 'SUBSTITUTE') {
			hit('SG-EA33.substitution');
			continue;
		}
		if (adjacentAbsence(h)) {
			hit('SG-EA33.adjacent-absence');
			continue;
		}
		offDayPay += grossDay(rateOn(h).G);
		hit('SG-EA33.non-working-day', 'SG-EA40.fixed-monthly');
	}
	offDayPay = cents(offDayPay);

	// Overtime [EA s.38(4) Part 4 only, s.35]: 1.5 × the Fourth Schedule hourly basic for each hour beyond the normal day.
	// DEFAULT (law silent, SG-EA22 owner rule): overtime starts after the contract's normal day. Hourly rate unrounded,
	// amount half-up to the cent (SG-EA46-R01 owner rule).
	let overtime = 0;
	const otHours = (s.month.overtime ?? []).reduce((a, o) => a + o.hours, 0);
	const scopeRow = e.managerial
		? 'SG-EA19.manager'
		: e.workman
			? 'SG-EA19.workman'
			: 'SG-EA19.non-workman';
	if (otHours > 0 || (s.month.rest_day_work ?? []).length > 0) hit(scopeRow);
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
			hit('SG-PT06', 'SG-PT02', 'SG-EA27', 'SG-SL11');
		} else {
			overtime = cents(1.5 * hourlyBasic(B) * otHours);
			hit('SG-EA46.monthly', 'SG-EA22');
			if (!e.workman) hit('SG-EA46-R01');
		}
	}
	if (!covered && otHours > 0) notes.push('EA s.35: outside Part 4, no statutory overtime pay');

	// Rest-day work [EA s.37(2)–(3), Part 4]; basic day per Third Schedule, hourly basic per s.37(3A)(b).
	let restDay = 0;
	if (covered)
		for (const w of s.month.rest_day_work ?? []) {
			const normal = e.daily_hours;
			const byEmployer = w.requested_by === 'EMPLOYER';
			const size = w.hours <= normal / 2 ? 'half' : w.hours <= normal ? 'full' : 'beyond';
			const daysPaid = size === 'half' ? (byEmployer ? 1 : 0.5) : byEmployer ? 2 : 1;
			const excess = w.hours > normal ? Math.ceil(w.hours - normal - EPS) : 0; // "each hour or part thereof"
			restDay += cents(basicDay(B) * daysPaid + 1.5 * hourlyBasic(B) * excess);
			hit(`SG-EA21.${byEmployer ? 'employer' : 'employee'}-${size}`, 'SG-EA40.fixed-monthly');
		}

	// Holiday work [EA s.88(4)]: an extra day's salary at the basic rate on top of the day's gross pay (inside the monthly
	// salary); hours beyond the normal day are overtime under s.38(4) at 1.5 × hourly basic (Part 4). s.88(4A): outside
	// Part 4 (not s.35(b), not a s.35(a) workman) agreed time off in lieu replaces the extra day.
	let holidayWork = 0;
	for (const w of s.month.holiday_work ?? []) {
		hit('SG-EA33.holiday-work');
		if (w.time_off_in_lieu) hit('SG-EA33.outside-part4-time-off');
		const extraDay = w.time_off_in_lieu && !covered ? 0 : basicDay(B);
		const beyond = covered ? 1.5 * hourlyBasic(B) * Math.max(0, w.hours - e.daily_hours) : 0;
		if (beyond > 0) hit('SG-EA33.holiday-work-beyond-normal');
		holidayWork += cents(extraDay + beyond);
	}

	const bonus = s.month.bonus ?? 0;
	if (bonus > 0) hit('SG-CPF04.bonus', 'SG-SDL02.bonus');
	const leaveOnExit = s.month.leave_days_paid_on_exit
		? leavePay(G, s.month.leave_days_paid_on_exit)
		: 0;
	if (leaveOnExit > 0) hit('SG-CPF04.leave-pay', 'SG-EA34.exit-payment', 'SG-EA40.fixed-monthly');
	const silon =
		s.month.notice_in_lieu_weeks || s.month.notice_in_lieu_days
			? noticePayInLieu(G, s.month.notice_in_lieu_weeks ?? 0, s.month.notice_in_lieu_days ?? 0)
			: 0;
	if (silon > 0)
		hit(
			'SG-EA05.in-lieu-of-notice',
			'SG-CPF04.notice-compensation',
			'SG-SDL02.notice-pay',
			'SG-EA40.fixed-monthly'
		);
	const medical = s.month.medical_reimbursement ?? 0;
	if (medical > 0) hit('SG-CPF04.medical-reimbursement', 'SG-SDL03', 'SG-SDL03A', 'SG-CPF-MED01');
	const retrenchment = s.month.retrenchment_benefit ?? 0;
	if (retrenchment > 0) hit('SG-CPF04.retrenchment-benefit', 'SG-EA24-R02');

	// CPF classes [CPFA para 5(d),(e)]: OW = remuneration wholly for this month's employment; AW = bonus and leave pay on
	// exit (SG-CPF04). Outside CPF wages: salary in lieu of notice, retrenchment benefit, qualifying medical reimbursement.
	const ow = cents(salary + overtime + restDay + holidayWork + offDayPay);
	const aw = cents(bonus + leaveOnExit);
	const gross = cents(ow + aw + silon + medical + retrenchment);

	const charges: Charge[] = [];
	const year = Number(s.period.slice(0, 4));
	const m = Number(s.period.slice(5, 7));
	const owc = RATES[year]!.owc;
	// DEFAULT (law silent): AW is payable on the period's last day, or the last day of employment when it ends here.
	const payday = endsHere ? e.end! : last;
	const endTable = cpfTable(person, s.period, statusOn(person, payday));
	const tableOn = (d: string) => cpfTable(person, s.period, statusOn(person, d));
	const conversion = new Set(worked.map((d) => statusOn(person, d))).size > 1;
	// [CONV] a conversion month splits the salary on s.20A working days by status (owner rule 2026-09-28); other OW is
	// taken at the month-end status (DEFAULT, law silent).
	const owParts = new Map<TableName | null, number>();
	if (conversion) {
		for (const d of worked) owParts.set(tableOn(d), (owParts.get(tableOn(d)) ?? 0) + dayShare(d));
		owParts.set(endTable, (owParts.get(endTable) ?? 0) + (ow - salary));
		for (const [t, v] of owParts) owParts.set(t, cents(v));
		hit('SG-CPF34.band-on-month-total');
		if (person.citizen_on !== undefined) hit('SG-CPF34.spr-to-citizen');
		else hit('SG-CPF34.foreigner-to-spr', 'SG-CPF09.conversion-month');
		if (aw > 0) hit('SG-CPF34.aw-status', 'SG-CPF09.conversion-month-aw');
	} else owParts.set(endTable, ow);
	const liableOw = [...owParts].filter(([t]) => t !== null).reduce((a, [, v]) => a + v, 0);
	if (owParts.has(null)) hit('SG-CPF01.foreigner');

	if (endTable !== null) {
		// AW ceiling [CPFA para 2(1)–(4), 4A(d)]: 102,000 less this employer's OW for the year (each month capped at the OWC)
		// less AW already payable. Recomputed at the last month of employment and at December on actual OW; otherwise on
		// an estimate. DEFAULT (law silent on the estimate method, para 2(3) "may"): the month's capped OW carried to December.
		// A former employer's OW is not imported (SG-CPF22.per-employer) unless the Board approved a single ceiling.
		const opening = s.cpf_opening ?? { ordinary_wages_ytd: 0, additional_wages_ytd: 0 };
		const related = opening.related_company_approved ? (opening.other_employer_ow_ytd ?? 0) : 0;
		const owThis = Math.min(liableOw, owc);
		const lastMonth = m === 12 || endsHere;
		const yearOw =
			opening.ordinary_wages_ytd + related + owThis + (lastMonth ? 0 : owThis * (12 - m));
		const rawRoom = AW_APPLICABLE_AMOUNT - yearOw - opening.additional_wages_ytd;
		const awc = Math.min(aw, Math.max(0, rawRoom));
		if (aw > 0) {
			hit('SG-CPF03.per-employer', 'SG-CPF22.per-employer');
			if (m === 12) hit('SG-CPF03.december-true-up', 'SG-CPF21.december-true-up');
			else if (endsHere) hit('SG-CPF03.exit-true-up', 'SG-CPF21.leaver-true-up');
			else hit('SG-CPF21.estimate');
			if (opening.related_company_approved)
				hit('SG-CPF03.related-company', 'SG-CPF22.related-transfer');
			if (rawRoom < 0) hit('SG-CPF03.excess-refund', 'SG-CPF21.overpayment');
		}
		if (awc < aw) notes.push(`CPFA para 2: AW ${aw} capped at ${awc}`);
		const parts: CpfPart[] = [...owParts]
			.filter((p): p is [TableName, number] => p[0] !== null)
			.map(([table, v]) => ({ table, ow: v, aw: table === endTable ? awc : 0 }));
		const tw = ow + awc; // para 5(f) Total Wages: the month's whole OW (SG-CPF34.band-on-month-total) plus chargeable AW
		const group = ageGroup(person.birth_date, s.period);
		const c = cpf(parts, group, year, tw);
		charges.push({
			code: 'CPF',
			employee: c.employee,
			employer: c.employer,
			base: cents(Math.min(liableOw, owc) + awc)
		});
		notes.push(`CPF ${parts.map((p) => p.table).join('+')} group ${group} rates ${year}`);

		for (const p of parts) {
			hit(`SG-CPF19.table-${p.table.slice(1)}`);
			if (p.table === 'T1') {
				if (statusOn(person, payday) === 'CITIZEN' && (!conversion || p.table === endTable))
					hit('SG-CPF01.citizen');
				if (
					person.residency === 'SPR' &&
					person.spr_rates === 'FULL' &&
					sprYear(person.spr_granted_on!, s.period) < 3
				)
					hit('SG-CPF09.full-full');
				else if (
					person.spr_granted_on !== undefined &&
					person.citizen_on === undefined &&
					sprYear(person.spr_granted_on, s.period) === 3
				)
					hit('SG-CPF01.spr-third-year');
			} else {
				hit(
					p.table === 'T2' || p.table === 'T3' ? 'SG-CPF09.graduated' : 'SG-CPF09.full-graduated'
				);
				if (year === 2027) hit('SG-CPF31.spr-tables');
			}
			if (tw > 50 && p.table === 'T1' && (group > 0 || year === 2027)) {
				const g = ['55-and-below', 'above-55-60', 'above-60-65', 'above-65-70', 'above-70'][group]!;
				hit(year === 2027 ? `SG-CPF29.${g}` : `SG-CPF18.${g}`);
			}
		}
		if (tw <= 50) hit('SG-CPF17.nil-band');
		else if (tw <= 500) hit('SG-CPF17.employer-only-band');
		else if (tw <= 750) hit('SG-CPF17.graduated-band');
		else hit('SG-CPF17.total-rounding', 'SG-CPF17.employee-share');
		if (tw > 50 && tw <= 750 && year === 2027) hit('SG-CPF31.low-wage');
		if (aw > 0) hit('SG-CPF17.band-on-total-wages');
		if (awc > 0 && tw > 750) hit('SG-CPF17.ow-aw-unrounded');
		if (liableOw > owc) {
			hit('SG-CPF17.ow-maximum', year === 2025 ? 'SG-CPF02.2025' : 'SG-CPF02.2026');
			if (conversion) hit('SG-CPF34.one-ow-ceiling');
		}
		if (person.sdl_exempt_student) hit('SG-CPF13.default');
	}

	// SDL [SDLA ss.2–3] on all money remuneration for the month, bonus, salary in lieu of notice and retrenchment benefit
	// included (SG-SDL02, SG-EA24-R02 default); qualifying medical reimbursement excluded [MED]. Outside SDL: services
	// wholly outside Singapore (s.2), a listed-institution student in approved training (SG-SDL04A).
	const sdlWages = cents(gross - medical);
	let levy = 0;
	if (person.sdl_exempt_student) hit('SG-SDL04A');
	else if (e.wholly_outside_singapore) hit('SG-SDL01.outside-singapore');
	else if (sdlWages <= 0) hit('SG-SDL02.no-wages');
	else {
		levy = sdl(sdlWages);
		hit('SG-SDL01.singapore-service');
		hit(sdlWages < 800 ? 'SG-SDL02.minimum' : sdlWages <= 4500 ? 'SG-SDL02.rate' : 'SG-SDL02.cap');
		if (
			sdlWages >= 800 &&
			Math.abs(
				pct(Math.min(sdlWages, 4500), 0.25) * 100 -
					Math.round(pct(Math.min(sdlWages, 4500), 0.25) * 100)
			) > EPS
		)
			hit('SG-SDL13');
		if (e.household_role) hit('SG-SDL01.company-household-role');
	}
	charges.push({
		code: 'SDL',
		employee: 0,
		employer: levy,
		base: levy > 0 ? cents(Math.min(sdlWages, 4500)) : 0
	});

	// Funds on the month's total CPF wages (OW + AW, uncapped) [Rules Schedule Part 2], on the status at the month's end
	// (SG-CPF34.shg-funds); nothing without wages. A fund instruction replaces the rung (CDAC r.8, SINDA r.8(2)).
	const fundWages = cents(ow + aw);
	if (fundWages > 0)
		for (const f of funds(person)) {
			const instructed =
				person.shg_instruction?.fund === f ? person.shg_instruction.amount : undefined;
			charges.push({
				code: f,
				employee: instructed ?? fundAmount(f, fundWages),
				employer: 0,
				base: fundWages
			});
			hit(
				instructed !== undefined ? `SG-SHG03.${f.toLowerCase()}-instruction` : fundRow(f, fundWages)
			);
			if (conversion) hit('SG-CPF34.shg-funds');
			if (f === 'MBMF' && person.residency === 'FOREIGNER') hit('SG-SHG02.foreign-muslim');
			if (f === 'SINDA' && person.residency === 'FOREIGNER') hit('SG-SHG04(b)');
		}
	if (fundWages > 0) {
		if (person.religion === 'ISLAM' && indianCommunity(person.race)) hit('SG-SHG01.muslim-indian');
		if ((person.shg_opt_out ?? []).length > 0) hit('SG-SHG01.opt-out');
		const r1 = shgRaceRow(person.race);
		if (r1) hit(r1);
		if (person.shg_dual_election && person.second_race) {
			const firstIndian = indianCommunity(person.race);
			const secondIndian = indianCommunity(person.second_race);
			if (firstIndian && CHINESE_DESCENT.has(person.second_race))
				hit(
					'SG-SHG01.indian-chinese',
					person.race === 'INDIAN'
						? 'SG-SHG04(c).indian-first-cdac'
						: 'SG-SHG04(c).other-first-cdac'
				);
			if (CHINESE_DESCENT.has(person.race) && secondIndian)
				hit('SG-SHG01.chinese-indian', 'SG-SHG04(c).chinese-first-sinda');
			if (firstIndian && secondIndian) hit('SG-SHG04(c).dual-sinda-refused');
		}
	}

	// EA s.29(1): a damage deduction ≤ the loss and, except with the Commissioner's permission, ≤ one-quarter of one
	// month's wages (read: the monthly gross rate). EA s.32(1): all deductions in the salary period (other than
	// s.27(1)(a), (f), (j)) ≤ 50% of the salary payable for it (read: the month's gross; CPF and funds counted first);
	// s.32(2): not on the last salary on termination.
	let damage = 0;
	const statutoryEmployee = charges.reduce((a, c) => a + c.employee, 0);
	if (s.month.damage_recovery) {
		const d = s.month.damage_recovery;
		damage = d.commissioner_permitted ? d.loss : Math.min(d.loss, cents(G / 4));
		hit(d.commissioner_permitted ? 'SG-EA15.commissioner-permitted' : 'SG-EA15.damage');
		if (endsHere) hit('SG-EA17.final-salary');
		else {
			const room = Math.max(0, cents(0.5 * gross - statutoryEmployee));
			if (damage > room) hit('SG-EA17.half-ceiling');
			damage = Math.min(damage, room);
		}
		damage = cents(damage);
	}

	const totalDeductions = cents(statutoryEmployee + damage);
	const employerCost = cents(gross + charges.reduce((a, c) => a + c.employer, 0));
	const net = cents(gross - totalDeductions);
	const lines: Record<string, number> = {
		gross,
		net,
		total_deductions: totalDeductions,
		employer_cost: employerCost
	};
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
			off_day_holiday: offDayPay,
			overtime,
			rest_day: restDay,
			holiday_work: holidayWork,
			bonus,
			leave_on_exit: leaveOnExit,
			salary_in_lieu_of_notice: silon,
			medical_reimbursement: medical,
			retrenchment_benefit: retrenchment,
			damage_recovery: damage
		},
		charges,
		lines,
		notes,
		rows: [...traced].sort()
	};
}
