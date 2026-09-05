import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPunch } from '../src/lib/kiosk/punch.ts';

const morning = '2026-09-04T01:00:00.000Z';
const evening = '2026-09-04T09:00:00.000Z';
const later = '2026-09-04T10:00:00.000Z';

// Repeated recognition must never toggle a person out or start another paid interval.
test('first arrival wins; repeated arrivals leave open and closed attendance unchanged', () => {
	assert.deepEqual(nextPunch(null, morning, null, 'in'), {
		kind: 'in',
		intervals: [{ start: morning, end: null }],
		index: 0
	});
	for (const end of [null, evening]) {
		assert.deepEqual(nextPunch([{ start: morning, end }], later, null, 'in'), {
			kind: 'blocked',
			reason: 'already-in'
		});
	}
});

test('only explicit departure closes attendance, and the latest departure wins', () => {
	assert.deepEqual(nextPunch([{ start: morning, end: null }], evening, null, 'out'), {
		kind: 'out',
		intervals: [{ start: morning, end: evening }],
		index: 0
	});
	assert.deepEqual(nextPunch([{ start: morning, end: evening }], later, null, 'out'), {
		kind: 'out',
		intervals: [{ start: morning, end: later }],
		index: 0
	});
	for (const time of [morning, evening]) {
		assert.deepEqual(nextPunch([{ start: morning, end: evening }], time, null, 'out'), {
			kind: 'blocked',
			reason: 'already-out'
		});
	}
});

test('departure needs an arrival and cannot precede it', () => {
	assert.deepEqual(nextPunch(null, evening, null, 'out'), {
		kind: 'blocked',
		reason: 'no-open-interval'
	});
	assert.deepEqual(nextPunch([{ start: evening, end: null }], morning, null, 'out'), {
		kind: 'blocked',
		reason: 'already-out'
	});
});

test('deduplication survives failure of separate face bookkeeping', () => {
	assert.deepEqual(nextPunch([{ start: morning, end: null }], morning, null, 'in'), {
		kind: 'blocked',
		reason: 'already-in'
	});
	assert.deepEqual(nextPunch([{ start: morning, end: evening }], evening, null, 'out'), {
		kind: 'blocked',
		reason: 'already-out'
	});
});
