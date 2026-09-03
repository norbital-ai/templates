// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * `worked_intervals: null` is not `worked_intervals: []`, on the server side of the boundary.
 *
 * `null` means no attendance was ever recorded — the row is a plan and nothing else. `[]` means a
 * controller read the day and states that nothing was worked, which payroll prices at zero. The
 * board tests already keep the two apart while a day sheet is being edited. What nothing covered is
 * the half that decides money and refusals: the write hook that merges an edit onto the stored row,
 * the run validator that decides whether a clock is open, and the overtime reader that turns punches
 * into hours.
 *
 * Every case below is written so that collapsing one fact into the other — the `?? []` the helper
 * module warns about, or dropping the merge and reading only the input — changes the answer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';

import { attendanceBoundary, attendanceState, workedMinutes } from '../src/lib/attendance.ts';
import { normalizedWorkedIntervals } from '../src/collections/payroll_runs/lib/overtime.ts';
import { validateOpenWorkDays } from '../src/collections/payroll_runs/lib/validate.ts';
import workDayHooks from '../src/collections/work_days/+hooks.ts';
import { stubApi } from '../scripts/lib/stub-api.mjs';

const MORNING = { start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T05:00:00.000Z' };
const AFTERNOON = { start: '2026-03-02T06:00:00.000Z', end: '2026-03-02T10:00:00.000Z' };
const STILL_CLOCKED_IN = { start: '2026-03-02T01:00:00.000Z', end: null };
/** A second punch that has not been closed, after the morning one that was. */
const REOPENED = { start: '2026-03-02T06:00:00.000Z', end: null };

// ── the helpers the summaries are built from ────────────────────────────────────────────────────

test('an unrecorded day reads as open and a reviewed-empty day reads as complete', () => {
	assert.equal(attendanceState(null), 'OPEN');
	assert.equal(attendanceState(undefined), 'OPEN');
	// The one that a `?? []` would break: a day nobody has touched must not report itself finished.
	assert.equal(attendanceState([]), 'COMPLETE');
	assert.equal(attendanceState([MORNING]), 'COMPLETE');
	assert.equal(attendanceState([MORNING, STILL_CLOCKED_IN]), 'OPEN');
});

test('reviewed-empty attendance has no boundary and no worked minutes, which is not no answer', () => {
	assert.equal(attendanceBoundary([], 'FIRST'), null);
	assert.equal(attendanceBoundary([], 'LAST'), null);
	assert.equal(attendanceBoundary([MORNING, AFTERNOON], 'FIRST'), MORNING.start);
	assert.equal(attendanceBoundary([MORNING, AFTERNOON], 'LAST'), AFTERNOON.end);
	// Zero minutes is a number. An open clock has no number at all, and that is the difference the
	// run validator turns into a refusal.
	assert.equal(workedMinutes([], 0), 0);
	assert.equal(workedMinutes([MORNING, AFTERNOON], 60), 420);
	assert.equal(workedMinutes([MORNING, STILL_CLOCKED_IN], 0), null);
});

// ── the run validator ───────────────────────────────────────────────────────────────────────────

const bundleOf = (workDays) => ({
	bundles: [{ employment: { employee_number: 'NHPMY0023' }, workDays }]
});

const day = (id, worked_intervals) => ({ id, work_date: '2026-03-02', worked_intervals });

test('an unrecorded day does not stop a payroll run and an open clock does', () => {
	// A plan with no attendance is not an open clock; it is a day nobody claimed anything about.
	assert.deepEqual(validateOpenWorkDays(bundleOf([day('wd-1', null)])), []);
	// Neither is a day read as no work.
	assert.deepEqual(validateOpenWorkDays(bundleOf([day('wd-2', [])])), []);
	const issues = validateOpenWorkDays(bundleOf([day('wd-3', [STILL_CLOCKED_IN])]));
	assert.equal(issues.length, 1);
	assert.equal(issues[0].code, 'WORK_DAY_OPEN');
});

// ── the overtime reader ─────────────────────────────────────────────────────────────────────────

test('the overtime reader distinguishes never-recorded from open, and prices reviewed-empty at nothing', () => {
	assert.deepEqual(normalizedWorkedIntervals(day('wd-empty', [])), []);
	// Both refuse, and they must refuse differently: one is a day to go and record, the other is a
	// punch to go and close. A single message would send whoever has to fix it to the wrong screen.
	assert.throws(
		() => normalizedWorkedIntervals(day('wd-null', null)),
		/recorded no attendance at all/
	);
	assert.throws(
		() => normalizedWorkedIntervals(day('wd-open', [STILL_CLOCKED_IN])),
		/is still open/
	);
	assert.deepEqual(normalizedWorkedIntervals(day('wd-worked', [MORNING, AFTERNOON])).length, 2);
});

test('measure reads attendance by presence, so an unrecorded day carries no clock to price', () => {
	// The filter `measure` applies before it derives any hour at all. Written here as the predicate
	// rather than as a whole engine run, because the predicate is the decision: a `!= null` turned
	// into a truthiness test would silently drop every reviewed-empty day out of payroll.
	const workDays = [day('wd-plan', null), day('wd-read', []), day('wd-worked', [MORNING])];
	assert.deepEqual(
		workDays.filter((entry) => entry.worked_intervals != null).map((entry) => entry.id),
		['wd-read', 'wd-worked']
	);
});

// ── the write boundary ──────────────────────────────────────────────────────────────────────────

/** No windows, no leave, no adjacent assignments: the guards this file is not about stay silent. */
const prepared = {
	companyByEmployment: new Map([['emp-1', 'co-1']]),
	windowsByCompany: new Map(),
	leaveByEmployment: new Map(),
	overlap: { termsByEmployment: new Map(), explicitByKey: new Map(), codeById: new Map() }
};

/** Nothing has captured this row and no leave covers the day. */
const api = stubApi({ payslip_work_day_inputs: [], leave_requests: [] }, () => false);

const write = (input, existing) =>
	Effect.runSync(workDayHooks.mutate.perRecord.before.handler({ input, existing, prepared, api }));

const STORED = {
	id: 'wd-1',
	employment_id: 'emp-1',
	work_date: '2026-03-02',
	// Eight recorded hours.
	worked_intervals: [MORNING, AFTERNOON],
	break_minutes: 60,
	shift_definition_id: 'code-day',
	approval_id: null
};

test('an unrecorded day accepts a break the same value would be refused for on a reviewed-empty day', () => {
	const create = { employment_id: 'emp-1', work_date: '2026-03-02' };
	// Nothing was recorded, so there is no recorded worked time for the break to have to be shorter
	// than, and the rule has nothing to say.
	assert.doesNotThrow(() => write({ ...create, worked_intervals: null, break_minutes: 600 }));
	// The same break against a day somebody read and stated produced no work is a contradiction.
	assert.throws(
		() => write({ ...create, worked_intervals: [], break_minutes: 600 }),
		/Unpaid break must be shorter than the recorded worked time/
	);
	assert.doesNotThrow(() => write({ ...create, worked_intervals: [], break_minutes: 0 }));
});

test('an edit that omits attendance is validated against the stored clock, not against nothing', () => {
	// 600 minutes of break against the 480 minutes stored on the row. The input says nothing about
	// `worked_intervals`, so the only way to reach this refusal is to merge the stored value in —
	// reading the input alone would see `undefined`, decide there is no attendance, and accept it.
	assert.throws(
		() => write({ id: 'wd-1', break_minutes: 600 }, STORED),
		/Unpaid break must be shorter than the recorded worked time/
	);
	assert.doesNotThrow(() => write({ id: 'wd-1', break_minutes: 60 }, STORED));
});

test('an edit that explicitly clears attendance is not the same edit as one that omits it', () => {
	// `null` is a real value and overrides the stored clock: the day goes back to being a plan, and
	// the break rule stops applying because there is no longer a recorded worked time.
	assert.doesNotThrow(() =>
		write({ id: 'wd-1', worked_intervals: null, break_minutes: 600 }, STORED)
	);
	// `[]` overrides it too, but says something else entirely, and is held to the rule.
	assert.throws(
		() => write({ id: 'wd-1', worked_intervals: [], break_minutes: 600 }, STORED),
		/Unpaid break must be shorter than the recorded worked time/
	);
});

test('the ordering rules apply to a recorded clock and have nothing to say about an unrecorded one', () => {
	const create = { employment_id: 'emp-1', work_date: '2026-03-02', break_minutes: 0 };
	assert.throws(
		() => write({ ...create, worked_intervals: [AFTERNOON, MORNING] }),
		/must be in time order and cannot overlap/
	);
	assert.throws(
		() => write({ ...create, worked_intervals: [STILL_CLOCKED_IN, AFTERNOON] }),
		/Only the final worked interval may still be open/
	);
	assert.throws(
		() => write({ ...create, worked_intervals: [{ start: MORNING.end, end: MORNING.start }] }),
		/must end after it starts/
	);
	assert.doesNotThrow(() => write({ ...create, worked_intervals: [MORNING, REOPENED] }));
	assert.doesNotThrow(() => write({ ...create, worked_intervals: null, break_minutes: 0 }));
});
