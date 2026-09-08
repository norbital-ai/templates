// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A work day may be shifted while nobody has clocked in against it, and not afterwards.
 *
 * The owner's rule, and the rung the lock ladder did not have. Everything else it holds governs a
 * record against payroll and approval — captured by a run, awaiting approval, inside a paid
 * window, owned by leave. None of those fire on a plain rostered day that somebody has punched,
 * which is the ordinary case: the punch is recorded, HR moves the shift a day, and every figure
 * derived from that punch changes underneath it with nothing to say so. Day type, paid minutes,
 * the overtime threshold and every rest-break figure come off the roster code.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { attendanceRecorded, planChanges } from '../src/lib/scheduling/lock.ts';
import workDayHooks from '../src/collections/work_days/+hooks.ts';

const WORK = 'shift-work';
const REST = 'shift-rest';
const holidayInput = {
	id: 'holiday-input-1',
	jurisdiction_code: 'TEST-JUR',
	date: '2026-03-10',
	calendar_id: 'calendar-2026'
};

const api = {
	db: {
		leave_entries: { findMany: () => Effect.succeed([]) },
		payroll_runs: { findMany: () => Effect.succeed([]) }
	}
};

const prepared = {
	holidayByDay: new Map([['emp-1:2026-03-10', holidayInput]]),
	companyByEmployment: new Map([['emp-1', 'co-1']]),
	windowsByCompany: new Map(),
	leaveByEmployment: new Map(),
	overlap: {
		termsByEmployment: new Map(),
		patternById: new Map(),
		explicitByKey: new Map(),
		codeById: new Map()
	}
};

const stored = (over = {}) => ({
	id: 'day-1',
	employment_id: 'emp-1',
	work_date: '2026-03-10',
	shift_definition_id: WORK,
	assignment_code: null,
	planned_origin: 'PATTERN',
	planned_note: null,
	worked_intervals: null,
	break_minutes: 0,
	approval_id: null,
	...over
});

const write = (input, existing) =>
	Effect.runSync(workDayHooks.mutate.perRecord.before.handler({ input, existing, prepared, api }));

const PUNCHED = [{ start: '2026-03-10T01:00:00.000Z', end: '2026-03-10T09:00:00.000Z' }];

test('null is no attendance; an empty list is a statement somebody made about the day', () => {
	assert.equal(attendanceRecorded(null), false);
	assert.equal(attendanceRecorded(undefined), false);
	// `[]` is "the day was reviewed and produced nothing" — a different fact from "nobody looked",
	// and just as much a reason not to move the plan under it.
	assert.equal(attendanceRecorded([]), true);
	assert.equal(attendanceRecorded(PUNCHED), true);
});

test('only a real change to a plan column counts as one', () => {
	const existing = stored();
	assert.deepEqual(planChanges({}, existing), [], 'a write that mentions nothing changes nothing');
	assert.deepEqual(
		planChanges({ worked_intervals: PUNCHED, break_minutes: 30 }, existing),
		[],
		'the attendance half is not the plan half'
	);
	assert.deepEqual(
		planChanges({ shift_definition_id: WORK }, existing),
		[],
		'restating the value it already holds is not a change'
	);
	assert.deepEqual(planChanges({ shift_definition_id: REST }, existing), ['shift_definition_id']);
	// A column the row never carried reads back `undefined`, and a write that means "no plan"
	// sends `null`. Those are one state — an attendance edit that echoes the plan columns back is
	// the ordinary write, and treating it as a change would lock every punched day out of its own
	// corrections.
	assert.deepEqual(
		planChanges({ shift_definition_id: null }, stored({ shift_definition_id: undefined })),
		[]
	);
	assert.deepEqual(planChanges({ planned_note: null }, existing), []);
	assert.deepEqual(
		planChanges({ planned_note: 'swapped', assignment_code: 'A' }, existing).toSorted(),
		['assignment_code', 'planned_note']
	);
});

test('a punched day refuses a plan change, and says the one way out', () => {
	assert.throws(
		() => write({ shift_definition_id: REST }, stored({ worked_intervals: PUNCHED })),
		(error) => {
			const message = String(error?.message ?? error);
			assert.match(message, /roster for 2026-03-10 is locked/);
			assert.match(message, /attendance has already been recorded/);
			assert.match(message, /shift_definition_id/);
			assert.match(message, /Clear the recorded time first/);
			return true;
		}
	);
});

test('the same day with no attendance shifts freely', () => {
	write({ shift_definition_id: REST }, stored());
	// And a day reviewed and found empty is locked, because somebody stated that about it.
	assert.throws(
		() => write({ shift_definition_id: REST }, stored({ worked_intervals: [] })),
		/is locked/
	);
});

/**
 * The negative control, and the reason the check reads the *stored* intervals rather than the
 * incoming ones. A kiosk punch writes `worked_intervals` and `break_minutes` and never touches the
 * plan; if the rule read the candidate it would refuse the first punch of every rostered day.
 */
test('recording attendance is never a plan change, and correcting it stays possible', () => {
	for (const [existing, break_minutes] of [
		[stored(), 30],
		[stored({ worked_intervals: PUNCHED }), 45]
	]) {
		const result = write({ worked_intervals: PUNCHED, break_minutes }, existing);
		assert.deepEqual(result.worked_intervals, PUNCHED);
		assert.equal(result.break_minutes, break_minutes);
		assert.equal(
			result.holiday_calendar_id,
			holidayInput.calendar_id,
			'attendance corrections retain the pinned calendar'
		);
	}
});

test('a day with no plan at all cannot be given one after the fact', () => {
	// Both directions, deliberately. Retro-rostering a punched day would price attendance against a
	// code chosen after the work, which is the same defect read backwards — and the month rule
	// already scores an unplanned punched day against the pattern, so nothing needs the plan set.
	assert.throws(
		() =>
			write(
				{ shift_definition_id: WORK },
				stored({ shift_definition_id: null, worked_intervals: PUNCHED })
			),
		/is locked/
	);
});
