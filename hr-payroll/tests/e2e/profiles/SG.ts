/**
 * Deterministic synthetic Singapore payroll months for the independent oracle (tests/e2e/oracle/SG.ts).
 *
 * Every scenario is tagged with the docs/inventory/singapore.csv rows (and branch names) it exercises. The shape is
 * semantic — one employee, one monthly-paid company (pay_cutoff_day 1, Mon–Fri office week, Sat off, Sun rest; see
 * `officeWeek` in tests/e2e/payroll-probe.ts) — so the test phase maps it onto a ProbeCase:
 *   employee → `employees`; employment + part_time → `employments` / `employment_terms` (settings_code 'SG');
 *   holidays → the case's own holiday rows (Saturday ones too); month.* → work days, leave, bonus, claims and ad hoc
 *   entries; employer_unregistered → the company's CPF/fund registration status;
 *   cpf_opening → the CPF opening declaration (origin: this employer); period → the run's period;
 *   `computePayslip(s).lines` → `expected[0].lines`.
 * `rows` = the hand-named rows of the scenario's purpose ∪ the rows whose branch the oracle actually took
 * (`computePayslip(s).rows`), so every tag is a real branch of that payslip.
 * No Math.random: a seeded mulberry32 picks names, races and birth days.
 */
import {
	computePayslip,
	daysOfMonth,
	isWorkingDay,
	publicHolidays,
	type Scenario
} from '../oracle/SG';

const rng = (() => {
	let a = 20260930;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
})();
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]!;
const pad = (n: number) => String(n).padStart(2, '0');

/** The five sealed SG settings versions (SG-SRC05): one period inside each. */
const VERSIONS = ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01'] as const;
const owc = (period: string) => (period.startsWith('2025') ? 7400 : 8000);
/** Ages that land squarely inside each CPF age group (≤55, >55–60, >60–65, >65–70, >70). */
const GROUP_AGE = [30, 57, 62, 67, 72] as const;
const GROUP_NAME = ['55&below', '>55-60', '>60-65', '>65-70', '>70'] as const;

/** Race/religion pairs; each deducts a known fund set (oracle `funds`). */
const PEOPLE = [
	{ race: 'CHINESE' },
	{ race: 'MALAY', religion: 'ISLAM' },
	{ race: 'INDIAN', religion: 'HINDUISM' },
	{ race: 'EURASIAN', religion: 'CHRISTIANITY' },
	{ race: 'SIKH', religion: 'SIKHISM' },
	{ race: 'OTHERS' }
] as const;

const birthFor = (period: string, age: number) => {
	const y = Number(period.slice(0, 4)) - age;
	return `${y}-${pad(1 + Math.floor(rng() * 12))}-${pad(1 + Math.floor(rng() * 28))}`;
};
const monthsBefore = (period: string, n: number, day = 10) => {
	const [y, m] = period.split('-').map(Number) as [number, number];
	const t = y * 12 + (m - 1) - n;
	return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-${pad(day)}`;
};
const lastDay = (period: string) => daysOfMonth(period).at(-1)!;
const workingDaysOf = (period: string) => daysOfMonth(period).filter(isWorkingDay);

type Draft = Omit<Scenario, 'profile' | 'holidays' | 'employee' | 'employment' | 'month'> & {
	employee?: Partial<Scenario['employee']>;
	employment?: Partial<Scenario['employment']>;
	month?: Scenario['month'];
};
const make = (d: Draft): Scenario => {
	const person = pick(PEOPLE);
	const s: Scenario = {
		...d,
		profile: 'SG',
		holidays: publicHolidays(d.period),
		employee: {
			birth_date: birthFor(d.period, 30),
			residency: 'CITIZEN',
			...person,
			...d.employee
		} as Scenario['employee'],
		employment: {
			start: '2020-01-06',
			monthly_basic: 3000,
			workman: false,
			managerial: false,
			daily_hours: 8,
			...d.employment
		},
		month: d.month ?? {}
	};
	const cause = s.employment.exit_cause;
	const exitRows =
		cause === 'RESIGNATION'
			? ['SG-EA11.resignation-with-notice']
			: cause === 'DISMISSAL' || cause === 'RETRENCHMENT'
				? ['SG-EA11.employer-termination']
				: cause === 'CONTRACT_END'
					? ['SG-EA03']
					: [];
	return { ...s, rows: [...new Set([...d.rows, ...exitRows, ...computePayslip(s).rows])].sort() };
};

export function generateProfiles(): Scenario[] {
	const out: Scenario[] = [];
	const add = (d: Draft) => out.push(make(d));

	// ---- A. CPF Table 1 cells: every version × age group × band seams (≤$50, >$50–500, >$500–750, >$750, OW ceiling)
	const seams = (p: string) => [50, 50.01, 500, 500.01, 750, 750.01, owc(p), owc(p) + 0.01];
	VERSIONS.forEach((period, v) =>
		GROUP_AGE.forEach((age, g) => {
			for (let j = 0; j < 3; j++) {
				const wage = seams(period)[(v * 3 + j + g) % 8]!;
				const spr3 = (v + g + j) % 4 === 0;
				add({
					id: `sg-o-t1-${period}-${g}-${j}`,
					rows: [],
					branches: [
						`T1/${GROUP_NAME[g]}/${wage}/${period.slice(0, 4)}`,
						spr3 ? 'SPR third year → Table 1' : 'citizen'
					],
					description: `Table 1 ${GROUP_NAME[g]} at $${wage}, ${period}`,
					period,
					employee: {
						birth_date: birthFor(period, age),
						...(spr3
							? {
									residency: 'SPR' as const,
									spr_granted_on: monthsBefore(period, 30),
									spr_rates: 'GRADUATED' as const
								}
							: {})
					},
					employment: { monthly_basic: wage }
				});
			}
		})
	);

	// ---- B. SPR Tables 2–5 and approved full/full
	const sprCells: [
		table: string,
		year: 1 | 2,
		rates: 'GRADUATED' | 'FULL_EMPLOYER' | 'FULL',
		groups: number
	][] = [
		['T2', 1, 'GRADUATED', 4],
		['T3', 2, 'GRADUATED', 4],
		['T4', 1, 'FULL_EMPLOYER', 5],
		['T5', 2, 'FULL_EMPLOYER', 5]
	];
	let k = 0;
	for (const [table, year, rates, groups] of sprCells)
		for (let g = 0; g < groups; g++)
			for (let j = 0; j < 2; j++) {
				const period = VERSIONS[k % 5]!;
				const wage = [...seams(period), 3000][(k * 3 + j) % 9]!;
				k++;
				add({
					id: `sg-o-spr-${table}-${g}-${j}`,
					rows: [],
					branches: [
						`${table}/${GROUP_NAME[g]}/${wage}/${period.slice(0, 4)}`,
						`SPR year ${year} ${rates}`
					],
					description: `SPR year ${year} (${rates}) ${GROUP_NAME[g]} at $${wage}, ${period}`,
					period,
					employee: {
						birth_date: birthFor(period, GROUP_AGE[g]!),
						residency: 'SPR',
						spr_granted_on: monthsBefore(period, year === 1 ? 6 : 18),
						spr_rates: rates
					},
					employment: { monthly_basic: wage }
				});
			}
	for (const [n, period] of (['2026-04', '2027-01'] as const).entries())
		add({
			id: `sg-o-spr-ff-${n}`,
			rows: ['SG-CPF09.full-full'],
			branches: ['approved full/full → Table 1', `SPR year ${n + 1}`],
			description: `SPR year ${n + 1} with Board-approved full/full rates, ${period}`,
			period,
			employee: {
				residency: 'SPR',
				spr_granted_on: monthsBefore(period, n === 0 ? 6 : 18),
				spr_rates: 'FULL'
			},
			employment: { monthly_basic: 5000 }
		});

	// ---- C. Age seams: the month before, of, and after the 55th/60th/65th/70th birthday (CPFA para 5(a))
	for (const age of [55, 60, 65, 70])
		for (const [n, period] of (['2026-05', '2026-06', '2026-07'] as const).entries())
			add({
				id: `sg-o-age-${age}-${n}`,
				rows: [`SG-CPF18.seam-${age}`],
				branches: [
					`attains ${age} on 15 Jun 2026`,
					['month before', 'birthday month', 'month after'][n]!
				],
				description: `Age ${age} seam, ${period}`,
				period,
				employee: { birth_date: `${2026 - age}-06-15` },
				employment: { monthly_basic: 4000 }
			});
	for (const period of ['2026-07', '2026-08'])
		add({
			id: `sg-o-age-first-of-month-${period}`,
			rows: ['SG-CPF18.seam-55'],
			branches: [
				'55th birthday on the 1st',
				period === '2026-07' ? 'birthday month' : 'month after'
			],
			description: `55th birthday 1 Jul 2026, ${period}`,
			period,
			employee: { birth_date: '1971-07-01' },
			employment: { monthly_basic: 4000 }
		});
	for (const period of ['2027-01', '2027-03'])
		add({
			id: `sg-o-age-feb29-${period}`,
			rows: ['SG-CPF18.seam-55'],
			branches: ['born 29 February: above 55 from 1 March (para 5(a)(ii))', period],
			description: `Born 29 Feb 1972, ${period}`,
			period,
			employee: { birth_date: '1972-02-29' },
			employment: { monthly_basic: 4000 }
		});

	// ---- D. SPR year seams (CPFA para 1A, 5(db), 5(ec))
	const sprSeams: [string, string, string, string][] = [
		['2025-06-15', '2026-06', 'GRADUATED', 'first anniversary month: still year 1'],
		['2025-06-15', '2026-07', 'GRADUATED', 'month after first anniversary: year 2'],
		['2025-06-15', '2027-06', 'GRADUATED', 'second anniversary month: still year 2'],
		['2025-06-15', '2027-07', 'GRADUATED', 'month after second anniversary: Table 1'],
		['2025-09-01', '2026-09', 'GRADUATED', 'granted on the 1st: anniversary month year 1'],
		['2025-09-01', '2026-10', 'GRADUATED', 'granted on the 1st: next month year 2'],
		['2025-06-15', '2026-06', 'FULL_EMPLOYER', 'F/G first anniversary month: Table 4'],
		['2025-06-15', '2026-07', 'FULL_EMPLOYER', 'F/G year 2: Table 5']
	];
	for (const [n, [granted, period, rates, branch]] of sprSeams.entries())
		add({
			id: `sg-o-spr-seam-${n}`,
			rows: ['SG-CPF09.year-seams'],
			branches: [branch],
			description: `SPR granted ${granted} (${rates}), ${period}`,
			period,
			employee: {
				residency: 'SPR',
				spr_granted_on: granted,
				spr_rates: rates as 'GRADUATED' | 'FULL_EMPLOYER'
			},
			employment: { monthly_basic: 4000 }
		});

	// ---- E. Foreign employees: no CPF, SDL, MBMF and SINDA regardless of pass
	const foreign: [string, string | undefined, 'EP' | 'S_PASS' | 'WORK_PERMIT', number, string][] = [
		['CHINESE', undefined, 'EP', 6000, 'foreign Chinese: no CDAC'],
		['INDIAN', 'HINDUISM', 'S_PASS', 3000, 'Indian S Pass: SINDA (SG-SHG04(b))'],
		['MALAY', 'ISLAM', 'WORK_PERMIT', 1800, 'Muslim Work Permit: MBMF'],
		['EURASIAN', 'CHRISTIANITY', 'EP', 7000, 'foreign Eurasian: no ECF'],
		['BANGLADESHI', 'ISLAM', 'WORK_PERMIT', 1500, 'Bangladeshi Muslim: MBMF and SINDA'],
		['SIKH', 'SIKHISM', 'S_PASS', 4000, 'Sikh S Pass: SINDA'],
		['OTHERS', undefined, 'EP', 4500.01, 'SDL cap on a foreign employee']
	];
	for (const [n, [race, religion, pass, wage, branch]] of foreign.entries())
		add({
			id: `sg-o-foreign-${n}`,
			rows: [],
			branches: [branch, 'foreign employee: no CPF (CPFA para 5(dc))'],
			description: `${pass} ${race} at $${wage}`,
			period: VERSIONS[n % 5]!,
			employee: { residency: 'FOREIGNER', pass, race, religion },
			employment: { monthly_basic: wage }
		});

	// ---- F. SDL seams (SDLA s.3; SG-SDL13 cent rounding) on an employee no fund charges
	for (const [n, wage] of [
		700, 799.99, 800, 800.01, 1002, 1234.56, 3999.99, 4500, 4500.01, 20000
	].entries())
		add({
			id: `sg-o-sdl-${n}`,
			rows: ['SG-S3'],
			branches: [`SDL at $${wage}`],
			description: `SDL at $${wage}`,
			period: VERSIONS[n % 5]!,
			employee: { residency: 'FOREIGNER', pass: 'EP', race: 'OTHERS', religion: undefined },
			employment: { monthly_basic: wage }
		});

	// ---- G. Self-help-fund rungs: each edge and one cent above it
	const rungs: [fund: string, race: string, religion: string | undefined, edges: number[]][] = [
		['CDAC', 'CHINESE', undefined, [2000, 3500, 5000, 7500]],
		['ECF', 'EURASIAN', 'CHRISTIANITY', [1000, 1500, 2500, 4000, 7000, 10000]],
		['MBMF', 'MALAY', 'ISLAM', [1000, 2000, 3000, 4000, 6000, 8000, 10000]],
		['SINDA', 'INDIAN', 'HINDUISM', [1000, 1500, 2500, 4500, 7500, 10000, 15000]]
	];
	k = 0;
	for (const [fund, race, religion, edges] of rungs)
		for (const edge of edges)
			for (const wage of [edge, edge + 0.01])
				add({
					id: `sg-o-shg-${fund}-${wage}`,
					rows: [],
					branches: [`${fund} rung at $${wage}`],
					description: `${fund} at $${wage}`,
					period: VERSIONS[k++ % 5]!,
					employee: { race, religion },
					employment: { monthly_basic: wage }
				});
	const shgSpecial: [string, Partial<Scenario['employee']>, string[]][] = [
		['muslim-indian', { race: 'INDIAN', religion: 'ISLAM' }, []],
		[
			'indian-chinese-dual',
			{ race: 'INDIAN', second_race: 'CHINESE', shg_dual_election: true },
			[]
		],
		['chinese-tamil-dual', { race: 'CHINESE', second_race: 'TAMIL', shg_dual_election: true }, []],
		['sikh-chinese-dual', { race: 'SIKH', second_race: 'CHINESE', shg_dual_election: true }, []],
		['indian-chinese-no-election', { race: 'INDIAN', second_race: 'CHINESE' }, []],
		['cdac-opt-out', { race: 'CHINESE', shg_opt_out: ['CDAC'] }, []],
		['telugu', { race: 'TELUGU' }, []],
		['goan', { race: 'GOAN', religion: 'CHRISTIANITY' }, []],
		[
			'ceylonese-pr',
			{ race: 'CEYLONESE', residency: 'SPR', spr_granted_on: '2020-03-10', spr_rates: 'GRADUATED' },
			[]
		],
		['malay-no-religion', { race: 'MALAY', religion: undefined }, []]
	];
	for (const [n, [name, employee, rows]] of shgSpecial.entries())
		add({
			id: `sg-o-shg-${name}`,
			rows,
			branches: [name],
			description: `Self-help funds: ${name} at $3,000`,
			period: VERSIONS[n % 5]!,
			employee: { religion: undefined, ...employee },
			employment: { monthly_basic: 3000 }
		});

	// ---- H. Incomplete months (EA s.20A), absence (s.28) and holiday pay (s.88)
	const pro: [
		string,
		string,
		Partial<Scenario['employment']>,
		Scenario['month'],
		string[],
		string
	][] = [
		['join-1st', '2026-09', { start: '2026-09-01' }, {}, [], 'hired on the 1st: whole month'],
		['join-2nd', '2026-09', { start: '2026-09-02' }, {}, [], 'hired on the 2nd'],
		[
			'join-mid',
			'2026-09',
			{ start: '2026-09-15', monthly_allowance: 200 },
			{},
			[],
			'hired mid-month, gross includes allowance'
		],
		['join-last', '2026-09', { start: '2026-09-30' }, {}, [], 'hired on the last day'],
		[
			'join-weekend-1st',
			'2026-08',
			{ start: '2026-08-01' },
			{},
			[],
			'hired Saturday 1st: every working day worked'
		],
		[
			'join-before-ph',
			'2026-08',
			{ start: '2026-08-05' },
			{},
			[],
			'joiner: holiday on a working day counted'
		],
		[
			'leave-1st',
			'2026-09',
			{ end: '2026-09-01', exit_cause: 'RESIGNATION' },
			{},
			[],
			'leaves on the 1st'
		],
		[
			'leave-mid',
			'2026-09',
			{ end: '2026-09-15', exit_cause: 'RESIGNATION' },
			{},
			[],
			'leaves mid-month'
		],
		[
			'leave-last',
			'2026-09',
			{ end: '2026-09-30', exit_cause: 'CONTRACT_END' },
			{},
			['SG-EA03'],
			'contract ends on the last day'
		],
		[
			'leave-before-ph',
			'2026-08',
			{ end: '2026-08-07', exit_cause: 'RESIGNATION' },
			{},
			[],
			'leaves before the holiday'
		],
		[
			'leave-after-ph',
			'2026-08',
			{ end: '2026-08-12', exit_cause: 'RESIGNATION' },
			{},
			[],
			'leaver: holiday counted'
		],
		[
			'leave-sunday-1st',
			'2026-11',
			{ end: '2026-11-01', exit_cause: 'RESIGNATION' },
			{},
			[],
			'no working day in the month: nil wages, nil charges'
		],
		[
			'join-and-leave',
			'2026-09',
			{ start: '2026-09-08', end: '2026-09-25', exit_cause: 'RESIGNATION' },
			{},
			[],
			'joins and leaves in one month'
		],
		['dec-2025-join', '2025-12', { start: '2025-12-15' }, {}, [], 'Dec 2025 joiner with Christmas'],
		[
			'dec-2025-leave',
			'2025-12',
			{ end: '2025-12-24', exit_cause: 'RESIGNATION' },
			{},
			[],
			'Dec 2025 leaver before Christmas'
		],
		['npl-1', '2026-09', {}, { no_pay_leave: ['2026-09-10'] }, [], 'one day no-pay leave'],
		[
			'npl-5',
			'2026-09',
			{ monthly_allowance: 200 },
			{ no_pay_leave: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'] },
			[],
			'five days no-pay leave, allowance'
		],
		[
			'npl-month',
			'2026-09',
			{},
			{ no_pay_leave: workingDaysOf('2026-09') },
			[],
			'whole month no-pay leave: nil'
		],
		[
			'npl-over-ph',
			'2026-02',
			{},
			{ no_pay_leave: ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20'] },
			[],
			's.88(2): holiday inside requested no-pay leave unpaid'
		],
		['absent-1', '2026-09', {}, { absent: ['2026-09-10'] }, [], 's.28(2): gross day deducted'],
		[
			'absent-1-allowance',
			'2026-10',
			{ monthly_allowance: 300 },
			{ absent: ['2026-10-14'] },
			[],
			's.28(2) on the gross rate'
		],
		[
			'absent-before-ph',
			'2026-08',
			{ monthly_basic: 2400 },
			{ absent: ['2026-08-07'] },
			[],
			's.88(3): absent the working day before'
		],
		[
			'absent-after-ph',
			'2026-08',
			{ monthly_basic: 2400 },
			{ absent: ['2026-08-11'] },
			[],
			's.88(3): absent the working day after'
		],
		[
			'absent-both-ph',
			'2026-08',
			{ monthly_basic: 2400 },
			{ absent: ['2026-08-07', '2026-08-11'] },
			[],
			's.88(3): absent both sides, forfeited once'
		],
		[
			'absent-good-friday',
			'2026-04',
			{},
			{ absent: ['2026-04-02'] },
			[],
			's.88(3): absent before Good Friday'
		],
		[
			'absent-not-adjacent',
			'2026-08',
			{ monthly_basic: 2400 },
			{ absent: ['2026-08-20'] },
			[],
			'absence not adjacent to the holiday'
		]
	];
	for (const [name, period, employment, month, rows, branch] of pro)
		add({
			id: `sg-o-month-${name}`,
			rows,
			branches: [branch],
			description: branch,
			period,
			employment: { start: '2020-01-06', ...employment },
			month
		});

	// ---- I. Overtime, rest-day and holiday work (EA ss.35, 37, 38, 88(4); Fourth Schedule)
	const oct = (d: number) => `2026-10-${pad(d)}`;
	const ot = (hours: number, n = 1) =>
		workingDaysOf('2026-10')
			.slice(0, n)
			.map((date) => ({ date, hours }));
	const work: [
		string,
		string,
		Partial<Scenario['employment']>,
		Scenario['month'],
		string[],
		string
	][] = [
		[
			'ot-2600',
			'2026-10',
			{ monthly_basic: 2600 },
			{ overtime: ot(2) },
			['SG-EA46-R01', 'SG-EA22'],
			'non-workman at $2,600: covered, unrounded hour'
		],
		[
			'ot-2600.01',
			'2026-10',
			{ monthly_basic: 2600.01 },
			{ overtime: ot(2) },
			[],
			'non-workman at $2,600.01: outside Part 4'
		],
		[
			'ot-workman-4500',
			'2026-10',
			{ monthly_basic: 4500, workman: true },
			{ overtime: ot(3) },
			[],
			'workman at $4,500: actual basic, no cap'
		],
		[
			'ot-workman-4500.01',
			'2026-10',
			{ monthly_basic: 4500.01, workman: true },
			{ overtime: ot(3) },
			[],
			'workman at $4,500.01: outside Part 4'
		],
		[
			'ot-manager',
			'2026-10',
			{ monthly_basic: 2000, managerial: true },
			{ overtime: ot(2) },
			[],
			'managerial: outside Part 4'
		],
		[
			'ot-half-hour',
			'2026-10',
			{ monthly_basic: 2000 },
			{ overtime: ot(0.5) },
			['SG-EA22'],
			'half an hour of overtime'
		],
		[
			'ot-72',
			'2026-10',
			{ monthly_basic: 1800 },
			{ overtime: ot(4, 18) },
			['SG-EA22'],
			'72 hours in the month'
		],
		[
			'ot-workman-allowance',
			'2026-10',
			{ monthly_basic: 3000, monthly_allowance: 300, workman: true },
			{ overtime: ot(2, 5) },
			[],
			'overtime on basic, not gross'
		],
		[
			'ot-allowance-not-salary',
			'2026-10',
			{ monthly_basic: 2600, monthly_allowance: 500 },
			{ overtime: ot(1) },
			[],
			's.35 salary excludes allowances'
		],
		[
			'rest-employer-3',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(4), hours: 3, requested_by: 'EMPLOYER' }] },
			[],
			's.37(3)(a) ≤ half day'
		],
		[
			'rest-employer-4',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(4), hours: 4, requested_by: 'EMPLOYER' }] },
			[],
			's.37(3)(a) exactly half'
		],
		[
			'rest-employer-5',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(11), hours: 5, requested_by: 'EMPLOYER' }] },
			[],
			's.37(3)(b) two days'
		],
		[
			'rest-employer-8',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(11), hours: 8, requested_by: 'EMPLOYER' }] },
			[],
			's.37(3)(b) full normal day'
		],
		[
			'rest-employer-8.5',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(18), hours: 8.5, requested_by: 'EMPLOYER' }] },
			[],
			's.37(3)(c)(ii) hour or part thereof'
		],
		[
			'rest-employer-10',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(25), hours: 10, requested_by: 'EMPLOYER' }] },
			[],
			's.37(3)(c) beyond the normal day'
		],
		[
			'rest-employee-4',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(4), hours: 4, requested_by: 'EMPLOYEE' }] },
			[],
			's.37(2)(a) half day'
		],
		[
			'rest-employee-6',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(11), hours: 6, requested_by: 'EMPLOYEE' }] },
			[],
			's.37(2)(b) one day'
		],
		[
			'rest-employee-8',
			'2026-10',
			{ monthly_basic: 2400 },
			{ rest_day_work: [{ date: oct(18), hours: 8, requested_by: 'EMPLOYEE' }] },
			[],
			's.37(2)(b) non-workman'
		],
		[
			'rest-employee-9',
			'2026-10',
			{ monthly_basic: 3000, workman: true },
			{ rest_day_work: [{ date: oct(25), hours: 9, requested_by: 'EMPLOYEE' }] },
			[],
			's.37(2)(c) beyond the normal day'
		],
		[
			'rest-uncovered',
			'2026-10',
			{ monthly_basic: 2600.01 },
			{ rest_day_work: [{ date: oct(4), hours: 8, requested_by: 'EMPLOYER' }] },
			[],
			'outside Part 4: s.37 does not apply'
		],
		[
			'holiday-8',
			'2026-08',
			{ monthly_basic: 3000, workman: true },
			{ holiday_work: [{ date: '2026-08-10', hours: 8 }] },
			[],
			's.88(4) extra basic day'
		],
		[
			'holiday-10',
			'2026-08',
			{ monthly_basic: 3000, workman: true },
			{ holiday_work: [{ date: '2026-08-10', hours: 10 }] },
			['SG-EA22'],
			's.88(4) plus overtime beyond the normal day'
		],
		[
			'holiday-non-workman',
			'2026-05',
			{ monthly_basic: 2600 },
			{ holiday_work: [{ date: '2026-05-27', hours: 8 }] },
			[],
			's.88(4) non-workman in Part 4'
		],
		[
			'holiday-xmas-2025',
			'2025-12',
			{ monthly_basic: 3000, workman: true },
			{ holiday_work: [{ date: '2025-12-25', hours: 8 }] },
			[],
			'Christmas 2025 worked, Dec 2025 version'
		]
	];
	for (const [name, period, employment, month, rows, branch] of work)
		add({
			id: `sg-o-work-${name}`,
			rows,
			branches: [branch],
			description: branch,
			period,
			employment,
			month
		});

	// ---- J. Additional wages and the AW ceiling (CPFA para 2; SG-CPF03/21)
	const aw: [
		string,
		string,
		Partial<Scenario['employment']>,
		Scenario['month'],
		Scenario['cpf_opening'],
		Partial<Scenario['employee']>,
		string[],
		string
	][] = [
		[
			'bonus-mid-year',
			'2026-06',
			{ monthly_basic: 4000 },
			{ bonus: 3000 },
			{ ordinary_wages_ytd: 20000, additional_wages_ytd: 0 },
			{},
			['SG-AWS01'],
			'bonus within the estimated ceiling'
		],
		[
			'december-ceiling',
			'2026-12',
			{ monthly_basic: 8000 },
			{ bonus: 10000 },
			{ ordinary_wages_ytd: 88000, additional_wages_ytd: 0 },
			{},
			[],
			'December: AW capped at 102,000 − 96,000'
		],
		[
			'december-ceiling-above-owc',
			'2026-12',
			{ monthly_basic: 9000 },
			{ bonus: 10000 },
			{ ordinary_wages_ytd: 88000, additional_wages_ytd: 0 },
			{},
			[],
			'OW above the ceiling counts only to $8,000'
		],
		[
			'december-prior-aw',
			'2026-12',
			{ monthly_basic: 8000 },
			{ bonus: 5000 },
			{ ordinary_wages_ytd: 88000, additional_wages_ytd: 4000 },
			{},
			[],
			'earlier AW uses the room first'
		],
		[
			'leaver-true-up',
			'2026-06',
			{ monthly_basic: 8000, end: '2026-06-30', exit_cause: 'RESIGNATION' },
			{ bonus: 60000 },
			{ ordinary_wages_ytd: 40000, additional_wages_ytd: 0 },
			{},
			[],
			'last month: ceiling on actual OW'
		],
		[
			'low-wage-into-band',
			'2026-04',
			{ monthly_basic: 400 },
			{ bonus: 400 },
			{ ordinary_wages_ytd: 1200, additional_wages_ytd: 0 },
			{},
			[],
			'OW 400 + AW 400: Total Wages above $750'
		],
		[
			'low-wage-mid-band',
			'2026-04',
			{ monthly_basic: 300 },
			{ bonus: 300 },
			{ ordinary_wages_ytd: 900, additional_wages_ytd: 0 },
			{},
			[],
			'Total Wages $600: graduated band'
		],
		[
			'dec-2025-joiner-bonus',
			'2025-12',
			{ monthly_basic: 5000, start: '2025-12-01' },
			{ bonus: 5000 },
			{ ordinary_wages_ytd: 0, additional_wages_ytd: 0 },
			{},
			[],
			'2025 rates and $7,400 ceiling'
		],
		[
			'senior-2027-bonus',
			'2027-01',
			{ monthly_basic: 3000 },
			{ bonus: 1500 },
			{ ordinary_wages_ytd: 0, additional_wages_ytd: 0 },
			{ birth_date: '1969-05-20' },
			[],
			'2027 >55–60 rate on OW and AW'
		],
		[
			'bonus-lifts-cdac',
			'2026-07',
			{ monthly_basic: 1900 },
			{ bonus: 200 },
			{ ordinary_wages_ytd: 11400, additional_wages_ytd: 0 },
			{ race: 'CHINESE', religion: undefined },
			[],
			'fund on total wages including AW'
		],
		[
			'bonus-lifts-sdl',
			'2026-07',
			{ monthly_basic: 4000 },
			{ bonus: 1000 },
			{ ordinary_wages_ytd: 24000, additional_wages_ytd: 0 },
			{},
			[],
			'SDL on wages including bonus, capped'
		],
		[
			'half-dollar-rounding',
			'2026-07',
			{ monthly_basic: 3001.35 },
			{ bonus: 1000.01 },
			{ ordinary_wages_ytd: 18000, additional_wages_ytd: 0 },
			{},
			[],
			'OW and AW summed unrounded before one rounding'
		]
	];
	for (const [name, period, employment, month, opening, employee, rows, branch] of aw)
		add({
			id: `sg-o-aw-${name}`,
			rows,
			branches: [branch],
			description: branch,
			period,
			employee,
			employment: { start: '2020-01-06', ...employment },
			month,
			cpf_opening: opening
		});

	// ---- K. Exit causes (EA ss.10–11; final pay; leave pay on exit an AW)
	const exits: [string, Partial<Scenario['employment']>, Scenario['month'], string[], string][] = [
		[
			'resign-leave-pay',
			{ end: '2026-09-15', exit_cause: 'RESIGNATION' },
			{ leave_days_paid_on_exit: 3 },
			[],
			'resignation with 3 days leave pay (AW)'
		],
		[
			'dismiss-1-week',
			{ start: '2025-06-02', end: '2026-09-15', exit_cause: 'DISMISSAL' },
			{ notice_in_lieu_weeks: 1 },
			['SG-EA04.default-26-weeks'],
			's.10(3)(b): 1 week in lieu, outside CPF/funds, inside SDL'
		],
		[
			'dismiss-2-weeks',
			{ start: '2023-03-01', end: '2026-09-15', exit_cause: 'DISMISSAL' },
			{ notice_in_lieu_weeks: 2 },
			['SG-EA04.default-2-years'],
			's.10(3)(c): 2 weeks in lieu'
		],
		[
			'dismiss-4-weeks',
			{ start: '2019-01-07', end: '2026-09-15', exit_cause: 'DISMISSAL' },
			{ notice_in_lieu_weeks: 4 },
			['SG-EA04.default-5-years'],
			's.10(3)(d): 4 weeks in lieu'
		],
		[
			'dismiss-1-day',
			{ start: '2026-06-01', end: '2026-09-15', exit_cause: 'DISMISSAL' },
			{ notice_in_lieu_days: 1 },
			['SG-EA04.default-below-26-weeks'],
			's.10(3)(a): 1 day in lieu'
		],
		[
			'retrench',
			{ end: '2026-10-30', exit_cause: 'RETRENCHMENT' },
			{ leave_days_paid_on_exit: 2 },
			['SG-EA24'],
			'retrenchment: no statutory benefit quantum'
		],
		[
			'death',
			{ end: '2026-09-20', exit_cause: 'DEATH' },
			{},
			[],
			'employment ends on death (Sunday)'
		],
		[
			'contract-end-full',
			{ start: '2025-10-01', end: '2026-09-30', exit_cause: 'CONTRACT_END' },
			{},
			['SG-EA03'],
			'fixed term ends on the last day'
		]
	];
	for (const [name, employment, month, rows, branch] of exits) {
		const period = employment.end!.slice(0, 7);
		add({
			id: `sg-o-exit-${name}`,
			rows,
			branches: [branch],
			description: branch,
			period,
			employment: { start: '2020-01-06', ...employment },
			month,
			// AW on exit: this employer's earlier OW in the year (Jan–Aug/Sep at $3,000)
			cpf_opening: {
				ordinary_wages_ytd: 3000 * (Number(period.slice(5)) - 1),
				additional_wages_ytd: 0
			}
		});
	}

	// ---- L. Part-time (PT regs 2, 5): $1,040 a month, 4 h a day × 5 = 20 h a week, contract hourly basic $12
	const pt = {
		monthly_basic: 1040,
		daily_hours: 4,
		part_time: { weekly_hours: 20, hourly_basic: 12 }
	};
	const ptCases: [string, Partial<Scenario['employment']>, Scenario['month'], string[], string][] =
		[
			['plain', {}, {}, [], 'part-time month, CPF on $1,040'],
			['ot-3', {}, { overtime: ot(3) }, [], 'reg.5(1)(a)(i): 3 h at 1×'],
			['ot-5', {}, { overtime: ot(5) }, [], 'reg.5(1)(a)(ii): 4 h at 1×, 1 h at 1.5×'],
			[
				'ot-4.5',
				{},
				{ overtime: ot(4.5) },
				[],
				'part of an hour above the comparator counts as an hour'
			],
			['ot-2.25', {}, { overtime: ot(2.25) }, [], 'part of an hour at 1× counts as an hour'],
			['join-mid', { start: '2026-10-15' }, {}, [], 'part-time joiner, s.20A']
		];
	for (const [name, employment, month, rows, branch] of ptCases)
		add({
			id: `sg-o-pt-${name}`,
			rows: [...rows, 'SG-PT02', 'SG-PT03', 'SG-EA27', 'SG-SL11'],
			branches: [branch],
			description: branch,
			period: '2026-10',
			employment: { ...pt, ...employment },
			month
		});

	// ---- M. More self-help-fund codes, instructions and elections (SG-SHG04(a), SG-SHG04(c), SG-SHG03 r.8)
	const shgMore: [string, Partial<Scenario['employee']>, string[]][] = [
		['sino-indian', { race: 'SINO INDIAN' }, []],
		['anglo-indian', { race: 'ANGLO INDIAN', religion: 'CHRISTIANITY' }, []],
		['marathi', { race: 'MARATHI', religion: 'HINDUISM' }, []],
		['nepalese-no-fund', { race: 'NEPALESE', religion: 'HINDUISM' }, ['SG-SHG04(a)']],
		[
			'tamil-punjabi-dual-refused',
			{ race: 'TAMIL', second_race: 'PUNJABI', shg_dual_election: true },
			[]
		],
		['cdac-instruction', { race: 'CHINESE', shg_instruction: { fund: 'CDAC', amount: 5 } }, []],
		[
			'sinda-instruction',
			{ race: 'INDIAN', religion: 'HINDUISM', shg_instruction: { fund: 'SINDA', amount: 2 } },
			[]
		],
		['unregistered-employer', { race: 'CHINESE' }, []]
	];
	for (const [n, [name, employee, rows]] of shgMore.entries())
		add({
			id: `sg-o-shg-${name}`,
			rows,
			branches: [name],
			description: `Self-help funds: ${name} at $3,000`,
			period: VERSIONS[n % 5]!,
			...(name === 'unregistered-employer' ? { employer_unregistered: true } : {}),
			employee: { religion: undefined, ...employee },
			employment: { monthly_basic: 3000 }
		});

	// ---- N. Saturday off-day holidays (EA s.88(1)(c), s.88(3); SG-HOL01.saturday, SG-HOL02)
	const offDay: [string, string, Partial<Scenario['employment']>, Scenario['month'], string][] = [
		[
			'pay-2026-03',
			'2026-03',
			{ monthly_allowance: 200 },
			{},
			'Hari Raya Puasa Sat 21 Mar 2026: a gross day paid'
		],
		[
			'substitute-2026-03',
			'2026-03',
			{},
			{ off_day_holiday: 'SUBSTITUTE' },
			'a day off in substitution: nothing extra'
		],
		[
			'forfeit-2026-03',
			'2026-03',
			{},
			{ absent: ['2026-03-20'] },
			'absent Friday before: holiday pay forfeited'
		],
		[
			'joiner-after-2026-03',
			'2026-03',
			{ start: '2026-03-23' },
			{},
			'joined after the holiday: not paid'
		],
		[
			'leaver-on-2026-03',
			'2026-03',
			{ end: '2026-03-21', exit_cause: 'RESIGNATION' },
			{},
			'employed on the holiday: paid'
		],
		['pay-2027-02', '2027-02', {}, {}, 'CNY Sat 6 Feb 2027 paid; Sun 7 Feb → Mon 8 Feb'],
		['pay-2027-05', '2027-05', { monthly_basic: 2400 }, {}, 'Labour Day Sat 1 May 2027'],
		[
			'pay-2027-12',
			'2027-12',
			{ monthly_basic: 5200, managerial: true },
			{},
			'Christmas Sat 25 Dec 2027, a manager too'
		]
	];
	for (const [name, period, employment, month, branch] of offDay)
		add({
			id: `sg-o-offday-${name}`,
			rows: [],
			branches: [branch],
			description: branch,
			period,
			employment,
			month
		});

	// ---- O. Holiday work outside Part 4 with time off in lieu (EA s.88(4A))
	const lieu: [string, Partial<Scenario['employment']>, boolean, string][] = [
		['outside-lieu', { monthly_basic: 5000 }, true, 's.88(4A): time off in lieu, no extra day'],
		['outside-no-lieu', { monthly_basic: 5000 }, false, 's.88(4): extra basic day'],
		[
			'inside-lieu-ignored',
			{ monthly_basic: 2500 },
			true,
			'Part 4 (s.35(b)): s.88(4A) does not reach; extra day paid'
		],
		[
			'workman-lieu-ignored',
			{ monthly_basic: 4000, workman: true },
			true,
			's.35(a) workman: extra day paid'
		]
	];
	for (const [name, employment, flag, branch] of lieu)
		add({
			id: `sg-o-lieu-${name}`,
			rows: [],
			branches: [branch],
			description: branch,
			period: '2026-08',
			employment,
			month: { holiday_work: [{ date: '2026-08-10', hours: 6, time_off_in_lieu: flag }] }
		});

	// ---- P. Rate changes and conversions (SG-EA10.rate-change; SG-CPF34, SG-CPF09.conversion-month). September 2026
	// has 22 working days and no holiday: $4,400 is $200 a day, so every segment is exact.
	const conv: [
		string,
		Partial<Scenario['employee']>,
		Partial<Scenario['employment']>,
		Scenario['month'],
		string
	][] = [
		[
			'rate-up',
			{},
			{ monthly_basic: 2200, rate_changes: [{ from: '2026-09-16', monthly_basic: 4400 }] },
			{},
			'raise on the 16th: 11 days at each rate'
		],
		[
			'rate-allowance',
			{},
			{
				monthly_basic: 4000,
				monthly_allowance: 400,
				rate_changes: [{ from: '2026-09-21', monthly_basic: 4000, monthly_allowance: 0 }]
			},
			{},
			'allowance withdrawn on the 21st'
		],
		[
			'foreigner-to-spr',
			{
				race: 'CHINESE',
				religion: undefined,
				residency: 'SPR',
				spr_granted_on: '2026-09-16',
				spr_rates: 'GRADUATED'
			},
			{ monthly_basic: 4400 },
			{},
			'SPR from the 16th: CPF on 11/22, CDAC on the whole month'
		],
		[
			'foreigner-to-spr-bonus',
			{
				race: 'MALAY',
				religion: 'ISLAM',
				residency: 'SPR',
				spr_granted_on: '2026-09-16',
				spr_rates: 'GRADUATED'
			},
			{ monthly_basic: 4400 },
			{ bonus: 1000 },
			'AW payable after the SPR day at first-year rates'
		],
		[
			'foreigner-to-spr-fg',
			{
				race: 'OTHERS',
				religion: undefined,
				residency: 'SPR',
				spr_granted_on: '2026-09-08',
				spr_rates: 'FULL_EMPLOYER'
			},
			{ monthly_basic: 4400 },
			{},
			'SPR F/G from the 8th: Table 4 on 17/22'
		],
		[
			'foreigner-to-spr-on-1st',
			{
				race: 'OTHERS',
				religion: undefined,
				residency: 'SPR',
				spr_granted_on: '2026-09-01',
				spr_rates: 'GRADUATED'
			},
			{ monthly_basic: 4400 },
			{},
			'SPR from the 1st: whole month Table 2'
		],
		[
			'spr1-to-citizen',
			{
				race: 'INDIAN',
				religion: 'HINDUISM',
				residency: 'CITIZEN',
				spr_granted_on: '2026-03-10',
				spr_rates: 'GRADUATED',
				citizen_on: '2026-09-16'
			},
			{ monthly_basic: 4400 },
			{},
			'Table 2 then Table 1'
		],
		[
			'spr2-to-citizen',
			{
				race: 'EURASIAN',
				religion: 'CHRISTIANITY',
				residency: 'CITIZEN',
				spr_granted_on: '2025-05-10',
				spr_rates: 'GRADUATED',
				citizen_on: '2026-09-22'
			},
			{ monthly_basic: 4400 },
			{ bonus: 2000 },
			'Table 3 then Table 1, AW at citizen rates'
		],
		[
			'spr3-to-citizen-ceiling',
			{
				race: 'OTHERS',
				religion: undefined,
				residency: 'CITIZEN',
				spr_granted_on: '2021-02-10',
				spr_rates: 'GRADUATED',
				citizen_on: '2026-09-16'
			},
			{ monthly_basic: 9900 },
			{},
			'one OW ceiling across the month'
		]
	];
	for (const [name, employee, employment, month, branch] of conv)
		add({
			id: `sg-o-conv-${name}`,
			rows: [],
			branches: [branch],
			description: branch,
			period: '2026-09',
			employee,
			employment,
			month
		});

	// ---- Q. Paid leave, claims, benefits and deductions
	const misc: [
		string,
		string,
		Partial<Scenario['employee']>,
		Partial<Scenario['employment']>,
		Scenario['month'],
		string
	][] = [
		[
			'annual-leave',
			'2026-10',
			{},
			{},
			{
				paid_leave: ['2026-10-05', '2026-10-06', '2026-10-07'].map((date) => ({
					date,
					kind: 'ANNUAL' as const
				}))
			},
			'annual leave at the gross rate: salary unchanged'
		],
		[
			'outpatient',
			'2026-10',
			{},
			{ monthly_allowance: 150 },
			{ paid_leave: [{ date: '2026-10-12', kind: 'OUTPATIENT' }] },
			'outpatient sick day: salary unchanged'
		],
		[
			'hospitalisation',
			'2026-10',
			{},
			{},
			{
				paid_leave: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map(
					(date) => ({ date, kind: 'HOSPITALISATION' as const })
				)
			},
			'hospitalisation leave: salary unchanged'
		],
		[
			'medical-sdl03a',
			'2026-04',
			{ race: 'OTHERS', religion: undefined },
			{},
			{ medical_reimbursement: 100 },
			'SG-SDL03A: $100 outside SDL, SDL stays $7.50'
		],
		[
			'medical-muslim',
			'2027-01',
			{ race: 'MALAY', religion: 'ISLAM' },
			{ monthly_basic: 2000 },
			{ medical_reimbursement: 250 },
			'medical reimbursement outside CPF and MBMF'
		],
		[
			'retrenchment-golden',
			'2026-10',
			{ race: 'CHINESE', religion: undefined },
			{ monthly_basic: 2000, end: '2026-10-30', exit_cause: 'RETRENCHMENT' },
			{ retrenchment_benefit: 1500 },
			'SG-EA24-R02 golden: outside CPF and CDAC, inside SDL'
		],
		[
			'retrenchment-sdl-cap',
			'2026-10',
			{ race: 'OTHERS', religion: undefined },
			{ monthly_basic: 4000, end: '2026-10-30', exit_cause: 'RETRENCHMENT' },
			{ retrenchment_benefit: 12000 },
			'retrenchment benefit lifts SDL to its cap'
		],
		[
			'damage-within',
			'2026-10',
			{ race: 'OTHERS', religion: undefined },
			{},
			{ damage_recovery: { loss: 200 } },
			's.29(1): actual loss $200'
		],
		[
			'damage-quarter',
			'2026-10',
			{ race: 'OTHERS', religion: undefined },
			{},
			{ damage_recovery: { loss: 1000 } },
			's.29(1): capped at a quarter of $3,000'
		],
		[
			'damage-permitted-half',
			'2026-10',
			{ race: 'OTHERS', religion: undefined },
			{},
			{ damage_recovery: { loss: 1500, commissioner_permitted: true } },
			's.32(1): with CPF, half of the salary'
		],
		[
			'damage-final-salary',
			'2026-10',
			{ race: 'OTHERS', religion: undefined },
			{ end: '2026-10-30', exit_cause: 'RESIGNATION' },
			{ damage_recovery: { loss: 1500, commissioner_permitted: true } },
			's.32(2): the last salary is outside the half'
		],
		[
			'damage-final-quarter',
			'2026-10',
			{ race: 'OTHERS', religion: undefined },
			{ end: '2026-10-30', exit_cause: 'RESIGNATION' },
			{ damage_recovery: { loss: 1000 } },
			'last salary: the quarter still binds'
		],
		[
			'student-sdl-exempt',
			'2026-07',
			{ sdl_exempt_student: true, birth_date: '2005-03-14' },
			{ monthly_basic: 1200 },
			{},
			'listed-institution trainee: CPF, no SDL'
		],
		[
			'outside-singapore',
			'2026-07',
			{ residency: 'FOREIGNER', pass: 'EP', race: 'OTHERS', religion: undefined },
			{ monthly_basic: 6000, wholly_outside_singapore: true },
			{},
			'services wholly outside Singapore: no SDL'
		],
		[
			'company-chauffeur',
			'2026-07',
			{},
			{ monthly_basic: 2200, workman: true, household_role: true },
			{},
			'a company chauffeur stays within SDL'
		]
	];
	for (const [name, period, employee, employment, month, branch] of misc)
		add({
			id: `sg-o-misc-${name}`,
			rows: [],
			branches: [branch],
			description: branch,
			period,
			employee,
			employment,
			month
		});

	// ---- R. The AW ceiling across employers and an exhausted ceiling (SG-CPF03, SG-CPF22, SG-CPF21.overpayment)
	const awMore: [string, Scenario['cpf_opening'], number, string][] = [
		[
			'other-employer-ignored',
			{ ordinary_wages_ytd: 40000, additional_wages_ytd: 0, other_employer_ow_ytd: 48000 },
			30000,
			"a former employer's OW does not reduce the ceiling"
		],
		[
			'related-company-approved',
			{
				ordinary_wages_ytd: 40000,
				additional_wages_ytd: 0,
				other_employer_ow_ytd: 48000,
				related_company_approved: true
			},
			30000,
			'approved single ceiling: related OW counts'
		],
		[
			'ceiling-exhausted',
			{ ordinary_wages_ytd: 88000, additional_wages_ytd: 10000 },
			1000,
			'earlier AW over the true ceiling: no CPF, never negative'
		]
	];
	for (const [name, opening, bonus, branch] of awMore)
		add({
			id: `sg-o-aw-${name}`,
			rows: [],
			branches: [branch],
			description: branch,
			period: '2026-12',
			employment: {
				start: name === 'ceiling-exhausted' ? '2020-01-06' : '2026-07-01',
				monthly_basic: 8000
			},
			month: { bonus },
			cpf_opening: opening
		});

	const ids = new Set(out.map((s) => s.id));
	if (ids.size !== out.length) throw new Error('duplicate SG scenario id');
	return out;
}

/** Row ids the scenarios cover. */
export const coveredRows = () => [...new Set(generateProfiles().flatMap((s) => s.rows))].sort();

/** Smallest self-check: known hand values from the tracker and the tables. */
export function selfCheck() {
	const s = generateProfiles();
	const by = (id: string) => computePayslip(s.find((x) => x.id === id)!).lines;
	const eq = (id: string, key: string, want: number) => {
		const got = by(id)[key];
		if (got !== want) throw new Error(`${id} ${key}: ${got} ≠ ${want}`);
	};
	eq('sg-o-work-ot-2600', 'gross', 2640.91); // SG-EA46-R01 golden 40.91
	eq('sg-o-sdl-4', 'SDL.employer', 2.51); // SG-SDL13-1: 1,002 → 2.505 → 2.51
	eq('sg-o-sdl-6', 'SDL.employer', 10); // 3,999.99 → 10.00
	eq('sg-o-shg-indian-chinese-dual', 'SINDA.employee', 7); // SG-SHG01 probe
	eq('sg-o-shg-indian-chinese-dual', 'CDAC.employee', 1);
	eq('sg-o-aw-december-ceiling', 'CPF.employee', 2800); // 20% × (8,000 + 6,000)
	eq('sg-o-misc-retrenchment-golden', 'net', 3099.5); // SG-EA24-R02 golden: CPF 400/340, CDAC 0.50, SDL 8.75
	eq('sg-o-misc-retrenchment-golden', 'SDL.employer', 8.75);
	eq('sg-o-misc-medical-sdl03a', 'SDL.employer', 7.5); // SG-SDL03A: $100 reimbursement outside SDL
	eq('sg-o-offday-pay-2026-03', 'gross', 3347.69); // s.88(1)(c): 12 × 3,200 ÷ 260 = 147.69
	eq('sg-o-conv-foreigner-to-spr', 'CPF.employee', 110); // Table 2: 5% × 2,200 (11/22 of 4,400)
	eq('sg-o-conv-spr1-to-citizen', 'CPF.employer', 462); // 9% × 2,200 + 37% × 2,200 = 1,012, less 5% + 20%
	return s.length;
}
