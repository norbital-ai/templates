// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What `work_pattern` can and cannot express, stated as arithmetic rather than as belief.
 *
 * The model is one anchor date and a list of phases, each a `day_cycle` repeated over either the
 * whole timeline (`CONTINUOUS`) or a whole number of calendar months. `patternRosterCodeId` is
 * pure modular arithmetic on days elapsed from the anchor. Everything below follows from that, and
 * the boundary matters as much as the reach: the second half of this file pins what the model
 * *cannot* say, so that a workspace needing one of those shapes finds out here rather than in a
 * roster somebody has to correct by hand every month.
 *
 * The reach, in one line: **any pattern whose period is a whole number of days, and any rotation
 * whose phases change on calendar-month boundaries.**
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AS_ASSIGNED_PATTERN,
	patternRosterCodeId,
	patternWorkload
} from '../src/lib/scheduling/work-pattern.ts';

const DAY = '00000000-0000-4000-8000-000000000001';
const NIGHT = '00000000-0000-4000-8000-000000000002';
const REST = '00000000-0000-4000-8000-000000000003';
const OFF = '00000000-0000-4000-8000-000000000004';
const codes = new Map([
	[
		DAY,
		{
			code: 'DAY',
			variant: { kind: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
		}
	],
	[
		NIGHT,
		{
			code: 'NIGHT',
			variant: { kind: 'WORK', start_time: '20:00', end_time: '08:00', break_minutes: 60 }
		}
	],
	[REST, { code: 'REST', variant: { kind: 'REST' } }],
	[OFF, { code: 'OFF', variant: { kind: 'OFF' } }]
]);

const continuous = (cycle, anchor_date = '2026-01-01') => ({
	type: 'PATTERNED',
	anchor_date,
	phases: [
		{ duration: { kind: 'CONTINUOUS' }, day_cycle: cycle.map((id) => ({ roster_code_id: id })) }
	]
});

/** The codes a pattern projects over `count` days from `from`, as one string per day. */
const project = (pattern, from, count) =>
	Array.from({ length: count }, (_, index) => {
		const date = new Date(`${from}T00:00:00.000Z`);
		date.setUTCDate(date.getUTCDate() + index);
		return patternRosterCodeId(pattern, date.toISOString().slice(0, 10));
	});

const asLetters = (ids) =>
	ids.map((id) => ({ [DAY]: 'D', [NIGHT]: 'N', [REST]: 'R', [OFF]: 'O' })[id] ?? '?').join('');

// ── What it can express ─────────────────────────────────────────────────────────────────────────

test('any n-on / m-off rotation is one cycle of length n + m', () => {
	// The classic continental shapes, each stated once and repeating for ever.
	const cases = [
		{ cycle: [DAY, DAY, REST, REST], period: 4, expect: 'DDRRDDRRDDRR' },
		{ cycle: [DAY, DAY, DAY, DAY, REST, REST, REST, REST], period: 8, expect: 'DDDDRRRRDDDD' },
		{ cycle: [DAY, DAY, DAY, DAY, DAY, DAY, REST], period: 7, expect: 'DDDDDDRDDDDD' }
	];
	for (const { cycle, period, expect } of cases) {
		const pattern = continuous(cycle);
		assert.equal(asLetters(project(pattern, '2026-01-01', 12)), expect);
		// The defining property of a cycle: day d and day d + period always agree, for ever.
		for (const start of ['2026-01-01', '2026-06-17', '2029-11-30']) {
			assert.equal(
				patternRosterCodeId(pattern, start),
				asLetters(project(pattern, start, 1)) === '?' ? null : project(pattern, start, 1)[0]
			);
			const shifted = new Date(`${start}T00:00:00.000Z`);
			shifted.setUTCDate(shifted.getUTCDate() + period);
			assert.equal(
				patternRosterCodeId(pattern, shifted.toISOString().slice(0, 10)),
				patternRosterCodeId(pattern, start),
				`a ${period}-day cycle did not repeat at ${start}`
			);
		}
	}
});

test('a cycle of any length works, including ones no week divides', () => {
	// 5, 9 and 13 share no factor with 7, so each drifts across the week — which is the point of
	// stating a cycle in days rather than in weekdays.
	for (const length of [1, 5, 9, 13, 28]) {
		const cycle = Array.from({ length }, (_, index) => (index === 0 ? REST : DAY));
		const pattern = continuous(cycle);
		assert.equal(patternRosterCodeId(pattern, '2026-01-01'), REST);
		const projected = project(pattern, '2026-01-01', length * 3);
		assert.equal(
			projected.filter((id) => id === REST).length,
			3,
			`a ${length}-day cycle produced the wrong number of rest days over three turns`
		);
	}
});

test('a fortnightly pattern is a fourteen-day cycle, and alternate weeks differ', () => {
	const fortnight = continuous([
		DAY,
		DAY,
		DAY,
		DAY,
		DAY,
		OFF,
		REST,
		NIGHT,
		NIGHT,
		NIGHT,
		NIGHT,
		NIGHT,
		OFF,
		REST
	]);
	assert.equal(asLetters(project(fortnight, '2026-01-01', 14)), 'DDDDDORNNNNNOR');
	assert.equal(asLetters(project(fortnight, '2026-01-15', 14)), 'DDDDDORNNNNNOR');
});

test('a rotation on calendar-month boundaries is a multi-phase pattern, backwards as well as forwards', () => {
	const rotating = {
		type: 'PATTERNED',
		anchor_date: '2026-01-01',
		phases: [
			{ duration: { kind: 'CALENDAR_MONTHS', months: 3 }, day_cycle: [{ roster_code_id: DAY }] },
			{ duration: { kind: 'CALENDAR_MONTHS', months: 3 }, day_cycle: [{ roster_code_id: NIGHT }] }
		]
	};
	assert.equal(patternRosterCodeId(rotating, '2026-01-01'), DAY);
	assert.equal(patternRosterCodeId(rotating, '2026-03-31'), DAY);
	assert.equal(patternRosterCodeId(rotating, '2026-04-01'), NIGHT);
	assert.equal(patternRosterCodeId(rotating, '2026-06-30'), NIGHT);
	assert.equal(patternRosterCodeId(rotating, '2026-07-01'), DAY, 'the outer sequence repeats');
	// Dates before the anchor walk the same sequence backwards, so history is projected too.
	assert.equal(patternRosterCodeId(rotating, '2025-12-31'), NIGHT);
	assert.equal(patternRosterCodeId(rotating, '2025-10-01'), NIGHT);
	assert.equal(patternRosterCodeId(rotating, '2025-09-30'), DAY);
});

test('an ad-hoc worker projects nothing, which is a different answer from projecting a rest day', () => {
	// No pattern is not an empty pattern: nothing is planned, so nothing is unrostered *against*.
	assert.equal(patternRosterCodeId(AS_ASSIGNED_PATTERN, '2026-01-01'), null);
	assert.equal(patternWorkload(AS_ASSIGNED_PATTERN, codes), null);
	// A guaranteed-schedule worker is the other ROSTERED arm: nothing is projected either, but a
	// contracted load is stated, and payroll validates against it rather than against a cycle.
	const guaranteed = {
		type: 'ROSTERED',
		expectation: {
			kind: 'GUARANTEED_SCHEDULE',
			period: 'WEEK',
			required_work_days: 5,
			required_paid_minutes: 2400
		}
	};
	assert.equal(patternRosterCodeId(guaranteed, '2026-01-01'), null);
	assert.deepEqual(patternWorkload(guaranteed, codes), {
		work_days: 5,
		paid_minutes: 2400,
		reference_days: 7,
		average_weekly_paid_minutes: 2400
	});
});

// ── Where it stops ──────────────────────────────────────────────────────────────────────────────

/**
 * A split shift is one day, and a day cycle entry is one roster code.
 *
 * `day_cycle` holds `{ roster_code_id }` and a WORK code holds one `start_time`/`end_time` pair, so
 * two windows on one day cannot be stated. `work_days` is unique on `(employment_id, work_date)`,
 * so a second row cannot carry the second half either. The nearest expressible thing is one long
 * window with a large break, which is a different fact: the gap is not a break the employee is
 * entitled to, and the adjacent-day overlap check models the day as one interval.
 */
test('a split shift cannot be stated, only approximated as one window with a long break', () => {
	const morningAndEvening = {
		code: 'SPLIT',
		variant: { kind: 'WORK', start_time: '08:00', end_time: '20:00', break_minutes: 240 }
	};
	const withSplit = new Map([...codes, ['split', morningAndEvening]]);
	const pattern = continuous(['split']);
	const workload = patternWorkload(pattern, withSplit);
	assert.equal(workload.paid_minutes, 480, 'the eight paid hours are right');
	// …but the shape is a lie: nothing in the projection says where the four-hour gap falls, or
	// that the employee went home in the middle of it.
	assert.equal(
		Object.hasOwn(morningAndEvening.variant, 'second_start_time'),
		false,
		'a roster code has one window; if this ever gains a second, this test is the place to say so'
	);
});

test('a phase cannot last a number of weeks, so weekly rotation must be inflated into the cycle', () => {
	// There is no WEEKS duration. A crew alternating days and nights every week is expressible only
	// as a fourteen-day cycle — fine here, but a three-week rotation is twenty-one days and a
	// rotation whose period is not a whole number of days cannot be stated at all.
	const weekly = continuous([
		DAY,
		DAY,
		DAY,
		DAY,
		DAY,
		OFF,
		REST,
		NIGHT,
		NIGHT,
		NIGHT,
		NIGHT,
		NIGHT,
		OFF,
		REST
	]);
	assert.equal(asLetters(project(weekly, '2026-01-01', 14)), 'DDDDDORNNNNNOR');

	/**
	 * And a phase duration the projection cannot measure is refused in BOTH directions.
	 *
	 * It used to throw only for a date before the anchor. For a date after it, the walk skipped
	 * every phase it could not measure, `cycleStart` never advanced, and the loop spun for ever —
	 * a hang inside a payroll run, with no error and nothing to diagnose. `shift_patterns` has no
	 * write hooks, so nothing upstream stops such a row being stored.
	 */
	const weeklyPhases = {
		type: 'PATTERNED',
		anchor_date: '2026-01-01',
		phases: [
			{ duration: { kind: 'WEEKS', weeks: 1 }, day_cycle: [{ roster_code_id: DAY }] },
			{ duration: { kind: 'WEEKS', weeks: 1 }, day_cycle: [{ roster_code_id: NIGHT }] }
		]
	};
	assert.throws(
		() => patternRosterCodeId(weeklyPhases, '2026-06-01'),
		/A multi-phase pattern requires calendar-month durations/,
		'a date after the anchor hung instead of refusing'
	);
	assert.throws(
		() => patternRosterCodeId(weeklyPhases, '2025-06-01'),
		/A multi-phase pattern requires calendar-month durations/
	);
});

test('a month-anchored rule cannot be stated: the projection knows days elapsed, not weekdays', () => {
	// "The first Monday of every month" has no expression: `patternRosterCodeId` reduces a date to
	// days since the anchor, modulo the cycle length. A 28-day cycle is the closest approximation
	// and it drifts, because months are not 28 days.
	const monthly = continuous(Array.from({ length: 28 }, (_, index) => (index === 0 ? REST : DAY)));
	assert.equal(patternRosterCodeId(monthly, '2026-01-01'), REST);
	assert.equal(patternRosterCodeId(monthly, '2026-01-29'), REST);
	assert.notEqual(
		patternRosterCodeId(monthly, '2026-02-01'),
		REST,
		'a 28-day cycle is not a month, and the drift is the reason a month-anchored rule needs a model change'
	);
});

/**
 * A pattern the schema stores but the projection cannot walk.
 *
 * The Effect schema accepts any list of phases, so `[CONTINUOUS, CALENDAR_MONTHS]` can be written
 * to `shift_patterns` — which has no `+hooks.ts` at all. It fails only when a date is projected
 * through it, which is inside a payroll run. Both throws were unreachable from any test.
 */
test('a malformed multi-phase pattern is refused when projected, not when stored', () => {
	const mixed = {
		type: 'PATTERNED',
		anchor_date: '2026-01-01',
		phases: [
			{ duration: { kind: 'CONTINUOUS' }, day_cycle: [{ roster_code_id: DAY }] },
			{ duration: { kind: 'CALENDAR_MONTHS', months: 1 }, day_cycle: [{ roster_code_id: NIGHT }] }
		]
	};
	assert.throws(
		() => patternRosterCodeId(mixed, '2026-01-01'),
		/CONTINUOUS is valid only for a single-phase work pattern/
	);
	const twoContinuous = {
		type: 'PATTERNED',
		anchor_date: '2026-01-01',
		phases: [
			{ duration: { kind: 'CALENDAR_MONTHS', months: 1 }, day_cycle: [{ roster_code_id: DAY }] },
			{ duration: { kind: 'CONTINUOUS' }, day_cycle: [{ roster_code_id: NIGHT }] }
		]
	};
	assert.throws(
		() => patternRosterCodeId(twoContinuous, '2026-01-01'),
		/CONTINUOUS is valid only for a single-phase work pattern|calendar-month durations/
	);
});

test('a cycle naming a roster code the company does not have stops the workload rather than guessing', () => {
	assert.throws(
		() => patternWorkload(continuous(['00000000-0000-4000-8000-00000000dead']), codes),
		/roster code/i
	);
});
