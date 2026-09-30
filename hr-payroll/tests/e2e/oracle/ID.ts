/**
 * Independent ID payslip oracle: one monthly payslip computed from the law alone (no engine, no seed).
 *
 * Sources (official texts; read 2026-09-30 unless noted):
 *   PP58   PP 58/2023 (TER), art 2–3 and annex A–D. https://jdih.kemenkeu.go.id/api/download/FullText/2023/58TAHUN2023PP.pdf
 *   PMK168 PMK 168/2023 arts 1(10)–(11), 1(18), 5(3), 8, 9(4), 10, 12, 14, 15, 16.
 *          https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf
 *   UUPPH  UU PPh art 17(1)(a) as amended by UU 7/2021 (5/15/25/30/35%), art 21(5a) (120% without NPWP),
 *          art 7(1) PTKP (54,000,000 + 4,500,000 married + 4,500,000 per dependant, max 3 — PMK 101/2016,
 *          restated in the PMK168 annex examples). https://jdih.kemenkeu.go.id/dok/uu-36-tahun-2008
 *   PP68   PP 68/2009 arts 1(3)–(4), 2, 4 (severance final bands). https://jdih.kemnaker.go.id/asset/data_puu/PP_No_68_2009.pdf
 *   PP35   PP 35/2021 arts 15–17 (PKWT compensation), 31–33 (overtime), 40–57 (PHK rights).
 *          https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf
 *   PP36   PP 36/2021 arts 7(2) (75% basic), 16 (hourly ÷ 126), 23–24 (minimum wage), 63–65 (50% deductions).
 *          https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf
 *   UU13   UU 13/2003 as amended by UU 6/2023: art 62 (early PKWT end), 88E(2), 93(3) (illness pay), 157.
 *   UU4    UU 4/2024 art 5(2) (maternity pay 100% months 1–4, 75% months 5–6).
 *   BPJS   PP 44/2015 (JKK/JKM, art 19; Lampiran I rates 0.24/0.54/0.89/1.27/1.74%; JKM 0.30%), PP 46/2015
 *          (JHT 2% + 3.7%), PP 45/2015 arts 15, 28–29 (JP 1% + 2%, pension age, ceiling), Perpres 82/2018 arts
 *          30–33 as amended by Perpres 59/2024 (Kesehatan 1% + 4%, UMK/UMP floor, 12,000,000 ceiling),
 *          PP 7/2025 + PP 36/2025 (padat karya JKK halved Feb 2025–Jan 2026), PP 6/2025 (JKP: no payslip line).
 *   JP-CAP 10,547,400 from 1 Mar 2025, 11,086,300 from 1 Mar 2026 (docs/inventory/indonesia.csv ID-164).
 *   THR    Permenaker 6/2016 arts 2–3. https://jdih.kemnaker.go.id/asset/data_puu/permenaker_6_2016.pdf
 *   UMP/UMK  decrees transcribed in docs/inventory/indonesia.csv (ID-54, ID-79, ID-83, ID-94, ID-96, ID-99, ID-102).
 *   DTP    PMK 105/2025 arts 2–4 (2026 PPh 21 borne by government, regular gross ≤ Rp10,000,000).
 *   STRICT ID-173 (with ID-53, ID-89, ID-97): where an issued sector order's annex selectors are unsealed, an unmatched
 *          KBLI cannot assert the ordinary UMP/UMK — DKI (the attested ordinary KBLI 62019 excepted), every Jawa Barat
 *          workplace (2026 Kabupaten Bekasi at 62019 excepted, ID-96-1) and, in December 2025, Jawa Timur.
 *   UMSP   DKI Kep.33/2026 annex lines as transcribed in ID-54 (conditional lines on recorded company facts).
 *
 * DEFAULT marks an owner-rule default where the law is silent (recorded in docs/inventory/indonesia.csv):
 *   ID-106 calendar-day proration; ID-161 part-month BPJS bases and the whole-month Kesehatan floor lift;
 *   ID-127 half-up whole-rupiah charges; ID-15 contributions stop from the month the worker is already of
 *   pension age on the period's first day (oracle reading). Wage lines are kept to the sen (half-up).
 * Pure TypeScript; nothing is imported from src.
 */

export type Workplace =
	| 'DKI'
	| 'KOTA_BEKASI'
	| 'KAB_BEKASI'
	| 'KOTA_BANJAR'
	| 'SURABAYA'
	| 'SEMARANG'
	| 'DENPASAR'
	| 'BADUNG';
/** Kep.33/2026 conditional annex lines (ID-54): declared company facts, false until recorded. */
export type UmspCondition = 'EXPORT' | 'ASSETS_OVER_1T' | 'ASTRA_GROUP' | 'HOTEL_4_5_STAR';
export type Ptkp = 'TK/0' | 'TK/1' | 'TK/2' | 'TK/3' | 'K/0' | 'K/1' | 'K/2' | 'K/3';
export type RiskGroup = 'I' | 'II' | 'III' | 'IV' | 'V';
/** PP 35/2021 arts 41–57, by the detailed cause. */
export type ExitCause =
	| 'MERGER'
	| 'TAKEOVER'
	| 'TAKEOVER_TERMS_REFUSED'
	| 'EFFICIENCY_LOSS'
	| 'EFFICIENCY_PREVENT_LOSS'
	| 'CLOSURE_LOSS'
	| 'CLOSURE_NO_LOSS'
	| 'FORCE_MAJEURE_CLOSURE'
	| 'FORCE_MAJEURE_NO_CLOSURE'
	| 'PKPU_LOSS'
	| 'PKPU_NO_LOSS'
	| 'BANKRUPTCY'
	| 'EMPLOYER_MISCONDUCT_REQUEST'
	| 'MISCONDUCT_CLAIM_REJECTED'
	| 'RESIGNATION'
	| 'ABSENT_FIVE_DAYS'
	| 'WARNED_VIOLATION'
	| 'URGENT_VIOLATION'
	| 'LONG_ILLNESS'
	| 'RETIREMENT'
	| 'DEATH'
	| 'CONTRACT_END'
	| 'EMPLOYER_EARLY_END';
export type OvertimeKind = 'ORDINARY' | 'REST' | 'HOLIDAY' | 'HOLIDAY_SHORT_DAY';

export type Scenario = {
	id: string;
	profile: 'ID';
	/** tracker row ids exercised */
	rows: string[];
	/** branch names within those rows */
	branches: string[];
	description: string;
	/** YYYY-MM, one calendar month: the payslip the expected lines describe */
	period: string;
	/** every period the harness runs, in order, ending with `period` (earlier months of the year feed a last-period
	 * reckoning, PMK168 art 15(1)(b)); `periodsToRun` */
	runs: string[];
	company: {
		workplace: Workplace;
		/** worksite KBLI (five digits) */
		kbli: string;
		/** null: no registered JKK risk group (ID-16: the run stops) */
		jkkRiskGroup: RiskGroup | null;
		/** DKI Kep.33/2026 conditions recorded true (ID-54) */
		umspConditions: UmspCondition[];
		/** PP 7/2025 labour-intensive JKK relief applies */
		padatKarya: boolean;
		workWeek: 5 | 6;
		/** PMK 105/2025 annex KLU */
		dtpKlu: boolean;
		microSmall: boolean;
	};
	employee: {
		birthDate: string;
		citizen: boolean;
		taxResident: boolean;
		hasTaxId: boolean;
		ptkp: Ptkp;
		/** foreigner: months of work in Indonesia completed by the period's first day */
		foreignWorkMonths: number;
		/** a BPJS JP registration on file (reaches a foreigner) */
		jpRegistered: boolean;
		/** PP 45/2015 art 15(4) deferral elected */
		jpDeferral: boolean;
		kesehatanExtraMembers: number;
		/** the subjective tax obligation began after January or ends before December this year (arrived in / leaves
		 * Indonesia for good): PMK168 art 15(3) annualises */
		subjectivePartYear: boolean;
		/** zakat paid through the employer this month (PMK168 art 10(1)(c)) */
		zakat: number;
	};
	employment: {
		type: 'PKWTT' | 'PKWT' | 'NON_EMPLOYEE';
		payBasis: 'MONTHLY' | 'HOURLY' | 'DAILY';
		partTime: boolean;
		hireDate: string;
		/** PKWT agreed end date */
		contractEnd: string | null;
		/** last day worked */
		exitDate: string | null;
		exitCause: ExitCause | null;
		basic: number;
		/** a mid-month basic change: the new basic from `from` (ID-161 DEFAULT) */
		raise: { from: string; basic: number } | null;
		fixedAllowance: number;
		nonFixedAllowance: number;
		/** HOURLY / DAILY rate */
		rate: number;
		/** NON_EMPLOYEE service fee paid this month */
		serviceFee: number;
	};
	inputs: {
		unpaidDates: string[];
		/** paid statutory leave inside its entitlement (UU13 arts 79, 81, 93(2)(4); UU4 art 6): full wage, no line */
		paidLeave: { kind: string; dates: string[] }[];
		overtime: { date: string; kind: OvertimeKind; hours: number }[];
		/** the worker's religious holiday paid in this period (THR) */
		thrHolidayDate: string | null;
		bonus: number;
		/** PP 36/2021 art 63 deduction (loan, advance …) */
		wageDeduction: number;
		/** uang pisah as fixed by the PK/PP/PKB */
		uangPisah: number;
		/** days of the period paid at a statutory fraction (UU13 art 93(3), UU4 art 5(2)) */
		reducedPay: { days: number; fraction: number } | null;
	};
};

export type Line = { employee: number; employer: number; base: number };
export type Payslip = {
	/** why the run must be refused; then there are no lines */
	refused: string | null;
	/** inputs the law does not allow (the request is refused; the payslip is priced without it) */
	inputsRefused: string[];
	components: Record<string, number>;
	statutory: Record<string, Line>;
	gross: number;
	total_deductions: number;
	net: number;
	employer_cost: number;
	/** PPh 21 due this month before any government-borne (DTP) share */
	taxDue: number;
	notes: string[];
};

// ---------- arithmetic and dates ----------
const EPS = 1e-7;
const half = (x: number, d: number) => {
	const f = 10 ** d;
	return (Math.sign(x) * Math.floor(Math.abs(x) * f + 0.5 + EPS)) / f;
};
/** wage lines: to the sen, half-up */
export const r2 = (x: number) => half(x, 2);
/** statutory charges: whole rupiah, half-up (ID-127 DEFAULT) */
export const r0 = (x: number) => half(x, 0);
const DAY = 86_400_000;
const D = (s: string) => Date.parse(`${s}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(D(d) + n * DAY);
export const daysIn = (period: string) => {
	const [y, m] = period.split('-').map(Number);
	return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
};
export const monthStart = (period: string) => `${period}-01`;
export const monthEnd = (period: string) => `${period}-${String(daysIn(period)).padStart(2, '0')}`;
/** completed calendar months from `from` to `to` */
export const completedMonths = (from: string, to: string) => {
	const [fy, fm, fd] = from.split('-').map(Number);
	const [ty, tm, td] = to.split('-').map(Number);
	return (ty! - fy!) * 12 + (tm! - fm!) - (td! < fd! ? 1 : 0);
};
/** The earlier periods of this calendar year in which the employment was on the books (the harness runs them first). */
export const priorPeriods = (s: Pick<Scenario, 'period' | 'employment'>) => {
	const out: string[] = [];
	const [y, m] = s.period.split('-').map(Number);
	for (let k = 1; k < m!; k++) {
		const p = `${y}-${String(k).padStart(2, '0')}`;
		if (s.employment.hireDate <= monthEnd(p)) out.push(p);
	}
	return out;
};
/** Every period the probe must run, in order; the expected lines are the last one's. */
export const periodsToRun = (s: Scenario) => {
	const last = s.period.endsWith('-12') || (s.employment.exitDate !== null && s.employment.exitDate.startsWith(s.period));
	return last && s.employment.type !== 'NON_EMPLOYEE' ? [...priorPeriods(s), s.period] : [s.period];
};
export const ageOn = (birth: string, on: string) => Math.floor(completedMonths(birth, on) / 12);
const between = (d: string, a: string, b: string) => a <= d && d <= b;

// ---------- the law as tables ----------
/** Monthly minimum wage by workplace (UMK, or UMP where DKI is province-only), [from, to, amount]. */
const FLOORS: Record<Workplace, [string, string, number][]> = {
	// ID-94: Kep.829/2024 (2025), Kep.1142/2025 (2026)
	DKI: [
		['2025-01-01', '2025-12-31', 5_396_761],
		['2026-01-01', '9999-12-31', 5_729_876]
	],
	// ID-96: Kep.798/2024, Kep.862/2025
	KOTA_BEKASI: [
		['2025-01-01', '2025-12-31', 5_690_752.95],
		['2026-01-01', '9999-12-31', 5_999_443]
	],
	// ID-96 Kep.862/2025, value as recorded in docs/inventory/indonesia.csv ID-19 (Kabupaten Bekasi 2026 UMK); the
	// December 2025 Jawa Barat version is a strict sector place with no attested ordinary KBLI (ID-173), so no 2025 row
	KAB_BEKASI: [['2026-01-01', '9999-12-31', 5_938_885]],
	KOTA_BANJAR: [
		['2025-01-01', '2025-12-31', 2_204_754.48],
		['2026-01-01', '9999-12-31', 2_361_241]
	],
	// ID-79: Kep.937/2025 (the Dec 2025 decree ID-78 is SOURCE-BLOCKED: no 2025 row)
	SURABAYA: [['2026-01-01', '9999-12-31', 5_288_796]],
	// ID-83: Kep.505/2025
	SEMARANG: [['2026-01-01', '9999-12-31', 3_701_709]],
	// ID-99 Kep.946/2024, ID-102 Kep.1021/2025
	DENPASAR: [
		['2025-01-01', '2025-12-31', 3_298_116.5],
		['2026-01-01', '9999-12-31', 3_499_878.78]
	],
	BADUNG: [
		['2025-01-01', '2025-12-31', 3_534_338.88],
		['2026-01-01', '9999-12-31', 3_791_002.57]
	]
};
/** ID-54: DKI 2026 UMSP (Kep.33/2026 annex, dictum KEDUA/KETIGA) for service under one year: the unconditional
 * lines. Lines 58–59 and 61 (49214/49219 bus jobs, 86103 class-A hospital jobs) need a job selector the terms do not
 * carry: refused (ID-173). */
const line = (amount: number, ...codes: string[]) => codes.map((c) => [c, amount] as const);
export const DKI_UMSP_2026: Record<string, number> = Object.fromEntries([
	...line(5_741_201, '10437', '10213', '10520', '10616', '10740', '24201', '25992', '42205'),
	...line(5_743_449, '10734', '10801', '10802', '11040', '22220', '24103', '28130', '33121', '43211', '65111', '66420', '49432', '52291', '52109'),
	...line(5_844_336, '20118', '20119', '20114', '20231', '20291', '20221', '22230', '23129', '23111', '23112', '23953'),
	...line(5_744_066, '24101', '24310', '25991', '25940'),
	...line(5_759_723, '27201'),
	...line(5_759_015, '32202'),
	...line(5_812_808, '27111', '27320', '27510'),
	...line(5_741_336, '33151'),
	...line(5_754_720, '58200', '61921', '61922')
]);
/** Kep.33/2026 conditional lines: [KBLI, condition, floor]. */
export const DKI_UMSP_2026_CONDITIONAL: [string, UmspCondition, number][] = [
	['21012', 'ASSETS_OVER_1T', 5_741_201],
	['14111', 'EXPORT', 5_831_497],
	['15201', 'EXPORT', 5_872_985],
	['64121', 'ASSETS_OVER_1T', 5_872_985],
	['64122', 'ASSETS_OVER_1T', 5_872_985],
	['29200', 'ASTRA_GROUP', 5_904_114],
	['29300', 'ASTRA_GROUP', 5_904_114],
	['30912', 'ASTRA_GROUP', 5_904_114],
	['30911', 'ASTRA_GROUP', 5_943_938],
	['28160', 'ASTRA_GROUP', 5_943_938],
	['29101', 'ASTRA_GROUP', 5_943_938],
	['55110', 'HOTEL_4_5_STAR', 5_803_839]
];
/** The official-annex-verified ordinary KBLI that may use the UMP/UMK at a strict sector place (ID-53, ID-96-1). */
const ATTESTED_ORDINARY = '62019';
/** ID-173 / ID-53 / ID-89 / ID-97: strict sector places, where an issued sector order's selectors are unsealed, so an
 * unmatched KBLI cannot assert the ordinary floor: [workplace, from, to, attested-ordinary KBLI allowed]. */
const STRICT: [Workplace, string, string, boolean][] = [
	['DKI', '2025-01-01', '9999-12-31', true],
	['KOTA_BEKASI', '2025-01-01', '9999-12-31', false],
	['KOTA_BANJAR', '2025-01-01', '9999-12-31', false],
	['KAB_BEKASI', '2025-01-01', '2025-12-31', false],
	['KAB_BEKASI', '2026-01-01', '9999-12-31', true],
	['SURABAYA', '2025-01-01', '2025-12-31', false]
];

export const floorOn = (w: Workplace, day: string) => {
	const row = FLOORS[w].find(([a, b]) => between(day, a, b));
	if (row === undefined) throw new Error(`no minimum wage for ${w} on ${day}`);
	return row[2];
};

/** PP 44/2015 Lampiran I (whole bill after PP 49/2023 recomposition), percent. */
const JKK: Record<RiskGroup, number> = { I: 0.24, II: 0.54, III: 0.89, IV: 1.27, V: 1.74 };
/** PP 7/2025 art 4(1): halved, Feb 2025 – Jan 2026 (PP 36/2025 art 10A). */
const JKK_PADAT_KARYA: Record<RiskGroup, number> = {
	I: 0.12,
	II: 0.27,
	III: 0.445,
	IV: 0.635,
	V: 0.87
};
const jpCeiling = (day: string) => (day < '2026-03-01' ? 10_547_400 : 11_086_300);
const KESEHATAN_CEILING = 12_000_000;
/** PP 45/2015 art 15(1)–(3): 59 from 1 Jan 2025 to 31 Dec 2027, 60 from 2028. */
const pensionAge = (day: string) => (day < '2028-01-01' ? 59 : 60);

/** PP 58/2023 annex: [upper bound of monthly gross, rate in basis points]; last row unbounded. */
const TER_A: [number, number][] = [
	[5_400_000, 0],
	[5_650_000, 25],
	[5_950_000, 50],
	[6_300_000, 75],
	[6_750_000, 100],
	[7_500_000, 125],
	[8_550_000, 150],
	[9_650_000, 175],
	[10_050_000, 200],
	[10_350_000, 225],
	[10_700_000, 250],
	[11_050_000, 300],
	[11_600_000, 350],
	[12_500_000, 400],
	[13_750_000, 500],
	[15_100_000, 600],
	[16_950_000, 700],
	[19_750_000, 800],
	[24_150_000, 900],
	[26_450_000, 1000],
	[28_000_000, 1100],
	[30_050_000, 1200],
	[32_400_000, 1300],
	[35_400_000, 1400],
	[39_100_000, 1500],
	[43_850_000, 1600],
	[47_800_000, 1700],
	[51_400_000, 1800],
	[56_300_000, 1900],
	[62_200_000, 2000],
	[68_600_000, 2100],
	[77_500_000, 2200],
	[89_000_000, 2300],
	[103_000_000, 2400],
	[125_000_000, 2500],
	[157_000_000, 2600],
	[206_000_000, 2700],
	[337_000_000, 2800],
	[454_000_000, 2900],
	[550_000_000, 3000],
	[695_000_000, 3100],
	[910_000_000, 3200],
	[1_400_000_000, 3300],
	[Infinity, 3400]
];
const TER_B: [number, number][] = [
	[6_200_000, 0],
	[6_500_000, 25],
	[6_850_000, 50],
	[7_300_000, 75],
	[9_200_000, 100],
	[10_750_000, 150],
	[11_250_000, 200],
	[11_600_000, 250],
	[12_600_000, 300],
	[13_600_000, 400],
	[14_950_000, 500],
	[16_400_000, 600],
	[18_450_000, 700],
	[21_850_000, 800],
	[26_000_000, 900],
	[27_700_000, 1000],
	[29_350_000, 1100],
	[31_450_000, 1200],
	[33_950_000, 1300],
	[37_100_000, 1400],
	[41_100_000, 1500],
	[45_800_000, 1600],
	[49_500_000, 1700],
	[53_800_000, 1800],
	[58_500_000, 1900],
	[64_000_000, 2000],
	[71_000_000, 2100],
	[80_000_000, 2200],
	[93_000_000, 2300],
	[109_000_000, 2400],
	[129_000_000, 2500],
	[163_000_000, 2600],
	[211_000_000, 2700],
	[374_000_000, 2800],
	[459_000_000, 2900],
	[555_000_000, 3000],
	[704_000_000, 3100],
	[957_000_000, 3200],
	[1_405_000_000, 3300],
	[Infinity, 3400]
];
const TER_C: [number, number][] = [
	[6_600_000, 0],
	[6_950_000, 25],
	[7_350_000, 50],
	[7_800_000, 75],
	[8_850_000, 100],
	[9_800_000, 125],
	[10_950_000, 150],
	[11_200_000, 175],
	[12_050_000, 200],
	[12_950_000, 300],
	[14_150_000, 400],
	[15_550_000, 500],
	[17_050_000, 600],
	[19_500_000, 700],
	[22_700_000, 800],
	[26_600_000, 900],
	[28_100_000, 1000],
	[30_100_000, 1100],
	[32_600_000, 1200],
	[35_400_000, 1300],
	[38_900_000, 1400],
	[43_000_000, 1500],
	[47_400_000, 1600],
	[51_200_000, 1700],
	[55_800_000, 1800],
	[60_400_000, 1900],
	[66_700_000, 2000],
	[74_500_000, 2100],
	[83_200_000, 2200],
	[95_600_000, 2300],
	[110_000_000, 2400],
	[134_000_000, 2500],
	[169_000_000, 2600],
	[221_000_000, 2700],
	[390_000_000, 2800],
	[463_000_000, 2900],
	[561_000_000, 3000],
	[709_000_000, 3100],
	[965_000_000, 3200],
	[1_419_000_000, 3300],
	[Infinity, 3400]
];
export const TER = { A: TER_A, B: TER_B, C: TER_C };
/** PP58 art 3(4): A = TK/0, TK/1, K/0; B = TK/2, TK/3, K/1, K/2; C = K/3. */
export const terCategory = (p: Ptkp): keyof typeof TER =>
	p === 'TK/0' || p === 'TK/1' || p === 'K/0' ? 'A' : p === 'K/3' ? 'C' : 'B';
/** "di atas X sampai dengan Y": a gross equal to an upper bound stays in that row. */
export const terRateBp = (p: Ptkp, gross: number) =>
	TER[terCategory(p)].find(([upper]) => gross <= upper)![1];

/** UU PPh art 7(1): 54,000,000 + 4,500,000 if married + 4,500,000 per dependant (max 3). */
export const ptkpAmount = (p: Ptkp) => {
	const [status, n] = p.split('/');
	return 54_000_000 + (status === 'K' ? 4_500_000 : 0) + 4_500_000 * Number(n);
};
/** UU PPh art 17(1)(a) as amended by UU 7/2021. */
const ART17: [number, number][] = [
	[60_000_000, 5],
	[250_000_000, 15],
	[500_000_000, 25],
	[5_000_000_000, 30],
	[Infinity, 35]
];
export const art17 = (pkp: number) => {
	let tax = 0;
	let lower = 0;
	for (const [upper, pct] of ART17) {
		if (pkp <= lower) break;
		tax += ((Math.min(pkp, upper) - lower) * pct) / 100;
		lower = upper;
	}
	return tax;
};
/** PP68 art 4. */
const PP68: [number, number][] = [
	[50_000_000, 0],
	[100_000_000, 5],
	[500_000_000, 15],
	[Infinity, 25]
];
export const pp68 = (gross: number) => {
	let tax = 0;
	let lower = 0;
	for (const [upper, pct] of PP68) {
		if (gross <= lower) break;
		tax += ((Math.min(gross, upper) - lower) * pct) / 100;
		lower = upper;
	}
	return tax;
};

/** PP35 art 40(2): pesangon months by completed years of service. */
export const pesangonMonths = (years: number) => Math.min(years + 1, 9);
/** PP35 art 40(3): UPMK months. */
export const upmkMonths = (years: number) =>
	years < 3
		? 0
		: years < 6
			? 2
			: years < 9
				? 3
				: years < 12
					? 4
					: years < 15
						? 5
						: years < 18
							? 6
							: years < 21
								? 7
								: years < 24
									? 8
									: 10;
/** PP35 arts 41–57: [pesangon factor, UPMK factor, uang pisah owed]. */
const CAUSE: Record<
	Exclude<ExitCause, 'CONTRACT_END' | 'EMPLOYER_EARLY_END'>,
	[number, number, boolean]
> = {
	MERGER: [1, 1, false], // art 41
	TAKEOVER: [1, 1, false], // art 42(1)
	TAKEOVER_TERMS_REFUSED: [0.5, 1, false], // art 42(2)
	EFFICIENCY_LOSS: [0.5, 1, false], // art 43(1)
	EFFICIENCY_PREVENT_LOSS: [1, 1, false], // art 43(2)
	CLOSURE_LOSS: [0.5, 1, false], // art 44(1)
	CLOSURE_NO_LOSS: [1, 1, false], // art 44(2)
	FORCE_MAJEURE_CLOSURE: [0.5, 1, false], // art 45(1)
	FORCE_MAJEURE_NO_CLOSURE: [0.75, 1, false], // art 45(2)
	PKPU_LOSS: [0.5, 1, false], // art 46(1)
	PKPU_NO_LOSS: [1, 1, false], // art 46(2)
	BANKRUPTCY: [0.5, 1, false], // art 47
	EMPLOYER_MISCONDUCT_REQUEST: [1, 1, false], // art 48
	MISCONDUCT_CLAIM_REJECTED: [0, 0, true], // art 49
	RESIGNATION: [0, 0, true], // art 50
	ABSENT_FIVE_DAYS: [0, 0, true], // art 51
	WARNED_VIOLATION: [0.5, 1, false], // art 52(1)
	URGENT_VIOLATION: [0, 0, true], // art 52(2)
	LONG_ILLNESS: [2, 1, false], // art 55
	RETIREMENT: [1.75, 1, false], // art 56
	DEATH: [2, 1, false] // art 57
};

// ---------- the payslip ----------
const OT_BANDS: Record<OvertimeKind, Record<5 | 6, number[]>> = {
	// PP35 art 31(1): 1.5× the first hour, 2× each further hour (weekday)
	ORDINARY: { 5: [1.5, 2, 2, 2], 6: [1.5, 2, 2, 2] },
	// art 31(3) (5-day week): 1–8 ×2, 9th ×3, 10–12 ×4; art 31(2)(a) (6-day week): 1–7 ×2, 8th ×3, 9–11 ×4
	REST: { 5: [2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 4, 4], 6: [2, 2, 2, 2, 2, 2, 2, 3, 4, 4, 4] },
	HOLIDAY: { 5: [2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 4, 4], 6: [2, 2, 2, 2, 2, 2, 2, 3, 4, 4, 4] },
	// art 31(2)(b): holiday on the shortest day of a 6-day week: 1–5 ×2, 6th ×3, 7–9 ×4
	HOLIDAY_SHORT_DAY: { 5: [], 6: [2, 2, 2, 2, 2, 3, 4, 4, 4] }
};

const refuse = (why: string): Payslip => ({
	refused: why,
	inputsRefused: [],
	taxDue: 0,
	components: {},
	statutory: {},
	gross: 0,
	total_deductions: 0,
	net: 0,
	employer_cost: 0,
	notes: []
});

export function computePayslip(s: Scenario): Payslip {
	const { company: co, employee: ee, employment: em, inputs: inp } = s;
	const first = monthStart(s.period);
	const last = monthEnd(s.period);
	const cal = daysIn(s.period);
	const notes: string[] = [];
	const inputsRefused: string[] = [];
	const components: Record<string, number> = {};
	const statutory: Record<string, Line> = {};
	const add = (code: string, v: number) => {
		if (v !== 0) components[code] = r2((components[code] ?? 0) + v);
	};

	// Non-employee services (PMK168 arts 12(3), 16(3)): 50% of gross at art 17; no BPJS (PP 46 art 4(2)–(3)).
	if (em.type === 'NON_EMPLOYEE') {
		add('SERVICE_FEE', em.serviceFee);
		const base = r2(em.serviceFee * 0.5);
		const tax = r0(art17(base) * (ee.hasTaxId ? 1 : 1.2));
		statutory.PPH21 = { employee: tax, employer: 0, base };
		return { ...finish(components, statutory, notes), taxDue: tax };
	}

	// PP36 art 16 / ID-169: hourly only for part-time, at least the monthly floor ÷ 126.
	if (em.payBasis === 'HOURLY') {
		if (!em.partTime)
			return refuse('ID-169: an hourly wage is allowed only for a part-time worker');
		if (em.rate * 126 < floorOn(co.workplace, first))
			return refuse('MINIMUM_WAGE_BELOW: hourly rate under the monthly floor ÷ 126 (PP36 art 16)');
	}
	// ID-174 (GAP): no source converts a DAILY/HOURLY rate into the Kesehatan monthly base — cannot price.
	if (em.payBasis !== 'MONTHLY')
		return refuse('ID-174: the Kesehatan monthly base of a non-monthly wage is not sealed by law');

	const monthly = em.basic + em.fixedAllowance; // Upah sebulan: upah pokok + tunjangan tetap
	const serviceMonths = completedMonths(em.hireDate, first);

	// PP36 art 7(2): basic at least 75% of basic + fixed allowances.
	if (em.basic * 4 < monthly * 3)
		return refuse('ID-02: basic wage under 75% of basic plus fixed allowances');
	// UU13 art 88E(2), PP36 arts 23–24: compared in sen (ID-127); DKI UMSP for service under one year (ID-54).
	const sector2026 =
		co.workplace === 'DKI' && first >= '2026-01-01'
			? (DKI_UMSP_2026[co.kbli] ??
				DKI_UMSP_2026_CONDITIONAL.find(([k, c]) => k === co.kbli && co.umspConditions.includes(c))?.[2])
			: undefined;
	const strict = STRICT.find(([w, a, b]) => w === co.workplace && between(first, a, b));
	if (strict !== undefined && sector2026 === undefined && !(strict[3] && co.kbli === ATTESTED_ORDINARY))
		return refuse(`ID-173: KBLI ${co.kbli} unmatched at the strict sector place ${co.workplace}`);
	let floor = floorOn(co.workplace, first);
	if (sector2026 !== undefined && serviceMonths < 12) floor = Math.max(floor, sector2026); // KETIGA
	if (Math.round(monthly * 100) < Math.round(floor * 100))
		return refuse(`MINIMUM_WAGE_BELOW: ${monthly} under the ${floor} floor`);
	// ID-114: micro/small severance is by agreement; the generic multiplier does not bind.
	if (co.microSmall && em.exitCause !== null && em.exitCause in CAUSE && em.type === 'PKWTT')
		return refuse('ID-114: micro/small enterprise severance needs the recorded agreement');

	if (co.jkkRiskGroup === null) return refuse('ID-16: no registered JKK risk group');
	const riskGroup = co.jkkRiskGroup;

	// ----- wages (ID-106 DEFAULT: calendar days) -----
	const from = em.hireDate > first ? em.hireDate : first;
	const to = em.exitDate !== null && em.exitDate < last ? em.exitDate : last;
	const employedDays = Math.round((D(to) - D(from)) / DAY) + 1;
	const unpaid = inp.unpaidDates.filter((d) => between(d, from, to)).length;
	const reducedLoss =
		inp.reducedPay === null ? 0 : inp.reducedPay.days * (1 - inp.reducedPay.fraction);
	const paidDays = employedDays - unpaid - reducedLoss;
	// ID-161 DEFAULT: a mid-month raise prices each part at its own rate by calendar days (no unpaid days are used
	// with a raise); JHT/JKK/JKM use the rate in force on the month's last employed day.
	const basicPaid =
		em.raise === null
			? r2((em.basic * paidDays) / cal)
			: r2(
					(em.basic * Math.round((D(em.raise.from) - D(from)) / DAY)) / cal +
						(em.raise.basic * (Math.round((D(to) - D(em.raise.from)) / DAY) + 1)) / cal
				);
	const rateBasic = em.raise === null ? em.basic : em.raise.basic;
	const fixedPaid = r2((em.fixedAllowance * paidDays) / cal);
	const nonFixedPaid = r2((em.nonFixedAllowance * paidDays) / cal);
	add('BASIC', basicPaid);
	add('FIXED_ALLOWANCE', fixedPaid);
	add('NON_FIXED_ALLOWANCE', nonFixedPaid);
	const monthWagePaid = r2(basicPaid + fixedPaid); // "pada bulan yang bersangkutan" (JP, Kesehatan)

	// ----- overtime (PP35 arts 31–32) -----
	const whole = monthly + em.nonFixedAllowance;
	const otBase = monthly < 0.75 * whole ? 0.75 * whole : monthly; // art 32(3)–(4)
	let multiplier = 0;
	for (const o of inp.overtime) {
		const bands = OT_BANDS[o.kind][co.workWeek];
		if (o.hours > bands.length)
			return refuse(`overtime of ${o.hours} h exceeds the ${o.kind} band`);
		for (let h = 0; h < o.hours; h++) multiplier += bands[h]!;
	}
	add('OVERTIME', r2((otBase / 173) * multiplier)); // art 32(2): 1/173 of the monthly wage per hour

	// ----- THR (Permenaker 6/2016 arts 2–3): completed months at the holiday -----
	if (inp.thrHolidayDate !== null) {
		const m = completedMonths(em.hireDate, inp.thrHolidayDate);
		if (m >= 1) add('THR', m >= 12 ? monthly : r2((m / 12) * monthly));
		else inputsRefused.push('ID-13: THR needs at least one month of continuous service');
	}
	add('BONUS', inp.bonus);

	// ----- exit rights -----
	let severance = 0;
	const exiting = em.exitDate !== null && between(em.exitDate, first, last);
	if (exiting && em.type === 'PKWTT' && em.exitCause !== null && em.exitCause in CAUSE) {
		const [pf, uf, pisah] = CAUSE[em.exitCause as keyof typeof CAUSE];
		const years = Math.floor(completedMonths(em.hireDate, addDays(em.exitDate!, 1)) / 12);
		// UU13 art 157(1): wage = basic + fixed allowances
		const pes = r2(pesangonMonths(years) * pf * monthly);
		const upmk = r2(upmkMonths(years) * uf * monthly);
		add('PESANGON', pes);
		add('UPMK', upmk);
		if (pisah) add('UANG_PISAH', inp.uangPisah);
		severance = pes + upmk + (pisah ? inp.uangPisah : 0);
	}
	if (exiting && em.type === 'PKWT' && !ee.citizen)
		inputsRefused.push('ID-109: no PKWT compensation for a foreign worker (PP35 art 15(5))');
	if (exiting && em.type === 'PKWT' && ee.citizen) {
		// PP35 arts 15–17: service months ÷ 12 × one month's wage; ≥ 1 continuous month; not a foreigner (15(5)).
		const months = completedMonths(em.hireDate, addDays(em.exitDate!, 1));
		// art 16(2)–(4): basic + fixed; basic only when the rest is non-fixed
		const wage = em.fixedAllowance > 0 ? monthly : em.basic;
		if (months >= 1) {
			const comp = r2((months / 12) * wage);
			add('PKWT_COMPENSATION', comp);
			severance += comp;
		}
		// UU13 art 62: the party ending a PKWT early owes the wages of the remaining term.
		if (em.exitCause === 'EMPLOYER_EARLY_END' && em.contractEnd !== null) {
			const remaining = completedMonths(addDays(em.exitDate!, 1), addDays(em.contractEnd, 1));
			const indemnity = r2(remaining * monthly);
			add('PKWT_REMAINING_TERM', indemnity);
			severance += indemnity;
		}
	}

	// ----- BPJS -----
	const age = ageOn(ee.birthDate, first);
	const bpjsTk = ee.citizen || ee.foreignWorkMonths >= 6; // PP 46 art 2(2); ID-175
	const charge = (code: string, base: number, eePct: number, erPct: number) => {
		statutory[code] = {
			employee: r0((base * eePct) / 100),
			employer: r0((base * erPct) / 100),
			base
		};
	};
	if (bpjsTk) {
		// JHT PP46 art 16–17 / JKK, JKM PP44 art 19: on Upah sebulan, the contract's monthly rate (ID-161)
		const upahSebulan = rateBasic + em.fixedAllowance;
		charge('JHT', upahSebulan, 2, 3.7);
		const relief = co.padatKarya && first >= '2025-02-01' && first <= '2026-01-31';
		charge('JKK', upahSebulan, 0, (relief ? JKK_PADAT_KARYA : JKK)[riskGroup]);
		charge('JKM', upahSebulan, 0, 0.3);
	}
	// JP PP45 arts 2–4, 15, 29: the month's wage paid, capped; a foreigner only on a registration.
	const jpAge = ee.jpDeferral ? pensionAge(first) + 3 : pensionAge(first);
	if ((ee.citizen || ee.jpRegistered) && age < jpAge)
		charge('JP', Math.min(monthWagePaid, jpCeiling(first)), 1, 2);
	// Kesehatan Perpres 82/2018 arts 30–33 / 59/2024: month's wage paid, whole-month floor, ceiling (ID-161 DEFAULT).
	if (bpjsTk) {
		const base = Math.min(Math.max(monthWagePaid, floorOn(co.workplace, first)), KESEHATAN_CEILING);
		statutory.KESEHATAN = {
			employee: r0((base * (1 + ee.kesehatanExtraMembers)) / 100),
			employer: r0((base * 4) / 100),
			base
		};
	}

	// ----- income tax -----
	let taxDue = 0;
	const employerPremiums = ['JKK', 'JKM', 'KESEHATAN'].reduce(
		(sum, c) => sum + (statutory[c]?.employer ?? 0),
		0
	); // PMK168 art 5(3)(d)–(e)
	const regular = Object.entries(components)
		.filter(
			([c]) =>
				!['PESANGON', 'UPMK', 'UANG_PISAH', 'PKWT_COMPENSATION', 'PKWT_REMAINING_TERM'].includes(c)
		)
		.reduce((sum, [, v]) => sum + v, 0);
	const taxGross = r2(regular + employerPremiums);
	if (!ee.taxResident) {
		// UU PPh art 26(1), PMK168 arts 12(9), 14(1): 20% of gross, severance included (ID-168)
		statutory.PPH26 = {
			employee: r0(0.2 * (taxGross + severance)),
			employer: 0,
			base: r2(taxGross + severance)
		};
	} else {
		const lastPeriod = s.period.endsWith('-12') || exiting; // PMK168 art 1(18)
		let tax: number;
		if (lastPeriod) {
			// PMK168 arts 8(3)–(5), 10, 15(1)(b): the year's income from this employer — the earlier months of this
			// calendar year (priced on the same terms, TER withheld each month) plus this payslip; the tax due here is
			// the year's art 17 tax less the TER already withheld (PMK 105/2025 annex B example 1 counts DTP months as
			// withheld).
			const prior = priorPeriods(s).map((p) =>
				computePayslip({
					...s,
					period: p,
					employment: { ...em, exitDate: null, exitCause: null, raise: null },
					inputs: { ...inp, unpaidDates: [], overtime: [], thrHolidayDate: null, bonus: 0, wageDeduction: 0, uangPisah: 0, reducedPay: null }
				})
			);
			const blocked = prior.find((p) => p.refused !== null);
			if (blocked !== undefined) return refuse(`an earlier month of the year: ${blocked.refused}`);
			const yearGross = r2(prior.reduce((a, p) => a + (p.statutory.PPH21?.base ?? 0), 0) + taxGross);
			const months = prior.length + 1;
			// art 10(2): 5%, at most Rp6,000,000 a year or Rp500,000 a month (500,000 × the months of the year worked)
			const biayaJabatan = Math.min(0.05 * yearGross, 500_000 * months);
			const own = (c: string, list: Payslip[]) => list.reduce((a, p) => a + (p.statutory[c]?.employee ?? 0), 0);
			const neto =
				yearGross -
				biayaJabatan -
				own('JHT', prior) -
				own('JP', prior) -
				(statutory.JHT?.employee ?? 0) -
				(statutory.JP?.employee ?? 0) -
				ee.zakat;
			// PMK168 art 15(3) (signed text read 2026-09-30): "Dalam hal kewajiban pajak subjektif Pegawai Tetap ...
			// baru dimulai setelah bulan Januari atau berakhir sebelum bulan Desember, penghitungan ... dilakukan
			// berdasarkan penghasilan neto yang disetahunkan dan pajaknya dihitung secara proporsional terhadap jumlah
			// bulan dalam bagian Tahun Pajak". A job change alone keeps the actual (unannualised) neto.
			const part = ee.subjectivePartYear && months < 12;
			const yearNeto = part ? (neto * 12) / months : neto;
			const pkp = Math.max(0, Math.floor((yearNeto - ptkpAmount(ee.ptkp)) / 1000) * 1000); // art 8(4)
			const withheld = prior.reduce((a, p) => a + p.taxDue, 0);
			const yearTax = art17(pkp) * (part ? months / 12 : 1);
			// ponytail: a year that over-withheld yields a negative figure here; the refund is ID-21's open branch.
			tax = r0(yearTax * (ee.hasTaxId ? 1 : 1.2)) - withheld;
			notes.push(`last period: ${months} month(s), neto ${r2(neto)}, PKP ${pkp}, TER withheld ${withheld}`);
		} else {
			tax = r0(((taxGross * terRateBp(ee.ptkp, taxGross)) / 10_000) * (ee.hasTaxId ? 1 : 1.2));
		}
		taxDue = tax;
		// PMK 105/2025 arts 2–4 (signed text read 2026-09-30): at an annex-KLU employer, a permanent employee with an
	// NPWP/NIK whose fixed regular gross — salary and fixed allowances, art 4(4)(a) — is "tidak lebih dari"
	// Rp10,000,000 has all 2026 PPh 21 borne by government (art 2(2)); severance stays final-taxed (art 4(6)).
		const dtp = co.dtpKlu && ee.hasTaxId && s.period.startsWith('2026-') && monthly <= 10_000_000;
		if (dtp) notes.push(`PPh 21 ${tax} borne by government (DTP), paid in cash`);
		statutory.PPH21 = { employee: dtp ? 0 : tax, employer: 0, base: taxGross };
		if (severance > 0)
			statutory.PPH21_FINAL_SEVERANCE = {
				employee: r0(pp68(severance)),
				employer: 0,
				base: r2(severance)
			};
	}
	if (ee.zakat > 0) components.ZAKAT = -ee.zakat;

	// PP36 art 65: art 63 deductions at most 50% of each wage payment (contributions and tax outside the cap).
	const wagePaid = r2(basicPaid + fixedPaid + nonFixedPaid + (components.OVERTIME ?? 0));
	if (inp.wageDeduction * 2 > wagePaid)
		return refuse('ID-06: deductions above half of the wage payment');
	if (inp.wageDeduction > 0) components.WAGE_DEDUCTION = -inp.wageDeduction;

	return { ...finish(components, statutory, notes), inputsRefused, taxDue };
}

function finish(
	components: Record<string, number>,
	statutory: Record<string, Line>,
	notes: string[]
): Payslip {
	const gross = r2(
		Object.values(components)
			.filter((v) => v > 0)
			.reduce((a, b) => a + b, 0)
	);
	const other = -Object.values(components)
		.filter((v) => v < 0)
		.reduce((a, b) => a + b, 0);
	const eeSum = Object.values(statutory).reduce((a, l) => a + l.employee, 0);
	const erSum = Object.values(statutory).reduce((a, l) => a + l.employer, 0);
	const total_deductions = r2(eeSum + other);
	return {
		refused: null,
		inputsRefused: [],
		components: Object.fromEntries(Object.entries(components).filter(([, v]) => v > 0)),
		statutory,
		gross,
		total_deductions,
		net: r2(gross - total_deductions),
		employer_cost: r2(gross + erSum),
		taxDue: 0,
		notes
	};
}

/** The payslip as probe-harness line keys (`gross`, component codes, `<scheme>.employee|employer`). */
export function probeLines(p: Payslip): Record<string, number> {
	const out: Record<string, number> = {
		gross: p.gross,
		net: p.net,
		total_deductions: p.total_deductions,
		employer_cost: p.employer_cost,
		...p.components
	};
	for (const [code, l] of Object.entries(p.statutory)) {
		out[`${code}.employee`] = l.employee;
		out[`${code}.employer`] = l.employer;
	}
	return out;
}
