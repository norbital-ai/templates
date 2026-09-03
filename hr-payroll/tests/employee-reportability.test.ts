// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeMissingPunchReportable } from '../src/lib/ui/roster/employee-reportability.ts';

const TODAY = '2026-08-20';

const day = (overrides = {}) => ({
	employmentState: 'ACTIVE',
	date: '2026-08-19',
	workDayId: null,
	attendanceState: null,
	leaveCode: null,
	halfDayLeave: false,
	...overrides
});

const reportable = (value, pendingDates = new Set(), settledIds = new Set()) =>
	employeeMissingPunchReportable(value, TODAY, pendingDates, settledIds);

test('a roster-only person-day is reportable through an update', () => {
	assert.equal(reportable(day({ workDayId: 'planned-day' })), true);
});

test('existing attendance, a pending report, or a settlement claim blocks another report', () => {
	assert.equal(reportable(day({ workDayId: 'attended', attendanceState: 'CLOSED' })), false);
	assert.equal(reportable(day({ workDayId: 'open', attendanceState: 'OPEN' })), false);
	assert.equal(reportable(day({ workDayId: 'pending' }), new Set(['2026-08-19'])), false);
	assert.equal(reportable(day({ workDayId: 'settled' }), new Set(), new Set(['settled'])), false);
});

test('employment, time, and leave boundaries remain unchanged', () => {
	assert.equal(reportable(day({ employmentState: 'EXITED' })), false);
	assert.equal(reportable(day({ date: '2026-08-21' })), false);
	assert.equal(reportable(day({ leaveCode: 'AL', halfDayLeave: false })), false);
	assert.equal(reportable(day({ leaveCode: 'AL', halfDayLeave: true })), true);
});
