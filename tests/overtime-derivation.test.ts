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
	classifyOvertimeByCalendarMonth,
	deriveDailyOvertime,
	ordinaryWorkedHours,
	priceDay
} from '../src/collections/payroll_runs/lib/overtime.ts';

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

// ── the hours, once derived, are priced by the seeded statutory ladder ──────────────────────────

const rule = (overrides) => ({
	id: `rule-${overrides.day_type}-${overrides.band.measure}`,
	authority: 'EA 1955',
	...overrides
});

const ORDINARY_OT = rule({
	day_type: 'ORDINARY',
	band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
	award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
});

const REST_DAY_WAGE = rule({
	day_type: 'REST_DAY',
	band: { measure: 'FROM_START_OF_DAY', from_fraction: 0.5, to_fraction: null },
	award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 1 }
});

const REST_DAY_BEYOND = rule({
	day_type: 'REST_DAY',
	band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
	award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
});

test('a full rest day pays one day s wages, and only the hours beyond the normal day run the ladder', () => {
	const day = {
		date: '2026-03-08',
		workDayId: 'work-day',
		dayType: 'REST_DAY',
		hours: 10,
		normalHours: 8,
		totalWorkHours: 10
	};
	const { segments } = priceDay({
		day,
		rules: [ORDINARY_OT, REST_DAY_WAGE, REST_DAY_BEYOND],
		retainedHours: 10
	});
	const dayWage = segments.find((segment) => segment.award === 'DAY_WAGE_MULTIPLE');
	const hourly = segments.find((segment) => segment.award === 'HOURLY_MULTIPLE');
	assert.equal(dayWage.hours, 8, 'the normal day is valued once, as a day s wages');
	assert.equal(dayWage.multiple, 1);
	assert.equal(hourly.hours, 2, 'only the two hours beyond the normal day are paid hourly');
	assert.equal(hourly.multiple, 2);
});

test('a rest-day rule with no component behind it would still be priced — which is why the run refuses', () => {
	// Pricing does not know about components: it produces the segment either way, and `measure`
	// silently finds nobody to pay it. Validation is the only thing standing between that segment
	// and an unpaid day, so this pins that the segment really is produced.
	const { segments } = priceDay({
		day: {
			date: '2026-03-08',
			workDayId: 'work-day',
			dayType: 'REST_DAY',
			hours: 6,
			normalHours: 8,
			totalWorkHours: 6
		},
		rules: [REST_DAY_WAGE, REST_DAY_BEYOND],
		retainedHours: 6
	});
	assert.equal(segments.length, 1);
	assert.equal(segments[0].measure, 'FROM_START_OF_DAY');
});

test('hours past the daily work limit are reclassified, never dropped', () => {
	const [classified] = classifyOvertimeByCalendarMonth({
		days: [
			{
				date: '2026-03-10',
				workDayId: 'work-day',
				dayType: 'ORDINARY',
				hours: 4.5,
				normalHours: 8,
				totalWorkHours: 13
			}
		],
		dailyWorkLimit: 12,
		monthlyOrdinaryOvertimeLimit: 104
	});
	assert.equal(classified.retainedHours + classified.excessHours, 4.5);
	assert.equal(classified.excessHours, 1);
});

test('hours past the daily overtime-hours ceiling are reclassified, never dropped', () => {
	const [classified] = classifyOvertimeByCalendarMonth({
		days: [
			{
				date: '2026-03-10',
				workDayId: 'work-day',
				dayType: 'ORDINARY',
				hours: 6,
				normalHours: 8,
				totalWorkHours: 14
			}
		],
		dailyWorkLimit: null,
		dailyOvertimeHoursLimit: 4,
		monthlyOrdinaryOvertimeLimit: 40
	});
	assert.equal(classified.retainedHours, 4);
	assert.equal(classified.excessHours, 2);
	assert.equal(classified.retainedHours + classified.excessHours, 6);
});

// ── the statutory rest break, where it reaches pay and where it must not ────────────────────────
//
// `regime.rest_break_rules` is a consecutive-hours rule. Overtime is not its trigger — it is only
// the usual way somebody crosses one — so these cases fix that the trigger is measured on the
// clocked run and that what reaches money is decided solely by `counts_as_worked_time`.

const breakRule = (overrides) => ({
	after_consecutive_hours: 5,
	minimum_minutes: 30,
	counts_as_worked_time: null,
	applies_when: 'ALWAYS',
	on_exceed: 'WARN',
	authority: 'Employment Act 1955 s.60A(1)(a)',
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
	const rules = [breakRule({ after_consecutive_hours: 4, counts_as_worked_time: false })];
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
	const rules = [breakRule({ after_consecutive_hours: 4, counts_as_worked_time: false })];
	const day = deriveDailyOvertime(
		entry({ worked_intervals: [interval('08:30', '18:00')], break_minutes: 0 }),
		scheduled(),
		rules
	);
	assert.equal(day, null);
});

/**
 * An off day is priced as an ordinary day, and counts against the ordinary monthly cap.
 *
 * `ruleDayType` maps `OFF_DAY` to `ORDINARY`, and every ordinary-day control — the daily overtime
 * ceiling and the calendar-month cap — therefore governs it, while a rest day and a public holiday
 * are excluded from both by the 1980 Regulations. Nothing tested any of that: `OFF_DAY` appears
 * once in the whole suite, in a schedule test, and never in an overtime derivation, pricing or
 * classification case. A day type that fell through to the rest-day ladder would pay a day's wages
 * for an ordinary overtime day.
 */
test('an off day is priced on the ordinary ladder, not the rest-day one', () => {
	const day = {
		date: '2026-03-07',
		workDayId: 'work-day',
		dayType: 'OFF_DAY',
		hours: 4,
		normalHours: 8,
		totalWorkHours: 4
	};
	const { segments } = priceDay({
		day,
		rules: [ORDINARY_OT, REST_DAY_WAGE, REST_DAY_BEYOND],
		retainedHours: 4
	});
	assert.equal(segments.length, 1, 'no day-wage segment: an off day earns no day s wages');
	assert.equal(segments[0].dayType, 'ORDINARY');
	assert.equal(segments[0].measure, 'BEYOND_NORMAL');
	assert.equal(segments[0].hours, 4);
	assert.equal(segments[0].multiple, 1.5);
});

test('an off day advances the ordinary monthly cap; a rest day and a public holiday do not', () => {
	const day = (date, dayType, hours) => ({
		date,
		workDayId: `work-day-${date}`,
		dayType,
		hours,
		normalHours: 8,
		totalWorkHours: 8 + hours
	});
	const classified = classifyOvertimeByCalendarMonth({
		days: [
			day('2026-03-01', 'REST_DAY', 6),
			day('2026-03-02', 'PUBLIC_HOLIDAY', 6),
			// The counter starts here, at zero, because neither day above touched it.
			day('2026-03-03', 'OFF_DAY', 6),
			day('2026-03-04', 'ORDINARY', 6)
		],
		dailyWorkLimit: null,
		monthlyOrdinaryOvertimeLimit: 8
	});
	const retained = Object.fromEntries(
		classified.map((entry) => [entry.day.date, entry.retainedHours])
	);
	assert.equal(retained['2026-03-01'], 6, 'a rest day is outside the monthly cap entirely');
	assert.equal(retained['2026-03-02'], 6, 'so is a public holiday');
	assert.equal(retained['2026-03-03'], 6, 'the off day is the first six hours of the cap');
	assert.equal(
		retained['2026-03-04'],
		2,
		'the ordinary day takes what the off day left of the eight-hour cap'
	);
	assert.equal(
		classified.find((entry) => entry.day.date === '2026-03-04').excessHours,
		4,
		'and the rest is reclassified rather than lost'
	);
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
 * Clocking in early on a night shift is overtime, and `clampStart` is dead.
 *
 * `clockedWorkHours` carries a comment saying "time clocked before the scheduled start is
 * discarded: an employee who arrives early is not working, and not paid, until their shift
 * begins". The function does not clamp — it sums every interval and subtracts the break — and
 * `ScheduledDay.clampStart`, computed for exactly this in `schedule.ts`, is read by nothing in
 * `src/`.
 *
 * So the hour before a shift is paid as overtime, on an ordinary day, the same way the hour after
 * it is. That is coherent with the day-shift case above ("work outside the scheduled window"), and
 * it is not what the comment says. This pins the behaviour that ships, so that changing it is a
 * decision somebody takes rather than a comment somebody believes. It also matters beyond the
 * overtime line: `totalWorkHours` is what the twelve-hour daily ceiling is measured against, so an
 * early clock-in moves the reclassification boundary too.
 */
test('clocking in early on a night shift is overtime, and counts toward total work hours', () => {
	const day = deriveDailyOvertime(
		nightEntry({
			worked_intervals: [
				{ start: '2026-03-10T19:00:00.000+08:00', end: '2026-03-11T05:00:00.000+08:00' }
			]
		}),
		nightScheduled()
	);
	assert.equal(day.hours, 1, 'the hour before the shift is priced as overtime, not discarded');
	assert.equal(day.totalWorkHours, 9, 'and it counts against the daily work ceiling');
});

test('a shift whose end reads before its start is carried forward even without the flag', () => {
	// `crosses_midnight || end <= start` — a roster code that forgot the flag still spans midnight,
	// because the clock says so. Losing this branch turns the same night into eight hours of
	// overtime on a shift that was worked exactly to plan.
	const unflagged = { ...NIGHT_SHIFT, crosses_midnight: false };
	assert.equal(deriveDailyOvertime(nightEntry(), nightScheduled({ shift: unflagged })), null);
	assert.equal(ordinaryWorkedHours(nightEntry(), unflagged), 8);
});
