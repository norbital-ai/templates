/**
 * Deterministic JP payslip scenarios for the independent oracle (tests/e2e/oracle/JP.ts).
 *
 * Every scenario is one company (settings_code 'JP', pay_cutoff_day 1, MONTHLY) with one employment, run for one
 * calendar `period` — the probe harness's case shape (tests/e2e/payroll-probe.ts): the company carries the prefecture
 * (region), EI class and 労災 business type as company facts; the employee/employment/terms rows carry birth and hire
 * dates, the monthly salary, terms_facts.annual_scheduled_hours, withholding_column/withholding_dependants, the
 * resident-tax notice, and the HEALTH / EMPLOYMENT_INSURANCE registrations with the decided grade (config paths in
 * docs/inventory/japan.csv); `time` becomes leave rows and time entries on the officeWeek roster
 * (Mon–Fri scheduled, Saturday OFF, Sunday REST = 法定休日); `bonus` an ad hoc BONUS line; `exit` the exit facts.
 * The expected lines are `probeLines(computePayslip(s))` (it drops net/total_deductions when a line is `unsupported`,
 * and everything for a '*'); a bonus scenario also records the INCOME_TAX_BONUS election prior_month_net_pay as
 * `priorMonthNetPay(s)` from the oracle.
 *
 * Seeded (mulberry32), no Math.random: the same list every run.
 */
import type { Scenario } from '../oracle/JP';

const mulberry32 = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** HIA art.40 bands as the insurer decides them (KK 令和8年度 table) — a copy so the generator stays self-contained. */
const BANDS = [
	63_000, 73_000, 83_000, 93_000, 101_000, 107_000, 114_000, 122_000, 130_000, 138_000, 146_000,
	155_000, 165_000, 175_000, 185_000, 195_000, 210_000, 230_000, 250_000, 270_000, 290_000, 310_000,
	330_000, 350_000, 370_000, 395_000, 425_000, 455_000, 485_000, 515_000, 545_000, 575_000, 605_000,
	635_000, 665_000, 695_000, 730_000, 770_000, 810_000, 855_000, 905_000, 955_000, 1_005_000,
	1_055_000, 1_115_000, 1_175_000, 1_235_000, 1_295_000, 1_355_000
];
const GRADES = [
	58_000, 68_000, 78_000, 88_000, 98_000, 104_000, 110_000, 118_000, 126_000, 134_000, 142_000,
	150_000, 160_000, 170_000, 180_000, 190_000, 200_000, 220_000, 240_000, 260_000, 280_000, 300_000,
	320_000, 340_000, 360_000, 380_000, 410_000, 440_000, 470_000, 500_000, 530_000, 560_000, 590_000,
	620_000, 650_000, 680_000, 710_000, 750_000, 790_000, 830_000, 880_000, 930_000, 980_000,
	1_030_000, 1_090_000, 1_150_000, 1_210_000, 1_270_000, 1_330_000, 1_390_000
];
const grade = (pay: number) => GRADES[BANDS.filter((b) => pay >= b).length]!;

/** JP-RF rows: [prefecture, KK row, RF row, floors by 発効日] — the floors a generator needs to place salaries at seams. */
const PREFS: readonly (readonly [
	string,
	string,
	string,
	readonly (readonly [string, number])[]
])[] = [
	[
		'北海道',
		'JP-KK01',
		'JP-RF01',
		[
			['2025-10-04', 1075],
			['2026-10-01', 1131]
		]
	],
	[
		'青森県',
		'JP-KK02',
		'JP-RF02',
		[
			['2025-11-21', 1029],
			['2026-10-29', 1090]
		]
	],
	[
		'岩手県',
		'JP-KK03',
		'JP-RF03',
		[
			['2025-12-01', 1031],
			['2026-12-01', 1090]
		]
	],
	[
		'宮城県',
		'JP-KK04',
		'JP-RF04',
		[
			['2025-10-04', 1038],
			['2026-10-01', 1098]
		]
	],
	[
		'秋田県',
		'JP-KK05',
		'JP-RF05',
		[
			['2024-10-01', 951],
			['2026-03-31', 1031],
			['2026-10-14', 1090]
		]
	],
	[
		'山形県',
		'JP-KK06',
		'JP-RF06',
		[
			['2024-10-01', 955],
			['2025-12-23', 1032],
			['2026-10-30', 1092]
		]
	],
	[
		'福島県',
		'JP-KK07',
		'JP-RF07',
		[
			['2024-10-01', 955],
			['2026-01-01', 1033],
			['2026-10-16', 1094]
		]
	],
	[
		'茨城県',
		'JP-KK08',
		'JP-RF09',
		[
			['2025-10-12', 1074],
			['2026-10-18', 1136]
		]
	],
	[
		'栃木県',
		'JP-KK09',
		'JP-RF10',
		[
			['2025-10-01', 1068],
			['2026-10-01', 1125]
		]
	],
	[
		'群馬県',
		'JP-KK10',
		'JP-RF11',
		[
			['2024-10-01', 985],
			['2026-03-01', 1063],
			['2026-10-03', 1120]
		]
	],
	[
		'埼玉県',
		'JP-KK11',
		'JP-RF12',
		[
			['2025-11-01', 1141],
			['2026-10-01', 1196]
		]
	],
	[
		'千葉県',
		'JP-KK12',
		'JP-RF13',
		[
			['2025-10-03', 1140],
			['2026-10-01', 1195]
		]
	],
	[
		'東京都',
		'JP-KK13',
		'JP-RF08',
		[
			['2025-10-03', 1226],
			['2026-10-01', 1280]
		]
	],
	[
		'神奈川県',
		'JP-KK14',
		'JP-RF14',
		[
			['2025-10-04', 1225],
			['2026-10-01', 1279]
		]
	],
	[
		'新潟県',
		'JP-KK15',
		'JP-RF15',
		[
			['2025-10-02', 1050],
			['2026-10-01', 1108]
		]
	],
	[
		'富山県',
		'JP-KK16',
		'JP-RF16',
		[
			['2025-10-12', 1062],
			['2026-10-01', 1119]
		]
	],
	[
		'石川県',
		'JP-KK17',
		'JP-RF17',
		[
			['2025-10-08', 1054],
			['2026-10-03', 1113]
		]
	],
	[
		'福井県',
		'JP-KK18',
		'JP-RF18',
		[
			['2025-10-08', 1053],
			['2026-10-04', 1112]
		]
	],
	[
		'山梨県',
		'JP-KK19',
		'JP-RF19',
		[
			['2025-12-01', 1052],
			['2026-11-01', 1113]
		]
	],
	[
		'長野県',
		'JP-KK20',
		'JP-RF20',
		[
			['2025-10-03', 1061],
			['2026-10-02', 1117]
		]
	],
	[
		'岐阜県',
		'JP-KK21',
		'JP-RF21',
		[
			['2025-10-18', 1065],
			['2026-10-01', 1121]
		]
	],
	[
		'静岡県',
		'JP-KK22',
		'JP-RF22',
		[
			['2025-11-01', 1097],
			['2026-10-15', 1154]
		]
	],
	[
		'愛知県',
		'JP-KK23',
		'JP-RF23',
		[
			['2025-10-18', 1140],
			['2026-10-01', 1195]
		]
	],
	[
		'三重県',
		'JP-KK24',
		'JP-RF26',
		[
			['2025-11-21', 1087],
			['2026-10-01', 1143]
		]
	],
	[
		'滋賀県',
		'JP-KK25',
		'JP-RF27',
		[
			['2025-10-05', 1080],
			['2026-10-03', 1136]
		]
	],
	[
		'京都府',
		'JP-KK26',
		'JP-RF24',
		[
			['2025-11-21', 1122],
			['2026-11-16', 1180]
		]
	],
	[
		'大阪府',
		'JP-KK27',
		'JP-RF25',
		[
			['2025-10-16', 1177],
			['2026-10-01', 1231]
		]
	],
	[
		'兵庫県',
		'JP-KK28',
		'JP-RF28',
		[
			['2025-10-04', 1116],
			['2026-10-01', 1172]
		]
	],
	[
		'奈良県',
		'JP-KK29',
		'JP-RF29',
		[
			['2025-11-16', 1051],
			['2026-10-04', 1107]
		]
	],
	[
		'和歌山県',
		'JP-KK30',
		'JP-RF30',
		[
			['2025-11-01', 1045],
			['2026-10-03', 1101]
		]
	],
	[
		'鳥取県',
		'JP-KK31',
		'JP-RF31',
		[
			['2025-10-04', 1030],
			['2026-10-03', 1090]
		]
	],
	[
		'島根県',
		'JP-KK32',
		'JP-RF32',
		[
			['2025-11-17', 1033],
			['2026-10-10', 1092]
		]
	],
	[
		'岡山県',
		'JP-KK33',
		'JP-RF33',
		[
			['2025-12-01', 1047],
			['2026-10-02', 1104]
		]
	],
	[
		'広島県',
		'JP-KK34',
		'JP-RF34',
		[
			['2025-11-01', 1085],
			['2026-10-11', 1141]
		]
	],
	[
		'山口県',
		'JP-KK35',
		'JP-RF35',
		[
			['2025-10-16', 1043],
			['2026-10-08', 1101]
		]
	],
	[
		'徳島県',
		'JP-KK36',
		'JP-RF36',
		[
			['2024-10-01', 980],
			['2026-01-01', 1046],
			['2026-11-01', 1103]
		]
	],
	[
		'香川県',
		'JP-KK37',
		'JP-RF37',
		[
			['2025-10-18', 1036],
			['2026-10-01', 1092]
		]
	],
	[
		'愛媛県',
		'JP-KK38',
		'JP-RF38',
		[
			['2025-12-01', 1033],
			['2026-11-01', 1093]
		]
	],
	[
		'高知県',
		'JP-KK39',
		'JP-RF39',
		[
			['2025-12-01', 1023],
			['2026-10-29', 1086]
		]
	],
	[
		'福岡県',
		'JP-KK40',
		'JP-RF40',
		[
			['2025-11-16', 1057],
			['2026-10-04', 1114]
		]
	],
	[
		'佐賀県',
		'JP-KK41',
		'JP-RF41',
		[
			['2025-11-21', 1030],
			['2026-11-15', 1095]
		]
	],
	[
		'長崎県',
		'JP-KK42',
		'JP-RF42',
		[
			['2025-12-01', 1031],
			['2026-11-02', 1087]
		]
	],
	[
		'熊本県',
		'JP-KK43',
		'JP-RF44',
		[
			['2024-10-01', 952],
			['2026-01-01', 1034],
			['2026-12-01', 1092]
		]
	],
	[
		'大分県',
		'JP-KK44',
		'JP-RF43',
		[
			['2024-10-01', 954],
			['2026-01-01', 1035],
			['2026-11-01', 1096]
		]
	],
	[
		'宮崎県',
		'JP-KK45',
		'JP-RF45',
		[
			['2025-11-16', 1023],
			['2026-10-24', 1085]
		]
	],
	[
		'鹿児島県',
		'JP-KK46',
		'JP-RF46',
		[
			['2025-11-01', 1026],
			['2026-10-25', 1090]
		]
	],
	[
		'沖縄県',
		'JP-KK47',
		'JP-RF47',
		[
			['2025-12-01', 1023],
			['2026-12-02', 1086]
		]
	]
];
const floorOn = (floors: readonly (readonly [string, number])[], day: string) =>
	[...floors].reverse().find(([from]) => from <= day)![1];

type Patch = {
	period?: string;
	company?: Partial<Scenario['company']>;
	employee?: Partial<Scenario['employee']>;
	time?: Partial<Scenario['time']>;
	bonus?: Scenario['bonus'];
	exit?: Partial<NonNullable<Scenario['exit']>> & { date: string };
};

const HOURS = 2016; // 8h × 252 days: 168 scheduled hours a month

function mk(id: string, rows: string[], branches: string[], p: Patch = {}): Scenario {
	const salary = p.employee?.monthlySalary ?? 300_000;
	const commuting = p.employee?.commuting ?? null;
	return {
		id: `jp-${id}`,
		rows: [...new Set(rows)],
		branches,
		profile: 'JP',
		period: p.period ?? '2026-06',
		company: {
			prefecture: '東京都',
			eiClass: 'GENERAL',
			wcBusinessType: '94',
			wcMeritRate: null,
			...p.company
		},
		employee: {
			birthDate: '1990-05-15',
			hireDate: '2020-04-01',
			nationality: 'JP',
			taxResident: true,
			monthlySalary: salary,
			dailyHours: 8,
			annualScheduledHours: HOURS,
			commuting,
			withholding: { column: 'KOU', dependants: 0, method: 'TABLE' },
			residentTax: null,
			health: { registered: true, grade: grade(salary + (commuting?.amount ?? 0)) },
			pensionCertificate: false,
			employmentInsurance: { registered: true, category: 'GENERAL' },
			premiumExemptMonths: [],
			...p.employee
		},
		time: { unpaidLeaveDays: [], paidLeaveDays: [], work: [], ...p.time },
		bonus: p.bonus ?? null,
		exit: p.exit
			? {
					cause: 'RESIGNATION',
					noticeDays: 30,
					retirementAllowance: 0,
					retirementDeclaration: true,
					residentTaxLumpRequested: false,
					...p.exit
				}
			: null
	};
}

const weekdays = (period: string) => {
	const n = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).getUTCDate();
	return Array.from({ length: n }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`).filter(
		(d) => {
			const w = new Date(`${d}T00:00:00Z`).getUTCDay();
			return w >= 1 && w <= 5;
		}
	);
};
const day = (date: string, start: string, end: string, breakMinutes = 60) => ({
	date,
	start,
	end,
	breakMinutes
});

export function generateProfiles(): Scenario[] {
	const rnd = mulberry32(0x4a50); // 'JP'
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
	const out: Scenario[] = [];
	const push = (...s: Scenario[]) => void out.push(...s);

	// ---- A. regional minimum wage per prefecture, each branch rate (令和7 then 令和8) ----
	for (const [pref, kk, rf, floors] of PREFS) {
		const feb = floorOn(floors, '2026-02-01') * (HOURS / 12);
		const jul = floorOn(floors, '2026-07-01') * (HOURS / 12);
		push(
			mk(
				`mw-${rf}-below`,
				[
					rf,
					kk,
					'JP-MW-01',
					'JP-MWR-02',
					'JP-MW01',
					'JP-SI-02',
					'JP-SI-05',
					'JP-RND-04',
					'JP-EIR-01',
					'JP-WC-01'
				],
				[
					'salary one yen below the monthly floor: floor substituted',
					'令和7 branch rate (insurance month 2026-01)',
					'care off'
				],
				{
					period: '2026-02',
					company: { prefecture: pref },
					employee: { monthlySalary: feb - 1, health: { registered: true, grade: grade(feb) } }
				}
			),
			mk(
				`mw-${rf}-at`,
				[
					rf,
					kk,
					'JP-MW-01',
					'JP-MWR-02',
					'JP-SI-02',
					'JP-SI-14',
					'JP-SI-18',
					'JP-SI-19',
					'JP-EIR-01',
					'JP-EI-02'
				],
				[
					'salary exactly at the monthly floor: kept',
					'令和8 branch rate (insurance month 2026-06)',
					'支援金 0.23%'
				],
				{
					period: '2026-07',
					company: { prefecture: pref },
					employee: {
						monthlySalary: jul,
						birthDate: pick(['1990-05-15', '1980-03-10', '1970-11-20'])
					}
				}
			)
		);
	}
	const tokyoFloor = 1226 * (HOURS / 12);
	push(
		mk('mw-tokyo-above', ['JP-RF08', 'JP-MW-01', 'JP-MWR-02'], ['one yen above the floor'], {
			employee: { monthlySalary: tokyoFloor + 1 }
		})
	);
	// straddling a 発効日 inside the period: the higher floor governs the work from its effective day
	const straddles: readonly (readonly [string, string, string, string])[] = [
		['山形県', 'JP-RF06', '2025-12', '2025-12-23'],
		['秋田県', 'JP-RF05', '2026-03', '2026-03-31'],
		['群馬県', 'JP-RF11', '2026-03', '2026-03-01'],
		['東京都', 'JP-RF08-R8', '2026-10', '2026-10-01'],
		['北海道', 'JP-RF01-R8', '2026-10', '2026-10-01'],
		['奈良県', 'JP-RF29-R8', '2026-10', '2026-10-04'],
		['京都府', 'JP-RF24-R8', '2026-11', '2026-11-16']
	];
	for (const [pref, rf, period, from] of straddles) {
		const floors = PREFS.find(([p]) => p === pref)![3];
		const old = floorOn(floors, `${period}-01`) * (HOURS / 12);
		push(
			mk(
				`mw-straddle-${rf}`,
				[rf, 'JP-MW-01', 'JP-MWR-02', 'JP-SCOPE-01'],
				[`salary at the old floor; new floor from ${from} governs the later work days`],
				{
					period,
					company: { prefecture: pref },
					employee: {
						monthlySalary: old,
						health: { registered: true, grade: grade(floorOn(floors, from) * (HOURS / 12)) }
					}
				}
			)
		);
	}
	// a 令和8年度 floor still AWAITING-LAW: binding → nothing pinnable; salary above it → an ordinary payslip
	push(
		mk(
			'mw-awaiting-binding',
			['JP-RF02-R8', 'JP-MW-01', 'JP-SCOPE-01'],
			['青森 2026-10-29 floor not enacted and binding: unsupported'],
			{
				period: '2026-11',
				company: { prefecture: '青森県' },
				employee: { monthlySalary: 1029 * (HOURS / 12) }
			}
		),
		mk(
			'mw-awaiting-clear',
			['JP-RF02-R8', 'JP-MW-01', 'JP-KK02'],
			['salary above the unenacted floor: unaffected'],
			{ period: '2026-11', company: { prefecture: '青森県' }, employee: { monthlySalary: 250_000 } }
		)
	);

	// ---- B. standard monthly remuneration grade seams (HIA art.40, EPIA art.20) ----
	for (const pay of [82_999, 83_000, 92_999, 93_000])
		push(
			mk(
				`grade-${pay}`,
				['JP-SI-20', 'JP-SI-19', 'JP-SI-03', 'JP-SI-01', 'JP-SI-05'],
				[
					pay < 93_000 ? 'pension floor grade 88,000' : 'pension grade 2',
					'short-time 15h/week, not EI-insured'
				],
				{
					employee: {
						monthlySalary: pay,
						dailyHours: 3,
						annualScheduledHours: 756,
						employmentInsurance: { registered: false, category: 'GENERAL' }
					}
				}
			)
		);
	for (const pay of [634_999, 635_000, 664_999, 665_000, 1_354_999, 1_355_000, 2_000_000])
		push(
			mk(
				`grade-${pay}`,
				['JP-SI-20', 'JP-SI-19', 'JP-SI-03', 'JP-SI-05', 'JP-TAX-18'],
				[
					pay >= 635_000 ? 'pension capped at 650,000' : 'pension grade 31',
					pay >= 1_355_000 ? 'health top grade 1,390,000' : 'health band'
				],
				{ employee: { monthlySalary: pay } }
			)
		);

	// ---- C. age transitions per insurance month (AGE; 年齢計算ニ関スル法律) ----
	const ages: readonly (readonly [string, string, string, string[]])[] = [
		['1986-06-01', '2026-06', 'care starts: 40 attained 2026-05-31', ['JP-SI-21', 'JP-SI-12']],
		['1986-06-02', '2026-06', 'care not yet: 40 attained 2026-06-01', ['JP-SI-21', 'JP-SI-12']],
		['1986-03-01', '2026-03', 'care starts in February (1.59%)', ['JP-SI-21', 'JP-SI-12']],
		['1986-03-02', '2026-03', 'care not yet in February', ['JP-SI-21', 'JP-SI-12']],
		// 1986 has no 29 February, and a 29 February birth always turns 40 in a leap year: the edge is at 70
		[
			'1956-02-29',
			'2026-03',
			'leap birthday: 70th on 1 March, attained 28 February — no pension for February',
			['JP-SI-12', 'JP-SI-19']
		],
		['1961-06-01', '2026-06', 'care stops: 65 attained 2026-05-31', ['JP-SI-21', 'JP-SI-12']],
		['1961-06-02', '2026-06', 'care continues in May', ['JP-SI-21', 'JP-SI-12']],
		['1956-06-01', '2026-06', 'pension stops: 70 attained 2026-05-31', ['JP-SI-12', 'JP-SI-19']],
		['1956-06-02', '2026-06', 'pension continues in May', ['JP-SI-12', 'JP-SI-19']],
		['1951-06-01', '2026-06', 'health for May: 75th birthday 2026-06-01', ['JP-SI-12']],
		['1951-05-31', '2026-06', 'no health for May: 75th birthday 2026-05-31', ['JP-SI-12']],
		['1951-05-02', '2026-06', 'no health for May: 75th birthday mid-month', ['JP-SI-12']]
	];
	for (const [birthDate, period, branch, rows] of ages)
		push(
			mk(`age-${birthDate}`, [...rows, 'JP-KK13', 'JP-SI-02', 'JP-SI-24'], [branch], {
				period,
				employee: { birthDate, hireDate: '2010-04-01' }
			})
		);

	// ---- D. hire and exit dates (JP-PRO-01 WORKING_DAYS; JP-SI-24 premium months) ----
	for (const hire of ['2026-06-01', '2026-06-16', '2026-06-30']) {
		const salary = 280_000 + Math.floor(rnd() * 40) * 1_000;
		push(
			mk(
				`hire-${hire}`,
				['JP-PRO-01', 'JP-SI-24', 'JP-LS03', 'JP-EI-02'],
				['joiner month: no premium deducted yet', `hired ${hire}`],
				{ employee: { hireDate: hire, monthlySalary: salary } }
			),
			mk(
				`hire-${hire}-next`,
				['JP-SI-24', 'JP-SI-02'],
				['month after joining: the acquisition month is deducted'],
				{ period: '2026-07', employee: { hireDate: hire, monthlySalary: salary } }
			)
		);
	}
	for (const exit of ['2026-06-30', '2026-06-15', '2026-06-01'])
		push(
			mk(
				`exit-${exit}`,
				['JP-PRO-01', 'JP-SI-24', 'JP-SI-12', 'JP-LS02', 'JP-AL-05'],
				[
					exit.endsWith('30')
						? 'month-end leaver: May and June deducted'
						: 'mid-month leaver: May only',
					'unused leave not paid out'
				],
				{ exit: { date: exit } }
			)
		);
	push(
		mk(
			'same-month-in-out',
			['JP-SI-24', 'JP-SI-12', 'JP-PRO-01'],
			['同月得喪: acquisition and loss in June charge June'],
			{ employee: { hireDate: '2026-06-08' }, exit: { date: '2026-06-19' } }
		),
		mk(
			'short-stay-month-end',
			['JP-SI-24', 'JP-PRO-01'],
			['hired 18 May, left 30 June: May and June deducted'],
			{ employee: { hireDate: '2026-05-18' }, exit: { date: '2026-06-30' } }
		),
		mk(
			'hire-dec-jan',
			['JP-SI-24', 'JP-SI-02', 'JP-KK13'],
			['December 2025 acquisition deducted from January 2026 at 令和7'],
			{ period: '2026-01', employee: { hireDate: '2025-12-01' } }
		)
	);

	// ---- E. unpaid and paid leave ----
	const june = weekdays('2026-06');
	push(
		mk('unpaid-1', ['JP-PRO-01', 'JP-LS03'], ['one unpaid scheduled day'], {
			time: { unpaidLeaveDays: [june[3]!] }
		}),
		mk('unpaid-3', ['JP-PRO-01', 'JP-LS03'], ['three unpaid days'], {
			time: { unpaidLeaveDays: june.slice(5, 8) }
		}),
		mk(
			'unpaid-all',
			['JP-PRO-01', 'JP-LS03', 'JP-SI-02'],
			['whole month unpaid: premiums still due on the grade'],
			{ time: { unpaidLeaveDays: june } }
		),
		mk(
			'paid-leave-2',
			['JP-AL-04', 'JP-LS07', 'JP-AL-01'],
			['two paid annual-leave days at the ordinary wage: no deduction'],
			{ time: { paidLeaveDays: june.slice(10, 12) } }
		),
		mk('paid-and-unpaid', ['JP-AL-04', 'JP-PRO-01'], ['paid and unpaid leave in one month'], {
			time: { paidLeaveDays: [june[1]!], unpaidLeaveDays: [june[2]!] }
		})
	);

	// ---- F. hours and premiums (hourly 2,000 = 336,000 ÷ 168) ----
	const OT = ['JP-OT-02', 'JP-LAB-03', 'JP-LS06', 'JP-OT-06', 'JP-RND-03', 'JP-LS05', 'JP-LAB-02'];
	const ot = (
		id: string,
		rows: string[],
		branch: string,
		work: Scenario['time']['work'],
		extra: Patch = {}
	) =>
		push(
			mk(`ot-${id}`, [...OT, ...rows], [branch], {
				...extra,
				employee: { monthlySalary: 336_000, ...extra.employee },
				time: { work, ...extra.time }
			})
		);
	ot('8h0', [], '8.0h day: no overtime', [day('2026-06-10', '09:00', '18:00')]);
	ot('8h1', [], '8.1h day: 6 minutes at 125%', [day('2026-06-10', '09:00', '18:06')]);
	ot('1h', [], 'one hour past 8h at 125%', [day('2026-06-10', '09:00', '19:00')]);
	ot('night', ['JP-OT-04'], '22:00–23:00 overtime at 150%', [day('2026-06-10', '09:00', '23:00')]);
	// LSA arts.37(4), 41(2); MHLW https://www.mhlw.go.jp/content/11201250/001288488.pdf.
	ot(
		'manager-night',
		['JP-OT-04'],
		'manager: 22:00–23:00 night premium only',
		[day('2026-06-10', '09:00', '23:00')],
		{ employee: { supervisoryManager: true } }
	);
	ot(
		'manager-rest-night',
		['JP-OT-04'],
		'manager statutory rest: night premium only',
		[day('2026-06-14', '21:59', '22:01', 0)],
		{ employee: { supervisoryManager: true } }
	);
	ot(
		'manager-night-end',
		['JP-OT-04'],
		'manager statutory rest: 04:59–05:01 one night minute only',
		[day('2026-06-14', '04:59', '05:01', 0)],
		{ employee: { supervisoryManager: true } }
	);
	ot('night-2159', ['JP-OT-04'], 'ends 21:59: no night minute', [
		day('2026-06-10', '09:00', '21:59')
	]);
	ot('past-midnight', ['JP-OT-04'], 'work to 02:00 next day', [
		day('2026-06-10', '09:00', '26:00')
	]);
	ot('saturday', ['JP-LS05'], 'Saturday after a full 40h week: all 125%', [
		day('2026-06-06', '09:00', '17:00')
	]);
	ot(
		'saturday-short-week',
		['JP-LS05', 'JP-LAB-02'],
		'Saturday in a week with an unpaid day: within 40h, 125% (所定休日 default), not in the 60h count',
		[day('2026-06-06', '09:00', '17:00')],
		{ time: { unpaidLeaveDays: ['2026-06-03'], work: [day('2026-06-06', '09:00', '17:00')] } }
	);
	ot('sunday', ['JP-OT-03'], 'statutory rest day at 135%', [day('2026-06-07', '09:00', '18:00')]);
	ot('sunday-night', ['JP-OT-03', 'JP-OT-04'], 'statutory rest day into the night: 160%', [
		day('2026-06-14', '09:00', '24:00')
	]);
	ot(
		'saturday-short-week-60h',
		['JP-OT-05'],
		'Saturday within 40h does not push the month past 60h',
		[
			...june
				.filter((d) => d !== '2026-06-05')
				.slice(0, 20)
				.map((d) => day(d, '09:00', '21:00')),
			day('2026-06-06', '09:00', '13:00', 0)
		],
		{ time: { unpaidLeaveDays: ['2026-06-05'] } }
	);
	ot(
		'60h-exact',
		['JP-OT-05'],
		'exactly 60h overtime: no 150% tier',
		june.slice(0, 20).map((d) => day(d, '09:00', '21:00'))
	);
	ot('60h-plus-1min', ['JP-OT-05'], '60h + 1 minute: one minute at 150%', [
		...june.slice(0, 20).map((d) => day(d, '09:00', '21:00')),
		day(june[20]!, '09:00', '18:01')
	]);
	ot(
		'77h',
		['JP-OT-05'],
		'77h overtime: 17h at 150%',
		june.map((d) => day(d, '09:00', '21:30'))
	);
	// 労働基準法 §36(6)(ii): overtime plus statutory-holiday work stays under 100 hours a month even under a special clause
	ot(
		'99h-night',
		['JP-OT-04', 'JP-OT-05', 'JP-OT-01'],
		'99h overtime with night hours: 175% beyond 60h',
		june.map((d) => day(d, '09:00', '22:30'))
	);
	ot('mixed', ['JP-OT-03', 'JP-OT-04'], 'weekday, Saturday and Sunday work in one month', [
		day('2026-06-09', '09:00', '22:30'),
		day('2026-06-13', '10:00', '15:00', 0),
		day('2026-06-21', '09:00', '13:00', 0)
	]);
	ot('dec-2025', ['JP-KK13'], 'overtime at 令和7 EI rate', [day('2025-12-10', '09:00', '20:00')], {
		period: '2025-12'
	});
	ot(
		'parttime-inlaw',
		['JP-OT-02'],
		'6h part-timer working 7h: one hour 法内 at 100%',
		[day('2026-06-10', '09:00', '17:00')],
		{ employee: { monthlySalary: 180_000, dailyHours: 6, annualScheduledHours: 1512 } }
	);
	ot(
		'parttime-9h',
		['JP-OT-02'],
		'6h part-timer working 9h: 2h at 100%, 1h at 125%',
		[day('2026-06-10', '09:00', '19:00')],
		{ employee: { monthlySalary: 180_000, dailyHours: 6, annualScheduledHours: 1512 } }
	);

	// ---- G. employment insurance ----
	for (const [cls, row] of [
		['GENERAL', 'JP-EIR-01'],
		['AGRICULTURE_SAKE', 'JP-EIR-02'],
		['CONSTRUCTION', 'JP-EIR-03']
	] as const)
		for (const period of ['2026-03', '2026-04'])
			push(
				mk(
					`ei-${cls}-${period}`,
					[row, 'JP-EI-02', 'JP-EI02', 'JP-EI-03', 'JP-WC-01'],
					[
						period === '2026-03'
							? '令和7年度 rate (closing 2026-03-31)'
							: '令和8年度 rate (closing 2026-04-30)'
					],
					{
						period,
						company: {
							eiClass: cls,
							wcBusinessType:
								cls === 'CONSTRUCTION' ? '35' : cls === 'AGRICULTURE_SAKE' ? '41' : '94'
						},
						employee: { monthlySalary: 250_000 + Math.floor(rnd() * 100) * 1_000 }
					}
				)
			);
	push(
		mk('ei-unregistered', ['JP-EI-01', 'JP-EI01'], ['NOT_REGISTERED: no premium'], {
			employee: { employmentInsurance: { registered: false, category: 'GENERAL' } }
		}),
		mk('ei-under-20h', ['JP-EI-01', 'JP-EI01'], ['REGISTERED GENERAL at 15h/week: refused'], {
			employee: { monthlySalary: 100_000, dailyHours: 3, annualScheduledHours: 756 }
		}),
		mk('ei-20h', ['JP-EI-01', 'JP-EI01'], ['REGISTERED GENERAL at exactly 20h/week'], {
			employee: { monthlySalary: 110_000, dailyHours: 4, annualScheduledHours: 1008 }
		}),
		mk('ei-multijob-65', ['JP-EI-05'], ['MULTI_JOB_65 under 20h charged on own wages'], {
			employee: {
				birthDate: '1959-04-10',
				monthlySalary: 90_000,
				dailyHours: 3,
				annualScheduledHours: 756,
				employmentInsurance: { registered: true, category: 'MULTI_JOB_65' }
			}
		}),
		mk('ei-round-1500.5', ['JP-EI-03', 'JP-RND-01'], ['employee 1,500.50 → 1,500'], {
			employee: { monthlySalary: 300_100 }
		}),
		mk('ei-round-1500.51', ['JP-EI-03', 'JP-RND-01'], ['employee 1,500.51 → 1,501'], {
			employee: { monthlySalary: 300_102 }
		}),
		mk('ei-round-r7-down', ['JP-EI-03'], ['令和7: 1,650.495 → 1,650'], {
			period: '2026-02',
			employee: { monthlySalary: 300_090 }
		}),
		mk('ei-round-r7-up', ['JP-EI-03'], ['令和7: 1,650.55 → 1,651'], {
			period: '2026-02',
			employee: { monthlySalary: 300_100 }
		}),
		mk('ei-fy2027', ['JP-EI-02'], ['closing 2027-04-30: 令和9年度 rates unpublished, refused'], {
			period: '2027-04'
		})
	);

	// ---- H. workers' compensation types ----
	for (const t of ['02', '35', '41', '53', '72', '98', '90'])
		push(
			mk(`wc-${t}`, ['JP-WC-01'], [`労災 business type ${t}`], { company: { wcBusinessType: t } })
		);
	push(
		mk('wc-merit', ['JP-WC-01'], ['recorded メリット制 rate 2.2/1,000'], {
			company: { wcBusinessType: '94', wcMeritRate: 2.2 }
		})
	);

	// ---- I. bonuses ----
	const B = [
		'JP-SI-04',
		'JP-SI-15',
		'JP-SI-05',
		'JP-TAX-21',
		'JP-TAX-01',
		'JP-EI02',
		'JP-EI-03',
		'JP-SI-18',
		'JP-WC-01'
	];
	const bonus = (amount: number, priorFiscalStandardBonus = 0, exempt = false) => ({
		amount,
		priorFiscalStandardBonus,
		exempt
	});
	push(
		mk('bonus-floor-1000', [...B, 'JP-SI-14'], ['standard bonus floored to 1,000'], {
			bonus: bonus(500_500)
		}),
		mk('bonus-pension-cap-under', B, ['1,500,999 → pension standard 1,500,000'], {
			bonus: bonus(1_500_999)
		}),
		mk('bonus-pension-cap-over', B, ['1,501,000: pension capped at 1,500,000'], {
			bonus: bonus(1_501_000)
		}),
		mk('bonus-2m', B, ['2,000,000: pension capped, health full'], { bonus: bonus(2_000_000) }),
		mk('bonus-health-cap-partial', B, ['prior 5,000,000: health standard 730,000'], {
			bonus: bonus(800_000, 5_000_000)
		}),
		mk('bonus-health-cap-full', B, ['prior 5,730,000: no health bonus premium'], {
			bonus: bonus(800_000, 5_730_000)
		}),
		mk('bonus-health-cap-edge', B, ['prior 5,729,000: 1,000 left'], {
			bonus: bonus(600_000, 5_729_000)
		}),
		mk('bonus-feb-r7', [...B, 'JP-KK13'], ['February 2026 bonus at 令和7 rates'], {
			period: '2026-02',
			bonus: bonus(400_000)
		}),
		mk('bonus-mar-r8', [...B, 'JP-KK13'], ['March 2026 bonus at 令和8 health rate, no 支援金'], {
			period: '2026-03',
			bonus: bonus(400_000)
		}),
		mk('bonus-apr-cs', [...B, 'JP-SI-14'], ['April 2026 bonus: 支援金 on the bonus'], {
			period: '2026-04',
			bonus: bonus(400_000)
		}),
		mk(
			'bonus-exit-month-end',
			[...B, 'JP-SI-12'],
			['bonus in a month-end exit month: premium-bearing'],
			{ bonus: bonus(300_000), exit: { date: '2026-06-30' } }
		),
		mk('bonus-exit-mid', [...B, 'JP-SI-12'], ['bonus in the loss month: no premium'], {
			bonus: bonus(300_000),
			exit: { date: '2026-06-15' }
		}),
		mk('bonus-exempt', [...B, 'JP-SI-07'], ['childcare-exempt bonus month'], {
			bonus: bonus(300_000, 0, true),
			employee: { premiumExemptMonths: ['2026-05', '2026-06'] }
		}),
		mk('bonus-care-40', [...B, 'JP-SI-21'], ['care attained in the bonus month'], {
			bonus: bonus(300_000),
			employee: { birthDate: '1986-06-02' }
		}),
		mk('bonus-10x', [...B], ['bonus over 10× prior-month pay: monthly-table method'], {
			bonus: bonus(4_000_000)
		}),
		mk('bonus-no-prior', [...B, 'JP-SI-24'], ['joiner with no prior-month pay'], {
			employee: { hireDate: '2026-06-01' },
			bonus: bonus(300_000)
		}),
		mk('bonus-otsu', [...B, 'JP-TAX-19'], ['乙欄 bonus rate'], {
			employee: { withholding: { column: 'OTSU', dependants: 0, method: 'TABLE' } },
			bonus: bonus(400_000)
		}),
		mk('bonus-nonresident', [...B, 'JP-TAX-11'], ['nonresident: 20.42% of the bonus'], {
			employee: { taxResident: false, nationality: 'FOREIGN' },
			bonus: bonus(400_000)
		})
	);
	for (const n of [2, 7, 8])
		push(
			mk(`bonus-dep-${n}`, B, [`甲 bonus rate with ${n} dependants`], {
				employee: {
					monthlySalary: 420_000,
					withholding: { column: 'KOU', dependants: n, method: 'TABLE' }
				},
				bonus: bonus(900_000)
			})
		);

	// ---- J. monthly withholding ----
	const T = ['JP-TAX-01', 'JP-TAX-18', 'JP-TAX-22', 'JP-RND-02'];
	for (let n = 0; n <= 8; n++)
		push(
			mk(`tax-kou-${n}`, T, [`甲欄 ${n} dependants`], {
				employee: { withholding: { column: 'KOU', dependants: n, method: 'TABLE' } }
			})
		);
	for (const [n, pay] of [
		[0, 300_000],
		[2, 300_000],
		[0, 900_000],
		[3, 900_000]
	] as const)
		push(
			mk(`tax-electronic-${n}-${pay}`, [...T, 'JP-TAX-23'], ['電算機計算の特例'], {
				employee: {
					monthlySalary: pay,
					withholding: { column: 'KOU', dependants: n, method: 'ELECTRONIC' }
				}
			})
		);
	for (const pay of [1_000_000, 2_500_000, 4_000_000])
		push(
			mk(`tax-kou-high-${pay}`, T, ['甲欄 above 740,000: base plus percentage'], {
				employee: {
					monthlySalary: pay,
					withholding: { column: 'KOU', dependants: 1, method: 'TABLE' }
				}
			})
		);
	push(
		mk('tax-otsu-300k', [...T, 'JP-TAX-19'], ['乙欄'], {
			employee: { withholding: { column: 'OTSU', dependants: 0, method: 'TABLE' } }
		})
	);
	// A = pay exactly (no social insurance): the table's own seams
	const bare = {
		health: { registered: false, grade: 0 },
		employmentInsurance: { registered: false, category: 'GENERAL' as const }
	};
	for (const [pay, col, hours] of [
		[104_999, 'KOU', 3],
		[105_000, 'KOU', 3],
		[104_999, 'OTSU', 3],
		[105_000, 'OTSU', 3],
		[739_999, 'KOU', 8],
		[740_000, 'KOU', 8],
		[740_001, 'KOU', 8],
		[1_710_000, 'OTSU', 8],
		[1_710_001, 'OTSU', 8]
	] as const)
		push(
			mk(`tax-seam-${col}-${pay}`, [...T, 'JP-TAX-19', 'JP-SI-01'], [`${col} at A = ${pay}`], {
				employee: {
					monthlySalary: pay,
					dailyHours: hours,
					annualScheduledHours: hours === 3 ? 756 : HOURS,
					withholding: { column: col, dependants: 0, method: 'TABLE' },
					...bare
				}
			})
		);
	push(
		mk(
			'tax-dec-2025',
			['JP-TAX-01', 'JP-TAX-29', 'JP-KK13'],
			['pay due 2025-12-31: 令和7年分 table (unsupported)'],
			{ period: '2025-12' }
		),
		mk(
			'tax-dec-2026-kou',
			['JP-TAX-03', 'JP-TAX-15'],
			['December 甲欄: year-end adjustment (unsupported)'],
			{ period: '2026-12' }
		),
		mk(
			'tax-dec-2026-otsu',
			['JP-TAX-03', 'JP-TAX-19'],
			['December 乙欄: no year-end adjustment, table as usual'],
			{
				period: '2026-12',
				employee: { withholding: { column: 'OTSU', dependants: 0, method: 'TABLE' } }
			}
		),
		mk('tax-dec-2026-nonresident', ['JP-TAX-03', 'JP-TAX-11'], ['December nonresident: 20.42%'], {
			period: '2026-12',
			employee: { taxResident: false }
		}),
		mk('tax-2027-01', ['JP-TAX-22'], ['pay due January 2027: 令和9年分 (unsupported)'], {
			period: '2027-01'
		}),
		mk('tax-nonresident-jp', ['JP-TAX-11'], ['Japanese national nonresident: 20.42%'], {
			employee: { taxResident: false }
		}),
		mk('tax-nonresident-foreign', ['JP-TAX-11', 'JP-HR-07'], ['foreign nonresident: 20.42%'], {
			employee: { taxResident: false, nationality: 'FOREIGN' }
		}),
		mk(
			'tax-foreign-resident',
			['JP-TAX-18', 'JP-HR-07'],
			['foreign resident: taxed as a resident'],
			{
				employee: {
					nationality: 'FOREIGN',
					withholding: { column: 'KOU', dependants: 1, method: 'TABLE' }
				}
			}
		)
	);
	const C = ['JP-TAX-02', 'JP-TAX-07', 'JP-TAX-07-BANDS', 'JP-EI02', 'JP-OT-06', 'JP-MW02'];
	push(
		mk('comm-transit', C, ['public transport under 150,000'], {
			employee: { commuting: { mode: 'TRANSIT', amount: 20_000, km: 0 } }
		}),
		mk('comm-transit-over', C, ['public transport 160,000: 10,000 taxable'], {
			employee: { commuting: { mode: 'TRANSIT', amount: 160_000, km: 0 } }
		})
	);
	for (const [km, period] of [
		[1.9, '2026-06'],
		[2, '2026-06'],
		[9.9, '2026-06'],
		[10, '2026-06'],
		[64.9, '2026-06'],
		[65, '2026-06'],
		[65, '2026-03'],
		[95, '2026-06']
	] as const)
		push(
			mk(`comm-vehicle-${km}-${period}`, C, [`vehicle ${km} km, paid ${period}`], {
				period,
				employee: { commuting: { mode: 'VEHICLE', amount: 50_000, km } }
			})
		);
	push(
		mk('comm-parking', C, ['vehicle 20 km + parking 6,000 (from April 2026): band + 5,000'], {
			employee: { commuting: { mode: 'VEHICLE', amount: 25_000, km: 20, parking: 6_000 } }
		}),
		mk('comm-parking-1km', C, ['vehicle 1.9 km: no band, no parking'], {
			employee: { commuting: { mode: 'VEHICLE', amount: 8_000, km: 1.9, parking: 3_000 } }
		}),
		mk('comm-parking-march', C, ['pay due March 2026: parking not yet exempt'], {
			period: '2026-03',
			employee: { commuting: { mode: 'VEHICLE', amount: 25_000, km: 20, parking: 5_000 } }
		}),
		mk('comm-mixed', C, ['transit 30,000 + vehicle 12 km'], {
			employee: { commuting: { mode: 'MIXED', amount: 45_000, km: 12, transitFare: 30_000 } }
		}),
		mk('comm-mixed-cap', C, ['transit 140,000 + vehicle 30 km: capped at 150,000'], {
			employee: { commuting: { mode: 'MIXED', amount: 170_000, km: 30, transitFare: 140_000 } }
		})
	);
	push(
		mk('comm-with-ot', [...C, 'JP-OT-02'], ['commuting excluded from the overtime base'], {
			employee: { monthlySalary: 336_000, commuting: { mode: 'TRANSIT', amount: 15_000, km: 0 } },
			time: { work: [day('2026-06-10', '09:00', '20:00')] }
		})
	);

	// ---- K. resident tax ----
	const R = ['JP-RES-01', 'JP-LT02'];
	const rt = { june: 18_300, monthly: 17_900 };
	push(
		mk('rt-june', R, ['June installment'], { employee: { residentTax: rt } }),
		mk('rt-july', R, ['July–May installment'], {
			period: '2026-07',
			employee: { residentTax: rt }
		}),
		mk(
			'rt-exit-feb',
			[...R, 'JP-LT03', 'JP-RES-04'],
			['January–April exit: February–May collected in one amount'],
			{ period: '2026-02', employee: { residentTax: rt }, exit: { date: '2026-02-28' } }
		),
		mk(
			'rt-exit-apr-insufficient',
			[...R, 'JP-LT03'],
			['April exit, final pay too small for the lump'],
			{
				period: '2026-04',
				employee: { residentTax: { june: 60_000, monthly: 60_000 } },
				time: { unpaidLeaveDays: weekdays('2026-04').slice(0, 20) },
				exit: { date: '2026-04-30' }
			}
		),
		mk('rt-exit-aug', [...R, 'JP-LT03'], ['August exit, no request: ordinary installment'], {
			period: '2026-08',
			employee: { residentTax: rt },
			exit: { date: '2026-08-31' }
		}),
		mk('rt-exit-aug-lump', [...R, 'JP-LT03'], ['August exit, lump requested: August–May'], {
			period: '2026-08',
			employee: { residentTax: rt },
			exit: { date: '2026-08-31', residentTaxLumpRequested: true }
		}),
		mk(
			'rt-exit-aug-lump-allowance',
			[...R, 'JP-LT03', 'JP-RES-04', 'JP-RES-02', 'JP-LT04'],
			['August lump from pay plus a retirement allowance'],
			{
				period: '2026-08',
				employee: { residentTax: { june: 90_000, monthly: 90_000 } },
				time: { unpaidLeaveDays: weekdays('2026-08').slice(0, 18) },
				exit: { date: '2026-08-31', residentTaxLumpRequested: true, retirementAllowance: 1_000_000 }
			}
		),
		mk('rt-exit-may', [...R, 'JP-LT03'], ['May exit: the last installment only'], {
			period: '2026-05',
			employee: { residentTax: rt },
			exit: { date: '2026-05-31' }
		})
	);

	// ---- L. exit causes: notice pay and retirement income ----
	const X = ['JP-LAB-06', 'JP-LS02', 'JP-AL-05'];
	for (const notice of [0, 10, 29, 30])
		push(
			mk(
				`dismiss-notice-${notice}`,
				[...X, 'JP-WG-03', 'JP-WG-01', 'JP-TAX-25', 'JP-TAX-26'],
				[`dismissal with ${notice} days' notice`],
				{ exit: { date: '2026-06-30', cause: 'DISMISSAL', noticeDays: notice } }
			)
		);
	const RT = [...X, 'JP-TAX-25', 'JP-TAX-26', 'JP-TAX-04', 'JP-RES-02', 'JP-LT04'];
	const ret = (
		id: string,
		hire: string,
		allowance: number,
		branch: string,
		extra: Partial<NonNullable<Scenario['exit']>> = {},
		employee: Partial<Scenario['employee']> = {}
	) =>
		push(
			mk(`ret-${id}`, RT, [branch], {
				employee: { hireDate: hire, ...employee },
				exit: { date: '2026-06-30', retirementAllowance: allowance, ...extra }
			})
		);
	ret('5y-3m', '2021-07-01', 5_000_000, 'short-term (5 years): excess exactly 3,000,000');
	ret('5y-3m1k', '2021-07-01', 5_001_000, 'short-term: excess 3,001,000, full excess above 3m');
	ret('6y', '2021-06-30', 5_001_000, '5 years and a day = 6 years: general 1/2');
	ret('20y', '2006-07-01', 12_000_000, '20 years: 400,000 × 20');
	ret('21y', '2006-06-30', 12_000_000, '20 years and a day = 21 years: 8m + 700,000');
	ret('1y-min', '2025-07-01', 700_000, 'one year: minimum deduction 800,000, nothing taxable');
	ret('1y-over', '2025-07-01', 900_000, 'one year: 100,000 over the minimum');
	ret('no-declaration', '2016-04-01', 3_000_000, 'no 申告書: 20.42% of the whole', {
		retirementDeclaration: false
	});
	ret(
		'nonresident',
		'2016-04-01',
		3_000_000,
		'nonresident: 20.42%, no retirement resident tax',
		{},
		{ taxResident: false, nationality: 'FOREIGN' }
	);
	ret(
		'20y-seam',
		'2006-07-01',
		8_000_000,
		'20 years, allowance equal to the deduction: nothing taxable'
	);
	ret(
		'10y-100',
		'2016-07-01',
		4_002_300,
		'excess 2,300 → half 1,150 → 1,000: resident tax 60 + 40 truncated to 0'
	);
	ret('10y-resident-100', '2016-07-01', 4_040_000, 'taxable 20,000: 市 1,200 + 県 800');
	ret(
		'retirement-age',
		'1990-04-01',
		20_000_000,
		'retirement at 60 after 37 years',
		{ cause: 'RETIREMENT_AGE' },
		{ birthDate: '1966-06-15' }
	);
	push(
		mk('exit-contract-end', X, ['fixed term ended: no notice pay'], {
			employee: { hireDate: '2025-07-01' },
			exit: { date: '2026-06-30', cause: 'CONTRACT_END', noticeDays: 0 }
		}),
		mk('exit-resign-mid', [...X, 'JP-PRO-01'], ['resignation on the 19th'], {
			exit: { date: '2026-06-19' }
		})
	);

	// ---- M. exemptions and registration ----
	push(
		mk(
			'exempt-maternity',
			['JP-SI-23', 'JP-SI-07', 'JP-SI-14'],
			['maternity-exempt insurance month May'],
			{ employee: { premiumExemptMonths: ['2026-05'] } }
		),
		mk('exempt-childcare-next', ['JP-SI-07'], ['exemption ended: June deducted in July'], {
			period: '2026-07',
			employee: { premiumExemptMonths: ['2026-05'] }
		}),
		mk(
			'ssa-pension-certificate',
			['JP-SI-10', 'JP-SI-11', 'JP-SI-18'],
			['certificate of coverage: no 厚生年金 or 拠出金, health stays'],
			{ employee: { nationality: 'FOREIGN', pensionCertificate: true } }
		),
		mk('health-not-registered', ['JP-SI-01'], ['NOT_REGISTERED: no health, pension or 拠出金'], {
			employee: { health: { registered: false, grade: 0 } }
		}),
		mk('parttime-30h', ['JP-SI-01', 'JP-EI01', 'JP-HR-02'], ['6h × 5 days part-timer, insured'], {
			employee: { monthlySalary: 200_000, dailyHours: 6, annualScheduledHours: 1512 }
		})
	);
	return out;
}

export const coveredRows = () => [...new Set(generateProfiles().flatMap((s) => s.rows))].sort();
