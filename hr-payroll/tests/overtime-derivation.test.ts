// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Overtime is computed here, from clocks — it is never read off a time entry.
 *
 * `time_entries` used to carry `overtime_authorized` and five `approved_ot_*_hours` buckets, and
 * `deriveDailyOvertime` branched on both: a recorded refusal suppressed the whole day, and a bucket
 * breakdown replaced the clock as the payable duration. Both are gone. A time entry states what
 * happened on the clock; what those punches are worth is decided here, against the statutory day
 * type and the effective terms.
 *
 * These are the behaviours that decision is made of. They are pinned because the same punches
 * priced two different ways is precisely how someone gets quietly underpaid — and because until the
 * TS source resolver existed nothing could drive these modules from a test at all.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	deriveDailyOvertime,
	ordinaryWorkedHours
} from '../src/collections/payroll_runs/lib/overtime.ts';
import { floorHalfHour } from '../src/collections/payroll_runs/lib/rounding.ts';

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

test('recorded ordinary hours price undertime once and exclude hours priced as overtime', () => {
	assert.equal(ordinaryWorkedHours(entry(), DAY_SHIFT), 8);
	const short = entry({ worked_intervals: [interval('10:30', '17:30')] });
	assert.equal(ordinaryWorkedHours(short, DAY_SHIFT), 6);
	const lateWithOvertime = entry({ worked_intervals: [interval('10:30', '19:30')] });
	assert.equal(ordinaryWorkedHours(lateWithOvertime, DAY_SHIFT), 6);
	assert.equal(deriveDailyOvertime(lateWithOvertime, scheduled())?.hours, 2);
	assert.equal(ordinaryWorkedHours(entry({ worked_intervals: [] }), DAY_SHIFT), 0);
});

test('an ordinary day is observed work outside the scheduled shift window', () => {
	// Out at 20:45 — 3h15m outside the scheduled window, floored to 3h.
	const day = deriveDailyOvertime(
		entry({ worked_intervals: [interval('08:30', '20:45')] }),
		scheduled()
	);
	assert.equal(day.hours, 3);
	assert.equal(day.dayType, 'ORDINARY');
	assert.equal(day.date, '2026-03-10');
	assert.equal(day.workDayId, 'work-day');
});

test('overtime floors to the half hour below, with no one-hour minimum', () => {
	assert.equal(
		deriveDailyOvertime(entry({ worked_intervals: [interval('08:30', '17:55')] }), scheduled()),
		null
	);
	assert.equal(
		deriveDailyOvertime(entry({ worked_intervals: [interval('08:30', '18:15')] }), scheduled())
			.hours,
		0.5
	);
	assert.equal(
		deriveDailyOvertime(entry({ worked_intervals: [interval('08:30', '18:35')] }), scheduled())
			.hours,
		1
	);
});

test('multiple observed intervals are normalized and only work outside the shift is overtime', () => {
	const day = deriveDailyOvertime(
		entry({
			worked_intervals: [interval('08:30', '17:30'), interval('18:00', '20:15')]
		}),
		scheduled()
	);
	assert.equal(day.hours, 2);
});

test('a rest day is overtime from the first minute, less the unpaid break', () => {
	// 08:30–14:30 is six hours; an hour of break leaves five.
	const day = deriveDailyOvertime(
		entry({ worked_intervals: [interval('08:30', '14:30')] }),
		scheduled({ dayType: 'REST_DAY' })
	);
	assert.equal(day.hours, 5);
	assert.equal(day.normalHours, 8, 'the contracted day is still the band boundary');
});

test('all verified work on a rest day is overtime, including work before the usual start', () => {
	const early = deriveDailyOvertime(
		entry({ worked_intervals: [interval('06:00', '14:30')] }),
		scheduled({ dayType: 'REST_DAY' })
	);
	assert.equal(early.hours, 7.5);
});

test('overlapping intervals cannot pay the same minute twice', () => {
	const day = deriveDailyOvertime(
		entry({ worked_intervals: [interval('08:30', '19:30'), interval('18:30', '20:30')] }),
		scheduled()
	);
	assert.equal(day.hours, 3);
});

test('an open clock is refused rather than priced as if it had stopped', () => {
	assert.throws(
		() => deriveDailyOvertime(entry({ worked_intervals: [interval('08:30', null)] }), scheduled()),
		/still open/
	);
});

// ── the statutory rest break, where it reaches pay and where it must not ────────────────────────
//
// `regime.rest_break_rules` is a consecutive-hours rule. Overtime is not its trigger — it is only
// the usual way somebody crosses one — so these cases fix that the trigger is measured on the
// clocked run and that what reaches money is decided solely by `counts_as_worked_time`.

const breakRule = (overrides) => ({
	when: 'consecutive_hours > 5.0',
	owed_minutes: '30.0',
	counts_as_worked_time: null,
	...overrides
});

/** 08:30–20:45 with nothing recorded as break: 3h15m of overrun, and a 12h15m consecutive run. */
const longRun = (overrides = {}) =>
	entry({ worked_intervals: [interval('08:30', '20:45')], break_minutes: 0, ...overrides });

test('a jurisdiction with no rest break rule computes exactly what it always computed', () => {
	// Omitted, null and empty are one statement. Every caller passed nothing before the member was
	// restored, and none of them may lose a minute of overtime to its arrival.
	for (const rules of [undefined, null, []]) {
		const day = deriveDailyOvertime(longRun(), scheduled(), rules);
		assert.equal(day.hours, 3);
		assert.equal(day.restBreak, null);
		assert.equal(day.restBreakDeductedHours, 0);
	}
});

test('a silent statute is assessed, cited and priced at nothing', () => {
	// Malaysia. s.60A(1)(a) calls the period "leisure" and says nothing about payment, so the day is
	// half an hour short of a break it was owed and is paid every minute of its overtime regardless.
	// This is the arm that must never quietly become a deduction.
	const day = deriveDailyOvertime(longRun(), scheduled(), [breakRule()]);
	assert.equal(day.restBreak.shortfallMinutes, 30);
	assert.equal(day.restBreak.rule.counts_as_worked_time, null);
	assert.equal(day.restBreakDeductedHours, 0);
	assert.equal(day.hours, 3, 'a silent statute prices nothing');
	// The trigger is the consecutive run, not the overrun: 12h15m clocked against a 3h15m overrun.
	assert.equal(day.restBreak.longestRunHours, 12.25);
});

test('a break the statute says is not working time deducts the shortfall', () => {
	// Indonesia. ps.79(2)(a) says the rest is not counted as working hours, so a break that was owed
	// and not taken is time the employee was not working.
	const rules = [breakRule({ when: 'consecutive_hours > 4.0', counts_as_worked_time: false })];
	const day = deriveDailyOvertime(longRun(), scheduled(), rules);
	assert.equal(day.restBreak.shortfallMinutes, 30);
	assert.equal(day.restBreakDeductedHours, 0.5);
	assert.equal(day.hours, 2.5, '3h15m less the 30-minute shortfall is 2h45m, floored to 2h30m');
});

test('a break the statute counts as working time deducts nothing', () => {
	const rules = [breakRule({ counts_as_worked_time: true })];
	const day = deriveDailyOvertime(longRun(), scheduled(), rules);
	assert.equal(day.restBreak.shortfallMinutes, 30);
	assert.equal(day.restBreakDeductedHours, 0);
	assert.equal(day.hours, 3);
});

test('the shortfall is deducted, never the requirement', () => {
	// The arithmetic trap. `clockedWorkHours` has already taken the recorded break off the day, so a
	// day that recorded its full statutory thirty minutes owes nothing further. Deducting the
	// requirement again would charge that half hour twice and land the day on 2.5.
	const rules = [breakRule({ counts_as_worked_time: false })];
	const day = deriveDailyOvertime(longRun({ break_minutes: 30 }), scheduled(), rules);
	assert.equal(day.restBreak.takenMinutes, 30);
	assert.equal(day.restBreak.shortfallMinutes, 0);
	assert.equal(day.restBreakDeductedHours, 0);
	assert.equal(day.hours, 3);
	assert.notEqual(day.hours, 2.5, 'that would be the requirement charged a second time');
});

test('a partly taken break deducts only the part that was not taken', () => {
	const rules = [breakRule({ counts_as_worked_time: false })];
	const day = deriveDailyOvertime(longRun({ break_minutes: 10 }), scheduled(), rules);
	assert.equal(day.restBreak.shortfallMinutes, 20);
	assert.equal(day.hours, 2.5, '3h15m less 20 minutes is 2h55m, floored to 2h30m');
	assert.equal(day.hours % 0.5, 0, 'payable overtime is always a half-hour multiple');
});

test('a day whose whole overrun is owed as unpaid break earns nothing at all', () => {
	// 08:30–18:00 is thirty minutes of overrun on a nine-and-a-half hour consecutive run. The day
	// must produce no entry rather than a zero one, exactly as a day that floors away does.
	const rules = [breakRule({ when: 'consecutive_hours > 4.0', counts_as_worked_time: false })];
	const day = deriveDailyOvertime(
		entry({ worked_intervals: [interval('08:30', '18:00')], break_minutes: 0 }),
		scheduled(),
		rules
	);
	assert.equal(day, null);
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
			]
		}),
		nightScheduled()
	);
	assert.equal(
		day.hours,
		2.5,
		'two and a half hours past 05:00 the next morning, not the whole night after midnight'
	);
	assert.equal(day.totalWorkHours, 10.5, 'eleven and a half clocked, less the hour of break');
});

/**
 * Clocking in early is not work.
 *
 * Overtime on a scheduled day is the clock-out past the shift end; the hour before the shift is
 * discarded, and the day's total — what the twelve-hour ceiling is measured against — is counted
 * from the shift start. The owner's rule (2026-09-16): an employee who arrives early is not
 * working, and not paid, until their shift begins.
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
			]
		}),
		nightScheduled()
	);
	assert.equal(late.hours, 0.5, 'only the clock-out past the shift end is overtime');
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

test('the half-hour floor rounds down, and float error never costs a step', () => {
	// The 0.5h step is the payable unit, and it is a FLOOR, not a rounding: 2h55m earns 2h30m and
	// 55 minutes earns 30. Rounding to nearest would pay 3h for 2h55m, which is money the day did
	// not earn. The epsilon exists because clock arithmetic produces 2.9999999999999996 for three
	// hours, and flooring that raw would silently drop half an hour off a full day's overrun.
	for (const [raw, expected] of [
		[0, 0],
		[0.4, 0],
		[0.5, 0.5],
		[0.9166666, 0.5],
		[2.9166666, 2.5],
		[3.25, 3],
		[3.75, 3.5],
		[2.9999999999999996, 3],
		[0.49999999999999994, 0.5]
	] as const) {
		assert.equal(floorHalfHour(raw), expected, `${raw} h floors to ${expected} h`);
	}
	// Never up: every input lands at or below itself, within the epsilon's own tolerance.
	for (let minutes = 0; minutes <= 600; minutes += 1) {
		const hours = minutes / 60;
		const floored = floorHalfHour(hours);
		assert.ok(floored <= hours + 1e-9, `${minutes} minutes floored up to ${floored} h`);
		assert.equal(
			floored % 0.5,
			0,
			`${minutes} minutes produced ${floored} h, not a half-hour step`
		);
	}
});
