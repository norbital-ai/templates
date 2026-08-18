// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildRosterMonth,
	employmentMonthEmptyReason,
	employmentOverlapsMonth,
	shiftTimeCue
} from '../ui/roster/roster-month.ts';

const employment = (start, end = null) => ({
	norbital_id: 'employment-1',
	effective_range: { start, end }
});

test('month membership uses interval overlap, not current employment state', () => {
	assert.equal(employmentOverlapsMonth(employment('2026-07-15', '2026-08-12'), '2026-08'), true);
	assert.equal(employmentOverlapsMonth(employment('2026-06-01', '2026-07-31'), '2026-08'), false);
	assert.equal(employmentOverlapsMonth(employment('2026-09-01'), '2026-08'), false);
	assert.equal(
		employmentMonthEmptyReason([employment('2026-01-01', '2026-07-31')], '2026-08'),
		'ENDED'
	);
	assert.equal(employmentMonthEmptyReason([employment('2026-09-01')], '2026-08'), 'NOT_STARTED');
});

test('a mid-month exit remains on the board and marks only later days as ended', () => {
	const facts = buildRosterMonth({
		month: '2026-08',
		employments: [employment('2026-07-01', '2026-08-12')],
		rosterEntries: [],
		timeEntries: [],
		leaveRequests: [],
		pendingLeaveRequests: [],
		holidays: [],
		rosterCodesById: new Map(),
		employmentTerms: [],
		leaveCodeById: new Map(),
		cutoff: null,
		locks: new Map(),
		today: '2026-08-17'
	});
	assert.equal(facts.get('employment-1:2026-08-12')?.status, 'UNROSTERED');
	assert.equal(facts.get('employment-1:2026-08-13')?.status, 'EXITED');
});

test('dense cells expose a compact AM/PM time axis', () => {
	assert.equal(shiftTimeCue({ shiftStart: '09:00', shiftEnd: '18:30' }), '9a–6:30p');
	assert.equal(shiftTimeCue({ shiftStart: null, shiftEnd: null }), null);
});
