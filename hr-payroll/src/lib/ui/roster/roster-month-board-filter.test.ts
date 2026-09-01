// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { unresolvedClockOutEmploymentIds } from './roster-month-board-filter.ts';

test('the eye prefilter includes only people with unresolved clock-outs', () => {
	const ids = unresolvedClockOutEmploymentIds([
		{ employmentId: 'open-a', status: 'OPEN' },
		{ employmentId: 'open-a', status: 'OPEN' },
		{ employmentId: 'absent', status: 'ABSENT' },
		{ employmentId: 'attended', status: 'ATTENDED' },
		{ employmentId: 'open-b', status: 'OPEN' }
	]);
	assert.deepEqual([...ids], ['open-a', 'open-b']);
});

test('the local eye prefilter has an explicit empty result', () => {
	assert.deepEqual(
		[...unresolvedClockOutEmploymentIds([{ employmentId: 'attended', status: 'ATTENDED' }])],
		[]
	);
});
