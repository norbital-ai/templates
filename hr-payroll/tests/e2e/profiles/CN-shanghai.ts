/**
 * Synthetic CN-shanghai payroll scenarios for the independent oracle (`tests/e2e/oracle/CN-shanghai.ts`).
 *
 * Deterministic: the only variety comes from a fixed-seed mulberry32, so every run yields the same list. Each scenario
 * names the `docs/inventory/china.csv` row ids and the branch it exercises.
 *
 * Shape → probe harness (`tests/e2e/payroll-probe.ts`): `profile` is the case's settings lineage, `period` the run's
 * period, `runs` the earlier same-employer periods that must be run first (cumulative withholding), `worker` /
 * `employment` / `contributions` / `tax` the employee, employment, terms and declared facts (tracker config paths:
 * `statutory_contributions:*` bases, `facts.housing_fund_rate`, `facts.housing_fund_supplementary_rate`,
 * `facts.injury_rate`, `facts.unemployment_employer_rate`, `exit_facts.*`), `month` the period's time entries
 * (overtime, unpaid leave, part-time hours) and ad hoc lines (`BONUS`, `ANNUAL_BONUS_SEPARATE`, `HEAT_ALLOWANCE`, the
 * CN-N55 receipts), `exit` the separation. `computePayslip(scenario).lines` is the case's `expected[].lines`, and
 * `.refused` its `refused`.
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
	| 'ART87'; // unlawful termination

export type Scenario = {
	id: string;
	profile: 'CN-shanghai';
	rows: string[];
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
		overtime: { date: string; hours: number; compensatoryRest?: boolean }[];
		heatExposed: boolean;
		heatAllowanceContract: number;
		bonus: number;
		annualBonusSeparate: number;
		nonWage: Partial<Record<'ONE_CHILD_SUBSIDY' | 'CHILDCARE_SUBSIDY' | 'TRAVEL_ALLOWANCE' | 'MISSED_MEAL_SUBSIDY', number>>;
		partTimeHours: number;
	};
	exit: null | { ground: Ground; noticeDaysGiven: number; renewalOfferRefused: boolean; annualLeaveTakenThisYear: number };
};

type Patch = {
	[K in 'worker' | 'employment' | 'contributions' | 'tax' | 'month']?: Partial<Scenario[K]>;
} & { exit?: Scenario['exit'] };

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function generateProfiles(): Scenario[] {
	const rand = mulberry32(0x5a_2026);
	/** A deterministic wage in [lo, hi), whole yuan. */
	const wage = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo));
	const out: Scenario[] = [];
	let n = 0;
	/** A scenario, not yet registered. */
	const build = (rows: string[], branches: string[], description: string, period: string, p: Patch = {}) => {
		const hire = period === '2025-12' ? '2025-12-01' : '2024-01-01';
		const s: Scenario = {
			id: 'unregistered',
			profile: 'CN-shanghai',
			rows,
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
			employment: { hireDate: hire, exitDate: null, kind: 'FULL_TIME', monthlyWage: 20000, ...p.employment },
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
				...p.month
			},
			exit: p.exit === undefined ? null : p.exit
		};
		s.runs = runsFor(s);
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

	// ── 1. Social-insurance base bounds, both contribution years (CN-SH05, N07, SH06) ──
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
			make(['CN-SH05', 'CN-N07', 'CN-SH06', 'CN-X-SI-ROUNDING'], [`si-base-${year}-${label}`], `SI base ${b} in ${period}`, period, {
				employment: { monthlyWage: Math.max(b, 10000) },
				contributions: { siBase: b }
			});
	}

	// ── 2. Scheme rates across the instrument dates (CN-SH06, N07): Dec 2025 unemployment 0.5/0.5 to 31 Dec 2025,
	//       medical instrument change 28 Feb / 1 Mar 2026, SI year 30 Jun / 1 Jul 2026 ──
	for (const period of ['2025-12', '2026-01', '2026-02', '2026-03', '2026-06', '2026-07', '2026-09'])
		make(['CN-SH06', 'CN-N07', 'CN-X-SI-ROUNDING'], [`rates-${period}`], `standard 20,000 worker in ${period}`, period);
	make(['CN-SH06'], ['unemployment-employer-2026-recorded-0.01'], 'recorded 2026 employer unemployment fact 1%', '2026-03', {
		contributions: { unemploymentEmployerRate2026: 0.01 }
	});
	// fen half-up per side: base giving x.xx5 shares
	for (const b of [18865.5, 9431.25, 12345.67])
		make(['CN-X-SI-ROUNDING', 'CN-SH05'], ['si-fen-half-up'], `SI shares on ${b}`, '2026-08', {
			employment: { monthlyWage: 20000 },
			contributions: { siBase: b }
		});

	// ── 3. Work-injury classes I–VIII (CN-SH07) ──
	for (const [cls, rate] of [0.002, 0.004, 0.007, 0.009, 0.011, 0.013, 0.016, 0.019].entries())
		make(['CN-SH07'], [`injury-class-${cls + 1}`], `injury class ${cls + 1} at ${rate * 100}%`, '2026-03', {
			contributions: { injuryRate: rate }
		});

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
		] as const)
			make([year === 2025 ? 'CN-SH09' : 'CN-SH40', 'CN-N08'], [`hf-base-${year}-${label}`], `fund base ${b}`, period, {
				employment: { monthlyWage: Math.max(b, 10000) },
				contributions: { hfBase: b }
			});
		for (const rate of [0.05, 0.06, 0.07])
			make([year === 2025 ? 'CN-SH09' : 'CN-SH40'], [`hf-rate-${rate}`], `fund ${rate * 100}% on 21,750`, period, {
				employment: { monthlyWage: 21750 },
				contributions: { hfBase: 21750, hfRate: rate }
			});
	}
	for (const supp of [0.01, 0.02, 0.03, 0.04, 0.05])
		make(['CN-SH40'], [`hf-supplementary-${supp}`], `7% + ${supp * 100}% supplementary at the 2026 ceiling`, '2026-08', {
			employment: { monthlyWage: 40000 },
			contributions: { hfBase: 40000, hfSupplementaryRate: supp }
		});
	make(['CN-SH09'], ['hf-yuan-round-half-up'], '21,750 × 7% = 1,522.50 → 1,523 each side', '2026-03', {
		employment: { monthlyWage: 21750 },
		contributions: { hfBase: 21750 }
	});
	make(['CN-SH09'], ['hf-yuan-round-down'], '21,749.99 × 7% = 1,522.4993 → 1,522', '2026-03', {
		employment: { monthlyWage: 21750 },
		contributions: { hfBase: 21749.99 }
	});
	make(['CN-SH09'], ['hf-supplementary-2025-5'], '10,010 at 7% + 5%: 701 + 501 each side', '2026-03', {
		employment: { monthlyWage: 10010 },
		contributions: { hfBase: 10010, hfSupplementaryRate: 0.05 }
	});
	make(['CN-SH43', 'CN-N08'], ['hf-first-ever-joining-month'], 'first-ever worker, joining month: no fund', '2026-03', {
		employment: { hireDate: '2026-03-01' },
		contributions: { hfFirstEver: true }
	});
	make(['CN-SH43', 'CN-N08'], ['hf-first-ever-second-month'], 'first-ever worker, second month: charged', '2026-04', {
		employment: { hireDate: '2026-03-01' },
		contributions: { hfFirstEver: true }
	});
	make(['CN-SH43', 'CN-N08', 'CN-N02'], ['hf-first-ever-mid-month-join'], 'first-ever worker joining on the 16th', '2026-03', {
		employment: { hireDate: '2026-03-16' },
		contributions: { hfFirstEver: true }
	});
	make(['CN-SH43', 'CN-N08'], ['hf-transfer-joining-month'], 'transferred worker charged from the first month', '2026-03', {
		employment: { hireDate: '2026-03-01' }
	});
	make(['CN-SH43', 'CN-N08'], ['hf-exit-month'], 'fund still due in a mid-month exit month', '2026-07', {
		employment: { exitDate: '2026-07-15' },
		exit: leave('ART37', { annualLeaveTakenThisYear: 15 })
	});

	// ── 5. Minimum wage net of employee shares (CN-SH01, N50) ──
	const seam = (period: string, rate: number) => {
		const siFloorEe = period >= '2026-07' ? 792.33 : 783.3;
		const start = Math.floor((2740 + siFloorEe) / (1 - rate)) - 5;
		const probe = (w: number) =>
			computePayslip(build([], [], '', period, { employment: { monthlyWage: w }, contributions: { siBase: w, hfBase: w, hfRate: rate } }))
				.refused;
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
				make(['CN-SH01', 'CN-N50'], [`minimum-wage-${label}`], `${x} nets ${label === 'at-seam' ? '≥' : '<'} 2,740 at fund ${rate * 100}%`, period, {
					employment: { monthlyWage: x },
					contributions: { siBase: x, hfBase: x, hfRate: rate }
				});
		}
	make(['CN-SH01', 'CN-N50'], ['minimum-wage-gross-equals-floor'], '2,740 gross is below the floor once shares come off', '2025-12', {
		employment: { monthlyWage: 2740 },
		contributions: { siBase: 2740, hfBase: 2740 }
	});
	make(['CN-SH01', 'CN-SH19', 'CN-N50'], ['minimum-wage-heat-excluded'], '3,700 + 300 heat allowance: allowance outside the test', '2026-07', {
		employment: { monthlyWage: 3700 },
		contributions: { siBase: 3700, hfBase: 3700 },
		month: { heatExposed: true }
	});
	make(['CN-SH01', 'CN-N55', 'CN-N50'], ['minimum-wage-non-wage-excluded'], '3,700 + meal/travel receipts: outside the test', '2026-08', {
		employment: { monthlyWage: 3700 },
		contributions: { siBase: 3700, hfBase: 3700 },
		month: { nonWage: { MISSED_MEAL_SUBSIDY: 400, TRAVEL_ALLOWANCE: 500 } }
	});
	make(['CN-SH01', 'CN-N01', 'CN-N50'], ['minimum-wage-overtime-excluded'], '3,700 + overtime: overtime outside the test', '2026-08', {
		employment: { monthlyWage: 3700 },
		contributions: { siBase: 3700, hfBase: 3700 },
		month: { overtime: [{ date: '2026-08-04', hours: 3 }] }
	});

	// ── 6. Part-month and unpaid leave on the 21.75 day (CN-N02, N04, SH02) ──
	for (const ym of ['2025-12', '2026-03', '2026-07', '2026-08']) {
		const last = 31; // every plain month used here has 31 days
		const W = 21750;
		for (const d of [1, 2, 15, last]) {
			make(['CN-N02', 'CN-N04'], [`joiner-day-${d === last ? 'last' : d === 2 ? '2-workdays-may-exceed-21.75' : d}`], `joins ${ym}-${String(d).padStart(2, '0')}`, ym, {
				employment: { hireDate: `${ym}-${String(d).padStart(2, '0')}`, monthlyWage: W },
				contributions: { siBase: W, hfBase: W }
			});
		}
		const hire = ym === '2025-12' ? '2025-12-01' : '2024-01-01';
		for (const d of [1, 15, last - 1, last])
			make(['CN-N02', 'CN-N04', 'CN-SH02'], [`leaver-day-${d === last ? 'last' : d === last - 1 ? 'second-last' : d}`], `leaves ${ym}-${String(d).padStart(2, '0')}`, ym, {
				employment: { hireDate: hire, exitDate: `${ym}-${String(d).padStart(2, '0')}`, monthlyWage: W },
				contributions: { siBase: W, hfBase: W },
				exit: leave('ART37', { annualLeaveTakenThisYear: 15 })
			});
		for (const days of [1, 3])
			make(['CN-N02', 'CN-N04'], [`unpaid-leave-${days}`], `${days} unpaid day(s) at 21,750 ÷ 21.75`, ym, {
				employment: { hireDate: hire, monthlyWage: W },
				contributions: { siBase: W, hfBase: W },
				month: { unpaidLeaveDays: days }
			});
	}
	make(['CN-N02', 'CN-N04'], ['join-and-leave-same-month'], 'joins 2026-08-10, leaves 2026-08-21', '2026-08', {
		employment: { hireDate: '2026-08-10', exitDate: '2026-08-21' },
		exit: leave('ART37')
	});
	make(['CN-N02'], ['joiner-on-weekend'], 'joins Saturday 2026-08-29', '2026-08', { employment: { hireDate: '2026-08-29' } });
	make(['CN-N02'], ['joiner-on-weekend'], 'joins Sunday 2026-03-29', '2026-03', { employment: { hireDate: '2026-03-29' } });
	make(['CN-N02', 'CN-N04'], ['unpaid-leave-odd-wage'], 'one unpaid day at 12,345.67', '2026-03', {
		employment: { monthlyWage: 12345.67 },
		contributions: { siBase: 12345.67, hfBase: 12345.67 },
		month: { unpaidLeaveDays: 1 }
	});

	// ── 7. Overtime (CN-N01, SH03, N40, N03) ──
	const OT = (branch: string, period: string, overtime: Scenario['month']['overtime'], extra: Patch = {}, rows: string[] = []) =>
		make(['CN-N01', 'CN-SH03', ...rows], [branch], `${branch} in ${period}`, period, {
			...extra,
			employment: { monthlyWage: 21750, ...extra.employment },
			contributions: { siBase: 21750, hfBase: 21750, ...extra.contributions },
			month: { overtime, ...extra.month }
		});
	OT('weekday-150', '2026-03', [{ date: '2026-03-03', hours: 2 }]);
	OT('weekday-150-half-hour', '2026-03', [{ date: '2026-03-04', hours: 0.5 }]);
	OT('rest-day-200', '2026-03', [{ date: '2026-03-07', hours: 8 }]);
	OT('rest-day-compensatory-rest', '2026-03', [{ date: '2026-03-08', hours: 8, compensatoryRest: true }], {}, ['CN-N40']);
	OT('weekday-rest-mix', '2026-03', [
		{ date: '2026-03-10', hours: 3 },
		{ date: '2026-03-14', hours: 6 }
	]);
	OT('holiday-300-new-year', '2026-01', [{ date: '2026-01-01', hours: 8 }], {}, ['CN-N03']);
	OT('bridge-day-rest-200', '2026-01', [{ date: '2026-01-02', hours: 8 }], {}, ['CN-N03']);
	OT('adjusted-workday-extension-150', '2026-01', [{ date: '2026-01-04', hours: 2 }], {}, ['CN-N03']);
	OT('holiday-300-with-time-off', '2026-05', [{ date: '2026-05-01', hours: 8, compensatoryRest: true }], {}, ['CN-N40', 'CN-N03']);
	OT('holiday-300-labour-day-2', '2026-05', [{ date: '2026-05-02', hours: 4 }], {}, ['CN-N03']);
	OT('bridge-day-rest-200-may', '2026-05', [{ date: '2026-05-04', hours: 8 }], {}, ['CN-N03']);
	OT('adjusted-workday-may-9', '2026-05', [{ date: '2026-05-09', hours: 1 }], {}, ['CN-N03']);
	OT('holiday-300-spring-festival-eve', '2026-02', [{ date: '2026-02-16', hours: 8 }], {}, ['CN-N03']);
	OT('spring-festival-bridge-200', '2026-02', [{ date: '2026-02-20', hours: 8 }], {}, ['CN-N03']);
	OT('holiday-300-dragon-boat', '2026-06', [{ date: '2026-06-19', hours: 8 }], {}, ['CN-N03']);
	OT('holiday-300-qingming-sunday', '2026-04', [{ date: '2026-04-05', hours: 8 }], {}, ['CN-N03']);
	OT('holiday-300-mid-autumn', '2026-09', [{ date: '2026-09-25', hours: 8 }], {}, ['CN-N03']);
	OT('mid-autumn-bridge-200', '2026-09', [{ date: '2026-09-26', hours: 8 }], {}, ['CN-N03']);
	OT('adjusted-workday-sep-20', '2026-09', [{ date: '2026-09-20', hours: 2 }], {}, ['CN-N03']);
	OT('daily-cap-3h', '2026-03', [{ date: '2026-03-05', hours: 3 }], {}, ['CN-N40']);
	OT('daily-cap-4h-warned', '2026-03', [{ date: '2026-03-05', hours: 4 }], {}, ['CN-N40']);
	const weekdays = ['02', '03', '04', '05', '06', '09', '10', '11', '12', '13', '16', '17', '18'].map((d) => `2026-03-${d}`);
	OT('monthly-cap-36h', '2026-03', weekdays.slice(0, 12).map((date) => ({ date, hours: 3 })), {}, ['CN-N40']);
	OT('monthly-cap-37h-warned', '2026-03', [...weekdays.slice(0, 12).map((date) => ({ date, hours: 3 })), { date: weekdays[12]!, hours: 1 }], {}, ['CN-N40']);
	OT('bonus-outside-overtime-base', '2026-03', [{ date: '2026-03-03', hours: 2 }], { month: { bonus: 5000 } }, ['CN-N53']);
	OT('odd-hour-rate', '2026-03', [{ date: '2026-03-03', hours: 1 }], { employment: { monthlyWage: 20000 }, contributions: { siBase: 20000, hfBase: 20000 } });
	OT('odd-hour-rate-holiday', '2026-01', [{ date: '2026-01-01', hours: 3 }], { employment: { monthlyWage: 12345.67 }, contributions: { siBase: 12345.67, hfBase: 12345.67 } }, ['CN-N03']);

	// ── 8. High-temperature allowance (CN-SH19, N26) ──
	for (const period of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
		make(['CN-SH19', 'CN-N26'], [`heat-${['06', '07', '08', '09'].includes(period.slice(5)) ? 'in' : 'out-of'}-season`], `exposed in ${period}`, period, {
			employment: { monthlyWage: 10000 },
			contributions: { siBase: 10000, hfBase: 10000 },
			month: { heatExposed: true }
		});
	make(['CN-SH19'], ['heat-contract-above-300'], 'contract heat figure 500 in July', '2026-07', {
		employment: { monthlyWage: 10000 },
		contributions: { siBase: 10000, hfBase: 10000 },
		month: { heatExposed: true, heatAllowanceContract: 500 }
	});
	make(['CN-SH19'], ['heat-not-exposed'], 'no exposure in July: nothing', '2026-07', {
		employment: { monthlyWage: 10000 },
		contributions: { siBase: 10000, hfBase: 10000 }
	});
	make(['CN-SH19'], ['heat-december'], 'exposed in December: out of season', '2025-12', { month: { heatExposed: true } });

	// ── 9. Resident cumulative withholding (CN-N09, N38, N16, N54, N11, N44) ──
	const ceilingEe = (() => {
		const st = computePayslip(build([], [], '', '2026-01', { contributions: { siBase: 100000, hfBase: 100000 } })).statutory;
		return ['PENSION', 'MEDICAL', 'UNEMPLOYMENT', 'HOUSING_FUND'].reduce((t, k) => t + Math.round(st[k]!.employee * 100), 0);
	})();
	for (const seamAt of [36000, 144000, 300000, 420000, 660000, 960000])
		for (const d of seamAt === 36000 ? [-0.01, 0, 0.01] : [0, 0.01]) {
			const w = r2(seamAt + 5000 + ceilingEe / 100 + d);
			make(['CN-N09', 'CN-N38'], [`resident-annual-band-${seamAt}${d > 0 ? '+0.01' : d < 0 ? '-0.01' : ''}`], `January taxable ${r2(seamAt + d)}`, '2026-01', {
				employment: { monthlyWage: w },
				contributions: { siBase: 100000, hfBase: 100000 }
			});
		}
	make(['CN-N09'], ['cumulative-three-months'], '20,000 a month, March cumulative', '2026-03');
	make(['CN-N09', 'CN-N38'], ['cumulative-crosses-band'], '50,000 a month, September crosses 144,000', '2026-09', {
		employment: { monthlyWage: 50000 },
		contributions: { siBase: 50000, hfBase: 50000 }
	});
	make(['CN-N09', 'CN-SH05'], ['cumulative-across-si-year'], '45,000 a month, June then July base bounds', '2026-07', {
		employment: { monthlyWage: 45000 },
		contributions: { siBase: 45000, hfBase: 45000 }
	});
	make(['CN-N09'], ['no-negative-withholding'], '6,000 a month: taxable below zero withholds nothing', '2026-04', {
		employment: { monthlyWage: 6000 },
		contributions: { siBase: 6000, hfBase: 6000 }
	});
	make(['CN-N09'], ['unpaid-leave-lowers-cumulative'], '20,000 with 5 unpaid days in June', '2026-06', { month: { unpaidLeaveDays: 5 } });
	for (const [branch, sd] of [
		['child-education-1', { childEducationChildren: 1 }],
		['child-education-2', { childEducationChildren: 2 }],
		['infant-care-1', { infantCareChildren: 1 }],
		['elder-support-3000', { elderSupport: 3000 }],
		['elder-support-shared-1500', { elderSupport: 1500 }],
		['rent-1500', { rent: true }],
		['loan-interest-1000', { loanInterest: true }],
		['rent-and-loan-refused', { rent: true, loanInterest: true }],
		['all-classes', { childEducationChildren: 1, infantCareChildren: 1, elderSupport: 3000, rent: true }]
	] as const)
		make(['CN-N16', ...(branch.startsWith('rent') || branch.startsWith('loan') ? ['CN-N54'] : [])], [branch], `declared ${branch}`, '2026-03', {
			employment: { monthlyWage: 25000 },
			contributions: { siBase: 25000, hfBase: 25000 },
			tax: { specialDeductions: { ...sd } as Scenario['tax']['specialDeductions'] }
		});
	make(['CN-N44'], ['first-wage-income-july-declared'], 'first wage income of the year in July: 35,000 deducted', '2026-07', {
		employment: { hireDate: '2026-07-01', monthlyWage: 30000 },
		contributions: { siBase: 30000, hfBase: 30000 },
		tax: { firstWageIncomeThisYear: true }
	});
	make(['CN-N44'], ['first-wage-income-july-undeclared'], 'July joiner without the declaration: 5,000', '2026-07', {
		employment: { hireDate: '2026-07-01', monthlyWage: 30000 },
		contributions: { siBase: 30000, hfBase: 30000 }
	});
	make(['CN-N44', 'CN-N02'], ['first-wage-income-mid-month'], 'declared first income, joins 2026-08-17', '2026-08', {
		employment: { hireDate: '2026-08-17', monthlyWage: 30000 },
		contributions: { siBase: 30000, hfBase: 30000 },
		tax: { firstWageIncomeThisYear: true }
	});
	make(['CN-N44'], ['first-wage-income-august-second-month'], 'declared, second month after a July join', '2026-08', {
		employment: { hireDate: '2026-07-01', monthlyWage: 30000 },
		contributions: { siBase: 30000, hfBase: 30000 },
		tax: { firstWageIncomeThisYear: true }
	});
	for (const [period, branch] of [
		['2026-01', 'annual-60k-january'],
		['2026-03', 'annual-60k-march']
	] as const)
		make(['CN-N11'], [branch], '10,000 a month on the 60,000 election', period, {
			employment: { monthlyWage: 10000 },
			contributions: { siBase: 10000, hfBase: 10000 },
			tax: { annual60kElection: true }
		});
	make(['CN-N11'], ['annual-60k-not-elected'], '10,000 in January without the election', '2026-01', {
		employment: { monthlyWage: 10000 },
		contributions: { siBase: 10000, hfBase: 10000 }
	});

	// ── 10. Non-resident, foreign and HK/Macao/Taiwan workers (CN-N38, N25, N48, SH41) ──
	for (const seamAt of [3000, 12000, 25000, 35000, 55000, 80000])
		for (const d of [0, 0.01])
			make(['CN-N38', 'CN-N25'], [`non-resident-band-${seamAt}${d ? '+0.01' : ''}`], `non-resident wage − 5,000 = ${r2(seamAt + d)}`, '2026-03', {
				worker: { citizenship: 'FOREIGN', taxResident: false },
				employment: { monthlyWage: r2(seamAt + 5000 + d) },
				contributions: { siBase: r2(seamAt + 5000 + d) }
			});
	make(['CN-N38', 'CN-N16'], ['non-resident-ignores-special-deductions'], 'non-resident with declared claims: none taken', '2026-03', {
		worker: { citizenship: 'FOREIGN', taxResident: false },
		tax: { specialDeductions: { childEducationChildren: 2, rent: true, loanInterest: true, infantCareChildren: 0, elderSupport: 0 } }
	});
	make(['CN-N38', 'CN-N01'], ['non-resident-overtime-in-month'], 'non-resident: overtime joins the month', '2026-03', {
		worker: { citizenship: 'FOREIGN', taxResident: false },
		employment: { monthlyWage: 21750 },
		month: { overtime: [{ date: '2026-03-07', hours: 8 }] }
	});
	make(['CN-N25', 'CN-SH41', 'CN-N09'], ['foreign-resident-no-fund'], 'foreign tax resident, no fund agreement', '2026-03', {
		worker: { citizenship: 'FOREIGN' }
	});
	make(['CN-N25', 'CN-SH41'], ['foreign-fund-by-agreement'], 'foreign worker with the fund agreement', '2026-03', {
		worker: { citizenship: 'FOREIGN', housingFundAgreement: true }
	});
	make(['CN-N48', 'CN-SH41'], ['hmt-ordinary-si-no-fund'], 'Hong Kong resident: ordinary SI, fund only by agreement', '2026-08', {
		worker: { citizenship: 'HMT' }
	});
	make(['CN-N48', 'CN-SH41'], ['hmt-fund-by-agreement'], 'Taiwan resident with the fund agreement', '2026-08', {
		worker: { citizenship: 'HMT', housingFundAgreement: true }
	});
	make(['CN-N48', 'CN-N38'], ['hmt-non-resident'], 'Macao resident, non-resident for tax', '2026-08', {
		worker: { citizenship: 'HMT', taxResident: false }
	});

	// ── 11. Bonuses (CN-N10, N53) ──
	for (const b of [12000, 36000, 36000.01, 144000, 144000.01, 300000.01, 960000.01])
		make(['CN-N10'], [`annual-bonus-separate-${b}`], `separate annual bonus ${b}`, '2026-03', { month: { annualBonusSeparate: b } });
	make(['CN-N10'], ['annual-bonus-separate-second-use-refused'], 'second separate bonus in the year', '2026-03', {
		month: { annualBonusSeparate: 12000 },
		tax: { annualBonusSeparateUsedThisYear: true }
	});
	make(['CN-N10', 'CN-N53', 'CN-N09'], ['ordinary-bonus-joins-wages'], 'ordinary bonus 12,000 in January', '2026-01', { month: { bonus: 12000 } });
	for (const b of [60000, 18000, 18000.01])
		make(['CN-N10', 'CN-N38'], [`non-resident-multi-month-bonus-${b}`], `non-resident bonus ${b} over six months`, '2026-03', {
			worker: { citizenship: 'FOREIGN', taxResident: false },
			employment: { monthlyWage: 30000 },
			contributions: { siBase: 30000 },
			month: { annualBonusSeparate: b }
		});

	// ── 12. Pension recipients and ages (CN-N13, SH41, SH25) ──
	make(['CN-N13', 'CN-SH41', 'CN-SH25'], ['pension-recipient-man'], 'pensioned retiree aged 63: outside SI and fund', '2026-03', {
		worker: { birthDate: '1962-08-01', pensionRecipient: true }
	});
	make(['CN-N13', 'CN-SH41'], ['pension-recipient-woman'], 'pensioned retiree aged 56: outside SI and fund', '2026-08', {
		worker: { birthDate: '1970-02-10', sex: 'F', pensionRecipient: true }
	});
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
			make(['CN-N13'], [`age-${sex}-${age}${label}-not-pensioned`], `${sex} aged ${age} ${label}, no pension: still covered`, '2026-03', {
				worker: { birthDate: born, sex }
			});
		}

	// ── 13. Non-full-time work (CN-N27, SH01) ──
	for (const [rate, hours] of [
		[25, 80],
		[24.99, 80],
		[40, 60]
	] as const)
		make(['CN-N27', 'CN-SH01'], [`part-time-hourly-${rate}`], `${hours} h at ${rate}/h`, '2025-12', {
			employment: { kind: 'PART_TIME', monthlyWage: 0, hourlyWage: rate },
			month: { partTimeHours: hours }
		});
	make(['CN-N27', 'CN-N41'], ['part-time-ended-no-compensation'], 'part-time worker dismissed: no compensation', '2026-08', {
		employment: { kind: 'PART_TIME', monthlyWage: 0, hourlyWage: 30, hireDate: '2026-01-01', exitDate: '2026-08-31' },
		month: { partTimeHours: 90 },
		exit: leave('ART40', { noticeDaysGiven: 0 })
	});

	// ── 14. Annual leave on exit (CN-N05, N06, N18) ──
	const quit = (branch: string, period: string, hireDate: string, exitDate: string, prior: number, taken = 0, W = 22000) =>
		make(['CN-N05', 'CN-N06', 'CN-N18'], [branch], `${branch}: ${hireDate} – ${exitDate}, ${prior} prior months`, period, {
			worker: { priorServiceMonths: prior },
			employment: { hireDate, exitDate, monthlyWage: W },
			contributions: { siBase: W, hfBase: W },
			exit: leave('ART37', { annualLeaveTakenThisYear: taken })
		});
	// own service 2020-01-01 – 2026-08-14 is 79 whole months: prior 40/41 → 119/120, 160/161 → 239/240
	quit('leave-10y-72-days', '2026-03', '2016-03-01', '2026-03-13', 0);
	quit('leave-under-12-months', '2026-08', '2025-09-01', '2026-08-14', 0);
	quit('leave-12-months-with-prior', '2026-08', '2025-09-01', '2026-08-14', 1);
	quit('leave-tier-119-months', '2026-08', '2020-01-01', '2026-08-14', 40);
	quit('leave-tier-120-months', '2026-08', '2020-01-01', '2026-08-14', 41);
	quit('leave-tier-239-months', '2026-08', '2020-01-01', '2026-08-14', 160);
	quit('leave-tier-240-months', '2026-08', '2020-01-01', '2026-08-14', 161);
	quit('leave-taken-exceeds-no-clawback', '2026-08', '2020-01-01', '2026-08-14', 0, 5);
	quit('leave-partly-taken', '2026-07', '2015-01-01', '2026-07-31', 0, 2);
	quit('leave-joined-this-year', '2026-08', '2026-03-01', '2026-08-14', 24);
	quit('leave-exit-on-1st', '2026-07', '2018-01-01', '2026-07-01', 0);
	quit('leave-exit-on-last-day', '2026-08', '2018-01-01', '2026-08-31', 0);
	quit('leave-hired-in-exit-month', '2026-08', '2026-08-01', '2026-08-20', 60);

	// ── 15. Economic compensation and its tax (CN-N41, N12, N39, SH50, SH-A2) ──
	const fire = (branch: string, period: string, hireDate: string, exitDate: string, ground: Ground, W = 22000, extra: Partial<NonNullable<Scenario['exit']>> = {}, rows: string[] = []) =>
		make(['CN-N41', 'CN-N12', 'CN-N39', ...rows], [branch], `${branch}: ${hireDate} – ${exitDate}, ${ground}, wage ${W}`, period, {
			employment: { hireDate, exitDate, monthlyWage: W },
			contributions: { siBase: W, hfBase: W },
			exit: leave(ground, { annualLeaveTakenThisYear: 15, ...extra })
		});
	for (const g of ['ART36_EMPLOYER', 'ART36_EMPLOYEE', 'ART37', 'ART38', 'ART39', 'ART40', 'ART41', 'ART44_EXPIRY', 'ART87'] as const)
		fire(`ground-${g}`, '2026-06', '2020-01-01', '2026-06-30', g);
	fire('art40-notice-29-days', '2026-06', '2020-01-01', '2026-06-30', 'ART40', 22000, { noticeDaysGiven: 29 });
	fire('art40-no-notice', '2026-06', '2020-01-01', '2026-06-30', 'ART40', 22000, { noticeDaysGiven: 0 });
	fire('art44-renewal-refused', '2026-06', '2020-01-01', '2026-06-30', 'ART44_EXPIRY', 22000, { renewalOfferRefused: true });
	fire('tenure-5-months', '2026-06', '2026-02-01', '2026-06-30', 'ART41');
	fire('tenure-6-months', '2026-06', '2026-01-01', '2026-06-30', 'ART41');
	fire('tenure-5-months-15-days', '2026-07', '2026-02-01', '2026-07-15', 'ART41');
	fire('tenure-6y-5m-15d', '2026-07', '2020-02-01', '2026-07-15', 'ART41');
	fire('tenure-6y-6m', '2026-06', '2020-01-01', '2026-06-30', 'ART41');
	fire('tenure-3y-exact', '2026-06', '2023-07-01', '2026-06-30', 'ART41');
	fire('tenure-3y-15-days', '2026-07', '2023-07-01', '2026-07-15', 'ART41');
	fire('tenure-2y-9m-uncapped', '2026-08', '2023-12-01', '2026-08-31', 'ART41', 20000, {}, ['CN-SH50']);
	fire('capped-earner-15y', '2026-06', '2011-07-01', '2026-06-30', 'ART41', 50000, {}, ['CN-SH50']);
	fire('capped-earner-15y-no-notice', '2026-06', '2011-07-01', '2026-06-30', 'ART40', 50000, { noticeDaysGiven: 0 }, ['CN-SH50']);
	fire('capped-earner-art87', '2026-06', '2011-07-01', '2026-06-30', 'ART87', 50000, {}, ['CN-SH50']);
	fire('cap-seam-at-3x', '2026-06', '2020-01-01', '2026-06-30', 'ART41', 37731, {}, ['CN-SH50']);
	fire('cap-seam-3x+0.01', '2026-06', '2020-01-01', '2026-06-30', 'ART41', 37731.01, {}, ['CN-SH50']);
	fire('capped-earner-11y', '2026-06', '2015-07-01', '2026-06-30', 'ART41', 50000, {}, ['CN-SH50']);
	fire('exemption-seam-excess-36000', '2026-06', '2008-07-01', '2026-06-30', 'ART41', 27154, {}, ['CN-SH50']);
	fire('exemption-seam-excess-36000.18', '2026-06', '2008-07-01', '2026-06-30', 'ART41', 27154.01, {}, ['CN-SH50']);
	fire('exemption-exactly-used', '2026-06', '2008-07-01', '2026-06-30', 'ART41', 25154, {}, ['CN-SH50']);
	fire('exit-2025-on-2024-average', '2025-12', '2025-12-01', '2025-12-31', 'ART41', 50000, {}, ['CN-SH50']);
	fire('exit-2025-uncapped', '2025-12', '2025-12-01', '2025-12-31', 'ART41', 20000, {}, ['CN-SH50']);
	fire('hired-in-exit-month', '2025-12', '2025-12-01', '2025-12-15', 'ART41', 50000, {}, ['CN-SH-A2', 'CN-SH50', 'CN-N02']);
	fire('hired-in-exit-month-no-notice', '2025-12', '2025-12-01', '2025-12-15', 'ART40', 22000, { noticeDaysGiven: 0 }, ['CN-SH-A2', 'CN-N02']);
	fire('hired-in-exit-month-2026', '2026-08', '2026-08-03', '2026-08-21', 'ART41', 11000, {}, ['CN-SH-A2', 'CN-N02']);
	fire('mid-month-exit-mar-2026', '2026-03', '2025-10-01', '2026-03-13', 'ART41', 50000, { annualLeaveTakenThisYear: 0 }, ['CN-SH50', 'CN-N05', 'CN-N06', 'CN-N02']);
	fire('art87-short-service', '2026-08', '2026-03-01', '2026-08-31', 'ART87', 18000);
	fire('severance-with-leave-pay', '2026-06', '2019-01-01', '2026-06-30', 'ART41', 22000, { annualLeaveTakenThisYear: 0 }, ['CN-N05', 'CN-N06']);

	// ── 16. Non-wage receipts (CN-N55) ──
	make(['CN-N55'], ['non-wage-receipts'], 'one-child, childcare, travel and meal receipts: untaxed, outside every base', '2026-03', {
		month: { nonWage: { ONE_CHILD_SUBSIDY: 10, CHILDCARE_SUBSIDY: 200, TRAVEL_ALLOWANCE: 300, MISSED_MEAL_SUBSIDY: 150 } }
	});

	// ── 17. Randomised in-bound workers (every standard branch together) ──
	for (let i = 0; i < 20; i++) {
		const period = (['2026-01', '2026-03', '2026-05', '2026-07', '2026-08', '2026-09'] as const)[i % 6]!;
		const W = wage(8000, 60000);
		make(['CN-SH05', 'CN-SH06', 'CN-SH07', 'CN-SH09', 'CN-SH40', 'CN-N09', 'CN-X-SI-ROUNDING'], ['random-in-bound'], `wage ${W} in ${period}`, period, {
			employment: { monthlyWage: W },
			contributions: {
				siBase: wage(7000, 40000),
				hfBase: wage(2600, 40000),
				hfRate: [0.05, 0.06, 0.07][i % 3]!,
				hfSupplementaryRate: [0, 0, 0.01, 0.03, 0.05][i % 5]!,
				injuryRate: [0.002, 0.004, 0.007, 0.009, 0.011, 0.013, 0.016, 0.019][i % 8]!
			},
			tax: { specialDeductions: { childEducationChildren: i % 3, infantCareChildren: 0, elderSupport: i % 4 === 0 ? 3000 : 0, rent: i % 2 === 1, loanInterest: false } }
		});
	}
	return out;
}
