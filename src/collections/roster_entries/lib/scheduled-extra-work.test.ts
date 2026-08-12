// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isScheduledExtraWork } from './scheduled-extra-work.ts';

const WORK = { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 };

test('work overriding a patterned rest or off day is scheduled extra work', () => {
	assert.equal(
		isScheduledExtraWork({
			assigned: WORK,
			baseline: { kind: 'REST' },
			observedPublicHoliday: false
		}),
		true
	);
	assert.equal(
		isScheduledExtraWork({
			assigned: WORK,
			baseline: { kind: 'OFF' },
			observedPublicHoliday: false
		}),
		true
	);
});

test('work on an observed holiday is scheduled extra work regardless of baseline', () => {
	assert.equal(
		isScheduledExtraWork({ assigned: WORK, baseline: WORK, observedPublicHoliday: true }),
		true
	);
});

test('ordinary work and as-assigned work are not mislabeled as extra', () => {
	assert.equal(
		isScheduledExtraWork({ assigned: WORK, baseline: WORK, observedPublicHoliday: false }),
		false
	);
	assert.equal(
		isScheduledExtraWork({ assigned: WORK, baseline: null, observedPublicHoliday: false }),
		false
	);
});

test('REST and OFF assignments never create worked time', () => {
	assert.equal(
		isScheduledExtraWork({
			assigned: { kind: 'REST' },
			baseline: WORK,
			observedPublicHoliday: true
		}),
		false
	);
});
