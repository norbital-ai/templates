/**
 * Independent oracle for CN-kunming: an expected payslip computed from the law alone, never from `src/**` or `seed/**`.
 *
 * Every rule cites the tracker row (`docs/inventory/china.csv`, branch-level ids) and the official instrument it reads.
 * Where the law is silent the owner rule applies (law silent → a lawful, consistent default); each such default is
 * marked `DEFAULT:` with its reason. Where the law needs a figure no official source gives (an agency determination, a
 * missing 2026 renewal instrument), the figure is a declared scenario fact, or the key is returned in `unpriced` and the
 * caller must not judge it.
 *
 * Line keys follow `tests/e2e/payroll-probe.ts`: `gross`, `net`, `total_deductions`, component codes (summed), and
 * `<scheme>.employee` / `<scheme>.employer` per statutory charge. Scheme and component codes are the tracker's
 * `config_path` codes (PENSION, MEDICAL, MATERNITY, UNEMPLOYMENT, INJURY, HOUSING_FUND, IIT, IIT_BONUS, IIT_SEVERANCE,
 * IIT_EARLY_RETIREMENT, IIT_INTERNAL_RETIREMENT; OVERTIME, BONUS, ANNUAL_BONUS_SEPARATE, SEVERANCE_PAY,
 * NO_WRITTEN_CONTRACT_WAGE, OPEN_ENDED_CONTRACT_WAGE, PROBATION_EXCESS_DAMAGES, PROBATION_WAGE_SHORTFALL,
 * MATERNITY_ALLOWANCE_OFFSET, MATERNITY_BENEFIT_EMPLOYER, HEAT_ALLOWANCE, EARLY_RETIREMENT_SUBSIDY,
 * INTERNAL_RETIREMENT_SUBSIDY, ONE_CHILD_SUBSIDY, CHILDCARE_SUBSIDY, TRAVEL_ALLOWANCE, MISSED_MEAL_SUBSIDY) and
 * otherwise descriptive (BASIC, UNPAID_LEAVE, LEAVE_ENCASHMENT, and the post-tax LOSS_RECOVERY and
 * COURT_ORDERED_SUPPORT, which are negative, outside gross and inside total_deductions). `bases` gives each
 * contribution base. Compare gross, net and the statutory keys first; a component split may differ (the engine may
 * put overtime above the art.41 limits on another code — the sum is what the law fixes).
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
// Rounding. Social insurance: to the fen, half-up, per side — CN-X-SI-ROUNDING.social-insurance-fen (law silent;
// owner-rule default). Housing fund: each side to the whole yuan, 四舍五入, separately — 昆公积金规〔2020〕2号 art.13
// (CN-KM05.per-side-rounding, CN-KM20.per-side-rounding, CN-X-SI-ROUNDING.housing-fund-yuan). Tax: to the fen.
// Pay lines: DEFAULT the fen, half-up (law silent).
const fen = (x: number) => (Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7)) / 100;
const yuan = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);

// ---------------------------------------------------------------------------------------------------------------
// Calendar (UTC, ISO dates).
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(ms(d) + n * 86_400_000);
const monthStart = (p: string) => `${p}-01`;
const monthEnd = (p: string) => {
	const [y, m] = p.split('-').map(Number);
	return iso(Date.UTC(y!, m!, 0));
};
const addMonths = (p: string, n: number) => {
	const [y, m] = p.split('-').map(Number);
	return iso(Date.UTC(y!, m! - 1 + n, 1)).slice(0, 7);
};
const weekday = (d: string) => new Date(ms(d)).getUTCDay();
const nextPeriod = (p: string) => addMonths(p, 1);
const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);

// Paid days — 人社部发〔2025〕2号 (CN-N02.day-conversion-21-75): 21.75 = (365 − 104 rest days) ÷ 12, so every
// working day and every statutory holiday is a paid day and a rest day is not. The 2026 schedule 国办发明电〔2025〕7号
// (https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm, read 2026-09-30; CN-N03.adjusted-workdays): weekend
// workdays 4 Jan, 14 Feb, 28 Feb, 9 May, 20 Sep, 10 Oct; 1 Jan, 16–19 Feb (除夕 to 初三, Order 795's four Spring Festival
// days), 25 Sep are statutory holidays on weekdays; 2 Jan, 20 Feb, 23 Feb are 调休 rest weekdays. May and October 2026 mix
// 补假 with 调休 in a way the notice does not split day by day, so no span there is priced.
const WEEKEND_WORKDAYS = new Set(['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']);
const REST_WEEKDAYS = new Set(['2026-01-02', '2026-02-20', '2026-02-23']);
const isPaidDay = (d: string) => {
	if (/^2026-(05|10)-/.test(d)) throw new Error(`no day-level 2026 schedule priced for ${d}`);
	return WEEKEND_WORKDAYS.has(d) || (weekday(d) % 6 !== 0 && !REST_WEEKDAYS.has(d));
};
export const paidDays = (from: string, to: string) => {
	let n = 0;
	for (let d = from; d <= to; d = addDays(d, 1)) if (isPaidDay(d)) n++;
	return n;
};

// ---------------------------------------------------------------------------------------------------------------
// Minimum wage — CN-KM01.class-i-2170/class-ii-2020/mo-han-1870/hourly-floors (云人社发〔2025〕19号, 1 Oct 2025) and
// CN-KM02.class-i-2270/class-ii-2120/mo-han-1970/hourly-floors (Yunnan HRSS 29 Aug 2026, 1 Sep 2026). The monthly floor
// includes the worker's own SI/fund shares (CN-KM01.qualifying-pay, CN-KM02.qualifying-pay) and excludes overtime and
// specified allowances (最低工资规定 art.12, CN-N50.excluded-components), so it is tested on the contract wage for
// normal hours (CN-N50.floor-test). Hourly floors bind non-full-time work (LCL art.72, CN-N27.hourly-minimum).
const MIN_WAGE = [
	{ from: '2025-10-01', monthly: { I: 2170, II: 2020, III: 1870 }, hourly: { I: 21, II: 20, III: 19 } },
	{ from: '2026-09-01', monthly: { I: 2270, II: 2120, III: 1970 }, hourly: { I: 22, II: 21, III: 20 } }
] as const;
export const minimumWage = (day: string, region: Region) => {
	const row = [...MIN_WAGE].reverse().find((r) => r.from <= day);
	if (row === undefined) throw new Error(`no Kunming minimum wage sourced before 2025-10-01 (${day})`);
	return { monthly: row.monthly[region], hourly: row.hourly[region] };
};
/** LCL Implementing Regulation art.14 (CN-X-WORKSITE.performance-place-standard): the performance place's standard;
 * the parties may agree the higher employer-registration standard (CN-X-WORKSITE.higher-agreed-employer-standard). */
const floorOn = (s: Scenario, day: string) => {
	const own = minimumWage(day, s.employment.wageRegion);
	const agreed = s.employment.agreedRegion;
	if (agreed === undefined) return own;
	const higher = minimumWage(day, agreed);
	return { monthly: Math.max(own.monthly, higher.monthly), hourly: Math.max(own.hourly, higher.hourly) };
};

// ---------------------------------------------------------------------------------------------------------------
// Social-insurance bases — CN-KM03. 2025 (CN-KM03.piu-floor-2025/piu-ceiling-2025): 4,357–21,789 every scheme.
// 云人社发〔2026〕8号: 4,403–22,017; pension/unemployment/injury from January 2026 (CN-KM03.piu-floor-2026/piu-ceiling-2026,
// recorded default: the notice's 2026年度); medical/maternity keep 2025's to 31 Aug and switch 1 Sep 2026
// (CN-KM03.medical-*). SI follows the employing unit, not the worksite (CN-X-WORKSITE.si-follows-employment).
type SiScheme = 'PENSION' | 'MEDICAL' | 'MATERNITY' | 'UNEMPLOYMENT' | 'INJURY';
export const siBounds = (scheme: SiScheme, day: string): [number, number] => {
	const medical = scheme === 'MEDICAL' || scheme === 'MATERNITY';
	return day < (medical ? '2026-09-01' : '2026-01-01') ? [4357, 21789] : [4403, 22017];
};
// Pension 16% / 8% (CN-KM25.unit-covered-16-8). Medical 7% / 2% (CN-KM04.employer-7pct, CN-KM04.employee-2pct).
// Maternity 0.9% employer only (CN-KM32.employer-premium-0-9). Injury employer only at the recorded class rate
// 0.2–1.9% or its assigned float (CN-KM26.recorded-class-rate, CN-KM26.assigned-float) — a declared fact.
// Unemployment 0.7/0.3 to 31 Dec 2025 (CN-KM27.reduced-2025) and from September 2026 (CN-KM27.rate-from-sep-2026,
// "目前，延续实施"); January–August 2026 has no sourced instrument (CN-KM27.rate-jan-aug-2026): the declared fact, else
// unpriced.
const RATE = {
	PENSION: { employer: 0.16, employee: 0.08 },
	MEDICAL: { employer: 0.07, employee: 0.02 },
	MATERNITY: { employer: 0.009, employee: 0 }
} as const;
const unemploymentRates = (day: string, s: Scenario) =>
	day < '2026-01-01' || day >= '2026-09-01' ? { employer: 0.007, employee: 0.003 } : s.facts.unemploymentRates;

// Housing fund — CN-KM05 / CN-KM20 / CN-N08. Cap 32,470 for 2025 (CN-KM05.ceiling-2025); 32,543 for 2026, retroactive
// to 1 January (CN-KM05.ceiling-2026). Floors 2,170 / 2,020 / 1,870 from October 2025, 2,270 / 2,120 / 1,970 from
// 1 Sep 2026 (CN-KM05.new-account-floor-*). DEFAULT (CN-KM05.existing-account-floor, law not explicit): the dated
// floor binds every account — the 4 Jan 2026 interim notice already applies its floor to all contributors.
export const fundBounds = (day: string, region: Region): [number, number] => {
	const cap = day < '2026-01-01' ? 32470 : 32543;
	const floor = (day < '2026-09-01' ? { I: 2170, II: 2020, III: 1870 } : { I: 2270, II: 2120, III: 1970 })[region];
	return [floor, cap];
};
const clamp = (x: number, [lo, hi]: [number, number]) => Math.min(Math.max(x, lo), hi);

// ---------------------------------------------------------------------------------------------------------------
// IIT tables — STA 2018 No.61 annex tables 1 and 3 (CN-N38.resident-annual-table, CN-N38.non-resident-monthly-table).
// Bands are ceiling-inclusive.
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
type Table = typeof ANNUAL | typeof MONTHLY;
const band = (table: Table, x: number) => table.find(([to]) => x <= to)!;
const onTable = (table: Table, x: number) => {
	if (x <= 0) return 0;
	const [, rate, qd] = band(table, x);
	return Math.max(0, x * rate - qd);
};

/** Special additional deductions a month — CN-N16 (国发〔2022〕8号 as raised by the 2023 increase: child education and
 * infant care CNY2,000 per child, elderly support CNY3,000 for an only child, a shared ≤ CNY1,500 otherwise; continuing
 * education CNY400 a month for a degree, CNY3,600 in the certificate year), CN-N54.capital-city-1500 (rent 1,500 in a
 * provincial capital), CN-N16.housing-loan-interest (CNY1,000), deducted as declared (STA 2022 No.7 arts.25–26,
 * CN-N16.sharing-elections). `raw` is a declared monthly total the generator uses to aim at a table seam. */
function specialMonthly(s: Scenario, period: string): number | string {
	const d = s.tax.special;
	if (d === undefined) return s.tax.specialDeductionsMonthly ?? 0;
	if (d.from !== undefined && period < d.from) return 0;
	if (d.rent && d.loanInterest) return 'housing rent and housing-loan interest in one year (国发〔2018〕41号, CN-N54.rent-or-loan)';
	if ((d.elderlyShare ?? 0) > 1500) return 'a non-only child’s elderly-support share above 1,500';
	let m = (d.children ?? 0) * 2000 * (d.childShare ?? 1) + (d.infants ?? 0) * 2000 * (d.childShare ?? 1);
	m += d.elderlyOnlyChild ? 3000 : (d.elderlyShare ?? 0);
	if (d.continuingEducation === 'DEGREE') m += 400;
	if (d.continuingEducation === 'CERTIFICATE' && period === s.period) m += 3600;
	if (d.rent) m += 1500;
	if (d.loanInterest) m += 1000;
	return m + (s.tax.specialDeductionsMonthly ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
type Month = {
	lines: Record<string, number>;
	bases: Record<string, number>;
	/** 工资薪金 income for IIT (IIT Law art.6) */
	wageIncome: number;
	/** wage due excluding overtime and exit items — the 12-month average (CN-N06, CN-N19.severance-wage-base) */
	averageWage: number;
	/** worker SI + fund shares (IIT Law art.6(1) 专项扣除) */
	employeeShares: number;
	warnings: string[];
	unpriced: string[];
	refused?: Payslip['refused'];
};
const refusal = (stage: 'input' | 'run', reason: string): Month => ({
	lines: {},
	bases: {},
	wageIncome: 0,
	averageWage: 0,
	employeeShares: 0,
	warnings: [],
	unpriced: [],
	refused: { stage, reason }
});

const contractWageOn = (s: Scenario, day: string) =>
	s.employment.raise !== undefined && day >= s.employment.raise.from
		? s.employment.raise.monthlyWage
		: s.employment.monthlyWage;

/** Basic pay for the employed span of a month — CN-N02.day-conversion-21-75, CN-N04.exit-settlement. Whole month: the
 * monthly wage; a rise inside it splits the month by paid days (CN-N02 recorded default). Part month: paid days in the
 * span × monthly ÷ 21.75 (CN-N02 recorded default, law silent), DEFAULT capped at the monthly wage. */
function basicPay(s: Scenario, period: string, monthly: (day: string) => number) {
	const from = max(monthStart(period), s.employment.hireDate);
	const to = min(monthEnd(period), s.employment.exitDate ?? '9999-12-31');
	if (from > to) return 0;
	const rise = s.employment.raise?.from;
	const riseInside = rise !== undefined && rise > from && rise <= to;
	if (from === monthStart(period) && to === monthEnd(period) && !riseInside) return monthly(to);
	const all = paidDays(monthStart(period), monthEnd(period));
	const worked = paidDays(from, to);
	const segments: [string, string][] = riseInside ? [[from, addDays(rise!, -1)], [rise!, to]] : [[from, to]];
	if (worked === all) return segments.reduce((sum, [a, b]) => sum + (monthly(a) * paidDays(a, b)) / all, 0);
	const pay = segments.reduce((sum, [a, b]) => sum + (monthly(a) / 21.75) * paidDays(a, b), 0);
	return Math.min(pay, monthly(to));
}

/** Leave the Yunnan regulation and national rules grant, in calendar days (Yunnan Population and Family Planning
 * Regulation 2022 arts.18, 19, 35; 国劳总薪字〔1980〕29号; Female Workers Regulation art.7; Kunming maternity rules;
 * Yunnan Order 232; 工伤保险条例 art.33). A longer request is refused at input. */
function leaveGrant(leave: NonNullable<Scenario['time']['leave']>): number | undefined {
	switch (leave.code) {
		// CN-KM30.yunnan-15-days + CN-KM30.national-component / CN-N51.marriage-leave: 15 + national 1–3;
		// DEFAULT the discretionary national maximum, 3 → 18 (the tracker's "typically 18")
		case 'MARRIAGE_LEAVE':
			return 18;
		// CN-N51.funeral-leave: 1–3 days; DEFAULT the maximum 3
		case 'FUNERAL_LEAVE':
			return 3;
		// CN-KM12.one-child-ten-days / two-or-more-fifteen-days / ends-at-third-birthday
		case 'CHILDCARE_LEAVE':
			return (leave.childrenUnder3 ?? 0) >= 2 ? 15 : (leave.childrenUnder3 ?? 0) === 1 ? 10 : 0;
		// CN-KM31.*: Yunnan regulation art.19
		case 'FAMILY_PLANNING_PROCEDURE_LEAVE':
			return (<Record<string, number>>{
				IUD_INSERTION: 7,
				IUD_REMOVAL: 7,
				TUBAL_LIGATION: 30,
				VASECTOMY: 15,
				TUBAL_REVERSAL: 30,
				VAS_REVERSAL: 15,
				REMEDIAL_UNDER_4_MONTHS: 15,
				REMEDIAL_4_MONTHS_OR_MORE: 42
			})[leave.procedure ?? 'IUD_INSERTION'];
		// CN-N20.maternity-98-days / difficult-birth-15 / additional-infant-15 / miscarriage, CN-KM12.maternity-and-
		// partner-days (98 + Yunnan 60 = 158); miscarriage under 4 months 15, at 4 months 42 (national art.7); DEFAULT at
		// 7 months or more the full leave (the Kunming fund days, CN-KM32.fund-benefits)
		case 'MATERNITY_LEAVE': {
			const mo = leave.miscarriageMonths;
			if (mo !== undefined) return mo < 4 ? 15 : mo < 7 ? 42 : 158;
			return 158 + (leave.difficultBirth ? 15 : 0) + 15 * (leave.extraInfants ?? 0);
		}
		// CN-KM12.maternity-and-partner-days: 30 partner-care days
		case 'PATERNITY_LEAVE':
			return 30;
		// CN-KM11.dysmenorrhoea-leave: 1–2 days; DEFAULT the maximum 2
		case 'DYSMENORRHOEA_LEAVE':
			return 2;
		// CN-N21.stop-work-original-wage, CN-KM-WP13.original-wage-twelve-months / extension-twelve-months: 12 + 12 months
		case 'WORK_INJURY_LEAVE':
			return 731;
	}
	return undefined;
}

/** The 12-month average wage before the exit month — Regulation art.27 (CN-N19.severance-wage-base: bonus and allowances
 * included) and the annual-leave day wage (CN-N06.day-wage-twelve-month-average: overtime excluded, bonus included), over
 * the actual shorter tenure; a stint with no month before the exit month reads the contract wage (CN-SH-A2.art47-average).
 * DEFAULT: a month before the first run is the contract monthly wage (no history is declared). */
function average12(s: Scenario, history: Map<string, number>, exitPeriod: string) {
	const hireMonth = s.employment.hireDate.slice(0, 7);
	const months: number[] = [];
	for (let i = 12; i >= 1; i--) {
		const p = addMonths(exitPeriod, -i);
		if (p < hireMonth) continue;
		months.push(history.get(p) ?? contractWageOn(s, monthEnd(p)));
	}
	if (months.length === 0) return s.employment.monthlyWage;
	return months.reduce((a, b) => a + b, 0) / months.length;
}

const POST_TAX = new Set(['LOSS_RECOVERY', 'COURT_ORDERED_SUPPORT']);
const UNTAXED_SUBSIDY = new Set(['ONE_CHILD_SUBSIDY', 'CHILDCARE_SUBSIDY', 'TRAVEL_ALLOWANCE', 'MISSED_MEAL_SUBSIDY']);

function month(s: Scenario, period: string, final: boolean, history = new Map<string, number>()): Month {
	const first = monthStart(period);
	const last = monthEnd(period);
	const lines: Record<string, number> = {};
	const bases: Record<string, number> = {};
	const warnings: string[] = [];
	const unpriced: string[] = [];
	let wageIncome = 0;
	let averageWage = 0;
	const add = (code: string, amount: number, taxable = true, average = true) => {
		if (amount === 0) return;
		lines[code] = fen((lines[code] ?? 0) + amount);
		if (taxable) wageIncome += amount;
		if (average) averageWage += amount;
	};
	const pt = s.employment.partTime;
	const probation = s.employment.probationWage;

	// CN-N09.tax-residence: the method follows tax residence, which must be recorded
	if (s.employee.taxResident === null) return refusal('run', 'tax residence not recorded');

	// --- minimum wage (CN-KM01/02, CN-KM-WP03.minimum-wage-floor, CN-N50.floor-test, CN-N14.minimum-wage)
	const onDay = max(first, s.employment.hireDate);
	const floor = floorOn(s, onDay);
	if (pt !== undefined) {
		if (pt.hourlyRate < floor.hourly)
			return refusal('run', `hourly wage ${pt.hourlyRate} below the hourly minimum ${floor.hourly}`);
	} else if (probation === undefined) {
		for (const day of [onDay, s.employment.raise?.from].filter((d): d is string => d !== undefined && d <= last)) {
			const need = floorOn(s, max(day, first)).monthly;
			if (contractWageOn(s, day) < need)
				return refusal('run', `monthly wage ${contractWageOn(s, day)} below the minimum ${need}`);
		}
	}

	// --- pay
	if (pt !== undefined) {
		add('BASIC', pt.hourlyRate * pt.hours);
	} else {
		// LCL art.20 and Regulation art.15 (CN-N19.probation-wage-floor): the probation wage is at least 80% of the agreed
		// wage (recorded default comparator) and the local minimum; the shortfall is owed.
		const monthly = (day: string) => (probation !== undefined ? probation : contractWageOn(s, day));
		add('BASIC', basicPay(s, period, monthly));
		if (probation !== undefined) {
			const due = Math.max(0.8 * s.employment.monthlyWage, floor.monthly);
			if (due > probation) add('PROBATION_WAGE_SHORTFALL', due - probation);
		}
		const dayRate = contractWageOn(s, last) / 21.75; // CN-N02.day-conversion-21-75
		// CN-N04.unpaid-personal-leave, CN-KM-WP12.personal-leave-absent-only (art.25): only the absent day's wage
		if (final && s.time.unpaidDays) add('UNPAID_LEAVE', -dayRate * s.time.unpaidDays);
		// CN-N04.stoppage, CN-KM-WP15.first-wage-cycle (art.28): stoppage not caused by the worker within the first wage
		// cycle pays the contracted wage — no deduction. Night work carries no statutory premium (CN-N53.night-premium).
		// Overtime — Labour Law art.44 (CN-N01.*, CN-KM-WP08.*): hour = monthly ÷ 21.75 ÷ 8 (CN-N02.hour-conversion-8);
		// weekday 150%; rest day 200% unless compensatory rest is arranged; statutory holiday 300%, never replaced
		// (CN-N40.holiday-no-substitution). Excluded from the 12-month leave average (CN-N06).
		const ot = final ? s.time.overtime : undefined;
		if (ot !== undefined) {
			const hour = contractWageOn(s, last) / 21.75 / 8;
			const addOt = (x: number) => add('OVERTIME', fen(x), true, false);
			addOt(hour * 1.5 * (ot.weekdayHours ?? 0));
			if (!ot.restDayCompensatoryRest) addOt(hour * 2 * (ot.restDayHours ?? 0));
			addOt(hour * 3 * (ot.holidayHours ?? 0));
			// Labour Law art.41 (CN-N40.daily-three-hour-cap, CN-N40.monthly-36-hour-cap): at most 3 a day and 36 a
			// month; hours beyond are still paid, the breach is reported. Rest-day/holiday work is not 延长工作时间.
			if ((ot.weekdayHours ?? 0) > 36) warnings.push('monthly overtime limit|36');
			if ((ot.maxDailyWeekdayHours ?? 0) > 3) warnings.push('daily overtime limit|3');
		}
		// Heat allowance — 云人社发〔2013〕98号 with the national measure art.17 (CN-KM13.outdoor-35, CN-KM13.indoor-33,
		// CN-N26.kunming-allowance): CNY10 per person per qualifying working day, inside total wages (taxable), outside the
		// minimum-wage test.
		if (final && s.pay.heatDays) add('HEAT_ALLOWANCE', 10 * s.pay.heatDays);
		// Statutory leave is paid (CN-N04.paid-civic-and-leave-time, CN-KM-WP12.*, CN-KM30.calendar-day-counting,
		// CN-KM31.calendar-day-counting); a request longer than the grant is refused.
		const leave = final ? s.time.leave : undefined;
		if (leave !== undefined) {
			const grant = leaveGrant(leave);
			if (grant !== undefined && leave.calendarDays > grant)
				return refusal('input', `${leave.code}: ${leave.calendarDays} calendar days exceed the ${grant} granted`);
		}
		// Maternity — CN-KM32.allowance-offset-top-up: the fund allowance (employer prior-year average ÷ 30 × leave days,
		// an agency determination, declared) paid to the worker comes off the leave wage; the employer tops up to the
		// wage (recorded default, 女职工劳动保护特别规定 art.5). Paid to the employer, the wage is paid in full.
		// CN-KM32.non-enrolling-employer (item 3) and CN-N20.insured-benefit-or-wage: an employer that did not enrol pays
		// the allowance and the CNY1,000 nutrition grant per infant itself. 财税〔2008〕8号: maternity-insurance allowances
		// and subsidies are exempt from IIT: the offset lowers the taxable wage, the employer's substitute benefit is exempt
		// (DEFAULT: item 3 pays it under the maternity measure, so the exemption follows it).
		const ma = final ? s.pay.maternity : undefined;
		if (ma !== undefined) {
			const offset = -Math.min(ma.allowance, lines.BASIC ?? 0);
			if (!s.facts.siRegistered) {
				add('MATERNITY_ALLOWANCE_OFFSET', offset);
				add('MATERNITY_BENEFIT_EMPLOYER', ma.allowance + 1000 * (ma.infants ?? 1), false);
			} else if (ma.paidTo === 'WORKER') add('MATERNITY_ALLOWANCE_OFFSET', offset);
			else if (ma.allowance > (lines.BASIC ?? 0)) unpriced.push('MATERNITY_ALLOWANCE_EXCESS');
		}
	}

	// --- bonus (CN-N53.annual-bonus: contractual; paid, it is wages)
	if (s.pay.priorBonus !== undefined && s.pay.priorBonus.period === period) add('BONUS', s.pay.priorBonus.amount);
	const bonus = final ? s.pay.bonus : undefined;
	if (bonus !== undefined) {
		if (bonus.kind === 'BONUS') add('BONUS', bonus.amount); // CN-N10.ordinary-bonus-joins-wage
		else {
			// CN-N10.once-per-year, CN-KM-A1.once-per-year
			if (bonus.usedThisYear) return refusal('run', `${bonus.kind} already used this calendar year`);
			if (bonus.kind === 'ANNUAL_BONUS_SEPARATE' && !s.employee.taxResident)
				return refusal('run', 'the separate annual-bonus method is a resident election (MOF/STA 2023 No.30)');
			if (bonus.kind === 'MULTI_MONTH_NONRESIDENT' && s.employee.taxResident)
				return refusal('run', 'the multi-month bonus spread is a non-resident method (MOF/STA 2019 No.35)');
			// both separate methods sit on the ANNUAL_BONUS_SEPARATE class (CN-KM-A1 config_path); in the average, not IIT
			add('ANNUAL_BONUS_SEPARATE', bonus.amount, false);
		}
	}

	// --- untaxed subsidies — 国税发〔1994〕89号 item 2 (CN-N55.*): not of wage nature, not taxed; 误餐补助 only at the
	// finance standard for actual missed meals and 差旅费津贴 only for actual travel, otherwise wage income. The
	// only-child health fee (CN-KM38.health-fee, ≥ CNY10 a month) is an 独生子女补贴. DEFAULT: outside the average.
	for (const sub of final ? (s.pay.subsidies ?? []) : [])
		add(sub.code, sub.amount, !(UNTAXED_SUBSIDY.has(sub.code) && sub.qualifying), false);

	// --- contract claims settled this month (CN-N19, CN-N41): wage-nature income, taxed as wages (DEFAULT: the law is
	// silent on their IIT class; they are paid by reason of employment). Outside the average (DEFAULT: one-off claims).
	if (final && pt === undefined) {
		const c = s.contract;
		const wage = s.employment.monthlyWage;
		// LCL art.82 para.1 and Regulation arts.6–7 (CN-N19.written-contract-double-wage, CN-N12.no-written-contract,
		// CN-N41.no-written-contract-double-wage): from the day after the first month to the day before signing, at most
		// 11 months. DEFAULT part month: paid days ÷ 21.75 (CN-N02).
		if (c?.signedDate !== undefined) {
			const from = firstDayAfterFirstMonth(s.employment.hireDate);
			const to = c.signedDate === null ? last : addDays(c.signedDate, -1);
			const months = Math.min(11, monthsOf(from, to));
			if (months > 0) add('NO_WRITTEN_CONTRACT_WAGE', wage * months, true, false);
		}
		// LCL arts.14, 82 para.2 (CN-N41.open-ended-second-wage): a second wage from the day it was due, no cap.
		if (c?.openEndedDueDate !== undefined) {
			const to = c.openEndedConcludedDate == null ? last : addDays(c.openEndedConcludedDate, -1);
			const months = monthsOf(c.openEndedDueDate, to);
			if (months > 0) add('OPEN_ENDED_CONTRACT_WAGE', wage * months, true, false);
		}
		// LCL arts.19, 70, 83 (CN-N19.probation-limits, CN-N12.probation, CN-N41.probation-*, CN-N27.no-probation):
		// probation served beyond the limit is paid at the post-probation wage.
		if (c?.probation !== undefined) {
			const p = c.probation;
			const term = p.termMonths;
			const allowed = p.partTime || (term !== null && term < 3) ? 0 : term === null || term >= 36 ? 6 : term >= 12 ? 2 : 1;
			const excess = Math.max(0, p.servedMonths - allowed);
			if (excess > 0) add('PROBATION_EXCESS_DAMAGES', wage * excess, true, false);
		}
	}

	// --- social insurance
	let employeeShares = 0;
	const employed = s.employment.hireDate <= last && (s.employment.exitDate ?? '9999') >= first;
	// DEFAULT: a month employed on any day is a contribution month on the full declared base (Social Insurance Law art.58;
	// law silent on part months). Missing enrolment, a signed waiver or probation do not remove the premium
	// (CN-N07.unregistered-still-assessed, CN-KM28.unenrolled-still-assessed, CN-KM28.no-excuse-grounds,
	// CN-N37.si-waiver-void). Age alone does not end coverage (CN-N13.coverage-during-delay); a pension recipient is
	// outside (CN-N13.pensioned-retiree). A foreign worker is insured like anyone (CN-N25.ordinary-social-insurance),
	// except schemes a bilateral-agreement certificate exempts (CN-N25.treaty-exemption); HK/Macao/Taiwan residents are
	// insured at ordinary rates (CN-N48).
	const retired = s.employee.pensionRecipient === true;
	const exempt = new Set(s.facts.treatyExempt ?? []);
	if (employed && pt === undefined && !retired) {
		const declared = s.facts.siBase ?? s.employment.monthlyWage;
		const charge = (scheme: SiScheme, rates: { employer: number; employee: number }) => {
			if (exempt.has(scheme)) return;
			const base = clamp(declared, siBounds(scheme, first));
			bases[scheme] = base;
			const employee = fen(base * rates.employee);
			const employer = fen(base * rates.employer);
			if (employee !== 0) lines[`${scheme}.employee`] = employee;
			if (employer !== 0) lines[`${scheme}.employer`] = employer;
			employeeShares += employee;
		};
		charge('PENSION', RATE.PENSION); // CN-N07.pension
		charge('MEDICAL', RATE.MEDICAL); // CN-N07.medical
		charge('MATERNITY', RATE.MATERNITY); // CN-N07.maternity
		const u = unemploymentRates(first, s); // CN-N07.unemployment
		if (u === undefined) unpriced.push('UNEMPLOYMENT.employee', 'UNEMPLOYMENT.employer');
		else charge('UNEMPLOYMENT', u);
		charge('INJURY', { employer: s.facts.injuryRate, employee: 0 }); // CN-N07.work-injury
		// CN-KM04.major-medical-employer / major-medical-worker: no verified 2026 figure or agency original — not judged.
		unpriced.push('major-medical');
	}
	// Non-full-time: employer-only injury insurance (CN-KM14.all-employees-employer-only, CN-N27.injury-cover); base
	// unsourced. Managed post-age workers from 1 Jul 2026 (CN-N14.work-injury-cover): employer-only injury, unsourced.
	if (employed && pt !== undefined) unpriced.push('INJURY.employer');
	if (employed && retired && first >= '2026-07-01') unpriced.push('INJURY.employer');

	// --- housing fund (CN-KM05, CN-KM18, CN-KM20, CN-N08). Retirees do not contribute (CN-KM18.retirees); HK/Macao/
	// Taiwan workers and foreigners by participation (CN-KM18.optional-participants) — `fundRate: null` is outside.
	const rate = s.facts.fundRate;
	if (employed && pt === undefined && !retired && rate !== null) {
		// CN-KM21.eligibility-and-approvals: below 5% only by approval; CN-KM05.rate-5-12, CN-KM20.uniform-unit-rate
		if (rate < 0.05) return refusal('input', `fund rate ${rate} below 5% needs fund-centre approval`);
		if (rate > 0.12) return refusal('input', `fund rate ${rate} above the 12% maximum`);
		const hireMonth = s.employment.hireDate.slice(0, 7);
		// CN-KM20.first-ever-joining-month / first-ever-second-month (CN-N08.first-ever-second-month): nothing in the
		// joining month, then that month's wage; CN-KM20.transferred-first-month (CN-N08.transferred-first-month): the
		// full monthly wage from the first month; CN-KM20.existing-worker-base (CN-N08.existing-worker-base): the prior
		// calendar-year monthly average, declared.
		if (!(s.facts.fundAccount === 'FIRST_EVER' && hireMonth === period)) {
			const declared =
				s.facts.fundAccount === 'EXISTING'
					? (s.facts.fundBase ?? s.employment.monthlyWage)
					: contractWageOn(s, last);
			const base = clamp(declared, fundBounds(first, s.employment.wageRegion));
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
		const avg = average12(s, history, period);
		if (pt === undefined) {
			const due = severanceDue(s, avg, history.get(addMonths(period, -1)) ?? s.employment.monthlyWage);
			if (due > 0) add('SEVERANCE_PAY', due, false, false);
		}
		// Annual-leave cash on exit (CN-N05.*, CN-N06.unused-on-exit-300, CN-N18.exit-entitlement, CN-N06.no-clawback,
		// CN-N18.no-clawback): floor(days at the employer this year ÷ 365 × full-year days) − days taken, never below 0,
		// at a further 200% of the day wage (12-month average excluding overtime ÷ 21.75, CN-N06.day-wage-twelve-month-
		// average). Bands on cumulative service with every employer (CN-N05.prior-employer-service): ≥12 months 5, ≥120 10,
		// ≥240 15 (DEFAULT: the band at the exit day, the recorded mid-year crossing default). Qualification from the day
		// twelve months complete (CN-N05.qualifying-twelve-months recorded default), so the year counts from that day.
		if (pt === undefined) {
			const prior = s.employee.priorServiceMonths ?? 0;
			const service = prior + monthsBetween(s.employment.hireDate, exitDay);
			if (service >= 12) {
				const full = service >= 240 ? 15 : service >= 120 ? 10 : 5;
				const qualified = prior >= 12 ? s.employment.hireDate : addMonthsToDate(s.employment.hireDate, 12 - prior);
				const yearStart = max(`${exitDay.slice(0, 4)}-01-01`, qualified);
				const days = (ms(exitDay) - ms(yearStart)) / 86_400_000 + 1;
				const owed = Math.max(0, Math.floor((days / 365) * full + 1e-9) - (e.leaveTakenThisYear ?? 0));
				if (owed > 0) add('LEAVE_ENCASHMENT', fen(owed * (avg / 21.75) * 2), true, false);
			}
		}
		// Retirement lump sums (CN-N39.early-retirement, CN-N39.internal-retirement): taxed apart below.
		if (s.pay.earlyRetirement) add('EARLY_RETIREMENT_SUBSIDY', s.pay.earlyRetirement.amount, false, false);
		// Final pay within five working days after the end — 昆明市工资支付条例 art.13 (CN-KM-WP06.five-working-days); the
		// run pays on the period's last day (DEFAULT), so a deadline before it is reported.
		if (addWorkingDays(exitDay, 5) < last) warnings.push('final pay|five working days');
	}
	if (final && s.pay.internalRetirement) add('INTERNAL_RETIREMENT_SUBSIDY', s.pay.internalRetirement.amount, false, false);
	return { lines, bases, wageIncome, averageWage, employeeShares, warnings, unpriced };
}

const addWorkingDays = (d: string, n: number) => {
	let day = d;
	while (n > 0) {
		day = addDays(day, 1);
		if (isPaidDay(day)) n--;
	}
	return day;
};
const addMonthsToDate = (d: string, n: number) => {
	const [y, m, dd] = d.split('-').map(Number);
	return iso(Date.UTC(y!, m! - 1 + n, dd!));
};
/** The day after the first month of employment (LCL art.82: 自用工之日起超过一个月): hire 1 Jan → 1 Feb. */
const firstDayAfterFirstMonth = (hire: string) => addMonthsToDate(hire, 1);
/** Whole months in [from, to] plus a part month by paid days ÷ 21.75 (CN-N02 default). */
function monthsOf(from: string, to: string) {
	if (from > to) return 0;
	const whole = monthsBetween(from, to);
	const rest = addMonthsToDate(from, whole);
	return whole + (rest <= to ? paidDays(rest, to) / 21.75 : 0);
}

/** Whole calendar months from `from` to `to` inclusive of the last day (hire 16th, exit 15th six months on = 6). */
export function monthsBetween(from: string, to: string) {
	const end = addDays(to, 1);
	const [fy, fm, fd] = from.split('-').map(Number);
	const [ty, tm, td] = end.split('-').map(Number);
	return (ty! - fy!) * 12 + (tm! - fm!) - (td! < fd! ? 1 : 0);
}

/** LCL art.47 (CN-N12.service-year-severance, CN-N41.severance-whole-years / six-to-twelve-months / under-six-months):
 * one month per full year; a remainder of six months or more counts a year, under six months (days included) half a
 * month. Monthly wage: the 12-month average of the wage due, not below the local minimum (Regulation art.27,
 * CN-N19.severance-wage-base). Above 3× the declared local average monthly wage the wage is capped at 3× and the
 * years at 12 (CN-N12.high-earner-cap). Art.87 doubles it, counted from hire (Regulation art.25; CN-N12.unlawful-
 * termination, CN-N41.art87-double). Art.40 adds one month in lieu of 30 days' notice at the previous month's wage
 * (Regulation art.20; CN-N12.termination-notice, CN-N41.art40-notice-or-pay, CN-SH-A2.art20-previous-month). Paid on
 * mutual termination proposed by the employer, arts.40/41, unlawful termination, and fixed-term expiry unless an equal or
 * better renewal was refused (LCL art.46; CN-N41.fixed-term-expiry); not on resignation or art.39 misconduct, nor to
 * non-full-time workers (LCL art.71, CN-N27.termination-without-compensation). Service before 1 Jan 2008 is compensated
 * under the rules then in force — a declared amount — and art.47 years count from 2008 (LCL art.97); service transferred
 * for non-worker reasons joins (Regulation art.10) — declared months. */
export function severanceDue(s: Scenario, average: number, previousMonth: number) {
	const e = s.exit!;
	const unlawful = e.cause === 'UNLAWFUL';
	const pays =
		e.cause === 'MUTUAL_EMPLOYER' ||
		e.cause === 'ART40' ||
		e.cause === 'ART41' ||
		unlawful ||
		(e.cause === 'EXPIRY' && !e.renewalOfferRefused);
	if (!pays) return 0;
	const hire = s.employment.hireDate;
	const exit = s.employment.exitDate!;
	const from = unlawful || hire >= '2008-01-01' ? hire : '2008-01-01';
	const months = monthsBetween(from, exit) + (e.transferredServiceMonths ?? 0);
	const years = Math.floor(months / 12);
	const rem = months % 12;
	const partTail = remainderDays(from, exit, months - (e.transferredServiceMonths ?? 0));
	let n = years + (rem >= 6 ? 1 : rem > 0 || partTail ? 0.5 : 0);
	let avg = Math.max(average, minimumWage(exit, s.employment.wageRegion).monthly);
	const cap = 3 * e.localAverageMonthlyWage;
	if (avg > cap) {
		avg = cap;
		n = Math.min(n, 12);
	}
	let due = n * avg * (unlawful ? 2 : 1);
	if (!unlawful && hire < '2008-01-01') due += e.pre2008Compensation ?? 0;
	if (e.cause === 'ART40' && (e.noticeDaysGiven ?? 0) < 30) due += previousMonth;
	return fen(due);
}
/** true when days remain after the whole months of [from, to] */
const remainderDays = (from: string, to: string, whole: number) => addMonthsToDate(from, whole) <= to;

// ---------------------------------------------------------------------------------------------------------------
/** The expected payslip for the scenario's `period`, having run every month from `runsFrom` (cumulative IIT). */
export function computePayslip(s: Scenario): Payslip {
	const none = (refused: Payslip['refused']): Payslip => ({ refused, lines: {}, bases: {}, warnings: [], unpriced: [] });
	// 禁止使用童工规定 arts.2, 4 (CN-N29.under-16-ban): no one under 16 may be recruited.
	if (ageOn(s.employee.birthDate, s.employment.hireDate) < 16)
		return none({ stage: 'input', reason: 'under 16 (child labour prohibited)' });

	const year = s.period.slice(0, 4);
	const history = new Map<string, number>();
	let cumIncome = 0;
	let cumShares = 0;
	let cumSpecial = 0;
	let cumPension = 0;
	let cumOther = 0;
	let cumWithheld = 0;
	let monthsEmployed = 0;
	let out: Month | undefined;
	for (let p = s.runsFrom; p <= s.period; p = nextPeriod(p)) {
		const final = p === s.period;
		const m = month(s, p, final, history);
		if (m.refused) return none(m.refused);
		history.set(p, m.averageWage);
		if (p.slice(0, 4) === year && s.employment.hireDate <= monthEnd(p)) monthsEmployed++;
		let iit = 0;
		if (s.employee.taxResident) {
			// Resident cumulative withholding — STA 2018 No.61 art.6 (CN-N09.resident-cumulative, CN-N38.resident-annual-
			// table); a negative balance withholds nothing, no payroll refund (CN-N09.no-payroll-refund).
			const special = specialMonthly(s, p);
			if (typeof special === 'string') return none({ stage: 'input', reason: special });
			cumIncome += m.wageIncome;
			cumShares += m.employeeShares;
			cumSpecial += special;
			// MOF/STA 2024 No.21 (CN-N43.personal-pension): vouchers deductible to CNY12,000 a year.
			cumPension = Math.min(12000, cumPension + (s.tax.personalPensionMonthly ?? 0));
			// 财税〔2017〕39号 (CN-N43.commercial-health-insurance): CNY200 a month.
			cumOther += Math.min(200, s.tax.commercialHealthMonthly ?? 0);
			const monthNo = Number(p.slice(5, 7));
			// Basic deduction 5,000 × months at this unit this year; STA 2020 No.13 (CN-N44.first-wage-mid-year) first wage
			// income this year → 5,000 × months from January; STA 2020 No.19 (CN-N11) election → 60,000 from January.
			const basic = s.tax.basic60kElection ? 60000 : s.tax.firstIncomeThisYear ? 5000 * monthNo : 5000 * monthsEmployed;
			const taxable = fen(cumIncome - cumShares - basic - cumSpecial - cumPension - cumOther);
			const cumTax = fen(onTable(ANNUAL, taxable));
			iit = Math.max(0, fen(cumTax - cumWithheld));
			cumWithheld = fen(cumWithheld + iit);
		} else {
			// Non-resident: (month's wage − 5,000) on the monthly table, no SI/fund relief (IIT Law art.6(2);
			// CN-N09.non-resident-monthly, CN-N38.non-resident-monthly-table). China-source wage by China workdays ÷ calendar
			// days where declared (MOF/STA 2019 No.35 item 2, CN-N45.workday-apportionment; all pay from this employer).
			const days = s.employee.chinaWorkDays;
			const calendar = Number(monthEnd(p).slice(8));
			const wage = days === undefined ? m.wageIncome : (m.wageIncome * days) / calendar;
			iit = fen(onTable(MONTHLY, fen(wage - 5000)));
		}
		if (iit > 0) m.lines['IIT.employee'] = iit;
		if (final) out = m;
	}
	const m = out!;
	const wageThisMonth = m.wageIncome;
	// Separate bonus taxes: resident ÷ 12 (MOF/STA 2023 No.30; CN-N10.separate-election); non-resident multi-month
	// [(bonus ÷ 6) × rate − QD] × 6 (MOF/STA 2019 No.35 item 3(2); CN-KM-A1.six-month-spread).
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
	// 财税〔2018〕164号 item 5(1) (CN-N39.termination-lump-sum): exempt to 3 × the local prior-year average annual wage, the
	// excess alone on the annual table. DEFAULT (CN-N39): the same declared average as art.47.
	const severance = m.lines.SEVERANCE_PAY ?? 0;
	if (severance > 0) {
		const tax = fen(onTable(ANNUAL, fen(severance - 36 * s.exit!.localAverageMonthlyWage)));
		if (tax > 0) m.lines['IIT_SEVERANCE.employee'] = tax;
	}
	// 164号 item 5(2) (CN-N39.early-retirement): (lump ÷ years to statutory age − 60,000) on the annual table × years.
	const early = s.pay.earlyRetirement;
	if (early !== undefined) {
		const tax = fen(onTable(ANNUAL, early.amount / early.yearsToStatutoryAge - 60000) * early.yearsToStatutoryAge);
		if (tax > 0) m.lines['IIT_EARLY_RETIREMENT.employee'] = tax;
	}
	// 164号 item 5(3) with 国税发〔1999〕58号 art.1 (CN-N39.internal-retirement): lump ÷ months to statutory age + the month's
	// wage − the 5,000 deduction sets the monthly-table rate; the tax is (wage + lump − 5,000) × rate − QD. DEFAULT (law
	// silent under cumulative withholding): the wage keeps its own IIT line, and IIT_INTERNAL_RETIREMENT is that total less
	// the same method's tax on the wage alone.
	const internal = s.pay.internalRetirement;
	if (internal !== undefined) {
		const [, rate, qd] = band(MONTHLY, internal.amount / internal.monthsToStatutoryAge + wageThisMonth - 5000);
		const total = Math.max(0, (wageThisMonth + internal.amount - 5000) * rate - qd);
		const tax = fen(total - onTable(MONTHLY, wageThisMonth - 5000));
		if (tax > 0) m.lines['IIT_INTERNAL_RETIREMENT.employee'] = tax;
	}

	const pay = Object.entries(m.lines).filter(([k]) => !k.includes('.') && !POST_TAX.has(k));
	const gross = fen(pay.reduce((a, [, v]) => a + v, 0));
	// Post-tax deductions. Court-ordered 抚养费/赡养费 as ordered (劳部发〔1994〕489号 art.15, 昆明市工资支付条例 art.16;
	// CN-N04.lawful-deductions, CN-KM-WP09.court-ordered-support). Loss the worker caused (489号 art.16, 条例 art.29;
	// CN-N04.employee-loss-deduction-cap, CN-KM-WP16.*): at most 20% of the month's wage, and what remains may not fall
	// below the local monthly minimum. DEFAULT: "the month's wage" is the month's gross pay.
	if (s.pay.courtOrder) m.lines.COURT_ORDERED_SUPPORT = -fen(s.pay.courtOrder);
	if (s.pay.lossClaim) {
		const floor = floorOn(s, max(monthStart(s.period), s.employment.hireDate)).monthly;
		const allowed = fen(Math.max(0, Math.min(s.pay.lossClaim, 0.2 * gross, gross - floor)));
		if (allowed > 0) m.lines.LOSS_RECOVERY = -allowed;
	}
	const deductions = fen(
		Object.entries(m.lines)
			.filter(([k]) => k.endsWith('.employee') || POST_TAX.has(k))
			.reduce((a, [, v]) => a + Math.abs(v), 0)
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
