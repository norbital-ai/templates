// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What `work_pattern` can and cannot express, stated as arithmetic rather than as belief.
 *
 * The model is one day cycle of roster codes, counted from the pattern row's effective start.
 * `patternRosterCodeId` is pure modular arithmetic on days elapsed from that anchor. Everything
 * below follows from that, and the boundary matters as much as the reach: the second half of this
 * file pins what the model *cannot* say, so that a workspace needing one of those shapes finds out
 * here rather than in a roster somebody has to correct by hand every month.
 *
 * The reach, in one line: **any pattern whose period is a whole number of days.**
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { patternRosterCodeId, patternWorkload } from '../src/lib/scheduling/work-pattern.ts';

const DAY = '00000000-0000-4000-8000-000000000001';
const NIGHT = '00000000-0000-4000-8000-000000000002';
const REST = '00000000-0000-4000-8000-000000000003';
const OFF = '00000000-0000-4000-8000-000000000004';
const ANCHOR = '2026-01-01';
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

const continuous = (cycle) => ({ days: cycle.map((id) => ({ roster_code_id: id })) });

/** The codes a pattern projects over `count` days from `from`, as one string per day. */
const project = (pattern, from, count) =>
	Array.from({ length: count }, (_, index) => {
		const date = new Date(`${from}T00:00:00.000Z`);
		date.setUTCDate(date.getUTCDate() + index);
		return patternRosterCodeId(pattern, date.toISOString().slice(0, 10), ANCHOR);
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
			const shifted = new Date(`${start}T00:00:00.000Z`);
			shifted.setUTCDate(shifted.getUTCDate() + period);
			assert.equal(
				patternRosterCodeId(pattern, shifted.toISOString().slice(0, 10), ANCHOR),
				patternRosterCodeId(pattern, start, ANCHOR),
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
		assert.equal(patternRosterCodeId(pattern, '2026-01-01', ANCHOR), REST);
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

test('an ad-hoc worker projects nothing, which is a different answer from projecting a rest day', () => {
	// No pattern is not an empty pattern: nothing is planned, so nothing is unrostered *against*.
	assert.equal(patternRosterCodeId(null, '2026-01-01', ANCHOR), null);
	assert.equal(patternWorkload(null, codes), null);
	// A guaranteed-schedule worker states a contracted load instead; nothing is projected, and
	// payroll validates against the stated amount rather than against a cycle.
	const guaranteed = {
		expectation: {
			kind: 'GUARANTEED_SCHEDULE',
			period: 'WEEK',
			required_work_days: 5,
			required_paid_minutes: 2400
		}
	};
	assert.equal(patternRosterCodeId(guaranteed, '2026-01-01', ANCHOR), null);
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
 * The cycle holds `{ roster_code_id }` and a WORK code holds one `start_time`/`end_time` pair, so
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

test('a month-anchored rule cannot be stated: the projection knows days elapsed, not weekdays', () => {
	// "The first Monday of every month" has no expression: `patternRosterCodeId` reduces a date to
	// days since the anchor, modulo the cycle length. A 28-day cycle is the closest approximation
	// and it drifts, because months are not 28 days.
	const monthly = continuous(Array.from({ length: 28 }, (_, index) => (index === 0 ? REST : DAY)));
	assert.equal(patternRosterCodeId(monthly, '2026-01-01', ANCHOR), REST);
	assert.equal(patternRosterCodeId(monthly, '2026-01-29', ANCHOR), REST);
	assert.notEqual(
		patternRosterCodeId(monthly, '2026-02-01', ANCHOR),
		REST,
		'a 28-day cycle is not a month, and the drift is the reason a month-anchored rule needs a model change'
	);
});

test('a cycle naming a roster code the company does not have stops the workload rather than guessing', () => {
	assert.throws(
		() => patternWorkload(continuous(['00000000-0000-4000-8000-00000000dead']), codes),
		/roster code/i
	);
});
