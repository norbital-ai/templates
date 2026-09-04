// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { KIOSK_PUNCH_COOLDOWN_MS, nextPunch } from '../src/lib/kiosk/punch.ts';

const T0 = '2026-09-04T01:00:00.000Z';
const T1 = '2026-09-04T09:00:00.000Z';

test('first punch of the day opens an interval', () => {
	assert.deepEqual(nextPunch(null, T0, null, 'toggle'), {
		kind: 'in',
		intervals: [{ start: T0, end: null }],
		index: 0
	});
});

test('second punch closes the open interval', () => {
	assert.deepEqual(nextPunch([{ start: T0, end: null }], T1, null, 'toggle'), {
		kind: 'out',
		intervals: [{ start: T0, end: T1 }],
		index: 0
	});
});

test('third punch opens a second interval', () => {
	assert.deepEqual(
		nextPunch([{ start: T0, end: T1 }], '2026-09-04T13:00:00.000Z', null, 'toggle'),
		{
			kind: 'in',
			intervals: [
				{ start: T0, end: T1 },
				{ start: '2026-09-04T13:00:00.000Z', end: null }
			],
			index: 1
		}
	);
});

test('punch inside the cooldown window is blocked with the remaining wait', () => {
	const outcome = nextPunch(null, T0, '2026-09-04T00:59:55.000Z', 'toggle');
	assert.equal(outcome.kind, 'blocked');
	assert.equal(outcome.reason, 'cooldown');
	assert.equal(outcome.retryAfterMs, KIOSK_PUNCH_COOLDOWN_MS - 5000);
});

test('manual in against an open interval is refused without writing', () => {
	assert.deepEqual(nextPunch([{ start: T0, end: null }], T1, null, 'in'), {
		kind: 'blocked',
		reason: 'already-in'
	});
});

test('manual out with no open interval is refused without writing', () => {
	assert.deepEqual(nextPunch([{ start: T0, end: T1 }], '2026-09-04T13:00:00.000Z', null, 'out'), {
		kind: 'blocked',
		reason: 'no-open-interval'
	});
});

test('explicit manual in and out follow the same toggle positions', () => {
	assert.deepEqual(nextPunch(null, T0, null, 'in').kind, 'in');
	assert.deepEqual(nextPunch([{ start: T0, end: null }], T1, null, 'out').kind, 'out');
});
