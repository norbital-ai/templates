/**
 * Deterministic CN-kunming scenario generator: synthetic employees across every payslip-affecting branch in
 * `docs/inventory/china.csv` (CN and CN-kunming rows), each tagged with the tracker row ids and branch names it
 * exercises. Expected payslips come from `tests/e2e/oracle/CN-kunming.ts`, which reads the law, not the engine.
 *
 * Shape → probe harness (`tests/e2e/payroll-probe.ts`): `profile` is the company's `settings_code`, `period` the run's
 * period, `id`/`description`/`citation` carry over; `employee`/`employment`/`facts`/`tax`/`time`/`pay`/`exit` are the
 * rows to create (employees, employments, terms and fact rows, leave/overtime/ad hoc rows, exit facts). A resident's
 * IIT is cumulative, so every month from `runsFrom` to `period` must be run in order; only `period` is judged.
 * Refusals: `computePayslip(s).refused.stage` is `input` (a create refused) or `run` (`payroll_runs.create` refused).
 */
import { employeeShares } from '../oracle/CN-kunming.ts';

export type Region = 'I' | 'II' | 'III';
export type Scenario = {
	id: string;
	profile: 'CN-kunming';
	description: string;
	citation: string[];
	/** tracker row ids exercised */
	rows: string[];
	/** branch names exercised */
	branches: string[];
	period: string;
	runsFrom: string;
	employee: {
		name: string;
		birthDate: string;
		citizenship: 'CN' | 'FOREIGN' | 'HMT';
		taxResident: boolean;
		pensionRecipient?: boolean;
		/** verified service at earlier employers (annual-leave tier) */
		priorServiceMonths?: number;
	};
	employment: {
		hireDate: string;
		exitDate: string | null;
		monthlyWage: number;
		raise?: { from: string; monthlyWage: number };
		partTime?: { hourlyRate: number; hours: number };
		wageRegion: Region;
		worksite: string;
	};
	facts: {
		/** declared SI base; default the monthly wage */
		siBase?: number;
		siRegistered: boolean;
		/** equal unit/worker fund rate; null = not in the fund */
		fundRate: number | null;
		fundAccount: 'EXISTING' | 'FIRST_EVER' | 'TRANSFERRED';
		/** declared prior-calendar-year average for an EXISTING account */
		fundBase?: number;
		/** agency-assigned injury rate */
		injuryRate: number;
		/** operator-declared unemployment rates (read only for Jan–Aug 2026, which has no sourced instrument) */
		unemploymentRates?: { employer: number; employee: number };
	};
	tax: { specialDeductionsMonthly?: number; basic60kElection?: boolean; firstIncomeThisYear?: boolean };
	time: {
		unpaidDays?: number;
		overtime?: {
			weekdayHours?: number;
			maxDailyWeekdayHours?: number;
			restDayHours?: number;
			restDayCompensatoryRest?: boolean;
			holidayHours?: number;
		};
		leave?: { code: string; calendarDays: number; childrenUnder3?: number };
	};
	pay: {
		bonus?: {
			kind: 'BONUS' | 'ANNUAL_BONUS_SEPARATE' | 'MULTI_MONTH_NONRESIDENT';
			amount: number;
			usedThisYear?: boolean;
		};
		/** agency maternity allowance paid to the employer this month */
		maternityAllowance?: number;
	};
	exit?: {
		cause: 'RESIGNATION' | 'MISCONDUCT' | 'MUTUAL_EMPLOYER' | 'ART40' | 'ART41' | 'EXPIRY' | 'UNLAWFUL';
		noticeDaysGiven?: number;
		renewalOfferRefused?: boolean;
		/** declared local prior-year average monthly wage (LCL art.47 cap; 164号 exemption) */
		localAverageMonthlyWage: number;
		leaveTakenThisYear?: number;
	};
};

type Patch = { [K in keyof Scenario]?: Scenario[K] extends object ? Partial<Scenario[K]> : Scenario[K] };

// mulberry32 — seeded, deterministic
let seed = 0x6b6d_2026;
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const SURNAMES = ['Li', 'Wang', 'Zhang', 'Liu', 'Chen', 'Yang', 'Zhao', 'Huang', 'Zhou', 'Wu', 'Xu', 'Sun'];
const GIVEN = ['Wei', 'Fang', 'Na', 'Min', 'Jing', 'Lei', 'Yan', 'Jun', 'Tao', 'Hui', 'Ming', 'Xia'];
const name = () =>
	`${SURNAMES[Math.floor(rand() * SURNAMES.length)]} ${GIVEN[Math.floor(rand() * GIVEN.length)]}`;
const WORKSITE: Record<Region, string> = { I: 'Wuhua District', II: 'Fumin County', III: 'Mo Han' };
const LOCAL_AVG = 10847.83; // declared exit fact: the tracker's Kunming lcl47 figure (CN-N39 golden)
const fen = (x: number) => Math.round(x * 100 + 1e-7) / 100;

const SRC = {
	minWage2025: '云人社发〔2025〕19号, https://www.ynjc.gov.cn/u/cms/jcqzfxxgk/202509/30130601xbad.pdf',
	minWage2026: 'Yunnan HRSS notice 29 Aug 2026, https://www.ynjc.gov.cn/jcqzfxxgk/zcw2023j0221/20260901/1677677.html',
	siBase: '云人社发〔2026〕8号, https://www.kunming.cn/news/c/2026-08-29/14069738.shtml',
	county: '7 Sep 2026 county HRSS notice, https://www.yncxym.gov.cn/info/1011/286437.htm',
	medical: 'Kunming NHSA/Finance notice 30 Dec 2022, https://ybj.km.gov.cn/c/2023-02-08/4665265.shtml',
	maternity: 'Kunming maternity rules 2024, https://ybj.km.gov.cn/c/2024-07-25/4882692.shtml',
	injury: '云人社发〔2020〕14号, https://hrss.yn.gov.cn/Uploads/NewsPhoto/2020-03-12/b451dfd4-ba60-48d9-931e-2bed943dcef0.pdf',
	fund: '昆公积金〔2026〕69号 / 昆公积金规〔2020〕2号, https://zc.51shebao.com/detail/825467',
	iit: 'STA 2018 No.61, https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3963396/content.html',
	bonus: 'MOF/STA 2023 No.30, https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211524/content.html',
	labour: 'Labour Law arts.36–44, https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html',
	days: '人社部发〔2025〕2号, https://www.mohrss.gov.cn/SYrlzyhshbzb/laodongguanxi_/zcwj/202501/t20250101_533693.html',
	lcl: 'Labour Contract Law, https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html',
	sev: '财税〔2018〕164号 item 5, http://szs.mof.gov.cn/zhengcefabu/201812/t20181227_3110164.htm',
	leave: 'Paid Annual Leave Regulation, https://xzfg.moj.gov.cn/front/law/detail?LawID=208',
	yunnanFp: 'Yunnan Population and Family Planning Regulation 2022, https://www.ynrd.gov.cn/html/2022/changweihuigonggao_0118/16355.html',
	wagePay: '昆明市工资支付条例, https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=67457'
};

const out: Scenario[] = [];
let n = 0;
function add(tag: string, rows: string[], branches: string[], description: string, citation: string[], p: Patch) {
	const period = p.period ?? '2026-01';
	const hireDate = p.employment?.hireDate ?? `${period}-01`;
	const s: Scenario = {
		id: `CN-KM-O-${String(++n).padStart(3, '0')}-${tag}`,
		profile: 'CN-kunming',
		description,
		citation,
		rows,
		branches,
		period,
		runsFrom: p.runsFrom ?? period,
		employee: {
			name: name(),
			birthDate: '1990-05-10',
			citizenship: 'CN',
			taxResident: true,
			...p.employee
		},
		employment: {
			exitDate: null,
			monthlyWage: 10000,
			wageRegion: 'I',
			worksite: WORKSITE[p.employment?.wageRegion ?? 'I'],
			...p.employment,
			hireDate
		},
		facts: {
			siRegistered: true,
			fundRate: 0.05,
			fundAccount: hireDate.slice(0, 7) === period ? 'TRANSFERRED' : 'EXISTING',
			injuryRate: 0.002,
			unemploymentRates: { employer: 0.007, employee: 0.003 },
			...p.facts
		},
		tax: { ...p.tax },
		time: { ...p.time },
		pay: { ...p.pay },
		...(p.exit ? { exit: { localAverageMonthlyWage: LOCAL_AVG, ...p.exit } as Scenario['exit'] } : {})
	};
	out.push(s);
	return s;
}
const plusMinus = (x: number) => [fen(x - 0.01), x, fen(x + 0.01)];
const SI_ROWS = ['CN-KM03', 'CN-KM04', 'CN-KM25', 'CN-KM26', 'CN-KM27', 'CN-KM32', 'CN-X-SI-ROUNDING', 'CN-N07'];

function build() {
	// ---- minimum wage (monthly) at every floor ±1 cent, each class, each dated table
	for (const period of ['2025-12', '2026-08', '2026-09'])
		for (const [region, floor] of Object.entries(
			period < '2026-09' ? { I: 2170, II: 2020, III: 1870 } : { I: 2270, II: 2120, III: 1970 }
		) as [Region, number][])
			for (const wage of plusMinus(floor))
				add(
					`minwage-${period}-${region}-${wage}`,
					[period < '2026-09' ? 'CN-KM01' : 'CN-KM02', 'CN-KM-WP03', 'CN-N50', 'CN-X-WORKSITE', 'CN-KM05'],
					[`class ${region}`, wage < floor ? 'below floor refused' : wage === floor ? 'at floor' : 'one cent above'],
					`Class ${region} worker at ${wage} in ${period} (floor ${floor})`,
					[period < '2026-09' ? SRC.minWage2025 : SRC.minWage2026],
					{ period, employment: { monthlyWage: wage, wageRegion: region, worksite: WORKSITE[region] } }
				);
	add('minwage-2170-in-sep', ['CN-KM02', 'CN-KM-WP03'], ['old floor blocked after 1 Sep 2026'],
		'2,170 in Wuhua in September 2026 is below the new 2,270', [SRC.minWage2026],
		{ period: '2026-09', employment: { monthlyWage: 2170 } });

	// ---- part-time hourly floors (LCL art.72) ±1 cent
	for (const period of ['2026-08', '2026-09'])
		for (const [region, floor] of Object.entries(
			period < '2026-09' ? { I: 21, II: 20, III: 19 } : { I: 22, II: 21, III: 20 }
		) as [Region, number][])
			for (const rate of plusMinus(floor))
				add(
					`parttime-${period}-${region}-${rate}`,
					[period < '2026-09' ? 'CN-KM01' : 'CN-KM02', 'CN-N27', 'CN-KM14'],
					['part-time', `hourly class ${region}`, rate < floor ? 'below hourly floor refused' : 'at/above hourly floor'],
					`Part-time ${region} worker, 80 h at ${rate}/h in ${period}`,
					[period < '2026-09' ? SRC.minWage2025 : SRC.minWage2026, SRC.lcl],
					{
						period,
						employment: { monthlyWage: 0, partTime: { hourlyRate: rate, hours: 80 }, wageRegion: region, worksite: WORKSITE[region] },
						facts: { fundRate: null }
					}
				);

	// ---- social-insurance bases at every floor/ceiling ±1 cent, three dated windows
	for (const period of ['2025-12', '2026-01', '2026-09'])
		for (const seam of [4357, 4403, 21789, 22017])
			for (const wage of plusMinus(seam))
				add(`si-${period}-${wage}`, SI_ROWS, [`SI base seam ${seam}`, period],
					`SI base ${wage} in ${period}`, [SRC.siBase, SRC.county, SRC.medical, SRC.maternity],
					{ period, employment: { monthlyWage: wage } });

	// ---- housing-fund base floors (each class) and caps ±1 cent
	for (const period of ['2025-12', '2026-01', '2026-09']) {
		const floors = period < '2026-09' ? { I: 2170, II: 2020, III: 1870 } : { I: 2270, II: 2120, III: 1970 };
		const cap = period < '2026-01' ? 32470 : 32543;
		const existing = { hireDate: '2020-03-02' };
		const runsFrom = period === '2026-09' ? '2026-01' : period;
		// December 2025: a resident's cumulative IIT would need the whole of 2025 (before the sourced tables), so the
		// existing-account holder is a non-resident foreigner in the fund by agreement (monthly tax, CN-N25).
		const who = period === '2025-12' ? { citizenship: 'FOREIGN' as const, taxResident: false } : {};
		for (const [region, floor] of Object.entries(floors) as [Region, number][])
			for (const base of plusMinus(floor))
				add(`hf-floor-${period}-${region}-${base}`, ['CN-KM05', 'CN-KM20', 'CN-N08'],
					[`fund floor class ${region}`, 'existing account'],
					`Existing account declared base ${base} in ${period}`, [SRC.fund],
					{ period, runsFrom, employee: who, employment: { ...existing, monthlyWage: 6000, wageRegion: region, worksite: WORKSITE[region] }, facts: { fundAccount: 'EXISTING', fundBase: base } });
		for (const base of plusMinus(cap))
			add(`hf-cap-${period}-${base}`, ['CN-KM05', 'CN-KM20', 'CN-N08', 'CN-N43'], ['fund cap', '12%'],
				`Existing account declared base ${base} at 12% in ${period}`, [SRC.fund],
				{ period, runsFrom, employee: who, employment: { ...existing, monthlyWage: 40000 }, facts: { fundAccount: 'EXISTING', fundBase: base, fundRate: 0.12 } });
	}
	// fund rates and 四舍五入 seams
	for (const [rate, wage, branch] of [
		[0.05, 2290, 'half-up 114.5 → 115'],
		[0.05, 2289.99, '114.4995 → 114'],
		[0.07, 10000, 'mid rate'],
		[0.12, 21750, '12% maximum'],
		[0.04, 10000, 'below 5% refused'],
		[0.13, 10000, 'above 12% refused']
	] as [number, number, string][])
		add(`hf-rate-${rate}-${wage}`, ['CN-KM20', 'CN-KM21', 'CN-KM05'], [branch], `Fund at ${rate * 100}% on ${wage}`, [SRC.fund],
			{ employment: { monthlyWage: wage }, facts: { fundRate: rate } });
	add('hf-first-ever-joining', ['CN-KM20', 'CN-N08'], ['first-ever account: joining month nothing'],
		'First-ever account hired 15 Jan 2026: no fund in January', [SRC.fund],
		{ employment: { hireDate: '2026-01-15', monthlyWage: 21750 }, facts: { fundAccount: 'FIRST_EVER', fundRate: 0.12 } });
	add('hf-first-ever-second', ['CN-KM20', 'CN-N08'], ['first-ever account: second month full wage'],
		'First-ever account hired 15 Jan 2026: February charges 12% of 21,750', [SRC.fund],
		{ period: '2026-02', runsFrom: '2026-01', employment: { hireDate: '2026-01-15', monthlyWage: 21750 }, facts: { fundAccount: 'FIRST_EVER', fundRate: 0.12 } });
	add('hf-transferred-part-month', ['CN-KM20'], ['transferred account: first month full wage'],
		'Transferred account hired 15 Jan 2026 pays on the full monthly wage', [SRC.fund],
		{ employment: { hireDate: '2026-01-15', monthlyWage: 9000 }, facts: { fundAccount: 'TRANSFERRED' } });

	// ---- injury classes I–VIII
	[0.002, 0.004, 0.007, 0.009, 0.011, 0.013, 0.016, 0.019].forEach((rate, i) =>
		add(`injury-class-${i + 1}`, ['CN-KM26', 'CN-KM14'], [`industry class ${i + 1}`], `Injury class ${i + 1} at ${rate * 100}%`, [SRC.injury],
			{ facts: { injuryRate: rate } }));

	// ---- unemployment windows
	add('unemp-2025-12', ['CN-KM27'], ['2025 notice 0.7/0.3'], 'December 2025 unemployment 0.7/0.3', [SRC.county], { period: '2025-12' });
	add('unemp-2026-01-declared-reduced', ['CN-KM27'], ['Jan–Aug 2026 declared 0.7/0.3'], 'January 2026, declared reduced rates', [SRC.county], {});
	add('unemp-2026-01-declared-full', ['CN-KM27'], ['Jan–Aug 2026 declared 2/1'], 'January 2026, declared unreduced rates', [SRC.county],
		{ facts: { unemploymentRates: { employer: 0.02, employee: 0.01 } } });
	add('unemp-2026-01-undeclared', ['CN-KM27'], ['Jan–Aug 2026 no instrument, nothing declared'], 'January 2026, no rate declared: unpriced', [SRC.county],
		{ facts: { unemploymentRates: undefined } });
	add('unemp-2026-09', ['CN-KM27'], ['7 Sep 2026 notice 0.7/0.3'], 'September 2026 unemployment 0.7/0.3', [SRC.county], { period: '2026-09' });

	// ---- citizenship / residence / registration
	add('foreign-resident-no-fund', ['CN-N25', 'CN-KM18'], ['foreign resident', 'fund only by agreement'], 'Foreign resident insured, outside the fund', [SRC.iit],
		{ employee: { citizenship: 'FOREIGN' }, facts: { fundRate: null } });
	add('foreign-resident-fund-agreement', ['CN-N25', 'CN-KM18'], ['foreign resident', 'fund by agreement'], 'Foreign resident in the fund by agreement', [SRC.fund],
		{ employee: { citizenship: 'FOREIGN' } });
	add('hmt-si-fund', ['CN-N48', 'CN-KM18'], ['HK/Macao/Taiwan', 'fund opt-in'], 'Hong Kong resident on ordinary SI, in the fund', [SRC.iit], { employee: { citizenship: 'HMT' } });
	add('hmt-si-no-fund', ['CN-N48', 'CN-KM18'], ['HK/Macao/Taiwan', 'no fund'], 'Taiwan resident on ordinary SI, outside the fund', [SRC.iit],
		{ employee: { citizenship: 'HMT' }, facts: { fundRate: null } });
	add('unregistered', ['CN-KM28', 'CN-N37', 'CN-N07'], ['not registered, still assessed'], 'Unenrolled worker still assessed', [SRC.county],
		{ facts: { siRegistered: false } });
	// non-resident monthly table seams (wage − 5,000)
	add('nonres-5000', ['CN-N38'], ['non-resident', 'no taxable income'], 'Non-resident at 5,000: no IIT', [SRC.iit],
		{ employee: { citizenship: 'FOREIGN', taxResident: false }, employment: { monthlyWage: 5000 }, facts: { fundRate: null } });
	for (const seam of [3000, 12000, 25000, 35000, 55000, 80000])
		for (const t of [seam, fen(seam + 0.01)])
			add(`nonres-${t}`, ['CN-N38', 'CN-N25'], ['non-resident monthly table', t === seam ? `seam ${seam}` : 'one cent above'],
				`Non-resident taxable ${t}`, [SRC.iit],
				{ employee: { citizenship: 'FOREIGN', taxResident: false }, employment: { monthlyWage: fen(5000 + t) }, facts: { fundRate: null } });

	// ---- resident cumulative table seams (January): special deductions absorb the fixed shares
	for (const seam of [36000, 144000, 300000, 420000, 660000, 960000])
		for (const target of [seam, fen(seam + 0.01)]) {
			const s = add(`iit-${target}`, ['CN-N09', 'CN-N38', 'CN-N16'], ['resident cumulative table', target === seam ? `seam ${seam}` : 'one cent above'],
				`Resident January cumulative taxable ${target}`, [SRC.iit],
				{ employment: { hireDate: '2020-03-02', monthlyWage: seam + 20000 } });
			s.tax.specialDeductionsMonthly = fen(s.employment.monthlyWage - employeeShares(s) - 5000 - target);
		}
	add('iit-zero', ['CN-N09'], ['taxable below zero withholds nothing'], 'Resident at 5,000: nothing withheld', [SRC.iit], { employment: { monthlyWage: 5000 } });
	add('iit-60k-election', ['CN-N11'], ['60,000 election'], '60,000 election on a 10,000 January wage: nothing withheld', [SRC.iit],
		{ employment: { hireDate: '2020-03-02' }, tax: { basic60kElection: true } });
	add('iit-no-election', ['CN-N11', 'CN-N09'], ['no election'], 'Same without the election', [SRC.iit], { employment: { hireDate: '2020-03-02' } });
	add('iit-first-income-sep', ['CN-N44'], ['first wage income this year'], 'September hire declaring first income: 45,000 deduction', [SRC.iit],
		{ period: '2026-09', employment: { monthlyWage: 30000 }, tax: { firstIncomeThisYear: true } });
	add('iit-no-first-income-sep', ['CN-N44', 'CN-N09'], ['no declaration'], 'September hire without the declaration: 5,000', [SRC.iit],
		{ period: '2026-09', employment: { monthlyWage: 30000 } });
	add('iit-first-income-dec', ['CN-N44'], ['first wage income this year, December'], 'December 2025 hire declaring first income: 60,000', [SRC.iit],
		{ period: '2025-12', employment: { monthlyWage: 30000 }, tax: { firstIncomeThisYear: true } });
	add('iit-rent', ['CN-N54', 'CN-N16'], ['rent 1,500'], 'Rent deduction 1,500 declared', [SRC.iit], { employment: { monthlyWage: 20000 }, tax: { specialDeductionsMonthly: 1500 } });
	add('iit-child-elder', ['CN-N16'], ['child education 2,000 + elder 3,000'], 'Declared 5,000 of special deductions', [SRC.iit],
		{ employment: { monthlyWage: 20000 }, tax: { specialDeductionsMonthly: 5000 } });

	// ---- bonuses
	for (const amount of [12000, 36000, 36000.01, 144000, 144000.01, 300000, 300000.01, 420000, 420000.01, 660000, 660000.01, 960000, 960000.01])
		add(`bonus-separate-${amount}`, ['CN-N10', 'CN-N53'], ['resident separate annual bonus', `bonus ÷ 12 = ${fen(amount / 12)}`],
			`Separate annual bonus ${amount}`, [SRC.bonus], { pay: { bonus: { kind: 'ANNUAL_BONUS_SEPARATE', amount } } });
	add('bonus-separate-second-use', ['CN-N10'], ['once per year refused'], 'Second separate bonus in a year', [SRC.bonus],
		{ pay: { bonus: { kind: 'ANNUAL_BONUS_SEPARATE', amount: 20000, usedThisYear: true } } });
	add('bonus-ordinary', ['CN-N10', 'CN-N53', 'CN-N09'], ['ordinary bonus joins wages'], 'Ordinary 10,000 bonus in the cumulative wage', [SRC.iit],
		{ pay: { bonus: { kind: 'BONUS', amount: 10000 } } });
	add('bonus-separate-nonresident', ['CN-N10', 'CN-KM-A1'], ['separate method is resident-only'], 'Non-resident cannot elect the resident method', [SRC.bonus],
		{ employee: { citizenship: 'FOREIGN', taxResident: false }, facts: { fundRate: null }, pay: { bonus: { kind: 'ANNUAL_BONUS_SEPARATE', amount: 20000 } } });
	const nonres = { employee: { citizenship: 'FOREIGN' as const, taxResident: false }, employment: { monthlyWage: 30000 }, facts: { fundRate: null } };
	for (const amount of [60000, 18000, 18000.01, 72000, 72000.01, 150000, 150000.01, 210000, 210000.01, 330000, 330000.01, 480000, 480000.01])
		add(`bonus-nonres-${amount}`, ['CN-KM-A1', 'CN-N38'], ['non-resident multi-month bonus', `bonus ÷ 6 = ${fen(amount / 6)}`],
			`Non-resident multi-month bonus ${amount}`, [SRC.iit], { ...nonres, pay: { bonus: { kind: 'MULTI_MONTH_NONRESIDENT', amount } } });
	add('bonus-nonres-second-use', ['CN-KM-A1'], ['once per year refused'], 'Second non-resident multi-month bonus', [SRC.iit],
		{ ...nonres, pay: { bonus: { kind: 'MULTI_MONTH_NONRESIDENT', amount: 60000, usedThisYear: true } } });
	add('bonus-nonres-resident', ['CN-KM-A1'], ['multi-month spread is non-resident-only'], 'Resident cannot use the non-resident spread', [SRC.iit],
		{ pay: { bonus: { kind: 'MULTI_MONTH_NONRESIDENT', amount: 60000 } } });
	add('bonus-nonres-ordinary', ['CN-N38', 'CN-KM-A1'], ['non-resident ordinary bonus joins the month'], 'Non-resident ordinary bonus with the wage', [SRC.iit],
		{ ...nonres, pay: { bonus: { kind: 'BONUS', amount: 10000 } } });

	// ---- proration: hire and exit on the 1st, mid-month and last days
	for (const day of ['01', '15', '30', '31'])
		add(`hire-2026-01-${day}`, ['CN-N02', 'CN-N04', 'CN-KM20'], [`hired ${day} Jan`], `Joiner on 2026-01-${day}`, [SRC.days],
			{ employment: { hireDate: `2026-01-${day}`, monthlyWage: 21750 } });
	for (const day of ['01', '15', '30'])
		add(`hire-2026-09-${day}`, ['CN-N02', 'CN-KM02'], [`hired ${day} Sep`], `Joiner on 2026-09-${day}`, [SRC.days],
			{ period: '2026-09', employment: { hireDate: `2026-09-${day}`, monthlyWage: 21750 } });
	for (const day of ['01', '15', '27', '30', '31'])
		add(`exit-2026-01-${day}`, ['CN-N02', 'CN-KM-WP06', 'CN-N18'], [`left ${day} Jan`, 'resignation'], `Leaver on 2026-01-${day}`, [SRC.days, SRC.wagePay],
			{ employment: { hireDate: '2020-03-02', exitDate: `2026-01-${day}`, monthlyWage: 21750 }, exit: { cause: 'RESIGNATION' } });
	for (const d of [1, 3])
		add(`unpaid-${d}`, ['CN-N04', 'CN-KM-WP12', 'CN-N02'], [`${d} unpaid day(s)`], `${d} personal-leave day(s) at 21,750 ÷ 21.75`, [SRC.days, SRC.wagePay],
			{ employment: { monthlyWage: 21750 }, time: { unpaidDays: d } });
	add('raise-jan', ['CN-KM-WP03', 'CN-N02'], ['mid-month rise'], '22,000 → 26,400 from 16 Jan 2026', [SRC.days],
		{ employment: { hireDate: '2020-03-02', monthlyWage: 22000, raise: { from: '2026-01-16', monthlyWage: 26400 } } });
	add('raise-feb', ['CN-KM-WP03', 'CN-N02'], ['mid-month rise'], '22,000 → 26,400 from 16 Feb 2026', [SRC.days],
		{ period: '2026-02', runsFrom: '2026-01', employment: { hireDate: '2020-03-02', monthlyWage: 22000, raise: { from: '2026-02-16', monthlyWage: 26400 } } });

	// ---- overtime (21,750 → 125 an hour)
	const ot = (tag: string, branches: string[], o: NonNullable<Scenario['time']['overtime']>, rows = ['CN-N01', 'CN-KM-WP08', 'CN-N02']) =>
		add(`ot-${tag}`, rows, branches, `Overtime ${tag}`, [SRC.labour, SRC.days], { employment: { monthlyWage: 21750 }, time: { overtime: o } });
	ot('weekday-1h', ['weekday 150%'], { weekdayHours: 1, maxDailyWeekdayHours: 1 });
	ot('weekday-36h', ['monthly limit reached'], { weekdayHours: 36, maxDailyWeekdayHours: 3 }, ['CN-N01', 'CN-N40', 'CN-KM-WP08']);
	ot('weekday-37h', ['monthly limit exceeded, still paid'], { weekdayHours: 37, maxDailyWeekdayHours: 3 }, ['CN-N01', 'CN-N40', 'CN-KM-WP08']);
	ot('weekday-daily-4h', ['daily limit exceeded, still paid'], { weekdayHours: 4, maxDailyWeekdayHours: 4 }, ['CN-N01', 'CN-N40', 'CN-KM-WP08']);
	ot('rest-8h', ['rest day 200%'], { restDayHours: 8 });
	ot('rest-8h-comp', ['rest day with compensatory rest: no premium'], { restDayHours: 8, restDayCompensatoryRest: true }, ['CN-N01', 'CN-N40', 'CN-KM-WP08']);
	ot('holiday-8h', ['statutory holiday 300%'], { holidayHours: 8 });
	ot('mixed', ['weekday + rest + holiday'], { weekdayHours: 10, maxDailyWeekdayHours: 2, restDayHours: 8, holidayHours: 8 });

	// ---- statutory leave (paid, no deduction) and over-grant refusals
	const lv = (tag: string, rows: string[], code: string, calendarDays: number, childrenUnder3?: number) =>
		add(`leave-${tag}`, [...rows, 'CN-KM-WP12'], [code, `${calendarDays} calendar days`], `${code} ${calendarDays} days`, [SRC.yunnanFp],
			{ employment: { monthlyWage: 21750 }, time: { leave: { code, calendarDays, childrenUnder3 } } });
	lv('marriage-18', ['CN-KM30', 'CN-N51'], 'MARRIAGE_LEAVE', 18);
	lv('marriage-19', ['CN-KM30', 'CN-N51'], 'MARRIAGE_LEAVE', 19);
	lv('childcare-10-one', ['CN-KM12'], 'CHILDCARE_LEAVE', 10, 1);
	lv('childcare-11-one', ['CN-KM12'], 'CHILDCARE_LEAVE', 11, 1);
	lv('childcare-11-two', ['CN-KM12'], 'CHILDCARE_LEAVE', 11, 2);
	lv('childcare-15-two', ['CN-KM12'], 'CHILDCARE_LEAVE', 15, 2);
	lv('childcare-16-two', ['CN-KM12'], 'CHILDCARE_LEAVE', 16, 2);
	lv('childcare-child-3', ['CN-KM12'], 'CHILDCARE_LEAVE', 1, 0);
	lv('funeral-3', ['CN-N51'], 'FUNERAL_LEAVE', 3);
	lv('funeral-4', ['CN-N51'], 'FUNERAL_LEAVE', 4);
	lv('iud-7', ['CN-KM31'], 'FAMILY_PLANNING_PROCEDURE_LEAVE', 7);
	lv('iud-8', ['CN-KM31'], 'FAMILY_PLANNING_PROCEDURE_LEAVE', 8);
	lv('work-injury-5', ['CN-KM-WP13', 'CN-N21'], 'WORK_INJURY_LEAVE', 5);
	for (const allowance of [9000, 12000, 15000])
		add(`maternity-${allowance}`, ['CN-KM32', 'CN-N20', 'CN-KM-WP12'], ['maternity allowance offset, employer top-up'],
			`Maternity month: ${allowance} fund allowance on 12,000`, [SRC.maternity],
			{ employee: { birthDate: '1994-02-11' }, employment: { monthlyWage: 12000 }, time: { leave: { code: 'MATERNITY_LEAVE', calendarDays: 31 } }, pay: { maternityAllowance: allowance } });

	// ---- severance (January 2026 exits, declared local average 10,847.83 → 3× cap 32,543.49)
	const sev = (tag: string, rows: string[], branches: string[], hireDate: string, exitDate: string, exit: Partial<NonNullable<Scenario['exit']>>, monthlyWage = 20000) =>
		add(`sev-${tag}`, ['CN-N41', 'CN-N12', 'CN-N19', 'CN-N39', ...rows], branches, `Exit ${tag}`, [SRC.lcl, SRC.sev],
			{ employment: { hireDate, exitDate, monthlyWage }, exit: { cause: 'MUTUAL_EMPLOYER', ...exit } });
	sev('5m', [], ['under 6 months: half a month'], '2025-08-16', '2026-01-15', {});
	sev('5m29d', [], ['5 months + days: half a month'], '2025-07-17', '2026-01-15', {});
	sev('6m', [], ['6 months: one month'], '2025-07-16', '2026-01-15', {});
	sev('1y', [], ['one full year'], '2025-01-16', '2026-01-15', {});
	sev('1y1d', [], ['one year and a day: 1.5'], '2025-01-15', '2026-01-15', {});
	sev('1y5m', [], ['1y5m: 1.5'], '2024-08-16', '2026-01-15', {});
	sev('1y6m', [], ['1y6m: 2'], '2024-07-16', '2026-01-15', {});
	sev('6y6m', [], ['6y6m: 7'], '2019-07-16', '2026-01-15', {});
	for (const wage of plusMinus(32543.49))
		sev(`cap-seam-${wage}`, [], ['3× average cap seam'], '2019-07-16', '2026-01-15', {}, wage);
	sev('12y-capped', [], ['3× cap, 12 years'], '2014-01-16', '2026-01-15', {}, 40000);
	sev('13y-capped', [], ['3× cap limits years to 12'], '2013-01-16', '2026-01-15', {}, 40000);
	sev('13y-uncapped', [], ['13 years below the cap'], '2013-01-16', '2026-01-15', {});
	sev('unlawful-13y-capped', [], ['art.87 2N', 'IIT_SEVERANCE on the excess'], '2013-01-16', '2026-01-15', { cause: 'UNLAWFUL' }, 40000);
	sev('unlawful-6y6m', [], ['art.87 2N'], '2019-07-16', '2026-01-15', { cause: 'UNLAWFUL' });
	sev('art40-no-notice', [], ['art.40 month in lieu'], '2019-07-16', '2026-01-15', { cause: 'ART40', noticeDaysGiven: 0 });
	sev('art40-29-days', [], ['art.40 29 days: month in lieu'], '2019-07-16', '2026-01-15', { cause: 'ART40', noticeDaysGiven: 29 });
	sev('art40-30-days', [], ['art.40 30 days: no month in lieu'], '2019-07-16', '2026-01-15', { cause: 'ART40', noticeDaysGiven: 30 });
	sev('art41', [], ['art.41 redundancy'], '2019-07-16', '2026-01-15', { cause: 'ART41' });
	sev('expiry', [], ['fixed-term expiry, no renewal offer'], '2023-01-16', '2026-01-15', { cause: 'EXPIRY' });
	sev('expiry-refused', [], ['expiry, equal renewal refused: none'], '2023-01-16', '2026-01-15', { cause: 'EXPIRY', renewalOfferRefused: true });
	sev('resignation', [], ['art.37 resignation: none'], '2019-07-16', '2026-01-15', { cause: 'RESIGNATION' });
	sev('misconduct', [], ['art.39: none'], '2019-07-16', '2026-01-15', { cause: 'MISCONDUCT' });
	sev('hired-exit-month', ['CN-SH-A2'], ['hired in the exit month: contract wage average'], '2026-01-05', '2026-01-20', { cause: 'ART40', noticeDaysGiven: 0 });
	sev('exit-27-no-warning', ['CN-KM-WP06'], ['final pay due 3 Feb: no warning'], '2019-07-16', '2026-01-27', {});
	add('sev-part-time', ['CN-N27', 'CN-N41'], ['part-time: no compensation'], 'Part-time worker let go', [SRC.lcl],
		{ employment: { hireDate: '2026-01-01', exitDate: '2026-01-15', monthlyWage: 0, partTime: { hourlyRate: 25, hours: 40 } }, facts: { fundRate: null }, exit: { cause: 'MUTUAL_EMPLOYER' } });

	// ---- annual-leave cash on exit (March 2026, three months cumulative)
	for (const [prior, tier] of [[0, 5], [60, 10], [180, 15]] as const)
		for (const exitDate of ['2026-03-13', '2026-03-31'])
			add(`leave-cash-${tier}-${exitDate}`, ['CN-N05', 'CN-N06', 'CN-N18', 'CN-KM-WP06'], [`${tier}-day tier`, `exit ${exitDate}`],
				`Leaver on ${exitDate}, ${tier}-day entitlement, none taken`, [SRC.leave],
				{ period: '2026-03', runsFrom: '2026-01', employee: { priorServiceMonths: prior }, employment: { hireDate: '2020-03-02', exitDate, monthlyWage: 21750 }, exit: { cause: 'RESIGNATION' } });
	add('leave-cash-taken-1', ['CN-N18'], ['one day already taken'], '15-day tier, 31 Mar exit, one day taken', [SRC.leave],
		{ period: '2026-03', runsFrom: '2026-01', employee: { priorServiceMonths: 180 }, employment: { hireDate: '2020-03-02', exitDate: '2026-03-31', monthlyWage: 21750 }, exit: { cause: 'RESIGNATION', leaveTakenThisYear: 1 } });
	add('leave-cash-over-taken', ['CN-N18'], ['more taken than earned: no clawback'], '5-day tier, 31 Mar exit, 4 taken', [SRC.leave],
		{ period: '2026-03', runsFrom: '2026-01', employment: { hireDate: '2020-03-02', exitDate: '2026-03-31', monthlyWage: 21750 }, exit: { cause: 'RESIGNATION', leaveTakenThisYear: 4 } });

	// ---- ages and retirement status (hired 1 Jan 2026)
	for (const [birthDate, branch] of [
		['2010-01-02', 'age 15 (one day short of 16) refused'],
		['2010-06-01', 'age 15 refused'],
		['2010-01-01', 'age 16 exactly'],
		['2009-01-01', 'age 17'],
		['2008-01-01', 'age 18'],
		['1966-01-02', 'age 59, not a pensioner'],
		['1966-01-01', 'age 60, not a pensioner'],
		['1965-01-01', 'age 61, not a pensioner']
	])
		add(`age-${birthDate}`, ['CN-N29', 'CN-N13', 'CN-KM28'], [branch], `Worker born ${birthDate}`, [SRC.county], { employee: { birthDate } });
	add('pensioner-jan', ['CN-N13', 'CN-KM18'], ['pension recipient: outside SI and fund'], 'Re-employed pensioner, January 2026', [SRC.county],
		{ employee: { birthDate: '1962-04-01', pensionRecipient: true } });
	add('pensioner-sep', ['CN-N13', 'CN-N14'], ['pension recipient after Order 56: injury unpriced'], 'Re-employed pensioner, September 2026', [SRC.county],
		{ period: '2026-09', employee: { birthDate: '1962-04-01', pensionRecipient: true } });

	// ---- seeded in-bounds spread (deterministic)
	for (let i = 0; i < 12; i++) {
		const period = ['2025-12', '2026-01', '2026-09'][i % 3]!;
		const region = (['I', 'II', 'III'] as const)[Math.floor(i / 4) % 3];
		const wage = fen(2400 + rand() * 30000);
		add(`spread-${i}`, [...SI_ROWS, 'CN-KM05', 'CN-KM20', 'CN-N09'], ['in-bounds spread', `class ${region}`], `Wage ${wage} in ${period}`, [SRC.siBase, SRC.fund, SRC.iit],
			{ period, employment: { monthlyWage: wage, wageRegion: region, worksite: WORKSITE[region] }, facts: { fundRate: [0.05, 0.08, 0.12][i % 3]!, injuryRate: 0.004 } });
	}
	return out;
}

let built: Scenario[] | undefined;
export function generateProfiles(): Scenario[] {
	if (built === undefined) {
		seed = 0x6b6d_2026;
		n = 0;
		out.length = 0;
		built = build();
	}
	return built;
}
