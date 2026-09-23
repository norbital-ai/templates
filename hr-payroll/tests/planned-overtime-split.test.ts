// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Planned overtime is split at write time (owner's rule, 2026-09-23): a day states its TOTAL
 * planned overtime, and `splitPlannedOvertime` keeps what the limits that split allow as
 * `approved_overtime_hours` and stores the rest as `incentive_hours`, chronologically. The
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
import {
	applicableLimits,
	funnelledLimitKeys,
	splitPlannedOvertime
} from '../src/lib/scheduling/work-limits.ts';
import { settingsVersions } from './fixtures/statutory-world.ts';
import { windowOvertime } from '../src/lib/ui/roster/day-overtime.ts';
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
		limits,
		caps: new Set(['daily_total'])
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
		limits: [limit('weekly_ot', 'WEEK', 'OVERTIME_HOURS', 10)],
		caps: new Set(['weekly_ot'])
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
		limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104)],
		caps: new Set(['monthly_ot'])
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
		limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 10)],
		caps: new Set(['monthly_ot'])
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

test('a rest-day entry consumes the month like any other: it pushes a later ordinary day into incentive', () => {
	// Owner's rule: planned overtime on a rest, off or holiday day counts toward the limits.
	const split = splitPlannedOvertime({
		days: [work(dayOf(1), 4), rest(dayOf(5), 8), work(dayOf(6), 2)],
		limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 12)],
		caps: new Set(['monthly_ot'])
	});
	assert.deepEqual(pairs(split), [
		[dayOf(1), 4, 0],
		[dayOf(5), 8, 0],
		[dayOf(6), 0, 2]
	]);
});

test('the month is the assessment window: with a 21st cutoff the 20th and the 21st fill different months', () => {
	const days = ['2026-01-19', '2026-01-20', '2026-01-21', '2026-01-22'].map((date) =>
		work(date, 4)
	);
	const cap = {
		limits: [limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 6)],
		caps: new Set(['monthly_ot'])
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
		limits: [limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12)],
		caps: new Set(['daily_total'])
	});
	// 12 − 9.25 = 2.75 → 2.5 within, 1.5 incentive.
	assert.deepEqual(pairs(split), [[dayOf(1), 2.5, 1.5]]);
});

test('MY-nihon: the s.60A(7) twelve-hour day splits an ordinary or off day, never a rest day or holiday', () => {
	for (const version of settingsVersions('MY-nihon')) {
		const limits = applicableLimits(version.work_rules.limits, null);
		const caps = funnelledLimitKeys(version.work_rules, limits);
		assert.deepEqual([...caps].toSorted(), ['daily_total', 'monthly_ot']);
		// Seeded days: 6 h on a 7.5-hour shift is 4.5 within twelve and 1.5 incentive; 14 h on an OFF
		// day is 12 and 2; 14 h on a rest day and on a holiday stand whole.
		const split = splitPlannedOvertime({
			days: [
				work(dayOf(1), 6, { paid_minutes: 450 }),
				{ ...rest(dayOf(2), 14), kind: 'OFF' },
				rest(dayOf(5), 14),
				work(dayOf(6), 14, { holiday: true })
			],
			limits,
			caps,
			cutoffDay: 21
		});
		assert.deepEqual(pairs(split), [
			[dayOf(1), 4.5, 1.5],
			[dayOf(2), 12, 2],
			[dayOf(5), 14, 0],
			[dayOf(6), 14, 0]
		]);
	}
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
			caps: new Set(['monthly_ot']),
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

test('a limit that does not split never caps: the refusal gate owns it', () => {
	const split = splitPlannedOvertime({
		days: [work(dayOf(1), 6)],
		limits: [limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12)],
		caps: new Set()
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
/** The public fixture's shape: a 12 clock-hour day a band names, and the 104-hour month. */
const PUBLIC_RULES = {
	limits: [
		{ ...limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12), unit: 'CLOCK_HOURS' },
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104)
	],
	bands: [{ label: 'OT-1.5X', funnel_above_hours: 'limits.daily_total' }]
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
					price_amount: 'hours * ordinary_hour * 1.5',
					funnel_above_hours: 'limits.daily_total'
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
