/**
 * Deterministic TW scenario generator for the independent oracle (tests/e2e/oracle/TW.ts).
 *
 * Every scenario is one company, one employment and one monthly period, the shape a probe case takes
 * (tests/e2e/payroll-probe.ts: `profile: 'TW'`, `period`, one `employments` row, then time / leave / adjustment /
 * exit rows). Each is tagged with the tracker rows (docs/inventory/taiwan.csv) and branch names it exercises.
 * No Math.random: the only variation comes from a seeded mulberry32.
 */
import type { Citizenship, ExitCause, Scenario } from '../oracle/TW';
import { addDays, addMonths, addYears } from '../oracle/TW';

type Patch = {
	period?: string;
	company?: Partial<Scenario['company']>;
	employee?: Partial<Scenario['employee']>;
	time?: Partial<Scenario['time']>;
	leave?: Partial<Scenario['leave']>;
	bonus?: Partial<Scenario['bonus']>;
	garnishment?: number;
	exit?: Scenario['exit'];
};

const base = (): Omit<Scenario, 'id' | 'rows' | 'branches'> => ({
	period: '2026-03',
	company: { liUnit: true, occRate: 0.0012 },
	employee: {
		birthDate: '1990-06-15',
		citizenship: 'ROC',
		prGrantedOn: null,
		taxResident: true,
		hireDate: '2020-01-01',
		pay: { basis: 'MONTHLY', monthly: 36000, raise: null },
		partTimeWeeklyHours: null,
		mealAllowance: 0,
		declaredWage: null,
		nhiDependants: 0,
		taxDependants: 0,
		taxMethod: 'TABLE',
		pension: { system: 'NEW', voluntaryRate: 0 },
		disability: null,
		liAfter65: false
	},
	time: { weekdayOvertime: [], restDayWork: [], holidayWork: [], restDayEmergencyDays: 0 },
	leave: { personalDays: 0, sickDays: 0, sickPriorDays: 0, parentalWholeMonth: false },
	bonus: { amount: 0, priorThisYear: 0 },
	garnishment: 0,
	exit: null
});

/** an exit whose annual leave is all taken unless the case says otherwise */
const exitOf = (date: string, cause: ExitCause, more: Partial<NonNullable<Scenario['exit']>> = {}) => ({
	date,
	cause,
	noticeDaysGiven: 30,
	annualLeaveTaken: 30,
	averageMonthlyWage: 36000,
	dutyDisability: false,
	...more
});
/** the hire date that gives `months` completed months (plus `days`) of service on the last day `exit` */
const hireFor = (exit: string, months: number, days = 0) => addDays(addMonths(addDays(exit, 1), -months), -days);

/** mulberry32: a seeded, deterministic PRNG */
const rng = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const monthly = (m: number, raise: { from: string; monthly: number } | null = null) => ({
	basis: 'MONTHLY' as const,
	monthly: m,
	raise
});
const hourly = (h: number, hours: number) => ({ basis: 'HOURLY' as const, hourly: h, hours });

export function generateProfiles(): Scenario[] {
	const out: Scenario[] = [];
	const add = (id: string, rows: string[], branches: string[], p: Patch = {}) => {
		const b = base();
		out.push({
			id: `tw-${id}`,
			rows,
			branches,
			period: p.period ?? b.period,
			company: { ...b.company, ...p.company },
			employee: { ...b.employee, ...p.employee },
			time: { ...b.time, ...p.time },
			leave: { ...b.leave, ...p.leave },
			bonus: { ...b.bonus, ...p.bonus },
			garnishment: p.garnishment ?? 0,
			exit: p.exit ?? null
		});
	};

	// ---- minimum wage (art. 5 substitution) and its commencement seam ----
	for (const m of [28000, 29499, 29500, 29501])
		add(`mw-2026-${m}`, ['TW-MW-01', 'TW-LI-04', 'TW-PEN-07', 'TW-NHI-03'], [m < 29500 ? 'below-floor' : 'at-or-above-floor'], {
			employee: { pay: monthly(m) }
		});
	for (const m of [28000, 28589, 28590, 28591, 29500])
		add(`mw-2025-12-${m}`, ['TW-MW-01', 'TW-MW-03', 'TW-LI-04', 'TW-NHI-03'], ['114-tables', m < 28590 ? 'below-floor' : 'at-or-above-floor'], {
			period: '2025-12',
			employee: { pay: monthly(m) }
		});
	for (const m of [20000, 29500])
		add(`intern-${m}`, ['TW-HIRE-04', 'TW-MW-01'], ['employed-student'], {
			employee: { pay: monthly(m), birthDate: '2005-09-01', hireDate: '2026-02-01' }
		});

	// ---- part-time: monthly floor × hours/40, hourly floor, LI part-time grades, NHI 12-hour test ----
	for (const [h, m] of [
		[12, 8000], [12, 8850], [20, 14000], [20, 14750], [20, 15000], [30, 22125], [30, 26000], [8, 5900]
	] as const)
		add(`pt-monthly-${h}h-${m}`, ['TW-MW-02', 'TW-LI-05', 'TW-LI-04', 'TW-NHI-05', 'TW-PEN-07'], [
			m < (29500 * h) / 40 ? 'below-pro-rata-floor' : 'at-or-above-pro-rata-floor',
			h >= 12 ? 'nhi-enrolled-12h' : 'nhi-not-enrolled-under-12h'
		], { employee: { pay: monthly(m), partTimeWeeklyHours: h } });
	for (const [r, hrs] of [[190, 80], [195, 40], [196, 40], [196, 80], [197, 120], [250, 100], [196, 150]] as const)
		add(`pt-hourly-${r}x${hrs}`, ['TW-MW-02', 'TW-MW-01', 'TW-LI-05', 'TW-NHI-05'], [r < 196 ? 'hourly-below-floor' : 'hourly-at-or-above-floor', 'hourly-worker'], {
			employee: { pay: hourly(r, hrs), partTimeWeeklyHours: Math.round(hrs / 4.33) }
		});

	// ---- LI / EI / OCC / pension / NHI grade seams (2026) ----
	const liSeams = [29500, 30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000, 43900, 45800];
	for (const g of liSeams)
		for (const w of [g, g + 1])
			add(`grade-li-${w}`, ['TW-LI-01', 'TW-EI-01', 'TW-LI-04', 'TW-NHI-01', 'TW-NHI-03', 'TW-PEN-01', 'TW-PEN-11', 'TW-OCC-04'], [w === g ? 'at-grade' : 'one-above-grade'], {
				employee: { pay: monthly(w) }
			});
	for (const w of [72800, 72801, 150000, 150001, 313000, 313001])
		add(`grade-cap-${w}`, ['TW-OCC-04', 'TW-PEN-11', 'TW-NHI-03', 'TW-TAX-01'], [w % 10 === 1 ? 'above-ceiling' : 'at-ceiling'], {
			employee: { pay: monthly(w) }
		});
	add('grade-2025-30300', ['TW-LI-04', 'TW-NHI-03'], ['114-second-grade-28800'], { period: '2025-12', employee: { pay: monthly(28800) } });
	add('grade-2025-313000', ['TW-NHI-03'], ['114-top-grade'], { period: '2025-12', employee: { pay: monthly(313000) } });

	// ---- OCC industry rates ----
	for (const [rate, w] of [[0.0012, 36000], [0.0057, 36000], [0.0057, 72800], [0.0096, 50000], [0.0022, 29500]] as const)
		add(`occ-${rate}-${w}`, ['TW-OCC-01', 'TW-OCC-04'], ['industry-rate'], { company: { occRate: rate }, employee: { pay: monthly(w) } });

	// ---- resident withholding: the 115年度 table, the 5% election, the NT$2,000 rule ----
	for (const w of [90500, 90501, 91000, 91001, 91500, 120000, 250000, 500000, 500001, 600000])
		add(`tax-table-n0-${w}`, ['TW-TAX-01', 'TW-TAX-05'], [w > 500000 ? 'formula-above-table' : w <= 90500 ? 'below-start' : 'table-cell'], {
			employee: { pay: monthly(w) }
		});
	for (const n of [1, 2, 3, 4, 6, 8, 11, 12])
		add(`tax-table-n${n}-200000`, ['TW-TAX-01', 'TW-TAX-05'], [n > 11 ? 'formula-dependants-above-table' : 'table-cell-dependants'], {
			employee: { pay: monthly(200000), taxDependants: n, nhiDependants: Math.min(n, 4) }
		});
	for (const w of [99000, 99001])
		add(`tax-table-n1-${w}`, ['TW-TAX-01', 'TW-TAX-05'], ['n1-start-seam'], { employee: { pay: monthly(w), taxDependants: 1 } });
	for (const w of [40000, 40020, 60000, 100000])
		add(`tax-flat5-${w}`, ['TW-TAX-01', 'TW-TAX-02'], [w <= 40000 ? 'flat5-2000-exempt' : 'flat5-withheld'], {
			employee: { pay: monthly(w), taxMethod: 'FLAT5' }
		});

	// ---- nonresident 6% / 18% at 1.5 × the minimum wage; residence independent of citizenship ----
	for (const [period, w] of [['2026-03', 44250], ['2026-03', 44251], ['2026-03', 29500], ['2026-03', 90000], ['2025-12', 42885], ['2025-12', 42886]] as const)
		add(`tax-nr-${period}-${w}`, ['TW-TAX-01', 'TW-TAX-04', 'TW-TAX-05'], [w <= (period === '2025-12' ? 42885 : 44250) ? 'nonresident-6' : 'nonresident-18'], {
			period,
			employee: { pay: monthly(w), taxResident: false, citizenship: 'MIGRANT_WORKER', hireDate: '2025-11-01', pension: { system: 'NEW', voluntaryRate: 0 } }
		});
	add('tax-nr-foreign-spouse', ['TW-TAX-04', 'TW-EI-01', 'TW-PEN-01'], ['nonresident-foreign-spouse-ei-covered'], {
		employee: { pay: monthly(40000), taxResident: false, citizenship: 'FOREIGN_SPOUSE', hireDate: '2026-01-05' }
	});
	add('tax-resident-migrant', ['TW-TAX-04'], ['resident-migrant-table'], {
		employee: { pay: monthly(95000), citizenship: 'MIGRANT_WORKER', taxResident: true }
	});
	add('tax-nr-roc', ['TW-TAX-04'], ['nonresident-roc-national'], { employee: { pay: monthly(60000), taxResident: false } });

	// ---- 伙食代金: outside salary income to NT$3,000, inside the insured bases ----
	for (const meal of [2400, 3000, 3001, 4000])
		add(`meal-${meal}`, ['TW-TAX-06', 'TW-LI-08', 'TW-PEN-11'], [meal <= 3000 ? 'meal-within-3000' : 'meal-excess-taxed'], {
			employee: { pay: monthly(95000), mealAllowance: meal }
		});
	add('meal-grade-seam', ['TW-TAX-06', 'TW-LI-08'], ['allowance-lifts-grade'], { employee: { pay: monthly(34000), mealAllowance: 2400 } });

	// ---- bonus: the 5% non-monthly path, its start, the §31 supplementary premium ----
	for (const b of [90500, 90501, 100000])
		add(`bonus-tax-${b}`, ['TW-TAX-02', 'TW-TAX-05'], [b < 90501 ? 'bonus-below-start' : 'bonus-5pct'], { bonus: { amount: b } });
	for (const [b, prior] of [[145200, 0], [145201, 0], [150000, 0], [50000, 100000], [50000, 150000], [20000, 0]] as const)
		add(`bonus-supp-${b}-${prior}`, ['TW-NHI-02', 'TW-TAX-02'], [b + prior <= 4 * 36300 ? 'supp-within-four-grades' : 'supp-excess'], {
			bonus: { amount: b, priorThisYear: prior }
		});
	add('bonus-supp-high-grade', ['TW-NHI-02'], ['supp-high-grade'], { employee: { pay: monthly(45000) }, bonus: { amount: 250000 } });
	add('bonus-nr', ['TW-TAX-04', 'TW-TAX-02'], ['nonresident-bonus-in-month-total'], {
		employee: { taxResident: false, citizenship: 'MIGRANT_WORKER', pay: monthly(30000) },
		bonus: { amount: 10000 }
	});

	// ---- part month: hire and exit dates, the 30-day insurance month, NHI month end ----
	for (const [period, hire] of [
		['2026-03', '2026-03-01'], ['2026-03', '2026-03-02'], ['2026-03', '2026-03-15'], ['2026-03', '2026-03-16'],
		['2026-03', '2026-03-30'], ['2026-03', '2026-03-31'], ['2026-04', '2026-04-01'], ['2026-04', '2026-04-16'],
		['2026-04', '2026-04-30']
	] as const)
		add(`hire-${hire}`, ['TW-WAGE-05', 'TW-LI-02', 'TW-PEN-01', 'TW-NHI-11'], [`hire-day-${hire.slice(8)}`], {
			period,
			employee: { hireDate: hire }
		});
	add('hire-mid-meal', ['TW-WAGE-05', 'TW-LI-08'], ['allowance-prorates'], { employee: { hireDate: '2026-03-16', mealAllowance: 2400 } });
	for (const [period, exit] of [
		['2026-03', '2026-03-01'], ['2026-03', '2026-03-15'], ['2026-03', '2026-03-16'], ['2026-03', '2026-03-30'],
		['2026-03', '2026-03-31'], ['2026-04', '2026-04-30'], ['2026-02', '2026-02-27'], ['2026-02', '2026-02-28']
	] as const)
		add(`exit-${exit}`, ['TW-WAGE-05', 'TW-LI-02', 'TW-PEN-03', 'TW-NHI-11', 'TW-EXIT-04'], [`exit-day-${exit.slice(8)}`], {
			period,
			exit: exitOf(exit, 'RESIGNATION')
		});
	add('hire-and-exit-same-month', ['TW-WAGE-05', 'TW-LI-02', 'TW-NHI-11'], ['join-and-leave-in-month'], {
		employee: { hireDate: '2026-03-05' },
		exit: exitOf('2026-03-20', 'RESIGNATION')
	});

	// ---- a raise mid-month, the insured grade after notice ----
	add('raise-mid-month', ['TW-WAGE-05', 'TW-NHI-10', 'TW-LI-08', 'TW-PEN-11'], ['calendar-share', 'grade-waits-notice'], {
		employee: { pay: monthly(36000, { from: '2026-03-16', monthly: 40000 }), declaredWage: 36000 }
	});
	add('raise-notified', ['TW-NHI-10', 'TW-LI-08', 'TW-PEN-11', 'TW-OCC-04'], ['grade-after-notice'], {
		period: '2026-04',
		employee: { pay: monthly(40000), declaredWage: 40000 }
	});

	// ---- leave: 事假 unpaid, sick half pay to 30 days ----
	for (const d of [1, 3, 14])
		add(`personal-${d}`, ['TW-LEAVE-03', 'TW-WAGE-05'], ['personal-unpaid'], { leave: { personalDays: d }, employee: { mealAllowance: d === 3 ? 2400 : 0 } });
	for (const [d, prior] of [[5, 0], [5, 25], [5, 28], [4, 30], [10, 20]] as const)
		add(`sick-${d}-after-${prior}`, ['TW-LEAVE-02'], [prior + d <= 30 ? 'sick-half-pay' : 'sick-beyond-30'], { leave: { sickDays: d, sickPriorDays: prior } });

	// ---- hours: art. 24 weekday and 休息日 tiers, art. 39 holiday, art. 40 例假 emergency ----
	for (const ot of [[1], [2], [3], [4], [2, 2, 2], [4, 4, 4, 4]])
		add(`ot-weekday-${ot.join('-')}`, ['TW-HOURS-02', 'TW-HOURS-01', 'TW-WAGE-05'], ['weekday-4/3-5/3'], { time: { weekdayOvertime: ot } });
	for (const r of [[1], [2], [4], [8], [10], [12]])
		add(`ot-rest-${r.join('-')}`, ['TW-HOURS-02', 'TW-HOURS-01'], [r[0]! > 8 ? 'rest-day-beyond-8' : 'rest-day-tiers'], { time: { restDayWork: r } });
	for (const h of [[4], [8], [10], [8, 8]])
		add(`holiday-${h.join('-')}`, ['TW-HOURS-02'], [h[0]! > 8 ? 'holiday-beyond-8' : 'holiday-day-doubled'], { time: { holidayWork: h } });
	add('rest-emergency', ['TW-HOURS-02'], ['art40-emergency'], { time: { restDayEmergencyDays: 1 } });
	add('ot-min-wage', ['TW-HOURS-02', 'TW-MW-01'], ['ot-on-floor'], { employee: { pay: monthly(28000) }, time: { weekdayOvertime: [2, 2] } });

	// ---- age: EI ends on the 65th birthday, LI continues when registered ----
	for (const [birth, liAfter65, branch] of [
		['1961-03-01', true, 'turns-65-on-1st'],
		['1961-03-15', true, 'turns-65-mid-month'],
		['1961-03-16', true, 'turns-65-on-16th'],
		['1961-03-31', true, 'turns-65-on-31st'],
		['1961-04-01', true, 'turns-65-next-month'],
		['1961-02-28', true, 'over-65-li-continues'],
		['1961-02-28', false, 'over-65-li-not-registered'],
		['1956-06-15', true, 'age-69-li-continues'],
		['1962-03-15', false, 'age-64'],
		['2010-03-15', false, 'turns-16'],
		['2011-03-15', false, 'turns-15']
	] as const)
		add(`age-${birth}-${liAfter65 ? 'li' : 'noli'}`, ['TW-EI-01', 'TW-LI-01', 'TW-SCOPE-02'], [branch], {
			employee: { birthDate: birth, liAfter65, hireDate: birth < '2000' ? '2020-01-01' : '2026-01-05' }
		});

	// ---- citizenship: EI and pension scope ----
	for (const [c, branch] of [
		['MIGRANT_WORKER', 'migrant-no-ei-no-pension'],
		['FOREIGN_SPOUSE', 'foreign-spouse-ei-pension'],
		['FOREIGN_PR', 'pr-ei-pension'],
		['FOREIGN_PROFESSIONAL', 'non-pr-professional-pension-no-ei']
	] as [Citizenship, string][])
		add(`cit-${c}`, ['TW-EI-02', 'TW-PEN-02', 'TW-SCOPE-02', 'TW-NHI-13'], [branch], {
			employee: { citizenship: c, hireDate: '2026-01-05', pay: monthly(52000) }
		});
	for (const pr of ['2026-03-01', '2026-03-16', '2026-03-31'])
		add(`pr-grant-${pr}`, ['TW-EI-02'], ['pr-grant-starts-ei'], {
			employee: { citizenship: 'FOREIGN_PROFESSIONAL', prGrantedOn: pr, hireDate: '2026-01-05', pay: monthly(52000) }
		});

	// ---- a unit with fewer than five workers: EI and OCC without LI ----
	for (const w of [29500, 36000, 45801])
		add(`under-five-${w}`, ['TW-EI-03', 'TW-SCOPE-02', 'TW-OCC-01'], ['no-li-unit'], { company: { liUnit: false }, employee: { pay: monthly(w) } });

	// ---- pension: voluntary rates, old-system retention and the §56 reserve ----
	for (const [rate, method, w] of [[0.06, 'FLAT5', 60000], [0.03, 'FLAT5', 60000], [0.06, 'TABLE', 100000], [0.01, 'TABLE', 36000]] as const)
		add(`pen-vol-${rate}-${method}-${w}`, ['TW-PEN-01', 'TW-PEN-12', 'TW-TAX-02'], ['voluntary-outside-tax'], {
			employee: { pay: monthly(w), taxMethod: method, pension: { system: 'NEW', voluntaryRate: rate } }
		});
	for (const [rate, meal] of [[0.02, 0], [0.04, 0], [0.15, 0], [0.02, 3000]] as const)
		add(`pen-old-${rate}-${meal}`, ['TW-PEN-13', 'TW-EXIT-03', 'TW-TAX-06'], [meal ? 'reserve-includes-allowance' : 'reserve-rate'], {
			employee: { hireDate: '2001-03-01', birthDate: '1975-05-05', pay: monthly(40000), mealAllowance: meal, pension: { system: 'OLD_RETAINED', reserveRate: rate } }
		});
	add('pen-old-foreign-pr', ['TW-PEN-14', 'TW-EXIT-03'], ['foreign-pr-old-system'], {
		employee: { hireDate: '2015-04-01', citizenship: 'FOREIGN_PR', pay: monthly(60000), pension: { system: 'OLD_RETAINED', reserveRate: 0.04 } }
	});

	// ---- parental leave: a whole month stops every payroll charge ----
	add('parental-whole-month', ['TW-LEAVE-06', 'TW-PEN-08', 'TW-SCOPE-02'], ['parental-zero'], { leave: { parentalWholeMonth: true } });

	// ---- NHI dependants (capped at three) and the disability subsidy ----
	for (const d of [0, 1, 2, 3, 4, 5])
		add(`nhi-dep-${d}`, ['TW-NHI-01', 'TW-NHI-11'], [d > 3 ? 'dependants-capped' : 'dependants-counted'], { employee: { nhiDependants: d } });
	for (const [dis, w] of [['MILD', 33300], ['MODERATE', 29500], ['MODERATE', 36300], ['SEVERE', 36300]] as const)
		add(`disability-${dis}-${w}`, ['TW-NHI-14'], [`subsidy-${dis.toLowerCase()}`], { employee: { disability: dis, pay: monthly(w) } });

	// ---- garnishment ----
	for (const g of [12000, 11000, 1])
		add(`garnish-${g}`, ['TW-WAGE-06'], ['ordered-amount-off-net'], { garnishment: g });

	// ---- exits: notice pay, severance, unused annual leave, retirement ----
	const X = '2026-03-20';
	for (const [months, days, given] of [
		[2, 29, 0], [3, 0, 0], [11, 29, 0], [12, 0, 0], [12, 0, 10], [35, 29, 0], [36, 0, 0], [36, 0, 30], [60, 0, 15]
	] as const)
		add(`layoff-${months}m${days}d-notice${given}`, ['TW-EXIT-01', 'TW-EXIT-02', 'TW-EXIT-04'], ['notice-by-service', 'severance-new-system'], {
			employee: { hireDate: hireFor(X, months, days) },
			exit: exitOf(X, 'LAYOFF_S11', { noticeDaysGiven: given })
		});
	for (const [months, days] of [[12, 0], [75, 10], [143, 29], [144, 0], [160, 0]] as const)
		add(`severance-${months}m${days}d`, ['TW-EXIT-02'], [months >= 144 ? 'severance-six-month-cap' : 'severance-pro-rata'], {
			employee: { hireDate: hireFor(X, months, days) },
			exit: exitOf(X, 'WORKER_S14', { averageMonthlyWage: 40000 })
		});
	for (const cause of ['RESIGNATION', 'DISMISSAL_S12'] as const)
		add(`exit-${cause}`, ['TW-EXIT-01', 'TW-EXIT-02', 'TW-EXIT-04'], ['no-severance-no-notice-pay'], { exit: exitOf(X, cause) });
	for (const [months, days] of [[5, 29], [6, 0], [11, 29], [12, 0], [24, 0], [36, 0], [60, 0], [120, 0], [228, 0], [288, 0], [360, 0]] as const)
		add(`annual-payout-${months}m${days}d`, ['TW-LEAVE-01', 'TW-EXIT-04'], ['entitlement-by-service', 'unused-paid-at-exit'], {
			employee: { hireDate: hireFor(X, months, days) },
			exit: exitOf(X, 'RESIGNATION', { annualLeaveTaken: 0 })
		});
	add('annual-payout-partly-taken', ['TW-LEAVE-01', 'TW-EXIT-04'], ['unused-after-taken'], {
		employee: { hireDate: hireFor(X, 60) },
		exit: exitOf(X, 'RESIGNATION', { annualLeaveTaken: 6 })
	});
	for (const [months, disability, avg, resident] of [
		[300, false, 50000, true], [364, false, 50000, true], [367, false, 50000, true], [192, false, 60000, true],
		[300, true, 50000, true], [360, false, 150000, true], [360, false, 150000, false], [540, false, 200000, true]
	] as const)
		add(`retire-${months}m-${disability ? 'duty' : 'plain'}-${avg}-${resident ? 'r' : 'nr'}`, ['TW-EXIT-06', 'TW-TAX-03', 'TW-PEN-13'], [
			disability ? 'duty-disability-20pct' : 'two-then-one-base',
			avg >= 150000 ? 'retirement-taxed-over-exempt' : 'retirement-exempt'
		], {
			employee: {
				hireDate: hireFor(X, months),
				birthDate: '1960-01-10',
				taxResident: resident,
				liAfter65: true,
				pension: { system: 'OLD_RETAINED', reserveRate: 0.02 }
			},
			exit: exitOf(X, 'RETIREMENT', { averageMonthlyWage: avg, dutyDisability: disability })
		});

	// ---- seeded mixed profiles (combinations) ----
	const random = rng(20260930);
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
	for (let i = 0; i < 60; i++) {
		const w = 29500 + Math.floor(random() * 90) * 1000;
		const citizenship = pick(['ROC', 'ROC', 'ROC', 'FOREIGN_SPOUSE', 'MIGRANT_WORKER', 'FOREIGN_PR'] as const);
		add(`mix-${i}`, ['TW-LI-01', 'TW-EI-01', 'TW-NHI-01', 'TW-PEN-01', 'TW-TAX-01', 'TW-OCC-01'], ['combined'], {
			period: pick(['2026-01', '2026-03', '2026-06', '2026-09'] as const),
			company: { occRate: pick([0.0012, 0.0022, 0.0057] as const) },
			employee: {
				pay: monthly(w),
				citizenship,
				taxResident: citizenship !== 'MIGRANT_WORKER' || random() < 0.5,
				mealAllowance: random() < 0.3 ? 2400 : 0,
				nhiDependants: Math.floor(random() * 4),
				taxDependants: Math.floor(random() * 4),
				pension: { system: 'NEW', voluntaryRate: pick([0, 0, 0.03, 0.06] as const) }
			},
			time: { weekdayOvertime: random() < 0.3 ? [2] : [] },
			leave: { personalDays: random() < 0.2 ? 1 : 0 },
			bonus: { amount: random() < 0.2 ? Math.floor(random() * 20) * 10000 : 0, priorThisYear: 0 }
		});
	}
	return out;
}

/** every tracker row a scenario tags */
export const coveredRows = () => [...new Set(generateProfiles().flatMap((s) => s.rows))].sort();
