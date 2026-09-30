/**
 * Deterministic VN scenario generator for the independent oracle (tests/e2e/oracle/VN.ts).
 *
 * Every scenario is one company, one employment and one monthly period — the shape a probe case takes
 * (tests/e2e/payroll-probe.ts: `profile: 'VN'`, `period`, `company`, one `employees` + `employments` row, the
 * officeWeek roster (Mon–Fri work, Sat off, Sun rest), then leave / time / adjustment rows). Each is tagged with the
 * tracker rows (docs/inventory/vietnam.csv) and branch names it exercises. No Math.random: the only variation comes
 * from a seeded mulberry32.
 */
import type { ExitCause, Region, Scenario } from '../oracle/VN';
import { addDays, monthEnd, retirementDay } from '../oracle/VN';

type Patch = {
	period?: string;
	company?: Partial<Scenario['company']>;
	employee?: Partial<Scenario['employee']>;
	contract?: Partial<Scenario['contract']>;
	time?: Partial<Omit<Scenario['time'], 'ot' | 'night'>> & {
		ot?: Partial<Scenario['time']['ot']>;
		night?: Partial<Scenario['time']['night']>;
	};
	bonus?: number;
	exit?: Scenario['exit'];
};

const base = (): Omit<Scenario, 'id' | 'rows' | 'branches'> => ({
	period: '2026-09',
	company: { region: 'I' },
	employee: {
		birthDate: '1990-06-15',
		sex: 'M',
		citizenship: 'VN',
		taxResident: true,
		receivingPension: false,
		unionMember: false,
		dependants: 0,
		voluntaryPension: 0
	},
	contract: {
		start: '2020-01-01',
		fixedEnd: null,
		monthly: 30_000_000,
		allowance: 0,
		partTime: null,
		uiFrom: '2020-01-01'
	},
	time: {
		unpaidDays: 0,
		sickDays: 0,
		ot: { weekday: 0, rest: 0, holiday: 0 },
		night: { plain: 0, weekdayAfterDayOt: 0, weekdayNoDayOt: 0, rest: 0, holiday: 0 }
	},
	bonus: 0,
	exit: null
});

const exitOf = (date: string, cause: ExitCause, more: Partial<NonNullable<Scenario['exit']>> = {}) => ({
	date,
	cause,
	pensionEligible: false,
	leaveTaken: 0,
	...more
});

/** mulberry32: a seeded, deterministic PRNG */
const rng = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const REGIONS: Region[] = ['I', 'II', 'III', 'IV'];
const FLOOR_2025: Record<Region, [number, number]> = { I: [4_960_000, 23_800], II: [4_410_000, 21_200], III: [3_860_000, 18_600], IV: [3_450_000, 16_600] };
const FLOOR_2026: Record<Region, [number, number]> = { I: [5_310_000, 25_500], II: [4_730_000, 22_700], III: [4_140_000, 20_000], IV: [3_700_000, 17_800] };

export function generateProfiles(): Scenario[] {
	const out: Scenario[] = [];
	const add = (id: string, rows: string[], branches: string[], p: Patch = {}) => {
		const b = base();
		const contract = { ...b.contract, ...p.contract };
		// a contract that starts later is insured under UI from its start unless the patch says otherwise
		if (p.contract?.start && p.contract.uiFrom === undefined) contract.uiFrom = p.contract.start;
		out.push({
			id: `vn-${id}`,
			rows,
			branches,
			period: p.period ?? b.period,
			company: { ...b.company, ...p.company },
			employee: { ...b.employee, ...p.employee },
			contract,
			time: {
				...b.time,
				...p.time,
				ot: { ...b.time.ot, ...p.time?.ot },
				night: { ...b.time.night, ...p.time?.night }
			},
			bonus: p.bonus ?? 0,
			exit: p.exit ?? null
		});
	};
	const random = rng(0x5eed0b1);

	// ---- minimum wage: every region at the floor and one đồng under, December 2025 (D74) and 2026 (D293) ----
	for (const r of REGIONS) {
		const [m25] = FLOOR_2025[r];
		const [m26, h26] = FLOOR_2026[r];
		add(`mw-2025-${r}-floor`, ['VN-MW74-01', 'VN-MW293-06'], [`Region ${r} 2025 monthly floor`], { period: '2025-12', company: { region: r }, contract: { monthly: m25 } });
		add(`mw-2025-${r}-below`, ['VN-MW74-01'], [`Region ${r} 2025 one đồng under → refused`], { period: '2025-12', company: { region: r }, contract: { monthly: m25 - 1 } });
		add(`mw-2026-${r}-floor`, ['VN-MW293-02', 'VN-MW293-04', 'VN-MW293-06'], [`Region ${r} 2026 monthly floor`], { period: '2026-01', company: { region: r }, contract: { monthly: m26 } });
		add(`mw-2026-${r}-below`, ['VN-MW293-04'], [`Region ${r} 2026 one đồng under → refused`], { period: '2026-01', company: { region: r }, contract: { monthly: m26 - 1 } });
		// December 2025 floor of the next year's rate is lawful in 2025 but a 2025 floor wage is refused in 2026
		add(`mw-2026-${r}-old-floor`, ['VN-MW293-06'], [`Region ${r} 2025 floor refused from January 2026`], { period: '2026-01', company: { region: r }, contract: { monthly: m25 } });
		// part-time hourly floor (D293 art.4(2)); hours keep the wage at or above the 2,530,000 reference level
		const hours = Math.ceil(2_530_000 / h26);
		add(`mw-hourly-${r}-floor`, ['VN-MW293-02', 'VN-MW293-05', 'VN-SI-01'], [`Region ${r} hourly floor`, 'part-time on the reference level'], {
			period: '2026-09', company: { region: r }, contract: { partTime: { hourly: h26, hours } }
		});
		add(`mw-hourly-${r}-below`, ['VN-MW293-05'], [`Region ${r} hourly one đồng under → refused`], {
			period: '2026-09', company: { region: r }, contract: { partTime: { hourly: h26 - 1, hours } }
		});
	}
	add('mw-allowance-not-counted', ['VN-MW293-04', 'VN-SI-01'], ['job wage under floor, allowance does not lift it → refused'], { period: '2026-03', contract: { monthly: 5_309_999, allowance: 1_000_000 } });
	add('pt-reference-2026-06', ['VN-SI-01', 'VN-SI-05'], ['part-time at 2,340,000 reference level (June)'], { period: '2026-06', contract: { partTime: { hourly: 26_000, hours: 90 } } });

	// ---- SI/HI ceiling, reference-level step, UI regional cap (VN-SI-05, VN-HI-01, VN-UI-01, VN-UI-04) ----
	for (const [period, cap] of [['2025-12', 46_800_000], ['2026-03', 46_800_000], ['2026-06', 46_800_000], ['2026-07', 50_600_000], ['2026-11', 50_600_000]] as const)
		for (const m of [cap - 1, cap, cap + 1])
			add(`si-ceiling-${period}-${m}`, ['VN-SI-05', 'VN-HI-01', 'VN-UI-04', 'VN-PIT-05', 'VN-PIT-01'], [`SI/HI ceiling ${cap}`, period === '2026-07' ? '1 July 2026 step' : 'ceiling seam'], {
				period, contract: { monthly: m }
			});
	for (const r of REGIONS) {
		const cap26 = 20 * FLOOR_2026[r][0];
		for (const m of [cap26, cap26 + 1])
			add(`ui-cap-2026-${r}-${m}`, ['VN-UI-01', 'VN-UI-04', 'VN-SI-05', 'VN-PIT-05'], [`Region ${r} UI cap ${cap26}`], { period: '2026-09', company: { region: r }, contract: { monthly: m } });
		const cap25 = 20 * FLOOR_2025[r][0];
		for (const m of [cap25, cap25 + 1])
			add(`ui-cap-2025-${r}-${m}`, ['VN-UI-01', 'VN-SI-05', 'VN-PIT-01'], [`Region ${r} December 2025 UI cap ${cap25} (Law 38/2013)`], { period: '2025-12', company: { region: r }, contract: { monthly: m } });
	}
	add('si-stable-allowance', ['VN-SI-01', 'VN-SI-05', 'VN-LC90-01', 'VN-LC98-02'], ['stable job allowance is insured and in the OT base'], {
		contract: { monthly: 20_000_000, allowance: 3_000_000 }, time: { ot: { weekday: 4 } }
	});
	add('si-allowance-over-ceiling', ['VN-SI-01', 'VN-SI-05'], ['salary + allowance crosses the ceiling'], { period: '2026-07', contract: { monthly: 48_000_000, allowance: 3_000_000 } });

	// ---- the 13/14 unpaid working-day month (VN-SI-02, VN-PRORATE-01, VN-UNION-01) ----
	for (const [period, member] of [['2026-09', false], ['2026-09', true], ['2025-12', true], ['2026-07', true]] as const)
		for (const u of [0, 1, 13, 14, 15])
			add(`unpaid-${period}-${u}${member ? '-member' : ''}`, ['VN-SI-02', 'VN-PRORATE-01', 'VN-HI-01', 'VN-UI-01', 'VN-LC115-02', ...(member ? ['VN-UNION-01'] : [])], [
				`${u} unpaid working days`, u >= 14 ? 'no SI/HI/UI' : 'insured month', ...(member ? ['member dues'] : [])
			], { period, employee: { unionMember: member }, time: { unpaidDays: u } });
	add('unpaid-whole-month-member', ['VN-SI-02', 'VN-UNION-01'], ['every working day unpaid → no dues'], { employee: { unionMember: true }, time: { unpaidDays: 22 } });
	for (const s of [5, 13, 14, 22])
		add(`sick-${s}`, ['VN-SI-02', 'VN-LC168-01', 'VN-SI-07', 'VN-UNION-01'], [`${s} sick days fund-paid`, s >= 14 ? 'no SI month' : 'insured month'], {
			employee: { unionMember: true }, time: { sickDays: s }
		});
	add('sick-13-unpaid-1', ['VN-SI-02'], ['13 sick + 1 unpaid = 14 → no SI'], { time: { sickDays: 13, unpaidDays: 1 } });

	// ---- union dues cap and fee (VN-UNION-01) ----
	for (const [period, m] of [['2026-06', 46_800_000], ['2026-06', 46_800_001], ['2026-09', 50_600_000], ['2026-09', 20_000_000], ['2025-12', 10_000_000]] as const)
		add(`union-${period}-${m}`, ['VN-UNION-01', 'VN-SI-05'], ['0.5% dues, cap 10% of base salary', 'employer 2% fee'], { period, employee: { unionMember: true }, contract: { monthly: m } });

	// ---- joiners and leavers: 1st, mid-month, last day; the 14-day entry/exit month (VN-SI-01, VN-PRORATE-01) ----
	for (const [period, start] of [
		['2026-09', '2026-09-01'], ['2026-09', '2026-09-15'], ['2026-09', '2026-09-18'], ['2026-09', '2026-09-21'], ['2026-09', '2026-09-30'],
		['2026-01', '2026-01-19'], ['2026-03', '2026-03-16'], ['2025-12', '2025-12-15'], ['2025-12', '2025-12-31'], ['2026-07', '2026-07-01'], ['2026-07', '2026-07-17']
	] as const)
		add(`join-${start}`, ['VN-PRORATE-01', 'VN-SI-01', 'VN-SI-02', 'VN-HI-01', 'VN-PIT-05', 'VN-PIT-02'], [`joiner on ${start.slice(8)}`], {
			period, employee: { unionMember: true }, contract: { start }
		});
	// leavers with an indefinite contract, resignation (severance: UI from hire → none) — exit before the pay date
	// is a payment after the contract (VN-PIT-06 Round 12/18)
	for (const [period, date] of [
		['2026-09', '2026-09-01'], ['2026-09', '2026-09-15'], ['2026-09', '2026-09-18'], ['2026-09', '2026-09-29'], ['2026-09', '2026-09-30'],
		['2026-06', '2026-06-15'], ['2026-06', '2026-06-30'], ['2025-12', '2025-12-10'], ['2025-12', '2025-12-31'], ['2026-03', '2026-03-31']
	] as const)
		add(`leave-${date}`, ['VN-LC34-01', 'VN-LC48-01', 'VN-LC113-02', 'VN-LC113-03', 'VN-PIT-06', 'VN-PIT-11', 'VN-SI-01', 'VN-PRORATE-01'], [
			`resignation on ${date.slice(8)}`, date === monthEnd(period) ? 'exit on the pay date: progressive' : 'paid after the contract: 10% at the threshold'
		], { period, exit: exitOf(date, 'RESIGNATION', { leaveTaken: 4 }) });

	// ---- severance and job loss (LC arts.46–47; D145 art.8) ----
	// citizen with pre-UI service: remainders ≤ 6 / > 6 months, several years
	for (const [hire, uiFrom] of [
		['2008-07-01', '2009-01-01'], ['2008-06-01', '2009-01-01'], ['2007-07-01', '2009-01-01'], ['2007-06-01', '2009-01-01'], ['2006-07-01', '2009-01-01'], ['2008-12-01', '2009-01-01']
	] as const)
		for (const cause of ['END_OF_CONTRACT', 'RESIGNATION', 'MUTUAL', 'REDUNDANCY', 'DISMISSAL'] as const)
			add(`sev-${hire}-${cause.toLowerCase()}`, ['VN-LC46-01', 'VN-LC46-02', 'VN-LC34-01', 'VN-PIT-09', 'VN-LC113-01', 'VN-LC113-03'], [
				`${cause}`, `uncovered service from ${hire}`, cause === 'REDUNDANCY' ? 'job loss 1 month/year, ≥ 2' : cause === 'DISMISSAL' ? 'no severance' : '½ month/year'
			], { period: '2026-09', contract: { start: hire, uiFrom, monthly: 40_000_000 }, exit: exitOf('2026-09-30', cause, { leaveTaken: 6 }) });
	add('sev-pension-eligible', ['VN-LC46-02', 'VN-LC169-02'], ['pension-eligible → no severance'], {
		contract: { start: '2006-07-01', uiFrom: '2009-01-01' }, exit: exitOf('2026-09-30', 'END_OF_CONTRACT', { pensionEligible: true })
	});
	add('sev-pension-eligible-redundancy', ['VN-LC46-02', 'VN-LC34-01'], ['pension-eligible redundancy still owes job loss'], {
		contract: { start: '2006-07-01', uiFrom: '2009-01-01' }, exit: exitOf('2026-09-30', 'REDUNDANCY', { pensionEligible: true })
	});
	add('sev-abandonment', ['VN-LC46-02', 'VN-LC34-01'], ['5 working days abandoned → no severance'], {
		contract: { start: '2006-07-01', uiFrom: '2009-01-01' }, exit: exitOf('2026-09-30', 'ABANDONMENT')
	});
	add('redundancy-full-ui', ['VN-LC46-02', 'VN-LC34-01'], ['fully UI-covered redundancy → 2-month floor'], { exit: exitOf('2026-09-30', 'REDUNDANCY') });
	// foreigner: no UI, so every month of service counts; 11/12 months, remainders, 24 months (job loss floor ends)
	for (const [start, end] of [
		['2025-10-01', '2026-08-31'], ['2025-09-01', '2026-08-31'], ['2025-03-01', '2026-08-31'], ['2025-02-01', '2026-08-31'],
		['2024-09-01', '2026-08-31'], ['2024-10-01', '2026-08-31'], ['2024-03-01', '2026-08-31'], ['2024-09-16', '2026-08-15']
	] as const)
		for (const cause of ['END_OF_CONTRACT', 'REDUNDANCY'] as const)
			add(`sev-foreign-${start}-${cause.toLowerCase()}`, ['VN-LC46-01', 'VN-LC46-02', 'VN-SI-01', 'VN-UI-01', 'VN-PIT-03', 'VN-PIT-05', 'VN-PIT-11'], [
				'foreigner: no UI time', cause, `service ${start}..${end}`
			], {
				period: '2026-08',
				employee: { citizenship: 'FOREIGN', birthDate: '1985-02-10' },
				contract: { start, fixedEnd: end, uiFrom: null, monthly: 60_000_000 },
				exit: exitOf(end, cause)
			});

	// ---- untaken leave on exit: seniority, part-year months, the 50% month, the prior-month wage (VN-LC113-*) ----
	for (const [start, date, taken] of [
		['2021-10-01', '2026-06-30', 0], ['2021-06-01', '2026-06-30', 2], ['2016-01-01', '2026-06-30', 0], ['2011-01-01', '2026-06-30', 20],
		['2026-02-01', '2026-06-30', 0], ['2026-02-16', '2026-06-30', 0], ['2026-02-17', '2026-06-30', 0], ['2006-01-01', '2026-06-30', 1]
	] as const)
		for (const resident of [true, false])
			add(`encash-${start}-${taken}${resident ? '' : '-nonres'}`, ['VN-LC113-01', 'VN-LC113-02', 'VN-LC113-03', 'VN-PIT-11', 'VN-PIT-03'], [
				`service from ${start}`, `${taken} days taken`, resident ? 'resident: untaken-leave pay exempt' : 'non-resident before July: taxed'
			], { period: '2026-06', employee: { taxResident: resident }, contract: { start }, exit: exitOf(date, 'MUTUAL', { leaveTaken: taken }) });
	add('encash-2025-taxed', ['VN-LC113-03', 'VN-PIT-11', 'VN-PIT-01'], ['December 2025: untaken-leave pay taxed'], { period: '2025-12', exit: exitOf('2025-12-31', 'MUTUAL') });
	add('encash-nonres-july', ['VN-LC113-03', 'VN-PIT-11', 'VN-PIT-03'], ['non-resident from July: exempt'], { period: '2026-07', employee: { taxResident: false }, exit: exitOf('2026-07-31', 'MUTUAL') });
	add('encash-exit-50pct-month', ['VN-LC113-02'], ['exit on the 50% day counts the month'], { period: '2026-09', exit: exitOf('2026-09-15', 'MUTUAL') });
	add('encash-exit-under-50pct', ['VN-LC113-02'], ['exit before 50% does not count the month'], { period: '2026-09', exit: exitOf('2026-09-14', 'MUTUAL') });

	// ---- overtime, rest day, holiday and night (LC art.98; D145 arts.55–57; PIT exemption VN-PIT-09) ----
	const otPeriods = ['2025-12', '2026-03', '2026-09'];
	for (const period of otPeriods) {
		const rows = ['VN-LC98-02', 'VN-LC98-03', 'VN-PIT-09', 'VN-LC105-01', period === '2025-12' ? 'VN-PIT-01' : 'VN-PIT-05'];
		add(`ot-weekday-${period}`, rows, ['150% weekday'], { period, time: { ot: { weekday: 10 } } });
		add(`ot-rest-${period}`, rows, ['200% weekly rest'], { period, time: { ot: { rest: 8 } } });
		add(`ot-holiday-${period}`, [...rows, 'VN-LC111-01', 'VN-LC112-01'], ['300% holiday'], { period, time: { ot: { holiday: 8 } } });
		add(`night-plain-${period}`, rows, ['+30% night work'], { period, time: { night: { plain: 40 } } });
		add(`night-ot-weekday-${period}`, rows, ['night OT, no daytime OT (20% × 100%)'], { period, time: { night: { weekdayNoDayOt: 3 } } });
		add(`night-ot-after-day-${period}`, rows, ['night OT after daytime OT (20% × 150%)'], { period, time: { ot: { weekday: 2 }, night: { weekdayAfterDayOt: 2 } } });
		add(`night-ot-rest-${period}`, rows, ['night OT on a rest day (20% × 200%)'], { period, time: { night: { rest: 4 } } });
		add(`night-ot-holiday-${period}`, rows, ['night OT on a holiday (20% × 300%)'], { period, time: { night: { holiday: 4 } } });
		add(`ot-40-${period}`, [...rows, 'VN-LC107-01'], ['40 hours: at the monthly limit'], { period, time: { ot: { weekday: 40 } } });
		add(`ot-41-${period}`, [...rows, 'VN-LC107-01'], ['41 hours: the hour past the limit is taxable'], { period, time: { ot: { weekday: 41 } } });
		add(`ot-nonres-${period}`, [...rows, 'VN-PIT-03'], ['non-resident OT'], { period, employee: { taxResident: false }, time: { ot: { weekday: 10, rest: 8 } } });
	}
	add('ot-nonres-2026-06', ['VN-PIT-09', 'VN-PIT-03'], ['non-resident June 2026: premium-only exemption'], { period: '2026-06', employee: { taxResident: false }, time: { ot: { weekday: 10 } } });
	add('ot-nonres-2026-07', ['VN-PIT-09', 'VN-PIT-03'], ['non-resident July 2026: whole OT exempt'], { period: '2026-07', employee: { taxResident: false }, time: { ot: { weekday: 10 } } });
	add('ot-substitute-day', ['VN-LC111-01', 'VN-LC98-02'], ['Hùng Kings on Sunday 26 April: 300%; substitute 27 April: 200%'], { period: '2026-04', time: { ot: { holiday: 8, rest: 8 } } });

	// ---- PIT: resident brackets at every seam (2026: salary 20m, SI 2.1m, 15.5m relief; December 2025: 10m, 1.05m, 11m) ----
	for (const seam of [10_000_000, 30_000_000, 60_000_000, 100_000_000])
		for (const d of [-1, 0, 1])
			add(`pit-2026-seam-${seam}${d < 0 ? '-under' : d > 0 ? '-over' : ''}`, ['VN-PIT-05', 'VN-PIT-02', 'VN-LC104-01'], [`2026 bracket seam ${seam}`, 'bonus is taxable, not insured'], {
				period: '2026-03', contract: { monthly: 20_000_000 }, bonus: seam - 2_400_000 + d
			});
	for (const seam of [5_000_000, 10_000_000, 18_000_000, 32_000_000, 52_000_000, 80_000_000])
		for (const d of [-1, 0, 1])
			add(`pit-2025-seam-${seam}${d < 0 ? '-under' : d > 0 ? '-over' : ''}`, ['VN-PIT-01', 'VN-LC104-01'], [`December 2025 bracket seam ${seam}`], {
				period: '2025-12', contract: { monthly: 10_000_000 }, bonus: seam + 2_050_000 + d
			});
	add('pit-under-relief', ['VN-PIT-05'], ['assessable income under the relief → no PIT'], { period: '2026-03', contract: { monthly: 17_000_000 } });
	for (const deps of [1, 2, 3])
		for (const period of ['2025-12', '2026-03', '2026-09'])
			add(`pit-deps-${deps}-${period}`, ['VN-PIT-08', period === '2025-12' ? 'VN-PIT-01' : 'VN-PIT-05'], [`${deps} dependants`], { period, employee: { dependants: deps }, contract: { monthly: 45_000_000 } });
	for (const [period, prem] of [['2025-12', 999_999], ['2025-12', 1_000_000], ['2025-12', 1_500_000], ['2026-03', 2_999_999], ['2026-03', 3_000_000], ['2026-03', 3_000_001], ['2026-09', 5_000_000]] as const)
		add(`pit-pension-${period}-${prem}`, ['VN-PIT-10'], [`voluntary pension ${prem}`, period === '2025-12' ? '1m cap' : '3m cap'], { period, employee: { voluntaryPension: prem } });
	for (const period of ['2025-12', '2026-03', '2026-06', '2026-07', '2026-09'])
		add(`pit-nonres-${period}`, ['VN-PIT-03', 'VN-PIT-01'], ['non-resident 20%'], { period, employee: { taxResident: false }, bonus: 5_000_000 });
	add('pit-nonres-foreign-covered', ['VN-PIT-03', 'VN-SI-01', 'VN-UI-01'], ['foreign non-resident on 24-month term: SI/HI, no UI'], {
		employee: { citizenship: 'FOREIGN', taxResident: false }, contract: { start: '2026-01-01', fixedEnd: '2027-12-31', uiFrom: null }
	});

	// ---- short contracts: under 1 month / 1 month / under 3 / 3 months; thresholds 2m / 5m (VN-PIT-06, VN-SI-01, VN-LC168-01) ----
	for (const [period, start, end] of [
		['2026-09', '2026-09-01', '2026-09-21'], ['2026-09', '2026-09-01', '2026-09-29'], ['2026-09', '2026-09-01', '2026-09-30'],
		['2025-12', '2025-12-01', '2025-12-21'], ['2025-12', '2025-12-01', '2025-12-31'], ['2026-03', '2026-03-01', '2026-03-20'],
		['2026-09', '2026-07-01', '2026-09-29'], ['2026-09', '2026-07-01', '2026-09-30'], ['2026-06', '2026-05-01', '2026-06-30']
	] as const)
		add(`short-${start}-${end}`, ['VN-PIT-06', 'VN-SI-01', 'VN-LC168-01', 'VN-UI-01', 'VN-HI-01'], [`fixed term ${start}..${end}`], {
			// D145 art.67(3) prices untaken leave on the month before the exit month; a contract that starts in its exit
			// month has no such month (law silent, no tracker default), so these scenarios leave no untaken leave
			period, contract: { start, fixedEnd: end }, exit: exitOf(end, 'END_OF_CONTRACT', { leaveTaken: start.slice(0, 7) === period ? 12 : 0 })
		});
	// the payment-occasion threshold on a leaver's two-day final month (22 working days; no untaken leave left)
	for (const [period, threshold] of [['2026-06', 2_000_000], ['2026-09', 5_000_000]] as const)
		for (const m of [threshold * 11, threshold * 11 - 11])
			add(`after-contract-threshold-${period}-${m}`, ['VN-PIT-06', 'VN-SI-02'], [`final payment ${(m * 2) / 22} vs ${threshold}`], {
				period, contract: { monthly: m }, exit: exitOf(`${period}-02`, 'RESIGNATION', { leaveTaken: 12 })
			});
	// a leaver's final pay under the post-July 5m threshold (exit on the 1st: salary 1/22)
	add('after-contract-under-5m', ['VN-PIT-06'], ['payment after the contract under 5,000,000 → none'], { exit: exitOf('2026-09-02', 'RESIGNATION', { leaveTaken: 12 }) });
	add('after-contract-june-2m', ['VN-PIT-06'], ['pre-July payment after the contract ≥ 2,000,000 → 10%'], { period: '2026-06', exit: exitOf('2026-06-03', 'RESIGNATION', { leaveTaken: 12 }) });

	// ---- citizenship, retirement age, pensioner (VN-SI-01, VN-LC169-02, VN-LC168-01, VN-UI-01) ----
	for (const [start, end] of [['2026-03-01', '2027-02-27'], ['2026-03-01', '2027-02-28']] as const)
		add(`foreign-term-${end ?? 'indefinite'}`, ['VN-SI-01', 'VN-HI-01', 'VN-UI-01', 'VN-LC168-01', 'VN-PIT-05'], [
			end === '2027-02-28' ? 'fixed term 12 months: SI/HI' : 'fixed term under 12 months: equivalent 20.5%'
		], { employee: { citizenship: 'FOREIGN' }, contract: { start, fixedEnd: end, uiFrom: null } });
	// foreign men born 10/1964 (61y6m) and 9/1964 (61y3m), women born 5/1969 (57y) and 4/1969 (56y8m): signing the
	// month before / on / the month after the retirement day
	for (const [birth, sex] of [['1964-10-10', 'M'], ['1964-09-10', 'M'], ['1969-05-10', 'F'], ['1969-04-10', 'F']] as const) {
		const day = retirementDay(birth, sex);
		for (const [tag, start] of [['before', addDays(day, -1)], ['on', day], ['after', addDays(day, 31)]] as const) {
			if (start > '2026-09-01') continue;
			const fixedEnd = addDays(`${+start.slice(0, 4) + 2}${start.slice(4)}`, -1);
			add(`foreign-retire-${sex}-${birth}-${tag}`, ['VN-LC169-02', 'VN-SI-01', 'VN-LC168-01', 'VN-HI-01'], [`${sex} born ${birth.slice(0, 7)}: signed ${tag} the retirement day`], {
				employee: { citizenship: 'FOREIGN', birthDate: birth, sex, taxResident: true },
				contract: { start, fixedEnd, uiFrom: null }
			});
		}
	}
	for (const [period, member] of [['2026-09', false], ['2026-09', true], ['2025-12', false], ['2026-03', true]] as const)
		add(`pensioner-${period}${member ? '-member' : ''}`, ['VN-LC168-01', 'VN-LC169-02', 'VN-SI-01', 'VN-UI-01', ...(member ? ['VN-UNION-01'] : [])], [
			'pensioner: SI + UI equivalent 18.5%, no HI line', ...(member ? ['dues on the base salary'] : [])
		], { period, employee: { birthDate: '1963-01-05', receivingPension: true, unionMember: member } });
	add('pensioner-joiner-mid-month', ['VN-LC168-01', 'VN-PRORATE-01'], ['equivalent prorated to working days'], { employee: { birthDate: '1963-01-05', receivingPension: true }, contract: { start: '2026-09-16' } });

	// ---- seeded sweep: random wages, regions, periods, dependants, OT and unpaid days ----
	const periods = ['2025-12', '2026-02', '2026-05', '2026-08', '2026-10', '2026-12'];
	for (let i = 0; i < 40; i++) {
		const region = REGIONS[Math.floor(random() * 4)]!;
		const period = periods[Math.floor(random() * periods.length)]!;
		const floor = (period < '2026-01' ? FLOOR_2025 : FLOOR_2026)[region][0];
		const monthly = floor + Math.floor(random() * 120_000) * 1_000;
		add(`sweep-${i}`, ['VN-SI-05', 'VN-UI-04', 'VN-HI-01', 'VN-PIT-05', 'VN-PIT-01', 'VN-LC98-02', 'VN-PRORATE-01', 'VN-MW293-02'], ['seeded sweep'], {
			period,
			company: { region },
			employee: { dependants: Math.floor(random() * 3), unionMember: random() < 0.5 },
			contract: { monthly },
			time: { unpaidDays: Math.floor(random() * 4), ot: { weekday: Math.floor(random() * 12), rest: Math.floor(random() * 2) * 8 } },
			bonus: random() < 0.3 ? Math.floor(random() * 50_000) * 1_000 : 0
		});
	}
	return out;
}

export const coveredRows = () => [...new Set(generateProfiles().flatMap((s) => s.rows))].sort();
