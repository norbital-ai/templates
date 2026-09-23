// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Overtime is planned, not derived.
 *
 * A work day carries two planned entries: `approved_overtime_hours` (within the statutory limits)
 * and `incentive_hours` (the excess beyond them), split when the day was written. `deriveDailyOvertime`
 * pays them where the clock confirms the day was worked; an hour the clock shows past the plan
 * earns nothing, on an ordinary day and on a rest, off or holiday day alike.
 *
 * These are the behaviours that decision is made of. They are pinned because the same punches
 * priced two different ways is precisely how someone gets quietly underpaid.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	nightWindowHours,
	deriveDailyOvertime,
	ordinaryWorkedHours
} from '../src/collections/payroll_runs/lib/overtime.ts';
import { roundMinute } from '../src/collections/payroll_runs/lib/rounding.ts';

/** 08:30–17:30 with an hour's scheduled break. */
const DAY_SHIFT = {
	id: 'shift-day',
	code: 'D',
	start_time: '08:30',
	end_time: '17:30',
	break_minutes: 60,
	crosses_midnight: false,
	elapsed_minutes: 540,
	paid_minutes: 480
};

/** Attendance is recorded at UTC+8; `+08:00` instants are what the clocks actually hold. */
const at = (date, time) => `${date}T${time}:00.000+08:00`;

const interval = (start, end) => ({
	start: at('2026-03-10', start),
	end: end == null ? null : at('2026-03-10', end)
});

const entry = (overrides = {}) => ({
	id: 'work-day',
	work_date: '2026-03-10',
	worked_intervals: [interval('08:30', '17:30')],
	break_minutes: 60,
	...overrides
});

const scheduled = (overrides = {}) => ({
	date: '2026-03-10',
	dayType: 'ORDINARY',
	shift: DAY_SHIFT,
	clampStart: '08:30',
	normalHours: 8,
	...overrides
});

test('a day worked to its scheduled end earns no overtime at all', () => {
	assert.equal(deriveDailyOvertime(entry(), scheduled()), null);
});

test('an overrun with no approval earns nothing', () => {
	// 08:30–20:45 is 11h15m net of the hour's break, 3h15m beyond the normal eight. The clock no
	// longer decides pay, so the day earns no entry at all.
	assert.equal(
		deriveDailyOvertime(entry({ worked_intervals: [interval('08:30', '20:45')] }), scheduled()),
		null
	);
});

test('the approval is the payable quantity, not the clock overrun', () => {
	const day = deriveDailyOvertime(
		entry({ worked_intervals: [interval('08:30', '20:45')], approved_overtime_hours: 3 }),
		scheduled()
	);
	assert.equal(day.hours, 3, 'three keyed hours, not the clocked 3h15m');
	assert.equal(day.totalWorkHours, 11.25, 'the observed day is still measured');
	assert.equal(day.dayType, 'ORDINARY');
	assert.equal(day.date, '2026-03-10');
	assert.equal(day.workDayId, 'work-day');

	// An approval larger than the punched overrun is still the record: the scheduler's key is what
	// authorises pay, and a figure the clock disagrees with is theirs to correct.
	const larger = deriveDailyOvertime(
		entry({ worked_intervals: [interval('08:30', '18:00')], approved_overtime_hours: 2 }),
		scheduled()
	);
	assert.equal(larger.hours, 2, 'a keyed 2 against a punched 0h30m is still 2');
});

test('the approved half hour is exact', () => {
	for (const hours of [0.5, 1, 1.5, 2.5, 12]) {
		const day = deriveDailyOvertime(
			entry({
				worked_intervals: [interval('08:30', '20:45')],
				approved_overtime_hours: hours
			}),
			scheduled()
		);
		assert.equal(day.hours, hours, `${hours} keyed hours pay ${hours}`);
	}
});

test('an approval is not a clock: a day nobody attended earns nothing', () => {
	// The day was read and nothing was worked — AWOL, not overtime.
	assert.equal(
		deriveDailyOvertime(entry({ worked_intervals: [], approved_overtime_hours: 3 }), scheduled()),
		null
	);
});

test('recorded ordinary hours price undertime once and exclude hours priced as overtime', () => {
	assert.equal(ordinaryWorkedHours(entry(), DAY_SHIFT), 8);
	const short = entry({ worked_intervals: [interval('10:30', '17:30')] });
	assert.equal(ordinaryWorkedHours(short, DAY_SHIFT), 6);
	const lateWithOvertime = entry({ worked_intervals: [interval('10:30', '19:30')] });
	assert.equal(ordinaryWorkedHours(lateWithOvertime, DAY_SHIFT), 6);
	// Two hours late and two hours past the end is eight hours worked — a normal day, and nothing
	// beyond it, so no approval could be earned either.
	assert.equal(deriveDailyOvertime(lateWithOvertime, scheduled()), null);
	assert.equal(
		deriveDailyOvertime(
			entry({
				worked_intervals: [interval('10:30', '21:30')],
				approved_overtime_hours: 2
			}),
			scheduled()
		)?.hours,
		2,
		'ten hours worked from a late start, two keyed beyond the normal eight'
	);
	assert.equal(ordinaryWorkedHours(entry({ worked_intervals: [] }), DAY_SHIFT), 0);
});

test('multiple observed intervals are normalized and the approval still governs', () => {
	// 08:30–17:30 plus 18:00–20:15 is 11h15m net; the approval pays 2 of it, not the 3h15m overrun.
	const day = deriveDailyOvertime(
		entry({
			worked_intervals: [interval('08:30', '17:30'), interval('18:00', '20:15')],
			approved_overtime_hours: 2
		}),
		scheduled()
	);
	assert.equal(day.hours, 2);
	assert.equal(day.totalWorkHours, 10.25, '11h15m clocked less the hour of break');
});

test('a rest day pays only its planned entries: the clock confirms, it never pays', () => {
	// 08:30–20:45 is 11h15m net on a rest day. Nothing planned is nothing paid (owner's rule,
	// 2026-09-23): the clock-derived premium up to the normal day is gone.
	assert.equal(
		deriveDailyOvertime(
			entry({ worked_intervals: [interval('08:30', '20:45')] }),
			scheduled({ dayType: 'REST_DAY' })
		),
		null
	);
	const planned = deriveDailyOvertime(
		entry({
			worked_intervals: [interval('08:30', '20:45')],
			approved_overtime_hours: 8,
			incentive_hours: 2
		}),
		scheduled({ dayType: 'REST_DAY' })
	);
	assert.equal(
		planned.hours,
		10,
		'the eight planned and two incentive hours, not the clocked 11h15m'
	);
	assert.equal(planned.incentiveHours, 2);
	assert.equal(planned.normalHours, 8, 'the contracted day is still the band boundary');
});

test('a day whose only punch falls before the shift was not worked, and pays neither entry', () => {
	assert.equal(
		deriveDailyOvertime(
			entry({
				worked_intervals: [interval('06:00', '08:00')],
				approved_overtime_hours: 3,
				incentive_hours: 1
			}),
			scheduled({ dayType: 'REST_DAY' })
		),
		null
	);
});

test('overlapping intervals cannot pay the same minute twice', () => {
	// 08:30–19:30 unioned with 18:30–20:30 is 08:30–20:30, twelve hours less the break.
	const day = deriveDailyOvertime(
		entry({
			worked_intervals: [interval('08:30', '19:30'), interval('18:30', '20:30')],
			approved_overtime_hours: 2
		}),
		scheduled()
	);
	assert.equal(day.hours, 2);
	assert.equal(day.totalWorkHours, 11, 'the union, not the sum');
});

test('an open clock is refused rather than priced as if it had stopped', () => {
	assert.throws(
		() => deriveDailyOvertime(entry({ worked_intervals: [interval('08:30', null)] }), scheduled()),
		/still open/
	);
});

// ── the statutory rest break is assessed and reported, and deducts nothing ─────────────────────
//
// `work_rules.breaks` is a consecutive-hours rule measured on the clocked run. Planned hours are
// keyed inclusive of breaks, so a shortfall is reported on the day and never taken off them.

const breakRule = (overrides) => ({
	when: 'consecutive_hours > 5.0',
	owed_minutes: '30.0',
	counts_as_worked_time: null,
	...overrides
});

/** A rest day run 08:30–20:45 with nothing recorded as break and eight planned hours. */
const restLongRun = (overrides = {}) =>
	entry({
		worked_intervals: [interval('08:30', '20:45')],
		break_minutes: 0,
		approved_overtime_hours: 8,
		...overrides
	});

test('a jurisdiction with no rest break rule assesses nothing', () => {
	for (const rules of [undefined, null, []]) {
		const day = deriveDailyOvertime(restLongRun(), scheduled({ dayType: 'REST_DAY' }), rules);
		assert.equal(day.hours, 8);
		assert.equal(day.restBreak, null);
	}
});

test('a shortfall is assessed and cited, whatever the statute says, and the plan pays in full', () => {
	for (const counts of [null, false, true]) {
		const day = deriveDailyOvertime(restLongRun(), scheduled({ dayType: 'REST_DAY' }), [
			breakRule({ counts_as_worked_time: counts })
		]);
		assert.equal(day.restBreak.shortfallMinutes, 30);
		assert.equal(day.restBreak.rule.counts_as_worked_time, counts);
		assert.equal(day.hours, 8, 'the planned hours are inclusive of breaks');
	}
	// The trigger is the consecutive run on the clock: 12h15m.
	const day = deriveDailyOvertime(restLongRun(), scheduled({ dayType: 'REST_DAY' }), [breakRule()]);
	assert.equal(day.restBreak.longestRunHours, 12.25);
});

test('the shortfall is what was not taken, never the requirement', () => {
	const rules = [breakRule({ counts_as_worked_time: false })];
	const full = deriveDailyOvertime(
		restLongRun({ break_minutes: 30 }),
		scheduled({ dayType: 'REST_DAY' }),
		rules
	);
	assert.equal(full.restBreak.takenMinutes, 30);
	assert.equal(full.restBreak.shortfallMinutes, 0);
	const part = deriveDailyOvertime(
		restLongRun({ break_minutes: 10 }),
		scheduled({ dayType: 'REST_DAY' }),
		rules
	);
	assert.equal(part.restBreak.shortfallMinutes, 20);
	assert.equal(part.hours, 8);
});

/**
 * A shift that crosses midnight.
 *
 * `end += 1440` appears twice — once in `ordinaryWorkedHours`, once in `deriveDailyOvertime` — and
 * neither branch had a test: every overtime fixture in this suite uses a same-day shift. Without
 * the carry, a night shift's scheduled end lands *before* its start, so every hour after midnight
 * reads as work outside the window and the whole second half of the shift is paid as overtime.
 * The module's own note says getting this comparison wrong "silently misprices every overtime
 * hour", and it is the same comparison the attendance offset constant guards.
 */
const NIGHT_SHIFT = {
	id: 'shift-night',
	code: 'N',
	start_time: '20:00',
	end_time: '05:00',
	break_minutes: 60,
	crosses_midnight: true,
	elapsed_minutes: 540,
	paid_minutes: 480
};

const nightEntry = (overrides = {}) => ({
	id: 'work-day-night',
	work_date: '2026-03-10',
	worked_intervals: [
		{ start: '2026-03-10T20:00:00.000+08:00', end: '2026-03-11T05:00:00.000+08:00' }
	],
	break_minutes: 60,
	...overrides
});

const nightScheduled = (overrides = {}) => ({
	date: '2026-03-10',
	dayType: 'ORDINARY',
	shift: NIGHT_SHIFT,
	clampStart: '20:00',
	normalHours: 8,
	...overrides
});

test('a night shift worked exactly to plan earns no overtime', () => {
	assert.equal(deriveDailyOvertime(nightEntry(), nightScheduled()), null);
	assert.equal(ordinaryWorkedHours(nightEntry(), NIGHT_SHIFT), 8);
});

test('a night shift pays only the hours past its carried-forward end', () => {
	const day = deriveDailyOvertime(
		nightEntry({
			worked_intervals: [
				{ start: '2026-03-10T20:00:00.000+08:00', end: '2026-03-11T07:30:00.000+08:00' }
			],
			approved_overtime_hours: 2.5
		}),
		nightScheduled()
	);
	assert.equal(
		day.hours,
		2.5,
		'two and a half hours past 05:00 the next morning, not the whole night after midnight'
	);
	assert.equal(day.totalWorkHours, 10.5, 'eleven and a half clocked, less the hour of break');
	// Without the approval the same punches earn nothing.
	assert.equal(
		deriveDailyOvertime(
			nightEntry({
				worked_intervals: [
					{ start: '2026-03-10T20:00:00.000+08:00', end: '2026-03-11T07:30:00.000+08:00' }
				]
			}),
			nightScheduled()
		),
		null
	);
});

/**
 * Clocking in early is not work.
 *
 * The hour before the shift is discarded, and the day's total — what the normal day is measured
 * against, and the twelve-hour ceiling too — is counted from the shift start. The owner's rule
 * (2026-09-16): an employee who arrives early is not working, and not paid, until their shift
 * begins.
 */
test('clocking in early on a night shift is neither overtime nor total work hours', () => {
	const day = deriveDailyOvertime(
		nightEntry({
			worked_intervals: [
				{ start: '2026-03-10T19:00:00.000+08:00', end: '2026-03-11T05:00:00.000+08:00' }
			]
		}),
		nightScheduled()
	);
	assert.equal(day, null, 'the hour before the shift is discarded, so the day earns no overtime');
	const late = deriveDailyOvertime(
		nightEntry({
			worked_intervals: [
				{ start: '2026-03-10T19:00:00.000+08:00', end: '2026-03-11T05:30:00.000+08:00' }
			],
			approved_overtime_hours: 0.5
		}),
		nightScheduled()
	);
	assert.equal(late.hours, 0.5, 'the half hour keyed beyond the normal eight');
	assert.equal(late.totalWorkHours, 8.5, 'and the total is counted from the shift start');
});

test('a shift whose end reads before its start is carried forward even without the flag', () => {
	// `crosses_midnight || end <= start` — a roster code that forgot the flag still spans midnight,
	// because the clock says so. Losing this branch turns the same night into eight hours of
	// overtime on a shift that was worked exactly to plan.
	const unflagged = { ...NIGHT_SHIFT, crosses_midnight: false };
	assert.equal(deriveDailyOvertime(nightEntry(), nightScheduled({ shift: unflagged })), null);
	assert.equal(ordinaryWorkedHours(nightEntry(), unflagged), 8);
});

test('the minute is the payable unit for clock-derived premium, and float error never moves it', () => {
	// Clock arithmetic produces 2.9999999999999996 for three hours; the punch is minute-granular,
	// so the minute is the unit that loses nothing the day earned and invents nothing it did not.
	for (const [raw, expected] of [
		[0, 0],
		[0.4, 0.4],
		[2.9166666, 2.9166666666666665],
		[2.9999999999999996, 3],
		[0.49999999999999994, 0.5]
	] as const) {
		assert.equal(roundMinute(raw), expected, `${raw} h is ${expected} h`);
	}
	for (let minutes = 0; minutes <= 600; minutes += 1)
		assert.equal(roundMinute(minutes / 60), minutes / 60, `${minutes} minutes is itself`);
});

test('on a day with no shift the first normal hours of night work are ordinary, the rest overtime', () => {
	// A rest day worked 20:00 to 06:00 across midnight: eight hours fall in the 22:00–06:00 window;
	// the first eight worked hours run to 04:00, so six of the night hours are the day's ordinary
	// ones and two are beyond the normal day (PH art.93: 130% then 169%, the night add on each).
	const day = entry({
		worked_intervals: [{ start: at('2026-03-10', '20:00'), end: at('2026-03-11', '06:00') }],
		break_minutes: 0
	});
	assert.deepEqual(nightWindowHours(day, { from: '22:00', to: '06:00' }, null, 8 * 60, 8), {
		ordinary: 6,
		overtime: 2
	});
	// Without a normal day stated, every night hour on a shiftless day is overtime, as before.
	assert.deepEqual(nightWindowHours(day, { from: '22:00', to: '06:00' }, null), {
		ordinary: 0,
		overtime: 8
	});
});
