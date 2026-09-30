/**
 * Deterministic synthetic MY scenarios for the independent oracle (`tests/e2e/oracle/MY.ts`).
 *
 * Every scenario names the tracker rows (`docs/inventory/malaysia.csv`) and branch it exercises as `ROW:branch`.
 * Shape: one company, one employment, one run period — the probe harness's case (`tests/e2e/payroll-probe.ts`):
 * `employer` → the harness company, `employee`/`employment` → the employee and employment rows, `inputs` → leave,
 * work-day, ad hoc and exit rows, `period` → the run. Periods are chosen so the law's year-to-date inputs are empty:
 *   - 2026-01 (n = 11): long-serving employees, first month of the tax year, before SKBBK;
 *   - 2026-08 (n = 4): employees who joined on or after 1 August 2026 in their first job of the year (no TP3), with SKBBK;
 *   - other months (M–T groups): joiners on the 1st of the period, so the only year-to-date figures are an explicit TP3.
 * Ages are whole years on the period's first day and no birthday falls inside the period month, so a threshold age is
 * the same on every day of the month (the law's "attained the age" then has one answer).
 * No Math.random: a seeded mulberry32 picks only cosmetic values (birth day of month, names).
 */
import type { Citizenship, ExitCause, HrdClass, Scenario } from '../oracle/MY';

function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const JAN = '2026-01';
const AUG = '2026-08';
const MAY = '2026-05';
const JUN = '2026-06';
const pad = (n: number) => String(n).padStart(2, '0');

export function generateProfiles(): Scenario[] {
	const rnd = mulberry32(20260930);
	const out: Scenario[] = [];
	const ids = new Set<string>();

	/** a birth date giving `age` on the period's first day, birthday outside the period month */
	const birthFor = (age: number, period: string) => {
		const [y, pm] = period.split('-').map(Number) as [number, number];
		const bm = pm <= 6 ? pm + 5 : pm - 5;
		const by = bm > pm ? y - age - 1 : y - age;
		return `${by}-${pad(bm)}-${pad(10 + Math.floor(rnd() * 15))}`;
	};

	type Opts = {
		period?: string;
		hrd?: HrdClass;
		age?: number;
		citizenship?: Citizenship;
		taxResidency?: Scenario['employee']['taxResidency'];
		taxCategory?: 1 | 2 | 3;
		children?: number;
		socsoFirstLiableAge?: number;
		eisPaidBefore57?: boolean;
		hireDate?: string;
		exitDate?: string;
		exitCause?: ExitCause;
		noticeServed?: boolean;
		contractDays?: number;
		basic?: number;
		hourlyRate?: number;
		normalHours?: number;
		fixedAllowance?: number;
		partTime?: boolean;
		inputs?: Scenario['inputs'];
		employer?: Partial<Scenario['employer']>;
		skbbkReleased?: boolean;
		presence?: Scenario['employee']['presence'];
		tp3?: Scenario['employee']['tp3'];
		daily?: { rate: number; days: number; perWeek: 4 | 5 | 6 };
		rateChange?: Scenario['employment']['rateChange'];
	};
	const add = (id: string, rows: string[], description: string, o: Opts = {}) => {
		if (ids.has(id)) throw new Error(`duplicate scenario id ${id}`);
		ids.add(id);
		const period = o.period ?? JAN;
		const citizenship = o.citizenship ?? 'CITIZEN';
		out.push({
			id: `MY-oracle-${id}`,
			profile: 'MY',
			rows,
			description,
			period,
			employer: { hrd: o.hrd ?? 'COMPULSORY', ...o.employer },
			employee: {
				birthDate: birthFor(o.age ?? 35, period),
				citizenship,
				taxResidency: o.taxResidency ?? (citizenship === 'FOREIGNER' ? 'NON_RESIDENT' : 'RESIDENT'),
				taxCategory: o.taxCategory ?? 1,
				children: o.children ?? 0,
				...(o.socsoFirstLiableAge === undefined ? {} : { socsoFirstLiableAge: o.socsoFirstLiableAge }),
				eisPaidBefore57: o.eisPaidBefore57 ?? true,
				...(o.skbbkReleased ? { skbbkReleased: true } : {}),
				...(o.presence ? { presence: o.presence } : {}),
				...(o.tp3 ? { tp3: o.tp3 } : {})
			},
			employment: {
				hireDate: o.hireDate ?? (period === JAN ? '2020-01-01' : `${period}-01`),
				...(o.exitDate ? { exitDate: o.exitDate, exitCause: o.exitCause ?? 'RESIGNATION' } : {}),
				...(o.noticeServed === undefined ? {} : { noticeServed: o.noticeServed }),
				...(o.contractDays === undefined ? {} : { contractDays: o.contractDays }),
				basis: o.daily ? 'DAILY' : o.hourlyRate === undefined ? 'MONTHLY' : 'HOURLY',
				...(o.daily
					? { dailyRate: o.daily.rate, daysWorked: o.daily.days, workDaysPerWeek: o.daily.perWeek }
					: o.hourlyRate === undefined
						? { monthlyBasic: o.basic ?? 3000 }
						: { hourlyRate: o.hourlyRate }),
				...(o.rateChange ? { rateChange: o.rateChange } : {}),
				normalHours: o.normalHours ?? 8,
				...(o.fixedAllowance ? { fixedAllowance: o.fixedAllowance } : {}),
				...(o.partTime ? { partTime: true } : {})
			},
			inputs: o.inputs ?? {}
		});
	};
	const key = (w: number) => String(w).replace('.', '_');

	// ---- A. Citizen wage seams, January (EPF Part A table, SOCSO/EIS rows and ceilings, PCB Table 1 bands, HRD 1%) ----
	const seams = [
		1700, 1700.01, 1720, 1720.01, 2000, 2600, 2999.99, 3000, 3000.01, 3020, 3500, 4000, 4979.99, 4980, 4999.99, 5000,
		5000.01, 5099.99, 5100, 5100.01, 5500, 5900, 5999.99, 6000, 6000.01, 6100, 7777.77, 8000, 10000, 12200, 15000,
		19999.99, 20000, 20000.01, 20100, 25000, 35000, 60000, 100000, 180000
	];
	for (const w of seams)
		add(`A-${key(w)}`, [
			'MY-EPF-01:partA-band', w > 20000 ? 'MY-EPF-01:over-20000-percentage' : 'MY-EPF-01:partA-table',
			'MY-SOCSO-01:first-category-row', w > 6000 ? 'MY-SOCSO-01:ceiling' : 'MY-SOCSO-01:table',
			'MY-EIS-01:row', 'MY-PCB-01:resident-normal', 'MY-PCB-01:table1-band', 'MY-HRD-02:compulsory-1pct',
			'MY-WAGEBASE-01:basic'
		], `citizen aged 35, RM${w} full month, January`, { basic: w });

	// ---- B. Same seams in August: SKBBK First Phase, n = 4 ----
	for (const w of [1700, 2999.99, 3000, 3000.01, 5000, 5000.01, 5999.99, 6000, 6000.01, 8000, 12000, 20000.01])
		add(`B-${key(w)}`, [
			'MY-SKBBK-01:first-phase-employee', 'MY-SKBBK-04:deemed-participant', 'MY-SOCSO-01:first-category-row',
			'MY-EIS-01:row', 'MY-EPF-01:partA-band', 'MY-PCB-01:resident-normal-n4', 'MY-HRD-02:compulsory-1pct'
		], `citizen joined 1 August 2026, RM${w}`, { period: AUG, basic: w });
	add('B-may-no-skbbk', ['MY-SKBBK-01:before-first-month'], 'May 2026: no SKBBK yet', { period: MAY, basic: 3000 });
	add('B-june-first-skbbk', ['MY-SKBBK-01:first-contribution-month'], 'June 2026: first SKBBK month', { period: JUN, basic: 3000 });

	// ---- C. Permanent residents: EPF Part A under 60, Part C at 60+; SOCSO/EIS as a local; no HRD levy ----
	for (const [age, w] of [[35, 3000], [35, 5000.01], [59, 3000], [59, 8000], [60, 3000], [60, 5000], [60, 5000.01], [60, 8000], [61, 4000], [61, 25000], [74, 3000], [75, 3000]] as const)
		add(`C-pr-${age}-${key(w)}`, [
			age >= 60 && age < 75 ? 'MY-EPF-TRANS-02:partC-pr-60plus' : age < 60 ? 'MY-EPF-01:partA-pr' : 'MY-EPF-01:no-epf-75',
			'MY-HRD-01:pr-outside-levy', age >= 60 ? 'MY-SOCSO-01:second-category-60' : 'MY-SOCSO-01:first-category-row',
			age >= 60 ? 'MY-EIS-01:excluded-60' : 'MY-EIS-01:pr-covered'
		], `permanent resident aged ${age}, RM${w}`, { citizenship: 'PERMANENT_RESIDENT', age, basic: w });

	// ---- D. Citizen age thresholds ----
	for (const age of [59, 60, 61])
		for (const w of [3000, 7000]) {
			add(`D-age-${age}-${w}`, [
				age < 60 ? 'MY-EPF-01:partA-under-60' : 'MY-EPF-01:partE-60plus',
				age < 60 ? 'MY-SOCSO-01:first-category-row' : 'MY-SOCSO-01:second-category-60',
				age < 60 ? 'MY-EIS-01:row' : 'MY-EIS-01:excluded-60', 'MY-RET-01:age-60-boundary'
			], `citizen aged ${age}, RM${w}, January`, { age, basic: w });
			add(`D-age-${age}-${w}-aug`, [
				'MY-SKBBK-04:no-age-limit', age < 60 ? 'MY-SKBBK-01:first-category' : 'MY-SKBBK-01:second-category',
				age < 60 ? 'MY-EPF-01:partA-under-60' : 'MY-EPF-01:partE-60plus'
			], `citizen aged ${age}, RM${w}, August`, { period: AUG, age, basic: w });
		}
	for (const age of [74, 75, 76])
		add(`D-age-${age}`, [age < 75 ? 'MY-EPF-01:partE-74' : 'MY-EPF-01:no-epf-75', 'MY-SOCSO-01:second-category-60'],
			`citizen aged ${age}, RM3,000`, { age, basic: 3000 });
	for (const age of [17, 18, 19])
		add(`D-eis-${age}`, [age < 18 ? 'MY-EIS-01:excluded-under-18' : 'MY-EIS-01:covered-18', 'MY-EPF-01:partA-band'],
			`citizen aged ${age}, RM1,800`, { age, basic: 1800 });
	for (const age of [56, 57, 58])
		for (const before of [true, false])
			add(`D-eis57-${age}-${before ? 'prior' : 'first'}`, [
				age >= 57 && !before ? 'MY-EIS-01:first-contribution-57-excluded' : 'MY-EIS-01:covered',
				'MY-SOCSO-01:first-category-row'
			], `citizen aged ${age}, ${before ? 'EIS paid before 57' : 'no EIS ever paid'}, RM4,000`,
			{ age, basic: 4000, eisPaidBefore57: before });
	for (const first of [54, 55, 56])
		for (const period of [JAN, AUG])
			add(`D-socso55-${first}-${period}`, [
				first >= 55 ? 'MY-SOCSO-01:first-liable-55-second-category' : 'MY-SOCSO-01:first-category-row',
				period === AUG ? 'MY-SKBBK-01:second-category-share' : 'MY-SOCSO-01:employment-injury-only'
			], `citizen aged 58, first SOCSO-liable at ${first}, RM3,500`,
			{ period, age: 58, basic: 3500, socsoFirstLiableAge: first });

	// ---- E. Foreign workers: EPF Part F, SOCSO first category, no EIS/HRD, PCB 30% or resident on a 182-day contract ----
	for (const w of [1700, 3000, 3000.01, 5000.01, 8000, 25000])
		for (const period of [JAN, AUG])
			add(`E-fw-${key(w)}-${period}`, [
				'MY-EPF-03:partF-total-rounding', 'MY-EPF-01:partF', 'MY-SOCSO-01:foreign-first-category',
				'MY-EIS-01:foreign-excluded', 'MY-HRD-01:non-citizen-outside-levy', 'MY-PCB-07:flat-30pct',
				...(period === AUG ? ['MY-SKBBK-04:foreign-mandatory'] : [])
			], `non-resident foreign worker, RM${w}`, { period, citizenship: 'FOREIGNER', basic: w });
	for (const [days, res] of [[181, 'NON_RESIDENT'], [182, 'NON_RESIDENT'], [182, ''], [365, 'NON_RESIDENT']] as const)
		add(`E-fw-contract-${days}-${res || 'unknown'}`, [
			days >= 182 ? 'MY-PCB-06:foreign-182-day-contract-resident' : 'MY-PCB-06:181-day-non-resident',
			'MY-EPF-03:partF-total-rounding'
		], `foreign worker, ${days}-day contract, tax residence ${res || 'unrecorded'}, RM5,001`,
		{ citizenship: 'FOREIGNER', taxResidency: res, contractDays: days, basic: 5001 });
	add('E-fw-unknown-residence', ['MY-PCB-06:unknown-residence-30pct'], 'foreign worker, residence unrecorded, open-ended',
		{ citizenship: 'FOREIGNER', taxResidency: '', basic: 5001 });
	add('E-citizen-non-resident', ['MY-PCB-07:flat-30pct', 'MY-PCB-06:recorded-non-resident'], 'citizen recorded non-resident',
		{ taxResidency: 'NON_RESIDENT', basic: 5001 });
	for (const age of [74, 75, 76])
		add(`E-fw-age-${age}`, [age < 75 ? 'MY-EPF-03:partF-74' : 'MY-EPF-01:no-epf-75-foreigner', 'MY-SOCSO-01:second-category-60'],
			`foreign worker aged ${age}, RM3,000`, { citizenship: 'FOREIGNER', age, basic: 3000 });
	for (const w of [3000, 6000])
		add(`E-fw-bonus-${w}`, ['MY-EPF-03:partF-bonus', 'MY-WAGEBASE-01:bonus-epf-only', 'MY-PCB-07:flat-30pct'],
			`foreign worker RM${w} + RM3,000 annual bonus`, { citizenship: 'FOREIGNER', basic: w, inputs: { annualBonus: 3000 } });

	// ---- F. PCB categories, children, zakat ----
	for (const w of [5000, 8000, 12000])
		for (const [cat, kids] of [[1, 0], [2, 0], [2, 1], [2, 3], [3, 1], [3, 2]] as const)
			add(`F-cat${cat}-${kids}-${w}`, ['MY-PCB-02:category-' + cat, kids ? 'MY-PCB-02:child-relief' : 'MY-PCB-02:no-children', 'MY-PCB-01:table1-band'],
				`resident category ${cat}, ${kids} children, RM${w}`, { basic: w, taxCategory: cat, children: kids });
	for (const w of [2500, 3500, 3990, 4000])
		add(`F-rm10-${w}`, ['MY-PCB-01:rm10-minimum', 'MY-PCB-01:rebate-band'], `resident single RM${w} near the RM10 floor`, { basic: w });
	for (const [w, z] of [[5000, 50], [5000, 200], [8000, 100], [3990, 5]] as const)
		add(`F-zakat-${w}-${z}`, ['MY-PCB-02:zakat-netted', 'MY-PCB-01:zakat-below-mtd'], `resident RM${w}, zakat RM${z}`,
			{ basic: w, inputs: { zakat: z } });

	// ---- G. EA s.18A proration ----
	for (const day of [1, 2, 15, 31])
		add(`G-join-aug-${day}`, [day === 1 ? 'MY-EA11:full-month' : 'MY-EA11:s18A-a-joiner', 'MY-PCB-01:joiner-n4'],
			`joined ${day} August 2026, RM3,100`, { period: AUG, hireDate: `2026-08-${pad(day)}`, basic: 3100 });
	for (const day of [1, 15, 30, 31])
		add(`G-leave-aug-${day}`, ['MY-EA11:s18A-b-leaver', 'MY-EA12:final-pay', 'MY-PCB-01:leaver-month'],
			`joined 1 August, resigned effective ${day} August 2026, RM3,100`,
			{ period: AUG, basic: 3100, exitDate: `2026-08-${pad(day)}`, exitCause: 'RESIGNATION' });
	for (const days of [1, 5, 10])
		add(`G-unpaid-${days}`, ['MY-EA11:s18A-c-unpaid-leave', 'MY-EPF-01:partA-band'],
			`${days} unpaid leave days in January, RM3,100`, { basic: 3100, inputs: { unpaidLeaveDays: days } });
	add('G-join-unpaid', ['MY-EA11:s18A-a-and-c'], 'joined 10 August with 2 unpaid days', { period: AUG, hireDate: '2026-08-10', basic: 3100, inputs: { unpaidLeaveDays: 2 } });

	// ---- H. Overtime, rest day, holiday (EA ss.60, 60A(3), 60D(3), 60I) ----
	for (const w of [2600, 3000, 7000]) {
		for (const h of [1, 2, 10])
			add(`H-ot-${w}-${h}`, ['MY-EA31:ordinary-day-1_5x', 'MY-EA36:monthly-orp-26', 'MY-WAGEBASE-01:overtime-ss-not-epf', 'MY-HRDA02:overtime-outside'],
				`RM${w}, ${h} h overtime on a normal day`, { basic: w, inputs: { overtimeHours: h, overtimeDate: '2026-01-06' } });
		for (const h of [2, 4, 5, 8, 10])
			add(`H-rest-${w}-${h}`, [h <= 4 ? 'MY-EA30:rest-half-orp' : 'MY-EA30:rest-one-orp', ...(h > 8 ? ['MY-EA30:rest-beyond-2x'] : []), 'MY-EA36:monthly-orp-26'],
				`RM${w}, ${h} h on the rest day`, { basic: w, inputs: { restDayHours: h, restDayDate: '2026-01-04' } });
		for (const h of [1, 8, 11])
			add(`H-hol-${w}-${h}`, ['MY-EA32:holiday-two-days', ...(h > 8 ? ['MY-EA32:holiday-beyond-3x'] : []), 'MY-PEN-HOL-01:national-day', 'MY-WAGEBASE-01:holiday-pay-epf'],
				`RM${w}, ${h} h on National Day 31 August 2026`, { period: AUG, basic: w, inputs: { holidayHours: h, holidayDate: '2026-08-31' } });
	}
	add('H-allowance-orp', ['MY-EA36:fixed-allowance-in-orp', 'MY-EA31:ordinary-day-1_5x', 'MY-HRDA02:fixed-allowance-inside'],
		'RM2,600 + RM260 fixed allowance, 2 h overtime', { basic: 2600, fixedAllowance: 260, inputs: { overtimeHours: 2, overtimeDate: '2026-01-06' } });
	add('H-7h-normal-rest', ['MY-EA30:normal-hours-7', 'MY-EA36:hourly-rate'], '7 h normal day, 4 h rest day (more than half)',
		{ basic: 3000, normalHours: 7, inputs: { restDayHours: 4, restDayDate: '2026-01-04' } });

	// ---- I. Bonus and wage bases ----
	for (const [w, b] of [[3000, 12000], [5000, 1000], [4000, 999.99], [4000, 1000.01], [5000.01, 5000], [7777.77, 10000], [7777.77, 10005.5], [7777.77, 3000], [2000, 500]] as const)
		add(`I-bonus-${key(w)}-${key(b)}`, [
			'MY-WAGEBASE-01:bonus-epf-only', 'MY-PCB-01:additional-remuneration', 'MY-13M-01:contractual-bonus',
			w <= 5000 && w + b > 5000 ? 'MY-EPF-01:bonus-note-13pct' : 'MY-EPF-01:bonus-table', 'MY-HRDA02:bonus-outside'
		], `RM${w} + RM${b} annual bonus`, { basic: w, inputs: { annualBonus: b } });
	add('I-bonus-aug', ['MY-WAGEBASE-01:bonus-not-skbbk', 'MY-PCB-01:additional-remuneration-n4'], 'August joiner RM4,000 + RM2,000 bonus',
		{ period: AUG, basic: 4000, inputs: { annualBonus: 2000 } });
	for (const t of [500, 6000, 7000])
		add(`I-travel-${t}`, ['MY-PCB-05:travel-exempt-6000', 'MY-WAGEBASE-01:travel-outside-every-base'], `RM5,001 + RM${t} official travel`,
			{ basic: 5001, inputs: { travelOfficial: t } });
	add('I-allowance', ['MY-HRDA02:fixed-allowance-inside', 'MY-WAGEBASE-01:allowance-all-bases'], 'RM5,000 + RM551 fixed allowance', { basic: 5000, fixedAllowance: 551 });

	// ---- J. Minimum wage ----
	for (const w of [1500, 1699.99, 1700])
		add(`J-mw-${key(w)}`, [w < 1700 ? 'MY-NAT-01:monthly-top-up' : 'MY-NAT-01:monthly-at-floor', 'MY-EPF-04:floor-via-top-up'],
			`monthly basic RM${w}`, { basic: w });
	for (const [rate, hours] of [[8, 80], [8.71, 80], [8.72, 80], [8.73, 80], [10, 100]] as const)
		add(`J-pt-${key(rate)}-${hours}`, [
			rate < 8.72 ? 'MY-NAT-01:hourly-top-up' : 'MY-NAT-01:hourly-at-or-above', 'MY-SR16:part-time', 'MY-HRD12:part-time-levied-by-s14',
			'MY-EPF-01:partA-band'
		], `part-time citizen RM${rate}/h × ${hours} h`, { hourlyRate: rate, partTime: true, inputs: { hoursWorked: hours } });

	// ---- K. Exits in January (s.60E(3A) leave pay, s.12/13 notice, TLB reg.6, EPF death month) ----
	const exits: [string, string, ExitCause, boolean | undefined, number][] = [
		// [tag, hireDate, cause, noticeServed, basic]
		['resign-1y', '2024-06-01', 'RESIGNATION', undefined, 3000],
		['resign-4y', '2022-01-01', 'RESIGNATION', undefined, 4000],
		['resign-7y', '2019-01-01', 'RESIGNATION', undefined, 5000],
		['term-11m', '2025-03-01', 'EMPLOYER_TERMINATION', true, 3000],
		['term-12m', '2025-02-01', 'EMPLOYER_TERMINATION', true, 3000],
		['term-23m', '2024-03-01', 'EMPLOYER_TERMINATION', true, 3000],
		['term-24m', '2024-02-01', 'EMPLOYER_TERMINATION', true, 3000],
		['term-59m', '2021-03-01', 'EMPLOYER_TERMINATION', true, 4500],
		['term-60m', '2021-02-01', 'EMPLOYER_TERMINATION', true, 4500],
		['retrench-no-notice-1y', '2024-06-01', 'RETRENCHMENT', false, 3000],
		['retrench-no-notice-3y', '2022-07-01', 'RETRENCHMENT', false, 3500],
		['retrench-no-notice-6y', '2019-07-01', 'RETRENCHMENT', false, 6000],
		['retrench-notice-6y', '2019-07-01', 'RETRENCHMENT', true, 6000],
		['misconduct-4y', '2022-01-01', 'MISCONDUCT_DISMISSAL', undefined, 3000],
		['retire-60', '2010-01-01', 'CONTRACTUAL_RETIREMENT', undefined, 5000],
		['death-8m', '2025-06-01', 'DEATH', undefined, 3000],
		['term-big-15y', '2011-01-01', 'EMPLOYER_TERMINATION', true, 20000]
	];
	for (const [tag, hire, cause, notice, w] of exits) {
		const rows = ['MY-EA12:final-pay', 'MY-PCB-01:leaver-month'];
		if (cause !== 'MISCONDUCT_DISMISSAL' && cause !== 'DEATH') rows.push('MY-EA33:terminating-year-pro-rata', 'MY-WAGEBASE-01:exit-leave-pay-all-bases', 'MY-HRDA02:leave-pay-inside');
		if (cause === 'MISCONDUCT_DISMISSAL') rows.push('MY-EA33:s14-dismissal-no-leave-pay', 'MY-SR09:misconduct-no-benefit');
		if (cause === 'EMPLOYER_TERMINATION' || cause === 'RETRENCHMENT') rows.push('MY-SR08:twelve-month-qualification', 'MY-SR10:tier', 'MY-PCB-05:termination-benefit-exempt');
		if (notice === false) rows.push('MY-EA05:indemnity-no-notice');
		if (notice === true) rows.push('MY-EA05:notice-served');
		if (cause === 'CONTRACTUAL_RETIREMENT') rows.push('MY-SR09:contractual-retirement', 'MY-RET-01:retirement-at-60', 'MY-EPF-01:partE-60plus');
		if (cause === 'DEATH') rows.push('MY-EPF-01:death-month-s43-7');
		add(`K-${tag}`, rows, `${cause.toLowerCase()} effective 31 January 2026, hired ${hire}, RM${w}`, {
			basic: w, hireDate: hire, exitDate: '2026-01-31', exitCause: cause, noticeServed: notice,
			age: cause === 'CONTRACTUAL_RETIREMENT' ? 60 : 40
		});
	}
	for (const [tag, exit, taken] of [['mid-15', '2026-01-15', 0], ['taken-1', '2026-01-31', 1], ['taken-all', '2026-01-31', 2]] as const)
		add(`K-leave-${tag}`, ['MY-EA33:completed-months', 'MY-EA33:half-day-rounding', 'MY-EA11:s18A-b-leaver'],
			`resigned ${exit}, 7 years' service, ${taken} leave days taken`,
			{ basic: 3900, hireDate: '2019-01-01', exitDate: exit, exitCause: 'RESIGNATION', inputs: { annualLeaveTakenThisYear: taken } });
	add('K-term-mid-15', ['MY-SR10:nearest-month', 'MY-EA05:indemnity-cross-month'], 'terminated without notice 15 January 2026, 4 years 15 days',
		{ basic: 3100, hireDate: '2022-01-01', exitDate: '2026-01-15', exitCause: 'EMPLOYER_TERMINATION', noticeServed: false });
	add('K-term-mid-16', ['MY-SR10:nearest-month-up'], 'terminated 16 January 2026 after 4 years 16 days, notice served',
		{ basic: 3100, hireDate: '2022-01-01', exitDate: '2026-01-16', exitCause: 'EMPLOYER_TERMINATION', noticeServed: true });
	add('K-aug-resign-mid', ['MY-EA33:zero-completed-months', 'MY-SKBBK-01:first-phase-employee'], 'August joiner resigned 20 August',
		{ period: AUG, basic: 3100, exitDate: '2026-08-20', exitCause: 'RESIGNATION' });
	add('K-aug-death', ['MY-EPF-01:death-month-s43-7', 'MY-SKBBK-01:first-phase-employee'], 'August joiner died 20 August',
		{ period: AUG, basic: 3100, exitDate: '2026-08-20', exitCause: 'DEATH' });
	add('K-fw-exit', ['MY-EPF-03:partF-leave-pay', 'MY-EA33:terminating-year-pro-rata'], 'foreign worker resigned 31 January, 3 years',
		{ citizenship: 'FOREIGNER', basic: 3000, hireDate: '2023-01-01', exitDate: '2026-01-31', exitCause: 'RESIGNATION' });

	// ---- L. HRD classes ----
	for (const [hrd, period] of [['OPTIONAL', JAN], ['OPTIONAL', AUG], ['NOT_REGISTERED', JAN], ['EDUCATION_EXEMPT', JAN], ['EDUCATION_EXEMPT', AUG]] as const)
		add(`L-${hrd}-${period}`, [
			hrd === 'OPTIONAL' ? 'MY-HRD-02:optional-0_5pct' : hrd === 'EDUCATION_EXEMPT' ? 'MY-HRD11:education-2026' : 'MY-HRD-01:not-liable',
			'MY-HRDA06:declared-class'
		], `${hrd} employer, RM3,000`, { period, hrd, basic: 3000 });
	add('L-pr-optional', ['MY-HRD-01:pr-outside-levy', 'MY-HRD-02:optional-0_5pct'], 'PR at an optional registrant', { hrd: 'OPTIONAL', citizenship: 'PERMANENT_RESIDENT', basic: 3000 });
	for (const [hc, reg] of [[4, true], [5, false], [5, true], [9, true], [9, false], [10, false], [10, true], [11, true]] as const)
		add(`L-headcount-${hc}-${reg ? 'reg' : 'unreg'}`, [
			hc >= 10 ? 'MY-HRD-01:part-i-compulsory-10' : hc >= 5 ? 'MY-HRD-01:part-i-optional-5-9' : 'MY-HRD-01:below-5',
			...(hc >= 10 && !reg ? ['MY-REG-01:unregistered-still-liable'] : [])
		], `Part I employer, ${hc} citizen employees, ${reg ? 'registered' : 'not registered'}, RM3,000`,
		{ hrd: 'BY_HEADCOUNT', employer: { citizenHeadcount: hc, registered: reg }, basic: 3000 });
	for (const [s15, period] of [['EXCEEDED_THIS_YEAR', JAN], ['EXCEEDED_THIS_YEAR', AUG], ['EXCEEDED_LAST_YEAR', JAN]] as const)
		add(`L-s15-${s15}-${period}`, [s15 === 'EXCEEDED_THIS_YEAR' ? 'MY-HRDA06:s15-5-retain-1pct' : 'MY-HRDA06:s15-6-restore-0_5pct', 'MY-HRD-02:optional-0_5pct'],
			`optional registrant, class maximum ${s15 === 'EXCEEDED_THIS_YEAR' ? 'exceeded this year' : 'exceeded last year, now within'}, RM4,000`,
			{ period, hrd: 'OPTIONAL', employer: { s15 }, basic: 4000 });

	// ---- M. Daily-rated minimum wage (MWO para 5: 6/5/4-day week floors) ----
	for (const [perWeek, rate, days] of [[6, 60, 26], [6, 65.37, 26], [6, 65.38, 26], [6, 70, 20], [5, 78.45, 22], [5, 78.46, 22], [5, 90, 22], [4, 98.07, 17], [4, 98.08, 17], [4, 120, 17]] as const)
		add(`M-daily-${perWeek}-${key(rate)}`, [
			rate < ({ 6: 65.38, 5: 78.46, 4: 98.08 } as const)[perWeek] ? 'MY-NAT-01:daily-top-up' : 'MY-NAT-01:daily-at-or-above',
			'MY-EA36:daily-orp', 'MY-EPF-01:partA-band', 'MY-EPF-04:floor-via-top-up', 'MY-HRDA02:basic-inside'
		], `daily-rated citizen, ${perWeek}-day week, RM${rate} × ${days} days`, { daily: { rate, days, perWeek } });

	// ---- N. s.18A mid-month rate change, paid statutory leave ----
	for (const [on, to] of [['2026-01-02', 3500], ['2026-01-16', 3500], ['2026-01-31', 3500], ['2026-01-16', 5200]] as const)
		add(`N-rate-${on.slice(8)}-${to}`, ['MY-EA11:mid-month-rate-change', 'MY-EPF-01:partA-band', to > 5000 ? 'MY-EPF-01:partA-over-5000' : 'MY-EPF-01:partA-table'],
			`RM3,000 to RM${to} from ${on}`, { basic: 3000, rateChange: { on, monthlyBasic: to } });
	for (const [kind, days, row] of [['MEDICAL', 2, 'MY-EA34:paid-sick-no-abatement'], ['HOSPITALISATION', 10, 'MY-EA34:hospitalisation-paid'], ['MATERNITY', 31, 'MY-EA24:s37-2c-monthly-continuation'], ['PATERNITY', 7, 'MY-EA35:paternity-paid']] as const)
		add(`N-leave-${kind}`, [row, 'MY-EA11:paid-leave-not-abated'], `${days} ${kind.toLowerCase()} leave days in January, RM3,100`,
			{ basic: 3100, inputs: { paidLeave: { kind, days } } });

	// ---- O. SKBBK release (from 8 July 2026) ----
	for (const [c, period] of [['CITIZEN', '2026-09'], ['PERMANENT_RESIDENT', '2026-09'], ['FOREIGNER', '2026-09'], ['CITIZEN', '2026-12']] as const)
		add(`O-skbbk-release-${c}-${period}`, [c === 'FOREIGNER' ? 'MY-SKBBK-04:foreign-release-no-effect' : 'MY-SKBBK-04:local-release-ends-charge', 'MY-SKBBK-01:after-8-july'],
			`${c.toLowerCase()} with an accepted SKBBK release, ${period}, RM3,000`, { period, citizenship: c, skbbkReleased: true, basic: 3000 });
	add('O-skbbk-no-release-2026-12', ['MY-SKBBK-04:deemed-participant', 'MY-SKBBK-01:after-8-july'], 'citizen without release, December 2026', { period: '2026-12', basic: 3000 });

	// ---- P. s.59(1): the earlier of two rest days is overtime at 1.5x ----
	for (const [w, h] of [[3000, 4], [3000, 10], [5500, 8]] as const)
		add(`P-earlier-rest-${w}-${h}`, ['MY-EA30:s59-last-rest-day-only', 'MY-EA31:ordinary-day-1_5x', 'MY-WAGEBASE-01:overtime-ss-not-epf'],
			`RM${w}, ${h} h on Saturday of a Sat+Sun rest week`, { basic: w, inputs: { earlierRestDayHours: h, earlierRestDayDate: '2026-01-10' } });

	// ---- Q. Part-time extra hours (reg.5) ----
	for (const [sch, worked] of [[4, 6], [4, 8], [4, 10], [5, 9]] as const)
		add(`Q-pt-extra-${sch}-${worked}`, ['MY-SR17:part-time-1x-to-full-time', ...(worked > 8 ? ['MY-SR17:part-time-1_5x-beyond'] : []), 'MY-SR16:part-time', 'MY-HRD12:part-time-levied-by-s14'],
			`part-timer RM10/h × 80 h, one day scheduled ${sch} h, worked ${worked} h`,
			{ hourlyRate: 10, partTime: true, inputs: { hoursWorked: 80, partTimeDay: { scheduled: sch, worked, date: '2026-01-07' } } });

	// ---- R. TP3 previous-employer history (joiner 1 August 2026) ----
	for (const [w, Y, K, X, Z] of [[5000, 35000, 3850, 700, 0], [8000, 49000, 3920, 3200, 0], [8000, 49000, 3920, 3200, 300], [3500, 21000, 2310, 0, 0], [12000, 70000, 4000, 9000, 0]] as const)
		add(`R-tp3-${w}-${Y}-${Z}`, ['MY-PCB-03:tp3-opening', Z ? 'MY-PCB-03:tp3-zakat-z' : 'MY-PCB-03:tp3-no-zakat', K >= 4000 ? 'MY-PCB-01:epf-relief-exhausted' : 'MY-PCB-01:k2-spread'],
			`August joiner RM${w}, TP3 Y ${Y} K ${K} X ${X} Z ${Z}`, { period: AUG, basic: w, tp3: { Y, K, X, Z } });

	// ---- S. Tax residence by presence (ITA s.7(1)) and Sch.6 para 21 ----
	const fw = { citizenship: 'FOREIGNER' as const, taxResidency: 'NON_RESIDENT' as const, basic: 5001 };
	add('S-7-1-a-182', ['MY-PCB-06:s7-1-a-182-days'], 'foreign worker present since 31 January, July payroll (182 days)', { ...fw, period: '2026-07', presence: { daysThisYear: 182 } });
	add('S-7-1-a-181', ['MY-PCB-06:s7-1-a-181-days-non-resident'], 'foreign worker present since 1 February, July payroll (181 days)', { ...fw, period: '2026-07', presence: { daysThisYear: 181 } });
	add('S-7-1-b-182', ['MY-PCB-06:s7-1-b-linked-182'], 'January: 31 days + 151 linked 2025 days', { ...fw, presence: { daysThisYear: 31, linkedPrevYear: 151 } });
	add('S-7-1-b-181', ['MY-PCB-06:s7-1-b-linked-181'], 'January: 31 days + 150 linked 2025 days', { ...fw, presence: { daysThisYear: 31, linkedPrevYear: 150 } });
	for (const [days, yrs] of [[90, 3], [89, 3], [90, 2], [90, 4]] as const)
		add(`S-7-1-c-${days}-${yrs}`, [days >= 90 && yrs >= 3 ? 'MY-PCB-06:s7-1-c-ii-resident' : 'MY-PCB-06:s7-1-c-ii-not-met'],
			`March joiner, ${days} days in 2026, ${yrs} of 4 preceding years at 90+`, { ...fw, period: '2026-03', presence: { daysThisYear: days, precedingYears90: yrs } });
	for (const days of [20, 31])
		add(`S-para21-${days}`, ['MY-PCB-07:sch6-para21-exempt'], `non-resident, para 21 claim, ${days} employment days`, { ...fw, presence: { daysThisYear: days, para21EmploymentDays: days } });
	add('S-no-claim', ['MY-PCB-07:flat-30pct-no-claim'], 'non-resident, 20 days present, no para 21 claim', { ...fw, presence: { daysThisYear: 20 } });

	return out;
}
