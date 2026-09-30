/**
 * Deterministic PH scenario generator for the independent oracle (tests/e2e/oracle/PH.ts). No Math.random: a
 * seeded mulberry32 draws the mixed family, every other family is enumerated at the tracker's seams.
 *
 * Shape → probe harness (tests/e2e/payroll-probe.ts `ProbeCase`): `id` → case id, profile 'PH', `period` → period,
 * company `pay_frequency: 'MONTHLY'` (the harness default), an `officeWeek(hireDate)` roster (Mon–Fri office,
 * Sat off, Sun rest — the 261-day wage), one employee + employment from `employee`/`employment`, `unpaidLeave`
 * → unpaid leave entries, `work` → time entries, `commission`/`performanceBonus`/`thirteenthMonth`/
 * `silDaysToEncash` → ad-hoc lines, `exitCause` → the exit facts; `expected` from `probeLines(computePayslip(s))`,
 * or the run `refused` when the oracle refuses. `history: 'CONSTANT_BASIC'` marks a scenario whose tax or 13th
 * month assumes earlier months of the year at the same basic (the harness must seed or open them).
 */
import { computePayslip } from '../oracle/PH';

export type WorkEntry = { date: string; start: string; end: string; breakMinutes: number };
export type ExitCause =
	| 'RESIGNATION' | 'JUST_CAUSE' | 'REDUNDANCY' | 'LABOUR_SAVING' | 'RETRENCHMENT' | 'CLOSURE' | 'DISEASE'
	| 'RETIREMENT' | 'KASAMBAHAY_UNJUST_DISMISSAL' | 'KASAMBAHAY_UNJUSTIFIED_DEPARTURE';
export type PHScenario = {
	id: string;
	/** tracker row ids exercised */
	rows: string[];
	/** branch names inside those rows */
	branches: string[];
	/** owner-rule defaults (law silent) this scenario's figures depend on */
	defaults: string[];
	history?: 'CONSTANT_BASIC';
	period: string;
	worksite: 'NCR-MANILA';
	sector: 'NON_AGRICULTURE' | 'RETAIL_SERVICE_15_OR_LESS';
	employee: {
		birthDate: string | null;
		citizenship: 'FILIPINO' | 'FOREIGN';
		residency: 'CITIZEN' | 'RESIDENT_ALIEN' | 'NRA_ETB' | 'NRA_NETB';
		/** SSS member first covered before 60 (stays covered past 60) */
		sssMemberBeforeSixty: boolean;
	};
	employment: {
		type: 'REGULAR' | 'PART_TIME' | 'APPRENTICE' | 'DOMESTIC';
		hireDate: string;
		exitDate?: string;
		monthlyBasic: number;
		hoursPerDay: 8 | 4;
		managerial: boolean;
		minimumWageExemption: boolean;
	};
	exitCause?: ExitCause;
	unpaidLeave: string[];
	work: WorkEntry[];
	commission?: number;
	performanceBonus?: number;
	thirteenthMonth?: boolean;
	silDaysToEncash?: number;
};


function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const OCT = '2026-10';
const base = (id: string, over: Partial<PHScenario> & { employment?: Partial<PHScenario['employment']>; employee?: Partial<PHScenario['employee']> }): PHScenario => ({
	id: `ph-oracle-${id}`,
	rows: over.rows ?? [],
	branches: over.branches ?? [],
	defaults: over.defaults ?? [],
	history: over.history,
	period: over.period ?? OCT,
	worksite: 'NCR-MANILA',
	sector: over.sector ?? 'NON_AGRICULTURE',
	employee: { birthDate: '1990-05-15', citizenship: 'FILIPINO', residency: 'CITIZEN', sssMemberBeforeSixty: false, ...over.employee },
	employment: {
		type: 'REGULAR', hireDate: `${over.period ?? OCT}-01`, monthlyBasic: 30000, hoursPerDay: 8, managerial: false,
		minimumWageExemption: false, ...over.employment
	},
	exitCause: over.exitCause,
	unpaidLeave: over.unpaidLeave ?? [],
	work: over.work ?? [],
	commission: over.commission,
	performanceBonus: over.performanceBonus,
	thirteenthMonth: over.thirteenthMonth,
	silDaysToEncash: over.silDaysToEncash
});
const CORE = ['PH-SS01', 'PH-SRC06', 'PH-HL01', 'PH-SRC01', 'PH-HD01', 'PH-TX01', 'PH-R46', 'PH-HD05'];
const c2 = (x: number) => Math.round(x * 100) / 100;

export function generateProfiles(): PHScenario[] {
	const out: PHScenario[] = [];
	const push = (s: PHScenario) => out.push(s);

	// 1. SSS MSC seams (PHP500 brackets 5,250 … 34,750): one cent below and at each seam. Below-floor pay runs under a
	//    recorded board exemption (PH-A3 exempted branch) so the whole schedule is reachable.
	for (let seam = 5250; seam <= 34750; seam += 500)
		for (const pay of [c2(seam - 0.01), seam]) {
			const exempt = pay < 16421.25;
			push(base(`sss-${pay.toFixed(2)}`, {
				rows: [...CORE, ...(exempt ? ['PH-A3'] : []), ...(seam >= 20250 ? [] : [])],
				branches: [`SSS MSC seam ${seam} ${pay === seam ? 'at' : 'one cent below'}`, seam === 14750 ? 'EC 10/30 seam' : '', seam === 20250 ? 'MPF starts' : '', exempt ? 'exempted pay below floor with warning' : ''].filter(Boolean),
				defaults: ['PHIC employee half truncates'],
				employment: { monthlyBasic: pay, minimumWageExemption: exempt }
			}));
		}
	push(base('sss-floor-4000', { rows: [...CORE, 'PH-A3'], branches: ['SSS MSC floor 5,000', 'PHIC floor'], employment: { monthlyBasic: 4000, minimumWageExemption: true } }));
	push(base('sss-ceiling-60000', { rows: CORE, branches: ['SSS MSC ceiling 35,000 with MPF 15,000'], employment: { monthlyBasic: 60000 } }));

	// 2. PhilHealth floor/ceiling seams and a half-centavo split; Pag-IBIG 1,500 and 10,000 seams.
	for (const pay of [9999.99, 10000, 10000.01, 15819, 99999.99, 100000, 100000.01, 150000])
		push(base(`phic-${pay.toFixed(2)}`, {
			rows: [...CORE, ...(pay < 16421.25 ? ['PH-A3'] : [])],
			branches: [pay === 15819 ? 'half-centavo split' : pay < 50000 ? 'PHIC floor seam' : 'PHIC ceiling seam', pay === 10000.01 || pay === 9999.99 || pay === 10000 ? 'HDMF 10,000 cap seam' : ''].filter(Boolean),
			defaults: ['PHIC employee half truncates'],
			employment: { monthlyBasic: pay, minimumWageExemption: pay < 16421.25 }
		}));
	for (const pay of [1500, 1500.01, 1499.99])
		push(base(`hdmf-${pay.toFixed(2)}`, {
			rows: ['PH-HD01', 'PH-SS01', 'PH-HL01', 'PH-A3'],
			branches: ['HDMF employee 1%/2% seam at 1,500'],
			employment: { monthlyBasic: pay, minimumWageExemption: true }
		}));

	// 3. Annex E monthly rungs: taxable (after contributions) at each rung floor and one cent above.
	for (const target of [20833, 33333, 66667, 166667, 666667])
		for (const want of [target, c2(target + 0.01), c2(target - 0.01)]) {
			const pay = solveTaxable(want);
			if (pay === undefined) continue;
			push(base(`wtax-${want.toFixed(2)}`, {
				rows: ['PH-TX01', 'PH-WH08', ...CORE],
				branches: [`Annex E monthly rung ${target} (taxable ${want})`],
				employment: { monthlyBasic: pay }
			}));
		}

	// 4. Regular vs supplementary (PH-WH10) and cumulative-average triggers (PH-WH11), first payroll period.
	const nov = '2026-11';
	const otDays = (period: string, days: number[], end = '21:00') =>
		days.map((d) => ({ date: `${period}-${String(d).padStart(2, '0')}`, start: '09:00', end, breakMinutes: 60 }));
	push(base('wh10-bracket-from-regular', {
		rows: ['PH-WH10', 'PH-HR06', ...CORE], branches: ['rung from regular, rate on regular + OT'],
		employment: { monthlyBasic: 36000 }, work: otDays(OCT, [5, 6, 7, 8, 9, 12, 13])
	}));
	push(base('wh10-regular-near-rung-top', {
		rows: ['PH-WH10', 'PH-HR06', ...CORE], branches: ['OT crosses the 33,333 rung; bracket stays on regular'],
		employment: { monthlyBasic: 35000 }, work: otDays(OCT, [5, 6, 7, 8, 9, 12, 13, 14, 15, 16])
	}));
	push(base('wh11-supp-exceeds-regular', {
		rows: ['PH-WH11', 'PH-LB05', ...CORE], branches: ['cumulative: supplementary ≥ regular'],
		employment: { monthlyBasic: 25000 }, commission: 30000
	}));
	push(base('wh11-regular-exempt-commission', {
		rows: ['PH-WH11', 'PH-LB05', ...CORE], branches: ['cumulative: regular below the level with commission'],
		employment: { monthlyBasic: 18000, minimumWageExemption: false }, commission: 9000
	}));
	push(base('lb05-commission-sss-hdmf-not-phic', {
		rows: ['PH-LB05', 'PH-HD02', ...CORE], branches: ['commission in SSS and fund salary, outside PhilHealth'],
		employment: { monthlyBasic: 20000 }, commission: 5000
	}));

	// 5. Minimum-wage earners (PH-WH09) and floors (PH-WG10, PH-A3, PH-WG59, PH-EBET05).
	const mweOt = otDays(OCT, [5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20], '23:00');
	push(base('wh09-mwe-ot-exempt', { rows: ['PH-WH09', 'PH-WG10', 'PH-WG59', 'PH-HR06', ...CORE], branches: ['MWE: SMW, OT and night pay exempt'], employment: { monthlyBasic: 16421.25 }, work: mweOt }));
	push(base('wh09-one-cent-above-smw', { rows: ['PH-WH09', 'PH-WH11', 'PH-HR06', ...CORE], branches: ['not an MWE one cent above the SMW: OT taxable, cumulative'], employment: { monthlyBasic: 16421.26 }, work: mweOt }));
	push(base('wh09-mwe-commission-taxed', { rows: ['PH-WH09', 'PH-LB05', ...CORE], branches: ['MWE commission taxed on the table'], defaults: ['MWE contributions come out of the exempt SMW'], employment: { monthlyBasic: 16421.25 }, commission: 30000 }));
	push(base('wh09-mwe-retail', { rows: ['PH-WH09', 'PH-WG10'], branches: ['retail ≤15 floor 718'], sector: 'RETAIL_SERVICE_15_OR_LESS', employment: { monthlyBasic: 15616.5 }, work: otDays(OCT, [5, 6]) }));
	const floors: [string, string, PHScenario['sector'], number, boolean, string][] = [
		['oct-nonagri-at', OCT, 'NON_AGRICULTURE', 16421.25, false, 'NCR-28 755 at floor'],
		['oct-nonagri-below', OCT, 'NON_AGRICULTURE', 16421.24, false, 'NCR-28 755 one cent below → refused'],
		['oct-retail-at', OCT, 'RETAIL_SERVICE_15_OR_LESS', 15616.5, false, 'NCR-28 718 at floor'],
		['oct-retail-below', OCT, 'RETAIL_SERVICE_15_OR_LESS', 15616.49, false, 'NCR-28 718 below → refused'],
		['oct-nonagri-at-retail-rate', OCT, 'NON_AGRICULTURE', 15616.5, false, 'wrong class rate refused'],
		['jul-nonagri-at', '2026-07', 'NON_AGRICULTURE', 15116.25, false, 'NCR 695 at floor in July'],
		['jul-nonagri-below', '2026-07', 'NON_AGRICULTURE', 15116.24, false, 'NCR 695 below → refused'],
		['jul-retail-at', '2026-07', 'RETAIL_SERVICE_15_OR_LESS', 14311.5, false, 'NCR 658 at floor'],
		['sep-cutover-old-rate', '2026-09', 'NON_AGRICULTURE', 15116.25, false, '26 Sep cutover inside the window → refused'],
		['sep-cutover-new-rate', '2026-09', 'NON_AGRICULTURE', 16421.25, false, '26 Sep cutover paid at the new floor'],
		['oct-exempt-below', OCT, 'NON_AGRICULTURE', 12000, true, 'recorded exemption pays with a warning']
	];
	for (const [id, period, sector, pay, exempt, branch] of floors)
		push(base(`floor-${id}`, { rows: ['PH-WG01', 'PH-WG10', 'PH-A3', 'PH-WG59', ...CORE], branches: [branch], period, sector, employment: { monthlyBasic: pay, minimumWageExemption: exempt } }));
	for (const [pay, branch] of [[8210.63, 'part-time 4h at the proportional floor'], [8210.62, 'part-time below → refused']] as const)
		push(base(`floor-part-time-${pay}`, { rows: ['PH-A3', 'PH-WG10', ...CORE], branches: [branch], defaults: ['part-time floor = daily floor × hours/8'], employment: { type: 'PART_TIME', hoursPerDay: 4, monthlyBasic: pay } }));
	for (const [pay, branch] of [[12315.94, 'apprentice at 75% of 755'], [12315.93, 'apprentice below 75% → refused']] as const)
		push(base(`floor-apprentice-${pay}`, { rows: ['PH-EBET05', 'PH-WG10', ...CORE], branches: [branch], employment: { type: 'APPRENTICE', monthlyBasic: pay } }));

	// 6. Kasambahay (PH-WG02, PH-WG04, PH-WG07, PH-SS11, PH-HD03, PH-HR45).
	const kas = { type: 'DOMESTIC' as const, monthlyBasic: 7800 };
	push(base('kas-oct-full', { rows: ['PH-WG02', 'PH-WG04', 'PH-SS11', 'PH-HD03', 'PH-HL01'], branches: ['7,800 full month, split shares ≥5,000'], employment: kas }));
	push(base('kas-oct-below', { rows: ['PH-WG04', 'PH-A3'], branches: ['below domestic floor → refused'], employment: { ...kas, monthlyBasic: 7799.99 } }));
	push(base('kas-exempt-refused', { rows: ['PH-WG07', 'PH-A3'], branches: ['no exemption for a domestic worker'], employment: { ...kas, monthlyBasic: 7000, minimumWageExemption: true } }));
	push(base('kas-jan-7000', { rows: ['PH-WG04'], branches: ['7,000 through 6 Feb 2026'], period: '2026-01', employment: { ...kas, monthlyBasic: 7000, hireDate: '2026-01-01' } }));
	push(base('kas-feb-7000-refused', { rows: ['PH-WG04'], branches: ['7,800 from 7 Feb: 7,000 refused'], period: '2026-02', employment: { ...kas, monthlyBasic: 7000, hireDate: '2026-02-01' } }));
	for (const [hire, branch] of [['2026-10-20', 'joiner under one month of service: no SSS/PhilHealth/Pag-IBIG (RA 10361 s.30)'], ['2026-10-31', 'one-day joiner: not yet covered'], ['2026-09-30', 'joiner completing one month on 30 Oct: covered']] as const)
		push(base(`kas-joiner-${hire}`, { rows: ['PH-SS11', 'PH-HD03', 'PH-PR01', 'PH-HR02'], branches: [branch], defaults: ['kasambahay part month by calendar days', 'one month of service judged at the window end'], employment: { ...kas, hireDate: hire } }));
	// Covered leavers whose part month falls below PHP5,000: household SSS table, employer-only Pag-IBIG and PhilHealth.
	for (const [exit, branch] of [['2026-10-01', 'one-day month: household MSC 1,000'], ['2026-10-05', 'household MSC 1,500'], ['2026-10-10', 'household MSC 2,500'], ['2026-10-19', 'household MSC 5,000 bracket 4,750–4,999.99, employer pays all'], ['2026-10-20', 'just above 5,000: shares split']] as const)
		push(base(`kas-leaver-${exit}`, { rows: ['PH-SS11', 'PH-HD03', 'PH-HL01', 'PH-PR01', 'PH-HR02'], branches: [branch], defaults: ['kasambahay part month by calendar days', 'PhilHealth: employer pays all below PHP5,000 month compensation', 'PhilHealth on the full contractual basic'], history: 'CONSTANT_BASIC', employment: { ...kas, hireDate: '2025-03-03', exitDate: exit }, exitCause: 'RESIGNATION' }));
	push(base('kas-unjust-dismissal', { rows: ['PH-HR45', 'PH-SS11', 'PH-HD03'], branches: ['earned pay + 15 days indemnity'], defaults: ['kasambahay day = monthly × 12/365', 'indemnity outside SSS/HDMF, tax-exempt'], employment: { ...kas, hireDate: '2025-01-06', exitDate: '2026-10-20' }, exitCause: 'KASAMBAHAY_UNJUST_DISMISSAL', history: 'CONSTANT_BASIC' }));
	push(base('kas-unjustified-departure', { rows: ['PH-HR45'], branches: ['up to 15 days unpaid salary forfeited'], defaults: ['kasambahay day = monthly × 12/365', 'forfeiture does not reduce SSS compensation'], employment: { ...kas, hireDate: '2025-01-06', exitDate: '2026-10-25' }, exitCause: 'KASAMBAHAY_UNJUSTIFIED_DEPARTURE', history: 'CONSTANT_BASIC' }));

	// 7. Ages (PH-SS10, PH-HD05): first coverage at hire 1 Oct 2026 on, before and after the 60th birthday.
	const ages: [string, string, boolean, string][] = [
		['59', '1966-10-02', false, 'hired the day before the 60th birthday'],
		['60-birthday', '1966-10-01', false, 'hired on the 60th birthday: covered'],
		['60-plus-1d', '1966-09-30', false, 'hired a day after the 60th birthday: no SSS/EC, no Pag-IBIG'],
		['62-member', '1964-06-01', true, 'member first covered before 60 stays covered; no Pag-IBIG'],
		['70-new', '1956-03-03', false, 'new employee over 60: PhilHealth only']
	];
	for (const [id, birth, member, branch] of ages)
		push(base(`age-${id}`, { rows: ['PH-SS10', 'PH-HD05', 'PH-HL01'], branches: [branch], defaults: ['Pag-IBIG "not over sixty" read as up to the 60th birthday'], employee: { birthDate: birth, sssMemberBeforeSixty: member } }));
	push(base('age-unknown', { rows: ['PH-SS10'], branches: ['unknown birth date refuses'], employee: { birthDate: null } }));

	// 8. Residency (PH-WH24, PH-TX01).
	for (const residency of ['RESIDENT_ALIEN', 'NRA_ETB', 'NRA_NETB'] as const)
		for (const pay of [40000, 90000])
			push(base(`res-${residency}-${pay}`, { rows: ['PH-WH24', 'PH-TX01', ...CORE], branches: [residency === 'NRA_NETB' ? '25% of gross' : 'graduated table'], employee: { citizenship: 'FOREIGN', residency } , employment: { monthlyBasic: pay } }));

	// 9. Proration (PH-PR01): joiners, leavers (resignation) and unpaid leave in October 2026 (no national holiday).
	for (const [hire, branch] of [['2026-10-01', 'hire on the 1st: full month'], ['2026-10-15', 'mid-month joiner'], ['2026-10-30', 'last weekday joiner'], ['2026-10-05', 'first Monday joiner (1–2 Oct unpaid)']] as const)
		for (const pay of [30000, 60000])
			push(base(`join-${hire}-${pay}`, { rows: ['PH-PR01', ...CORE], branches: [branch], defaults: ['part month = employed weekdays × monthly × 12/261', 'PhilHealth on the full contractual basic'], employment: { hireDate: hire, monthlyBasic: pay } }));
	for (const [exit, branch] of [['2026-10-01', 'leaver on the 1st'], ['2026-10-15', 'mid-month leaver'], ['2026-10-31', 'leaver on the last day: full month']] as const)
		push(base(`leave-${exit}`, { rows: ['PH-PR01', 'PH-SRC07', 'PH-WH12', ...CORE], branches: [branch, 'final annualisation on exit'], defaults: ['part month = employed weekdays × monthly × 12/261'], history: 'CONSTANT_BASIC', employment: { hireDate: '2026-10-01', exitDate: exit, monthlyBasic: 30000 }, exitCause: 'RESIGNATION' }));
	for (const days of [1, 5, 10])
		push(base(`unpaid-${days}`, { rows: ['PH-PR01', 'PH-HL01', ...CORE], branches: [`${days} unpaid days reduce SSS/HDMF base, PhilHealth keeps the basic`], employment: { monthlyBasic: 30000 }, unpaidLeave: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].slice(0, days) }));

	// 10. Hours, holidays and premiums in November 2026 (2 Nov special, 1 Nov special on Sunday, 30 Nov regular).
	const h = (date: string, start: string, end: string, breakMinutes = 60): WorkEntry => ({ date, start, end, breakMinutes });
	const hours: [string, WorkEntry[], string[], string][] = [
		['ot-ordinary', [h('2026-11-03', '09:00', '21:00')], ['PH-HR06'], 'ordinary OT +25%'],
		['rest-day-8h', [h('2026-11-08', '09:00', '18:00')], ['PH-HR06'], 'rest day 130%'],
		['rest-day-ot', [h('2026-11-08', '09:00', '21:00')], ['PH-HR06'], 'rest-day OT 130% × 130%'],
		['special-day', [h('2026-11-02', '09:00', '18:00')], ['PH-HR05', 'PH-HR36', 'PH-HR06'], 'special day worked +30%'],
		['special-day-ot', [h('2026-11-02', '09:00', '21:00')], ['PH-HR06', 'PH-HR36'], 'special-day OT 130% × 130%'],
		['special-on-rest', [h('2026-11-01', '09:00', '18:00')], ['PH-HR06', 'PH-HR36'], 'special day on the rest day 150%'],
		['special-on-rest-ot', [h('2026-11-01', '09:00', '20:00')], ['PH-HR06', 'PH-HR36'], 'special on rest OT 150% × 130%'],
		['regular-holiday', [h('2026-11-30', '09:00', '18:00')], ['PH-HR05', 'PH-HR36'], 'regular holiday worked 200%'],
		['regular-holiday-ot', [h('2026-11-30', '09:00', '22:00')], ['PH-HR05', 'PH-HR06', 'PH-HR36'], 'regular holiday OT 200% × 130%'],
		['night-ordinary', [h('2026-11-04', '14:00', '23:00')], ['PH-HR06'], 'night differential on normal hours'],
		['night-ot', [h('2026-11-04', '13:00', '01:00')], ['PH-HR06'], 'night hours inside the last OT hours'],
		['graveyard', [h('2026-11-05', '22:00', '07:00')], ['PH-HR06'], 'normal hours mostly at night'],
		['night-rest-day', [h('2026-11-15', '18:00', '03:00')], ['PH-HR06'], 'night on the rest day 10% of 130%'],
		['mixed-week', [h('2026-11-02', '09:00', '19:00'), h('2026-11-03', '09:00', '20:00'), h('2026-11-08', '10:00', '15:00'), h('2026-11-30', '08:00', '18:00')], ['PH-HR05', 'PH-HR06', 'PH-HR36'], 'mixed premiums in one month']
	];
	for (const [id, work, rows, branch] of hours)
		for (const pay of [30000, 45000])
			push(base(`hours-${id}-${pay}`, { rows: [...rows, 'PH-WH10', 'PH-WH11', ...CORE], branches: [branch], defaults: ['unpaid break after four hours worked', 'hourly = monthly × 12/261/8'], period: nov, employment: { hireDate: '2026-11-01', monthlyBasic: pay }, work }));
	push(base('holiday-absent-before', { rows: ['PH-HR05', 'PH-HR36', 'PH-PR01'], branches: ['absent unpaid on the preceding workday: regular holiday unpaid'], period: nov, employment: { hireDate: '2026-11-01' }, unpaidLeave: ['2026-11-27'] }));
	push(base('holiday-absent-two-before', { rows: ['PH-HR05', 'PH-PR01'], branches: ['absent two days before: holiday still paid'], period: nov, employment: { hireDate: '2026-11-01' }, unpaidLeave: ['2026-11-26'] }));

	// 11. Bonus, 13th month and the PHP90,000 pool (PH-SS08, PH-SS09, PH-WH08, PH-HR14, PH-HD02).
	push(base('bonus-performance-20000', { rows: ['PH-SS09', 'PH-HD02', 'PH-WH08', ...CORE], branches: ['performance bonus is SSS compensation, inside the 90,000 pool'], employment: { monthlyBasic: 30450 }, performanceBonus: 20000 }));
	push(base('bonus-over-pool', { rows: ['PH-WH08', 'PH-SS09', ...CORE], branches: ['bonus 95,000: 5,000 excess supplementary'], employment: { monthlyBasic: 40000 }, performanceBonus: 95000 }));
	push(base('bonus-at-pool', { rows: ['PH-WH08'], branches: ['bonus exactly 90,000 exempt'], employment: { monthlyBasic: 40000 }, performanceBonus: 90000 }));
	push(base('bonus-pool-plus-cent', { rows: ['PH-WH08'], branches: ['bonus 90,000.01'], employment: { monthlyBasic: 40000 }, performanceBonus: 90000.01 }));
	const dec = '2026-12';
	const th: [string, string, boolean, number, string][] = [
		['full-year', '2020-03-02', false, 20000, 'December 13th month on a full year'],
		['mid-year-hire', '2026-07-16', false, 20000, 'pro-rata 13th for a July joiner'],
		['hire-dec-1', '2026-12-01', false, 20000, 'worked exactly one month: entitled'],
		['hire-dec-2', '2026-12-02', false, 20000, 'less than a month: none'],
		['managerial', '2020-03-02', true, 20000, 'managerial: none'],
		['full-year-15000', '2024-01-15', false, 16421.25 + 1000, 'full year near the floor']
	];
	for (const [id, hire, managerial, pay, branch] of th)
		push(base(`13m-${id}`, { rows: ['PH-HR14', 'PH-SS08', 'PH-WH08', 'PH-WH12', ...CORE], branches: [branch, 'December annualisation'], defaults: ['13th month outside Pag-IBIG fund salary', '"at least a month" judged at year end'], history: 'CONSTANT_BASIC', period: dec, employment: { hireDate: hire, monthlyBasic: c2(pay), managerial }, thirteenthMonth: true }));

	// 12. Exits in October 2026: causes × tenure seams (PH-HR15, PH-HR16, PH-SRC07, PH-HR08, PH-13M, PH-WH12).
	const causes: ExitCause[] = ['RESIGNATION', 'JUST_CAUSE', 'REDUNDANCY', 'LABOUR_SAVING', 'RETRENCHMENT', 'CLOSURE', 'DISEASE'];
	const tenures: [string, string][] = [
		['7m', '2026-03-16'], ['5y5m', '2021-04-17'], ['5y6m', '2021-04-16'], ['10y', '2016-10-16']
	];
	for (const cause of causes)
		for (const [t, hire] of tenures)
			push(base(`exit-${cause.toLowerCase()}-${t}`, {
				rows: ['PH-HR15', 'PH-SRC07', 'PH-13M', 'PH-HR14', 'PH-HR08', 'PH-WH12', 'PH-SS08', ...CORE],
				branches: [`${cause} after ${t}`, t === '7m' ? 'one-month minimum' : t.startsWith('5y') ? 'six-month fraction seam' : 'whole years'],
				defaults: ['service in calendar months to the day after exit', 'separation pay outside SSS/HDMF', '13th month outside Pag-IBIG'],
				history: 'CONSTANT_BASIC',
				employment: { hireDate: hire, exitDate: '2026-10-15', monthlyBasic: 20000 },
				exitCause: cause, thirteenthMonth: true, silDaysToEncash: t === '7m' ? undefined : 3.75
			}));
	for (const [id, exit, pay] of [['taxable-refund', '2026-10-15', 45000], ['taxable-month-end', '2026-10-31', 45000]] as const)
		push(base(`exit-${id}`, { rows: ['PH-WH12', 'PH-SRC07', 'PH-13M', 'PH-HR15', ...CORE], branches: ['annualised on exit: excess refunded'], history: 'CONSTANT_BASIC', employment: { hireDate: '2019-02-01', exitDate: exit, monthlyBasic: pay }, exitCause: 'REDUNDANCY', thirteenthMonth: true, silDaysToEncash: 5 }));
	const retire: [string, string, string, string][] = [
		['59-10y9m', '1967-01-10', '2016-01-04', 'age 59: none'],
		['60-10y9m', '1966-06-10', '2016-01-04', 'age 60 with 10 y 9 m (11 years)'],
		['65-20y9m', '1961-03-10', '2006-01-04', 'age 65 compulsory, 20 y 9 m (21 years)'],
		['62-4y', '1964-06-01', '2022-10-03', 'exactly four years: none'],
		['62-5y', '1964-06-01', '2021-10-01', 'exactly five years'],
		['62-10y7m', '1964-06-01', '2016-03-31', '10 y 7 m counts as 11']
	];
	for (const [id, birth, hire, branch] of retire)
		push(base(`retire-${id}`, { rows: ['PH-HR16', 'PH-SS10', 'PH-HD05', 'PH-13M', 'PH-SRC07', ...CORE], branches: [branch], defaults: ['retirement day = monthly × 12/261', 'retirement pay outside SSS/HDMF'], history: 'CONSTANT_BASIC', employee: { birthDate: birth, sssMemberBeforeSixty: true }, employment: { hireDate: hire, exitDate: '2026-10-30', monthlyBasic: 30450 }, exitCause: 'RETIREMENT', thirteenthMonth: true }));

	// 13. Mixed family: seeded draws across pay, OT and commission (first payroll period, October 2026).
	const rand = mulberry32(0x9e3779b9);
	for (let i = 0; i < 40; i++) {
		const pay = c2(16421.25 + rand() * 180000);
		const otCount = Math.floor(rand() * 6);
		const commission = rand() < 0.4 ? c2(rand() * 40000) : undefined;
		push(base(`mixed-${String(i).padStart(2, '0')}`, {
			rows: ['PH-WH10', 'PH-WH11', 'PH-HR06', 'PH-LB05', ...CORE], branches: ['seeded mix'],
			defaults: ['unpaid break after four hours worked'],
			employment: { monthlyBasic: pay }, commission,
			work: otDays(OCT, [5, 6, 7, 8, 9, 12].slice(0, otCount), rand() < 0.5 ? '20:00' : '23:00')
		}));
	}
	return out;
}

/** A monthly basic (first period, citizen, October 2026) whose taxable pay equals `want`, if one exists. */
function solveTaxable(want: number): number | undefined {
	const taxableOf = (pay: number) => {
		const slip = computePayslip(base('solve', { employment: { monthlyBasic: pay } }));
		return slip.lines.WTAX?.base ?? c2(pay - slip.total_deductions);
	};
	// Taxable pay rises by at most a centavo per centavo of pay: walk pesos to the target, then centavos (bounded).
	let pay = want;
	for (let i = 0; i < 20000 && taxableOf(pay) < want; i++) pay += 1;
	for (let p = c2(pay - 1), i = 0; i <= 200; i++, p = c2(p + 0.01)) if (Math.abs(taxableOf(p) - want) < 0.005) return p;
	return undefined;
}
