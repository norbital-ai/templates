/**
 * Deterministic MY-nihon payslip scenarios: every payslip-affecting branch in docs/inventory/malaysia.csv that the
 * MY-nihon lineage carries, each scenario tagged with the tracker row ids and branch names it exercises.
 * The expected payslip for a scenario is `computePayslip` in `tests/e2e/oracle/MY-nihon.ts`, computed from the law.
 *
 * Scenario → probe case (tests/e2e/payroll-probe.ts `ProbeCase`): `period` is the case period, `company` fields
 * become the company override (HRD class, MSIC), `employee`/`employment` the employees + employments +
 * employment_terms inputs, `month.work` time entries on the company's week (09:00 start, 60-minute break, Monday–
 * Friday OFFICE, Saturday the earlier contractual REST day, Sunday the last REST day), `month.unpaidLeave` unpaid
 * leave entries, `month.bonus` a BONUS ad hoc request, `employment.exit` the departure with its exit facts, and
 * `month.holidays` the company's paid gazetted holidays of the month. The expectation is `probeLines(oracle)`.
 *
 * No Math.random: variation comes from a seeded mulberry32 stream, so the list is identical on every call.
 */

export type Citizenship = 'CITIZEN' | 'PERMANENT_RESIDENT' | 'FOREIGNER';
export type ExitCause =
	| 'RESIGNATION'
	| 'EMPLOYER_TERMINATION'
	| 'MISCONDUCT_DISMISSAL'
	| 'CONTRACT_RETIREMENT'
	| 'FIXED_TERM_EXPIRY';
export type Scenario = {
	id: string;
	profile: 'MY-nihon';
	description: string;
	/** Tracker row ids (docs/inventory/malaysia.csv) this scenario exercises. */
	rows: string[];
	/** Branch names inside those rows. */
	branches: string[];
	/** YYYY-MM, the run's period. */
	period: string;
	company: { hrd: 'COMPULSORY' | 'OPTIONAL' | 'NOT_LIABLE'; msic: string };
	employee: {
		citizenship: Citizenship;
		birthDate: string;
		taxResidency: 'RESIDENT' | 'NON_RESIDENT' | 'UNKNOWN';
		/** MTD category: 1 single, 2 married with a non-working spouse, 3 married with a working spouse. */
		pcbCategory: 1 | 2 | 3;
		children: number;
		/** Zakat paid through salary this month. */
		zakat: number;
		/** First day SOCSO/EIS contributions were payable for this person (no earlier employment: the hire date). */
		firstContributionDate: string;
	};
	employment: {
		hireDate: string;
		/** Last day of a fixed-term contract; null when open-ended. */
		contractEnd: string | null;
		employmentType: 'FULL_TIME' | 'PART_TIME';
		payBasis: 'MONTHLY' | 'DAILY' | 'HOURLY';
		/** Monthly, daily or hourly basic rate. */
		rate: number;
		/** Fixed monthly cash allowance (EA s.2 wages). */
		fixedAllowance: number;
		/** Monthly travelling allowance for official duties. */
		travelAllowanceOfficial: number;
		exit: null | {
			date: string;
			cause: ExitCause;
			/** Statutory notice given and served in full (s.12); false → terminated without notice (s.13(1)). */
			noticeServed: boolean;
			/** Annual leave already taken in the exit year. */
			annualLeaveTaken: number;
			/** Wages of the twelve completed months before the exit (reg.6(2)). */
			wages12m: number;
		};
	};
	month: {
		unpaidLeave: string[];
		/** Hours worked on a day that is overtime, a rest day or a holiday (09:00 start, 60-minute break). */
		work: { date: string; hours: number }[];
		daysWorked?: number;
		hoursWorked?: number;
		bonus: number;
		/** The company's paid gazetted holidays falling in the period. */
		holidays: string[];
	};
};

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Born on the 15th of the month before `period`, `age` years earlier: exactly `age` on every day of the period. */
function bornForAge(period: string, age: number) {
	let y = +period.slice(0, 4);
	let m = +period.slice(5, 7) - 1;
	if (m === 0) [y, m] = [y - 1, 12];
	return `${y - age}-${pad(m)}-15`;
}
/** A date `years` years and `months` months after `birth`. */
function after(birth: string, years: number, months = 0) {
	let y = +birth.slice(0, 4) + years;
	let m = +birth.slice(5, 7) + months;
	while (m > 12) [y, m] = [y + 1, m - 12];
	return `${y}-${pad(m)}-01`;
}
const lastDay = (period: string) => `${period}-${pad(daysIn(+period.slice(0, 4), +period.slice(5, 7)))}`;

/** Gazetted holidays MY-nihon pays nationwide in the periods used (EA s.60D(1)(a)(i),(v)). */
const HOLIDAYS: Record<string, string[]> = { '2026-08': ['2026-08-31'], '2026-09': ['2026-09-16'] };
const CZ_ROWS: Record<Citizenship, string[]> = {
	CITIZEN: ['MY-EPF-01'],
	PERMANENT_RESIDENT: ['MY-EPF-01', 'MY-EPF-TRANS-02'],
	FOREIGNER: ['MY-EPF-01', 'MY-EPF-03']
};

export function generateProfiles(): Scenario[] {
	const rand = mulberry32(0x4e1407);
	const out: Scenario[] = [];
	const seen = new Set<string>();
	type Spec = {
		id: string;
		description: string;
		rows?: string[];
		branches: string[];
		period: string;
		citizenship?: Citizenship;
		age?: number;
		birthDate?: string;
		taxResidency?: Scenario['employee']['taxResidency'];
		pcbCategory?: 1 | 2 | 3;
		children?: number;
		zakat?: number;
		firstContributionDate?: string;
		hrd?: Scenario['company']['hrd'];
		msic?: string;
		hireDate?: string;
		contractEnd?: string | null;
		employmentType?: 'FULL_TIME' | 'PART_TIME';
		payBasis?: 'MONTHLY' | 'DAILY' | 'HOURLY';
		rate: number;
		fixedAllowance?: number;
		travel?: number;
		exit?: Scenario['employment']['exit'];
		unpaidLeave?: string[];
		work?: { date: string; hours: number }[];
		daysWorked?: number;
		hoursWorked?: number;
		bonus?: number;
	};
	const add = (x: Spec) => {
		if (seen.has(x.id)) throw new Error(`duplicate scenario ${x.id}`);
		seen.add(x.id);
		const citizenship = x.citizenship ?? 'CITIZEN';
		const birthDate = x.birthDate ?? bornForAge(x.period, x.age ?? 30 + Math.floor(rand() * 20));
		const hireDate = x.hireDate ?? `${2015 + Math.floor(rand() * 8)}-${pad(1 + Math.floor(rand() * 12))}-01`;
		const rows = new Set<string>([
			...(x.rows ?? []),
			...CZ_ROWS[citizenship],
			'MY-SOCSO-01',
			'MY-EIS-01',
			'MY-PCB-01',
			'MY-HRD-01',
			'MY-HRD-02',
			'MY-WAGEBASE-01'
		]);
		if (x.period >= '2026-06') rows.add('MY-SKBBK-01').add('MY-SKBBK-04');
		out.push({
			id: `MY-nihon-oracle-${x.id}`,
			profile: 'MY-nihon',
			description: x.description,
			rows: [...rows].sort(),
			branches: x.branches,
			period: x.period,
			company: { hrd: x.hrd ?? 'COMPULSORY', msic: x.msic ?? '29300' },
			employee: {
				citizenship,
				birthDate,
				taxResidency: x.taxResidency ?? (citizenship === 'FOREIGNER' ? 'NON_RESIDENT' : 'RESIDENT'),
				pcbCategory: x.pcbCategory ?? 1,
				children: x.children ?? 0,
				zakat: x.zakat ?? 0,
				firstContributionDate: x.firstContributionDate ?? hireDate
			},
			employment: {
				hireDate,
				contractEnd: x.contractEnd ?? null,
				employmentType: x.employmentType ?? 'FULL_TIME',
				payBasis: x.payBasis ?? 'MONTHLY',
				rate: x.rate,
				fixedAllowance: x.fixedAllowance ?? 0,
				travelAllowanceOfficial: x.travel ?? 0,
				exit: x.exit ?? null
			},
			month: {
				unpaidLeave: x.unpaidLeave ?? [],
				work: x.work ?? [],
				daysWorked: x.daysWorked,
				hoursWorked: x.hoursWorked,
				bonus: x.bonus ?? 0,
				holidays: HOLIDAYS[x.period] ?? []
			}
		});
	};

	// 1. Wage seams: EPF row edges, the RM5,000 employer-rate seam, the RM20,000 method seam, the PERKESO RM6,000
	//    ceiling and band edges, the RM1,700 floor, each one cent above — by citizenship and residency.
	const seams = [1700, 1700.01, 2000, 2000.01, 2999.99, 3000, 3000.01, 4999.99, 5000, 5000.01, 5999.99, 6000, 6000.01, 8000, 12000, 19999.99, 20000, 20100, 30000];
	const cohorts: { key: string; citizenship: Citizenship; taxResidency?: Scenario['employee']['taxResidency']; contractEnd?: (p: string) => string; periods: string[] }[] = [
		{ key: 'citizen', citizenship: 'CITIZEN', periods: ['2026-01', '2026-09'] },
		{ key: 'pr', citizenship: 'PERMANENT_RESIDENT', periods: ['2026-09'] },
		{ key: 'foreign-nonres', citizenship: 'FOREIGNER', periods: ['2026-09'] },
		{ key: 'foreign-182d', citizenship: 'FOREIGNER', taxResidency: 'UNKNOWN', contractEnd: () => '2027-12-31', periods: ['2026-01'] }
	];
	for (const c of cohorts)
		for (const period of c.periods)
			for (const wage of seams)
				add({
					id: `wage-${c.key}-${period}-${wage}`,
					description: `${c.key} RM${wage} in ${period}, age 35`,
					rows: [
						...(wage === 1700 || wage === 1700.01 ? ['MY-NAT-01'] : []),
						...(c.contractEnd ? ['MY-PCB-06'] : c.citizenship === 'FOREIGNER' ? ['MY-PCB-07'] : [])
					],
					branches: [
						`wage=${wage}`,
						wage > 20000 ? 'EPF:percentage-method' : 'EPF:table',
						wage > 5000 ? 'EPF:employer-12%' : 'EPF:employer-13%',
						wage > 6000 ? 'PERKESO:ceiling' : 'PERKESO:band',
						c.contractEnd ? 'PCB:foreign-contract>=182d-resident' : c.citizenship === 'FOREIGNER' ? 'PCB:non-resident-30%' : 'PCB:resident'
					],
					period,
					citizenship: c.citizenship,
					taxResidency: c.taxResidency,
					age: 35,
					hireDate: '2024-01-01',
					contractEnd: c.contractEnd?.(period) ?? null,
					rate: wage
				});

	// 2. Age thresholds ±1: EIS 18; EPF/SOCSO/EIS 60; EPF 75. Whole-month ages (birthday in the prior month).
	const ageSets: [Citizenship, number[]][] = [
		['CITIZEN', [17, 18, 19, 59, 60, 61, 74, 75, 76]],
		['PERMANENT_RESIDENT', [59, 60, 61, 74, 75, 76]],
		['FOREIGNER', [59, 60, 61, 74, 75, 76]]
	];
	for (const [citizenship, ages] of ageSets)
		for (const age of ages)
			for (const wage of [3000, 5000.01])
				add({
					id: `age-${citizenship.toLowerCase()}-${age}-${wage}`,
					description: `${citizenship} aged ${age} throughout September 2026, RM${wage}`,
					rows: [...(age >= 60 ? ['MY-RET-01'] : []), ...(citizenship === 'FOREIGNER' ? ['MY-PCB-07'] : [])],
					branches: [
						`age=${age}`,
						age >= 75 ? 'EPF:none-75+' : age >= 60 ? (citizenship === 'CITIZEN' ? 'EPF:PartE' : citizenship === 'FOREIGNER' ? 'EPF:PartF' : 'EPF:PartC') : 'EPF:under-60',
						age >= 60 ? 'SOCSO:second-category' : 'SOCSO:first-category',
						age < 18 ? 'EIS:under-18' : age >= 60 ? 'EIS:60+' : 'EIS:covered'
					],
					period: '2026-09',
					citizenship,
					age,
					hireDate: after(bornForAge('2026-09', age), Math.min(age - 1, 50)),
					rate: wage
				});

	// 3. First-contribution entry ages: SOCSO second category from a first contribution at 55; EIS none from a first at 57.
	for (const entry of [54, 55, 56, 57, 58]) {
		const birthDate = bornForAge('2026-09', 59);
		const firstContributionDate = after(birthDate, entry, 1);
		add({
			id: `entry-${entry}`,
			description: `citizen aged 59, first SOCSO/EIS contribution at ${entry}`,
			branches: [`entry=${entry}`, entry >= 55 ? 'SOCSO:second-entry-55+' : 'SOCSO:first', entry >= 57 ? 'EIS:first-at-57+' : 'EIS:covered'],
			period: '2026-09',
			birthDate,
			firstContributionDate,
			hireDate: firstContributionDate,
			rate: 4200
		});
	}

	// 4. MTD categories, children, bands and the RM10 minimum (January 2026, no accumulators).
	for (const wage of [3000, 5000, 8000, 15000]) {
		add({ id: `pcb-cat1-${wage}`, description: `single, RM${wage}`, rows: ['MY-PCB-02'], branches: ['PCB:cat1'], period: '2026-01', rate: wage, hireDate: '2020-01-01' });
		for (const cat of [2, 3] as const)
			for (const children of [0, 1, 3])
				add({
					id: `pcb-cat${cat}-c${children}-${wage}`,
					description: `category ${cat}, ${children} children, RM${wage}`,
					rows: ['MY-PCB-02'],
					branches: [`PCB:cat${cat}`, `children=${children}`],
					period: '2026-01',
					rate: wage,
					pcbCategory: cat,
					children,
					hireDate: '2020-01-01'
				});
	}
	for (let wage = 3200; wage <= 3700; wage += 50)
		add({ id: `pcb-rm10-${wage}`, description: `RM10 minimum sweep, single RM${wage}`, branches: ['PCB:RM10-minimum'], period: '2026-01', rate: wage, hireDate: '2020-01-01' });
	for (const [wage, zakat] of [[5000, 50], [4000, 100]] as const)
		add({ id: `pcb-zakat-${wage}-${zakat}`, description: `RM${zakat} zakat on RM${wage}`, rows: ['MY-PCB-02'], branches: ['PCB:zakat-netted'], period: '2026-01', rate: wage, zakat, hireDate: '2020-01-01' });
	for (const [id, taxResidency, contractEnd] of [
		['unknown-open', 'UNKNOWN', null],
		['nonres-181d', 'NON_RESIDENT', '2026-06-30'],
		['nonres-182d', 'NON_RESIDENT', '2026-07-01']
	] as const)
		add({
			id: `pcb-foreign-${id}`,
			description: `foreign worker hired 1 Jan 2026, ${taxResidency}, contract to ${contractEnd ?? 'open'}`,
			rows: ['MY-PCB-06', 'MY-PCB-07'],
			branches: [`residency=${taxResidency}`, `contract=${contractEnd ?? 'open'}`],
			period: '2026-01',
			citizenship: 'FOREIGNER',
			taxResidency,
			hireDate: '2026-01-01',
			contractEnd,
			rate: 5001
		});
	add({ id: 'pcb-dec-2025', description: 'December 2025: n = 0, the whole year falls on one month', branches: ['PCB:n=0'], period: '2025-12', rate: 6000, hireDate: '2020-01-01' });
	add({ id: 'skbbk-first-month', description: 'June 2026, the first SKBBK contribution month', rows: ['MY-SKBBK-01'], branches: ['SKBBK:first-month'], period: '2026-06', rate: 3500, hireDate: '2020-01-01' });
	add({ id: 'skbbk-before', description: 'May 2026, before SKBBK', rows: ['MY-SKBBK-01'], branches: ['SKBBK:none-before-June-2026'], period: '2026-05', rate: 3500, hireDate: '2020-01-01' });

	// 5. s.18A proration: hire and exit on the 1st, mid-month and the last day, unpaid leave, in 28/30/31-day months.
	for (const period of ['2026-02', '2026-08', '2026-09']) {
		const last = lastDay(period);
		const dim = +last.slice(8);
		for (const d of [1, 2, 15, dim])
			add({
				id: `join-${period}-${d}`,
				description: `joins ${period}-${pad(d)} on RM3,100`,
				rows: ['MY-EA11'],
				branches: [d === 1 ? 's18A:whole-month' : 's18A(a):joiner'],
				period,
				hireDate: `${period}-${pad(d)}`,
				rate: 3100
			});
		for (const d of [1, 15, dim - 1])
			add({
				id: `leave-${period}-${d}`,
				description: `resigns with notice served, last day ${period}-${pad(d)}, RM3,100`,
				rows: ['MY-EA11', 'MY-EA12', 'MY-EA33', 'MY-EA05'],
				branches: ['s18A(b):leaver', 's60E(3A):untaken-leave'],
				period,
				hireDate: '2023-03-01',
				rate: 3100,
				exit: { date: `${period}-${pad(d)}`, cause: 'RESIGNATION', noticeServed: true, annualLeaveTaken: 2, wages12m: 37200 }
			});
		const weekdays = [...Array(dim)].map((_, i) => `${period}-${pad(i + 1)}`).filter((x) => ![0, 6].includes(new Date(`${x}T00:00:00Z`).getUTCDay()) && !(HOLIDAYS[period] ?? []).includes(x));
		for (const n of [1, 5])
			for (const wage of [1700, 3100])
				add({
					id: `unpaid-${period}-${n}-${wage}`,
					description: `${n} unpaid leave day(s) in ${period} on RM${wage}`,
					rows: ['MY-EA11', ...(wage === 1700 ? ['MY-EPF-04', 'MY-NAT-01'] : [])],
					branches: ['s18A(c):unpaid-leave'],
					period,
					hireDate: '2021-01-01',
					rate: wage,
					unpaidLeave: weekdays.slice(3, 3 + n)
				});
	}

	// 6. Overtime, rest-day and holiday hours (September 2026: Sat 5/12, Sun 6/13, Malaysia Day Wed 16).
	for (const [rate, fixedAllowance] of [[3000, 0], [2600, 260]] as const) {
		const tag = `${rate}${fixedAllowance ? '+fa' : ''}`;
		const base = { period: '2026-09', rate, fixedAllowance, hireDate: '2021-01-01', rows: ['MY-EA36', 'MY-WAGEBASE-01'] };
		for (const h of [9, 10, 12])
			add({ ...base, id: `ot-workday-${h - 8}h-${tag}`, description: `${h - 8} h beyond the normal 8 on Tue 8 Sep`, rows: [...base.rows, 'MY-EA31'], branches: ['s60A(3)(a):1.5x', `ot=${h - 8}h`], work: [{ date: '2026-09-08', hours: h }] });
		for (const h of [1, 4, 5, 8, 11])
			add({ ...base, id: `rest-sun-${h}h-${tag}`, description: `${h} h on Sunday 6 Sep, the s.59(1) rest day`, rows: [...base.rows, 'MY-EA30'], branches: [h <= 4 ? 's60(3)(b)(i):half-ORP' : 's60(3)(b)(ii):one-ORP', ...(h > 8 ? ['s60(3)(c):2x'] : []), 'contract:2.0x'], work: [{ date: '2026-09-06', hours: h }] });
		for (const h of [1, 8, 10])
			add({ ...base, id: `holiday-${h}h-${tag}`, description: `${h} h on Malaysia Day, Wed 16 Sep`, rows: [...base.rows, 'MY-EA32'], branches: ['s60D(3)(a)(i):two-days', ...(h > 8 ? ['s60D(3)(aa):3x'] : []), 'contract:2.0x/3.0x'], work: [{ date: '2026-09-16', hours: h }] });
		for (const h of [4, 10])
			add({ ...base, id: `rest-sat-${h}h-${tag}`, description: `${h} h on Saturday 5 Sep, the earlier contractual rest day`, rows: [...base.rows, 'MY-EA30', 'MY-EA30N', 'MY-EA31'], branches: ['s59(1):earlier-rest-day', 's60A(3)(a):1.5x-from-first-hour', 'contract:2.0x'], work: [{ date: '2026-09-05', hours: h }] });
		add({
			...base,
			id: `mixed-month-${tag}`,
			description: 'a month with workday OT, a Sunday and Malaysia Day worked',
			rows: [...base.rows, 'MY-EA31', 'MY-EA30', 'MY-EA32', 'MY-SR07'],
			branches: ['mixed-work', 'ot-under-104h'],
			work: [{ date: '2026-09-08', hours: 11 }, { date: '2026-09-09', hours: 10 }, { date: '2026-09-13', hours: 6 }, { date: '2026-09-16', hours: 9 }]
		});
	}

	// 7. Bonus: EPF wages, PCB additional remuneration, outside SOCSO/EIS/SKBBK/HRD.
	for (const [cz, wage, bonus] of [
		['CITIZEN', 3000, 12000], ['CITIZEN', 3000, 1500], ['CITIZEN', 5000, 3000], ['CITIZEN', 6000, 6000], ['CITIZEN', 20000, 20000],
		['PERMANENT_RESIDENT', 4000, 4000], ['FOREIGNER', 5000, 5000]
	] as const)
		add({
			id: `bonus-${cz.toLowerCase()}-${wage}-${bonus}`,
			description: `RM${wage} + RM${bonus} bonus in January 2026`,
			rows: ['MY-13M-01', 'MY-WAGEBASE-01', ...(cz === 'FOREIGNER' ? ['MY-PCB-07'] : [])],
			branches: ['bonus:EPF-only', 'PCB:additional-remuneration', ...(wage <= 5000 && wage + bonus > 5000 ? ['EPF:bonus-note-13%'] : [])],
			period: '2026-01',
			citizenship: cz,
			rate: wage,
			bonus,
			hireDate: '2020-01-01'
		});
	add({ id: 'allowance-fixed', description: 'RM2,600 + RM260 fixed allowance', rows: ['MY-HRDA02', 'MY-WAGEBASE-01'], branches: ['fixed-allowance:all-bases'], period: '2026-09', rate: 2600, fixedAllowance: 260, hireDate: '2021-01-01' });
	for (const travel of [300, 500])
		add({ id: `travel-${travel}`, description: `RM4,000 + RM${travel} official-duty travelling allowance`, rows: ['MY-PCB-05', 'MY-WAGEBASE-01', 'MY-HRDA02'], branches: ['travel:exempt-to-6000', 'travel:outside-EPF-SOCSO-EIS-HRD'], period: '2026-09', rate: 4000, travel, hireDate: '2021-01-01' });

	// 8. Separation: cause × length of service (under 12 months, 1-2, 2-5, 5+ years), last day 30 September 2026.
	const services: [string, string][] = [['8m', '2026-02-01'], ['18m', '2025-04-01'], ['3y6m', '2023-04-01'], ['6y9m', '2020-01-01']];
	const causes: [ExitCause, boolean][] = [
		['RESIGNATION', true], ['RESIGNATION', false], ['EMPLOYER_TERMINATION', true], ['EMPLOYER_TERMINATION', false],
		['MISCONDUCT_DISMISSAL', false], ['FIXED_TERM_EXPIRY', true]
	];
	for (const [len, hireDate] of services)
		for (const [cause, noticeServed] of causes)
			add({
				id: `exit-${cause.toLowerCase()}-${noticeServed ? 'notice' : 'no-notice'}-${len}`,
				description: `${cause} ${noticeServed ? 'after notice' : 'without notice'}, ${len} service, last day 30 Sep 2026, RM3,000`,
				rows: ['MY-EA11', 'MY-EA12', 'MY-EA33', 'MY-EA05', 'MY-SR08', 'MY-SR10'],
				branches: [`exit:${cause}`, `notice:${noticeServed ? 'served' : 'none'}`, `service=${len}`],
				period: '2026-09',
				hireDate,
				contractEnd: cause === 'FIXED_TERM_EXPIRY' ? '2026-09-30' : null,
				rate: 3000,
				exit: { date: '2026-09-30', cause, noticeServed, annualLeaveTaken: Math.floor(rand() * 4), wages12m: 36000 }
			});
	for (const age of [59, 60])
		add({
			id: `exit-retirement-${age}`,
			description: `contractual retirement at ${age}, last day 30 Sep 2026`,
			rows: ['MY-RET-01', 'MY-EA33', 'MY-SR10', 'MY-EA12'],
			branches: ['exit:CONTRACT_RETIREMENT', 'reg4(1)(a):no-benefit'],
			period: '2026-09',
			age,
			hireDate: '2010-01-01',
			rate: 5000,
			exit: { date: '2026-09-30', cause: 'CONTRACT_RETIREMENT', noticeServed: true, annualLeaveTaken: 5, wages12m: 60000 }
		});

	// 9. Minimum wage floors: monthly RM1,700, daily RM78.46 (five-day week), hourly RM8.72 — at and one sen below.
	add({ id: 'minwage-monthly-below', description: 'monthly RM1,699.99', rows: ['MY-NAT-01'], branches: ['MWO:monthly-below'], period: '2026-09', rate: 1699.99, hireDate: '2021-01-01' });
	for (const rate of [78.45, 78.46])
		add({ id: `minwage-daily-${rate}`, description: `daily-rated RM${rate}, 22 days`, rows: ['MY-NAT-01'], branches: [rate < 78.46 ? 'MWO:daily-below' : 'MWO:daily-at-floor'], period: '2026-09', payBasis: 'DAILY', rate, daysWorked: 22, hireDate: '2021-01-01' });
	for (const [rate, hours] of [[8.71, 80], [8.72, 80], [8.72, 120], [12, 100]] as const)
		add({
			id: `parttime-${rate}-${hours}h`,
			description: `part-time RM${rate}/h × ${hours} h`,
			rows: ['MY-NAT-01', 'MY-SR16', 'MY-SR17', 'MY-HRD12'],
			branches: [rate < 8.72 ? 'MWO:hourly-below' : 'MWO:hourly-at-or-above', 'part-time'],
			period: '2026-09',
			employmentType: 'PART_TIME',
			payBasis: 'HOURLY',
			rate,
			hoursWorked: hours,
			hireDate: '2021-01-01'
		});

	// 10. HRD levy classes and the 2026 education exemption; PR and foreigner outside the levy.
	for (const [hrd, msic, period] of [
		['COMPULSORY', '29300', '2026-09'], ['OPTIONAL', '29300', '2026-09'], ['NOT_LIABLE', '29300', '2026-09'],
		['COMPULSORY', '85302', '2026-01'], ['COMPULSORY', '85302', '2026-12'], ['COMPULSORY', '85302', '2025-12']
	] as const)
		for (const cz of ['CITIZEN', 'PERMANENT_RESIDENT'] as const)
			add({
				id: `hrd-${hrd.toLowerCase()}-${msic}-${period}-${cz.toLowerCase()}`,
				description: `${hrd} employer MSIC ${msic}, ${cz}, ${period}`,
				rows: ['MY-HRD-01', 'MY-HRD-02', ...(msic.startsWith('85') ? ['MY-HRD11'] : [])],
				branches: [`HRD:${hrd}`, msic.startsWith('85') ? 'HRD:education-MSIC' : 'HRD:manufacturing', `HRD:${cz}`],
				period,
				citizenship: cz,
				hrd,
				msic,
				rate: 3000,
				hireDate: '2021-01-01'
			});

	return out;
}
