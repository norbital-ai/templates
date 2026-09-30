/**
 * Deterministic TH scenario generator for the independent oracle (tests/e2e/oracle/TH.ts).
 *
 * Every scenario is one company, one employment and one monthly period, the shape a probe case takes
 * (tests/e2e/payroll-probe.ts: `profile: 'TH'`, `period`, one `employments` row, then leave / time / adjustment
 * rows). Each is tagged with the tracker rows (docs/inventory/thailand.csv) and branch names it exercises.
 * No Math.random: the only variation comes from a seeded mulberry32.
 */
import type { ExitCause, Scenario, Sector, WorkClass, Worksite } from '../oracle/TH';
import { addDays, addYears, monthEnd } from '../oracle/TH';

type Patch = {
	period?: string;
	company?: Partial<Scenario['company']>;
	employee?: Partial<Scenario['employee']>;
	time?: Partial<Scenario['time']>;
	leave?: Partial<Scenario['leave']>;
	bonus?: number;
	exit?: Scenario['exit'];
	steadyYear?: boolean;
};

const base = (): Omit<Scenario, 'id' | 'rows' | 'branches'> => ({
	period: '2026-03',
	company: { worksite: 'BANGKOK', sector: 'GENERAL', headcount: 50, floodReliefArea: false },
	employee: {
		birthDate: '1990-06-15',
		citizenship: 'TH',
		taxResident: true,
		hireDate: '2020-01-01',
		pay: { basis: 'MONTHLY', monthly: 30000 },
		normalDailyHours: 8,
		workClass: 'ORDINARY',
		providentFundMember: false,
		hazardous: false,
		pregnant: false,
		ly01: 0
	},
	time: { overtimeHours: 0, holidayWork: null },
	leave: {
		unpaidDays: 0,
		sick: { prior: 0, days: 0 },
		personal: { prior: 0, days: 0 },
		military: { prior: 0, days: 0 },
		maternityStart: null,
		childCareDays: 0,
		spouseBirthDays: 0,
		annualLeaveDays: 0
	},
	bonus: 0,
	exit: null,
	steadyYear: false
});

const exitOf = (date: string, cause: ExitCause, more: Partial<NonNullable<Scenario['exit']>> = {}) => ({
	date,
	cause,
	noticeGivenOn: null,
	carriedLeaveDays: 0,
	annualLeaveTakenThisYear: 0,
	relocationNoticePosted: false,
	technologyNotice60Days: false,
	...more
});

/** mulberry32: a seeded, deterministic PRNG */
const rng = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const cents = (x: number) => Math.round(x * 100) / 100;
const monthly = (m: number) => ({ basis: 'MONTHLY' as const, monthly: m });
const daily = (d: number, workedDays: number, paidTraditionalHolidays = 0) => ({
	basis: 'DAILY' as const,
	daily: d,
	workedDays,
	paidTraditionalHolidays
});

export function generateProfiles(): Scenario[] {
	const out: Scenario[] = [];
	const add = (id: string, rows: string[], branches: string[], p: Patch = {}) => {
		const b = base();
		out.push({
			id: `th-${id}`,
			rows,
			branches,
			period: p.period ?? b.period,
			company: { ...b.company, ...p.company },
			employee: { ...b.employee, ...p.employee },
			time: { ...b.time, ...p.time },
			leave: { ...b.leave, ...p.leave },
			bonus: p.bonus ?? 0,
			exit: p.exit ?? null,
			steadyYear: p.steadyYear ?? false
		});
	};
	const random = rng(0x7a11);

	// ---- minimum wage (N14) ----
	add('mw-bkk-monthly-floor', ['TH-WAGE-01'], ['monthly at 400 × 30'], { employee: { pay: monthly(12000) } });
	add('mw-bkk-monthly-below', ['TH-WAGE-01'], ['monthly day 399.99 refused'], { employee: { pay: monthly(11999.7) } });
	add('mw-bkk-daily-floor', ['TH-WAGE-01', 'TH-WORK-08'], ['daily 400'], { employee: { pay: daily(400, 22) } });
	add('mw-bkk-daily-below', ['TH-WAGE-01'], ['daily 399.99 refused'], { employee: { pay: daily(399.99, 22) } });
	const sectors: [Sector, string][] = [
		['HOTEL_TYPE_1', 'type 1 keeps geographic'],
		['HOTEL_TYPE_2', 'type 2 → 400'],
		['HOTEL_TYPE_3', 'type 3 → 400'],
		['HOTEL_TYPE_4', 'type 4 → 400'],
		['SERVICE_ESTABLISHMENT', 'service establishment → 400']
	];
	for (const [sector, branch] of sectors)
		for (const m of [11400, 11399.7, 12000, 11999.7]) {
			const rows = sector === 'SERVICE_ESTABLISHMENT' ? ['TH-WAGE-07', 'TH-WAGE-02'] : ['TH-WAGE-03', 'TH-WAGE-02'];
			add(`mw-hatyai-${sector.toLowerCase()}-${m}`, rows, [branch, 'Hat Yai district 380'], {
				company: { worksite: 'SONGKHLA_HAT_YAI', sector },
				employee: { pay: monthly(m) }
			});
		}
	add('mw-short-day-full-wage', ['TH-WAGE-04'], ['full normal-day wage, 7-hour day'], {
		employee: { pay: daily(400, 20), normalDailyHours: 7 }
	});

	// ---- SSO base, rate, rounding (SSA ss.5, 46; 2026 base regulation; flood notice) ----
	for (const d of [1, 2, 3, 4, 5])
		add(`sso-floor-daily-${d}d`, ['TH-SS-01', 'TH-SS-11', 'TH-WAGE-01'], ['1,650 floor', 'part-time daily'], {
			employee: { pay: daily(400, d) }
		});
	for (const m of [12000, 12009.8, 12010, 16490, 16500, 17490, 17499.99, 17500, 17500.01, 20000, 45000, 150000])
		add(`sso-2026-${m}`, ['TH-SS-01', 'TH-SS-11', 'TH-PIT-01', 'TH-PIT-20'], ['17,500 ceiling', 's.46 rounding seam'], {
			employee: { pay: monthly(m) }
		});
	for (const m of [12000, 14989.9, 14990, 14999.99, 15000, 15000.01, 20000])
		add(`sso-2025-12-${m}`, ['TH-SS-01', 'TH-SS-11', 'TH-PIT-01'], ['15,000 ceiling December 2025'], {
			period: '2025-12',
			employee: { pay: monthly(m) }
		});
	for (const period of ['2025-12', '2026-01', '2026-03', '2026-05', '2026-06'])
		for (const m of [12250, 17500, 30000])
			add(`sso-flood-${period}-${m}`, ['TH-SS-02', 'TH-SS-11', 'TH-PIT-20'], [period <= '2026-05' ? '3% flood month' : 'back to 5%'], {
				period,
				company: { floodReliefArea: true },
				employee: { pay: monthly(m) }
			});
	add('sso-flood-outside-area', ['TH-SS-02'], ['not in the area: 5%'], { period: '2026-01', employee: { pay: monthly(12250) } });

	// ---- SSO status by age (SSA s.33) ----
	const ageCase = (id: string, birth: string, hire: string, period: string, branch: string) =>
		add(`sso-age-${id}`, ['TH-SS-12', 'TH-PIT-20'], [branch], {
			period,
			employee: { birthDate: birth, hireDate: hire, pay: monthly(15000) }
		});
	ageCase('hired-14-before-15', '2011-02-10', '2026-01-05', '2026-01', 'under 15 not insured');
	ageCase('hired-14-turns-15', '2011-02-10', '2026-01-05', '2026-02', 'insured from the month of 15');
	ageCase('exactly-15-at-hire', '2011-03-01', '2026-03-01', '2026-03', '15 at hire insured');
	ageCase('hire-59', '1966-06-01', '2026-01-01', '2026-03', 'hire 59 insured');
	ageCase('hire-60', '1965-06-01', '2026-01-01', '2026-03', 'hire at 60 insured');
	ageCase('hire-60-day-before-61', '1965-01-02', '2026-01-01', '2026-03', 'hire at 60, day before 61');
	ageCase('hire-61', '1964-06-01', '2026-01-01', '2026-03', 'hire at 61 not insured');
	ageCase('hire-61-on-birthday', '1965-01-01', '2026-01-01', '2026-03', 'hire on 61st birthday not insured');
	ageCase('insured-55-now-62', '1964-01-15', '2019-02-01', '2026-03', 'insured person stays past 60');
	ageCase('hire-72', '1954-01-15', '2026-01-01', '2026-03', 'over 60 new hire');

	// ---- citizenship / residency (SSA s.33 no nationality test; RC s.50(1) no residence test) ----
	const citizens: [Scenario['employee']['citizenship'], boolean][] = [
		['TH', true],
		['FOREIGN', true],
		['FOREIGN', false],
		['TH', false]
	];
	for (let i = 0; i < 6; i++) {
		const m = cents(12000 + Math.floor(random() * 400000) / 2);
		for (const [citizenship, taxResident] of citizens)
			add(`res-${citizenship.toLowerCase()}-${taxResident ? 'res' : 'nonres'}-${i}`, ['TH-PIT-19', 'TH-SS-01', 'TH-PIT-01'], [
				`${citizenship} ${taxResident ? 'resident' : 'non-resident'}`
			], { employee: { citizenship, taxResident, pay: monthly(m) } });
	}

	// ---- PIT bands (RC s.48(1)) at every seam, 2026: net = 12S − 100,000 − 60,000 − 10,500 ----
	for (const seam of [150000, 300000, 500000, 750000, 1000000, 2000000, 5000000]) {
		const s = cents((seam + 170500) / 12);
		for (const [tag, m] of [['below', cents(s - 0.01)], ['at', s], ['above', cents(s + 0.01)]] as const)
			add(`pit-seam-${seam}-${tag}`, ['TH-PIT-01', 'TH-PIT-20'], [`net ${tag} ${seam}`], { employee: { pay: monthly(m) } });
	}
	// expense cap seam: 50% reaches 100,000 at 200,000 a year
	for (const m of [16666.66, 16666.67, 16666.68])
		add(`pit-expense-cap-${m}`, ['TH-PIT-01'], ['s.42 bis 100,000 cap seam'], { employee: { pay: monthly(m) } });
	for (const ly of [0, 30000, 90000, 250000])
		add(`pit-ly01-${ly}`, ['TH-PIT-06'], ['declared ล.ย.01 allowances'], { employee: { pay: monthly(60000), ly01: ly } });
	// mid-year joiners (P96 cl.1(1)): payments actually due
	for (const [hire, period, branch] of [
		['2026-04-01', '2026-04', 'April hire × 9'],
		['2026-04-15', '2026-04', 'mid-April hire, part month × 9'],
		['2026-04-30', '2026-04', 'last-day hire × 9'],
		['2026-04-01', '2026-05', 'second month × 9'],
		['2026-12-01', '2026-12', 'December hire × 1'],
		['2026-01-01', '2026-01', 'January hire × 12']
	] as const)
		add(`pit-joiner-${hire}-${period}`, ['TH-PIT-02', 'TH-WORK-05'], [branch], {
			period,
			employee: { hireDate: hire, pay: monthly(55000) }
		});
	// December remainder (P96 cl.1(3), cl.2)
	for (const m of [40000, 55555.55, 123456.78])
		add(`pit-december-remainder-${m}`, ['TH-PIT-02', 'TH-PIT-03'], ['December carries the remainder'], {
			period: '2026-12',
			employee: { pay: monthly(m) },
			steadyYear: true
		});

	// ---- bonus (P96 cl.1(5); LPA s.5 / TH-WORK-04: no statutory bonus; SSA s.5 outside) ----
	for (const [m, b] of [[20000, 20000], [30000, 60000], [60000, 120000], [150000, 300000], [12000, 5000]] as const)
		add(`bonus-${m}-${b}`, ['TH-PIT-03', 'TH-SS-13', 'TH-WORK-04'], ['occasional payment', 'outside SSO wage'], {
			employee: { pay: monthly(m) },
			bonus: b
		});
	add('bonus-december', ['TH-PIT-03'], ['bonus with December remainder'], {
		period: '2026-12',
		employee: { pay: monthly(50000) },
		bonus: 50000,
		steadyYear: true
	});

	// ---- overtime, holiday work (LPA ss.61–66, 68) ----
	for (const h of [1, 4, 10, 36])
		add(`ot-monthly-${h}h`, ['TH-WORK-02', 'TH-WORK-05', 'TH-WORK-06', 'TH-SS-13', 'TH-PIT-03'], ['s.61 1.5×'], {
			employee: { pay: monthly(18000) },
			time: { overtimeHours: h }
		});
	add('ot-monthly-7h-roster', ['TH-WORK-05'], ['divisor off a seven-hour day'], {
		employee: { pay: monthly(18000), normalDailyHours: 7 },
		time: { overtimeHours: 2 }
	});
	add('ot-daily-2h', ['TH-WORK-06'], ['daily s.61 1.5×'], { employee: { pay: daily(450, 22) }, time: { overtimeHours: 2 } });
	for (const kind of ['WEEKLY', 'TRADITIONAL'] as const) {
		add(`hw-monthly-${kind}`, ['TH-WORK-02', 'TH-WORK-06', 'TH-WORK-08', 'TH-SS-13'], ['s.62(1) +1×'], {
			employee: { pay: monthly(24000) },
			time: { holidayWork: { kind, hours: 8, overtimeHours: 2 } }
		});
		add(`hw-daily-${kind}`, ['TH-WORK-02', 'TH-WORK-06', 'TH-WORK-08'], [kind === 'WEEKLY' ? 's.62(2) 2×' : 's.62(1) +1× (holiday paid)'], {
			employee: { pay: daily(400, 21, kind === 'TRADITIONAL' ? 1 : 0) },
			time: { holidayWork: { kind, hours: 8, overtimeHours: 1 } }
		});
	}
	add('holiday-pay-daily-traditional', ['TH-WORK-08', 'TH-SS-13'], ['traditional holiday paid to daily staff'], {
		employee: { pay: daily(400, 21, 2) }
	});
	const classes: [WorkClass, string][] = [
		['S65_1_AUTHORITY', 's.65(1)/s.66 no OT, no s.62'],
		['S65_2_COMMISSION_SALES', 's.65(2) no OT, keeps s.62'],
		['S65_3_9_HOURLY', 's.65(3)–(9) hourly rate']
	];
	for (const [workClass, branch] of classes)
		add(`s65-${workClass.toLowerCase()}`, ['TH-WORK-06'], [branch], {
			employee: { pay: monthly(36000), workClass },
			time: { overtimeHours: 6, holidayWork: { kind: 'WEEKLY', hours: 8, overtimeHours: 2 } }
		});
	// refusals: s.31 hazardous, s.39/1 pregnant, s.48 under-18
	add('refuse-hazardous-ot', ['TH-WORK-07'], ['s.31 no OT in hazardous work'], {
		employee: { hazardous: true, normalDailyHours: 7 },
		time: { overtimeHours: 1 }
	});
	add('hazardous-no-ot', ['TH-WORK-07', 'TH-WAGE-04'], ['hazardous seven-hour day paid'], {
		employee: { hazardous: true, normalDailyHours: 7 }
	});
	add('refuse-pregnant-ot', ['TH-WORK-07', 'TH-HR-07'], ['s.39/1'], { employee: { pregnant: true }, time: { overtimeHours: 2 } });
	add('pregnant-no-ot', ['TH-HR-07'], ['paid ordinarily'], { employee: { pregnant: true } });
	add('refuse-minor-ot', ['TH-WORK-07', 'TH-HR-07'], ['s.48'], {
		employee: { birthDate: '2009-06-01', hireDate: '2025-07-01', pay: monthly(12000) },
		time: { overtimeHours: 1 }
	});
	add('refuse-minor-holiday', ['TH-HR-07'], ['s.48 holiday work'], {
		employee: { birthDate: '2009-06-01', hireDate: '2025-07-01', pay: monthly(12000) },
		time: { holidayWork: { kind: 'WEEKLY', hours: 4, overtimeHours: 0 } }
	});
	add('minor-17-ordinary', ['TH-HR-07', 'TH-SS-12'], ['17-year-old ordinary pay'], {
		employee: { birthDate: '2009-06-01', hireDate: '2025-07-01', pay: monthly(12000) }
	});

	// ---- leave (LPA ss.32–36, 56–59/2; Act No.9) ----
	for (const d of [1, 5, 30])
		add(`unpaid-${d}d`, ['TH-WORK-05', 'TH-SS-13', 'TH-PIT-02'], ['unpaid day at monthly ÷ 30'], { leave: { unpaidDays: d } });
	for (const [prior, days] of [[0, 3], [27, 3], [28, 3], [30, 1], [25, 10]] as const)
		add(`sick-${prior}+${days}`, ['TH-LEAVE-06', 'TH-SS-13'], ['paid to 30 working days'], { leave: { sick: { prior, days } } });
	for (const [prior, days] of [[0, 3], [2, 1], [3, 1], [0, 4]] as const)
		add(`personal-${prior}+${days}`, ['TH-LEAVE-07'], ['paid to 3 days'], { leave: { personal: { prior, days } } });
	for (const [prior, days] of [[0, 10], [55, 5], [58, 5], [60, 2]] as const)
		add(`military-${prior}+${days}`, ['TH-LEAVE-07'], ['paid to 60 days'], { leave: { military: { prior, days } } });
	add('annual-leave-3d', ['TH-LEAVE-05'], ['annual leave paid'], { leave: { annualLeaveDays: 3 } });
	for (const [start, period, branch] of [
		['2026-01-15', '2026-01', 'maternity first month all paid'],
		['2026-01-15', '2026-03', 'day 60 paid, day 61 unpaid in March'],
		['2026-01-01', '2026-03', 'days 60/61 seam 1 March'],
		['2026-01-01', '2026-04', 'days to 120 unpaid, back 1 May'],
		['2025-12-07', '2026-02', 'first day under Act No.9']
	] as const)
		add(`maternity-${start}-${period}`, ['TH-LEAVE-01', 'TH-SS-13'], [branch], {
			period,
			employee: { birthDate: '1994-02-02' },
			leave: { maternityStart: start }
		});
	for (const d of [5, 15, 16])
		add(`child-care-${d}d`, ['TH-LEAVE-02'], [d > 15 ? '16th day refused' : '50% paid'], { leave: { childCareDays: d } });
	for (const d of [5, 15, 16])
		add(`spouse-birth-${d}d`, ['TH-LEAVE-03'], [d > 15 ? '16th day refused' : 'fully paid'], { leave: { spouseBirthDays: d } });

	// ---- hire / exit proration (DEFAULT calendar days) ----
	for (const period of ['2026-02', '2026-04', '2026-05'])
		for (const day of ['01', '15', 'last']) {
			const d = day === 'last' ? monthEnd(period) : `${period}-${day}`;
			add(`hire-${d}`, ['TH-WORK-05', 'TH-PIT-02', 'TH-SS-01'], [`hire on ${day}`], {
				period,
				employee: { hireDate: d, pay: monthly(21000) }
			});
			add(`resign-${d}`, ['TH-EXIT-01', 'TH-EXIT-02', 'TH-HR-30'], [`resignation on ${day}`], {
				period,
				employee: { hireDate: '2022-07-01', pay: monthly(21000) },
				exit: exitOf(d, 'RESIGNATION', { carriedLeaveDays: day === 'last' ? 2 : 0 })
			});
		}

	// ---- severance ladder (LPA s.118) under an employer termination, exit 15 March 2026 ----
	const exitDay = '2026-03-15';
	const hireFor = (label: string) => {
		const m = /^(\d+)(d|y)(-1d|\+1d|\+181d|\+183d)?$/.exec(label)!;
		const n = +m[1]!;
		if (m[2] === 'd') return addDays(exitDay, -(n - 1));
		const exact = addYears(addDays(exitDay, 1), -n); // completes n years on the exit day
		const adj = m[3] === '-1d' ? 1 : m[3] === '+1d' ? -1 : m[3] === '+181d' ? -181 : m[3] === '+183d' ? -183 : 0;
		return addDays(exact, adj);
	};
	const ladder = ['119d', '120d', '1y-1d', '1y', '3y-1d', '3y', '5y-1d', '5y', '5y+183d', '6y-1d', '6y', '6y+1d', '10y-1d', '10y', '20y-1d', '20y', '25y'];
	for (const svc of ladder)
		for (const m of [21000, 90000]) {
			add(`sev-employer-${svc}-${m}`, ['TH-EXIT-01', 'TH-EXIT-03', 'TH-EXIT-04', 'TH-EXIT-02', 'TH-PIT-05'], [`service ${svc}`, 'no notice'], {
				employee: { hireDate: hireFor(svc), pay: monthly(m) },
				exit: exitOf(exitDay, 'EMPLOYER_TERMINATION')
			});
		}
	// notice (s.17): on payday, mid-month, a day after payday, served in full
	for (const [id, given, exit, branch] of [
		['on-payday', '2026-02-28', '2026-03-15', 'notice on payday effective next payday'],
		['day-after-payday', '2026-03-01', '2026-03-15', 'a day after payday owes the next month'],
		['served', '2026-01-31', '2026-03-31', 'notice served, nothing in lieu'],
		['given-exit-payday', '2026-03-31', '2026-03-31', 'removed on payday without notice']
	] as const)
		add(`notice-${id}`, ['TH-EXIT-04', 'TH-EXIT-01'], [branch], {
			period: exit.slice(0, 7),
			employee: { hireDate: '2023-05-10', pay: monthly(33000) },
			exit: exitOf(exit, 'EMPLOYER_TERMINATION', { noticeGivenOn: given })
		});
	// other causes across a service subset
	const causes: [ExitCause, string[], string][] = [
		['RESIGNATION', ['TH-EXIT-03', 'TH-EXIT-02'], 'resignation: no severance, carried leave only'],
		['DISMISSAL_S119', ['TH-EXIT-05', 'TH-EXIT-02', 'TH-EXIT-04'], 's.119: no severance, no notice'],
		['RETIREMENT', ['TH-EXIT-03', 'TH-PIT-05'], 'retirement is termination; not exempt'],
		['CONTRACT_EXPIRY', ['TH-EXIT-03', 'TH-PIT-05'], 'non-exempt fixed term; not exempt'],
		['FIXED_TERM_PROJECT_EXEMPT', ['TH-EXIT-03'], 'exempt project fixed term'],
		['RELOCATION_OBJECTION', ['TH-EXIT-06', 'TH-PIT-05'], 's.120 objection'],
		['TECHNOLOGY_RESTRUCTURING', ['TH-EXIT-07', 'TH-PIT-05'], 's.121/s.122']
	];
	for (const [cause, rows, branch] of causes)
		for (const svc of ['120d', '3y', '6y', '6y+1d', '6y+181d', '10y', '25y']) {
			const birth = cause === 'RETIREMENT' ? '1966-03-10' : '1985-06-15';
			add(`exit-${cause.toLowerCase()}-${svc}`, [...rows, 'TH-EXIT-01'], [branch, `service ${svc}`], {
				employee: { birthDate: birth, hireDate: hireFor(svc), pay: monthly(45000) },
				exit: exitOf(exitDay, cause, { carriedLeaveDays: 2, annualLeaveTakenThisYear: 0.5 })
			});
		}
	add('exit-relocation-notice-posted', ['TH-EXIT-06'], ['30 days posted: no in-lieu'], {
		employee: { hireDate: hireFor('3y'), pay: monthly(45000) },
		exit: exitOf(exitDay, 'RELOCATION_OBJECTION', { relocationNoticePosted: true })
	});
	for (const svc of ['6y', '10y'])
		add(`exit-technology-notice-60-${svc}`, ['TH-EXIT-07'], ['60 days notice given'], {
			employee: { hireDate: hireFor(svc), pay: monthly(45000) },
			exit: exitOf(exitDay, 'TECHNOLOGY_RESTRUCTURING', { technologyNotice60Days: true })
		});
	// s.67 leave encashment branches
	for (const [cause, carried, taken] of [
		['EMPLOYER_TERMINATION', 0, 0],
		['EMPLOYER_TERMINATION', 3, 1],
		['EMPLOYER_TERMINATION', 0, 6],
		['RESIGNATION', 3, 0],
		['DISMISSAL_S119', 3, 0]
	] as const)
		add(`encash-${cause.toLowerCase()}-${carried}-${taken}`, ['TH-EXIT-02'], ['s.67'], {
			period: '2026-09',
			employee: { hireDate: '2021-02-01', pay: monthly(30000) },
			exit: exitOf('2026-09-30', cause, { carriedLeaveDays: carried, annualLeaveTakenThisYear: taken, noticeGivenOn: '2026-07-31' })
		});
	// high earner: severance above the 600,000 exemption, ≥ 5 years (s.48(5)) and < 5 years (P.96 increment)
	for (const svc of ['4y', '5y', '20y'])
		add(`exit-high-${svc}`, ['TH-PIT-05', 'TH-EXIT-03'], ['MR 126 cl.2(51) 600,000 cap', svc === '4y' ? 'under 5 years' : 's.48(5)'], {
			employee: { hireDate: hireFor(svc), pay: monthly(250000) },
			exit: exitOf(exitDay, 'EMPLOYER_TERMINATION')
		});

	// ---- Employee Welfare Fund (LPA ss.130–131) ----
	for (const [hc, pf, m, period] of [
		[10, false, 30000, '2026-10'],
		[9, false, 30000, '2026-10'],
		[10, true, 30000, '2026-10'],
		[250, false, 12345.67, '2026-10'],
		[250, false, 80000, '2026-11'],
		[10, false, 30000, '2026-09']
	] as const)
		add(`ewf-${hc}-${pf ? 'pf' : 'nopf'}-${m}-${period}`, ['TH-EWF-01', 'TH-EWF-02'], [
			period < '2026-10' ? 'before commencement' : hc < 10 ? 'nine: not covered' : pf ? 'provident-fund member excluded' : '0.25% each side'
		], { period, company: { headcount: hc }, employee: { pay: monthly(m), providentFundMember: pf } });
	add('ewf-with-ot', ['TH-EWF-02', 'TH-SS-13'], ['OT outside the wage'], {
		period: '2026-10',
		employee: { pay: monthly(20000) },
		time: { overtimeHours: 5 }
	});
	add('ewf-unpaid-leave', ['TH-EWF-02'], ['unpaid days out'], { period: '2026-11', leave: { unpaidDays: 2 } });

	// ---- seeded mixed profiles (combinations) ----
	const worksites: Worksite[] = ['BANGKOK', 'SONGKHLA_HAT_YAI'];
	for (let i = 0; i < 30; i++) {
		const m = cents(12000 + Math.floor(random() * 120000));
		const period = ['2026-02', '2026-06', '2026-10', '2026-11'][Math.floor(random() * 4)]!;
		add(`mix-${i}`, ['TH-PIT-01', 'TH-SS-01', 'TH-WORK-06', 'TH-EWF-02'], ['combined'], {
			period,
			company: { worksite: worksites[Math.floor(random() * 2)]!, headcount: 5 + Math.floor(random() * 40) },
			employee: { pay: monthly(m), ly01: Math.floor(random() * 5) * 10000 },
			time: { overtimeHours: Math.floor(random() * 12) },
			leave: { unpaidDays: Math.floor(random() * 3) },
			bonus: random() < 0.25 ? Math.floor(random() * 50) * 1000 : 0
		});
	}
	return out;
}

/** every tracker row a scenario tags */
export const coveredRows = () => [...new Set(generateProfiles().flatMap((s) => s.rows))].sort();
