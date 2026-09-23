// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildRosterMonth,
	employmentMonthEmptyReason,
	employmentOverlapsMonth,
	monthDays
} from '../src/lib/ui/roster/roster-month.ts';

const employment = (start, end = null) => ({
	id: 'employment-1',
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
		workDays: [],
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

test('the roster draws dated leave charges, combining separate halves without filling uncharged dates', () => {
	const leave = (catalogue, charges) => ({
		employment_id: 'employment-1',
		catalogue_id: catalogue,
		from_date: '2026-08-03',
		to_date: '2026-08-06',
		half_day_start: false,
		half_day_end: false,
		charges: charges.map(([date, days]) => ({
			date,
			days,
			catalogue_id: catalogue,
			employment_term_id: 'term',
			holiday_id: null,
			shift_definition_id: 'shift',
			work_day_id: null
		}))
	});
	const facts = buildRosterMonth({
		month: '2026-08',
		employments: [employment('2026-01-01')],
		workDays: [],
		leaveRequests: [
			leave('annual', [
				['2026-08-03', 0.5],
				['2026-08-06', 1]
			]),
			leave('medical', [['2026-08-03', 0.5]])
		],
		pendingLeaveRequests: [leave('annual', [['2026-08-07', 0.5]])],
		holidays: [],
		rosterCodesById: new Map(),
		employmentTerms: [],
		leaveCodeById: new Map([
			['annual', 'AL'],
			['medical', 'MC']
		]),
		cutoff: null,
		locks: new Map(),
		today: '2026-08-17'
	});
	assert.equal(facts.get('employment-1:2026-08-03')?.leaveCode, 'AL + MC');
	assert.equal(facts.get('employment-1:2026-08-03')?.halfDayLeave, false);
	assert.equal(facts.get('employment-1:2026-08-04')?.leaveCode, null);
	assert.equal(facts.get('employment-1:2026-08-06')?.leaveCode, 'AL');
	assert.equal(facts.get('employment-1:2026-08-07')?.pendingLeave, true);
	assert.equal(facts.get('employment-1:2026-08-07')?.leaveCode, null);
});

test('a half period lists only its own days, so a semi-monthly board is half a month wide', () => {
	assert.deepEqual(monthDays('2026-02-1').at(0), '2026-02-01');
	assert.deepEqual(monthDays('2026-02-1').at(-1), '2026-02-15');
	assert.equal(monthDays('2026-02-1').length, 15);
	assert.deepEqual(monthDays('2026-02-2'), monthDays('2026-02').slice(15));
	assert.equal(monthDays('2026-02').length, 28);
});
