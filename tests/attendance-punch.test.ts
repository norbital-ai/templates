import assert from 'node:assert/strict';
import test from 'node:test';
import { KIOSK_PUNCH_COOLDOWN_MS, nextPunch } from '../src/lib/kiosk/punch.ts';

const morning = '2026-09-04T01:00:00.000Z';
const evening = '2026-09-04T09:00:00.000Z';
const later = '2026-09-04T10:00:00.000Z';

/**
 * The kiosk no longer asks which way to punch.
 *
 * It used to take a direction and refuse whenever the answer contradicted the day — "already
 * checked in", "check in first". The day already knew: it keeps its first arrival and its latest
 * departure, so which of the two a punch is follows from what is stored. These tests pin the
 * property that replaces those three refusals: **the first punch of a person-day opens it, and
 * every later punch moves the end.** Somebody who scans again on the way back from lunch has moved
 * their departure later, and their next scan corrects it. The last punch of the day is the
 * departure by construction, so there is nothing left to contradict.
 */
test('the first punch of a day opens it', () => {
	assert.deepEqual(nextPunch(null, morning, null), {
		kind: 'in',
		intervals: [{ start: morning, end: null }],
		index: 0
	});
	assert.deepEqual(nextPunch([], morning, null), {
		kind: 'in',
		intervals: [{ start: morning, end: null }],
		index: 0
	});
});

test('every later punch moves the departure rather than opening a second interval', () => {
	const opened = nextPunch(null, morning, null);
	assert.equal(opened.kind, 'in');
	const afterFirst = nextPunch(opened.intervals, evening, null);
	assert.deepEqual(afterFirst, {
		kind: 'out',
		intervals: [{ start: morning, end: evening }],
		index: 0
	});
	// The lunch case: scanning again does not start a new interval, it moves the same end later.
	assert.deepEqual(nextPunch(afterFirst.intervals, later, null), {
		kind: 'out',
		intervals: [{ start: morning, end: later }],
		index: 0
	});
});

test('a repeated punch is idempotent in shape: one interval, whatever the count', () => {
	let intervals = null;
	for (const at of [morning, evening, later, '2026-09-04T11:00:00.000Z']) {
		const outcome = nextPunch(intervals, at, null);
		assert.notEqual(outcome.kind, 'blocked');
		intervals = outcome.intervals;
	}
	assert.deepEqual(intervals, [{ start: morning, end: '2026-09-04T11:00:00.000Z' }]);
});

test('the end of the last interval is what moves, not the first', () => {
	// A day imported with two intervals keeps both; only the final one is open to a punch.
	const stored = [
		{ start: morning, end: evening },
		{ start: later, end: null }
	];
	assert.deepEqual(nextPunch(stored, '2026-09-04T12:00:00.000Z', null), {
		kind: 'out',
		intervals: [
			{ start: morning, end: evening },
			{ start: later, end: '2026-09-04T12:00:00.000Z' }
		],
		index: 1
	});
});

/**
 * The cooldown is a debounce, not a contradiction.
 *
 * A face held in front of the camera is one arrival, not forty. It is the only blocked reason
 * left, and it is keyed on the last successful match rather than on the stored intervals — so it
 * survives a failure of the separate face bookkeeping the way the old dedup refusals did.
 */
test('a second punch inside the cooldown is blocked, and says how long is left', () => {
	const twoSecondsLater = '2026-09-04T01:00:02.000Z';
	assert.deepEqual(nextPunch([{ start: morning, end: null }], twoSecondsLater, morning), {
		kind: 'blocked',
		reason: 'cooldown',
		retryAfterMs: KIOSK_PUNCH_COOLDOWN_MS - 2000
	});
});

test('the cooldown expires exactly at its boundary', () => {
	const atBoundary = new Date(Date.parse(morning) + KIOSK_PUNCH_COOLDOWN_MS).toISOString();
	const justInside = new Date(Date.parse(morning) + KIOSK_PUNCH_COOLDOWN_MS - 1).toISOString();
	assert.equal(nextPunch([{ start: morning, end: null }], atBoundary, morning).kind, 'out');
	assert.equal(nextPunch([{ start: morning, end: null }], justInside, morning).kind, 'blocked');
});

test('no prior match means no cooldown to serve', () => {
	assert.equal(nextPunch([{ start: morning, end: null }], morning, null).kind, 'out');
});

/**
 * A punch that would close an interval before it opened is a day the schema cannot represent, so
 * it changes nothing. It is reported as `cooldown` with nothing to wait for — the kiosk has one
 * "not now" to say, and inventing a second reason for a clock nobody can produce by standing at a
 * tablet would be a phrase for a case that does not happen.
 */
test('a punch before the interval it would close leaves the day exactly as it was', () => {
	const outcome = nextPunch([{ start: evening, end: null }], morning, null);
	assert.deepEqual(outcome, { kind: 'blocked', reason: 'cooldown', retryAfterMs: 0 });
});
