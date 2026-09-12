import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSomethingToShow } from '../src/lib/balance-row.ts';

test('a balance with no ceiling, no metering and no history is not shown', () => {
	assert.equal(
		hasSomethingToShow({ unlimited: false, ceiling: 0, earned: 0, activity: false }),
		false
	);
	assert.equal(
		hasSomethingToShow({ unlimited: false, ceiling: null, earned: null, activity: false }),
		false
	);
});

test('an unlimited grant, a ceiling, an accrual, or any history is shown', () => {
	assert.equal(
		hasSomethingToShow({ unlimited: true, ceiling: null, earned: null, activity: false }),
		true
	);
	assert.equal(
		hasSomethingToShow({ unlimited: false, ceiling: 12, earned: 0, activity: false }),
		true
	);
	assert.equal(
		hasSomethingToShow({ unlimited: false, ceiling: 0, earned: 3, activity: false }),
		true
	);
	assert.equal(
		hasSomethingToShow({ unlimited: false, ceiling: 0, earned: 0, activity: true }),
		true
	);
});
