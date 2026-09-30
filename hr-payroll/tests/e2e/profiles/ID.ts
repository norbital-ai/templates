/**
 * Deterministic ID scenario generator for the independent oracle (tests/e2e/oracle/ID.ts).
 *
 * Every scenario is tagged with the docs/inventory/indonesia.csv row ids and branch names it exercises. The shape
 * maps onto a probe case (tests/e2e/payroll-probe.ts): `id`, `profile`, `description`, `period`; `company` becomes
 * the company row, `employee`/`employment` the employees/employments/terms inputs, `inputs` the leave, timesheet,
 * holiday and adhoc rows; `expected` comes from `computePayslip(scenario)` via `probeLines`. `runs` lists every
 * period the harness must run in order (earlier months of the year feed a December or exit reckoning); the expected
 * lines are the last run's.
 *
 * Seeded (mulberry32, fixed seed); no Math.random, no clock.
 */
import {
	computePayslip,
	DKI_UMSP_2026,
	DKI_UMSP_2026_CONDITIONAL,
	floorOn,
	periodsToRun,
	TER,
	type ExitCause,
	type Ptkp,
	type RiskGroup,
	type Scenario,
	type Workplace
} from '../oracle/ID.ts';

type Patch = {
	period?: string;
	company?: Partial<Scenario['company']>;
	employee?: Partial<Scenario['employee']>;
	employment?: Partial<Scenario['employment']>;
	inputs?: Partial<Scenario['inputs']>;
};

const mulberry32 = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

export function generateProfiles(): Scenario[] {
	const rand = mulberry32(0x1d_2026);
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
	/** a birth date giving a working-age adult (25–45) on 2026-01-01, varied by the seed */
	const adult = () =>
		`${1981 + Math.floor(rand() * 20)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
	const out: Scenario[] = [];
	const build = (
		id: string,
		rows: string[],
		branches: string[],
		description: string,
		p: Patch = {}
	): Scenario => {
		const period = p.period ?? '2026-02';
		const s: Scenario = {
		id: `ID-O-${id}`,
		profile: 'ID',
		rows,
		branches,
		description,
		period,
		runs: [],
		company: {
			workplace: 'DKI',
			kbli: '62019',
			jkkRiskGroup: 'I',
			umspConditions: [],
			padatKarya: false,
			workWeek: 5,
			dtpKlu: false,
			microSmall: false,
			...p.company
		},
		employee: {
			birthDate: adult(),
			citizen: true,
			taxResident: true,
			hasTaxId: true,
			ptkp: 'TK/0',
			foreignWorkMonths: 0,
			jpRegistered: false,
			jpDeferral: false,
			kesehatanExtraMembers: 0,
			subjectivePartYear: false,
			zakat: 0,
			...p.employee
		},
		employment: {
			type: 'PKWTT',
			payBasis: 'MONTHLY',
			partTime: false,
			// a December (last-period) case joins that month unless it names a hire date: one run reckons the year
			hireDate: period.endsWith('-12') ? `${period}-01` : '2025-06-02',
			contractEnd: null,
			exitDate: null,
			exitCause: null,
			basic: 8_000_000,
			raise: null,
			fixedAllowance: 0,
			nonFixedAllowance: 0,
			rate: 0,
			serviceFee: 0,
			...p.employment
		},
		inputs: {
			unpaidDates: [],
			paidLeave: [],
			overtime: [],
			thrHolidayDate: null,
			bonus: 0,
			wageDeduction: 0,
			uangPisah: 0,
			reducedPay: null,
			...p.inputs
		}
		};
		s.runs = periodsToRun(s);
		return s;
	};
	const make = (...a: Parameters<typeof build>) => {
		const s = build(...a);
		out.push(s);
		return s;
	};
	const BPJS = ['ID-14', 'ID-15', 'ID-16', 'ID-17', 'ID-19'];

	// ---- 1. TER seams (PP 58/2023 annex): gross at each upper bound and one sen above. Denpasar keeps the
	// floor (3,499,878.78) under the lowest seam. The TER gross includes employer JKK/JKM/Kesehatan (PMK168 5(3)).
	const seam = (cat: 'A' | 'B' | 'C', ptkp: Ptkp, every: number) =>
		TER[cat].slice(0, -1).forEach(([upper], i) => {
			if (i % every !== 0) return;
			const probe = (basic: number) =>
				computePayslip(
					build('probe', [], [], '', {
						company: { workplace: 'DENPASAR' },
						employee: { ptkp },
						employment: { basic }
					})
				).statutory.PPH21!.base;
			const sen = (x: number) => Math.round(x * 100) / 100;
			let basic = Math.round(upper / 1.0454);
			for (let k = 0; k < 30; k++) {
				const next = sen(basic + (upper - probe(basic)));
				if (next === basic) break;
				basic = next;
			}
			// the largest basic (to the sen) whose TER gross is still on or under the bound
			while (probe(basic) > upper) basic = sen(basic - 1);
			while (probe(basic + 1) <= upper) basic = sen(basic + 1);
			while (probe(sen(basic + 0.01)) <= upper) basic = sen(basic + 0.01);
			let above = sen(basic + 0.01);
			while (probe(above) <= upper) above = sen(above + 0.01);
			const exact = probe(basic) === upper;
			for (const [tag, b] of [
				['at', basic],
				['above', above]
			] as const)
				make(
					`TER-${cat}-${i + 1}-${tag}`,
					['ID-21', 'ID-127', 'ID-102', ...BPJS],
					[`TER ${cat} row ${i + 1} ${tag} ${upper}${exact ? '' : ' (nearest reachable)'}`],
					`Monthly TER category ${cat} (${ptkp}) with gross ${tag === 'at' ? 'on' : 'one sen above'} the ${upper} bound`,
					{ company: { workplace: 'DENPASAR' }, employee: { ptkp }, employment: { basic: b } }
				);
		});
	seam('A', 'TK/0', 1);
	seam('B', 'K/1', 3);
	seam('C', 'K/3', 3);

	// ---- 2. PTKP statuses: a February TER month and a December (last period) joiner.
	const statuses: Ptkp[] = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];
	for (const ptkp of statuses) {
		make(
			`PTKP-${ptkp.replace('/', '')}-feb`,
			['ID-21', ...BPJS],
			[`TER category of ${ptkp}`],
			`${ptkp} in a TER month`,
			{
				employee: { ptkp },
				employment: { basic: 12_000_000 }
			}
		);
		make(
			`PTKP-${ptkp.replace('/', '')}-dec`,
			['ID-21', 'ID-122', 'ID-127', 'ID-94', ...BPJS],
			[`December reckoning with ${ptkp} PTKP`],
			`${ptkp} December 2025 joiner: annual reckoning on the one month`,
			{
				period: '2025-12',
				employee: { ptkp },
				employment: { basic: 25_000_000, hireDate: '2025-12-01' }
			}
		);
	}

	// ---- 3. No NPWP/NIK: 120% (UU PPh art 21(5a)).
	make(
		'NOTAXID-feb',
		['ID-21', 'ID-45', ...BPJS],
		['TER ×120% without a tax id'],
		'TER month without a tax id',
		{
			employee: { hasTaxId: false },
			employment: { basic: 15_000_000 }
		}
	);
	make(
		'NOTAXID-dec',
		['ID-21', 'ID-122', ...BPJS],
		['December reckoning ×120%'],
		'December joiner without a tax id',
		{
			period: '2025-12',
			employee: { hasTaxId: false },
			employment: { basic: 30_000_000, hireDate: '2025-12-01' }
		}
	);

	// ---- 4. December reckoning variants.
	make(
		'DEC-midjoin',
		['ID-122', 'ID-106', 'ID-161', ...BPJS],
		['December joiner on the 15th'],
		'Part December, reckoned',
		{
			period: '2025-12',
			employment: { basic: 40_000_000, hireDate: '2025-12-15' }
		}
	);
	make(
		'DEC-zakat',
		['ID-122'],
		['zakat through the employer reduces neto'],
		'December joiner paying zakat',
		{
			period: '2025-12',
			employee: { zakat: 1_000_000 },
			employment: { basic: 80_000_000, hireDate: '2025-12-01' }
		}
	);
	make(
		'DEC-2026',
		['ID-122', 'ID-164', ...BPJS],
		['December 2026 on the 2026 floor and ceiling'],
		'December 2026 joiner',
		{
			period: '2026-12',
			employment: { basic: 70_000_000, hireDate: '2026-12-01' }
		}
	);
	make(
		'DEC-lastday',
		['ID-122', 'ID-106'],
		['joiner on the last day of December'],
		'One December day',
		{
			period: '2025-12',
			employment: { basic: 31_000_000, hireDate: '2025-12-31' }
		}
	);

	// ---- 4b. Last-period reckoning over earlier months of the year (ID-21 open branch: TER withheld netted).
	make(
		'DEC-fullyear',
		['ID-21', 'ID-122', 'ID-127', ...BPJS],
		['December reckoning less TER withheld January–November'],
		'A whole 2025 on one wage: runs January to December',
		{
			period: '2025-12',
			employee: { ptkp: 'K/1' },
			employment: { basic: 15_000_000, hireDate: '2024-03-01' }
		}
	);
	make(
		'DEC-fullyear-2026-dtp',
		['ID-21', 'ID-122', 'ID-84', 'ID-23'],
		['December 2026 reckoning, every month borne by government'],
		'PMK 105/2025 annex B example 1 shape (8,000,000 TK/0)',
		{
			period: '2026-12',
			company: { dtpKlu: true, workplace: 'DENPASAR', kbli: '13111' },
			employment: { basic: 8_000_000, hireDate: '2023-01-02' }
		}
	);
	make(
		'LEAVE-midyear',
		['ID-21', 'ID-122', 'ID-28', 'ID-106'],
		['exit reckoning less TER withheld January–May'],
		'Resignation on 15 June 2026: runs January to June',
		{
			period: '2026-06',
			employment: { basic: 12_000_000, hireDate: '2023-07-03', exitDate: '2026-06-15', exitCause: 'RESIGNATION' },
			inputs: { uangPisah: 2_000_000 }
		}
	);
	make(
		'DEC-joined-oct',
		['ID-21', 'ID-122', 'ID-106'],
		['reckoning from a mid-October joiner'],
		'Joined 16 October 2025: runs October to December',
		{
			period: '2025-12',
			employment: { basic: 20_000_000, hireDate: '2025-10-16' }
		}
	);

	// ---- 5. BPJS seams.
	for (const [period, cap] of [
		['2025-12', 10_547_400],
		['2026-02', 10_547_400],
		['2026-03', 11_086_300]
	] as const)
		for (const [tag, basic] of [
			['at', cap],
			['above', cap + 0.01]
		] as const)
			make(
				`JP-cap-${period}-${tag}`,
				['ID-15', 'ID-164'],
				[`JP ceiling ${cap} ${tag}`],
				`JP ceiling ${tag} in ${period}`,
				{
					period,
					employment: { basic }
				}
			);
	for (const [tag, basic] of [
		['at', 12_000_000],
		['sen', 12_000_000.01],
		['hundred', 12_000_100]
	] as const)
		make(
			`KES-cap-${tag}`,
			['ID-19'],
			[`Kesehatan ceiling ${tag}`],
			`Kesehatan 12,000,000 ceiling ${tag}`,
			{
				employment: { basic }
			}
		);
	make(
		'KES-floor-joiner',
		['ID-19', 'ID-161', 'ID-106'],
		['part month lifted to the UMP'],
		'Joiner paid under the floor',
		{
			employment: { basic: 6_000_000, hireDate: '2026-02-15' }
		}
	);
	make(
		'KES-at-floor',
		['ID-19', 'ID-94'],
		['wage exactly the UMP'],
		'Kesehatan on a wage equal to the floor',
		{
			employment: { basic: 5_729_876 }
		}
	);
	for (const n of [1, 2])
		make(
			`KES-extra-${n}`,
			['ID-19'],
			[`${n} elected family member(s) at 1% each`],
			'Extra Kesehatan members',
			{
				employee: { kesehatanExtraMembers: n },
				employment: { basic: 9_000_000 }
			}
		);
	make(
		'BASE-fixed',
		['ID-02', 'ID-14', 'ID-161'],
		['fixed allowance in every base'],
		'Basic + fixed allowance',
		{
			employment: { basic: 6_000_000, fixedAllowance: 2_000_000 }
		}
	);
	const groups: RiskGroup[] = ['I', 'II', 'III', 'IV', 'V'];
	for (const g of groups) {
		make(`JKK-${g}`, ['ID-16', 'ID-70'], [`JKK group ${g}`], `JKK risk group ${g}`, {
			company: { jkkRiskGroup: g },
			employment: { basic: 25_000_000 }
		});
		make(
			`JKK-padat-${g}`,
			['ID-52'],
			[`labour-intensive JKK group ${g} halved (Jan 2026)`],
			'PP 7/2025 relief',
			{
				period: '2026-01',
				company: { jkkRiskGroup: g, padatKarya: true, workplace: 'DENPASAR', kbli: '14111' },
				employment: { basic: 25_000_000 }
			}
		);
	}
	make('JKK-none', ['ID-16'], ['no registered risk group: run stops'], 'Missing JKK group', {
		company: { jkkRiskGroup: null },
		employment: { basic: 25_000_000 }
	});
	make(
		'JKK-padat-ended',
		['ID-52'],
		['relief ended February 2026'],
		'Labour-intensive employer after January 2026',
		{
			company: { padatKarya: true, workplace: 'DENPASAR', kbli: '14111' },
			employment: { basic: 25_000_000 }
		}
	);
	make(
		'JKK-padat-dec',
		['ID-52'],
		['relief in December 2025'],
		'Labour-intensive employer December 2025',
		{
			period: '2025-12',
			company: { padatKarya: true, jkkRiskGroup: 'II', workplace: 'DENPASAR', kbli: '14111' },
			employment: { basic: 25_000_000, hireDate: '2025-06-02' }
		}
	);

	// ---- 6. Minimum wage floors: at the floor and a sen under (UU13 art 88E(2); ID-127 compares in sen).
	const localities: [Workplace, string, string][] = [
		['DKI', 'ID-94', '2026-02'],
		['KAB_BEKASI', 'ID-96', '2026-02'],
		['SURABAYA', 'ID-79', '2026-02'],
		['SEMARANG', 'ID-83', '2026-02'],
		['DENPASAR', 'ID-102', '2026-02'],
		['BADUNG', 'ID-102', '2026-02'],
		['DKI', 'ID-94', '2025-12'],
		['DENPASAR', 'ID-99', '2025-12'],
		['BADUNG', 'ID-99', '2025-12']
	];
	for (const [workplace, row, period] of localities) {
		const floor = floorOn(workplace, `${period}-01`);
		for (const [tag, basic] of [
			['at', floor],
			['under', Math.round((floor - 0.01) * 100) / 100]
		] as const)
			make(
				`MW-${workplace}-${period}-${tag}`,
				[row, 'ID-02', 'ID-127', 'ID-19'],
				[`${workplace} floor ${tag}`],
				`${workplace} ${period} minimum wage ${tag}`,
				{
					period,
					company: { workplace },
					employment: { basic }
				}
			);
	}
	// ID-173 strict sector places: an unmatched KBLI (or any KBLI where no ordinary KBLI is attested) is refused.
	for (const [workplace, period, kbli, row] of [
		['KOTA_BEKASI', '2026-02', '62019', 'ID-96'],
		['KOTA_BEKASI', '2025-12', '62019', 'ID-96'],
		['KOTA_BANJAR', '2026-02', '62019', 'ID-96'],
		['KOTA_BANJAR', '2025-12', '62019', 'ID-96'],
		['KAB_BEKASI', '2025-12', '62019', 'ID-96'],
		['KAB_BEKASI', '2026-02', '46599', 'ID-97'],
		['SURABAYA', '2025-12', '62019', 'ID-89'],
		['DKI', '2026-02', '47111', 'ID-54'],
		['DKI', '2025-12', '10437', 'ID-53'],
		['DKI', '2026-02', '86103', 'ID-54'],
		['DKI', '2026-02', '14111', 'ID-54']
	] as const)
		make(
			`STRICT-${workplace}-${period}-${kbli}`,
			['ID-173', row, 'ID-03'],
			[`strict sector place ${workplace} ${period}: KBLI ${kbli} refused`],
			'Sector floor unresolved: the ordinary floor cannot be asserted',
			{ period, company: { workplace, kbli }, employment: { basic: 7_000_000 } }
		);
	// one KBLI per distinct unconditional Kep.33/2026 amount, at and a sen under
	const seen = new Set<number>();
	const umspLines = Object.entries(DKI_UMSP_2026).filter(([, v]) => !seen.has(v) && seen.add(v) !== undefined);
	for (const [kbli, floor] of umspLines) {
		make(
			`UMSP-${kbli}-at`,
			['ID-54', 'ID-03'],
			[`UMSP ${kbli} at, service < 1 year`],
			'DKI sector floor',
			{
				company: { kbli },
				employment: { basic: floor }
			}
		);
		make(
			`UMSP-${kbli}-under`,
			['ID-54', 'ID-03', 'ID-127'],
			[`UMSP ${kbli} a sen under`],
			'DKI sector floor',
			{
				company: { kbli },
				employment: { basic: floor - 0.01 }
			}
		);
	}
	for (const [kbli, condition, floor] of DKI_UMSP_2026_CONDITIONAL)
		make(
			`UMSP-${kbli}-${condition}`,
			['ID-54', 'ID-03'],
			[`conditional line ${kbli} with ${condition} recorded: floor ${floor}`],
			'DKI conditional sector floor',
			{ company: { kbli, umspConditions: [condition] }, employment: { basic: floor } }
		);
	make(
		'UMSP-14111-EXPORT-under',
		['ID-54', 'ID-127'],
		['conditional line a sen under'],
		'DKI conditional sector floor',
		{ company: { kbli: '14111', umspConditions: ['EXPORT'] }, employment: { basic: 5_831_496.99 } }
	);
	for (const [tag, hireDate] of [
		['12m-exact', '2025-02-01'],
		['12m-less-a-day', '2025-02-02']
	] as const)
		make(
			`UMSP-10437-${tag}`,
			['ID-54'],
			[`one-year service boundary ${tag}`],
			'UMSP binds only under one year of service',
			{ company: { kbli: '10437' }, employment: { basic: 5_729_876, hireDate } }
		);
	make(
		'UMSP-10437-senior',
		['ID-54'],
		['service ≥ 1 year: UMSP no longer binds'],
		'Sector floor after a year',
		{
			company: { kbli: '10437' },
			employment: { basic: 5_729_876, hireDate: '2025-01-02' }
		}
	);
	make(
		'UMSP-10437-11m',
		['ID-54'],
		['service 11 months: UMSP binds'],
		'Sector floor just under a year',
		{
			company: { kbli: '10437' },
			employment: { basic: 5_729_876, hireDate: '2025-03-02' }
		}
	);
	make('BASIC75-under', ['ID-02'], ['basic 71.4% of basic + fixed'], 'PP36 art 7(2) refused', {
		employment: { basic: 5_000_000, fixedAllowance: 2_000_000 }
	});
	make('BASIC75-at', ['ID-02'], ['basic exactly 75%'], 'PP36 art 7(2) at the line', {
		employment: { basic: 6_000_000, fixedAllowance: 2_000_000 }
	});
	const hourlyFloor = floorOn('DKI', '2026-02-01') / 126;
	make(
		'HOURLY-at',
		['ID-169', 'ID-174'],
		['part-time hourly at floor ÷ 126'],
		'Hourly at the floor',
		{
			employment: {
				payBasis: 'HOURLY',
				partTime: true,
				rate: Math.ceil(hourlyFloor * 100) / 100,
				basic: 0
			}
		}
	);
	make(
		'HOURLY-under',
		['ID-169'],
		['part-time hourly under floor ÷ 126'],
		'Hourly under the floor',
		{
			employment: {
				payBasis: 'HOURLY',
				partTime: true,
				rate: Math.floor(hourlyFloor * 100) / 100 - 0.01,
				basic: 0
			}
		}
	);
	make(
		'HOURLY-fulltime',
		['ID-169'],
		['hourly wage for a full-time worker'],
		'Hourly not allowed',
		{
			employment: { payBasis: 'HOURLY', partTime: false, rate: 50_000, basic: 0 }
		}
	);
	make('DAILY', ['ID-174', 'ID-106'], ['daily wage: Kesehatan base unsealed'], 'Daily worker', {
		employment: { payBasis: 'DAILY', rate: 300_000, basic: 0 }
	});

	// ---- 7. Ages on the period's first day (2026-02-01).
	const born = (years: number, months: number) => {
		const m = 2 - months; // February 2026 minus years/months
		const y = 2026 - years + Math.floor((m - 1) / 12);
		return `${y}-${String(((m - 1 + 120) % 12) + 1).padStart(2, '0')}-01`;
	};
	for (const [tag, y, m, deferral] of [
		['58y11m', 58, 11, false],
		['59y1m', 59, 1, false],
		['59y1m-deferred', 59, 1, true],
		['61y11m-deferred', 61, 11, true],
		['62y1m-deferred', 62, 1, true]
	] as const)
		make(
			`AGE-JP-${tag}`,
			['ID-15'],
			[`JP at ${tag}${deferral ? ' with art 15(4) deferral' : ''}`],
			'JP pension age 59',
			{
				employee: { birthDate: born(y, m), jpDeferral: deferral },
				employment: { basic: 12_000_000 }
			}
		);
	for (const [tag, birthDate] of [
		['turns-59-on-15th', '1967-02-15'],
		['turns-59-on-1st', '1967-02-01'],
		['turns-59-on-2nd', '1967-02-02']
	] as const)
		make(
			`AGE-JP-${tag}`,
			['ID-15'],
			[`JP when the worker ${tag} (age read on the period's first day)`],
			'JP pension age inside the month',
			{ employee: { birthDate }, employment: { basic: 12_000_000 } }
		);
	for (const [tag, y, m] of [
		['53y11m', 53, 11],
		['54y1m', 54, 1]
	] as const)
		make(
			`AGE-JKP-${tag}`,
			['ID-18', 'ID-69'],
			[`JKP age ${tag}: no payslip line`],
			'JKP threshold',
			{
				employee: { birthDate: born(y, m) },
				employment: { basic: 12_000_000, hireDate: '2026-02-02' }
			}
		);

	// ---- 8. Citizenship and residency.
	const foreign = { citizen: false };
	make(
		'FOREIGN-6m',
		['ID-175', 'ID-15', 'ID-14', 'ID-19'],
		['foreigner at six months: BPJS TK + Kesehatan, no JP'],
		'Resident foreigner',
		{
			employee: { ...foreign, foreignWorkMonths: 6 },
			employment: { basic: 30_000_000 }
		}
	);
	make(
		'FOREIGN-6m-JP',
		['ID-15'],
		['foreigner with a JP registration on file'],
		'Registered foreigner',
		{
			employee: { ...foreign, foreignWorkMonths: 7, jpRegistered: true },
			employment: { basic: 30_000_000 }
		}
	);
	make(
		'FOREIGN-5m-nonres',
		['ID-24', 'ID-175', 'ID-45'],
		['foreigner at five months, non-resident: PPh 26, no BPJS'],
		'Short-stay foreigner',
		{
			employee: { ...foreign, foreignWorkMonths: 5, taxResident: false },
			employment: { basic: 30_000_000, hireDate: '2025-09-01' }
		}
	);
	make(
		'FOREIGN-5m-res',
		['ID-175', 'ID-21'],
		['foreigner at five months declared resident: TER, no BPJS'],
		'Resident, not yet BPJS',
		{
			employee: { ...foreign, foreignWorkMonths: 5 },
			employment: { basic: 30_000_000, hireDate: '2025-09-01' }
		}
	);
	make('FOREIGN-24m', ['ID-175', 'ID-21'], ['long-serving foreigner'], 'Two years in Indonesia', {
		employee: { ...foreign, foreignWorkMonths: 24, ptkp: 'K/2' },
		employment: { basic: 45_000_000, hireDate: '2024-02-01' }
	});
	make(
		'CITIZEN-nonres',
		['ID-24'],
		['citizen tax-resident abroad: PPh 26 on gross incl. premiums'],
		'Citizen living abroad, engaged 10 Feb for the month only (UU 36/2008 art 2(3)(a): under 183 days)',
		{
			employee: { taxResident: false },
			employment: { basic: 20_000_000, hireDate: '2026-02-10' }
		}
	);

	// ---- 9. Joiners, leavers, unpaid days (ID-106 DEFAULT calendar days: 9,300,000 → 310,000 in April).
	for (const [tag, period, hireDate] of [
		['apr-1st', '2026-04', '2026-04-01'],
		['apr-16th', '2026-04', '2026-04-16'],
		['apr-30th', '2026-04', '2026-04-30'],
		['feb-15th', '2026-02', '2026-02-15'],
		['jan-31st', '2026-01', '2026-01-31']
	] as const)
		make(
			`JOIN-${tag}`,
			['ID-106', 'ID-161', 'ID-162', ...BPJS],
			[`joiner ${tag}`],
			'Calendar-day joiner',
			{
				period,
				employment: { basic: 9_300_000, hireDate }
			}
		);
	for (const [tag, exitDate] of [
		['jan-1st', '2026-01-01'],
		['jan-15th', '2026-01-15'],
		['jan-31st', '2026-01-31']
	] as const)
		make(
			`LEAVE-${tag}`,
			['ID-106', 'ID-161', 'ID-04', 'ID-21', 'ID-28'],
			[`resignation ${tag}, last-period reckoning`],
			'January leaver',
			{
				period: '2026-01',
				employment: { basic: 9_300_000, hireDate: '2024-03-01', exitDate, exitCause: 'RESIGNATION' }
			}
		);
	make(
		'LEAVE-same-month',
		['ID-106', 'ID-21'],
		['hire and exit in April'],
		'Joined and left in April',
		{
			period: '2026-04',
			employment: {
				basic: 9_300_000,
				hireDate: '2026-04-01',
				exitDate: '2026-04-15',
				exitCause: 'RESIGNATION'
			}
		}
	);
	make('UNPAID-1-apr', ['ID-106', 'ID-161'], ['one unpaid day in a 30-day month'], 'Unpaid day', {
		period: '2026-04',
		employment: { basic: 9_300_000 },
		inputs: { unpaidDates: ['2026-04-08'] }
	});
	make(
		'UNPAID-3-may',
		['ID-106', 'ID-161'],
		['three unpaid days in a 31-day month'],
		'Unpaid days',
		{
			period: '2026-05',
			employment: { basic: 9_300_000 },
			inputs: { unpaidDates: ['2026-05-11', '2026-05-12', '2026-05-13'] }
		}
	);
	make(
		'UNPAID-floor-lift',
		['ID-161', 'ID-19'],
		['unpaid days push the paid wage under the floor'],
		'Kesehatan lifted',
		{
			employment: { basic: 6_000_000 },
			inputs: {
				unpaidDates: [
					'2026-02-02',
					'2026-02-03',
					'2026-02-04',
					'2026-02-05',
					'2026-02-06',
					'2026-02-09',
					'2026-02-10'
				]
			}
		}
	);

	// ---- 10. Overtime (8,650,000 / 173 = 50,000 an hour).
	const ot = (
		id: string,
		rows: string[],
		branch: string,
		kind: Scenario['inputs']['overtime'][number]['kind'],
		hours: number,
		date: string,
		workWeek: 5 | 6 = 5,
		employment: Partial<Scenario['employment']> = {}
	) =>
		make(
			`OT-${id}`,
			['ID-09', 'ID-107', 'ID-43', ...rows],
			[branch],
			`${hours} h ${kind} overtime`,
			{
				company: { workWeek },
				employment: { basic: 8_650_000, ...employment },
				inputs: { overtime: [{ date, kind, hours }] }
			}
		);
	for (const h of [1, 2, 3, 4])
		ot(`ord-${h}h`, [], `ordinary day ${h} h`, 'ORDINARY', h, '2026-02-10');
	for (const h of [8, 9, 10, 12])
		ot(`rest5-${h}h`, [], `5-day week rest day ${h} h`, 'REST', h, '2026-02-08');
	for (const h of [8, 9])
		ot(`hol5-${h}h`, ['ID-120', 'ID-51'], `holiday 17 Feb 2026 ${h} h`, 'HOLIDAY', h, '2026-02-17');
	for (const h of [7, 8, 11])
		ot(`rest6-${h}h`, [], `6-day week rest day ${h} h`, 'REST', h, '2026-02-08', 6);
	for (const h of [5, 6, 9])
		ot(
			`short6-${h}h`,
			[],
			`holiday on the short day ${h} h`,
			'HOLIDAY_SHORT_DAY',
			h,
			'2026-02-17',
			6
		);
	ot(
		'75pct-base',
		[],
		'basic + fixed under 75% of the whole wage: base 75%',
		'ORDINARY',
		2,
		'2026-02-10',
		5,
		{
			basic: 5_800_000,
			nonFixedAllowance: 3_000_000
		}
	);
	ot('fixed-in-base', [], 'fixed allowance in the 1/173 base', 'ORDINARY', 2, '2026-02-10', 5, {
		basic: 6_920_000,
		fixedAllowance: 1_730_000
	});

	// ---- 11. THR (Idul Fitri 21 Mar 2026, ID-120): completed months at the holiday.
	for (const [tag, hireDate] of [
		['20d', '2026-03-01'],
		['1m', '2026-02-21'],
		['6m', '2025-09-21'],
		['11m', '2025-04-21'],
		['12m', '2025-03-21'],
		['14m', '2025-01-21']
	] as const)
		make(
			`THR-${tag}`,
			['ID-13', 'ID-119', 'ID-21'],
			[`THR at ${tag} of service`],
			'Religious THR',
			{
				period: '2026-03',
				employment: { basic: 7_200_000, fixedAllowance: 600_000, hireDate },
				inputs: { thrHolidayDate: '2026-03-21' }
			}
		);
	make(
		'THR-christmas',
		['ID-13', 'ID-170', 'ID-122'],
		['Christmas THR in the December reckoning'],
		'THR at 3 months',
		{
			period: '2025-12',
			employment: { basic: 7_200_000, fixedAllowance: 600_000, hireDate: '2025-09-25' },
			inputs: { thrHolidayDate: '2025-12-25' }
		}
	);

	// ---- 12. Bonus joins the month's TER gross.
	make('BONUS-feb', ['ID-21', 'ID-118'], ['irregular bonus in a TER month'], 'Bonus month', {
		employment: { basic: 10_000_000 },
		inputs: { bonus: 20_000_000 }
	});
	make(
		'BONUS-dec',
		['ID-122', 'ID-118'],
		['bonus in the December reckoning'],
		'December joiner with bonus',
		{
			period: '2025-12',
			employment: { basic: 10_000_000, hireDate: '2025-12-01' },
			inputs: { bonus: 50_000_000 }
		}
	);

	// ---- 13. PKWTT severance: every cause at 4 years 2 months (pesangon 5, UPMK 2), January 2026 exit.
	const causes: ExitCause[] = [
		'MERGER',
		'TAKEOVER',
		'TAKEOVER_TERMS_REFUSED',
		'EFFICIENCY_LOSS',
		'EFFICIENCY_PREVENT_LOSS',
		'CLOSURE_LOSS',
		'CLOSURE_NO_LOSS',
		'FORCE_MAJEURE_CLOSURE',
		'FORCE_MAJEURE_NO_CLOSURE',
		'PKPU_LOSS',
		'PKPU_NO_LOSS',
		'BANKRUPTCY',
		'EMPLOYER_MISCONDUCT_REQUEST',
		'MISCONDUCT_CLAIM_REJECTED',
		'RESIGNATION',
		'ABSENT_FIVE_DAYS',
		'WARNED_VIOLATION',
		'URGENT_VIOLATION',
		'LONG_ILLNESS',
		'RETIREMENT',
		'DEATH'
	];
	for (const exitCause of causes)
		make(
			`SEV-${exitCause}`,
			['ID-28', 'ID-112', 'ID-25', 'ID-21', 'ID-161'],
			[`cause ${exitCause}`],
			'PP 35/2021 cause multiplier',
			{
				period: '2026-01',
				employment: {
					basic: 10_000_000,
					hireDate: '2021-11-01',
					exitDate: '2026-01-15',
					exitCause
				},
				inputs: { uangPisah: 5_000_000 }
			}
		);
	for (const [tag, hireDate] of [
		['6m', '2025-07-16'],
		['1y1m', '2024-12-16'],
		['2y11m', '2023-02-16'],
		['3y1m', '2022-12-16'],
		['5y11m', '2020-02-16'],
		['6y1m', '2019-12-16'],
		['8y1m', '2017-12-16'],
		['12y1m', '2013-12-16'],
		['24y1m', '2001-12-16']
	] as const)
		make(
			`SEV-scale-${tag}`,
			['ID-28', 'ID-112', 'ID-25'],
			[`service ${tag}: art 40(2)–(3) scale`],
			'Service scale',
			{
				period: '2026-01',
				employment: {
					basic: 10_000_000,
					hireDate,
					exitDate: '2026-01-15',
					exitCause: 'EFFICIENCY_PREVENT_LOSS'
				}
			}
		);
	// 5 years 1 month: pesangon 6 + UPMK 2 = 8 months, so the PP 68 total is 8 × the wage; "above" adds Rp10 to the
	// total (wage + 1.25), the smallest step whose band tax reaches half a rupiah in the 5% band.
	for (const [tag, basic] of [
		['50m', 6_250_000],
		['50m-above', 6_250_001.25],
		['100m', 12_500_000],
		['100m-above', 12_500_001.25],
		['500m', 62_500_000],
		['500m-above', 62_500_001.25]
	] as const)
		make(
			`PP68-${tag}`,
			['ID-25', 'ID-28'],
			[`PP 68/2009 art 4 band edge ${tag}`],
			'Severance final tax band',
			{
				period: '2026-01',
				employment: {
					basic,
					hireDate: '2020-12-16',
					exitDate: '2026-01-15',
					exitCause: 'EFFICIENCY_PREVENT_LOSS'
				}
			}
		);
	make(
		'SEV-nonres',
		['ID-168', 'ID-24'],
		['non-resident severance: PPh 26 20%'],
		'Citizen posted and living abroad the whole tax year (declared non-resident): pesangon',
		{
			period: '2026-01',
			employee: { taxResident: false },
			employment: {
				basic: 20_000_000,
				hireDate: '2021-11-01',
				exitDate: '2026-01-15',
				exitCause: 'EFFICIENCY_PREVENT_LOSS'
			}
		}
	);
	make(
		'SEV-microsmall',
		['ID-114'],
		['micro/small: generic multiplier refused'],
		'Micro/small severance',
		{
			period: '2026-01',
			company: { microSmall: true },
			employment: {
				basic: 6_000_000,
				hireDate: '2021-11-01',
				exitDate: '2026-01-15',
				exitCause: 'EFFICIENCY_LOSS'
			}
		}
	);

	// ---- 14. PKWT compensation (PP35 arts 15–17) and the UU13 art 62 remaining term.
	for (const [tag, hireDate, exitCause, contractEnd, exitDate, extra] of [
		['6m', '2025-08-01', 'CONTRACT_END', '2026-01-31', '2026-01-31', {}],
		['12m', '2025-02-01', 'CONTRACT_END', '2026-01-31', '2026-01-31', {}],
		['18m', '2024-08-01', 'CONTRACT_END', '2026-01-31', '2026-01-31', {}],
		['under-1m', '2026-01-10', 'CONTRACT_END', '2026-01-31', '2026-01-31', {}],
		['early-4of12', '2025-10-01', 'EMPLOYER_EARLY_END', '2026-09-30', '2026-01-31', {}],
		[
			'fixed-allowance',
			'2025-08-01',
			'CONTRACT_END',
			'2026-01-31',
			'2026-01-31',
			{ fixedAllowance: 1_000_000 }
		],
		[
			'nonfixed-only',
			'2025-08-01',
			'CONTRACT_END',
			'2026-01-31',
			'2026-01-31',
			{ nonFixedAllowance: 1_000_000 }
		]
	] as const)
		make(
			`PKWT-${tag}`,
			['ID-109', 'ID-25', ...(exitCause === 'EMPLOYER_EARLY_END' ? ['ID-27'] : [])],
			[`PKWT ${tag}`],
			'PKWT compensation',
			{
				period: '2026-01',
				employment: {
					type: 'PKWT',
					basic: 8_000_000,
					hireDate,
					contractEnd,
					exitDate,
					exitCause,
					...extra
				}
			}
		);
	make(
		'PKWT-foreign',
		['ID-109'],
		['no compensation for a foreign PKWT worker'],
		'Foreign PKWT end',
		{
			period: '2026-01',
			employee: { citizen: false, foreignWorkMonths: 12, subjectivePartYear: true },
			employment: {
				type: 'PKWT',
				basic: 30_000_000,
				hireDate: '2025-08-01',
				contractEnd: '2026-01-31',
				exitDate: '2026-01-31',
				exitCause: 'CONTRACT_END'
			}
		}
	);

	// ---- 15. Statutory reduced pay: illness steps (UU13 art 93(3)) and maternity months 5–6 (UU4 art 5(2)).
	for (const [tag, fraction, row] of [
		['illness-m4', 1, 'ID-37'],
		['illness-m5', 0.75, 'ID-37'],
		['illness-m9', 0.5, 'ID-37'],
		['illness-m13', 0.25, 'ID-37'],
		['maternity-m5', 0.75, 'ID-126']
	] as const)
		make(
			`REDUCED-${tag}`,
			[row, 'ID-11', 'ID-106', 'ID-161'],
			[`${tag} at ${fraction * 100}%`],
			'Whole month at a statutory fraction',
			{
				employment: { basic: 10_000_000, hireDate: '2024-06-03' },
				inputs: { reducedPay: { days: 28, fraction } }
			}
		);

	// ---- 16. 2026 PPh 21 DTP (PMK 105/2025).
	for (const [tag, basic, klu] of [
		['9m', 9_000_000, true],
		['10m', 10_000_000, true],
		['10m-above', 10_000_000.01, true],
		['10m-plus-1', 10_000_001, true],
		['no-klu', 9_000_000, false]
	] as const)
		make(`DTP-${tag}`, ['ID-84', 'ID-23'], [`DTP ${tag}`], 'Government-borne PPh 21', {
			period: '2026-01',
			company: { dtpKlu: klu },
			employment: { basic }
		});

	// ---- 17. Non-employee services (PMK168 arts 12(3), 16(3)).
	for (const [tag, fee, taxId] of [
		['10m', 10_000_000, true],
		['200m', 200_000_000, true],
		['10m-no-taxid', 10_000_000, false]
	] as const)
		make(`SERVICES-${tag}`, ['ID-74', 'ID-22', 'ID-45'], [`services fee ${tag}`], 'Bukan pegawai', {
			employee: { hasTaxId: taxId },
			employment: { type: 'NON_EMPLOYEE', basic: 0, serviceFee: fee }
		});

	// ---- 17a. PMK168 art 15(3): a part tax year of the subjective obligation annualises the neto.
	for (const [tag, period, hireDate, exitDate, part] of [
		['arrive-mar-leave-jun', '2026-06', '2026-03-02', '2026-06-30', true],
		['arrive-mar-leave-jun-jobchange', '2026-06', '2026-03-02', '2026-06-30', false],
		['arrive-oct-dec', '2025-12', '2025-10-01', null, true],
		['leave-jan-15', '2026-01', '2024-06-03', '2026-01-15', true]
	] as const)
		make(
			`PARTYEAR-${tag}`,
			['ID-21', 'ID-122', 'ID-127', 'ID-175'],
			[part ? 'subjective part year: neto annualised, tax pro rata' : 'job change only: actual neto'],
			'Foreign resident arriving in / leaving Indonesia inside the tax year',
			{
				period,
				employee: { citizen: false, foreignWorkMonths: 6, subjectivePartYear: part },
				employment: {
					basic: 40_000_000,
					hireDate,
					exitDate,
					exitCause: exitDate === null ? null : 'RESIGNATION'
				}
			}
		);

	// ---- 17b. Mid-month raise (ID-161 DEFAULT: JHT/JKK/JKM on the last day's rate, JP/Kesehatan on the wage paid).
	for (const [tag, basic, raised, from] of [
		['16th', 9_300_000, 12_400_000, '2026-04-16'],
		['2nd', 10_000_000, 11_500_000, '2026-04-02'],
		['30th', 10_500_000, 11_000_000, '2026-04-30'],
		['over-jp-cap', 10_000_000, 13_000_000, '2026-04-11']
	] as const)
		make(`RAISE-${tag}`, ['ID-161', 'ID-106', 'ID-15', 'ID-19', 'ID-14'], [`raise from ${from}`], 'Mid-month raise', {
			period: '2026-04',
			employment: { basic, raise: { from, basic: raised } }
		});

	// ---- 17c. Paid statutory leave inside its entitlement: no deduction.
	for (const [tag, kind, dates, row] of [
		['marriage-3d', 'MARRIAGE', ['2026-04-06', '2026-04-07', '2026-04-08'], 'ID-12'],
		['bereavement-2d', 'BEREAVEMENT', ['2026-04-13', '2026-04-14'], 'ID-12'],
		['paternity-2d', 'PATERNITY', ['2026-04-20', '2026-04-21'], 'ID-126'],
		['menstrual-2d', 'MENSTRUAL', ['2026-04-09', '2026-04-10'], 'ID-11'],
		['annual-5d', 'ANNUAL', ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10'], 'ID-121']
	] as const)
		make(`PAIDLEAVE-${tag}`, [row, 'ID-11', 'ID-106'], [`paid ${kind} leave`], 'Paid leave: full wage', {
			period: '2026-04',
			employment: { basic: 9_300_000, hireDate: '2024-03-01' },
			inputs: { paidLeave: [{ kind, dates: [...dates] }] }
		});

	// ---- 18. PP36 art 65 deduction ceiling.
	for (const [tag, d] of [
		['half', 4_000_000],
		['half-plus-1', 4_000_001]
	] as const)
		make(`DEDUCT-${tag}`, ['ID-06'], [`art 63 deduction ${tag}`], 'Deduction ceiling', {
			employment: { basic: 8_000_000 },
			inputs: { wageDeduction: d }
		});

	// seeded spread across risk groups for the plain PTKP months (the choice does not change the branch tags)
	for (const s of out)
		if (s.id.endsWith('-feb') && s.id.includes('PTKP')) s.company.jkkRiskGroup = pick(groups);
	return out;
}
