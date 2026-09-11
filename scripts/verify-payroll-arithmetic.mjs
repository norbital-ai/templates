// Standalone arithmetic gate invoked directly from the payroll README.

/**
 * Arithmetic verification for the payroll engine.
 *
 * This workspace has no test runner — there is no `vitest` dependency and no `test` script — so the
 * assertions that would be a `.test.ts` live here instead, as a script that can be run directly:
 *
 * ```
 * cd templates/hr-payroll
 * node scripts/verify-payroll-arithmetic.mjs
 * ```
 *
 * The engine modules are TypeScript, so they are loaded through Vite's SSR module graph, which
 * resolves the `.js` specifiers TypeScript writes back to their `.ts` sources. Only pure modules
 * are exercised: nothing here touches a database.
 *
 * Every case below is one where the arithmetic is not obvious, and every one of them is a place a
 * plausible-looking reimplementation gets a different number.
 */

import { createServer } from 'vite';
import { OPAQUE_TO_PROBE } from './fixture-shape-probe.mjs';
import { Effect, Result } from 'effect';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Both tallies are records, kept the same way, so the summary reads off one shape. */
const passes = [];
const failures = [];

function check(name, actual, expected) {
	const ok =
		typeof expected === 'number' && typeof actual === 'number'
			? Math.abs(actual - expected) < 1e-9
			: isDeepStrictEqual(actual, expected);
	if (ok) passes.push(name);
	else
		failures.push(
			`${name}\n    expected ${JSON.stringify(expected)}\n    received ${JSON.stringify(actual)}`
		);
}

function throws(name, fn) {
	const result = Effect.runSync(Effect.result(Effect.try(fn)));
	if (Result.isSuccess(result)) {
		failures.push(`${name}\n    expected a thrown error, received none`);
	} else {
		passes.push(name);
	}
}

// repository-health:allow EFF3 -- This standalone Node entry must await Vite's asynchronous SSR module graph before running its synchronous arithmetic assertions.
const modules = await Effect.runPromise(
	Effect.acquireUseRelease(
		Effect.tryPromise(() =>
			createServer({
				root,
				configFile: false,
				logLevel: 'error',
				server: { middlewareMode: true, hmr: false }
			})
		),
		(server) => {
			const load = (name) =>
				Effect.tryPromise(() =>
					server.ssrLoadModule(`/src/collections/payroll_runs/lib/${name}.ts`)
				);
			return Effect.all([
				load('rounding'),
				load('bands'),
				load('special-rules'),
				load('contribute'),
				load('period'),
				load('dates'),
				Effect.tryPromise(() => server.ssrLoadModule('/src/lib/leave/payroll.ts')),
				load('settlement'),
				load('overtime'),
				Effect.tryPromise(() => server.ssrLoadModule('/src/lib/payroll/work.ts')),
				load('coverage'),
				load('ordinary-rate'),
				load('eligibility'),
				Effect.tryPromise(() => server.ssrLoadModule('/src/lib/payroll/money.ts')),
				load('settle')
			]);
		},
		(server) => Effect.tryPromise(() => server.close())
	)
);
const [
	{ roundMoney, floorHalfHour, cents },
	{ selectBand, bandFloor },
	{ bracketBase, parseSpecialRules },
	{ contribute, scaleProgressive },
	{ attendanceWindow, defaultPayPeriod, payPeriodsRemaining, resolveWindow },
	{ inclusiveDays, dateKey: calendarDay },
	{ leavePayrollInputs },
	{ resolveEmploymentSettlement },
	{
		classifyOvertimeByCalendarMonth,
		deriveDailyOvertime,
		nightWindowHours,
		priceDay,
		regulatedMonthlyOvertimeHours
	},
	{ isStatutoryOvertimePayCovered },
	{ classifyWageComparand, deriveStatutoryWages },
	{
		ordinaryHourlyRate: hourlyRateOf,
		ordinaryDayWage: dayWageOf,
		absenceDayRate,
		resolveOrdinaryRate
	},
	{ personContext },
	{ allowanceRequest, paymentRequest, claimRequest, requestPayPeriod },
	{ settle }
] = modules;

/**
 * The rate row is chosen the way payroll chooses it: by the Work's own predicates, against this
 * person's week. It used to be `ordinary_rate[0]` — which never exercised the choice at all, and
 * so did not notice when the Philippine six-day factor stopped being a branch in the engine and
 * became a row in the Work.
 */
const rateFor = (terms, work) =>
	resolveOrdinaryRate({
		rows: work.ordinary_rate,
		// The eligibility evaluator classifies every value it is given by type, and a Proxy has no
		// type it can name. Marking the context keeps the fixture-shape probe out of it; every other
		// argument in this file is still observed.
		person: Object.assign(
			{ [OPAQUE_TO_PROBE]: true },
			personContext({
				// Complete rather than convenient: this file's fixtures are what `verify-fixture-shapes`
				// proxies, and a key the engine reads but the fixture omits reads `undefined` and takes a
				// branch nobody intended. Only the week and the payroll group steer a rate row.
				employee: {
					gender: null,
					date_of_birth: '1985-04-02',
					nationality: null,
					marital_status: 'SINGLE',
					spouse_status: 'NONE',
					solo_parent: false,
					race: null,
					religion: null
				},
				employment: { hire_date: '2020-01-01' },
				terms: {
					residency_status: 'CITIZEN',
					employment_type: 'PERMANENT',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					base_salary: terms.base_salary,
					department: null,
					payroll_group: terms.payroll_group ?? '',
					grade: null,
					residency_since: null
				},
				week: {
					ordinary_hours_per_week: terms.ordinary_hours_per_week,
					working_days_per_week: terms.working_days_per_week
				},
				children: [],
				company: { region: null },
				asOf: '2026-06-30'
			})
		),
		workingDays: () => 26,
		employeeNumber: 'FIXTURE'
	});
const ordinaryHourlyRate = (terms, work) => hourlyRateOf(terms, work, rateFor(terms, work));
const ordinaryDayWage = (terms, work) => dayWageOf(terms, work, rateFor(terms, work));
const PH_NIGHT = { from: '22:00', to: '06:00' };

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Rounding — the five methods, including the ties this data is full of.
// ────────────────────────────────────────────────────────────────────────────────────────────────
check('NEAREST_CENT rounds a genuine tie up', roundMoney(81.375, 'NEAREST_CENT'), 81.38);
check('NEAREST_CENT survives float error', roundMoney(0.1 + 0.2, 'NEAREST_CENT'), 0.3);
check('TRUNCATE_CENT rounds toward zero', roundMoney(97.1499, 'TRUNCATE_CENT'), 97.14);
check('UP_5_CENTS always rounds up', roundMoney(97.14, 'UP_5_CENTS'), 97.15);
check('UP_5_CENTS leaves an exact multiple alone', roundMoney(97.15, 'UP_5_CENTS'), 97.15);
check('UP_TO_UNIT is EPF’s next whole ringgit', roundMoney(373.99, 'UP_TO_UNIT'), 374);
check('UP_TO_UNIT leaves a whole unit alone', roundMoney(374, 'UP_TO_UNIT'), 374);
check(
	'TABLE is the identity — a tabled amount is published, not computed',
	roundMoney(81.35, 'TABLE'),
	81.35
);

// ────────────────────────────────────────────────────────────────────────────────────────────────
// The overtime floor — half an hour down, and no one-hour minimum.
// ────────────────────────────────────────────────────────────────────────────────────────────────
check('3.25 h floors to 3.0', floorHalfHour(3.25), 3);
check('1.9 h floors to 1.5', floorHalfHour(1.9), 1.5);
check('0.4 h floors away entirely — there is no one-hour minimum', floorHalfHour(0.4), 0);
check('2.5 h is already a half hour', floorHalfHour(2.5), 2.5);
/*
 * A rest day worked. This row used to carry `overtime_authorized` and a five-hour approved bucket,
 * and the bucket was taken as the payable duration. Both columns are gone: the clock is the only
 * account of the day there is, so the same row now earns what it was actually at work for.
 */
const restDayPunches = {
	id: 'rest-day-entry',
	work_date: '2026-01-17',
	worked_intervals: [
		{ start: '2026-01-17T08:29:00.000+08:00', end: '2026-01-17T13:41:00.000+08:00' }
	],
	break_minutes: 60
};
const restDayScheduled = {
	date: '2026-01-17',
	dayType: 'REST_DAY',
	shift: null,
	clampStart: '08:30',
	normalHours: 8.5
};
check(
	'a rest day is priced from the clock: 08:30–13:41 less an hour, floored to the half hour',
	deriveDailyOvertime(restDayPunches, restDayScheduled)?.hours,
	4
);
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Settlement — which run an employment's money lands in.
//
// Every figure below is the customer's own salary listing, so these are not invented cases: they
// are the rows the workbook already contains, and matching them is the whole test.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const COMPANY_A = { pay_cutoff_day: 21, pay_frequency: 'MONTHLY' };
const companyAWindow = (period) => resolveWindow(period, COMPANY_A);
// The three settlement rules are the engine's only behaviour: a late joiner is deferred and paid
// as arrears in their first run, a leaver settles in their final period prorated to the exit
// date, and every unpaid day settles in the window that contains it.
const settle_ = (period, hire, exit) =>
	resolveEmploymentSettlement({ dates: { hire, exit }, window: companyAWindow(period) });

// Twenty-one January UL dates, but only the thirteen through 20 January belong to the
// January payroll. The eight dates from 21–30 January settle in February under the ordinary cutoff.
const january0048UnpaidDates = [
	'2026-01-04',
	'2026-01-05',
	'2026-01-06',
	'2026-01-07',
	'2026-01-08',
	'2026-01-09',
	'2026-01-12',
	'2026-01-13',
	'2026-01-14',
	'2026-01-15',
	'2026-01-16',
	'2026-01-19',
	'2026-01-20',
	'2026-01-21',
	'2026-01-22',
	'2026-01-23',
	'2026-01-26',
	'2026-01-27',
	'2026-01-28',
	'2026-01-29',
	'2026-01-30'
];
const january0048Window = companyAWindow('2026-01').attendance;
const january0048SettledDates = january0048UnpaidDates.filter(
	(date) => date >= january0048Window.start && date <= january0048Window.end
);
check(
	'21 January unpaid-leave dates stop at the 20 January cutoff',
	january0048SettledDates.length,
	13
);
check(
	'13-day January NPL through cutoff reproduces expected amount',
	roundMoney(
		roundMoney(1768 / 31, 'NEAREST_CENT') * january0048SettledDates.length,
		'NEAREST_CENT'
	),
	741.39
);

// ── Rule 1: a joining period the run cannot see is deferred, not part-paid ──────────────────────
//
// A late joiner joined 23 Feb 2026. The February salary listing has no row for them at all, and the
// March one pays basic 4,000 with back-pay basic 857.14 beside it — 4,000 x 6/28, the six days
// 23-28 February. A second case joined 22 April, absent from the April listing,
// and May pays 2,300 with `back_pay_basic` 690 — 2,300 x 9/30.
const feb0397 = settle_('2026-02', '2026-02-23', null);
check('a joiner after the window closes produces no February payslip', feb0397.runs, false);
check('their February is deferred to March', feb0397.deferral?.paidInPeriod, '2026-03');
check('the deferral covers 23-28 February', feb0397.deferral?.days, {
	start: '2026-02-23',
	end: '2026-02-28'
});
check(
	'the workbook’s 857.14 is 4000 x those six days over February',
	roundMoney(4000 * (inclusiveDays('2026-02-23', '2026-02-28') / 28), 'NEAREST_CENT'),
	857.14
);
const mar0397 = settle_('2026-03', '2026-02-23', null);
check('March runs them', mar0397.runs, true);
check('and knows it owes February', mar0397.arrearsFor?.period, '2026-02');
check('March itself is only March', mar0397.employedDays, {
	start: '2026-03-01',
	end: '2026-03-31'
});
// The arrears is measured against February's OWN window, which this employment has no day inside.
// The days they did work — 23 to 28 February — are in the 21 Feb - 20 Mar window this run already
// reads, so their clocks are paid here once, not once here and again inside the back pay. It is
// why every late joiner in the source workbook has an empty `back_pay_ot`.
check('the arrears reads February’s own window', mar0397.arrearsFor?.attendance, {
	start: '2026-01-21',
	end: '2026-02-20'
});
check(
	'which the joiner has no day inside',
	mar0397.arrearsFor.attendance.end < mar0397.arrearsFor.days.start,
	true
);
check('while the tail they worked sits in March’s window', mar0397.attendance, {
	start: '2026-02-21',
	end: '2026-03-20'
});
check('the arrears prorates over February, not March', mar0397.arrearsFor?.salary, {
	start: '2026-02-01',
	end: '2026-02-28'
});
check('and covers exactly the days they were employed then', mar0397.arrearsFor?.days, {
	start: '2026-02-23',
	end: '2026-02-28'
});
check(
	'nothing is owed once the deferred month is behind them',
	settle_('2026-04', '2026-02-23', null).arrearsFor,
	null
);
// Where the two rules meet, the final-pay rule wins: there is no next run to defer into, and
// deferring anyway would strand the wage forever.
const bothRules = settle_('2026-04', '2026-04-22', '2026-04-29');
check('someone who joins and leaves inside one period is not deferred', bothRules.runs, true);
check('their period is settled here', bothRules.deferral, null);
check('over exactly the days they were employed', bothRules.employedDays, {
	start: '2026-04-22',
	end: '2026-04-29'
});
check('with the window extended to cover them', bothRules.attendance, {
	start: '2026-03-21',
	end: '2026-04-29'
});
const apr0400 = settle_('2026-04', '2026-04-22', null);
check('late joiner after window close defers April period', apr0400.runs, false);
check('covering 22-30 April', apr0400.deferral?.days, {
	start: '2026-04-22',
	end: '2026-04-30'
});
check(
	'which is the workbook’s 690 exactly',
	roundMoney(2300 * (inclusiveDays('2026-04-22', '2026-04-30') / 30), 'NEAREST_CENT'),
	690
);
// The boundary is the window, not the number 21. A joiner on 6 April is paid in April because
// summary pays them 900 x 25/30 for April, because 6 April is inside the March-21-to-April-20
// window the April run reads.
check(
	'a joiner on the 6th is paid in the month they join',
	settle_('2026-04', '2026-04-06', null).runs,
	true
);
check(
	'a joiner on the last day the window covers is still paid that month',
	settle_('2026-04', '2026-04-20', null).runs,
	true
);
check('the day after it is not', settle_('2026-04', '2026-04-21', null).runs, false);

// ── Rule 2: a leaver in the tail settles now, because there is no later run ─────────────────────
//
// A leaver's last day was 27 April 2026. Their April payslip deducts 48.05 of unpaid leave —
// half a day at 2,883/30 — for a half-day taken on 21 April. Under the plain window that day sits
// in the MAY run, which they are not in, so the deduction would simply never be taken.
const apr0082 = settle_('2026-04', '2020-03-09', '2026-04-27');
check('a leaver in the tail still runs', apr0082.runs, true);
check('and their window is extended to the exit date', apr0082.attendance, {
	start: '2026-03-21',
	end: '2026-04-27'
});
check('so the 21 April absence is inside it', apr0082.attendance.end >= '2026-04-21', true);
check(
	'half a day at 2883/30 is the workbook’s 48.05',
	roundMoney(roundMoney(2883 / 30, 'NEAREST_CENT') * 0.5, 'NEAREST_CENT'),
	48.05
);
check(
	'a leaver before the cutoff needs no extension',
	settle_('2026-01', '2023-05-15', '2026-01-15').attendance,
	{ start: '2025-12-21', end: '2026-01-20' }
);
check(
	'a leaver on the last day of the month extends to it',
	settle_('2026-03', '2023-01-04', '2026-03-31').attendance.end,
	'2026-03-31'
);
check(
	'a leaver’s recurring wages are prorated to the exit date, never the full month',
	settle_('2026-02', '2022-03-05', '2026-02-27').wageDays,
	{ start: '2026-02-01', end: '2026-02-27' }
);
check(
	'and is never deferred — rule 2 is the mirror of rule 1, not a copy of it',
	settle_('2026-03', '2023-01-04', '2026-03-31').deferral,
	null
);

// ── Rule 3: every unpaid day settles in the window that contains it ────────────────────────────
//
// An employee was on unpaid leave from 1 December 2025 to 30 January 2026, with the rostered rest
// days showing as gaps. The 21 Jan to 20 Feb window contains eight of those days, and the February
// run takes exactly those eight; there is no leave-of-absence override that moves them.
const N0340 = [
	...[
		'01',
		'03',
		'04',
		'05',
		'06',
		'07',
		'08',
		'10',
		'11',
		'12',
		'13',
		'14',
		'15',
		'17',
		'18',
		'19',
		'20',
		'21',
		'22',
		'24',
		'26',
		'27',
		'28',
		'29',
		'31'
	].map((day) => `2025-12-${day}`),
	...[
		'01',
		'02',
		'03',
		'04',
		'05',
		'07',
		'08',
		'09',
		'10',
		'11',
		'12',
		'14',
		'15',
		'16',
		'17',
		'18',
		'19',
		'21',
		'22',
		'23',
		'26',
		'27',
		'28',
		'29',
		'30'
	].map((day) => `2026-01-${day}`)
];
const NPL_TYPE = '00000000-0000-4000-8000-00000000000a';
const leave0340 = {
	id: 'leave:n0340',
	employment_id: 'employment:n0340',
	leave_catalogue_id: NPL_TYPE,
	leave_code: 'UNPAID_LEAVE',
	reference: 'N0340',
	event: {
		kind: 'TIME_OFF',
		range: {
			start: { date: N0340[0], half: 'FIRST' },
			end: { date: N0340.at(-1), half: 'SECOND' }
		},
		chargeable_days: N0340.length,
		reason: 'Approved absence'
	},
	charges: N0340.map((date) => ({
		date,
		days: 1,
		leave_catalogue_id: NPL_TYPE,
		employment_term_id: 'terms:n0340',
		calendar_id: 'calendar:2026',
		shift_definition_id: 'shift:day',
		work_day_id: null
	})),
	allocations: [],
	approval_id: null
};
const february = companyAWindow('2026-02');
check(
	'the plain window drags eight January days into February',
	leavePayrollInputs({
		entries: [leave0340],
		salaryWindow: february.attendance,
		dueThrough: february.salary.end,
		captures: []
	}).timeOff[0]?.charges.reduce((sum, row) => sum + row.days, 0),
	8
);
// ────────────────────────────────────────────────────────────────────────────────────────────────
// The ordinary rate of pay and statutory OT controls.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const terms = {
	base_salary: { value: 3451, currency: 'MYR' },
	pay_frequency: 'MONTHLY',
	ordinary_hours_per_week: 48,
	working_days_per_week: 6
};
const myJurisdiction = {
	jurisdiction_code: 'MY',
	ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 26 }]
};
/**
 * The Philippine Work as the bank seeds it: one rate row per week shape, because DOLE's 261-day and
 * 313-day factors are employee-level law and one company rosters both.
 */
const PH_WORK = {
	jurisdiction_code: 'PH',
	ordinary_rate: [
		{ eligibility: 'terms.payroll_group == "MONTHLY"', per: 'DAY', divisor: 30.4167 },
		{ eligibility: 'terms.ordinary_hours_per_week > 40', per: 'DAY', divisor: 26.0833 },
		{ eligibility: '', per: 'DAY', divisor: 21.75 }
	]
};
check('ORP is 3,451 / 26 / 8 = 16.59', ordinaryHourlyRate(terms, myJurisdiction), 16.59);
check('a day’s wages is 3,451 / 26 = 132.73', ordinaryDayWage(terms, myJurisdiction), 132.73);
check(
	'semi-monthly is a payout cadence and does not double the stored monthly salary',
	ordinaryHourlyRate(
		{
			...terms,
			base_salary: { value: 15650, currency: 'PHP' },
			pay_frequency: 'SEMI_MONTHLY',
			ordinary_hours_per_week: 40,
			working_days_per_week: 5
		},
		PH_WORK
	),
	89.94
);
check(
	'a PH six-day week uses the statutory 313-day factor',
	ordinaryHourlyRate(
		{
			...terms,
			base_salary: { value: 15650, currency: 'PHP' },
			pay_frequency: 'SEMI_MONTHLY',
			ordinary_hours_per_week: 48,
			working_days_per_week: 6
		},
		PH_WORK
	),
	75
);
check(
	'a PH overnight clock overlaps all eight statutory night hours',
	nightWindowHours(
		{
			id: 'night',
			work_date: '2026-02-03',
			worked_intervals: [
				{ start: '2026-02-03T20:22:00.000+08:00', end: '2026-02-04T08:30:00.000+08:00' }
			],
			break_minutes: 0
		},
		PH_NIGHT,
		null
	).overtime,
	8
);
check(
	'a daytime clock earns no night differential',
	nightWindowHours(
		{
			id: 'day',
			work_date: '2026-02-03',
			worked_intervals: [
				{ start: '2026-02-03T08:30:00.000+08:00', end: '2026-02-03T17:30:00.000+08:00' }
			],
			break_minutes: 0
		},
		PH_NIGHT,
		null
	).overtime,
	0
);
check(
	'a five-day 42.5-hour contract uses its 8.5-hour normal day, not a six-day payroll convention',
	ordinaryHourlyRate(
		{
			...terms,
			base_salary: { value: 2044, currency: 'MYR' },
			ordinary_hours_per_week: 42.5,
			working_days_per_week: 5
		},
		myJurisdiction
	),
	9.25
);
check(
	'an hours-per-month jurisdiction divides once',
	ordinaryHourlyRate(terms, {
		jurisdiction_code: 'ID',
		ordinary_rate: [{ eligibility: '', per: 'HOUR', divisor: 173 }]
	}),
	cents(3451 / 173)
);

const ordinaryRule = {
	id: 'ot-ordinary',
	day_type: 'ORDINARY',
	band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
	award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
};
const sixHourDay = {
	date: '2026-01-06',
	workDayId: 'wd1',
	dayType: 'ORDINARY',
	hours: 6,
	normalHours: 8,
	totalWorkHours: 14
};
const split = priceDay({ day: sixHourDay, rules: [ordinaryRule], retainedHours: 4 });
check(
	'only overtime corresponding to work through 12 total hours remains overtime',
	split.segments.reduce((total, s) => total + s.hours, 0),
	4
);
check(
	'two hours corresponding to work beyond 12 are reclassified, not discarded',
	split.excess.reduce((total, s) => total + s.hours, 0),
	2
);
check(
	'the excess keeps the multiple it earned: 2 × 1.5 = 3 units',
	split.excess.reduce((total, s) => total + s.units, 0),
	3
);
const uncapped = priceDay({
	day: { ...sixHourDay, hours: 3, totalWorkHours: 11 },
	rules: [ordinaryRule],
	retainedHours: 3
});
check('a day below 12 total work hours produces no excess at all', uncapped.excess.length, 0);
check('and all of it is overtime', uncapped.segments[0].hours, 3);

const bandedRules = [
	{
		...ordinaryRule,
		id: 'id-1',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: 1 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		...ordinaryRule,
		id: 'id-2',
		band: { measure: 'BEYOND_NORMAL', from_hours: 1, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	}
];
const banded = priceDay({
	day: { ...sixHourDay, hours: 3 },
	rules: bandedRules,
	retainedHours: 3
});
check(
	'a banded ladder splits one hour at 1.5 and two at 2.0',
	banded.segments.map((s) => [s.hours, s.multiple]),
	[
		[1, 1.5],
		[2, 2]
	]
);

const monthlyDays = [
	{
		...sixHourDay,
		date: '2026-01-01',
		dayType: 'REST_DAY',
		hours: 10,
		totalWorkHours: 10
	},
	{
		...sixHourDay,
		date: '2026-01-02',
		dayType: 'PUBLIC_HOLIDAY',
		hours: 10,
		totalWorkHours: 10
	},
	...Array.from({ length: 12 }, (_, index) => ({
		...sixHourDay,
		date: `2026-01-${String(index + 3).padStart(2, '0')}`,
		hours: 8,
		totalWorkHours: 11
	})),
	{ ...sixHourDay, date: '2026-01-15', hours: 7, totalWorkHours: 11 },
	{ ...sixHourDay, date: '2026-01-16', hours: 3, totalWorkHours: 11 },
	{ ...sixHourDay, date: '2026-02-01', hours: 3, totalWorkHours: 11 }
];
const monthlyClassified = classifyOvertimeByCalendarMonth({
	days: monthlyDays,
	dailyWorkLimit: null,
	monthlyOrdinaryOvertimeLimit: 104,
	ordinaryDayIncentiveBoundary: null
});
check(
	'the 104-hour counter excludes rest-day and public-holiday work',
	regulatedMonthlyOvertimeHours(monthlyDays, '2026-01'),
	106
);
check(
	'only one hour of a three-hour day remains after 103 ordinary OT hours',
	monthlyClassified.find((entry) => entry.day.date === '2026-01-16')?.retainedHours,
	1
);
check(
	'the remaining two hours are routed to statutory excess',
	monthlyClassified.find((entry) => entry.day.date === '2026-01-16')?.excessHours,
	2
);
check(
	'the statutory OT counter resets on the first of the next calendar month',
	monthlyClassified.find((entry) => entry.day.date === '2026-02-01')?.retainedHours,
	3
);
check(
	'daily excess is also floored to a half-hour increment',
	classifyOvertimeByCalendarMonth({
		days: [{ ...sixHourDay, hours: 4, totalWorkHours: 12.6 }],
		dailyWorkLimit: 12,
		monthlyOrdinaryOvertimeLimit: null,
		ordinaryDayIncentiveBoundary: null
	})[0]?.excessHours,
	0.5
);
check(
	'less than half an hour beyond 12 does not create a fractional excess unit',
	classifyOvertimeByCalendarMonth({
		days: [{ ...sixHourDay, hours: 4, totalWorkHours: 12.4 }],
		dailyWorkLimit: 12,
		monthlyOrdinaryOvertimeLimit: null,
		ordinaryDayIncentiveBoundary: null
	})[0]?.excessHours,
	0
);
const vietnamDailyOt = classifyOvertimeByCalendarMonth({
	days: [{ ...sixHourDay, hours: 6, totalWorkHours: 14 }],
	dailyWorkLimit: null,
	dailyOvertimeHoursLimit: 4,
	monthlyOrdinaryOvertimeLimit: 40,
	ordinaryDayIncentiveBoundary: null
})[0];
check(
	'Vietnam four-hour daily overtime ceiling retains four hours',
	vietnamDailyOt?.retainedHours,
	4
);
check(
	'Vietnam four-hour daily overtime ceiling routes two hours to incentive',
	vietnamDailyOt?.excessHours,
	2
);

// ── statutory overtime coverage, read from the jurisdiction's cited rule ────────────────────────
// The Malaysian row as seeded from the seed bank: Employment Act 1955 First Schedule paras 1A, 2 and 3.
const MY_COVERAGE_RULE = {
	wage_ceiling: { value: 4000, currency: 'MYR' },
	ceiling_is_inclusive: true,
	wage_basis: 'STATUTORY_WAGES',
	category_basis: 'STATUTORY_WORK_CATEGORY',
	exempt_categories: ['MANUAL_LABOUR', 'MANUAL_LABOUR_SUPERVISOR', 'COMMERCIAL_VEHICLE_OPERATOR'],
	excluded_categories: ['VESSEL_WORK']
};
const coverageArgs = (category, salary, comparand = salary) => ({
	rule: MY_COVERAGE_RULE,
	jurisdictionCode: 'MY',
	wages: {
		BASE_SALARY: { value: salary, currency: 'MYR' },
		STATUTORY_WAGES: { value: comparand, currency: 'MYR' }
	},
	statutoryWorkCategory: category,
	workClassification: 'EA_COVERED',
	employeeNumber: 'E-0001',
	// The Work catalogue row's citation, as seeded from the seed bank.
	authority: 'Employment Act 1955 First Schedule paras 1A, 2 and 3'
});

check(
	'manual labour above RM4,000 remains statutorily OT-pay covered — First Schedule para 2(1)',
	isStatutoryOvertimePayCovered(coverageArgs('MANUAL_LABOUR', 5000)),
	true
);
check(
	'a supervisor of manual labour is covered irrespective of wages — para 2(3)',
	isStatutoryOvertimePayCovered(coverageArgs('MANUAL_LABOUR_SUPERVISOR', 12000)),
	true
);
check(
	'vessel work is outside the ladder at any wage — para 2(4) disapplies Part XII',
	isStatutoryOvertimePayCovered(coverageArgs('VESSEL_WORK', 1000)),
	false
);
check(
	'a jurisdiction with no coverage rule covers everyone, rather than nobody',
	isStatutoryOvertimePayCovered({ ...coverageArgs('NON_MANUAL', 99000), rule: null }),
	true
);
// The First Schedule tests para 3 wages — s.2 wages less commissions, subsistence allowance and
// overtime payment — which the engine derives from the components and their entries. A person
// on RM3,800 basic plus a RM500 fixed allowance earns RM4,300 of para 3 wages and is outside the
// ladder, even though their base salary alone would have kept them inside it.
check(
	'wages exactly at the ceiling stay covered — para 1A bites only on wages that EXCEED it',
	isStatutoryOvertimePayCovered(coverageArgs('NON_MANUAL', 4000)),
	true
);
check(
	'an allowance that takes para 3 wages past the ceiling ends coverage',
	isStatutoryOvertimePayCovered(coverageArgs('NON_MANUAL', 3800, 4300)),
	false
);
check(
	'base salary alone never answers a STATUTORY_WAGES rule — the comparand is wider',
	isStatutoryOvertimePayCovered(coverageArgs('NON_MANUAL', 3000)),
	true
);

// ── the para 3 comparand, classified from the component model ───────────────────────────────
// s.2: basic wages AND all other cash payments for work done. Para 3 lessens that by commissions,
// subsistence allowance and overtime payment. The classification below is the statute read against
// what a component row can say.
const component = (kind, source) => ({
	nature: kind,
	definition: source == null ? null : { source }
});
check(
	'the contracted wage is basic wages',
	classifyWageComparand(component('EARNING', 'SCHEDULE')),
	'BASIC_WAGES'
);
check(
	'an earning entry is another cash payment for work done',
	classifyWageComparand(component('EARNING', 'ENTRY')),
	'CASH_FOR_WORK'
);
check(
	'a formula earning is another cash payment for work done',
	classifyWageComparand(component('EARNING', 'FORMULA')),
	'CASH_FOR_WORK'
);
check(
	'a reimbursement is not a cash payment for work done',
	classifyWageComparand(component('NON_WAGE_PAYMENT', 'ENTRY')),
	'NOT_WAGES'
);
check(
	'a deduction is not wages',
	classifyWageComparand(component('DEDUCTION', 'ENTRY')),
	'NOT_WAGES'
);
check(
	'information is not wages',
	classifyWageComparand(component('INFORMATION', 'FORMULA')),
	'NOT_WAGES'
);

const comparand = deriveStatutoryWages({
	baseSalary: { value: 3800, currency: 'MYR' },
	payments: [
		{ category: 'CASH_FOR_WORK', amount: 500 }, // fixed allowance
		{ category: 'CASH_FOR_WORK', amount: -50 }, // a reversal on the same component takes back
		{ category: 'NOT_WAGES', amount: 300 }, // a reimbursement
		{ category: 'BASIC_WAGES', amount: 0 } // basic comes from the terms, not an entry
	]
});
check('the comparand is basic plus cash-for-work, less nothing else', comparand, {
	value: 4250,
	currency: 'MYR'
});
const mismatchedCurrency = Effect.runSync(
	Effect.result(
		Effect.try({
			try: () =>
				isStatutoryOvertimePayCovered({
					...coverageArgs('NON_MANUAL', 3000),
					rule: {
						...MY_COVERAGE_RULE,
						wage_ceiling: { value: 4000, currency: 'SGD' }
					}
				}),
			catch: (error) => error
		})
	)
);
check(
	'a ceiling in another currency than the wages still stops the run',
	Result.isFailure(mismatchedCurrency) &&
		/different currency/.test(String(mismatchedCurrency.failure)) &&
		/E-0001/.test(String(mismatchedCurrency.failure)),
	true
);

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Request economics are read once, at the boundary: each family's builder settles the five answers
// the run needs, so nothing downstream switches on a storage shape to re-derive them.
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Every column a stored row carries, including the two the builders read off it. A fixture that
// omits an optional column is a fixture describing a row the database cannot produce, and the
// shape audit is what refuses to let that pass as coverage.
const CORE = {
	id: 'e',
	employment_id: 'emp-1',
	amount: 100,
	approval_id: null,
	pay_period: null,
	as_adjustment_entry: false
};
const CLAIM = { ...CORE, claim_catalogue_id: 'claim-1' };
const ALLOWANCE = { ...CORE, allowance_catalogue_id: 'allowance-1' };
const PAYMENT = { ...CORE, payment_catalogue_id: 'payment-1' };
const paymentAdjustment = (asAdjustmentEntry) =>
	paymentRequest({
		...PAYMENT,
		effective_on: '2026-03-02',
		as_adjustment_entry: asAdjustmentEntry,
		reason: 'x'
	});
check(
	'an ordinary request pays under its component',
	claimRequest({ ...CLAIM, incurred_on: '2026-03-02', description: null }).sign,
	1
);
check('a replacement Payment pays under its catalogue direction', paymentAdjustment(false).sign, 1);
check(
	'a reversal takes back — it names the settled output it corrects',
	paymentAdjustment(true).sign,
	-1
);
// A reversal is signed rather than depleted: netting a negative draw against a magnitude grows it.
check('an adjustment Payment is signed, not depleted', paymentAdjustment(true).depletes, false);
check('a replacement Payment is depleted', paymentAdjustment(false).depletes, true);
check(
	'prorating is an allowance fact and nothing else',
	allowanceRequest({
		...ALLOWANCE,
		recurrence: { kind: 'RECURRING', from: '2026-01-01', to: null, on_day: 1 }
	}).prorates,
	true
);
check(
	'a claim never prorates',
	claimRequest({ ...CLAIM, incurred_on: '2026-03-02', description: null }).prorates,
	false
);
check(
	'an open-ended recurring allowance states its own window, day-precision',
	JSON.stringify(
		allowanceRequest({
			...ALLOWANCE,
			recurrence: { kind: 'RECURRING', from: '2026-01-01', to: null, on_day: 1 }
		}).window
	),
	JSON.stringify({ start: '2026-01-01', end: null })
);
// A one-off names one day; its window is that day's month, so proration measures the month,
// while its event date — the day — is what the cutoff places. That is what makes it depletable
// where a recurring allowance is not.
check(
	'a one-off allowance window is the month its day falls in',
	JSON.stringify(
		allowanceRequest({ ...ALLOWANCE, recurrence: { kind: 'ONE_OFF', on: '2026-02-15' } }).window
	),
	JSON.stringify({ start: '2026-02-01', end: '2026-02-28' })
);
check(
	'a recurring allowance is unbounded; a one-off is not',
	[
		allowanceRequest({
			...ALLOWANCE,
			recurrence: { kind: 'RECURRING', from: '2026-01-01', to: null, on_day: 1 }
		}).depletes,
		allowanceRequest({ ...ALLOWANCE, recurrence: { kind: 'ONE_OFF', on: '2026-02-15' } }).depletes
	].join(','),
	'false,true'
);
check(
	'a claim settles by its incurred date under the cutoff',
	requestPayPeriod(claimRequest({ ...CLAIM, incurred_on: '2026-04-10', description: null }), 21),
	'2026-04'
);
// A Payment dates by its effective day, and past the cutoff it is next period's money.
check(
	'a Payment past the cutoff settles next period',
	requestPayPeriod(
		paymentRequest({
			...PAYMENT,
			effective_on: '2026-04-25',
			reason: 'Bonus'
		}),
		21
	),
	'2026-05'
);
check(
	'a Payment retains its contract and source catalogue',
	[paymentAdjustment(false).employment_id, paymentAdjustment(false).component_catalogue_id],
	['emp-1', 'payment-1']
);

/* ── Rest-day and public-holiday work is priced by statute, from the seeded rules ──────────────
 *
 * EA s.60(3): a rest day's work up to the normal day pays a day's wages, and only the hours past
 * it enter the hourly ladder. The pre-refactor engine paid every hour at a flat hourly multiple
 * instead — roughly RM88 a day more, and routed to an EPF-liable component where statutory
 * overtime is EPF-exempt. These cases exist so that reading cannot come back by accident.
 */
const restDayRule = (measure, from, to, award, multiple) => ({
	id: `ot-${measure}-${from}`,
	day_type: 'REST_DAY',
	band:
		measure === 'FROM_START_OF_DAY'
			? { measure, from_fraction: from, to_fraction: to }
			: { measure, from_hours: from, to_hours: to },
	award: { kind: award, multiple }
});

// Malaysia, rest day: up to half a normal day pays 0.5 day's wages, up to a full day pays 1.0,
// and hours beyond the normal day pay 2.0 × the hourly rate.
const malaysiaRestDay = [
	restDayRule('FROM_START_OF_DAY', 0, 0.5, 'DAY_WAGE_MULTIPLE', 0.5),
	restDayRule('FROM_START_OF_DAY', 0.5, 1, 'DAY_WAGE_MULTIPLE', 1),
	restDayRule('BEYOND_NORMAL', 0, null, 'HOURLY_MULTIPLE', 2)
];
const restDay = (hours) => ({
	date: '2026-01-11',
	workDayId: 'wd-rest',
	dayType: 'REST_DAY',
	hours,
	normalHours: 8,
	totalWorkHours: hours
});

const eightOnARestDay = priceDay({
	day: restDay(8),
	rules: malaysiaRestDay,
	retainedHours: 8
});
check(
	'eight hours on a rest day pays one day of wages, not eight hourly multiples',
	eightOnARestDay.segments.filter((segment) => segment.award === 'DAY_WAGE_MULTIPLE').length,
	1
);
check(
	"a day's wages is paid once, at the highest band entered",
	eightOnARestDay.segments.find((segment) => segment.award === 'DAY_WAGE_MULTIPLE')?.multiple,
	1
);
check(
	'no hour inside the normal day reaches the hourly ladder',
	eightOnARestDay.segments
		.filter((segment) => segment.award === 'HOURLY_MULTIPLE')
		.reduce((total, segment) => total + segment.hours, 0),
	0
);

const tenOnARestDay = priceDay({
	day: restDay(10),
	rules: malaysiaRestDay,
	retainedHours: 10
});
check(
	'only the hours past the normal day enter the hourly ladder',
	tenOnARestDay.segments
		.filter((segment) => segment.award === 'HOURLY_MULTIPLE')
		.reduce((total, segment) => total + segment.hours, 0),
	2
);

const halfDay = priceDay({ day: restDay(3), rules: malaysiaRestDay, retainedHours: 3 });
check(
	'under half a normal day pays the half-day band, not the full one',
	halfDay.segments.find((segment) => segment.award === 'DAY_WAGE_MULTIPLE')?.multiple,
	0.5
);
const restDaySplit = priceDay({
	day: restDay(11),
	rules: malaysiaRestDay,
	retainedHours: 11
});
check(
	'eleven rest-day hours retain the full statutory rest-day award',
	restDaySplit.segments.find((segment) => segment.award === 'DAY_WAGE_MULTIPLE')?.multiple,
	1
);
check(
	'eleven total work hours produce no incentive reclassification',
	restDaySplit.excess.length,
	0
);

const thirteenHourRestDaySplit = priceDay({
	day: restDay(13),
	rules: malaysiaRestDay,
	retainedHours: 12
});
check(
	'thirteen rest-day hours keep the award through hour 12 and reclassify exactly hour 13',
	{
		overtimeDayWageUnits: thirteenHourRestDaySplit.segments
			.filter((segment) => segment.award === 'DAY_WAGE_MULTIPLE')
			.reduce((total, segment) => total + segment.multiple, 0),
		overtimeHourlyHours: thirteenHourRestDaySplit.segments
			.filter((segment) => segment.award === 'HOURLY_MULTIPLE')
			.reduce((total, segment) => total + segment.hours, 0),
		incentiveDayWageUnits: thirteenHourRestDaySplit.excess
			.filter((segment) => segment.valuedAt === 'ORDINARY_DAY_WAGE')
			.reduce((total, segment) => total + segment.units, 0),
		incentiveHourlyHours: thirteenHourRestDaySplit.excess
			.filter((segment) => segment.valuedAt === 'ORDINARY_HOURLY')
			.reduce((total, segment) => total + segment.hours, 0),
		incentiveHourlyUnits: thirteenHourRestDaySplit.excess
			.filter((segment) => segment.valuedAt === 'ORDINARY_HOURLY')
			.reduce((total, segment) => total + segment.units, 0)
	},
	{
		overtimeDayWageUnits: 1,
		overtimeHourlyHours: 4,
		incentiveDayWageUnits: 0,
		incentiveHourlyHours: 1,
		incentiveHourlyUnits: 2
	}
);

const malaysiaPublicHoliday = [
	{
		...restDayRule('FROM_START_OF_DAY', 0, 1, 'DAY_WAGE_MULTIPLE', 2),
		day_type: 'PUBLIC_HOLIDAY'
	},
	{
		...restDayRule('BEYOND_NORMAL', 0, null, 'HOURLY_MULTIPLE', 3),
		day_type: 'PUBLIC_HOLIDAY'
	}
];
const thirteenHourPublicHolidaySplit = priceDay({
	day: { ...restDay(13), dayType: 'PUBLIC_HOLIDAY' },
	rules: malaysiaPublicHoliday,
	retainedHours: 12
});
check(
	'thirteen public-holiday hours reclassify only hour 13 at the statutory 3× value',
	{
		overtimeDayWageUnits: thirteenHourPublicHolidaySplit.segments
			.filter((segment) => segment.award === 'DAY_WAGE_MULTIPLE')
			.reduce((total, segment) => total + segment.multiple, 0),
		overtimeHourlyHours: thirteenHourPublicHolidaySplit.segments
			.filter((segment) => segment.award === 'HOURLY_MULTIPLE')
			.reduce((total, segment) => total + segment.hours, 0),
		incentiveDayWageUnits: thirteenHourPublicHolidaySplit.excess
			.filter((segment) => segment.valuedAt === 'ORDINARY_DAY_WAGE')
			.reduce((total, segment) => total + segment.units, 0),
		incentiveHourlyHours: thirteenHourPublicHolidaySplit.excess
			.filter((segment) => segment.valuedAt === 'ORDINARY_HOURLY')
			.reduce((total, segment) => total + segment.hours, 0),
		incentiveHourlyUnits: thirteenHourPublicHolidaySplit.excess
			.filter((segment) => segment.valuedAt === 'ORDINARY_HOURLY')
			.reduce((total, segment) => total + segment.units, 0)
	},
	{
		overtimeDayWageUnits: 2,
		overtimeHourlyHours: 4,
		incentiveDayWageUnits: 0,
		incentiveHourlyHours: 1,
		incentiveHourlyUnits: 3
	}
);

const indonesiaRestOverflow = priceDay({
	day: { ...restDay(13), dayType: 'REST_DAY' },
	rules: [
		{
			...restDayRule('FROM_START_OF_DAY', 0, null, 'HOURLY_MULTIPLE', 2),
			day_type: 'REST_DAY'
		},
		{
			...restDayRule('BEYOND_NORMAL', 0, 1, 'HOURLY_MULTIPLE', 3),
			day_type: 'REST_DAY'
		},
		{
			...restDayRule('BEYOND_NORMAL', 1, 4, 'HOURLY_MULTIPLE', 4),
			day_type: 'REST_DAY'
		}
	],
	retainedHours: 13
});
check(
	'Indonesia rest-day hours past the last closed band become incentive at the last multiple',
	{
		pricedHours: indonesiaRestOverflow.segments.reduce(
			(total, segment) => total + segment.hours,
			0
		),
		incentiveHours: indonesiaRestOverflow.excess.reduce((total, row) => total + row.hours, 0),
		incentiveUnits: indonesiaRestOverflow.excess.reduce((total, row) => total + row.units, 0)
	},
	{ pricedHours: 12, incentiveHours: 1, incentiveUnits: 4 }
);

// A jurisdiction that states no FROM_START_OF_DAY band pays no day's wages — Singapore's single
// open hourly band. The entitlement is data, not a code path.
const singaporeRestDay = [restDayRule('BEYOND_NORMAL', 0, null, 'HOURLY_MULTIPLE', 1.5)];
const singapore = priceDay({
	day: restDay(8),
	rules: singaporeRestDay,
	retainedHours: 8
});
check(
	'a jurisdiction stating no day-wage band pays every hour hourly',
	singapore.segments
		.filter((segment) => segment.award === 'HOURLY_MULTIPLE')
		.reduce((total, segment) => total + segment.hours, 0),
	8
);
check(
	'and pays no day wage at all',
	singapore.segments.filter((segment) => segment.award === 'DAY_WAGE_MULTIPLE').length,
	0
);

/* ── An absence is prorated, not overtime-rated ────────────────────────────────────────────────
 *
 * Verified against the source workbook: for 2026-01 every employee's `no_pay_leave` divides by
 * `round(basic / 31, cent)` into a clean half-day count, and by `basic / 26` into nothing.
 * Example: basic 3,451, npl 55.66 → 3451/31 = 111.32, 55.66 / 111.32 = exactly 0.5 days.
 * At the EA s.60I divisor of 26 the same half day would withhold 66.37 — 19% too much.
 */
const januaryTerms = {
	base_salary: { value: 3451, currency: 'MYR' },
	pay_frequency: 'MONTHLY',
	ordinary_hours_per_week: 45,
	working_days_per_week: 6
};
const january = { start: '2026-01-01', end: '2026-01-31' };
const calendarMY = {
	// `ordinaryRateDivisor` branches on the jurisdiction code for the Philippine 313-day
	// alternative, so a jurisdiction fixture that omits it is only ever "not PH" by accident.
	jurisdiction_code: 'MY',
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 26 }]
};
const absenceRate = (jurisdiction, period = january) =>
	absenceDayRate({ terms: januaryTerms, work: jurisdiction, period, workingDaysIn: () => 26 });

check('a January absence day is basic / 31, to the cent', absenceRate(calendarMY), 111.32);
check(
	'half a day withheld reproduces the workbook exactly',
	roundMoney(absenceRate(calendarMY) * 0.5, 'NEAREST_CENT'),
	55.66
);
check(
	'February uses its own 28 days, not the prior month',
	absenceRate(calendarMY, { start: '2026-02-01', end: '2026-02-28' }),
	roundMoney(3451 / 28, 'NEAREST_CENT')
);
check(
	'the overtime divisor is NOT the absence divisor',
	ordinaryDayWage(januaryTerms, calendarMY),
	roundMoney(3451 / 26, 'NEAREST_CENT')
);
check(
	'a WORKING_DAYS jurisdiction prorates on working days instead',
	absenceDayRate({
		terms: januaryTerms,
		work: {
			proration: { by: 'WORKING_DAYS' },
			ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 26 }]
		},
		period: january,
		workingDaysIn: () => 22
	}),
	roundMoney(3451 / 22, 'NEAREST_CENT')
);
check(
	'monthly NPL uses the configured 21.75-day fixed-days cadence override',
	absenceDayRate({
		terms: {
			base_salary: { value: 25000, currency: 'PHP' },
			pay_frequency: 'MONTHLY',
			ordinary_hours_per_week: 40,
			working_days_per_week: 5
		},
		work: {
			proration: { by: 'FIXED_DAYS', days: 21.75 },
			ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 21.75 }]
		},
		period: { start: '2026-02-01', end: '2026-02-28' },
		workingDaysIn: () => 16
	}),
	1149.43
);
/* ── A calendar day survives the process time zone ─────────────────────────────────────────────
 *
 * Day precision does not create a second column type. The driver yields the same ISO string as any
 * other instant, and the payroll calendar takes its first ten characters without consulting the
 * host's time zone.
 */
check('the driver’s day text is taken as written', calendarDay('2026-01-01'), '2026-01-01');
check('a year boundary is not rolled back', calendarDay('2026-01-01'), '2026-01-01');
check(
	'a stored UTC instant keeps its stated day',
	calendarDay('2026-01-01T00:00:00.000Z'),
	'2026-01-01'
);
check('an ISO month boundary keeps its day', calendarDay('2026-03-01T00:00:00.000Z'), '2026-03-01');

/* And the consequence that actually broke a run: someone hired on the first of the period is a
 * plain starter, not a late joiner owed the month before. The arrears rule is right — feed it the
 * shifted day and it correctly claims a December it was never meant to see — so the guard is the
 * hire date itself, and this pins that it reaches the rule unmoved. */
const janStarter = settle_('2026-01', calendarDay('2026-01-01'), null);
check('someone hired on 1 January is paid in January', janStarter.runs, true);
check('their January covers the whole month', janStarter.employedDays, {
	start: '2026-01-01',
	end: '2026-01-31'
});
check('and nothing is owed for December', janStarter.arrearsFor, null);
check('nor is any period deferred', janStarter.deferral, null);
check(
	'while a genuine 31 December joiner is owed that one day',
	settle_('2026-01', '2025-12-31', null).arrearsFor?.days,
	{ start: '2025-12-31', end: '2025-12-31' }
);

console.log(`\n${passes.length} assertions passed.`);
if (failures.length > 0) {
	console.error(`\n${failures.length} FAILED:\n`);
	for (const failure of failures) console.error(`  ✗ ${failure}\n`);
	process.exitCode = 1;
} else {
	console.log('All payroll arithmetic verified.\n');
}
