/**
 * Synthetic CN-shanghai payroll scenarios for the independent oracle (`tests/e2e/oracle/CN-shanghai.ts`).
 *
 * Deterministic: the only variety comes from a fixed-seed mulberry32, so every run yields the same list. Each scenario
 * names the `docs/inventory/china.csv` row ids and the branch it exercises.
 *
 * Shape → probe harness (`tests/e2e/payroll-probe.ts`): `profile` is the Shanghai applicability profile of the CN
 * lineage (the differential's company records `settings_code: 'CN'`, region SHANGHAI, worksite SHANGHAI), `period` the run's
 * period, `runs` the earlier same-employer periods that must be run first (cumulative withholding), `worker` /
 * `employment` / `contributions` / `tax` the employee, employment, terms and declared facts (tracker config paths:
 * `statutory_contributions:*` bases, `facts.housing_fund_rate`, `facts.housing_fund_supplementary_rate`,
 * `facts.injury_rate`, `facts.unemployment_employer_rate`, `exit_facts.*`), `month` the period's time entries
 * (overtime, unpaid leave, part-time hours) and ad hoc lines (`BONUS`, `ANNUAL_BONUS_SEPARATE`, `HEAT_ALLOWANCE`, the
 * CN-N55 receipts), paid and maternity leave, `earlier` the bonuses/overtime of earlier runs, `claims` the contract
 * claims settled this period, `exit` the separation. `computePayslip(scenario).lines` is the case's `expected[].lines`,
 * and `.refused` its `refused`. Row ids are the tracker's branch ids.
 */
import { computePayslip, runsFor } from '../oracle/CN-shanghai.ts';

export type Ground =
	| 'ART36_EMPLOYER' // mutual, employer-proposed (LCL art.46(2))
	| 'ART36_EMPLOYEE' // mutual, employee-proposed
	| 'ART37' // resignation on notice
	| 'ART38' // employee terminates for employer fault (art.46(1))
	| 'ART39' // dismissal for cause
	| 'ART40' // no-fault dismissal (art.46(3))
	| 'ART41' // redundancy (art.46(4))
	| 'ART44_EXPIRY' // fixed term expiry (art.46(5))
	| 'ART87' // unlawful termination
	| 'RETIREMENT_EARLY'; // early retirement (art.44(2); the 164号 item 5(2) lump sum)

type Overtime = { date: string; hours: number; compensatoryRest?: boolean };

export type Scenario = {
	id: string;
	profile: 'CN-shanghai';
	/** `docs/inventory/china.csv` branch ids (`CN-N41.art87-double`) this scenario exercises. */
	rows: string[];
	/** The scenario's own branch names (what differs from its neighbours). */
	branches: string[];
	description: string;
	period: string;
	/** Same-employer periods of the tax year to run first, oldest first, ending at `period`. */
	runs: string[];
	worker: {
		birthDate: string;
		sex: 'M' | 'F';
		citizenship: 'CN' | 'FOREIGN' | 'HMT';
		taxResident: boolean;
		pensionRecipient: boolean;
		/** SH41 art.6: a foreign or HK/Macao/Taiwan worker's fund election by mutual agreement. */
		housingFundAgreement: boolean;
		/** Verified service with earlier employers (annual-leave tier), months. */
		priorServiceMonths: number;
	};
	employment: {
		hireDate: string;
		exitDate: string | null;
		kind: 'FULL_TIME' | 'PART_TIME';
		monthlyWage: number;
		hourlyWage?: number;
	};
	contributions: {
		siBase: number;
		hfBase: number;
		hfRate: number;
		hfSupplementaryRate: number;
		hfFirstEver: boolean;
		injuryRate: number;
		unemploymentEmployerRate2026: number;
	};
	tax: {
		firstWageIncomeThisYear: boolean;
		annual60kElection: boolean;
		annualBonusSeparateUsedThisYear: boolean;
		specialDeductions: {
			childEducationChildren: number;
			infantCareChildren: number;
			elderSupport: number;
			rent: boolean;
			loanInterest: boolean;
		};
	};
	month: {
		unpaidLeaveDays: number;
		overtime: Overtime[];
		heatExposed: boolean;
		heatAllowanceContract: number;
		bonus: number;
		annualBonusSeparate: number;
		nonWage: Partial<
			Record<
				'ONE_CHILD_SUBSIDY' | 'CHILDCARE_SUBSIDY' | 'TRAVEL_ALLOWANCE' | 'MISSED_MEAL_SUBSIDY',
				number
			>
		>;
		partTimeHours: number;
		/** Statutory paid leave taken this period (leave rows by catalogue code), within the entitlement. */
		paidLeave: { code: string; from: string; to: string; detail?: string }[];
		/** A whole period on maternity leave; the agency-determined allowance for its days (recorded facts). */
		maternity?: {
			from: string;
			to: string;
			allowance: number;
			insuredMonthsCumulative: number;
			insuredMonthsConsecutive: number;
			/** the unit average's monthly excess over 300% of the city average (agency figure), 0 if none */
			unitAverageExcessOverCap: number;
		};
		/** 内部退养 lump sum paid this period and the months to statutory age (exit_facts.iit164_internal_retirement_months). */
		internalRetirement?: { lump: number; months: number };
	};
	/** Pay in earlier runs of the tax year (each `ym` is one of `runs`): bonuses and overtime entering the 12-month averages. */
	earlier: { ym: string; bonus?: number; overtime?: Overtime[] }[];
	/** Contract claims settled through this period's payroll (terms_facts / adhoc requests). */
	claims: {
		/** LCL arts.19, 83: the contract term (null = open-ended) and the probation months actually served. */
		probation?: { termMonths: number | null; servedMonths: number; postProbationWage: number };
		/** LCL art.20: this period is a probation month paid `employment.monthlyWage` against this agreed wage. */
		probationWageShortfall?: { agreedWage: number };
		/** LCL art.82 para.1: the written contract's signing date, null if never signed. */
		noWrittenContract?: { signedOn: string | null };
		/** LCL art.82 para.2: the recorded day an open-ended contract was due and the day it was concluded. */
		openEnded?: { dueOn: string; concludedOn: string };
	};
	exit: null | {
		ground: Ground;
		noticeDaysGiven: number;
		renewalOfferRefused: boolean;
		annualLeaveTakenThisYear: number;
		/** exit_facts.iit164_early_retirement_years with the EARLY_RETIREMENT_SUBSIDY */
		earlyRetirement?: { subsidy: number; years: number };
	};
};

type Patch = {
	[K in 'worker' | 'employment' | 'contributions' | 'tax' | 'month']?: Partial<Scenario[K]>;
} & { exit?: Scenario['exit']; earlier?: Scenario['earlier']; claims?: Scenario['claims'] };

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** The contribution branches an ordinary insured month charges, by period. */
const siRows = (period: string) => [
	'CN-N07.pension',
	'CN-N07.medical',
	'CN-N07.unemployment',
	'CN-N07.work-injury',
	'CN-N07.maternity',
	'CN-SH05.existing-worker-base',
	'CN-SH06.pension-16-8',
	period <= '2026-02' ? 'CN-SH06.medical-2025-instrument' : 'CN-SH06.medical-2026-instrument',
	period <= '2025-12' ? 'CN-SH06.unemployment-2025' : 'CN-SH06.unemployment-2026',
	...(period >= '2026-01' ? ['CN-SH07.recorded-class-rate'] : []),
	'CN-X-SI-ROUNDING.social-insurance-fen'
];
/** The housing-fund branches an ordinary covered month charges, by period. */
const hfRows = (period: string) => [
	...(period <= '2026-06'
		? ['CN-SH09.ordinary-rate', 'CN-SH09.per-side-rounding']
		: ['CN-SH40.ordinary-share', 'CN-SH40.per-side-rounding']),
	'CN-N08.existing-worker-base',
	'CN-SH43.existing-worker-base',
	'CN-SH41.active-employees',
	'CN-X-SI-ROUNDING.housing-fund-yuan'
];
const TAX = ['CN-N09.resident-cumulative', 'CN-N09.tax-residence', 'CN-N38.resident-annual-table'];
const SEVERANCE = [
	'CN-N12.service-year-severance',
	'CN-N19.severance-wage-base',
	'CN-N04.exit-settlement',
	'CN-SH02.final-payment'
];

export function generateProfiles(): Scenario[] {
	const rand = mulberry32(0x5a_2026);
	/** A deterministic wage in [lo, hi), whole yuan. */
	const wage = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo));
	const out: Scenario[] = [];
	let n = 0;
	/** A scenario, not yet registered. */
	const build = (
		rows: string[],
		branches: string[],
		description: string,
		period: string,
		p: Patch = {}
	) => {
		const hire = period === '2025-12' ? '2025-12-01' : '2024-01-01';
		const s: Scenario = {
			id: 'unregistered',
			profile: 'CN-shanghai',
			rows: [...new Set(rows)],
			branches,
			description,
			period,
			runs: [],
			worker: {
				birthDate: '1990-05-15',
				sex: 'M',
				citizenship: 'CN',
				taxResident: true,
				pensionRecipient: false,
				housingFundAgreement: false,
				priorServiceMonths: 0,
				...p.worker
			},
			employment: {
				hireDate: hire,
				exitDate: null,
				kind: 'FULL_TIME',
				monthlyWage: 20000,
				...p.employment
			},
			contributions: {
				siBase: 20000,
				hfBase: 20000,
				hfRate: 0.07,
				hfSupplementaryRate: 0,
				hfFirstEver: false,
				injuryRate: 0.002,
				unemploymentEmployerRate2026: 0.005,
				...p.contributions
			},
			tax: {
				firstWageIncomeThisYear: false,
				annual60kElection: false,
				annualBonusSeparateUsedThisYear: false,
				...p.tax,
				specialDeductions: {
					childEducationChildren: 0,
					infantCareChildren: 0,
					elderSupport: 0,
					rent: false,
					loanInterest: false,
					...p.tax?.specialDeductions
				}
			},
			month: {
				unpaidLeaveDays: 0,
				overtime: [],
				heatExposed: false,
				heatAllowanceContract: 0,
				bonus: 0,
				annualBonusSeparate: 0,
				nonWage: {},
				partTimeHours: 0,
				paidLeave: [],
				...p.month
			},
			earlier: p.earlier ?? [],
			claims: p.claims ?? {},
			exit: p.exit === undefined ? null : p.exit
		};
		s.runs = runsFor(s);
		for (const x of s.earlier)
			if (!s.runs.slice(0, -1).includes(x.ym))
				throw new Error(`earlier pay ${x.ym} is not an earlier run of ${period}`);
		return s;
	};
	const make = (...a: Parameters<typeof build>) => {
		const s = build(...a);
		s.id = `CN-SH-ORACLE-${String(++n).padStart(3, '0')}`;
		out.push(s);
		return s;
	};
	const leave = (ground: Ground, extra: Partial<NonNullable<Scenario['exit']>> = {}) => ({
		ground,
		noticeDaysGiven: 30,
		renewalOfferRefused: false,
		annualLeaveTakenThisYear: 0,
		...extra
	});

	// ── 1. Social-insurance base bounds, both contribution years (CN-SH05) ──
	const SI = { 2025: [7460, 37302], 2026: [7546, 37731] } as const;
	for (const [period, year] of [
		['2025-12', 2025],
		['2026-06', 2025],
		['2026-07', 2026]
	] as const) {
		const [lo, hi] = SI[year];
		for (const [label, b] of [
			['floor-0.01', r2(lo - 0.01)],
			['floor', lo],
			['floor+0.01', r2(lo + 0.01)],
			['ceiling-0.01', r2(hi - 0.01)],
			['ceiling', hi],
			['ceiling+0.01', r2(hi + 0.01)],
			['in-bound', wage(lo + 1, hi)]
		] as const)
			make(
				[
					label.startsWith('floor')
						? `CN-SH05.floor-${year}`
						: label.startsWith('ceiling')
							? `CN-SH05.ceiling-${year}`
							: 'CN-SH05.existing-worker-base',
					...siRows(period)
				],
				[`si-base-${year}-${label}`],
				`SI base ${b} in ${period}`,
				period,
				{ employment: { monthlyWage: Math.max(b, 10000) }, contributions: { siBase: b } }
			);
	}

	// ── 2. Scheme rates across the instrument dates (CN-SH06, N07): unemployment 0.5/0.5 to 31 Dec 2025, the medical
	//       instrument change 28 Feb / 1 Mar 2026, the SI year 30 Jun / 1 Jul 2026 ──
	for (const period of [
		'2025-12',
		'2026-01',
		'2026-02',
		'2026-03',
		'2026-06',
		'2026-07',
		'2026-09'
	])
		make(
			[...siRows(period), ...hfRows(period), ...TAX],
			[`rates-${period}`],
			`standard 20,000 worker in ${period}`,
			period
		);
	make(
		['CN-SH06.unemployment-2026'],
		['unemployment-employer-2026-recorded-0.01'],
		'recorded 2026 employer unemployment fact 1%',
		'2026-03',
		{
			contributions: { unemploymentEmployerRate2026: 0.01 }
		}
	);
	// fen half-up per side: bases giving x.xx5 shares
	for (const b of [18865.5, 9431.25, 12345.67])
		make(
			['CN-X-SI-ROUNDING.social-insurance-fen', 'CN-SH05.existing-worker-base'],
			['si-fen-half-up'],
			`SI shares on ${b}`,
			'2026-08',
			{
				employment: { monthlyWage: 20000 },
				contributions: { siBase: b }
			}
		);

	// ── 3. Work-injury classes I–VIII (CN-SH07) ──
	for (const [cls, rate] of [0.002, 0.004, 0.007, 0.009, 0.011, 0.013, 0.016, 0.019].entries())
		make(
			['CN-SH07.recorded-class-rate', 'CN-N07.work-injury'],
			[`injury-class-${cls + 1}`],
			`injury class ${cls + 1} at ${rate * 100}%`,
			'2026-03',
			{
				contributions: { injuryRate: rate }
			}
		);

	// ── 4. Housing fund bounds, rates, rounding, coverage (CN-SH09, SH40, SH41, SH43, N08) ──
	const HF = { 2025: [2690, 37302], 2026: [2740, 37731] } as const;
	for (const [period, year] of [
		['2026-03', 2025],
		['2026-08', 2026]
	] as const) {
		const [lo, hi] = HF[year];
		for (const [label, b] of [
			['floor-0.01', r2(lo - 0.01)],
			['floor', lo],
			['ceiling', hi],
			['ceiling+0.01', r2(hi + 0.01)]
		] as const) {
			const row =
				year === 2025
					? label.startsWith('floor')
						? 'CN-SH09.floor-2690'
						: 'CN-SH09.ceiling-37302'
					: label.startsWith('floor')
						? 'CN-SH40.floor-2740'
						: 'CN-SH40.ceiling-37731';
			make(
				[row, 'CN-N08.existing-worker-base'],
				[`hf-base-${year}-${label}`],
				`fund base ${b}`,
				period,
				{
					employment: { monthlyWage: Math.max(b, 10000) },
					contributions: { hfBase: b }
				}
			);
		}
		for (const rate of [0.05, 0.06, 0.07])
			make(
				[year === 2025 ? 'CN-SH09.ordinary-rate' : 'CN-SH40.ordinary-share'],
				[`hf-rate-${rate}`],
				`fund ${rate * 100}% on 21,750`,
				period,
				{
					employment: { monthlyWage: 21750 },
					contributions: { hfBase: 21750, hfRate: rate }
				}
			);
	}
	make(
		['CN-N08.contribution-ratio', 'CN-SH40.ordinary-share'],
		['hf-5pct-after-revised-art18'],
		'fund 5% in September 2026 (revised art.18 from 20 Sep 2026)',
		'2026-09',
		{
			contributions: { hfRate: 0.05 }
		}
	);
	for (const supp of [0.01, 0.02, 0.03, 0.04, 0.05])
		make(
			[
				'CN-SH40.supplementary-share',
				'CN-SH40.per-side-rounding',
				'CN-SH41.supplementary-voluntary'
			],
			[`hf-supplementary-${supp}`],
			`7% + ${supp * 100}% supplementary at the 2026 ceiling`,
			'2026-08',
			{
				employment: { monthlyWage: 40000 },
				contributions: { hfBase: 40000, hfSupplementaryRate: supp }
			}
		);
	make(
		['CN-SH09.per-side-rounding', 'CN-X-SI-ROUNDING.housing-fund-yuan'],
		['hf-yuan-round-half-up'],
		'21,750 × 7% = 1,522.50 → 1,523 each side',
		'2026-03',
		{
			employment: { monthlyWage: 21750 },
			contributions: { hfBase: 21750 }
		}
	);
	make(
		['CN-SH09.per-side-rounding', 'CN-X-SI-ROUNDING.housing-fund-yuan'],
		['hf-yuan-round-down'],
		'21,749.99 × 7% = 1,522.4993 → 1,522',
		'2026-03',
		{
			employment: { monthlyWage: 21750 },
			contributions: { hfBase: 21749.99 }
		}
	);
	make(
		['CN-SH09.supplementary-rate', 'CN-SH09.per-side-rounding', 'CN-SH41.supplementary-voluntary'],
		['hf-supplementary-2025-5'],
		'10,010 at 7% + 5%: 701 + 501 each side',
		'2026-03',
		{
			employment: { monthlyWage: 10010 },
			contributions: { hfBase: 10010, hfSupplementaryRate: 0.05 }
		}
	);
	for (const period of ['2026-03', '2026-08']) {
		const second = period === '2026-03' ? '2026-04' : '2026-09';
		const y26 = period >= '2026-07';
		make(
			[
				'CN-SH43.first-ever-joining-month',
				'CN-N08.first-ever-second-month',
				...(y26 ? ['CN-SH40.first-time-worker'] : [])
			],
			['hf-first-ever-joining-month'],
			`first-ever worker, joining month ${period}: no fund`,
			period,
			{
				employment: { hireDate: `${period}-01` },
				contributions: { hfFirstEver: true }
			}
		);
		make(
			[
				'CN-SH43.first-ever-second-month',
				'CN-N08.first-ever-second-month',
				...(y26 ? ['CN-SH40.first-time-worker'] : [])
			],
			['hf-first-ever-second-month'],
			`first-ever worker, second month ${second}: charged`,
			second,
			{
				employment: { hireDate: `${period}-01` },
				contributions: { hfFirstEver: true }
			}
		);
		make(
			[
				'CN-SH43.transferred-first-month',
				'CN-N08.transferred-first-month',
				...(y26 ? ['CN-SH40.transfer-first-month'] : [])
			],
			['hf-transfer-joining-month'],
			`transferred worker charged from the first month ${period}`,
			period,
			{
				employment: { hireDate: `${period}-01` }
			}
		);
	}
	make(
		[
			'CN-SH43.first-ever-joining-month',
			'CN-N08.first-ever-second-month',
			'CN-N02.day-conversion-21-75'
		],
		['hf-first-ever-mid-month-join'],
		'first-ever worker joining on the 16th',
		'2026-03',
		{
			employment: { hireDate: '2026-03-16' },
			contributions: { hfFirstEver: true }
		}
	);
	make(
		['CN-SH43.partial-month-dispute', 'CN-N02.day-conversion-21-75'],
		['hf-exit-month'],
		'fund still due in a mid-month exit month',
		'2026-07',
		{
			employment: { exitDate: '2026-07-15' },
			exit: leave('ART37', { annualLeaveTakenThisYear: 15 })
		}
	);

	// ── 5. Minimum wage net of employee shares (CN-SH01, N50) ──
	const seam = (period: string, rate: number) => {
		const siFloorEe = period >= '2026-07' ? 792.33 : 783.3;
		const start = Math.floor((2740 + siFloorEe) / (1 - rate)) - 5;
		const probe = (w: number) =>
			computePayslip(
				build([], [], '', period, {
					employment: { monthlyWage: w },
					contributions: { siBase: w, hfBase: w, hfRate: rate }
				})
			).refused;
		for (let c = start * 100; c < (start + 15) * 100; c++) {
			const w = c / 100;
			if (!probe(w) && probe(r2(w - 0.01))) return w;
		}
		throw new Error(`no minimum-wage seam for ${period} at ${rate}`);
	};
	for (const period of ['2025-12', '2026-06', '2026-07'])
		for (const rate of [0.05, 0.06, 0.07]) {
			const w = seam(period, rate);
			for (const [label, x] of [
				['at-seam', w],
				['one-cent-below', r2(w - 0.01)]
			] as const)
				make(
					[
						'CN-SH01.net-of-employee-contributions',
						'CN-N50.floor-test',
						...(label === 'at-seam' ? [] : ['CN-SH01.below-floor-refusal'])
					],
					[`minimum-wage-${label}`],
					`${x} nets ${label === 'at-seam' ? '≥' : '<'} 2,740 at fund ${rate * 100}%`,
					period,
					{ employment: { monthlyWage: x }, contributions: { siBase: x, hfBase: x, hfRate: rate } }
				);
		}
	make(
		['CN-SH01.net-of-employee-contributions', 'CN-SH01.below-floor-refusal', 'CN-N50.floor-test'],
		['minimum-wage-gross-equals-floor'],
		'2,740 gross is below the floor once shares come off',
		'2025-12',
		{
			employment: { monthlyWage: 2740 },
			contributions: { siBase: 2740, hfBase: 2740 }
		}
	);
	const EXCL = ['CN-SH01.excluded-items', 'CN-N50.excluded-components'];
	make(
		[...EXCL, 'CN-SH19.minimum-wage-exclusion'],
		['minimum-wage-heat-excluded'],
		'3,700 + 300 heat allowance: allowance outside the test',
		'2026-07',
		{
			employment: { monthlyWage: 3700 },
			contributions: { siBase: 3700, hfBase: 3700 },
			month: { heatExposed: true }
		}
	);
	make(
		[...EXCL, 'CN-N55.missed-meal-subsidy', 'CN-N55.travel-allowance'],
		['minimum-wage-non-wage-excluded'],
		'3,700 + meal/travel receipts: outside the test',
		'2026-08',
		{
			employment: { monthlyWage: 3700 },
			contributions: { siBase: 3700, hfBase: 3700 },
			month: { nonWage: { MISSED_MEAL_SUBSIDY: 400, TRAVEL_ALLOWANCE: 500 } }
		}
	);
	make(
		[...EXCL, 'CN-N01.weekday-extended-150'],
		['minimum-wage-overtime-excluded'],
		'3,700 + overtime: overtime outside the test',
		'2026-08',
		{
			employment: { monthlyWage: 3700 },
			contributions: { siBase: 3700, hfBase: 3700 },
			month: { overtime: [{ date: '2026-08-04', hours: 3 }] }
		}
	);

	// ── 6. Part-month and unpaid leave on the 21.75 day (CN-N02, N04, SH02) ──
	const PART = ['CN-N02.day-conversion-21-75', 'CN-N04.exit-settlement'];
	for (const ym of ['2025-12', '2026-03', '2026-07', '2026-08']) {
		const last = 31; // every plain month used here has 31 days
		const W = 21750;
		for (const d of [1, 2, 15, last])
			make(
				['CN-N02.day-conversion-21-75'],
				[`joiner-day-${d === last ? 'last' : d === 2 ? '2-workdays-may-exceed-21.75' : d}`],
				`joins ${ym}-${String(d).padStart(2, '0')}`,
				ym,
				{
					employment: { hireDate: `${ym}-${String(d).padStart(2, '0')}`, monthlyWage: W },
					contributions: { siBase: W, hfBase: W }
				}
			);
		const hire = ym === '2025-12' ? '2025-12-01' : '2024-01-01';
		for (const d of [1, 15, last - 1, last])
			make(
				[...PART, 'CN-SH02.final-payment'],
				[`leaver-day-${d === last ? 'last' : d === last - 1 ? 'second-last' : d}`],
				`leaves ${ym}-${String(d).padStart(2, '0')}`,
				ym,
				{
					employment: {
						hireDate: hire,
						exitDate: `${ym}-${String(d).padStart(2, '0')}`,
						monthlyWage: W
					},
					contributions: { siBase: W, hfBase: W },
					exit: leave('ART37', { annualLeaveTakenThisYear: 15 })
				}
			);
		for (const days of [1, 3])
			make(
				['CN-N04.unpaid-personal-leave', 'CN-N02.day-conversion-21-75'],
				[`unpaid-leave-${days}`],
				`${days} unpaid day(s) at 21,750 ÷ 21.75`,
				ym,
				{
					employment: { hireDate: hire, monthlyWage: W },
					contributions: { siBase: W, hfBase: W },
					month: { unpaidLeaveDays: days }
				}
			);
	}
	make(
		[...PART, 'CN-N05.part-year-proration'],
		['join-and-leave-same-month'],
		'joins 2026-08-10, leaves 2026-08-21',
		'2026-08',
		{
			employment: { hireDate: '2026-08-10', exitDate: '2026-08-21' },
			exit: leave('ART37')
		}
	);
	make(
		['CN-N02.day-conversion-21-75'],
		['joiner-on-weekend'],
		'joins Saturday 2026-08-29',
		'2026-08',
		{ employment: { hireDate: '2026-08-29' } }
	);
	make(
		['CN-N02.day-conversion-21-75'],
		['joiner-on-weekend'],
		'joins Sunday 2026-03-29',
		'2026-03',
		{ employment: { hireDate: '2026-03-29' } }
	);
	make(
		['CN-N04.unpaid-personal-leave', 'CN-N02.day-conversion-21-75'],
		['unpaid-leave-odd-wage'],
		'one unpaid day at 12,345.67',
		'2026-03',
		{
			employment: { monthlyWage: 12345.67 },
			contributions: { siBase: 12345.67, hfBase: 12345.67 },
			month: { unpaidLeaveDays: 1 }
		}
	);

	// ── 7. Overtime (CN-N01, SH03, N40, N03, N02) ──
	const OT = (
		branch: string,
		period: string,
		overtime: Overtime[],
		rows: string[],
		extra: Patch = {}
	) =>
		make(
			['CN-SH03.contract-base', 'CN-N02.hour-conversion-8', 'CN-N01.standard-hours-rest', ...rows],
			[branch],
			`${branch} in ${period}`,
			period,
			{
				...extra,
				employment: { monthlyWage: 21750, ...extra.employment },
				contributions: { siBase: 21750, hfBase: 21750, ...extra.contributions },
				month: { overtime, ...extra.month }
			}
		);
	const WD = 'CN-N01.weekday-extended-150';
	const RD = 'CN-N01.rest-day-200';
	const HOL = ['CN-N01.holiday-300', 'CN-N03.all-citizen-festivals'];
	const ADJ = 'CN-N03.adjusted-workdays';
	OT('weekday-150', '2026-03', [{ date: '2026-03-03', hours: 2 }], [WD]);
	OT('weekday-150-half-hour', '2026-03', [{ date: '2026-03-04', hours: 0.5 }], [WD]);
	OT('rest-day-200', '2026-03', [{ date: '2026-03-07', hours: 8 }], [RD]);
	OT(
		'rest-day-compensatory-rest',
		'2026-03',
		[{ date: '2026-03-08', hours: 8, compensatoryRest: true }],
		['CN-N01.rest-day-compensatory-rest', 'CN-N40.rest-day-compensatory-rest']
	);
	OT(
		'weekday-rest-mix',
		'2026-03',
		[
			{ date: '2026-03-10', hours: 3 },
			{ date: '2026-03-14', hours: 6 }
		],
		[WD, RD]
	);
	OT('holiday-300-new-year', '2026-01', [{ date: '2026-01-01', hours: 8 }], HOL);
	OT('bridge-day-rest-200', '2026-01', [{ date: '2026-01-02', hours: 8 }], [RD, ADJ]);
	OT('adjusted-workday-extension-150', '2026-01', [{ date: '2026-01-04', hours: 2 }], [WD, ADJ]);
	OT(
		'holiday-300-with-time-off',
		'2026-05',
		[{ date: '2026-05-01', hours: 8, compensatoryRest: true }],
		[...HOL, 'CN-N40.holiday-no-substitution']
	);
	OT('holiday-300-labour-day-2', '2026-05', [{ date: '2026-05-02', hours: 4 }], HOL);
	OT('bridge-day-rest-200-may', '2026-05', [{ date: '2026-05-04', hours: 8 }], [RD, ADJ]);
	OT('adjusted-workday-may-9', '2026-05', [{ date: '2026-05-09', hours: 1 }], [WD, ADJ]);
	OT('holiday-300-spring-festival-eve', '2026-02', [{ date: '2026-02-16', hours: 8 }], HOL);
	OT('spring-festival-bridge-200', '2026-02', [{ date: '2026-02-20', hours: 8 }], [RD, ADJ]);
	OT('holiday-300-dragon-boat', '2026-06', [{ date: '2026-06-19', hours: 8 }], HOL);
	OT('holiday-300-qingming-sunday', '2026-04', [{ date: '2026-04-05', hours: 8 }], HOL);
	OT('holiday-300-mid-autumn', '2026-09', [{ date: '2026-09-25', hours: 8 }], HOL);
	OT('mid-autumn-bridge-200', '2026-09', [{ date: '2026-09-26', hours: 8 }], [RD, ADJ]);
	OT('adjusted-workday-sep-20', '2026-09', [{ date: '2026-09-20', hours: 2 }], [WD, ADJ]);
	OT(
		'daily-cap-3h',
		'2026-03',
		[{ date: '2026-03-05', hours: 3 }],
		[WD, 'CN-N40.daily-three-hour-cap']
	);
	OT(
		'daily-cap-4h-warned',
		'2026-03',
		[{ date: '2026-03-05', hours: 4 }],
		[WD, 'CN-N40.daily-three-hour-cap']
	);
	const weekdays = [
		'02',
		'03',
		'04',
		'05',
		'06',
		'09',
		'10',
		'11',
		'12',
		'13',
		'16',
		'17',
		'18'
	].map((d) => `2026-03-${d}`);
	OT(
		'monthly-cap-36h',
		'2026-03',
		weekdays.slice(0, 12).map((date) => ({ date, hours: 3 })),
		[WD, 'CN-N40.monthly-36-hour-cap']
	);
	OT(
		'monthly-cap-37h-warned',
		'2026-03',
		[
			...weekdays.slice(0, 12).map((date) => ({ date, hours: 3 })),
			{ date: weekdays[12]!, hours: 1 }
		],
		[WD, 'CN-N40.monthly-36-hour-cap']
	);
	OT(
		'bonus-outside-overtime-base',
		'2026-03',
		[{ date: '2026-03-03', hours: 2 }],
		[WD, 'CN-SH03.listed-items-excluded', 'CN-N10.ordinary-bonus-joins-wage'],
		{ month: { bonus: 5000 } }
	);
	OT('odd-hour-rate', '2026-03', [{ date: '2026-03-03', hours: 1 }], [WD], {
		employment: { monthlyWage: 20000 },
		contributions: { siBase: 20000, hfBase: 20000 }
	});
	OT('odd-hour-rate-holiday', '2026-01', [{ date: '2026-01-01', hours: 3 }], HOL, {
		employment: { monthlyWage: 12345.67 },
		contributions: { siBase: 12345.67, hfBase: 12345.67 }
	});

	// ── 8. High-temperature allowance (CN-SH19, N26) ──
	for (const period of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
		const inSeason = ['06', '07', '08', '09'].includes(period.slice(5));
		make(
			[
				inSeason ? 'CN-SH19.in-season-300' : 'CN-SH19.out-of-season',
				'CN-N26.shanghai-allowance',
				...(inSeason ? ['CN-SH19.wage-total-and-tax'] : [])
			],
			[`heat-${inSeason ? 'in' : 'out-of'}-season`],
			`exposed in ${period}`,
			period,
			{
				employment: { monthlyWage: 10000 },
				contributions: { siBase: 10000, hfBase: 10000 },
				month: { heatExposed: true }
			}
		);
	}
	make(
		['CN-SH19.contract-figure-above-300', 'CN-SH19.wage-total-and-tax'],
		['heat-contract-above-300'],
		'contract heat figure 500 in July',
		'2026-07',
		{
			employment: { monthlyWage: 10000 },
			contributions: { siBase: 10000, hfBase: 10000 },
			month: { heatExposed: true, heatAllowanceContract: 500 }
		}
	);
	make(['CN-SH19.in-season-300'], ['heat-not-exposed'], 'no exposure in July: nothing', '2026-07', {
		employment: { monthlyWage: 10000 },
		contributions: { siBase: 10000, hfBase: 10000 }
	});
	make(
		['CN-SH19.out-of-season'],
		['heat-december'],
		'exposed in December: out of season',
		'2025-12',
		{ month: { heatExposed: true } }
	);

	// ── 9. Resident cumulative withholding (CN-N09, N38, N16, N54, N11, N44) ──
	const ceilingEe = (() => {
		const st = computePayslip(
			build([], [], '', '2026-01', { contributions: { siBase: 100000, hfBase: 100000 } })
		).statutory;
		return ['PENSION', 'MEDICAL', 'UNEMPLOYMENT', 'HOUSING_FUND'].reduce(
			(t, k) => t + Math.round(st[k]!.employee * 100),
			0
		);
	})();
	for (const seamAt of [36000, 144000, 300000, 420000, 660000, 960000])
		for (const d of seamAt === 36000 ? [-0.01, 0, 0.01] : [0, 0.01]) {
			const w = r2(seamAt + 5000 + ceilingEe / 100 + d);
			make(
				[...TAX],
				[`resident-annual-band-${seamAt}${d > 0 ? '+0.01' : d < 0 ? '-0.01' : ''}`],
				`January taxable ${r2(seamAt + d)}`,
				'2026-01',
				{
					employment: { monthlyWage: w },
					contributions: { siBase: 100000, hfBase: 100000 }
				}
			);
		}
	make([...TAX], ['cumulative-three-months'], '20,000 a month, March cumulative', '2026-03');
	make(
		[...TAX],
		['cumulative-crosses-band'],
		'50,000 a month, September crosses 144,000',
		'2026-09',
		{
			employment: { monthlyWage: 50000 },
			contributions: { siBase: 50000, hfBase: 50000 }
		}
	);
	make(
		[...TAX, 'CN-SH05.ceiling-2025', 'CN-SH05.ceiling-2026'],
		['cumulative-across-si-year'],
		'45,000 a month, June then July base bounds',
		'2026-07',
		{
			employment: { monthlyWage: 45000 },
			contributions: { siBase: 45000, hfBase: 45000 }
		}
	);
	make(
		['CN-N09.no-payroll-refund', ...TAX],
		['no-negative-withholding'],
		'6,000 a month: taxable below zero withholds nothing',
		'2026-04',
		{
			employment: { monthlyWage: 6000 },
			contributions: { siBase: 6000, hfBase: 6000 }
		}
	);
	make(
		['CN-N09.no-payroll-refund', 'CN-N04.unpaid-personal-leave', ...TAX],
		['unpaid-leave-lowers-cumulative'],
		'20,000 with 5 unpaid days in June',
		'2026-06',
		{ month: { unpaidLeaveDays: 5 } }
	);
	for (const [branch, rows, sd] of [
		['child-education-1', ['CN-N16.child-education'], { childEducationChildren: 1 }],
		['child-education-2', ['CN-N16.child-education'], { childEducationChildren: 2 }],
		['infant-care-1', ['CN-N16.infant-care'], { infantCareChildren: 1 }],
		['elder-support-3000', ['CN-N16.elderly-support'], { elderSupport: 3000 }],
		[
			'elder-support-shared-1500',
			['CN-N16.elderly-support', 'CN-N16.sharing-elections'],
			{ elderSupport: 1500 }
		],
		['rent-1500', ['CN-N16.housing-rent', 'CN-N54.capital-city-1500'], { rent: true }],
		['loan-interest-1000', ['CN-N16.housing-loan-interest'], { loanInterest: true }],
		[
			'rent-and-loan-refused',
			['CN-N54.rent-or-loan', 'CN-N16.housing-rent', 'CN-N16.housing-loan-interest'],
			{ rent: true, loanInterest: true }
		],
		[
			'all-classes',
			[
				'CN-N16.child-education',
				'CN-N16.infant-care',
				'CN-N16.elderly-support',
				'CN-N16.housing-rent',
				'CN-N54.capital-city-1500'
			],
			{ childEducationChildren: 1, infantCareChildren: 1, elderSupport: 3000, rent: true }
		]
	] as const)
		make([...rows, 'CN-N09.resident-cumulative'], [branch], `declared ${branch}`, '2026-03', {
			employment: { monthlyWage: 25000 },
			contributions: { siBase: 25000, hfBase: 25000 },
			tax: { specialDeductions: { ...sd } as Scenario['tax']['specialDeductions'] }
		});
	make(
		['CN-N44.first-wage-mid-year'],
		['first-wage-income-july-declared'],
		'first wage income of the year in July: 35,000 deducted',
		'2026-07',
		{
			employment: { hireDate: '2026-07-01', monthlyWage: 30000 },
			contributions: { siBase: 30000, hfBase: 30000 },
			tax: { firstWageIncomeThisYear: true }
		}
	);
	make(
		['CN-N44.first-wage-mid-year', 'CN-N09.resident-cumulative'],
		['first-wage-income-july-undeclared'],
		'July joiner without the declaration: 5,000',
		'2026-07',
		{
			employment: { hireDate: '2026-07-01', monthlyWage: 30000 },
			contributions: { siBase: 30000, hfBase: 30000 }
		}
	);
	make(
		['CN-N44.first-wage-mid-year', 'CN-N02.day-conversion-21-75'],
		['first-wage-income-mid-month'],
		'declared first income, joins 2026-08-17',
		'2026-08',
		{
			employment: { hireDate: '2026-08-17', monthlyWage: 30000 },
			contributions: { siBase: 30000, hfBase: 30000 },
			tax: { firstWageIncomeThisYear: true }
		}
	);
	make(
		['CN-N44.first-wage-mid-year'],
		['first-wage-income-august-second-month'],
		'declared, second month after a July join',
		'2026-08',
		{
			employment: { hireDate: '2026-07-01', monthlyWage: 30000 },
			contributions: { siBase: 30000, hfBase: 30000 },
			tax: { firstWageIncomeThisYear: true }
		}
	);
	for (const [period, branch] of [
		['2026-01', 'annual-60k-january'],
		['2026-03', 'annual-60k-march']
	] as const)
		make(['CN-N11'], [branch], '10,000 a month on the 60,000 election', period, {
			employment: { monthlyWage: 10000 },
			contributions: { siBase: 10000, hfBase: 10000 },
			tax: { annual60kElection: true }
		});
	make(
		['CN-N11', 'CN-N09.resident-cumulative'],
		['annual-60k-not-elected'],
		'10,000 in January without the election',
		'2026-01',
		{
			employment: { monthlyWage: 10000 },
			contributions: { siBase: 10000, hfBase: 10000 }
		}
	);

	// ── 10. Non-resident, foreign and HK/Macao/Taiwan workers (CN-N09, N38, N25, N48, SH41) ──
	const NR = [
		'CN-N09.tax-residence',
		'CN-N09.non-resident-monthly',
		'CN-N38.non-resident-monthly-table'
	];
	for (const seamAt of [3000, 12000, 25000, 35000, 55000, 80000])
		for (const d of [0, 0.01])
			make(
				[...NR, 'CN-N25.ordinary-social-insurance'],
				[`non-resident-band-${seamAt}${d ? '+0.01' : ''}`],
				`non-resident wage − 5,000 = ${r2(seamAt + d)}`,
				'2026-03',
				{
					worker: { citizenship: 'FOREIGN', taxResident: false },
					employment: { monthlyWage: r2(seamAt + 5000 + d) },
					contributions: { siBase: r2(seamAt + 5000 + d) }
				}
			);
	make(
		[...NR],
		['non-resident-ignores-special-deductions'],
		'non-resident with declared claims: none taken',
		'2026-03',
		{
			worker: { citizenship: 'FOREIGN', taxResident: false },
			tax: {
				specialDeductions: {
					childEducationChildren: 2,
					rent: true,
					loanInterest: true,
					infantCareChildren: 0,
					elderSupport: 0
				}
			}
		}
	);
	make(
		[...NR, RD],
		['non-resident-overtime-in-month'],
		'non-resident: overtime joins the month',
		'2026-03',
		{
			worker: { citizenship: 'FOREIGN', taxResident: false },
			employment: { monthlyWage: 21750 },
			month: { overtime: [{ date: '2026-03-07', hours: 8 }] }
		}
	);
	make(
		[
			'CN-N25.ordinary-social-insurance',
			'CN-N25.labour-standards',
			'CN-SH41.foreign-by-agreement',
			'CN-N09.resident-cumulative'
		],
		['foreign-resident-no-fund'],
		'foreign tax resident, no fund agreement',
		'2026-03',
		{
			worker: { citizenship: 'FOREIGN' }
		}
	);
	make(
		['CN-N25.ordinary-social-insurance', 'CN-SH41.foreign-by-agreement'],
		['foreign-fund-by-agreement'],
		'foreign worker with the fund agreement',
		'2026-03',
		{
			worker: { citizenship: 'FOREIGN', housingFundAgreement: true }
		}
	);
	make(
		['CN-N48', 'CN-SH41.overseas-pr-hk-mo-tw'],
		['hmt-ordinary-si-no-fund'],
		'Hong Kong resident: ordinary SI, fund only by agreement',
		'2026-08',
		{
			worker: { citizenship: 'HMT' }
		}
	);
	make(
		['CN-N48', 'CN-SH41.overseas-pr-hk-mo-tw'],
		['hmt-fund-by-agreement'],
		'Taiwan resident with the fund agreement',
		'2026-08',
		{
			worker: { citizenship: 'HMT', housingFundAgreement: true }
		}
	);
	make(['CN-N48', ...NR], ['hmt-non-resident'], 'Macao resident, non-resident for tax', '2026-08', {
		worker: { citizenship: 'HMT', taxResident: false }
	});

	// ── 11. Bonuses (CN-N10) ──
	for (const b of [12000, 36000, 36000.01, 144000, 144000.01, 300000.01, 960000.01])
		make(
			['CN-N10.separate-election'],
			[`annual-bonus-separate-${b}`],
			`separate annual bonus ${b}`,
			'2026-03',
			{ month: { annualBonusSeparate: b } }
		);
	make(
		['CN-N10.once-per-year'],
		['annual-bonus-separate-second-use-refused'],
		'second separate bonus in the year',
		'2026-03',
		{
			month: { annualBonusSeparate: 12000 },
			tax: { annualBonusSeparateUsedThisYear: true }
		}
	);
	make(
		['CN-N10.ordinary-bonus-joins-wage', 'CN-N09.resident-cumulative', 'CN-N53.annual-bonus'],
		['ordinary-bonus-joins-wages'],
		'ordinary bonus 12,000 in January',
		'2026-01',
		{ month: { bonus: 12000 } }
	);
	// Not a tracker row: MOF/STA 2019 No. 35 item 3(2), a non-resident's multi-month bonus, once a year.
	for (const b of [60000, 18000, 18000.01])
		make(
			[...NR],
			[`non-resident-multi-month-bonus-${b}`, 'untracked:MOF-STA-2019-35-item-3(2)'],
			`non-resident bonus ${b} over six months`,
			'2026-03',
			{
				worker: { citizenship: 'FOREIGN', taxResident: false },
				employment: { monthlyWage: 30000 },
				contributions: { siBase: 30000 },
				month: { annualBonusSeparate: b }
			}
		);

	// ── 12. Pension recipients and ages (CN-N13, SH41, SH25) ──
	make(
		[
			'CN-N13.pensioned-retiree',
			'CN-SH41.pensioned-retiree',
			'CN-SH43.after-retirement-or-death',
			'CN-SH25.post-retirement-workers'
		],
		['pension-recipient-man'],
		'pensioned retiree aged 63: outside SI and fund',
		'2026-03',
		{
			worker: { birthDate: '1962-08-01', pensionRecipient: true }
		}
	);
	make(
		['CN-N13.pensioned-retiree', 'CN-SH41.pensioned-retiree', 'CN-SH25.post-retirement-workers'],
		['pension-recipient-woman'],
		'pensioned retiree aged 56: outside SI and fund',
		'2026-08',
		{
			worker: { birthDate: '1970-02-10', sex: 'F', pensionRecipient: true }
		}
	);
	for (const [sex, age] of [
		['M', 60],
		['F', 50],
		['F', 55],
		['M', 63]
	] as const)
		for (const [label, shift] of [
			['-1d', 1],
			['exact', 0],
			['+1d', -1]
		] as const) {
			// age on the period's first day: born `age` years before 2026-03-01, shifted a day
			const born = new Date(Date.UTC(2026 - age, 2, 1 + shift)).toISOString().slice(0, 10);
			make(
				['CN-N13.coverage-during-delay', 'CN-N13.cohort-retirement-age'],
				[`age-${sex}-${age}${label}-not-pensioned`],
				`${sex} aged ${age} ${label}, no pension: still covered`,
				'2026-03',
				{
					worker: { birthDate: born, sex }
				}
			);
		}

	// ── 13. Non-full-time work (CN-N27, SH01, SH41) ──
	for (const [rate, hours] of [
		[25, 80],
		[24.99, 80],
		[40, 60]
	] as const)
		make(
			[
				'CN-N27.hourly-minimum',
				'CN-SH01.hourly-floor',
				'CN-N50.piece-rate-and-hourly',
				'CN-SH41.personal-contributors',
				'CN-N27.injury-cover'
			],
			[`part-time-hourly-${rate}`],
			`${hours} h at ${rate}/h`,
			'2025-12',
			{
				employment: { kind: 'PART_TIME', monthlyWage: 0, hourlyWage: rate },
				month: { partTimeHours: hours }
			}
		);
	make(
		['CN-N27.termination-without-compensation', 'CN-N27.injury-cover'],
		['part-time-ended-no-compensation'],
		'part-time worker dismissed: no compensation',
		'2026-08',
		{
			employment: {
				kind: 'PART_TIME',
				monthlyWage: 0,
				hourlyWage: 30,
				hireDate: '2026-01-01',
				exitDate: '2026-08-31'
			},
			month: { partTimeHours: 90 },
			exit: leave('ART40', { noticeDaysGiven: 0 })
		}
	);

	// ── 14. Annual leave on exit (CN-N05, N06, N18) ──
	const quit = (
		branch: string,
		rows: string[],
		period: string,
		hireDate: string,
		exitDate: string,
		prior: number,
		taken = 0,
		W = 22000
	) =>
		make(
			[
				'CN-N06.unused-on-exit-300',
				'CN-N18.exit-entitlement',
				'CN-N05.part-year-proration',
				'CN-N06.day-wage-twelve-month-average',
				...rows
			],
			[branch],
			`${branch}: ${hireDate} – ${exitDate}, ${prior} prior months`,
			period,
			{
				worker: { priorServiceMonths: prior },
				employment: { hireDate, exitDate, monthlyWage: W },
				contributions: { siBase: W, hfBase: W },
				exit: leave('ART37', { annualLeaveTakenThisYear: taken })
			}
		);
	// own service 2020-01-01 – 2026-08-14 is 79 whole months: prior 40/41 → 119/120, 160/161 → 239/240
	const B5 = 'CN-N05.band-1-to-10-years-5-days';
	const B10 = 'CN-N05.band-10-to-20-years-10-days';
	const B15 = 'CN-N05.band-20-years-15-days';
	const PRIOR = 'CN-N05.prior-employer-service';
	quit('leave-10y-72-days', [B10], '2026-03', '2016-03-01', '2026-03-13', 0);
	quit(
		'leave-under-12-months',
		['CN-N05.qualifying-twelve-months'],
		'2026-08',
		'2025-09-01',
		'2026-08-14',
		0
	);
	quit(
		'leave-12-months-with-prior',
		['CN-N05.qualifying-twelve-months', PRIOR, B5],
		'2026-08',
		'2025-09-01',
		'2026-08-14',
		1
	);
	quit('leave-tier-119-months', [PRIOR, B5], '2026-08', '2020-01-01', '2026-08-14', 40);
	quit('leave-tier-120-months', [PRIOR, B10], '2026-08', '2020-01-01', '2026-08-14', 41);
	quit('leave-tier-239-months', [PRIOR, B10], '2026-08', '2020-01-01', '2026-08-14', 160);
	quit('leave-tier-240-months', [PRIOR, B15], '2026-08', '2020-01-01', '2026-08-14', 161);
	quit(
		'leave-taken-exceeds-no-clawback',
		['CN-N06.no-clawback', 'CN-N18.no-clawback', B5],
		'2026-08',
		'2020-01-01',
		'2026-08-14',
		0,
		5
	);
	quit('leave-partly-taken', [B10], '2026-07', '2015-01-01', '2026-07-31', 0, 2);
	quit('leave-joined-this-year', [PRIOR, B5], '2026-08', '2026-03-01', '2026-08-14', 24);
	quit('leave-exit-on-1st', [B5], '2026-07', '2018-01-01', '2026-07-01', 0);
	quit('leave-exit-on-last-day', [B5], '2026-08', '2018-01-01', '2026-08-31', 0);
	quit('leave-hired-in-exit-month', [PRIOR, B5], '2026-08', '2026-08-01', '2026-08-20', 60);

	// ── 15. Economic compensation and its tax (CN-N12, N41, N39, SH50, SH-A2) ──
	const fire = (
		branch: string,
		rows: string[],
		period: string,
		hireDate: string,
		exitDate: string,
		ground: Ground,
		W = 22000,
		extra: Partial<NonNullable<Scenario['exit']>> = {}
	) =>
		make(
			[...SEVERANCE, 'CN-N39.termination-lump-sum', ...rows],
			[branch],
			`${branch}: ${hireDate} – ${exitDate}, ${ground}, wage ${W}`,
			period,
			{
				employment: { hireDate, exitDate, monthlyWage: W },
				contributions: { siBase: W, hfBase: W },
				exit: leave(ground, { annualLeaveTakenThisYear: 15, ...extra })
			}
		);
	const YRS = 'CN-N41.severance-whole-years';
	const SIX = 'CN-N41.severance-six-to-twelve-months';
	const UNDER = 'CN-N41.severance-under-six-months';
	const AVG26 = ['CN-SH50.average-2025-for-2026-exits', 'CN-SH50.uncapped-earner'];
	const CAP = [
		'CN-N12.high-earner-cap',
		'CN-SH50.three-times-wage-cap',
		'CN-SH50.twelve-year-cap',
		'CN-SH50.average-2025-for-2026-exits'
	];
	for (const g of [
		'ART36_EMPLOYER',
		'ART36_EMPLOYEE',
		'ART37',
		'ART38',
		'ART39',
		'ART40',
		'ART41',
		'ART44_EXPIRY',
		'ART87'
	] as const)
		fire(
			`ground-${g}`,
			[
				YRS,
				SIX,
				...(g === 'ART87' ? ['CN-N12.unlawful-termination', 'CN-N41.art87-double'] : []),
				...(g === 'ART44_EXPIRY' ? ['CN-N41.fixed-term-expiry'] : []),
				...(g === 'ART37' ? ['CN-N41.employee-notice'] : [])
			],
			'2026-06',
			'2020-01-01',
			'2026-06-30',
			g
		);
	const NOTICE = ['CN-N12.termination-notice', 'CN-N41.art40-notice-or-pay'];
	fire('art40-notice-29-days', NOTICE, '2026-06', '2020-01-01', '2026-06-30', 'ART40', 22000, {
		noticeDaysGiven: 29
	});
	fire('art40-no-notice', NOTICE, '2026-06', '2020-01-01', '2026-06-30', 'ART40', 22000, {
		noticeDaysGiven: 0
	});
	fire(
		'art44-renewal-refused',
		['CN-N41.fixed-term-expiry'],
		'2026-06',
		'2020-01-01',
		'2026-06-30',
		'ART44_EXPIRY',
		22000,
		{ renewalOfferRefused: true }
	);
	fire('tenure-5-months', [UNDER], '2026-06', '2026-02-01', '2026-06-30', 'ART41');
	fire('tenure-6-months', [SIX], '2026-06', '2026-01-01', '2026-06-30', 'ART41');
	fire('tenure-5-months-15-days', [UNDER], '2026-07', '2026-02-01', '2026-07-15', 'ART41');
	fire('tenure-6y-5m-15d', [YRS, UNDER], '2026-07', '2020-02-01', '2026-07-15', 'ART41');
	fire('tenure-6y-6m', [YRS, SIX], '2026-06', '2020-01-01', '2026-06-30', 'ART41');
	fire('tenure-3y-exact', [YRS], '2026-06', '2023-07-01', '2026-06-30', 'ART41');
	fire('tenure-3y-15-days', [YRS, UNDER], '2026-07', '2023-07-01', '2026-07-15', 'ART41');
	fire(
		'tenure-2y-9m-uncapped',
		[YRS, SIX, ...AVG26],
		'2026-08',
		'2023-12-01',
		'2026-08-31',
		'ART41',
		20000
	);
	fire('capped-earner-15y', [YRS, ...CAP], '2026-06', '2011-07-01', '2026-06-30', 'ART41', 50000);
	fire(
		'capped-earner-15y-no-notice',
		[YRS, ...CAP, ...NOTICE],
		'2026-06',
		'2011-07-01',
		'2026-06-30',
		'ART40',
		50000,
		{ noticeDaysGiven: 0 }
	);
	fire(
		'capped-earner-art87',
		[...CAP, 'CN-N41.art87-double', 'CN-N12.unlawful-termination'],
		'2026-06',
		'2011-07-01',
		'2026-06-30',
		'ART87',
		50000
	);
	fire('cap-seam-at-3x', [YRS, ...AVG26], '2026-06', '2020-01-01', '2026-06-30', 'ART41', 37731);
	fire('cap-seam-3x+0.01', [YRS, ...CAP], '2026-06', '2020-01-01', '2026-06-30', 'ART41', 37731.01);
	fire('capped-earner-11y', [YRS, ...CAP], '2026-06', '2015-07-01', '2026-06-30', 'ART41', 50000);
	fire(
		'exemption-seam-excess-36000',
		[YRS, ...AVG26],
		'2026-06',
		'2008-07-01',
		'2026-06-30',
		'ART41',
		27154
	);
	fire(
		'exemption-seam-excess-36000.18',
		[YRS, ...AVG26],
		'2026-06',
		'2008-07-01',
		'2026-06-30',
		'ART41',
		27154.01
	);
	fire(
		'exemption-exactly-used',
		[YRS, ...AVG26],
		'2026-06',
		'2008-07-01',
		'2026-06-30',
		'ART41',
		25154
	);
	fire(
		'exit-2025-on-2024-average',
		[
			'CN-SH50.average-2024-for-2025-exits',
			'CN-SH50.three-times-wage-cap',
			UNDER,
			'CN-SH-A2.art47-average'
		],
		'2025-12',
		'2025-12-01',
		'2025-12-31',
		'ART41',
		50000
	);
	fire(
		'exit-2025-uncapped',
		[
			'CN-SH50.average-2024-for-2025-exits',
			'CN-SH50.uncapped-earner',
			UNDER,
			'CN-SH-A2.art47-average'
		],
		'2025-12',
		'2025-12-01',
		'2025-12-31',
		'ART41',
		20000
	);
	fire(
		'hired-in-exit-month',
		[
			'CN-SH-A2.art47-average',
			'CN-SH50.average-2024-for-2025-exits',
			'CN-SH50.three-times-wage-cap',
			UNDER,
			'CN-N02.day-conversion-21-75'
		],
		'2025-12',
		'2025-12-01',
		'2025-12-15',
		'ART41',
		50000
	);
	fire(
		'hired-in-exit-month-no-notice',
		[
			'CN-SH-A2.art47-average',
			'CN-SH-A2.art20-previous-month',
			...NOTICE,
			UNDER,
			'CN-N02.day-conversion-21-75'
		],
		'2025-12',
		'2025-12-01',
		'2025-12-15',
		'ART40',
		22000,
		{ noticeDaysGiven: 0 }
	);
	fire(
		'hired-in-exit-month-2026',
		['CN-SH-A2.art47-average', UNDER, 'CN-N02.day-conversion-21-75'],
		'2026-08',
		'2026-08-03',
		'2026-08-21',
		'ART41',
		11000
	);
	fire(
		'mid-month-exit-mar-2026',
		[
			...CAP,
			UNDER,
			'CN-N06.unused-on-exit-300',
			'CN-N18.exit-entitlement',
			'CN-N05.band-1-to-10-years-5-days',
			'CN-N02.day-conversion-21-75'
		],
		'2026-03',
		'2025-10-01',
		'2026-03-13',
		'ART41',
		50000,
		{ annualLeaveTakenThisYear: 0 }
	);
	fire(
		'art87-short-service',
		['CN-N41.art87-double', 'CN-N12.unlawful-termination', UNDER],
		'2026-08',
		'2026-03-01',
		'2026-08-31',
		'ART87',
		18000
	);
	fire(
		'severance-with-leave-pay',
		[
			YRS,
			SIX,
			'CN-N06.unused-on-exit-300',
			'CN-N18.exit-entitlement',
			'CN-N05.band-1-to-10-years-5-days'
		],
		'2026-06',
		'2019-01-01',
		'2026-06-30',
		'ART41',
		22000,
		{ annualLeaveTakenThisYear: 0 }
	);

	// ── 16. Bonus and overtime of earlier months in the 12-month averages (CN-N19, N06, SH50) ──
	make(
		[...SEVERANCE, 'CN-N19.severance-wage-base', YRS, SIX],
		['severance-average-includes-bonus'],
		'22,000 + a 12,000 February bonus: average 23,000',
		'2026-06',
		{
			employment: { hireDate: '2020-01-01', exitDate: '2026-06-30', monthlyWage: 22000 },
			contributions: { siBase: 22000, hfBase: 22000 },
			earlier: [{ ym: '2026-02', bonus: 12000 }],
			exit: leave('ART41', { annualLeaveTakenThisYear: 15 })
		}
	);
	make(
		[...SEVERANCE, YRS, ...AVG26],
		['severance-average-with-bonus-at-3x'],
		'37,000 + 8,772 bonus: average exactly 37,731, uncapped',
		'2026-06',
		{
			employment: { hireDate: '2020-01-01', exitDate: '2026-06-30', monthlyWage: 37000 },
			contributions: { siBase: 37000, hfBase: 37000 },
			earlier: [{ ym: '2026-03', bonus: 8772 }],
			exit: leave('ART41', { annualLeaveTakenThisYear: 15 })
		}
	);
	make(
		[...SEVERANCE, YRS, ...CAP],
		['severance-average-with-bonus-3x+0.01'],
		'37,000 + 8,772.12 bonus: average 37,731.01, capped',
		'2026-06',
		{
			employment: { hireDate: '2020-01-01', exitDate: '2026-06-30', monthlyWage: 37000 },
			contributions: { siBase: 37000, hfBase: 37000 },
			earlier: [{ ym: '2026-03', bonus: 8772.12 }],
			exit: leave('ART41', { annualLeaveTakenThisYear: 15 })
		}
	);
	make(
		[
			'CN-N06.day-wage-twelve-month-average',
			'CN-N06.unused-on-exit-300',
			'CN-N18.exit-entitlement',
			B10
		],
		['leave-day-wage-includes-bonus'],
		'22,000 + 12,000 March bonus: leave day wage on 23,000',
		'2026-06',
		{
			employment: { hireDate: '2015-01-01', exitDate: '2026-06-30', monthlyWage: 22000 },
			contributions: { siBase: 22000, hfBase: 22000 },
			earlier: [{ ym: '2026-03', bonus: 12000 }],
			exit: leave('ART37')
		}
	);
	make(
		['CN-N06.day-wage-twelve-month-average', 'CN-N06.unused-on-exit-300', B10, WD],
		['leave-day-wage-excludes-overtime'],
		'22,000 + April overtime: leave day wage on 22,000',
		'2026-06',
		{
			employment: { hireDate: '2015-01-01', exitDate: '2026-06-30', monthlyWage: 22000 },
			contributions: { siBase: 22000, hfBase: 22000 },
			earlier: [
				{
					ym: '2026-04',
					overtime: [
						{ date: '2026-04-07', hours: 3 },
						{ date: '2026-04-08', hours: 3 }
					]
				},
				{ ym: '2026-03', bonus: 12000 }
			],
			exit: leave('ART37')
		}
	);

	// ── 17. Early and internal retirement (CN-N39) ──
	for (const [subsidy, years] of [
		[240000, 4],
		[384000, 4],
		[384000.04, 4],
		[500000, 4],
		[1000000, 3]
	] as const)
		make(
			['CN-N39.early-retirement', 'CN-N04.exit-settlement'],
			[`early-retirement-${subsidy}-over-${years}`],
			`early-retirement subsidy ${subsidy} over ${years} years`,
			'2026-06',
			{
				worker: { birthDate: '1970-06-15' },
				employment: { hireDate: '2000-01-01', exitDate: '2026-06-30' },
				exit: leave('RETIREMENT_EARLY', {
					annualLeaveTakenThisYear: 15,
					earlyRetirement: { subsidy, years }
				})
			}
		);
	for (const [W, lump, months] of [
		[10000, 120000, 24],
		[20000, 60000, 12],
		[8000, 12000, 36]
	] as const)
		make(
			['CN-N39.internal-retirement'],
			[`internal-retirement-${lump}-over-${months}`],
			`internal retirement: ${W} wage + ${lump} over ${months} months`,
			'2026-01',
			{
				worker: { birthDate: '1968-03-10' },
				employment: { monthlyWage: W },
				contributions: { siBase: W, hfBase: W },
				month: { internalRetirement: { lump, months } }
			}
		);

	// ── 18. Probation (CN-N12, N19, N41, SH04, N27) ──
	const PROB = ['CN-N12.probation', 'CN-N19.probation-limits'];
	for (const [term, served, row] of [
		[2, 1, 'CN-N41.probation-none-short-or-part-time'],
		[3, 1, 'CN-N41.probation-three-months-to-one-year'],
		[3, 2, 'CN-N41.probation-three-months-to-one-year'],
		[11, 2, 'CN-N41.probation-three-months-to-one-year'],
		[12, 2, 'CN-N41.probation-one-to-three-years'],
		[12, 3, 'CN-N41.probation-one-to-three-years'],
		[35, 3, 'CN-N41.probation-one-to-three-years'],
		[36, 6, 'CN-N41.probation-three-years-or-open-ended'],
		[36, 7, 'CN-N41.probation-three-years-or-open-ended'],
		[null, 6, 'CN-N41.probation-three-years-or-open-ended'],
		[null, 8, 'CN-N41.probation-three-years-or-open-ended']
	] as const)
		make(
			[...PROB, row],
			[`probation-term-${term ?? 'open-ended'}-served-${served}`],
			`term ${term ?? 'open-ended'}, ${served} months' probation served`,
			'2026-03',
			{
				employment: { hireDate: '2025-12-01', monthlyWage: 10000 },
				contributions: { siBase: 10000, hfBase: 10000 },
				claims: { probation: { termMonths: term, servedMonths: served, postProbationWage: 10000 } }
			}
		);
	make(
		[
			...PROB,
			'CN-N41.probation-none-short-or-part-time',
			'CN-N27.no-probation',
			'CN-N27.injury-cover'
		],
		['probation-part-time'],
		'part-time worker, one month of probation',
		'2026-03',
		{
			employment: { hireDate: '2026-01-01', kind: 'PART_TIME', monthlyWage: 0, hourlyWage: 40 },
			month: { partTimeHours: 80 },
			claims: { probation: { termMonths: 12, servedMonths: 1, postProbationWage: 3200 } }
		}
	);
	for (const W of [8000, 7999.99, 7000])
		make(
			['CN-N19.probation-wage-floor', 'CN-SH04.probation-80pct', 'CN-N12.probation'],
			[`probation-wage-${W}-of-10000`],
			`probation wage ${W} against 10,000 agreed`,
			'2026-03',
			{
				employment: { hireDate: '2026-02-01', monthlyWage: W },
				contributions: { siBase: W, hfBase: W },
				claims: { probationWageShortfall: { agreedWage: 10000 } }
			}
		);

	// ── 19. Written and open-ended contracts (CN-N12, N19, N41) ──
	const NWC = [
		'CN-N12.no-written-contract',
		'CN-N19.written-contract-double-wage',
		'CN-N41.no-written-contract-double-wage'
	];
	for (const [hire, signed, period, branch] of [
		['2025-12-01', '2025-12-15', '2026-03', 'signed-within-first-month'],
		['2025-12-01', '2026-01-01', '2026-03', 'signed-on-first-month-end'],
		['2025-12-01', '2026-03-01', '2026-03', 'signed-after-3-months'],
		['2025-02-01', '2026-02-01', '2026-02', 'signed-at-one-year'],
		['2025-01-01', null, '2026-01', 'never-signed']
	] as const)
		make(
			[...NWC, ...(signed === null ? ['CN-N41.deemed-open-ended'] : [])],
			[`no-written-contract-${branch}`],
			`hired ${hire}, contract signed ${signed ?? 'never'}`,
			period,
			{
				employment: { hireDate: hire, monthlyWage: 10000 },
				contributions: { siBase: 10000, hfBase: 10000 },
				claims: { noWrittenContract: { signedOn: signed } }
			}
		);
	for (const [due, concluded] of [
		['2026-01-01', '2026-04-01'],
		['2026-04-01', '2026-04-01']
	] as const)
		make(
			['CN-N41.open-ended-second-wage'],
			[`open-ended-due-${due}-concluded-${concluded}`],
			`open-ended due ${due}, concluded ${concluded}`,
			'2026-04',
			{
				employment: { hireDate: '2016-01-01', monthlyWage: 10000 },
				contributions: { siBase: 10000, hfBase: 10000 },
				claims: { openEnded: { dueOn: due, concludedOn: concluded } }
			}
		);

	// ── 20. Maternity (CN-N20, SH21 to 30 Jun 2026, SH14 from 1 Jul 2026, SH13) ──
	for (const [period, inst] of [
		['2026-03', 'CN-SH21'],
		['2026-08', 'CN-SH14']
	] as const) {
		const mat = (cumul: number, consec: number, excess = 0, allowance = 15000) => ({
			from: `${period}-01`,
			to: addDaysIso(`${period}-01`, 157),
			allowance,
			insuredMonthsCumulative: cumul,
			insuredMonthsConsecutive: consec,
			unitAverageExcessOverCap: excess
		});
		const base = [
			'CN-N20.insured-benefit-or-wage',
			'CN-N20.maternity-98-days',
			'CN-SH13.birth-plus-60',
			`${inst}.shortfall-offset`,
			...(inst === 'CN-SH14' ? ['CN-SH14.si-continues'] : [])
		];
		const hire = (months: number) => {
			const [y, m] = period.split('-').map(Number);
			return new Date(Date.UTC(y!, m! - 1 - months, 1)).toISOString().slice(0, 10);
		};
		make(base, ['maternity-shortfall'], `20,000 wage, 15,000 allowance in ${period}`, period, {
			worker: { sex: 'F' },
			month: { maternity: mat(24, 24) }
		});
		// Gross falls below the employee shares: CN-SH43.worker-share-shortfall (the worker supplies the difference).
		make(
			[...base, 'CN-SH43.worker-share-shortfall'],
			['maternity-allowance-near-wage'],
			`20,000 wage, 19,999.99 allowance in ${period}`,
			period,
			{
				worker: { sex: 'F' },
				month: { maternity: mat(24, 24, 0, 19999.99) }
			}
		);
		for (const [cumul, consec] of [
			[6, 6],
			[11, 8],
			[11, 9],
			[12, 3]
		] as const)
			make(
				[...base, `${inst}.fund-threshold-advance`],
				[`maternity-insured-${cumul}-cumulative-${consec}-consecutive`],
				`${cumul}/${consec} insured months in ${period}`,
				period,
				{
					worker: { sex: 'F' },
					employment: { hireDate: hire(consec) },
					month: { maternity: mat(cumul, consec) }
				}
			);
		make(
			[...base, `${inst}.above-cap-excess`],
			['maternity-above-cap'],
			`unit average 5,000 a month above the cap in ${period}`,
			period,
			{
				worker: { sex: 'F' },
				employment: { monthlyWage: 45000 },
				contributions: { siBase: 45000, hfBase: 45000 },
				month: { maternity: mat(24, 24, 5000, 30000) }
			}
		);
	}

	// ── 21. Paid leave at the normal wage (CN-N04, N06, N21, N51, SH13, SH17, SH51) ──
	for (const [code, from, to, rows, detail] of [
		[
			'MARRIAGE_LEAVE',
			'2026-03-02',
			'2026-03-11',
			['CN-N51.marriage-leave', 'CN-SH13.marriage-plus-7'],
			'3 + 7 days'
		],
		['FUNERAL_LEAVE', '2026-03-02', '2026-03-04', ['CN-N51.funeral-leave'], 'parent'],
		[
			'FUNERAL_LEAVE',
			'2026-03-09',
			'2026-03-11',
			['CN-SH17.parent-in-law-funeral'],
			'parent-in-law'
		],
		['PATERNITY_LEAVE', '2026-03-02', '2026-03-11', ['CN-SH13.partner-leave-10'], '10 days'],
		['CHILDCARE_LEAVE', '2026-03-02', '2026-03-06', ['CN-SH13.childcare-5'], 'child under three'],
		[
			'ANNUAL_LEAVE',
			'2026-03-02',
			'2026-03-06',
			['CN-N06.leave-taken-normal-pay', 'CN-N05.band-1-to-10-years-5-days'],
			'5 days'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-03',
			['CN-SH51.iud-insertion'],
			'IUD insertion'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-03',
			['CN-SH51.iud-removal'],
			'IUD removal'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-02',
			['CN-SH51.follow-up'],
			// the harness keys the catalogue event from the detail: IUD_FOLLOWUP
			'IUD followup'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-08',
			['CN-SH51.vasectomy'],
			'vasectomy'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-31',
			['CN-SH51.tubal-ligation'],
			'tubal ligation'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-06',
			['CN-SH51.implant-insertion'],
			'implant insertion'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-04',
			['CN-SH51.implant-removal'],
			'implant removal'
		],
		[
			'FAMILY_PLANNING_PROCEDURE_LEAVE',
			'2026-03-02',
			'2026-03-06',
			['CN-SH51.diagnostic-curettage'],
			'diagnostic curettage'
		],
		[
			'WORK_INJURY_LEAVE',
			'2026-03-01',
			'2026-03-31',
			['CN-N21.stop-work-original-wage', 'CN-SH20.twelve-month-average-pay'],
			'certified stop-work period'
		]
	] as const)
		make(
			['CN-N04.paid-civic-and-leave-time', ...rows],
			[`paid-leave-${code}-${detail}`],
			`${code} ${from}–${to} (${detail}): pay unchanged`,
			'2026-03',
			{
				worker: {
					sex: [
						'tubal ligation',
						'IUD insertion',
						'IUD removal',
						'IUD followup',
						'implant insertion',
						'implant removal',
						'diagnostic curettage'
					].includes(detail)
						? 'F'
						: 'M'
				},
				month: { paidLeave: [{ code, from, to, detail }] }
			}
		);

	// ── 22. Non-wage receipts (CN-N55) ──
	make(
		[
			'CN-N55.one-child-subsidy',
			'CN-N55.childcare-subsidy',
			'CN-N55.travel-allowance',
			'CN-N55.missed-meal-subsidy'
		],
		['non-wage-receipts'],
		'one-child, childcare, travel and meal receipts: untaxed, outside every base',
		'2026-03',
		{
			month: {
				nonWage: {
					ONE_CHILD_SUBSIDY: 10,
					CHILDCARE_SUBSIDY: 200,
					TRAVEL_ALLOWANCE: 300,
					MISSED_MEAL_SUBSIDY: 150
				}
			}
		}
	);

	// ── 23. Randomised in-bound workers (every standard branch together) ──
	for (let i = 0; i < 20; i++) {
		const period = (['2026-01', '2026-03', '2026-05', '2026-07', '2026-08', '2026-09'] as const)[
			i % 6
		]!;
		const W = wage(8000, 60000);
		make(
			[
				...siRows(period),
				...hfRows(period),
				...TAX,
				...(i % 5 >= 2
					? [period <= '2026-06' ? 'CN-SH09.supplementary-rate' : 'CN-SH40.supplementary-share']
					: [])
			],
			['random-in-bound'],
			`wage ${W} in ${period}`,
			period,
			{
				employment: { monthlyWage: W },
				contributions: {
					siBase: wage(7000, 40000),
					hfBase: wage(2600, 40000),
					hfRate: [0.05, 0.06, 0.07][i % 3]!,
					hfSupplementaryRate: [0, 0, 0.01, 0.03, 0.05][i % 5]!,
					injuryRate: [0.002, 0.004, 0.007, 0.009, 0.011, 0.013, 0.016, 0.019][i % 8]!
				},
				tax: {
					specialDeductions: {
						childEducationChildren: i % 3,
						infantCareChildren: 0,
						elderSupport: i % 4 === 0 ? 3000 : 0,
						rent: i % 2 === 1,
						loanInterest: false
					}
				}
			}
		);
	}
	return out;
}

const addDaysIso = (iso: string, n: number) =>
	new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
