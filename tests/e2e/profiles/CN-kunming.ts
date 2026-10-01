/**
 * Deterministic CN-kunming scenario generator: synthetic employees across every payslip-affecting branch in
 * `docs/inventory/china.csv` (CN and CN-kunming rows, branch-level ids), each tagged with the tracker row ids and branch
 * names it exercises. Expected payslips come from `tests/e2e/oracle/CN-kunming.ts`, which reads the law, not the engine.
 *
 * Shape → probe harness (`tests/e2e/payroll-probe.ts` `ProbeCase`): `id`, `profile` (the company's `settings_code`),
 * `description`, `citation` and `period` carry over; `employee`/`employment`/`facts`/`contract`/`tax`/`time`/`pay`/`exit`
 * are the rows to create through `/act` (employees, employments with terms and fact rows, leave / overtime / ad hoc
 * rows, exit facts); `computePayslip(s).lines` is `expected[0].lines`, `warnings` the run's warnings, and a
 * `refused.stage` of `input` / `run` maps to an input's `refused` / the case's `refused`. A resident's IIT is cumulative,
 * so every month from `runsFrom` to `period` is run in order; only `period` is judged. Keys in `unpriced` are not
 * judged.
 */
import { employeeShares } from '../oracle/CN-kunming.ts';

export type Region = 'I' | 'II' | 'III';
type Scheme = 'PENSION' | 'MEDICAL' | 'MATERNITY' | 'UNEMPLOYMENT' | 'INJURY';
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
		/** null = not recorded */
		taxResident: boolean | null;
		pensionRecipient?: boolean;
		/** verified service at earlier employers (annual-leave band) */
		priorServiceMonths?: number;
		/** non-resident: China workdays this month (a day under 24 hours counts half) */
		chinaWorkDays?: number;
	};
	employment: {
		hireDate: string;
		exitDate: string | null;
		monthlyWage: number;
		raise?: { from: string; monthlyWage: number };
		partTime?: { hourlyRate: number; hours: number };
		wageRegion: Region;
		/** a higher employer-registration-place standard the parties agreed */
		agreedRegion?: Region;
		/** the period falls inside probation, paid at this monthly wage */
		probationWage?: number;
		worksite: string;
	};
	facts: {
		/** declared SI base; default the monthly wage */
		siBase?: number;
		siRegistered: boolean;
		siWaiverSigned?: boolean;
		treatyExempt?: Scheme[];
		/** equal unit/worker fund rate; null = not in the fund */
		fundRate: number | null;
		fundAccount: 'FIRST_EVER' | 'TRANSFERRED' | 'EXISTING';
		/** existing account: declared prior-calendar-year monthly average */
		fundBase?: number;
		/** recorded injury class rate (or its assigned float) */
		injuryRate: number;
		/** declared unemployment rates for January–August 2026 (no sourced instrument) */
		unemploymentRates?: { employer: number; employee: number };
	};
	/** contract-formation claims settled in `period` */
	contract?: {
		/** written contract signed on (null: never); omitted = signed at hire */
		signedDate?: string | null;
		openEndedDueDate?: string;
		openEndedConcludedDate?: string | null;
		probation?: { termMonths: number | null; servedMonths: number; partTime?: boolean };
	};
	tax: {
		basic60kElection?: boolean;
		firstIncomeThisYear?: boolean;
		/** a declared monthly special-additional-deduction total */
		specialDeductionsMonthly?: number;
		special?: {
			from?: string;
			children?: number;
			infants?: number;
			childShare?: 0.5 | 1;
			elderlyOnlyChild?: boolean;
			elderlyShare?: number;
			continuingEducation?: 'DEGREE' | 'CERTIFICATE';
			rent?: boolean;
			loanInterest?: boolean;
		};
		personalPensionMonthly?: number;
		commercialHealthMonthly?: number;
	};
	time: {
		unpaidDays?: number;
		stoppageDays?: number;
		nightHours?: number;
		overtime?: {
			weekdayHours?: number;
			maxDailyWeekdayHours?: number;
			restDayHours?: number;
			restDayCompensatoryRest?: boolean;
			holidayHours?: number;
		};
		leave?: {
			code: string;
			calendarDays: number;
			childrenUnder3?: number;
			procedure?: string;
			difficultBirth?: boolean;
			extraInfants?: number;
			miscarriageMonths?: number;
		};
	};
	pay: {
		bonus?: {
			kind: 'BONUS' | 'ANNUAL_BONUS_SEPARATE' | 'MULTI_MONTH_NONRESIDENT';
			amount: number;
			usedThisYear?: boolean;
		};
		/** an ordinary bonus paid in an earlier run month */
		priorBonus?: { period: string; amount: number };
		/** agency maternity allowance for this month's leave */
		maternity?: { allowance: number; paidTo: 'EMPLOYER' | 'WORKER'; infants?: number };
		heatDays?: number;
		subsidies?: { code: string; amount: number; qualifying: boolean }[];
		earlyRetirement?: { amount: number; yearsToStatutoryAge: number };
		internalRetirement?: { amount: number; monthsToStatutoryAge: number };
		courtOrder?: number;
		lossClaim?: number;
	};
	exit?: {
		cause:
			| 'RESIGNATION'
			| 'MISCONDUCT'
			| 'MUTUAL_EMPLOYER'
			| 'ART40'
			| 'ART41'
			| 'EXPIRY'
			| 'UNLAWFUL'
			| 'RETIREMENT';
		noticeDaysGiven?: number;
		renewalOfferRefused?: boolean;
		/** declared local prior-year average monthly wage (LCL art.47 cap; 164号 exemption) */
		localAverageMonthlyWage: number;
		leaveTakenThisYear?: number;
		pre2008Compensation?: number;
		transferredServiceMonths?: number;
	};
};

type Patch = {
	[K in keyof Scenario]?: Scenario[K] extends object ? Partial<Scenario[K]> : Scenario[K];
};

// mulberry32 — seeded, deterministic
let seed = 0x6b6d_2026;
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const SURNAMES = [
	'Li',
	'Wang',
	'Zhang',
	'Liu',
	'Chen',
	'Yang',
	'Zhao',
	'Huang',
	'Zhou',
	'Wu',
	'Xu',
	'Sun'
];
const GIVEN = [
	'Wei',
	'Fang',
	'Na',
	'Min',
	'Jing',
	'Lei',
	'Yan',
	'Jun',
	'Tao',
	'Hui',
	'Ming',
	'Xia'
];
const name = () =>
	`${SURNAMES[Math.floor(rand() * SURNAMES.length)]} ${GIVEN[Math.floor(rand() * GIVEN.length)]}`;
const WORKSITE: Record<Region, string> = { I: 'Wuhua District', II: 'Fumin County', III: 'Mo Han' };
const LOCAL_AVG = 10847.83; // declared exit fact: the tracker's Kunming lcl47 figure (CN-N39 golden)
const fen = (x: number) => Math.round(x * 100 + 1e-7) / 100;

const SRC = {
	minWage2025:
		'云人社发〔2025〕19号, https://www.ynjc.gov.cn/u/cms/jcqzfxxgk/202509/30130601xbad.pdf',
	minWage2026:
		'Yunnan HRSS notice 29 Aug 2026, https://www.ynjc.gov.cn/jcqzfxxgk/zcw2023j0221/20260901/1677677.html',
	siBase:
		'云人社发〔2026〕8号, https://www.dhlc.gov.cn/fsx/Web/_F0_0_6C9DO9USE71563368BE04C9C90.htm',
	county: '7 Sep 2026 county HRSS notice, https://www.yncxym.gov.cn/info/1011/286437.htm',
	unemp: '2025 HRSS unemployment notice, https://www.hhpb.gov.cn/info/5861/518871.htm',
	medical:
		'Kunming Social Medical Insurance Regulation, https://www.kmrd.gov.cn/c/2022-04-14/524108.shtml',
	maternity: 'Kunming maternity rules 2024, https://ybj.km.gov.cn/c/2024-07-25/4882692.shtml',
	injury:
		'云人社发〔2020〕14号 / Yunnan injury measure, https://yjglt.yn.gov.cn/html/2024/yunnanshengwenjian_0507/28616.html',
	fund: '昆公积金〔2026〕69号 / 昆公积金规〔2020〕2号, https://zc.51shebao.com/detail/838183',
	iit: 'STA 2018 No.61, https://fgk.chinatax.gov.cn/zcfgk/c100009/c5193028/content.html',
	bonus: 'MOF/STA 2023 No.30, https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211524/content.html',
	nonres: 'MOF/STA 2019 No.35, https://fgk.chinatax.gov.cn/zcfgk/c102416/c5202332/content.html',
	election: 'STA 2020 No.19, https://fgk.chinatax.gov.cn/zcfgk/c100012/c5194953/content.html',
	special:
		'STA special additional deductions, https://shanghai.chinatax.gov.cn/zcfw/zcjd/202311/P020231128530973219615.pdf',
	rent: '国发〔2018〕41号, https://fgk.chinatax.gov.cn/zcfgk/c100012/c5213592/content.html',
	exempt: '国税发〔1994〕89号, https://fgk.chinatax.gov.cn/zcfgk/c100011/c5216297/content.html',
	pension: 'MOF/STA 2024 No.21, https://www.gov.cn/zhengce/zhengceku/202412/content_6992498.htm',
	labour:
		'Labour Law arts.36–44, https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html',
	days: '人社部发〔2025〕2号, https://www.mohrss.gov.cn/SYrlzyhshbzb/laodongguanxi_/zcwj/202501/t20250101_533693.html',
	holidays:
		'国办发明电〔2025〕7号, https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm',
	wagePayNat:
		'劳部发〔1994〕489号, https://www.mohrss.gov.cn/xxgk2020/gzk/gz/202112/t20211228_431557.html',
	lcl: 'Labour Contract Law, https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html',
	lclReg: 'LCL Implementing Regulation, https://xzfg.moj.gov.cn/front/law/detail?LawID=284',
	sev: '财税〔2018〕164号 item 5, http://szs.mof.gov.cn/zhengcefabu/201812/t20181227_3110164.htm',
	leave: 'Paid Annual Leave Regulation, https://xzfg.moj.gov.cn/front/law/detail?LawID=208',
	female:
		'Female Workers Special Protection Regulation, https://xzfg.moj.gov.cn/mobile/law/detail?LawID=343',
	yunnanFp:
		'Yunnan Population and Family Planning Regulation 2022, https://www.ynrd.gov.cn/html/2022/changweihuigonggao_0118/16355.html',
	yunnanWomen:
		'Yunnan Government Order 232, https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=105672',
	injuryReg: 'Work Injury Insurance Regulation, https://xzfg.moj.gov.cn/front/law/detail?LawID=610',
	wagePay: '昆明市工资支付条例, https://www.kmrd.gov.cn/c/2019-06-18/514716.shtml',
	heat: 'Heatstroke Prevention Measure art.17, https://www.nhc.gov.cn/zhjcj/c100093/201207/2cdae24e57d04213944bcc6ef736a69b.shtml',
	child: '禁止使用童工规定, https://www.gov.cn/gongbao/content/2020/content_5469641.htm',
	overAge: 'Order 56, https://www.gov.cn/gongbao/2026/issue_12786/202606/content_7071610.html',
	hmt: '人社部 国家医保局令第41号, https://www.gov.cn/zhengce/zhengceku/2019-11/29/content_5562340.htm',
	foreign: 'Social Insurance Law art.97, https://www.gov.cn/zhengce/2022-08/31/content_5711314.htm'
};

const out: Scenario[] = [];
let n = 0;
function add(
	tag: string,
	rows: string[],
	branches: string[],
	description: string,
	citation: string[],
	p: Patch
) {
	const period = p.period ?? '2026-01';
	const hireDate = p.employment?.hireDate ?? `${period}-01`;
	const resident = p.employee?.taxResident ?? true;
	const hireMonth = hireDate.slice(0, 7);
	const yearStart = `${period.slice(0, 4)}-01`;
	// cumulative IIT needs the whole year at this unit; a non-resident is monthly
	const runsFrom =
		p.runsFrom ?? (resident ? (hireMonth > yearStart ? hireMonth : yearStart) : period);
	const s: Scenario = {
		id: `CN-KM-O-${String(++n).padStart(3, '0')}-${tag}`,
		profile: 'CN-kunming',
		description,
		citation,
		rows,
		branches,
		period,
		runsFrom,
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
			fundAccount: hireMonth === period ? 'TRANSFERRED' : 'EXISTING',
			injuryRate: 0.002,
			unemploymentRates: { employer: 0.007, employee: 0.003 },
			...p.facts
		},
		...(p.contract ? { contract: p.contract } : {}),
		tax: { ...p.tax },
		time: { ...p.time },
		pay: { ...p.pay },
		...(p.exit
			? { exit: { localAverageMonthlyWage: LOCAL_AVG, ...p.exit } as Scenario['exit'] }
			: {})
	};
	out.push(s);
	return s;
}
const plusMinus = (x: number) => [fen(x - 0.01), x, fen(x + 0.01)];
const SI_2026 = [
	'CN-KM03.piu-floor-2026',
	'CN-KM03.piu-ceiling-2026',
	'CN-KM03.medical-floor-to-aug-2026',
	'CN-KM03.medical-ceiling-to-aug-2026'
];
const SI_RATES = [
	'CN-KM25.unit-covered-16-8',
	'CN-KM04.employer-7pct',
	'CN-KM04.employee-2pct',
	'CN-KM32.employer-premium-0-9',
	'CN-KM26.recorded-class-rate',
	'CN-X-SI-ROUNDING.social-insurance-fen',
	'CN-N07.pension',
	'CN-N07.medical',
	'CN-N07.unemployment',
	'CN-N07.work-injury',
	'CN-N07.maternity',
	'CN-KM-WP09.tax-and-si-withholding',
	'CN-X-WORKSITE.si-follows-employment'
];
const siRowsFor = (period: string) => [
	...SI_RATES,
	...(period < '2026-01'
		? [
				'CN-KM03.piu-floor-2025',
				'CN-KM03.piu-ceiling-2025',
				'CN-KM03.medical-floor-to-aug-2026',
				'CN-KM03.medical-ceiling-to-aug-2026',
				'CN-KM27.reduced-2025'
			]
		: period < '2026-09'
			? [...SI_2026, 'CN-KM27.rate-jan-aug-2026']
			: [
					'CN-KM03.piu-floor-2026',
					'CN-KM03.piu-ceiling-2026',
					'CN-KM03.medical-floor-from-sep-2026',
					'CN-KM03.medical-ceiling-from-sep-2026',
					'CN-KM27.rate-from-sep-2026'
				])
];
const FLOOR_ROW: Record<string, Record<Region, string>> = {
	'2025': { I: 'CN-KM01.class-i-2170', II: 'CN-KM01.class-ii-2020', III: 'CN-KM01.mo-han-1870' },
	'2026': { I: 'CN-KM02.class-i-2270', II: 'CN-KM02.class-ii-2120', III: 'CN-KM02.mo-han-1970' }
};
const floorRow = (period: string, r: Region) => FLOOR_ROW[period < '2026-09' ? '2025' : '2026']![r];
const FUND_FLOOR_ROW = (period: string, r: Region) =>
	`CN-KM05.new-account-floor-class-${r.toLowerCase()}-${period < '2026-09' ? '2025' : '2026'}`;
const nonres = { citizenship: 'FOREIGN' as const, taxResident: false };

function build() {
	// ---- monthly minimum wage at every floor ±1 cent, each class, each dated table
	for (const period of ['2025-12', '2026-09'])
		for (const [region, floor] of Object.entries(
			period < '2026-09' ? { I: 2170, II: 2020, III: 1870 } : { I: 2270, II: 2120, III: 1970 }
		) as [Region, number][])
			for (const wage of plusMinus(floor))
				add(
					`minwage-${period}-${region}-${wage}`,
					[
						floorRow(period, region),
						period < '2026-09' ? 'CN-KM01.qualifying-pay' : 'CN-KM02.qualifying-pay',
						'CN-KM-WP03.minimum-wage-floor',
						'CN-KM-WP03.full-wage-due',
						'CN-N50.floor-test',
						'CN-X-WORKSITE.performance-place-standard',
						FUND_FLOOR_ROW(period, region)
					],
					[
						`class ${region}`,
						wage < floor
							? 'below floor refused'
							: wage === floor
								? 'at floor (net below it: shares count)'
								: 'one cent above'
					],
					`Class ${region} worker at ${wage} in ${period} (floor ${floor})`,
					[period < '2026-09' ? SRC.minWage2025 : SRC.minWage2026],
					{
						period,
						employment: { monthlyWage: wage, wageRegion: region, worksite: WORKSITE[region] }
					}
				);
	add(
		'minwage-2170-in-aug',
		['CN-KM01.class-i-2170', 'CN-KM-WP03.minimum-wage-floor', 'CN-N50.floor-test'],
		['last month of the 2025 table'],
		'2,170 in Wuhua in August 2026 is lawful',
		[SRC.minWage2025],
		{ period: '2026-08', employment: { monthlyWage: 2170 } }
	);
	add(
		'minwage-2170-in-sep',
		['CN-KM02.class-i-2270', 'CN-KM-WP03.minimum-wage-floor', 'CN-N50.floor-test'],
		['old floor blocked after 1 Sep 2026'],
		'2,170 in Wuhua in September 2026 is below the new 2,270',
		[SRC.minWage2026],
		{ period: '2026-09', employment: { monthlyWage: 2170 } }
	);
	add(
		'minwage-overtime-excluded',
		['CN-N50.excluded-components', 'CN-KM01.qualifying-pay', 'CN-N50.floor-test'],
		['overtime cannot lift pay over the floor'],
		'2,100 contract wage plus overtime is still below the 2,170 floor',
		[SRC.minWage2025],
		{
			employment: { monthlyWage: 2100 },
			time: { overtime: { weekdayHours: 10, maxDailyWeekdayHours: 2 } }
		}
	);
	add(
		'minwage-agreed-higher-standard',
		['CN-X-WORKSITE.higher-agreed-employer-standard'],
		['class II worksite, agreed class I standard'],
		'Fumin worksite at 2,100 with an agreed class I standard: refused',
		[SRC.lclReg],
		{
			employment: { monthlyWage: 2100, wageRegion: 'II', worksite: WORKSITE.II, agreedRegion: 'I' }
		}
	);

	// ---- part-time hourly floors (LCL art.72) ±1 cent
	for (const period of ['2026-08', '2026-09'])
		for (const [region, floor] of Object.entries(
			period < '2026-09' ? { I: 21, II: 20, III: 19 } : { I: 22, II: 21, III: 20 }
		) as [Region, number][])
			for (const rate of plusMinus(floor))
				add(
					`parttime-${period}-${region}-${rate}`,
					[
						period < '2026-09' ? 'CN-KM01.hourly-floors' : 'CN-KM02.hourly-floors',
						'CN-N27.hourly-minimum',
						'CN-N27.injury-cover',
						'CN-KM14.all-employees-employer-only',
						'CN-N50.piece-rate-and-hourly'
					],
					[
						'part-time',
						`hourly class ${region}`,
						rate < floor ? 'below hourly floor refused' : 'at/above hourly floor'
					],
					`Part-time ${region} worker, 80 h at ${rate}/h in ${period}`,
					[period < '2026-09' ? SRC.minWage2025 : SRC.minWage2026, SRC.lcl],
					{
						period,
						employment: {
							monthlyWage: 0,
							partTime: { hourlyRate: rate, hours: 80 },
							wageRegion: region,
							worksite: WORKSITE[region]
						},
						facts: { fundRate: null }
					}
				);

	// ---- social-insurance bases at every floor/ceiling ±1 cent, three dated windows
	for (const period of ['2025-12', '2026-01', '2026-09'])
		for (const seam of [4357, 4403, 21789, 22017])
			for (const wage of plusMinus(seam))
				add(
					`si-${period}-${wage}`,
					siRowsFor(period),
					[`SI base seam ${seam}`, period],
					`SI base ${wage} in ${period}`,
					[SRC.siBase, SRC.county, SRC.medical, SRC.maternity],
					{ period, employment: { monthlyWage: wage } }
				);

	// ---- housing-fund floors (each class) and caps ±1 cent; existing accounts, declared base
	for (const period of ['2025-12', '2026-01', '2026-09']) {
		const floors =
			period < '2026-09' ? { I: 2170, II: 2020, III: 1870 } : { I: 2270, II: 2120, III: 1970 };
		const cap = period < '2026-01' ? 32470 : 32543;
		// December 2025: a resident would need all of 2025 (before the sourced tables), so a non-resident in the fund
		const who = period === '2025-12' ? nonres : {};
		for (const [region, floor] of Object.entries(floors) as [Region, number][])
			for (const base of plusMinus(floor))
				add(
					`hf-floor-${period}-${region}-${base}`,
					[
						FUND_FLOOR_ROW(period, region),
						'CN-KM05.existing-account-floor',
						'CN-KM20.existing-worker-base',
						'CN-N08.existing-worker-base',
						'CN-KM05.per-side-rounding',
						'CN-KM20.per-side-rounding',
						'CN-X-SI-ROUNDING.housing-fund-yuan'
					],
					[`fund floor class ${region}`, 'existing account'],
					`Existing account declared base ${base} in ${period}`,
					[SRC.fund],
					{
						period,
						employee: who,
						employment: {
							hireDate: '2020-03-02',
							monthlyWage: 6000,
							wageRegion: region,
							worksite: WORKSITE[region]
						},
						facts: { fundAccount: 'EXISTING', fundBase: base }
					}
				);
		for (const base of plusMinus(cap))
			add(
				`hf-cap-${period}-${base}`,
				[
					period < '2026-01' ? 'CN-KM05.ceiling-2025' : 'CN-KM05.ceiling-2026',
					'CN-KM05.rate-5-12',
					'CN-KM20.uniform-unit-rate',
					'CN-N08.contribution-ratio',
					'CN-N43.housing-fund-exemption',
					...(period === '2026-01' ? ['CN-KM05.cap-true-up-2026'] : [])
				],
				['fund cap', '12%'],
				`Existing account declared base ${base} at 12% in ${period}`,
				[SRC.fund],
				{
					period,
					employee: who,
					employment: { hireDate: '2020-03-02', monthlyWage: 40000 },
					facts: { fundAccount: 'EXISTING', fundBase: base, fundRate: 0.12 }
				}
			);
	}
	for (const [rate, wage, branch] of [
		[0.05, 2290, 'half-up 114.5 → 115'],
		[0.05, 2289.99, '114.4995 → 114'],
		[0.07, 10000, 'mid rate'],
		[0.12, 21750, '12% maximum'],
		[0.04, 10000, 'below 5% refused'],
		[0.13, 10000, 'above 12% refused']
	] as [number, number, string][])
		add(
			`hf-rate-${rate}-${wage}`,
			[
				'CN-KM05.rate-5-12',
				'CN-KM20.uniform-unit-rate',
				'CN-KM05.per-side-rounding',
				'CN-KM20.per-side-rounding',
				'CN-X-SI-ROUNDING.housing-fund-yuan',
				...(rate < 0.05 ? ['CN-KM21.eligibility-and-approvals'] : [])
			],
			[branch],
			`Fund at ${rate * 100}% on ${wage}`,
			[SRC.fund],
			{ employment: { monthlyWage: wage }, facts: { fundRate: rate } }
		);
	add(
		'hf-first-ever-joining',
		['CN-KM20.first-ever-joining-month', 'CN-N08.first-ever-second-month'],
		['first-ever account: joining month nothing'],
		'First-ever account hired 15 Jan 2026: no fund in January',
		[SRC.fund],
		{
			employment: { hireDate: '2026-01-15', monthlyWage: 21750 },
			facts: { fundAccount: 'FIRST_EVER', fundRate: 0.12 }
		}
	);
	add(
		'hf-first-ever-second',
		['CN-KM20.first-ever-second-month', 'CN-N08.first-ever-second-month'],
		['first-ever account: second month full wage'],
		'First-ever account hired 15 Jan 2026: February charges 12% of 21,750',
		[SRC.fund],
		{
			period: '2026-02',
			employment: { hireDate: '2026-01-15', monthlyWage: 21750 },
			facts: { fundAccount: 'FIRST_EVER', fundRate: 0.12 }
		}
	);
	add(
		'hf-transferred-part-month',
		['CN-KM20.transferred-first-month', 'CN-N08.transferred-first-month'],
		['transferred account: first month full wage'],
		'Transferred account hired 15 Jan 2026 pays on the full monthly wage',
		[SRC.fund],
		{
			employment: { hireDate: '2026-01-15', monthlyWage: 9000 },
			facts: { fundAccount: 'TRANSFERRED' }
		}
	);

	// ---- injury classes I–VIII and an assigned float
	[0.002, 0.004, 0.007, 0.009, 0.011, 0.013, 0.016, 0.019].forEach((rate, i) =>
		add(
			`injury-class-${i + 1}`,
			['CN-KM26.recorded-class-rate', 'CN-N07.work-injury', 'CN-KM14.registration-and-rates'],
			[`industry class ${i + 1}`],
			`Injury class ${i + 1} at ${rate * 100}%`,
			[SRC.injury],
			{ facts: { injuryRate: rate } }
		)
	);
	add(
		'injury-float',
		['CN-KM26.assigned-float'],
		['class I floated up 50%'],
		'Assigned floating injury rate 0.3%',
		[SRC.injury],
		{ facts: { injuryRate: 0.003 } }
	);

	// ---- unemployment windows
	add(
		'unemp-2025-12',
		['CN-KM27.reduced-2025'],
		['2025 notice 0.7/0.3'],
		'December 2025 unemployment 0.7/0.3',
		[SRC.unemp],
		{ period: '2025-12' }
	);
	add(
		'unemp-2026-01-declared-reduced',
		['CN-KM27.rate-jan-aug-2026'],
		['Jan–Aug 2026 declared 0.7/0.3'],
		'January 2026, declared reduced rates',
		[SRC.county],
		{}
	);
	add(
		'unemp-2026-01-declared-full',
		['CN-KM27.rate-jan-aug-2026'],
		['Jan–Aug 2026 declared 2/1'],
		'January 2026, declared unreduced rates',
		[SRC.county],
		{ facts: { unemploymentRates: { employer: 0.02, employee: 0.01 } } }
	);
	add(
		'unemp-2026-01-undeclared',
		['CN-KM27.rate-jan-aug-2026'],
		['Jan–Aug 2026 no instrument, nothing declared'],
		'January 2026, no rate declared: unpriced',
		[SRC.county],
		{ facts: { unemploymentRates: undefined } }
	);
	add(
		'unemp-2026-09',
		['CN-KM27.rate-from-sep-2026', 'CN-KM25.unit-covered-16-8'],
		['7 Sep 2026 notice 0.7/0.3', 'county-notice floor example'],
		'September 2026 at the 4,403 floor',
		[SRC.county],
		{ period: '2026-09', employment: { monthlyWage: 4403 } }
	);

	// ---- citizenship / residence / registration
	add(
		'foreign-resident-no-fund',
		[
			'CN-N25.ordinary-social-insurance',
			'CN-N25.labour-standards',
			'CN-KM18.optional-participants'
		],
		['foreign resident', 'fund only by participation'],
		'Foreign resident insured, outside the fund',
		[SRC.foreign],
		{ employee: { citizenship: 'FOREIGN' }, facts: { fundRate: null } }
	);
	add(
		'foreign-resident-fund',
		['CN-N25.ordinary-social-insurance', 'CN-KM18.optional-participants'],
		['foreign resident', 'fund by participation'],
		'Foreign resident in the fund',
		[SRC.fund],
		{ employee: { citizenship: 'FOREIGN' } }
	);
	add(
		'foreign-treaty-exempt',
		['CN-N25.treaty-exemption'],
		['agreement certificate exempts pension and unemployment'],
		'Foreign worker with a bilateral certificate for pension and unemployment',
		[SRC.foreign],
		{
			employee: { citizenship: 'FOREIGN' },
			facts: { fundRate: null, treatyExempt: ['PENSION', 'UNEMPLOYMENT'] }
		}
	);
	add(
		'hmt-si-fund',
		['CN-N48', 'CN-KM18.optional-participants'],
		['HK/Macao/Taiwan', 'fund opt-in'],
		'Hong Kong resident on ordinary SI, in the fund',
		[SRC.hmt],
		{ employee: { citizenship: 'HMT' } }
	);
	add(
		'hmt-si-no-fund',
		['CN-N48', 'CN-KM18.optional-participants'],
		['HK/Macao/Taiwan', 'no fund'],
		'Taiwan resident on ordinary SI, outside the fund',
		[SRC.hmt],
		{ employee: { citizenship: 'HMT' }, facts: { fundRate: null } }
	);
	add(
		'unregistered',
		['CN-KM28.unenrolled-still-assessed', 'CN-N07.unregistered-still-assessed'],
		['not enrolled, still assessed'],
		'Unenrolled worker still assessed',
		[SRC.county],
		{ facts: { siRegistered: false } }
	);
	add(
		'si-waiver',
		['CN-N37.si-waiver-void', 'CN-KM28.no-excuse-grounds'],
		['signed waiver void'],
		'A signed "no social insurance" undertaking changes nothing',
		[SRC.county],
		{ facts: { siWaiverSigned: true } }
	);
	add(
		'residence-unrecorded',
		['CN-N09.tax-residence'],
		['tax residence not recorded: refused'],
		'No tax residence recorded',
		[SRC.iit],
		{ employee: { taxResident: null } }
	);
	add(
		'nonres-5000',
		['CN-N38.non-resident-monthly-table', 'CN-N09.non-resident-monthly'],
		['non-resident', 'no taxable income'],
		'Non-resident at 5,000: no IIT',
		[SRC.iit],
		{ employee: nonres, employment: { monthlyWage: 5000 }, facts: { fundRate: null } }
	);
	for (const seam of [3000, 12000, 25000, 35000, 55000, 80000])
		for (const t of [seam, fen(seam + 0.01)])
			add(
				`nonres-${t}`,
				[
					'CN-N38.non-resident-monthly-table',
					'CN-N09.non-resident-monthly',
					'CN-N09.tax-residence'
				],
				['non-resident monthly table', t === seam ? `seam ${seam}` : 'one cent above'],
				`Non-resident taxable ${t}`,
				[SRC.iit],
				{ employee: nonres, employment: { monthlyWage: fen(5000 + t) }, facts: { fundRate: null } }
			);
	for (const days of [31, 20, 10.5])
		add(
			`nonres-workdays-${days}`,
			['CN-N45.workday-apportionment'],
			[`${days} China workdays of 31`],
			`Non-resident 30,000 wage, ${days} China workdays in January`,
			[SRC.nonres],
			{
				employee: { ...nonres, chinaWorkDays: days },
				employment: { monthlyWage: 30000 },
				facts: { fundRate: null }
			}
		);

	// ---- resident cumulative table seams (January): special deductions absorb the fixed shares
	for (const seam of [36000, 144000, 300000, 420000, 660000, 960000])
		for (const target of [seam, fen(seam + 0.01)]) {
			const s = add(
				`iit-${target}`,
				['CN-N09.resident-cumulative', 'CN-N38.resident-annual-table', 'CN-N16.sharing-elections'],
				['resident cumulative table', target === seam ? `seam ${seam}` : 'one cent above'],
				`Resident January cumulative taxable ${target}`,
				[SRC.iit],
				{ employment: { hireDate: '2020-03-02', monthlyWage: seam + 20000 } }
			);
			s.tax.specialDeductionsMonthly = fen(
				s.employment.monthlyWage - employeeShares(s) - 5000 - target
			);
		}
	add(
		'iit-zero',
		['CN-N09.no-payroll-refund'],
		['taxable below zero withholds nothing'],
		'Resident at 5,000: nothing withheld',
		[SRC.iit],
		{ employment: { monthlyWage: 5000 } }
	);
	add(
		'iit-march-cumulative',
		['CN-N09.resident-cumulative'],
		['third cumulative month'],
		'Resident at 30,000 in March, run from January',
		[SRC.iit],
		{ period: '2026-03', employment: { hireDate: '2020-03-02', monthlyWage: 30000 } }
	);
	add(
		'iit-retro-deduction-no-refund',
		['CN-N09.no-payroll-refund', 'CN-N16.child-education'],
		['a February declaration covering January withholds nothing, no refund'],
		'8,000 wage; child education for two children declared from February only',
		[SRC.iit, SRC.special],
		{
			period: '2026-02',
			employment: { hireDate: '2020-03-02', monthlyWage: 8000 },
			tax: { special: { from: '2026-02', children: 2 } }
		}
	);
	add(
		'iit-60k-election',
		['CN-N11'],
		['60,000 election'],
		'60,000 election on a 10,000 January wage: nothing withheld',
		[SRC.election],
		{ employment: { hireDate: '2020-03-02' }, tax: { basic60kElection: true } }
	);
	add(
		'iit-no-election',
		['CN-N11', 'CN-N09.resident-cumulative'],
		['no election'],
		'Same without the election',
		[SRC.election],
		{ employment: { hireDate: '2020-03-02' } }
	);
	add(
		'iit-first-income-sep',
		['CN-N44.first-wage-mid-year'],
		['first wage income this year'],
		'September hire declaring first income: 45,000 deduction',
		[SRC.iit],
		{ period: '2026-09', employment: { monthlyWage: 30000 }, tax: { firstIncomeThisYear: true } }
	);
	add(
		'iit-no-first-income-sep',
		['CN-N44.first-wage-mid-year', 'CN-N09.resident-cumulative'],
		['no declaration'],
		'September hire without the declaration: 5,000',
		[SRC.iit],
		{ period: '2026-09', employment: { monthlyWage: 30000 } }
	);
	add(
		'iit-first-income-dec',
		['CN-N44.first-wage-mid-year'],
		['first wage income this year, December'],
		'December 2025 hire declaring first income: 60,000',
		[SRC.iit],
		{ period: '2025-12', employment: { monthlyWage: 30000 }, tax: { firstIncomeThisYear: true } }
	);
	// special additional deductions (structured)
	const sd = (
		tag: string,
		rows: string[],
		branch: string,
		special: NonNullable<Scenario['tax']['special']>,
		extra: Patch = {}
	) =>
		add(
			`iit-sd-${tag}`,
			['CN-N16.sharing-elections', ...rows],
			[branch],
			`Declared ${branch} on 20,000`,
			[SRC.special, SRC.rent],
			{ employment: { monthlyWage: 20000 }, ...extra, tax: { special, ...extra.tax } }
		);
	sd('rent', ['CN-N54.capital-city-1500', 'CN-N16.housing-rent'], 'rent 1,500', { rent: true });
	sd('loan', ['CN-N16.housing-loan-interest'], 'loan interest 1,000', { loanInterest: true });
	sd(
		'rent-and-loan',
		['CN-N54.rent-or-loan', 'CN-N16.housing-loan-interest', 'CN-N16.housing-rent'],
		'rent and loan interest refused',
		{ rent: true, loanInterest: true }
	);
	sd('child-1', ['CN-N16.child-education'], 'one child 2,000', { children: 1 });
	sd('child-half', ['CN-N16.child-education'], 'two children at 50% = 2,000', {
		children: 2,
		childShare: 0.5
	});
	sd('infant', ['CN-N16.infant-care'], 'infant care 2,000', { infants: 1 });
	sd('elder-only', ['CN-N16.elderly-support'], 'elderly support only child 3,000', {
		elderlyOnlyChild: true
	});
	sd('elder-share-1500', ['CN-N16.elderly-support'], 'elderly share 1,500', { elderlyShare: 1500 });
	sd('elder-share-1600', ['CN-N16.elderly-support'], 'elderly share 1,600 refused', {
		elderlyShare: 1600
	});
	sd('cont-ed-degree', ['CN-N16.continuing-education'], 'continuing education 400', {
		continuingEducation: 'DEGREE'
	});
	sd('cont-ed-cert', ['CN-N16.continuing-education'], 'certificate 3,600 this month', {
		continuingEducation: 'CERTIFICATE'
	});
	sd(
		'all',
		[
			'CN-N16.child-education',
			'CN-N16.infant-care',
			'CN-N16.elderly-support',
			'CN-N54.capital-city-1500'
		],
		'child + infant + elder + rent',
		{ children: 1, infants: 1, elderlyOnlyChild: true, rent: true }
	);
	add(
		'iit-personal-pension',
		['CN-N43.personal-pension'],
		['1,000 a month vouchers'],
		'Personal pension 1,000 a month, March cumulative',
		[SRC.pension],
		{
			period: '2026-03',
			employment: { hireDate: '2020-03-02', monthlyWage: 20000 },
			tax: { personalPensionMonthly: 1000 }
		}
	);
	add(
		'iit-personal-pension-cap',
		['CN-N43.personal-pension'],
		['12,000 annual cap'],
		'Personal pension 5,000 a month: capped at 12,000 by March',
		[SRC.pension],
		{
			period: '2026-03',
			employment: { hireDate: '2020-03-02', monthlyWage: 30000 },
			tax: { personalPensionMonthly: 5000 }
		}
	);
	add(
		'iit-health-200',
		['CN-N43.commercial-health-insurance'],
		['200 a month'],
		'Commercial health insurance 200 a month',
		[SRC.iit],
		{ employment: { monthlyWage: 20000 }, tax: { commercialHealthMonthly: 200 } }
	);
	add(
		'iit-health-300',
		['CN-N43.commercial-health-insurance'],
		['above 200 capped'],
		'Commercial health insurance 300 a month: 200 deducted',
		[SRC.iit],
		{ employment: { monthlyWage: 20000 }, tax: { commercialHealthMonthly: 300 } }
	);

	// ---- bonuses
	for (const amount of [
		12000, 36000, 36000.01, 144000, 144000.01, 300000, 300000.01, 420000, 420000.01, 660000,
		660000.01, 960000, 960000.01
	])
		add(
			`bonus-separate-${amount}`,
			['CN-N10.separate-election', 'CN-N53.annual-bonus'],
			['resident separate annual bonus', `bonus ÷ 12 = ${fen(amount / 12)}`],
			`Separate annual bonus ${amount}`,
			[SRC.bonus],
			{ pay: { bonus: { kind: 'ANNUAL_BONUS_SEPARATE', amount } } }
		);
	add(
		'bonus-separate-second-use',
		['CN-N10.once-per-year'],
		['once per year refused'],
		'Second separate bonus in a year',
		[SRC.bonus],
		{ pay: { bonus: { kind: 'ANNUAL_BONUS_SEPARATE', amount: 20000, usedThisYear: true } } }
	);
	add(
		'bonus-ordinary',
		['CN-N10.ordinary-bonus-joins-wage', 'CN-N53.annual-bonus', 'CN-N09.resident-cumulative'],
		['ordinary bonus joins wages'],
		'Ordinary 10,000 bonus in the cumulative wage',
		[SRC.iit],
		{ pay: { bonus: { kind: 'BONUS', amount: 10000 } } }
	);
	add(
		'bonus-thirteenth',
		['CN-N53.thirteenth-month', 'CN-N10.ordinary-bonus-joins-wage'],
		['contractual 13th month as ordinary bonus'],
		'A contractual 13th-month payment joins the wage',
		[SRC.iit],
		{
			period: '2026-02',
			employment: { hireDate: '2020-03-02' },
			pay: { bonus: { kind: 'BONUS', amount: 10000 } }
		}
	);
	add(
		'bonus-separate-nonresident',
		['CN-N10.separate-election', 'CN-KM-A1.six-month-spread'],
		['separate method is resident-only'],
		'Non-resident cannot elect the resident method',
		[SRC.bonus],
		{
			employee: nonres,
			facts: { fundRate: null },
			pay: { bonus: { kind: 'ANNUAL_BONUS_SEPARATE', amount: 20000 } }
		}
	);
	const nr = { employee: nonres, employment: { monthlyWage: 30000 }, facts: { fundRate: null } };
	for (const amount of [
		60000, 18000, 18000.01, 72000, 72000.01, 150000, 150000.01, 210000, 210000.01, 330000,
		330000.01, 480000, 480000.01
	])
		add(
			`bonus-nonres-${amount}`,
			['CN-KM-A1.six-month-spread', 'CN-N38.non-resident-monthly-table'],
			['non-resident multi-month bonus', `bonus ÷ 6 = ${fen(amount / 6)}`],
			`Non-resident multi-month bonus ${amount}`,
			[SRC.nonres],
			{ ...nr, pay: { bonus: { kind: 'MULTI_MONTH_NONRESIDENT', amount } } }
		);
	add(
		'bonus-nonres-second-use',
		['CN-KM-A1.once-per-year'],
		['once per year refused'],
		'Second non-resident multi-month bonus',
		[SRC.nonres],
		{
			...nr,
			pay: { bonus: { kind: 'MULTI_MONTH_NONRESIDENT', amount: 60000, usedThisYear: true } }
		}
	);
	add(
		'bonus-nonres-resident',
		['CN-KM-A1.six-month-spread'],
		['multi-month spread is non-resident-only'],
		'Resident cannot use the non-resident spread',
		[SRC.nonres],
		{ pay: { bonus: { kind: 'MULTI_MONTH_NONRESIDENT', amount: 60000 } } }
	);
	add(
		'bonus-nonres-ordinary',
		['CN-N38.non-resident-monthly-table', 'CN-N10.ordinary-bonus-joins-wage'],
		['non-resident ordinary bonus joins the month'],
		'Non-resident ordinary bonus with the wage',
		[SRC.iit],
		{ ...nr, pay: { bonus: { kind: 'BONUS', amount: 10000 } } }
	);

	// ---- proration: hire and exit on the 1st, mid-month and last days (2026 schedule days honoured)
	for (const day of ['01', '15', '30', '31'])
		add(
			`hire-2026-01-${day}`,
			[
				'CN-N02.day-conversion-21-75',
				'CN-N03.adjusted-workdays',
				'CN-KM20.transferred-first-month'
			],
			[`hired ${day} Jan`],
			`Joiner on 2026-01-${day}`,
			[SRC.days, SRC.holidays],
			{ employment: { hireDate: `2026-01-${day}`, monthlyWage: 21750 } }
		);
	for (const day of ['01', '15', '21', '30'])
		add(
			`hire-2026-09-${day}`,
			['CN-N02.day-conversion-21-75', 'CN-N03.adjusted-workdays', 'CN-N03.all-citizen-festivals'],
			[
				`hired ${day} Sep`,
				day === '15'
					? '20 Sep Sunday workday inside the span'
					: day === '21'
						? 'after the 20 Sep workday'
						: 'plain'
			],
			`Joiner on 2026-09-${day}`,
			[SRC.days, SRC.holidays],
			{ period: '2026-09', employment: { hireDate: `2026-09-${day}`, monthlyWage: 21750 } }
		);
	for (const day of ['01', '02', '05', '15', '27', '30', '31'])
		add(
			`exit-2026-01-${day}`,
			[
				'CN-N02.day-conversion-21-75',
				'CN-N04.exit-settlement',
				'CN-KM-WP06.five-working-days',
				'CN-KM-WP06.single-final-payment',
				'CN-N18.exit-entitlement',
				'CN-N03.adjusted-workdays'
			],
			[`left ${day} Jan`, 'resignation'],
			`Leaver on 2026-01-${day}`,
			[SRC.days, SRC.wagePay, SRC.holidays],
			{
				employment: { hireDate: '2020-03-02', exitDate: `2026-01-${day}`, monthlyWage: 21750 },
				exit: { cause: 'RESIGNATION' }
			}
		);
	add(
		'exit-2026-02-20',
		['CN-N02.day-conversion-21-75', 'CN-N03.all-citizen-festivals', 'CN-N03.adjusted-workdays'],
		['Spring Festival holidays paid, 调休 rest unpaid'],
		'Leaver on 20 Feb 2026 inside the Spring Festival break',
		[SRC.days, SRC.holidays],
		{
			period: '2026-02',
			employment: { hireDate: '2020-03-02', exitDate: '2026-02-20', monthlyWage: 21750 },
			exit: { cause: 'RESIGNATION' }
		}
	);
	for (const d of [1, 3])
		add(
			`unpaid-${d}`,
			[
				'CN-N04.unpaid-personal-leave',
				'CN-KM-WP12.personal-leave-absent-only',
				'CN-N02.day-conversion-21-75'
			],
			[`${d} unpaid day(s)`],
			`${d} personal-leave day(s) at 21,750 ÷ 21.75`,
			[SRC.days, SRC.wagePay],
			{ employment: { monthlyWage: 21750 }, time: { unpaidDays: d } }
		);
	add(
		'stoppage-first-cycle',
		['CN-N04.stoppage', 'CN-KM-WP15.first-wage-cycle'],
		['stoppage within one wage cycle: full wage'],
		'Five stoppage days not caused by the worker: no deduction',
		[SRC.wagePayNat, SRC.wagePay],
		{ employment: { monthlyWage: 21750 }, time: { stoppageDays: 5 } }
	);
	add(
		'raise-jan',
		['CN-KM-WP03.full-wage-due', 'CN-N02.day-conversion-21-75'],
		['mid-month rise'],
		'22,000 → 26,400 from 16 Jan 2026',
		[SRC.days],
		{
			employment: {
				hireDate: '2020-03-02',
				monthlyWage: 22000,
				raise: { from: '2026-01-16', monthlyWage: 26400 }
			}
		}
	);
	add(
		'raise-feb',
		['CN-KM-WP03.full-wage-due', 'CN-N02.day-conversion-21-75', 'CN-N03.adjusted-workdays'],
		['mid-month rise across the Spring Festival'],
		'22,000 → 26,400 from 16 Feb 2026',
		[SRC.days, SRC.holidays],
		{
			period: '2026-02',
			employment: {
				hireDate: '2020-03-02',
				monthlyWage: 22000,
				raise: { from: '2026-02-16', monthlyWage: 26400 }
			}
		}
	);

	// ---- overtime (21,750 → 125 an hour)
	const ot = (
		tag: string,
		rows: string[],
		branches: string[],
		o: NonNullable<Scenario['time']['overtime']>
	) =>
		add(
			`ot-${tag}`,
			['CN-N02.hour-conversion-8', ...rows],
			branches,
			`Overtime ${tag}`,
			[SRC.labour, SRC.days],
			{ employment: { monthlyWage: 21750 }, time: { overtime: o } }
		);
	ot(
		'weekday-1h',
		['CN-N01.weekday-extended-150', 'CN-KM-WP08.weekday-150', 'CN-N01.standard-hours-rest'],
		['weekday 150%'],
		{ weekdayHours: 1, maxDailyWeekdayHours: 1 }
	);
	ot(
		'weekday-36h',
		['CN-N40.monthly-36-hour-cap', 'CN-N40.daily-three-hour-cap', 'CN-KM-WP08.weekday-150'],
		['monthly limit reached'],
		{ weekdayHours: 36, maxDailyWeekdayHours: 3 }
	);
	ot(
		'weekday-37h',
		['CN-N40.monthly-36-hour-cap', 'CN-KM-WP08.weekday-150'],
		['monthly limit exceeded, still paid'],
		{ weekdayHours: 37, maxDailyWeekdayHours: 3 }
	);
	ot(
		'weekday-daily-4h',
		['CN-N40.daily-three-hour-cap', 'CN-KM-WP08.weekday-150'],
		['daily limit exceeded, still paid'],
		{ weekdayHours: 4, maxDailyWeekdayHours: 4 }
	);
	ot('rest-8h', ['CN-N01.rest-day-200', 'CN-KM-WP08.rest-day-200'], ['rest day 200%'], {
		restDayHours: 8
	});
	ot(
		'rest-8h-comp',
		[
			'CN-N01.rest-day-compensatory-rest',
			'CN-N40.rest-day-compensatory-rest',
			'CN-KM-WP08.compensatory-rest'
		],
		['rest day with compensatory rest: no premium'],
		{ restDayHours: 8, restDayCompensatoryRest: true }
	);
	ot(
		'holiday-8h',
		['CN-N01.holiday-300', 'CN-KM-WP08.holiday-300', 'CN-N40.holiday-no-substitution'],
		['statutory holiday 300%'],
		{ holidayHours: 8 }
	);
	ot(
		'mixed',
		['CN-N01.weekday-extended-150', 'CN-N01.rest-day-200', 'CN-N01.holiday-300'],
		['weekday + rest + holiday'],
		{ weekdayHours: 10, maxDailyWeekdayHours: 2, restDayHours: 8, holidayHours: 8 }
	);
	add(
		'night-no-premium',
		['CN-N53.night-premium'],
		['night work: no statutory premium'],
		'40 night hours: no premium line',
		[SRC.labour],
		{ time: { nightHours: 40 } }
	);

	// ---- statutory leave (paid, no deduction) and over-grant refusals
	const lv = (
		tag: string,
		rows: string[],
		leave: NonNullable<Scenario['time']['leave']>,
		src = SRC.yunnanFp,
		employee: Patch['employee'] = {}
	) =>
		add(
			`leave-${tag}`,
			[...rows, 'CN-N04.paid-civic-and-leave-time'],
			[leave.code, `${leave.calendarDays} calendar days`],
			`${leave.code} ${leave.calendarDays} days`,
			[src],
			{ employee, employment: { monthlyWage: 21750 }, time: { leave } }
		);
	lv(
		'marriage-18',
		[
			'CN-KM30.yunnan-15-days',
			'CN-KM30.national-component',
			'CN-N51.marriage-leave',
			'CN-KM-WP12.marriage-leave',
			'CN-KM30.calendar-day-counting'
		],
		{ code: 'MARRIAGE_LEAVE', calendarDays: 18 }
	);
	lv('marriage-19', ['CN-KM30.yunnan-15-days', 'CN-N51.marriage-leave'], {
		code: 'MARRIAGE_LEAVE',
		calendarDays: 19
	});
	lv('childcare-10-one', ['CN-KM12.one-child-ten-days'], {
		code: 'CHILDCARE_LEAVE',
		calendarDays: 10,
		childrenUnder3: 1
	});
	lv('childcare-11-one', ['CN-KM12.one-child-ten-days'], {
		code: 'CHILDCARE_LEAVE',
		calendarDays: 11,
		childrenUnder3: 1
	});
	lv('childcare-11-two', ['CN-KM12.two-or-more-fifteen-days'], {
		code: 'CHILDCARE_LEAVE',
		calendarDays: 11,
		childrenUnder3: 2
	});
	lv('childcare-15-two', ['CN-KM12.two-or-more-fifteen-days'], {
		code: 'CHILDCARE_LEAVE',
		calendarDays: 15,
		childrenUnder3: 2
	});
	lv('childcare-16-two', ['CN-KM12.two-or-more-fifteen-days'], {
		code: 'CHILDCARE_LEAVE',
		calendarDays: 16,
		childrenUnder3: 2
	});
	lv('childcare-child-3', ['CN-KM12.ends-at-third-birthday'], {
		code: 'CHILDCARE_LEAVE',
		calendarDays: 1,
		childrenUnder3: 0
	});
	lv('funeral-3', ['CN-N51.funeral-leave', 'CN-KM-WP12.funeral-leave'], {
		code: 'FUNERAL_LEAVE',
		calendarDays: 3
	});
	lv('funeral-4', ['CN-N51.funeral-leave'], { code: 'FUNERAL_LEAVE', calendarDays: 4 });
	for (const [procedure, days, row] of [
		['IUD_INSERTION', 7, 'CN-KM31.iud-insertion'],
		['IUD_REMOVAL', 7, 'CN-KM31.iud-removal'],
		['TUBAL_LIGATION', 30, 'CN-KM31.tubal-ligation'],
		['VASECTOMY', 15, 'CN-KM31.vasectomy'],
		['TUBAL_REVERSAL', 30, 'CN-KM31.tubal-reversal'],
		['VAS_REVERSAL', 15, 'CN-KM31.vas-reversal'],
		['REMEDIAL_UNDER_4_MONTHS', 15, 'CN-KM31.remedial-under-4-months'],
		['REMEDIAL_4_MONTHS_OR_MORE', 42, 'CN-KM31.remedial-4-months-or-more']
	] as [string, number, string][])
		for (const d of procedure.startsWith('IUD') || procedure.endsWith('REVERSAL')
			? [days]
			: [days, days + 1])
			lv(`fp-${procedure.toLowerCase()}-${d}`, [row, 'CN-KM31.calendar-day-counting'], {
				code: 'FAMILY_PLANNING_PROCEDURE_LEAVE',
				calendarDays: d,
				procedure
			});
	const mother = { birthDate: '1994-02-11' };
	for (const [tag, leave, row] of [
		['158', { calendarDays: 158 }, 'CN-N20.maternity-98-days'],
		['159', { calendarDays: 159 }, 'CN-N20.maternity-98-days'],
		['difficult-173', { calendarDays: 173, difficultBirth: true }, 'CN-N20.difficult-birth-15'],
		['difficult-174', { calendarDays: 174, difficultBirth: true }, 'CN-N20.difficult-birth-15'],
		['twins-173', { calendarDays: 173, extraInfants: 1 }, 'CN-N20.additional-infant-15'],
		['twins-174', { calendarDays: 174, extraInfants: 1 }, 'CN-N20.additional-infant-15'],
		['miscarriage-3m-15', { calendarDays: 15, miscarriageMonths: 3 }, 'CN-N20.miscarriage'],
		['miscarriage-3m-16', { calendarDays: 16, miscarriageMonths: 3 }, 'CN-N20.miscarriage'],
		['miscarriage-4m-42', { calendarDays: 42, miscarriageMonths: 4 }, 'CN-N20.miscarriage'],
		['miscarriage-4m-43', { calendarDays: 43, miscarriageMonths: 4 }, 'CN-N20.miscarriage']
	] as [string, Partial<NonNullable<Scenario['time']['leave']>>, string][])
		lv(
			`maternity-${tag}`,
			[row, 'CN-KM12.maternity-and-partner-days', 'CN-KM-WP12.maternity-leave'],
			{ code: 'MATERNITY_LEAVE', calendarDays: 0, ...leave },
			SRC.female,
			mother
		);
	lv('paternity-30', ['CN-KM12.maternity-and-partner-days'], {
		code: 'PATERNITY_LEAVE',
		calendarDays: 30
	});
	lv('paternity-31', ['CN-KM12.maternity-and-partner-days'], {
		code: 'PATERNITY_LEAVE',
		calendarDays: 31
	});
	lv(
		'dysmenorrhoea-2',
		['CN-KM11.dysmenorrhoea-leave'],
		{ code: 'DYSMENORRHOEA_LEAVE', calendarDays: 2 },
		SRC.yunnanWomen,
		mother
	);
	lv(
		'dysmenorrhoea-3',
		['CN-KM11.dysmenorrhoea-leave'],
		{ code: 'DYSMENORRHOEA_LEAVE', calendarDays: 3 },
		SRC.yunnanWomen,
		mother
	);
	lv(
		'work-injury-5',
		['CN-KM-WP13.original-wage-twelve-months', 'CN-N21.stop-work-original-wage'],
		{ code: 'WORK_INJURY_LEAVE', calendarDays: 5 },
		SRC.injuryReg
	);
	lv(
		'work-injury-731',
		['CN-KM-WP13.extension-twelve-months', 'CN-N21.stop-work-original-wage'],
		{ code: 'WORK_INJURY_LEAVE', calendarDays: 731 },
		SRC.injuryReg
	);
	lv(
		'work-injury-732',
		['CN-KM-WP13.extension-twelve-months', 'CN-N21.stop-work-original-wage'],
		{ code: 'WORK_INJURY_LEAVE', calendarDays: 732 },
		SRC.injuryReg
	);
	// maternity pay
	const mat = (
		tag: string,
		rows: string[],
		branch: string,
		maternity: NonNullable<Scenario['pay']['maternity']>,
		facts: Patch['facts'] = {}
	) =>
		add(
			`maternity-pay-${tag}`,
			['CN-KM-WP12.maternity-leave', ...rows],
			[branch],
			`Maternity month on 12,000: ${branch}`,
			[SRC.maternity, SRC.female],
			{
				employee: mother,
				employment: { monthlyWage: 12000 },
				facts,
				time: { leave: { code: 'MATERNITY_LEAVE', calendarDays: 31 } },
				pay: { maternity }
			}
		);
	for (const allowance of [9000, 12000, 15000])
		mat(
			`worker-${allowance}`,
			[
				'CN-KM32.allowance-offset-top-up',
				'CN-N20.insured-benefit-or-wage',
				'CN-KM12.direct-allowance-payment'
			],
			`${allowance} paid to the worker, employer tops up`,
			{ allowance, paidTo: 'WORKER' }
		);
	mat(
		'employer-9000',
		['CN-KM32.allowance-offset-top-up', 'CN-KM12.direct-allowance-payment'],
		'9,000 paid to the employer: full wage',
		{ allowance: 9000, paidTo: 'EMPLOYER' }
	);
	mat(
		'employer-15000',
		['CN-KM32.allowance-offset-top-up'],
		'15,000 paid to the employer: excess unpriced',
		{ allowance: 15000, paidTo: 'EMPLOYER' }
	);
	mat(
		'unenrolled',
		['CN-KM32.non-enrolling-employer', 'CN-N20.insured-benefit-or-wage'],
		'not enrolled: employer pays allowance and grant',
		{ allowance: 9000, paidTo: 'WORKER' },
		{ siRegistered: false }
	);
	mat(
		'unenrolled-twins',
		['CN-KM32.non-enrolling-employer'],
		'not enrolled, twins: two nutrition grants',
		{ allowance: 12000, paidTo: 'WORKER', infants: 2 },
		{ siRegistered: false }
	);

	// ---- allowances, untaxed subsidies and post-tax deductions
	for (const days of [1, 22])
		add(
			`heat-${days}`,
			['CN-KM13.outdoor-35', 'CN-N26.kunming-allowance', 'CN-N50.excluded-components'],
			[`${days} days at ≥35°C`],
			`Outdoor heat allowance, ${days} days`,
			[SRC.heat],
			{ time: {}, pay: { heatDays: days } }
		);
	add(
		'heat-indoor',
		['CN-KM13.indoor-33', 'CN-N26.indoor-33'],
		['indoor ≥33°C'],
		'Indoor heat allowance, 10 days',
		[SRC.heat],
		{ pay: { heatDays: 10 } }
	);
	add(
		'heat-min-wage',
		['CN-N50.excluded-components', 'CN-KM13.outdoor-35'],
		['allowance cannot lift pay over the floor'],
		'2,100 plus heat allowance is still below 2,170',
		[SRC.heat, SRC.minWage2025],
		{ employment: { monthlyWage: 2100 }, pay: { heatDays: 20 } }
	);
	for (const [code, row, qualifying] of [
		['ONE_CHILD_SUBSIDY', 'CN-N55.one-child-subsidy', true],
		['CHILDCARE_SUBSIDY', 'CN-N55.childcare-subsidy', true],
		['TRAVEL_ALLOWANCE', 'CN-N55.travel-allowance', true],
		['TRAVEL_ALLOWANCE', 'CN-N55.travel-allowance', false],
		['MISSED_MEAL_SUBSIDY', 'CN-N55.missed-meal-subsidy', true],
		['MISSED_MEAL_SUBSIDY', 'CN-N55.missed-meal-subsidy', false]
	] as [string, string, boolean][])
		add(
			`subsidy-${code.toLowerCase()}-${qualifying ? 'q' : 'nq'}`,
			[row],
			[qualifying ? 'not of wage nature: untaxed' : 'fails the condition: wage income'],
			`${code} 500 on 20,000`,
			[SRC.exempt],
			{
				employment: { monthlyWage: 20000 },
				pay: { subsidies: [{ code, amount: 500, qualifying }] }
			}
		);
	add(
		'only-child-health-fee',
		['CN-KM38.health-fee', 'CN-N55.one-child-subsidy'],
		['CNY10 a month, untaxed'],
		'Only-child health fee 10',
		[SRC.yunnanFp, SRC.exempt],
		{
			employment: { monthlyWage: 20000 },
			pay: { subsidies: [{ code: 'ONE_CHILD_SUBSIDY', amount: 10, qualifying: true }] }
		}
	);
	add(
		'court-order',
		['CN-KM-WP09.court-ordered-support', 'CN-N04.lawful-deductions'],
		['court-ordered support 2,000'],
		'Court-ordered 抚养费 2,000 withheld',
		[SRC.wagePay, SRC.wagePayNat],
		{ pay: { courtOrder: 2000 } }
	);
	for (const [wage, claim, branch] of [
		[10000, 1000, 'within 20%'],
		[10000, 5000, '20% cap binds'],
		[2600, 1000, 'minimum-wage remainder binds'],
		[2170, 500, 'at the floor: nothing recoverable']
	] as [number, number, string][])
		add(
			`loss-${wage}-${claim}`,
			[
				'CN-N04.employee-loss-deduction-cap',
				'CN-KM-WP16.monthly-20pct-cap',
				'CN-KM-WP16.minimum-remains',
				'CN-KM-WP16.basis-and-amount'
			],
			[branch],
			`Loss claim ${claim} on ${wage}`,
			[SRC.wagePayNat, SRC.wagePay],
			{ employment: { monthlyWage: wage }, pay: { lossClaim: claim } }
		);

	// ---- contract formation: no written contract, open-ended, probation
	add(
		'no-contract-3m',
		[
			'CN-N19.written-contract-double-wage',
			'CN-N12.no-written-contract',
			'CN-N41.no-written-contract-double-wage'
		],
		['signed 1 May: 3 months owed'],
		'Hired 1 Jan 2025, contract signed 1 May 2025, settled January 2026',
		[SRC.lcl, SRC.lclReg],
		{
			employment: { hireDate: '2025-01-01', monthlyWage: 10000 },
			contract: { signedDate: '2025-05-01' }
		}
	);
	add(
		'no-contract-within-month',
		['CN-N19.written-contract-double-wage'],
		['signed within the first month: nothing'],
		'Signed on day 31',
		[SRC.lcl],
		{
			employment: { hireDate: '2025-06-01', monthlyWage: 10000 },
			contract: { signedDate: '2025-07-01' }
		}
	);
	add(
		'no-contract-never',
		['CN-N41.no-written-contract-double-wage', 'CN-N41.deemed-open-ended'],
		['never signed: 11-month cap'],
		'Hired 1 Jan 2025, never signed',
		[SRC.lcl, SRC.lclReg],
		{ employment: { hireDate: '2025-01-01', monthlyWage: 10000 }, contract: { signedDate: null } }
	);
	add(
		'no-contract-part-month',
		['CN-N19.written-contract-double-wage'],
		['part month by paid days'],
		'Hired 1 Oct 2025, signed 15 Jan 2026',
		[SRC.lcl, SRC.days],
		{
			employment: { hireDate: '2025-10-01', monthlyWage: 10000 },
			contract: { signedDate: '2026-01-15' }
		}
	);
	add(
		'open-ended-3m',
		['CN-N41.open-ended-second-wage'],
		['due 1 Oct 2025, concluded 1 Jan 2026'],
		'Open-ended contract due 1 Oct 2025, concluded 1 Jan 2026',
		[SRC.lcl],
		{
			employment: { hireDate: '2015-10-01', monthlyWage: 10000 },
			contract: { openEndedDueDate: '2025-10-01', openEndedConcludedDate: '2026-01-01' }
		}
	);
	for (const [term, served, row, branch] of [
		[2, 1, 'CN-N41.probation-none-short-or-part-time', 'term under 3 months: none allowed'],
		[6, 1, 'CN-N41.probation-three-months-to-one-year', '6-month term: 1 allowed, none excess'],
		[6, 2, 'CN-N41.probation-three-months-to-one-year', '6-month term: 1 excess'],
		[12, 3, 'CN-N41.probation-one-to-three-years', '1-year term: 1 excess'],
		[24, 2, 'CN-N41.probation-one-to-three-years', '2-year term: at the limit'],
		[36, 6, 'CN-N41.probation-three-years-or-open-ended', '3-year term: at the limit'],
		[null, 7, 'CN-N41.probation-three-years-or-open-ended', 'open-ended: 1 excess']
	] as [number | null, number, string, string][])
		add(
			`probation-${term ?? 'open'}-${served}`,
			[row, 'CN-N19.probation-limits', 'CN-N12.probation'],
			[branch],
			`Probation ${served} months on a ${term ?? 'open-ended'} term`,
			[SRC.lcl],
			{
				employment: { hireDate: '2025-01-01', monthlyWage: 10000 },
				contract: { probation: { termMonths: term, servedMonths: served } }
			}
		);
	add(
		'probation-part-time',
		['CN-N27.no-probation', 'CN-N41.probation-none-short-or-part-time'],
		['non-full-time: no probation'],
		'Probation on a full-time wage later ruled part-time',
		[SRC.lcl],
		{
			employment: { hireDate: '2025-01-01', monthlyWage: 10000 },
			contract: { probation: { termMonths: 12, servedMonths: 1, partTime: true } }
		}
	);
	for (const [wage, probationWage, branch] of [
		[10000, 8000, '80% exactly'],
		[10000, 7000, 'under 80%: shortfall owed'],
		[2500, 2000, 'minimum wage binds above 80%']
	] as [number, number, string][])
		add(
			`probation-wage-${wage}-${probationWage}`,
			['CN-N19.probation-wage-floor', 'CN-N12.probation'],
			[branch],
			`Probation wage ${probationWage} on agreed ${wage}`,
			[SRC.lcl, SRC.lclReg],
			{ employment: { monthlyWage: wage, probationWage } }
		);

	// ---- severance (January 2026 exits, declared local average 10,847.83 → 3× cap 32,543.49)
	const SEV = [
		'CN-N12.service-year-severance',
		'CN-N19.severance-wage-base',
		'CN-N39.termination-lump-sum',
		'CN-KM-WP06.single-final-payment'
	];
	const sev = (
		tag: string,
		rows: string[],
		branches: string[],
		hireDate: string,
		exitDate: string,
		exit: Partial<NonNullable<Scenario['exit']>>,
		monthlyWage = 20000,
		birthDate = '1990-05-10'
	) =>
		add(`sev-${tag}`, [...SEV, ...rows], branches, `Exit ${tag}`, [SRC.lcl, SRC.lclReg, SRC.sev], {
			employee: { birthDate },
			employment: { hireDate, exitDate, monthlyWage },
			exit: { cause: 'MUTUAL_EMPLOYER', ...exit }
		});
	sev(
		'5m',
		['CN-N41.severance-under-six-months'],
		['under 6 months: half a month'],
		'2025-08-16',
		'2026-01-15',
		{}
	);
	sev(
		'5m29d',
		['CN-N41.severance-under-six-months'],
		['5 months + days: half a month'],
		'2025-07-17',
		'2026-01-15',
		{}
	);
	sev(
		'6m',
		['CN-N41.severance-six-to-twelve-months'],
		['6 months: one month'],
		'2025-07-16',
		'2026-01-15',
		{}
	);
	sev('1y', ['CN-N41.severance-whole-years'], ['one full year'], '2025-01-16', '2026-01-15', {});
	sev(
		'1y1d',
		['CN-N41.severance-under-six-months'],
		['one year and a day: 1.5'],
		'2025-01-15',
		'2026-01-15',
		{}
	);
	sev('1y5m', ['CN-N41.severance-under-six-months'], ['1y5m: 1.5'], '2024-08-16', '2026-01-15', {});
	sev(
		'1y6m',
		['CN-N41.severance-six-to-twelve-months'],
		['1y6m: 2'],
		'2024-07-16',
		'2026-01-15',
		{}
	);
	sev(
		'6y6m',
		['CN-N41.severance-whole-years', 'CN-N41.severance-six-to-twelve-months'],
		['6y6m: 7'],
		'2019-07-16',
		'2026-01-15',
		{}
	);
	for (const wage of plusMinus(32543.49))
		sev(
			`cap-seam-${wage}`,
			['CN-N12.high-earner-cap'],
			['3× average cap seam'],
			'2019-07-16',
			'2026-01-15',
			{},
			wage
		);
	sev(
		'12y-capped',
		['CN-N12.high-earner-cap'],
		['3× cap, 12 years'],
		'2014-01-16',
		'2026-01-15',
		{},
		40000
	);
	sev(
		'13y-capped',
		['CN-N12.high-earner-cap'],
		['3× cap limits years to 12'],
		'2013-01-16',
		'2026-01-15',
		{},
		40000
	);
	sev(
		'13y-uncapped',
		['CN-N41.severance-whole-years'],
		['13 years below the cap'],
		'2013-01-16',
		'2026-01-15',
		{}
	);
	sev(
		'exempt-exactly',
		['CN-N39.termination-lump-sum'],
		['compensation equal to the 3× annual exemption'],
		'2014-01-16',
		'2026-01-15',
		{},
		32543.49
	);
	sev(
		'unlawful-13y-capped',
		['CN-N12.unlawful-termination', 'CN-N41.art87-double'],
		['art.87 2N', 'IIT_SEVERANCE on the excess'],
		'2013-01-16',
		'2026-01-15',
		{ cause: 'UNLAWFUL' },
		40000
	);
	sev(
		'unlawful-6y6m',
		['CN-N12.unlawful-termination', 'CN-N41.art87-double'],
		['art.87 2N'],
		'2019-07-16',
		'2026-01-15',
		{ cause: 'UNLAWFUL' }
	);
	sev(
		'unlawful-pre2008',
		['CN-N41.art87-double'],
		['art.87 counted from hire, before 2008 too'],
		'2005-07-16',
		'2026-01-15',
		{ cause: 'UNLAWFUL' },
		20000,
		'1980-05-10'
	);
	sev(
		'pre2008-split',
		['CN-N41.severance-whole-years'],
		['LCL art.97: years from 2008 plus declared pre-2008 compensation'],
		'2005-07-16',
		'2026-01-15',
		{ pre2008Compensation: 50000 },
		20000,
		'1980-05-10'
	);
	sev(
		'transferred-service',
		['CN-N41.severance-whole-years'],
		['Regulation art.10 transferred service'],
		'2023-01-16',
		'2026-01-15',
		{ transferredServiceMonths: 30 }
	);
	sev(
		'art40-no-notice',
		['CN-N12.termination-notice', 'CN-N41.art40-notice-or-pay'],
		['art.40 month in lieu'],
		'2019-07-16',
		'2026-01-15',
		{ cause: 'ART40', noticeDaysGiven: 0 }
	);
	sev(
		'art40-29-days',
		['CN-N41.art40-notice-or-pay'],
		['art.40 29 days: month in lieu'],
		'2019-07-16',
		'2026-01-15',
		{ cause: 'ART40', noticeDaysGiven: 29 }
	);
	sev(
		'art40-30-days',
		['CN-N41.art40-notice-or-pay'],
		['art.40 30 days: no month in lieu'],
		'2019-07-16',
		'2026-01-15',
		{ cause: 'ART40', noticeDaysGiven: 30 }
	);
	sev(
		'art41',
		['CN-N12.service-year-severance'],
		['art.41 redundancy'],
		'2019-07-16',
		'2026-01-15',
		{ cause: 'ART41' }
	);
	sev(
		'expiry',
		['CN-N41.fixed-term-expiry'],
		['fixed-term expiry, no renewal offer'],
		'2023-01-16',
		'2026-01-15',
		{ cause: 'EXPIRY' }
	);
	sev(
		'expiry-refused',
		['CN-N41.fixed-term-expiry'],
		['expiry, equal renewal refused: none'],
		'2023-01-16',
		'2026-01-15',
		{ cause: 'EXPIRY', renewalOfferRefused: true }
	);
	sev(
		'resignation',
		['CN-N12.service-year-severance'],
		['art.37 resignation: none'],
		'2019-07-16',
		'2026-01-15',
		{ cause: 'RESIGNATION' }
	);
	sev(
		'misconduct',
		['CN-N12.service-year-severance'],
		['art.39: none'],
		'2019-07-16',
		'2026-01-15',
		{ cause: 'MISCONDUCT' }
	);
	sev(
		'hired-exit-month',
		['CN-SH-A2.art47-average', 'CN-SH-A2.art20-previous-month'],
		['hired in the exit month: contract wage average'],
		'2026-01-05',
		'2026-01-20',
		{ cause: 'ART40', noticeDaysGiven: 0 }
	);
	sev(
		'exit-27-no-warning',
		['CN-KM-WP06.five-working-days'],
		['final pay due 3 Feb: no warning'],
		'2019-07-16',
		'2026-01-27',
		{}
	);
	add(
		'sev-bonus-in-average',
		[...SEV, 'CN-N19.severance-wage-base'],
		['a February bonus inside the 12-month average'],
		'Mutual termination 31 Mar 2026 after a 24,000 February bonus',
		[SRC.lclReg],
		{
			period: '2026-03',
			employment: { hireDate: '2019-07-16', exitDate: '2026-03-31', monthlyWage: 20000 },
			pay: { priorBonus: { period: '2026-02', amount: 24000 } },
			exit: { cause: 'MUTUAL_EMPLOYER' }
		}
	);
	add(
		'sev-part-time',
		['CN-N27.termination-without-compensation', 'CN-N12.service-year-severance'],
		['part-time: no compensation'],
		'Part-time worker let go',
		[SRC.lcl],
		{
			employment: {
				hireDate: '2026-01-01',
				exitDate: '2026-01-15',
				monthlyWage: 0,
				partTime: { hourlyRate: 25, hours: 40 }
			},
			facts: { fundRate: null },
			exit: { cause: 'MUTUAL_EMPLOYER' }
		}
	);

	// ---- retirement lump sums
	add(
		'early-retirement',
		['CN-N39.early-retirement'],
		['500,000 over 4 years'],
		'Early retirement subsidy 500,000, 4 years to statutory age',
		[SRC.sev],
		{
			employee: { birthDate: '1970-03-01' },
			employment: { hireDate: '2000-03-01', exitDate: '2026-01-31', monthlyWage: 10000 },
			pay: { earlyRetirement: { amount: 500000, yearsToStatutoryAge: 4 } },
			exit: { cause: 'RETIREMENT' }
		}
	);
	add(
		'early-retirement-exempt',
		['CN-N39.early-retirement'],
		['per year under 60,000: nothing'],
		'Early retirement subsidy 200,000 over 4 years',
		[SRC.sev],
		{
			employee: { birthDate: '1970-03-01' },
			employment: { hireDate: '2000-03-01', exitDate: '2026-01-31', monthlyWage: 10000 },
			pay: { earlyRetirement: { amount: 200000, yearsToStatutoryAge: 4 } },
			exit: { cause: 'RETIREMENT' }
		}
	);
	add(
		'internal-retirement',
		['CN-N39.internal-retirement'],
		['120,000 over 24 months with a 10,000 wage'],
		'Internal retirement subsidy 120,000, 24 months to statutory age',
		[SRC.sev],
		{
			employee: { birthDate: '1966-03-01' },
			employment: { hireDate: '2000-03-01', monthlyWage: 10000 },
			pay: { internalRetirement: { amount: 120000, monthsToStatutoryAge: 24 } }
		}
	);

	// ---- annual-leave cash on exit (March 2026, three months cumulative)
	for (const [prior, tier, row] of [
		[0, 5, 'CN-N05.band-1-to-10-years-5-days'],
		[60, 10, 'CN-N05.band-10-to-20-years-10-days'],
		[180, 15, 'CN-N05.band-20-years-15-days']
	] as const)
		for (const exitDate of ['2026-03-13', '2026-03-31'])
			add(
				`leave-cash-${tier}-${exitDate}`,
				[
					row,
					'CN-N05.part-year-proration',
					'CN-N06.unused-on-exit-300',
					'CN-N06.day-wage-twelve-month-average',
					'CN-N18.exit-entitlement',
					...(prior > 0 ? ['CN-N05.prior-employer-service'] : [])
				],
				[`${tier}-day band`, `exit ${exitDate}`],
				`Leaver on ${exitDate}, ${tier}-day entitlement, none taken`,
				[SRC.leave],
				{
					period: '2026-03',
					employee: { priorServiceMonths: prior },
					employment: { hireDate: '2020-03-02', exitDate, monthlyWage: 21750 },
					exit: { cause: 'RESIGNATION' }
				}
			);
	add(
		'leave-cash-taken-1',
		['CN-N18.exit-entitlement'],
		['one day already taken'],
		'15-day band, 31 Mar exit, one day taken',
		[SRC.leave],
		{
			period: '2026-03',
			employee: { priorServiceMonths: 180 },
			employment: { hireDate: '2020-03-02', exitDate: '2026-03-31', monthlyWage: 21750 },
			exit: { cause: 'RESIGNATION', leaveTakenThisYear: 1 }
		}
	);
	add(
		'leave-cash-over-taken',
		['CN-N06.no-clawback', 'CN-N18.no-clawback'],
		['more taken than earned: no clawback'],
		'5-day band, 31 Mar exit, 4 taken',
		[SRC.leave],
		{
			period: '2026-03',
			employment: { hireDate: '2020-03-02', exitDate: '2026-03-31', monthlyWage: 21750 },
			exit: { cause: 'RESIGNATION', leaveTakenThisYear: 4 }
		}
	);
	add(
		'leave-cash-bonus-average',
		['CN-N06.day-wage-twelve-month-average'],
		['a January bonus inside the day wage'],
		'5-day band, 31 Mar exit after a 12,000 January bonus',
		[SRC.leave],
		{
			period: '2026-03',
			employment: { hireDate: '2020-03-02', exitDate: '2026-03-31', monthlyWage: 22000 },
			pay: { priorBonus: { period: '2026-01', amount: 12000 } },
			exit: { cause: 'RESIGNATION' }
		}
	);
	add(
		'leave-cash-overtime-excluded',
		['CN-N06.day-wage-twelve-month-average'],
		['exit-month overtime outside the day wage'],
		'5-day band, 31 Mar exit with 10 overtime hours',
		[SRC.leave, SRC.labour],
		{
			period: '2026-03',
			employment: { hireDate: '2020-03-02', exitDate: '2026-03-31', monthlyWage: 21750 },
			time: { overtime: { weekdayHours: 10, maxDailyWeekdayHours: 2 } },
			exit: { cause: 'RESIGNATION' }
		}
	);
	add(
		'leave-cash-under-12m',
		['CN-N05.qualifying-twelve-months'],
		['under twelve months: nothing'],
		'Hired 1 Jun 2025, left 31 Mar 2026',
		[SRC.leave],
		{
			period: '2026-03',
			employment: { hireDate: '2025-06-01', exitDate: '2026-03-31', monthlyWage: 21750 },
			exit: { cause: 'RESIGNATION' }
		}
	);
	add(
		'leave-cash-qualifies-mid-year',
		['CN-N05.qualifying-twelve-months', 'CN-N05.part-year-proration'],
		['qualified 1 Feb 2026, counted from that day'],
		'Hired 1 Feb 2025, left 30 Jun 2026',
		[SRC.leave],
		{
			period: '2026-06',
			employment: { hireDate: '2025-02-01', exitDate: '2026-06-30', monthlyWage: 21750 },
			exit: { cause: 'RESIGNATION' }
		}
	);

	// ---- ages and retirement status (hired on the period's first day)
	for (const [birthDate, branch, rows] of [
		['2010-01-02', 'age 15 (one day short of 16) refused', ['CN-N29.under-16-ban']],
		['2010-06-01', 'age 15 refused', ['CN-N29.under-16-ban']],
		['2010-01-01', 'age 16 exactly', ['CN-N29.under-16-ban', 'CN-N29.minor-worker-protections']],
		['2009-01-01', 'age 17', ['CN-N29.minor-worker-protections']],
		['2008-01-01', 'age 18', ['CN-N29.minor-worker-protections']],
		['1966-01-02', 'age 59, not a pensioner', ['CN-N13.coverage-during-delay']],
		['1966-01-01', 'age 60, not a pensioner', ['CN-N13.coverage-during-delay']],
		['1965-01-01', 'age 61, not a pensioner', ['CN-N13.coverage-during-delay']]
	] as [string, string, string[]][])
		add(`age-${birthDate}`, rows, [branch], `Worker born ${birthDate}`, [SRC.child, SRC.county], {
			employee: { birthDate }
		});
	add(
		'pensioner-jan',
		['CN-N13.pensioned-retiree', 'CN-KM18.retirees'],
		['pension recipient: outside SI and fund'],
		'Re-employed pensioner, January 2026',
		[SRC.county],
		{ employee: { birthDate: '1962-04-01', pensionRecipient: true } }
	);
	add(
		'pensioner-sep',
		['CN-N13.pensioned-retiree', 'CN-N14.work-injury-cover', 'CN-N14.minimum-wage'],
		['managed post-age worker after Order 56: injury unpriced'],
		'Re-employed pensioner, September 2026',
		[SRC.overAge],
		{ period: '2026-09', employee: { birthDate: '1962-04-01', pensionRecipient: true } }
	);
	add(
		'pensioner-sep-below-min',
		['CN-N14.minimum-wage'],
		['post-age worker below the minimum refused'],
		'Re-employed pensioner at 2,000 in September 2026',
		[SRC.overAge, SRC.minWage2026],
		{
			period: '2026-09',
			employee: { birthDate: '1962-04-01', pensionRecipient: true },
			employment: { monthlyWage: 2000 }
		}
	);

	// ---- seeded in-bounds spread (deterministic)
	for (let i = 0; i < 6; i++) {
		const period = ['2025-12', '2026-01', '2026-09'][i % 3]!;
		const region = (['I', 'II', 'III'] as const)[Math.floor(i / 2) % 3];
		const wage = fen(2400 + rand() * 30000);
		add(
			`spread-${i}`,
			[
				...siRowsFor(period),
				FUND_FLOOR_ROW(period, region),
				'CN-KM05.rate-5-12',
				'CN-N09.resident-cumulative',
				'CN-N38.resident-annual-table'
			],
			['in-bounds spread', `class ${region}`],
			`Wage ${wage} in ${period}`,
			[SRC.siBase, SRC.fund, SRC.iit],
			{
				period,
				employment: { monthlyWage: wage, wageRegion: region, worksite: WORKSITE[region] },
				facts: { fundRate: [0.05, 0.08, 0.12][i % 3]!, injuryRate: 0.004 }
			}
		);
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
