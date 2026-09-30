/**
 * Independent MY payslip oracle: expected lines computed from the law alone, never from the engine.
 *
 * Every figure below comes from a primary source read on 2026-09-30 (cited at the rule that uses it) or from a
 * row of docs/inventory/malaysia.csv that states the law or a recorded owner-rule default. Nothing is read from
 * src/**, seed/** or tests/e2e/probes/**.
 *
 * Sources:
 *   [EA]    Employment Act 1955 (Act 265), AGC reprint as at 1 August 2023
 *           https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf
 *   [TLB]   Employment (Termination and Lay-Off Benefits) Regulations 1980, P.U.(A) 338/83 as amended
 *           https://jtksm.mohr.gov.my/sites/default/files/2023-03/8.%20EMPLOYMENT%20%28TERMINATION%20%26%20LAY%20OFF%20BENEFITS%29%20REGULATIONS%201980_0.pdf
 *   [MWO]   Minimum Wages Order 2024, P.U.(A) 376/2024 paras 2, 5 https://gajiminimum.mohr.gov.my/wp-content/uploads/PUA%20376.pdf
 *   [EPF]   EPF Act 1991 Third Schedule effective 1 October 2025 (Parts A, C, E) and Act A1760 Part F para 2
 *           https://www.kwsp.gov.my/en/epf-act-1991-third-schedule ; tracker MY-EPF-01 (row rule "rate on the row
 *           ceiling, rounded up to the ringgit", checked against all 1,200 printed rows; Part F split default)
 *   [SOCSO] Act A1788 (2026) substituted Third Schedule, First Phase Parts I and IV (in force 1 June 2026, P.U.(B)
 *           196/2026) https://www.perkeso.gov.my/images/akta/ACT%204/Act_A1788_-_EMPLOYEES_SOCIAL_SECURITY_AMENDMENT_ACT_2026.pdf
 *           columns (3)(A)+(3)(B) employer, (4)(A) employee equal Act 4 Third Schedule Parts I/III before June 2026
 *           (AGC text as at 1 October 2024, https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf,
 *           rows 1-10 compared programmatically, rows 21/34/55/64 by eye); Act 4 First Schedule para 12 (second category)
 *   [EIS]   Employment Insurance System Act 2017 (Act 800) Second Schedule and First Schedule paras 8-10, as amended
 *           by Act A1725 (RM6,000 ceiling, items 55-65)
 *           https://www.perkeso.gov.my/images/akta/ACT%20800/Akta%20800_EMPLOYMENT%20INSURANCE%20SYSTEM%20ACT%202017.pdf
 *   [MTD]   LHDN Specification for MTD Calculations Using Computerized Calculation for 2026 (updated 1 January 2026)
 *           https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf
 *           D(a), D(b)1-2, Table 1, E(1)-(4), E(9), E(13), E(14); LHDN Navigasi 2026 p.51 (overtime is normal
 *           remuneration; compensation for loss of employment is additional)
 *           https://www.hasil.gov.my/wp-content/uploads/navigasi-hasil-2026.pdf
 *   [HRD]   Pembangunan Sumber Manusia Berhad Act 2001 (Act 612) ss.2, 14-15, AGC reprint 2017; P.U.(A) 13/2026
 *           (tracker MY-HRD-01/02, MY-HRD11, MY-HRDA02)
 *   [BASES] Act 4 s.2(24), Act 800 s.2, Act 452 s.2, Act 612 s.2 as recorded in tracker MY-WAGEBASE-01
 *
 *   [ITA]   Income Tax Act 1967 as at 1 January 2026, s.7(1)(a),(c)(ii), s.48(4), Sch.6 paras 21-22, Sch.1 para 1A
 *           https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3345910_BI/Act%2053%20(Online%202026).pdf
 *           (tracker MY-PCB-02 LIT-09, MY-PCB-06 LIT-03, MY-PCB-07)
 *   [LINDUNG] PERKESO LINDUNG 24 Jam FAQ 13 July 2026 (tracker MY-SKBBK-04: a local's accepted release ends the
 *           charge from the 8 July 2026 version; a non-citizen's release has no effect; June 2026 stays mandatory)
 *           https://www.perkeso.gov.my/images/lindung/lindung-24-jam/130726-FAQ_LINDUNG_24_JAM.pdf
 *
 * Probe-tenant data assumption (not law): the harness records no earlier payslip in the tax year, so the MTD
 * accumulators ∑(Y−K), K, X and Z are zero unless the scenario files a TP3 (previous employer); no TP1 is filed.
 *
 * Where the law is silent or ambiguous and the tracker records no owner default, the key is listed in
 * `unresolved` with the reason; a comparison must skip those keys rather than invent a figure.
 */
import type { Scenario } from '../profiles/MY';

export type Line = { amount?: number; employee?: number; employer?: number; base?: number };
export type Expected = {
	id: string;
	/** Set when the law forbids issuing the payslip as described (the run must be refused). */
	refused?: { reason: string; citation: string };
	/** Line code → amounts. Earnings carry `amount`; statutory schemes carry `employee`/`employer`/`base`. */
	lines: Record<string, Line>;
	/** Keys whose value the law does not settle, with the reason. */
	unresolved: { key: string; reason: string }[];
	/** Which legal branches this payslip took. */
	branches: string[];
};

// ---------------------------------------------------------------------------------------------- arithmetic
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
/** [MTD] E(1): calculations are limited to two decimals, later figures omitted. */
const trunc2 = (x: number) =>
	x < 0 ? -Math.floor(-x * 100 + 1e-7) / 100 : Math.floor(x * 100 + 1e-7) / 100;
/** [MTD] E(2): round up to the next five sen. */
const up5 = (x: number) => (Math.ceil(Math.round(x * 100) / 5 - 1e-9) * 5) / 100;
const cents = (x: number) => Math.round(x * 100);

// ---------------------------------------------------------------------------------------------- dates
const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (d: string) => new Date(day(d)).getUTCDay(); // 0 Sunday … 6 Saturday
/** Whole years attained on `on`. */
export function ageOn(birth: string, on: string) {
	let a = +on.slice(0, 4) - +birth.slice(0, 4);
	if (on.slice(5) < birth.slice(5)) a--;
	return a;
}
/** Completed months from `from` through `to` inclusive, and the days left over. */
function servedMonths(from: string, to: string) {
	const end = day(to) + DAY; // the day after the last day served
	let [y, m, d] = [+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)];
	let months = 0;
	for (;;) {
		const next = Date.UTC(y, m + months + 1, Math.min(d, daysIn(y, m + months + 2)));
		if (next > end) break;
		months++;
	}
	const anchor = Date.UTC(y, m + months, Math.min(d, daysIn(y, m + months + 1)));
	return { months, days: Math.round((end - anchor) / DAY) };
}

// ---------------------------------------------------------------------------------------------- EPF
/**
 * [EPF] Third Schedule table method for wages ≤ RM20,000: the row is RM20 wide to RM5,000 (first rows: up to
 * RM10 nil, RM10.01–20), RM100 wide above; each share is its rate on the row ceiling rounded up to the ringgit
 * (tracker MY-EPF-01, Round 9: all 1,200 printed rows of Parts A, C and E equal this rule). Above RM20,000 the
 * exact percentage applies, rounded up to the ringgit (KWSP note 2).
 */
function epfShare(wageCents: number, bp: number) {
	if (wageCents <= 1000) return 0;
	let ceiling: number;
	if (wageCents <= 2000) ceiling = 2000;
	else if (wageCents <= 500000) ceiling = Math.ceil(wageCents / 2000) * 2000;
	else if (wageCents <= 2000000) ceiling = Math.ceil(wageCents / 10000) * 10000;
	else ceiling = wageCents;
	return Math.ceil((ceiling * bp) / 1_000_000 - 1e-9); // whole ringgit
}
type Epf = { code: string; employee: number; employer: number; part: string } | null;
function epf(s: Scenario, age: number, wage: number, wageExBonus: number): Epf {
	const w = cents(wage);
	if (w <= 0) return null;
	const cz = s.employee.citizenship;
	// First Schedule para 13 (tracker MY-EPF-01, MY-EPF-03): no contribution from age 75.
	if (age >= 75) return null;
	if (cz === 'FOREIGNER') {
		// A1760 Third Schedule Part F: 2% + 2%, "the total contribution which includes cents shall be rounded to the
		// next ringgit"; split silent → tracker R01 default: employee 2% truncated to the sen, employer the rest.
		const ee = Math.floor((w * 200) / 10000);
		const total = Math.ceil((w * 400) / 1_000_000 - 1e-9) * 100;
		return { code: 'EPF_NON_CITIZEN', employee: ee / 100, employer: (total - ee) / 100, part: 'F' };
	}
	// Part A (under 60, citizen or PR): employee 11%; employer 13% where wages ≤ RM5,000 else 12%. The Part A bonus
	// note keeps 13% when only the bonus lifts the month over RM5,000 (tracker MY-WAGEBASE-01 golden 3,000 + 12,000).
	const lowBand = cents(wageExBonus) <= 500000;
	if (age < 60) {
		const code = cz === 'CITIZEN' ? 'EPF' : 'EPF_PR';
		return {
			code,
			employee: epfShare(w, 1100),
			employer: epfShare(w, lowBand ? 1300 : 1200),
			part: 'A'
		};
	}
	if (cz === 'CITIZEN')
		// Part E: citizen 60 to under 75, employee nil, employer 4%.
		return { code: 'EPF', employee: 0, employer: epfShare(w, 400), part: 'E' };
	// Part C: PR (and pre-1998 noncitizen member) aged 60+: employee 5.5%, employer 6.5% ≤ RM5,000 else 6%
	// (tracker MY-EPF-TRANS-02, KWSP noncitizen FAQ Q23).
	return {
		code: 'EPF_PR',
		employee: epfShare(w, 550),
		employer: epfShare(w, lowBand ? 650 : 600),
		part: 'C'
	};
}

// ---------------------------------------------------------------------------------------------- SOCSO / SKBBK / EIS
// [SOCSO] A1788 First Phase Part I, 65 rows, cents: [invalidity employer (3)(A), employment injury employer (3)(B),
// invalidity employee (4)(A), non-employment injury employee (4)(B)].
const SOCSO_FIRST: readonly (readonly [number, number, number, number])[] = [
	[10, 30, 10, 20],
	[20, 50, 20, 30],
	[30, 80, 30, 50],
	[40, 110, 40, 65],
	[60, 150, 60, 90],
	[85, 210, 85, 125],
	[125, 310, 125, 185],
	[175, 440, 175, 265],
	[225, 560, 225, 335],
	[275, 690, 275, 415],
	[325, 810, 325, 485],
	[375, 940, 375, 565],
	[425, 1060, 425, 635],
	[475, 1190, 475, 715],
	[525, 1310, 525, 785],
	[575, 1440, 575, 865],
	[625, 1560, 625, 935],
	[675, 1690, 675, 1015],
	[725, 1810, 725, 1085],
	[775, 1940, 775, 1165],
	[825, 2060, 825, 1235],
	[875, 2190, 875, 1315],
	[925, 2310, 925, 1385],
	[975, 2440, 975, 1465],
	[1025, 2560, 1025, 1535],
	[1075, 2690, 1075, 1615],
	[1125, 2810, 1125, 1685],
	[1175, 2940, 1175, 1765],
	[1225, 3060, 1225, 1835],
	[1275, 3190, 1275, 1915],
	[1325, 3310, 1325, 1985],
	[1375, 3440, 1375, 2065],
	[1425, 3560, 1425, 2135],
	[1475, 3690, 1475, 2215],
	[1525, 3810, 1525, 2285],
	[1575, 3940, 1575, 2365],
	[1625, 4060, 1625, 2435],
	[1675, 4190, 1675, 2515],
	[1725, 4310, 1725, 2585],
	[1775, 4440, 1775, 2665],
	[1825, 4560, 1825, 2735],
	[1875, 4690, 1875, 2815],
	[1925, 4810, 1925, 2885],
	[1975, 4940, 1975, 2965],
	[2025, 5060, 2025, 3035],
	[2075, 5190, 2075, 3115],
	[2125, 5310, 2125, 3185],
	[2175, 5440, 2175, 3265],
	[2225, 5560, 2225, 3335],
	[2275, 5690, 2275, 3415],
	[2325, 5810, 2325, 3485],
	[2375, 5940, 2375, 3565],
	[2425, 6060, 2425, 3635],
	[2475, 6190, 2475, 3715],
	[2525, 6310, 2525, 3785],
	[2575, 6440, 2575, 3865],
	[2625, 6560, 2625, 3935],
	[2675, 6690, 2675, 4015],
	[2725, 6810, 2725, 4085],
	[2775, 6940, 2775, 4165],
	[2825, 7060, 2825, 4235],
	[2875, 7190, 2875, 4315],
	[2925, 7310, 2925, 4385],
	[2975, 7440, 2975, 4465],
	[2975, 7440, 2975, 4465]
];
// [SOCSO] A1788 First Phase Part IV (second category), cents: [employment injury employer, non-employment injury employee].
const SOCSO_SECOND: readonly (readonly [number, number])[] = [
	[30, 20],
	[50, 30],
	[80, 50],
	[110, 65],
	[150, 90],
	[210, 125],
	[310, 185],
	[440, 265],
	[560, 335],
	[690, 415],
	[810, 485],
	[940, 565],
	[1060, 635],
	[1190, 715],
	[1310, 785],
	[1440, 865],
	[1560, 935],
	[1690, 1015],
	[1810, 1085],
	[1940, 1165],
	[2060, 1235],
	[2190, 1315],
	[2310, 1385],
	[2440, 1465],
	[2560, 1535],
	[2690, 1615],
	[2810, 1685],
	[2940, 1765],
	[3060, 1835],
	[3190, 1915],
	[3310, 1985],
	[3440, 2065],
	[3560, 2135],
	[3690, 2215],
	[3810, 2285],
	[3940, 2365],
	[4060, 2435],
	[4190, 2515],
	[4310, 2585],
	[4440, 2665],
	[4560, 2735],
	[4690, 2815],
	[4810, 2885],
	[4940, 2965],
	[5060, 3035],
	[5190, 3115],
	[5310, 3185],
	[5440, 3265],
	[5560, 3335],
	[5690, 3415],
	[5810, 3485],
	[5940, 3565],
	[6060, 3635],
	[6190, 3715],
	[6310, 3785],
	[6440, 3865],
	[6560, 3935],
	[6690, 4015],
	[6810, 4085],
	[6940, 4165],
	[7060, 4235],
	[7190, 4315],
	[7310, 4385],
	[7440, 4465],
	[7440, 4465]
];
/** Row index 0..64 of the 65-row PERKESO wage bands (up to 30, 50, 70, 100, 140, 200, 300, then RM100 to 6,000, above). */
function perkesoRow(wage: number) {
	const w = cents(wage);
	const edges = [3000, 5000, 7000, 10000, 14000, 20000, 30000];
	for (let i = 0; i < edges.length; i++) if (w <= edges[i]!) return i;
	if (w > 600000) return 64;
	return 7 + Math.ceil((w - 30000) / 10000) - 1;
}
/** [EIS] Second Schedule: rows 1-6 5/10/15/20/25/35 sen, row 7 (RM200-300) 50 sen, +20 sen per RM100 row to row 64 RM11.90; row 65 RM11.90 (A1725). */
function eisShare(wage: number) {
	const row = perkesoRow(wage) + 1;
	if (row <= 6) return [5, 10, 15, 20, 25, 35][row - 1]! / 100;
	return Math.min(50 + 20 * (row - 7), 1190) / 100;
}

// ---------------------------------------------------------------------------------------------- MTD (PCB)
/** [MTD] Table 1 (P, M, R, B by category). */
const TABLE1: readonly [number, number, number, number][] = [
	// [M, R, B cat 1&3, B cat 2]; row applies when P > M
	[2_000_000, 0.3, 528_400, 528_400],
	[600_000, 0.28, 136_400, 136_400],
	[400_000, 0.26, 84_400, 84_400],
	[100_000, 0.25, 9_400, 9_400],
	[70_000, 0.19, 3_700, 3_700],
	[50_000, 0.11, 1_500, 1_500],
	[35_000, 0.06, 600, 600],
	[20_000, 0.03, -250, -650],
	[5_000, 0.01, -400, -800]
];
function annualTax(P: number, category: 1 | 2 | 3) {
	const row = TABLE1.find(([M]) => P > M);
	if (row === undefined) return 0;
	const [M, R, B1, B2] = row;
	return (P - M) * R + (category === 2 ? B2 : B1);
}
/**
 * [MTD] D(b)1-2 (spec pp.10-12, re-read 2026-09-30). EPF relief limit RM4,000 (E(14)(i)(d)); "K + K1 + K2 + Kt not
 * exceeding the total qualifying amount per year". ∑(Y−K), K, X, Z come from a TP3 (previous employer) or are nil.
 */
function residentMtd(o: {
	month: number;
	Y1: number;
	K1: number;
	Yt: number;
	Kt: number;
	category: 1 | 2 | 3;
	/** Qualifying-child units C: whole children plus ITA s.48(4) 50% shares. */
	children: number;
	zakat: number;
	prior: { remuneration: number; epf: number; mtd: number; zakat: number };
}) {
	const n = 12 - o.month;
	const LIMIT = 4000;
	const K = Math.min(o.prior.epf, LIMIT);
	const sumYK = o.prior.remuneration - K;
	const X = o.prior.mtd;
	const Z = o.prior.zakat; // "accumulated zakat paid in the current year other than zakat for the current month"
	const K1 = Math.min(o.K1, LIMIT - K);
	const Kt = Math.min(o.Kt, LIMIT - K - K1);
	// D RM9,000 automatic; S RM4,000 only in category 2; Q RM2,000 × C, C = 0 in category 1 (spec p.10-11, E(14)(i)(a)-(c)).
	const reliefs = 9000 + (o.category === 2 ? 4000 : 0) + (o.category === 1 ? 0 : 2000 * o.children);
	// K2 = [RM4,000 − (K + K1 + Kt)] / n or K1, whichever is lower.
	const k2 = (kt: number) =>
		n === 0 ? 0 : Math.max(0, Math.min(trunc2((LIMIT - (K + K1 + kt)) / n), K1));
	// Step 1: normal remuneration only; [C] = [(P − M)R + B − (Z + X)] / (n + 1).
	const P1 = trunc2(sumYK + o.Y1 - K1 + (o.Y1 - k2(0)) * n - reliefs);
	const raw = Math.max(0, trunc2((annualTax(P1, o.category) - (Z + X)) / (n + 1)));
	const mtdN = up5(raw);
	// E(3): below RM10 before zakat the employer does not deduct; E(4)/E(5): zakat nets the current month's MTD, never below nil.
	const normalPaid = mtdN < 10 ? 0 : Math.max(0, r2(mtdN - o.zakat));
	if (o.Yt <= 0) return { pcb: normalPaid, P: P1, note: null as string | null };
	// Step 1[E] total MTD for the year = X + [Step C × (n + 1)]; Step 4 = Step 3 total tax − (Step 1[E] + zakat
	// which has been paid). The zakat is read as subtracted with 1[E]: Step C already netted Z, so the additional MTD
	// is then the extra tax the additional remuneration causes.
	const yearNormal = X + mtdN * (n + 1);
	const P2 = trunc2(sumYK + o.Y1 - K1 + (o.Y1 - k2(Kt)) * n + (o.Yt - Kt) - reliefs);
	const addRaw = trunc2(trunc2(annualTax(P2, o.category)) - yearNormal - Z);
	const add = addRaw <= 0 ? 0 : up5(addRaw);
	const addPaid = add < 10 ? 0 : add; // E(4)(c)
	const note =
		mtdN > 0 && mtdN < 10
			? 'Step 1[E] with a sub-RM10 normal MTD is not settled by E(3)-(5)'
			: null;
	return { pcb: r2(normalPaid + addPaid), P: P2, note };
}

// ---------------------------------------------------------------------------------------------- the payslip
/** MY customer contract (a contractual term, not law; tracker MY-EA30N, MY-EA31, MY-EA36 reasons): the
 * customer hour is basic ÷ 26 ÷ 7.5 to the sen (RM3,000 → 15.38, RM2,600 → 13.33), paid 1.5× on workday overtime,
 * 2.0× on either coded rest day, 2.0× on holiday hours within the normal hours and 3.0× beyond. EA s.7 voids a
 * less favourable term and s.60I(2) forbids a lower rate, so each statutory component is compared separately
 * (tracker MY-EA36 owner default) and the greater is paid. */
const TERMS = {
	customerHourDivisor: 26 * 7.5,
	workdayOt: 1.5,
	restDay: 2.0,
	holiday: 2.0,
	holidayOt: 3.0
};
const NORMAL_HOURS = 8; // EA s.60A(1)(b), s.60A(3)(c): the contract's usual hours per day (09:00-18:00 less a 60-minute break)

export function computePayslip(s: Scenario): Expected {
	const out: Expected = { id: s.id, lines: {}, unresolved: [], branches: [] };
	const unresolved = (key: string, reason: string) => {
		if (!out.unresolved.some((u) => u.key === key)) out.unresolved.push({ key, reason });
	};
	const earn = (code: string, amount: number) => {
		if (amount === 0) return;
		out.lines[code] = { amount: r2((out.lines[code]?.amount ?? 0) + amount) };
	};
	const y = +s.period.slice(0, 4);
	const m = +s.period.slice(5, 7);
	const dim = daysIn(y, m);
	const first = `${s.period}-01`;
	const last = `${s.period}-${String(dim).padStart(2, '0')}`;
	const age = ageOn(s.employee.birthDate, first);
	const e = s.employment;
	const monthlyWages = e.rate + e.fixedAllowance; // EA s.2 "wages" includes fixed allowances, excludes travelling allowance (s.2(c))

	// ---- minimum wage [MWO] para 2: RM1,700 a month; daily RM78.46 for a five-day week; hourly RM8.72.
	const floor = e.payBasis === 'MONTHLY' ? 1700 : e.payBasis === 'DAILY' ? 78.46 : 8.72;
	if (e.rate < floor) {
		out.refused = {
			reason: `${e.payBasis.toLowerCase()} rate ${e.rate} is below the RM${floor} minimum wage; paying it is an offence (Act 732 s.43)`,
			citation:
				'Minimum Wages Order 2024 P.U.(A)376 para 2; National Wages Consultative Council Act 2011 s.43'
		};
		out.branches.push('minimum-wage:below');
		return out;
	}

	// ---- base wages
	const from = e.hireDate > first ? e.hireDate : first;
	const to = s.employment.exit && s.employment.exit.date < last ? s.employment.exit.date : last;
	if (e.payBasis === 'MONTHLY') {
		// [EA] s.37(1)(a): 98 consecutive days from confinement. s.37(2)(a): the allowance is due only if employed at
		// any time in the 4 months before confinement and for ≥ 90 days in the 9 months before (confinement day
		// excluded); s.37(2)(c): a monthly-rated employee whose wages are not abated is deemed paid the allowance.
		// Without the allowance the days are unpaid, so s.18A(c) prorates them. s.60F / s.60FA sick and paternity
		// days are paid leave: no abatement.
		const unpaidDays = new Set(s.month.unpaidLeave);
		const mat = s.month.maternityFrom;
		if (mat) {
			const c = day(mat);
			const nineBefore = Date.UTC(+mat.slice(0, 4), +mat.slice(5, 7) - 1 - 9, +mat.slice(8, 10));
			const served = Math.round((c - Math.max(day(e.hireDate), nineBefore)) / DAY);
			const allowance = day(e.hireDate) < c && served >= 90;
			out.branches.push(
				allowance ? `s37(2)(c):unabated(${served}d)` : `s37(2)(a):no-allowance(${served}d)`
			);
			if (!allowance) for (let i = 0; i < 98; i++) unpaidDays.add(iso(c + i * DAY));
		}
		const unpaid = [...unpaidDays].filter((d) => d >= from && d <= to).length;
		const eligible = Math.round((day(to) - day(from)) / DAY) + 1 - unpaid;
		if (eligible === dim) {
			earn('BASIC', e.rate);
			earn('FIXED_ALLOWANCE', e.fixedAllowance);
			out.branches.push('basic:whole-month');
		} else {
			// [EA] s.18A: monthly wages × days eligible ÷ days of the wage period; rounded to the sen (law silent on the
			// sen; half-up). Fixed allowances are "wages" (s.2) and prorate with the basic.
			earn('BASIC', r2((e.rate * eligible) / dim));
			earn('FIXED_ALLOWANCE', r2((e.fixedAllowance * eligible) / dim));
			out.branches.push(
				`s18A:${from > first ? 'a-joiner' : ''}${to < last ? 'b-leaver' : ''}${unpaid ? 'c-unpaid' : ''}`
			);
			if (unpaid && e.rate === 1700)
				unresolved(
					'EPF',
					'EPF Act s.43(1A) floors the contribution at the Third Schedule amount on the "legally determined" monthly minimum wage; whether that minimum is prorated for s.18A(c) unpaid days is not stated (MY-EPF-04)'
				);
		}
	} else if (e.payBasis === 'DAILY') {
		earn('BASIC', r2(e.rate * (s.month.daysWorked ?? 0)));
		out.branches.push('basic:daily');
	} else {
		earn('BASIC', r2(e.rate * (s.month.hoursWorked ?? 0)));
		out.branches.push('basic:hourly');
	}
	earn('TRAVEL_OFFICIAL', e.travelAllowanceOfficial);

	// ---- work premiums (monthly-rated full-time only in this profile's scenarios)
	const orp = monthlyWages / 26; // [EA] s.60I(1)(a), (1A)
	const statHour = orp / NORMAL_HOURS; // s.60I(1)(b)
	const custHour = r2(e.rate / TERMS.customerHourDivisor);
	const holidays = new Set(s.month.holidays);
	for (const w of s.month.work) {
		const beyond = Math.max(0, w.hours - NORMAL_HOURS);
		const within = Math.min(w.hours, NORMAL_HOURS);
		if (holidays.has(w.date)) {
			// s.60D(3)(a)(i): two days' wages at the ORP regardless of hours, in addition to holiday pay;
			// s.60D(3)(aa): at least 3× the hourly rate beyond the normal hours.
			earn('HOLIDAY_WORK', r2(Math.max(TERMS.holiday * custHour * within, 2 * orp)));
			if (beyond) earn('OVERTIME', r2(beyond * Math.max(TERMS.holidayOt * custHour, 3 * statHour)));
			out.branches.push(`holiday-work:${w.hours}h`);
		} else if (weekday(w.date) === 0) {
			// s.59(1): of two weekly rest days the last (Sunday) is the Part XII rest day. s.60(3)(b): ≤ half the normal
			// hours → half the ORP; more, up to the normal hours → one ORP; s.60(3)(c): ≥ 2× hourly beyond.
			const award = within <= NORMAL_HOURS / 2 ? orp / 2 : orp;
			earn('REST_DAY_WORK', r2(Math.max(TERMS.restDay * custHour * within, award)));
			if (beyond) earn('OVERTIME', r2(beyond * Math.max(TERMS.restDay * custHour, 2 * statHour)));
			out.branches.push(`rest-day:${w.hours}h`);
		} else if (weekday(w.date) === 6) {
			// s.59(1): the earlier contractual rest day (Saturday) is not the statutory rest day; its hours are
			// s.60A(3)(a) overtime at ≥ 1.5× from the first hour (tracker MY-EA30N), the contract owes its 2.0× column.
			earn('OVERTIME', r2(w.hours * Math.max(TERMS.restDay * custHour, 1.5 * statHour)));
			out.branches.push(`earlier-rest-day:${w.hours}h`);
		} else if (beyond) {
			// s.60A(3)(a)-(b): hours beyond the normal hours of the day at ≥ 1.5× the hourly rate.
			earn('OVERTIME', r2(beyond * TERMS.workdayOt * Math.max(custHour, statHour)));
			out.branches.push(`workday-ot:${beyond}h`);
		}
	}

	earn('BONUS', s.month.bonus); // contractual only (MY-13M-01)

	// ---- separation
	const x = s.employment.exit;
	let taxableTB = 0;
	if (x) {
		const served = servedMonths(e.hireDate, x.date);
		const serviceMonths = served.months;
		// Annual leave, [EA] s.60E(1): 8 / 12 / 16 days by length of service (<2, 2-<5, ≥5 years); in the terminating
		// year pro rata to completed months of service; fraction < ½ disregarded, ≥ ½ one day. s.60E(3A): untaken
		// days paid at the ORP, except on dismissal under s.14(1)(a).
		if (x.cause !== 'MISCONDUCT_DISMISSAL') {
			const tier = serviceMonths < 24 ? 8 : serviceMonths < 60 ? 12 : 16;
			const yearStart = e.hireDate > `${y}-01-01` ? e.hireDate : `${y}-01-01`;
			const yearMonths = servedMonths(yearStart, x.date).months;
			const exact = (tier * yearMonths) / 12;
			const entitled = Math.floor(exact) + (exact - Math.floor(exact) >= 0.5 ? 1 : 0);
			const untaken = Math.max(0, entitled - x.annualLeaveTaken);
			earn('ENCASHMENT', r2(untaken * orp));
			out.branches.push(`s60E:${tier}d×${yearMonths}/12=${entitled}-taken${x.annualLeaveTaken}`);
		} else out.branches.push('s60E(3A):dismissed-no-payment');
		// Termination benefit [TLB] reg.3(1): ≥ 12 months' continuous service; reg.4(1): not on contractual
		// retirement, misconduct dismissal after inquiry, or voluntary resignation. reg.6(1): 10/15/20 days' wages per
		// year (<2, 2-<5, ≥5 years), incomplete year pro rata to the nearest month; reg.6(2) day's wages = the 12
		// completed months' wages ÷ 365 (tracker MY-SR10, JTKSM formula).
		const tbCause = x.cause === 'EMPLOYER_TERMINATION' || x.cause === 'FIXED_TERM_EXPIRY';
		if (tbCause && serviceMonths >= 12) {
			const months = serviceMonths + (served.days >= 15 ? 1 : 0);
			const tierDays = serviceMonths < 24 ? 10 : serviceMonths < 60 ? 15 : 20;
			const tb = r2(((x.wages12m / 365) * tierDays * months) / 12);
			earn('TERMINATION_BENEFIT', tb);
			// ITA Schedule 6 para 15 (tracker R29): compensation for loss of employment exempt RM10,000 per completed year.
			taxableTB = Math.max(0, r2(tb - 10000 * Math.floor(serviceMonths / 12)));
			out.branches.push(`reg6:${tierDays}d×${months}/12`);
			for (const k of ['SOCSO', 'EIS', 'SKBBK'])
				unresolved(
					k,
					'Act 4 s.2(24)(d) / Act 800 s.2(d) exclude "gratuity payable on discharge or retirement" and name no termination benefit; no PERKESO text settles it (tracker MY-SR10)'
				);
		} else if (tbCause) out.branches.push('reg3:under-12-months');
		else out.branches.push(`reg4(1):${x.cause}`);
		// Notice [EA] s.12(2): 4 / 6 / 8 weeks by service on the date notice is given; s.13(1): the party ending
		// without notice pays wages that would have accrued during the notice term. Valued per calendar day at the
		// s.18A rate of each month the term spans, starting the day after the last day served (the tracker's R14
		// direct-formula reading: RM3,000 × 16 / 28 for 1-16 February).
		if (!x.noticeServed && (x.cause === 'EMPLOYER_TERMINATION' || x.cause === 'RESIGNATION')) {
			const weeks = serviceMonths < 24 ? 4 : serviceMonths < 60 ? 6 : 8;
			let indemnity = 0;
			for (let d = day(x.date) + DAY, i = 0; i < weeks * 7; i++, d += DAY) {
				const dd = iso(d);
				indemnity += monthlyWages / daysIn(+dd.slice(0, 4), +dd.slice(5, 7));
			}
			const code = x.cause === 'EMPLOYER_TERMINATION' ? 'NOTICE_INDEMNITY' : 'NOTICE_INDEMNITY_DUE';
			out.lines[code] = { amount: r2(x.cause === 'EMPLOYER_TERMINATION' ? indemnity : -indemnity) };
			out.branches.push(
				`s13(1):${weeks}w-${x.cause === 'EMPLOYER_TERMINATION' ? 'employer-pays' : 'employee-owes'}`
			);
			for (const k of ['EPF', 'SOCSO', 'EIS', 'SKBBK', 'HRDF', 'PCB'])
				unresolved(
					k,
					'the scheme treatment of a s.13(1) notice indemnity is not stated in the read texts'
				);
		}
	}

	const amt = (code: string) => out.lines[code]?.amount ?? 0;
	const basicAll = amt('BASIC') + amt('FIXED_ALLOWANCE');
	// ---- contribution bases [BASES]
	const epfNormal = basicAll + amt('REST_DAY_WORK') + amt('HOLIDAY_WORK'); // Act 452 s.2 excludes overtime, travelling allowance, termination benefits
	const epfTotal = epfNormal + amt('BONUS') + amt('ENCASHMENT');
	const perkesoBase =
		basicAll + amt('OVERTIME') + amt('REST_DAY_WORK') + amt('HOLIDAY_WORK') + amt('ENCASHMENT'); // excludes annual bonus, travel
	const hrdBase = basicAll + amt('ENCASHMENT'); // Act 612 s.2: basic, fixed allowances, leave pay; not overtime, bonus, travel

	const deductions: number[] = [];
	const employerShares: number[] = [];
	const scheme = (code: string, employee: number, employer: number, base: number) => {
		if (employee === 0 && employer === 0) return;
		out.lines[code] = { employee: r2(employee), employer: r2(employer), base: r2(base) };
		deductions.push(employee);
		employerShares.push(employer);
	};

	// EPF
	const ep = epf(s, age, epfTotal, epfTotal - amt('BONUS'));
	const epNormal = epf(s, age, epfNormal, epfNormal);
	if (ep) {
		scheme(ep.code, ep.employee, ep.employer, epfTotal);
		out.branches.push(`EPF:Part${ep.part}`);
	} else out.branches.push(age >= 75 ? 'EPF:75-and-over' : 'EPF:none');

	// SOCSO: Act 4 First Schedule para 12 — second category when first liable at 55 or later, or aged 60+.
	const entryAge = ageOn(s.employee.birthDate, s.employee.firstContributionDate);
	const second = age >= 60 || entryAge >= 55;
	const row = perkesoRow(perkesoBase);
	if (perkesoBase > 0) {
		if (second) {
			scheme('SOCSO', 0, SOCSO_SECOND[row]![0] / 100, perkesoBase);
			out.branches.push(`SOCSO:second(${age >= 60 ? 'age60+' : 'entry55+'})`);
		} else {
			const r = SOCSO_FIRST[row]!;
			scheme('SOCSO', r[2] / 100, (r[0] + r[1]) / 100, perkesoBase);
			out.branches.push('SOCSO:first');
		}
		// SKBBK (non-employment injury): A1788, First Phase from the June 2026 contribution month, employee-borne,
		// no age limit, citizens and foreigners alike (P.U.(B)196/2026; tracker MY-SKBBK-01/04).
		const released =
			s.employee.skbbkReleased === true &&
			s.employee.citizenship !== 'FOREIGNER' &&
			s.period >= '2026-07';
		if (released) out.branches.push('SKBBK:released');
		else if (s.period >= '2026-06') {
			scheme(
				'SKBBK',
				(second ? SOCSO_SECOND[row]![1] : SOCSO_FIRST[row]![3]) / 100,
				0,
				perkesoBase
			);
			out.branches.push('SKBBK:first-phase');
		}
	}

	// EIS: Act 800 First Schedule — excluded under 18 or from 60 (para 8); first liable at 57+ (para 9); foreign
	// employees other than permanent residents (para 10).
	const eisOut =
		age < 18
			? 'under-18'
			: age >= 60
				? 'age-60'
				: entryAge >= 57
					? 'entry-57'
					: s.employee.citizenship === 'FOREIGNER'
						? 'foreign'
						: null;
	if (eisOut === null && perkesoBase > 0) {
		const share = eisShare(perkesoBase);
		scheme('EIS', share, share, perkesoBase);
		out.branches.push('EIS:covered');
	} else out.branches.push(`EIS:excluded-${eisOut}`);

	// PCB
	const exemptTravel = Math.min(amt('TRAVEL_OFFICIAL'), 6000); // [MTD] E(9)(i): official-duty travel exempt to RM6,000 a year
	const Y1 =
		basicAll +
		amt('OVERTIME') +
		amt('REST_DAY_WORK') +
		amt('HOLIDAY_WORK') +
		amt('TRAVEL_OFFICIAL') -
		exemptTravel;
	const Yt = amt('BONUS') + amt('ENCASHMENT') + taxableTB;
	const cz = s.employee.citizenship;
	// [MTD] D(a): 30% for a non-resident or one not known to be resident; its note: resident MTD for a foreign
	// worker on an employment contract of 182 days or more. Open-ended contract → recorded residency (tracker MY-PCB-06 default).
	const contractDays = e.contractEnd
		? Math.round((day(e.contractEnd) - day(e.hireDate)) / DAY) + 1
		: 0;
	// [ITA] s.7(1)(a): 182 days in the basis year; s.7(1)(c)(ii): 90 days in the year and ≥ 90 days in 3 of the 4
	// preceding years. Recorded stays decide at the period end (tracker MY-PCB-06); otherwise the recorded status.
	const pr = s.employee.presence;
	const byPresence =
		pr !== undefined &&
		(pr.ytd >= 182 || (pr.ytd >= 90 && pr.prior.filter((d) => d >= 90).length >= 3));
	if (pr) out.branches.push(`s7(1):${byPresence ? 'resident' : 'not-by-presence'}`);
	const resident =
		s.employee.taxResidency === 'RESIDENT' ||
		(cz === 'FOREIGNER' && contractDays >= 182) ||
		byPresence;
	// [ITA] Sch.6 para 21: a non-resident's employment exercised in Malaysia for ≤ 60 days in the year is exempt;
	// para 22(a): over 60 days the exemption fails (then Sch.1 para 1A 30%).
	const sch6 = s.employee.sch6Para21EmploymentDays;
	let pcb: number;
	if (!resident && sch6 !== undefined && sch6 <= 60) {
		pcb = 0;
		out.branches.push(`Sch6-para21:exempt(${sch6}d)`);
	} else if (resident) {
		const K1 = epNormal?.employee ?? 0;
		const res = residentMtd({
			month: m,
			Y1,
			K1,
			Yt,
			Kt: Math.max(0, (ep?.employee ?? 0) - K1), // E(13)(iii): total EPF less EPF on normal remuneration
			category: s.employee.pcbCategory,
			children: s.employee.children + 0.5 * (s.employee.childrenHalf ?? 0), // [ITA] s.48(4): 50% each
			zakat: s.employee.zakat,
			prior: s.employee.tp3 ?? { remuneration: 0, epf: 0, mtd: 0, zakat: 0 }
		});
		pcb = res.pcb;
		if (res.note) unresolved('PCB', res.note);
		out.branches.push(`PCB:resident-cat${s.employee.pcbCategory}`);
	} else {
		pcb = up5(trunc2(0.3 * (Y1 + Yt)));
		out.branches.push(`PCB:non-resident-30%(${s.employee.taxResidency})`);
	}
	if (s.employee.zakat)
		unresolved(
			'ZAKAT',
			'whether zakat is itself a payslip deduction line is outside the MTD rules'
		);
	if (pcb > 0) {
		out.lines.PCB = { employee: pcb, employer: 0, base: r2(Y1 + Yt) };
		deductions.push(pcb);
	}

	// HRDF levy: Act 612 s.14(1)/(2) — citizens only (s.2 "employee"), 1% for a compulsory class, 0.5% optional;
	// P.U.(A)13/2026 exempts scheduled education MSIC employers for the 2026 contribution months.
	const eduExempt = s.company.msic.startsWith('85') && y === 2026;
	// First Schedule (P.U.(A)84/2021): a listed-industry employer with ≥ 10 Malaysian employees is liable; 5-9 may
	// register (optional, 0.5%). s.15(4): an optional employer whose count exceeds its limit pays 1%; s.15(5) keeps 1%
	// to the end of that year after a decrease; s.15(6) restores 0.5% the next year; s.15(7) an increase: 1% at once.
	const hc = s.company.hrdHeadcount;
	const hrdClass =
		hc === undefined || s.company.hrd !== 'COMPULSORY'
			? s.company.hrd
			: hc >= 10
				? 'COMPULSORY'
				: 'NOT_LIABLE';
	const optionalHigh = hc !== undefined && (hc >= 10 || s.company.hrdHighRateYear === y);
	if (hrdClass !== 'NOT_LIABLE' && cz === 'CITIZEN') {
		if (e.employmentType === 'PART_TIME')
			unresolved(
				'HRDF',
				'part-time exclusion rests on HRD Corp Circular 19/2010 only; no s.19 exemption order found (MY-HRD12 SOURCE-BLOCKED)'
			);
		else if (eduExempt) out.branches.push('HRDF:education-exempt-2026');
		else {
			const rate = hrdClass === 'COMPULSORY' || optionalHigh ? 0.01 : 0.005;
			const levy = hrdBase * rate;
			if (Math.abs(levy * 100 - Math.round(levy * 100)) > 1e-6)
				unresolved('HRDF', `levy ${levy} has sub-sen digits; Act 612 states no rounding`);
			out.lines.HRDF = { employee: 0, employer: r2(levy), base: r2(hrdBase) };
			employerShares.push(r2(levy));
			out.branches.push(`HRDF:${rate * 100}%`);
		}
	} else out.branches.push(`HRDF:none(${cz === 'CITIZEN' ? hrdClass : cz})`);

	// ---- totals
	const gross = Object.entries(out.lines)
		.filter(([, l]) => l.amount !== undefined && l.amount > 0)
		.reduce((a, [, l]) => a + l.amount!, 0);
	const owed = -(out.lines.NOTICE_INDEMNITY_DUE?.amount ?? 0);
	const totalDeductions = deductions.reduce((a, b) => a + b, 0) + owed;
	out.lines.gross = { amount: r2(gross) };
	out.lines.total_deductions = { amount: r2(totalDeductions) };
	out.lines.net = { amount: r2(gross - totalDeductions) };
	out.lines.employer_cost = { amount: r2(gross + employerShares.reduce((a, b) => a + b, 0)) };
	if (out.unresolved.some((u) => ['EPF', 'SOCSO', 'EIS', 'SKBBK', 'PCB'].includes(u.key)))
		for (const k of ['total_deductions', 'net'])
			unresolved(k, 'depends on an unresolved employee deduction');
	if (out.unresolved.some((u) => ['EPF', 'SOCSO', 'EIS', 'HRDF'].includes(u.key)))
		unresolved('employer_cost', 'depends on an unresolved employer share');
	return out;
}

/** The oracle's lines as probe-harness keys (`gross`, component codes, `<scheme>.employee` / `.employer`), unresolved keys dropped. */
export function probeLines(x: Expected): Record<string, number> {
	const skip = new Set(x.unresolved.map((u) => u.key));
	const out: Record<string, number> = {};
	for (const [code, l] of Object.entries(x.lines)) {
		if (skip.has(code) || (code.startsWith('EPF') && skip.has('EPF'))) continue;
		if (l.amount !== undefined) out[code] = l.amount;
		else {
			out[`${code}.employee`] = l.employee ?? 0;
			out[`${code}.employer`] = l.employer ?? 0;
		}
	}
	return out;
}
