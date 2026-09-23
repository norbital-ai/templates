// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Planned overtime is split at write time (owner's rule, 2026-09-23): a day states its TOTAL
 * planned overtime, and `splitPlannedOvertime` keeps what every statutory overtime limit allows as
 * `approved_overtime_hours` and stores the rest as `incentive_hours`, chronologically. No overtime
 * limit refuses: each is a split cap. The
 * `work_days` transform stores the split, re-splits what a change moves, and refuses a change that
 * would move a day outside the write — sealed or not.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import workDays from '../src/collections/work_days/+collection.ts';
import pipeline from '../src/collections/work_days/+pipelines.ts';
import { createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { memoryWorkspaceApi } from './fixtures/memory-payroll-api.ts';
import { applicableLimits, splitPlannedOvertime } from '../src/lib/scheduling/work-limits.ts';
import { settingsVersions } from './fixtures/statutory-world.ts';
import { windowOvertime } from '../src/lib/ui/roster/day-overtime.ts';
import { addDays } from '../src/collections/payroll_runs/lib/dates.ts';
import { transformSync } from './helpers/transform.ts';
import { VERSION, workDayDb } from './helpers/work-day-db.ts';

const limit = (key, period, measure, max_hours, extra = {}) => ({
	key,
	period,
	measure,
	max_hours,
	unit: 'WORKED_HOURS',
	...extra
});
const work = (date, total, extra = {}) => ({
	date,
	kind: 'WORK',
	paid_minutes: 480,
	break_minutes: 60,
	spread_hours: 9,
	total_overtime_hours: total,
	...extra
});
const rest = (date, total) => ({
	date,
	kind: 'REST',
	paid_minutes: 0,
	break_minutes: 0,
	spread_hours: 0,
	total_overtime_hours: total
});
const pairs = (split) =>
	[...split]
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([date, row]) => [date, row.approved_overtime_hours, row.incentive_hours]);
const dayOf = (n) => `2026-07-${String(n).padStart(2, '0')}`;

// ── the split ────────────────────────────────────────────────────────────────────────────────

test('daily cap: a CLOCK_HOURS day total less the break, less the shift, is the day’s overtime', () => {
	// 12 clock hours less the 1-hour break is 11 net; the 8-hour shift leaves 3.
	const limits = [{ ...limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12), unit: 'CLOCK_HOURS' }];
	const split = splitPlannedOvertime({
		days: [work('2026-02-03', 5), work('2026-02-04', 2)],
		limits
	});
	assert.deepEqual(pairs(split), [
		['2026-02-03', 3, 2],
		['2026-02-04', 2, 0]
	]);
});

test('weekly cap: the week fills in date order and the rest of it is incentive', () => {
	// Monday 6 July to Friday 10 July, 3 hours a day against a 10-hour week.
	const split = splitPlannedOvertime({
		days: [10, 9, 8, 7, 6].map((n) => work(dayOf(n), 3)),
		limits: [limit('weekly_ot', 'WEEK', 'OVERTIME_HOURS', 10)]
	});
	assert.deepEqual(pairs(split), [
		[dayOf(6), 3, 0],
		[dayOf(7), 3, 0],
		[dayOf(8), 3, 0],
		[dayOf(9), 1, 2],
		[dayOf(10), 0, 3]
	]);
});

test('monthly 104: 27 days × 4 hours fill the month on the 26th working day; the 27th is incentive', () => {
	const dates = Array.from({ length: 31 }, (_, index) => index + 1).filter((n) => n % 7 !== 0);
	const split = splitPlannedOvertime({
		// Handed over out of order: the allocation is by date, not by input.
		days: dates.toReversed().map((n) => work(dayOf(n), 4)),
		limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104)]
	});
	assert.equal(dates.length, 27);
	assert.deepEqual(pairs(split).at(-1), [dayOf(31), 0, 4]);
	assert.equal(
		pairs(split).reduce((sum, [, approved]) => sum + approved, 0),
		104
	);
	assert.deepEqual(
		pairs(split).filter(([, , incentive]) => incentive > 0),
		[[dayOf(31), 0, 4]]
	);
});

test('chronological cascade: more overtime early in the month moves the incentive earlier', () => {
	const cap = {
		limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 10)]
	};
	const before = splitPlannedOvertime({
		...cap,
		days: [work(dayOf(1), 4), work(dayOf(2), 4), work(dayOf(3), 4)]
	});
	const after = splitPlannedOvertime({
		...cap,
		days: [work(dayOf(1), 6), work(dayOf(2), 4), work(dayOf(3), 4)]
	});
	assert.deepEqual(pairs(before), [
		[dayOf(1), 4, 0],
		[dayOf(2), 4, 0],
		[dayOf(3), 2, 2]
	]);
	assert.deepEqual(pairs(after), [
		[dayOf(1), 6, 0],
		[dayOf(2), 4, 0],
		[dayOf(3), 0, 4]
	]);
});

test('OVERTIME_HOURS is the ordinary and off day’s at every period; ALL_OVERTIME_HOURS counts the rest day too', () => {
	// The limit's measure decides which days it counts: a rest day neither consumes nor is bounded
	// by a regulated-overtime limit, and consumes a limit that counts all overtime.
	const days = [work(dayOf(1), 4), rest(dayOf(5), 8), work(dayOf(6), 10)];
	assert.deepEqual(
		pairs(
			splitPlannedOvertime({ days, limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 12)] })
		),
		[
			[dayOf(1), 4, 0],
			[dayOf(5), 8, 0],
			[dayOf(6), 8, 2]
		]
	);
	assert.deepEqual(
		pairs(
			splitPlannedOvertime({
				days,
				limits: [limit('monthly_ot', 'MONTH', 'ALL_OVERTIME_HOURS', 12)]
			})
		),
		[
			[dayOf(1), 4, 0],
			[dayOf(5), 8, 0],
			[dayOf(6), 0, 10]
		]
	);
});

test('ID: holiday and rest-day overtime stay outside the 4 h a day and the 18 h week (PP 35/2021 art.26(2))', () => {
	for (const version of settingsVersions('ID')) {
		const limits = applicableLimits(version.work_rules.limits, null);
		// Monday 6 to Sunday 12 July: a holiday Tuesday and a rest Sunday plan 9 each, and four
		// ordinary days 4 each. Only the ordinary sixteen enter the week: all of it is overtime.
		const split = splitPlannedOvertime({
			days: [
				work(dayOf(6), 4),
				work(dayOf(7), 9, { holiday: true }),
				work(dayOf(8), 4),
				work(dayOf(9), 4),
				work(dayOf(10), 4),
				rest(dayOf(12), 9)
			],
			limits
		});
		assert.deepEqual(pairs(split), [
			[dayOf(6), 4, 0],
			[dayOf(7), 9, 0],
			[dayOf(8), 4, 0],
			[dayOf(9), 4, 0],
			[dayOf(10), 4, 0],
			[dayOf(12), 9, 0]
		]);
		// A fifth ordinary 4 h day passes eighteen: two within, two incentive.
		assert.deepEqual(
			pairs(
				splitPlannedOvertime({ days: [6, 7, 8, 9, 10].map((n) => work(dayOf(n), 4)), limits })
			).at(-1),
			[dayOf(10), 2, 2]
		);
	}
});

test('MY: rest-day overtime consumes the 104 hours of the assessment window', () => {
	for (const code of ['MY', 'MY-nihon'])
		for (const version of settingsVersions(code)) {
			const limits = applicableLimits(version.work_rules.limits, null);
			// 21 Jan – 20 Feb: twenty-four ordinary days of 4 h (96) and a rest day of 8 (under
			// the twelve a day) fill the 104, so the next ordinary day is all incentive.
			const ordinary = Array.from({ length: 24 }, (_, index) =>
				work(addDays('2026-01-21', index), 4, { paid_minutes: 450 })
			);
			const split = splitPlannedOvertime({
				days: [...ordinary, rest('2026-02-15', 8), work('2026-02-16', 3, { paid_minutes: 450 })],
				limits,
				cutoffDay: 21
			});
			assert.deepEqual(split.get('2026-02-15'), { approved_overtime_hours: 8, incentive_hours: 0 });
			assert.deepEqual(
				split.get('2026-02-16'),
				{ approved_overtime_hours: 0, incentive_hours: 3 },
				code
			);
		}
});

test('counts_day_when: a VN rest day and a TW 休息日 count toward the month; a TW holiday counts past its normal day', () => {
	// VN art.107(2)(b): rest-day and holiday hours enter the 40-hour month, though the four a day
	// do not bind them. 38 on the rest day leaves two for the next day's three.
	const vn = applicableLimits(settingsVersions('VN')[0].work_rules.limits, null);
	assert.deepEqual(
		pairs(splitPlannedOvertime({ days: [rest(dayOf(5), 38), work(dayOf(6), 3)], limits: vn })),
		[
			[dayOf(5), 38, 0],
			[dayOf(6), 2, 1]
		]
	);
	// TW §36(3): every 休息日 hour enters the 46-hour month (30 over three rest days); a holiday
	// counts what passes its eight-hour shift (2 of 10); with 4 on an ordinary day, 10 are left.
	const tw = settingsVersions('TW')[0].work_rules.limits.filter((row) =>
		['daily_total', 'monthly_ot'].includes(row.key)
	);
	assert.deepEqual(
		pairs(
			splitPlannedOvertime({
				days: [
					rest(dayOf(4), 10),
					rest(dayOf(11), 10),
					work(dayOf(13), 10, { holiday: true }),
					rest(dayOf(18), 10),
					work(dayOf(20), 4),
					rest(dayOf(25), 12)
				],
				limits: tw
			})
		),
		[
			[dayOf(4), 10, 0],
			[dayOf(11), 10, 0],
			[dayOf(13), 10, 0],
			[dayOf(18), 10, 0],
			[dayOf(20), 4, 0],
			[dayOf(25), 10, 2]
		]
	);
});

test('the month is the assessment window: with a 21st cutoff the 20th and the 21st fill different months', () => {
	const days = ['2026-01-19', '2026-01-20', '2026-01-21', '2026-01-22'].map((date) =>
		work(date, 4)
	);
	const cap = {
		limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 6)]
	};
	// 21 Dec – 20 Jan, then 21 Jan – 20 Feb: each window fills afresh.
	assert.deepEqual(pairs(splitPlannedOvertime({ ...cap, days, cutoffDay: 21 })), [
		['2026-01-19', 4, 0],
		['2026-01-20', 2, 2],
		['2026-01-21', 4, 0],
		['2026-01-22', 2, 2]
	]);
	// The calendar month, by default: all four in January.
	assert.deepEqual(pairs(splitPlannedOvertime({ ...cap, days })), [
		['2026-01-19', 4, 0],
		['2026-01-20', 2, 2],
		['2026-01-21', 0, 4],
		['2026-01-22', 0, 4]
	]);
});

test('headroom is floored to the half hour, so both entries stay in half-hour steps', () => {
	const split = splitPlannedOvertime({
		days: [work(dayOf(1), 4, { paid_minutes: 555 })],
		limits: [limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12)]
	});
	// 12 − 9.25 = 2.75 → 2.5 within, 1.5 incentive.
	assert.deepEqual(pairs(split), [[dayOf(1), 2.5, 1.5]]);
});

test('MY-nihon: the s.60A(7) twelve hours of work bound every day — ordinary, off, rest and holiday', () => {
	for (const version of settingsVersions('MY-nihon')) {
		const limits = applicableLimits(version.work_rules.limits, null);
		// 6 h on a 7.5-hour shift is 4.5 within twelve and 1.5 incentive; 14 h on an OFF or a rest
		// day is 12 and 2; so is 14 h on a holiday, whose shift is not worked on top of its plan.
		const split = splitPlannedOvertime({
			days: [
				work(dayOf(1), 6, { paid_minutes: 450 }),
				{ ...rest(dayOf(2), 14), kind: 'OFF' },
				rest(dayOf(5), 14),
				work(dayOf(6), 14, { holiday: true })
			],
			limits,
			cutoffDay: 21
		});
		assert.deepEqual(pairs(split), [
			[dayOf(1), 4.5, 1.5],
			[dayOf(2), 12, 2],
			[dayOf(5), 12, 2],
			[dayOf(6), 12, 2]
		]);
	}
});

test('a day OVERTIME_HOURS limit is the ordinary and off day’s: a rest day or holiday is left to the period limits', () => {
	// ID PP 35/2021 art.26(2) and VN art.107(2)(b): the four hours bind an ordinary or off day only.
	for (const code of ['ID', 'VN']) {
		const limits = applicableLimits(settingsVersions(code)[0].work_rules.limits, null).filter(
			(row) => row.period === 'DAY'
		);
		const split = splitPlannedOvertime({
			days: [
				work(dayOf(6), 6),
				{ ...rest(dayOf(7), 6), kind: 'OFF' },
				rest(dayOf(12), 9),
				work(dayOf(13), 9, { holiday: true })
			],
			limits
		});
		assert.deepEqual(
			pairs(split),
			[
				[dayOf(6), 4, 2],
				[dayOf(7), 4, 2],
				[dayOf(12), 9, 0],
				[dayOf(13), 9, 0]
			],
			code
		);
	}
});

test('every overtime limit splits — a quarter and a year too — and the tightest one decides', () => {
	// A 46-hour month under a 100-hour quarter: January and February hold 92, so March has 8 left
	// of the quarter though 46 of its month; April opens a new quarter.
	const quarter = [
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 46),
		limit('quarterly_ot', 'QUARTER', 'OVERTIME_HOURS', 100)
	];
	const split = splitPlannedOvertime({
		days: [
			work('2026-01-05', 46),
			work('2026-02-02', 46),
			work('2026-03-02', 10),
			work('2026-04-01', 12)
		],
		limits: quarter
	});
	assert.deepEqual(pairs(split), [
		['2026-01-05', 46, 0],
		['2026-02-02', 46, 0],
		['2026-03-02', 8, 2],
		['2026-04-01', 12, 0]
	]);
	// VN art.107(3): 200 a year, its rest days counted by its day predicate; ALL_OVERTIME_HOURS
	// (SG's 72 as MOM reads it) splits alike.
	const year = splitPlannedOvertime({
		days: [work('2026-01-05', 150), rest('2026-06-07', 60)],
		limits: [
			limit('yearly_ot', 'YEAR', 'OVERTIME_HOURS', 200, {
				counts_day_when: 'day_type == "REST_DAY" || day_type == "PUBLIC_HOLIDAY"'
			})
		]
	});
	assert.deepEqual(pairs(year), [
		['2026-01-05', 150, 0],
		['2026-06-07', 50, 10]
	]);
	const all = splitPlannedOvertime({
		days: [work(dayOf(1), 70), rest(dayOf(5), 4)],
		limits: [limit('monthly_ot_all', 'MONTH', 'ALL_OVERTIME_HOURS', 72)]
	});
	assert.deepEqual(pairs(all), [
		[dayOf(1), 70, 0],
		[dayOf(5), 2, 2]
	]);
});

test('the day sheet restates the open days its draft moves, and names the sealed ones', () => {
	// A 10-hour month: day 1 plans 6 and day 2 plans 4, both overtime. Raising day 1 to 8 leaves
	// day 2 two hours of room: its split moves, so the save restates it; sealed, it cannot.
	const code = { kind: 'WORK', paid_minutes: 480, break_minutes: 60, spread_hours: 9 };
	const read = (sealed) =>
		windowOvertime({
			window: { start: dayOf(1), end: dayOf(3) },
			date: dayOf(1),
			draft: { codeId: 'W', total: 8, emergency: false },
			stored: [
				{ id: 'a', date: dayOf(1), shift_definition_id: 'W', total: 6, emergency: false, sealed },
				{ id: 'b', date: dayOf(2), shift_definition_id: 'W', total: 4, emergency: false, sealed },
				{ id: 'c', date: dayOf(3), shift_definition_id: null, total: 0, emergency: false, sealed }
			],
			projected: () => 'W',
			codeById: new Map([['W', code]]),
			holidays: new Set(),
			limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 10)],
			cutoffDay: 1
		});
	const open = read(false);
	assert.deepEqual(open.split, { approved_overtime_hours: 8, incentive_hours: 0 });
	assert.deepEqual(
		open.moved.map((day) => day.id),
		['b']
	);
	assert.deepEqual(open.sealed, []);
	assert.deepEqual(
		read(true).sealed.map((day) => day.id),
		['b']
	);
});

test('the normal day and the spread-over never cap: they are not overtime limits', () => {
	const split = splitPlannedOvertime({
		days: [work(dayOf(1), 6)],
		limits: [
			limit('normal_day', 'DAY', 'NORMAL_HOURS', 8),
			limit('spread_day', 'DAY', 'SPREAD_HOURS', 10),
			limit('weekly_normal', 'WEEK', 'NORMAL_HOURS', 45)
		]
	});
	assert.deepEqual(pairs(split), [[dayOf(1), 6, 0]]);
});

// ── the transform ────────────────────────────────────────────────────────────────────────────

/** A 104-hour month that splits, and no other ceiling. */
const RULES = {
	limits: [
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104),
		{ key: 'weekly_rest', measure: 'CONSECUTIVE_WORK_DAYS', max_days: 6, discharged_by: 'REST' }
	],
	bands: []
};
/** The public fixture's shape: a 12 clock-hour day and the 104-hour month. */
const PUBLIC_RULES = {
	limits: [
		{ ...limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12), unit: 'CLOCK_HOURS' },
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104)
	],
	bands: []
};
const CODES = [
	{
		id: 'c-8',
		code: '8.0AM',
		variant: { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 }
	},
	{ id: 'c-rest', code: 'REST', variant: { kind: 'REST' } }
];
const dbFor = (rules, days = []) =>
	workDayDb({
		codes: CODES,
		days,
		rosters: [{ employment_id: 'emp-1', period: '2026-07' }],
		versions: [{ ...VERSION, work_rules: rules }]
	});
const july = (overtime) =>
	Array.from({ length: 31 }, (_, index) => ({
		employment_id: 'emp-1',
		work_date: dayOf(index + 1),
		shift_definition_id: (index + 1) % 7 === 0 ? 'c-rest' : 'c-8',
		approved_overtime_hours: (index + 1) % 7 === 0 ? 0 : overtime(index + 1)
	}));
/** July as stored: the split a month of 4-hour days settles to, `sealed` days pinned to a slip. */
const storedJuly = (sealed = new Set()) =>
	july(() => 4).map((row, index) => ({
		...row,
		id: `d${index + 1}`,
		approved_overtime_hours: index + 1 === 31 ? 0 : row.approved_overtime_hours,
		incentive_hours: index + 1 === 31 ? 4 : 0,
		worked_intervals: null,
		payslip_id: sealed.has(index + 1) ? 'slip-1' : null
	}));
const splitOf = (payload) => [payload.approved_overtime_hours, payload.incentive_hours];

test('the transform stores the split: the total is written as overtime within the month and incentive past it', () => {
	const out = transformSync(
		workDays,
		july(() => 4),
		{ db: dbFor(RULES) }
	);
	assert.deepEqual(splitOf(out[29]), [4, 0]);
	assert.deepEqual(splitOf(out[30]), [0, 4]);
	assert.equal(
		out.reduce((sum, row) => sum + row.approved_overtime_hours, 0),
		104
	);
});

test('the public day cap: a total of 5 on an 8-hour shift is 3 within the 11 net hours and 2 incentive', () => {
	const [out] = transformSync(
		workDays,
		[
			{
				employment_id: 'emp-1',
				work_date: dayOf(1),
				shift_definition_id: 'c-8',
				approved_overtime_hours: 5
			}
		],
		{ db: dbFor(PUBLIC_RULES) }
	);
	assert.deepEqual(splitOf(out), [3, 2]);
});

test('a change that moves a later day’s split refuses unless that day is in the same write', () => {
	const stored = storedJuly();
	const edit = (n, total) => ({ id: `d${n}`, approved_overtime_hours: total });
	const existing = (n) => stored[n - 1];
	// Day 1 goes to 6: the month now fills on the 30th, so the 30th moves to 2 + 2.
	assert.throws(
		() =>
			transformSync(workDays, [edit(1, 6)], { existing: [existing(1)], db: dbFor(RULES, stored) }),
		/moves the overtime and incentive split of 2026-07-30\. Save those days in the same write/
	);
	const out = transformSync(workDays, [edit(1, 6), edit(30, 4), edit(31, 4)], {
		existing: [existing(1), existing(30), existing(31)],
		db: dbFor(RULES, stored)
	});
	assert.deepEqual(out.map(splitOf), [
		[6, 0],
		[2, 2],
		[0, 4]
	]);
	// Lowering a day inside the month's headroom moves nothing and is written alone.
	const [lower] = transformSync(workDays, [edit(31, 2)], {
		existing: [existing(31)],
		db: dbFor(RULES, stored)
	});
	assert.deepEqual(splitOf(lower), [0, 2]);
});

test('a change that would move a sealed day’s split is refused', () => {
	const stored = storedJuly(new Set([30]));
	assert.throws(
		() =>
			transformSync(workDays, [{ id: 'd1', approved_overtime_hours: 6 }], {
				existing: [stored[0]],
				db: dbFor(RULES, stored)
			}),
		/would move the overtime and incentive split of 2026-07-30, which a payslip has already taken into account/
	);
});

// ── the import ───────────────────────────────────────────────────────────────────────────────

/**
 * The import through the transform its writes run through: the memory api applies a payload the
 * `work_days` transform returned, the way the host does, so the stored rows carry the split.
 */
const importWorld = () => {
	const world = createPublicPayrollWorld();
	world.work_days = [];
	world.jurisdiction_settings = world.jurisdiction_settings.map((row) => ({
		...row,
		work_rules: {
			...row.work_rules,
			limits: [
				{ ...limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12), unit: 'CLOCK_HOURS' },
				limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 10)
			],
			bands: [
				{
					label: 'OT-1.5X',
					when: 'day_type == "ORDINARY"',
					take_hours: 'hours_beyond_normal',
					price_amount: 'hours * ordinary_hour * 1.5'
				}
			]
		}
	}));
	return world;
};
const throughTransform = (world) => {
	const api = memoryWorkspaceApi(world);
	const plain = api.collection.work_days;
	const run = (inputs, existing) =>
		Effect.runSync(workDays.transform(inputs, { existing, db: api.db }));
	const work_days = {
		...plain,
		createMany: (inputs) =>
			plain.createMany(
				run(
					inputs,
					inputs.map(() => undefined)
				)
			),
		updateMany: (inputs) =>
			plain.updateMany(
				run(
					inputs.map(({ id: _id, ...input }) => input),
					inputs.map(({ id }) => world.work_days.find((row) => row.id === id))
				).map((payload, index) => ({ ...payload, id: inputs[index].id }))
			)
	};
	return {
		...api,
		collection: new Proxy(api.collection, {
			get: (target, name) => (name === 'work_days' ? work_days : target[name])
		})
	};
};
const JANUARY = Array.from(
	{ length: 31 },
	(_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`
);
const importMonth = (world, overtime) => {
	const api = throughTransform(world);
	return Effect.runPromise(
		pipeline.import.handler(
			{
				input: {
					legal_entity: 'Public Fixture Co',
					month: '2026-01',
					roster: JANUARY.map((work_date) => ({
						employee_number: 'PF0001',
						work_date,
						shift_code: '7.5AM'
					})),
					overtime: Object.entries(overtime).map(([day, overtime_hours]) => ({
						employee_number: 'PF0001',
						work_date: `2026-01-${day}`,
						overtime_hours
					}))
				}
			},
			api
		)
	).then((creates) => {
		// The host writes the returned creates through the transform, in order.
		if (creates.length > 0) Effect.runSync(api.collection.work_days.createMany(creates));
		return creates;
	});
};
const storedSplit = (world) =>
	world.work_days
		.filter((row) => (row.approved_overtime_hours ?? 0) + (row.incentive_hours ?? 0) > 0)
		.toSorted((left, right) => String(left.work_date).localeCompare(String(right.work_date)))
		.map((row) => [
			String(row.work_date).slice(0, 10),
			row.approved_overtime_hours,
			row.incentive_hours
		]);

test('import: each row’s total is split by the day cap (11 net hours) and the month (10 here)', async () => {
	const world = importWorld();
	const employeeNumber = world.employments[0].employee_number;
	assert.equal(employeeNumber, 'PF0001');
	await importMonth(world, { '05': 5, '06': 5, '07': 5, '08': 5 });
	assert.deepEqual(storedSplit(world), [
		['2026-01-05', 3, 2],
		['2026-01-06', 3, 2],
		['2026-01-07', 3, 2],
		['2026-01-08', 1, 4]
	]);
});

test('import: restated and new days in one file are split in one pass, in date order', async () => {
	const world = importWorld();
	await importMonth(world, { '05': 5, '06': 5, '07': 5, '08': 5 });
	// The 2nd is not stored: the next file creates it and restates the rest.
	world.work_days.splice(
		world.work_days.findIndex((row) => String(row.work_date).startsWith('2026-01-02')),
		1
	);
	const creates = await importMonth(world, { '02': 4, '05': 5, '06': 5, '07': 5, '08': 5 });
	assert.deepEqual(creates, [], 'the new day is created by the pipeline itself, in one pass');
	assert.deepEqual(storedSplit(world), [
		['2026-01-02', 3, 1],
		['2026-01-05', 3, 2],
		['2026-01-06', 3, 2],
		['2026-01-07', 1, 4],
		['2026-01-08', 0, 5]
	]);
});
