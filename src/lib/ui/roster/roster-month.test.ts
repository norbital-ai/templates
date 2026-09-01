// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The attendance half of a person-day, and the ladder drawn beside it.
 *
 * `src/lib/scheduling/roster-month.test.ts` already covers the calendar arithmetic — month
 * membership, the exit boundary, the compact time cue. This file covers what the day sheet and the
 * lock rail were added for: the three attendance fields a cell now carries, and the four rungs the
 * rail has. They are tested here rather than there because they are the contract a sibling surface
 * (the employee calendar) codes against, and a contract with no test is a comment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PAYROLL_TIME_ZONE } from '../calendar.ts';
import {
	assessAttendanceDraft,
	beyondScheduleMinutes,
	buildRosterMonth,
	clockToDayMinutes,
	dayMinutesOffsetDays,
	dayMinutesToClock,
	instantFromDayStart,
	lockRung,
	lockRungFreezes,
	lockRungSourceLock,
	minutesFromDayStart,
	scheduledMinutes
} from './roster-month.ts';

const EMPLOYMENT = 'employment-1';

/** A WORK roster code covering 08:00–17:00 with an hour unpaid, which is the seeded common shape. */
const DAY_SHIFT = {
	code: 'A',
	variant: {
		kind: 'WORK',
		start_time: '08:00',
		end_time: '17:00',
		break_minutes: 60,
		paid_minutes: 480
	}
};

function month(overrides = {}) {
	return buildRosterMonth({
		month: '2026-08',
		employments: [{ id: EMPLOYMENT, effective_range: { start: '2026-01-01', end: null } }],
		workDays: [],
		leaveRequests: [],
		pendingLeaveRequests: [],
		holidays: [],
		rosterCodesById: new Map([['code-a', DAY_SHIFT]]),
		employmentTerms: [],
		leaveCodeById: new Map(),
		cutoff: null,
		locks: new Map(),
		today: '2026-08-20',
		...overrides
	});
}

test('a day with no attendance carries nulls, not zeroes', () => {
	const day = month().get(`${EMPLOYMENT}:2026-08-04`);
	assert.equal(day.workDayId, null);
	assert.equal(day.breakMinutes, null);
	// Zero would be a claim that the person worked no minutes. Null is the claim that nobody said.
	assert.equal(day.workedMinutes, null);
});

test('a rostered day nobody has punched has a row id and still no attendance', () => {
	const day = month({
		workDays: [
			{
				id: 'day-plan',
				employment_id: EMPLOYMENT,
				work_date: '2026-08-04',
				shift_definition_id: 'code-a',
				planned_origin: 'IMPORT',
				worked_intervals: null
			}
		]
	}).get(`${EMPLOYMENT}:2026-08-04`);
	// The plan and the clock are one row now, so the id exists as soon as either half does — which
	// is what makes recording a punch on a rostered day an update rather than a second row.
	assert.equal(day.workDayId, 'day-plan');
	assert.equal(day.plannedOrigin, 'IMPORT');
	assert.equal(day.designation, 'WORK');
	assert.equal(day.attendanceState, null);
	assert.equal(day.breakMinutes, null);
	assert.equal(day.workedMinutes, null);
	assert.equal(day.clockedIn, false);
});

test('a materialized pattern day retains GENERATED provenance', () => {
	const day = month({
		workDays: [
			{
				id: 'generated-day',
				employment_id: EMPLOYMENT,
				work_date: '2026-08-05',
				shift_definition_id: 'code-a',
				planned_origin: 'GENERATED',
				worked_intervals: null
			}
		]
	}).get(`${EMPLOYMENT}:2026-08-05`);
	assert.equal(day.plannedOrigin, 'GENERATED');
	assert.equal(day.designation, 'WORK');
});

test('an empty interval array is a day that was read, not a day nobody answered for', () => {
	const day = month({
		workDays: [
			{
				id: 'day-read',
				employment_id: EMPLOYMENT,
				work_date: '2026-08-07',
				worked_intervals: [],
				break_minutes: 0
			}
		]
	}).get(`${EMPLOYMENT}:2026-08-07`);
	assert.equal(day.attendanceState, 'CLOSED');
	assert.equal(day.breakMinutes, 0);
	assert.equal(day.workedMinutes, 0);
	assert.equal(day.clockedIn, false);
});

test('a closed day reports worked minutes net of the unpaid break', () => {
	const day = month({
		workDays: [
			{
				id: 'day-1',
				employment_id: EMPLOYMENT,
				work_date: '2026-08-04',
				break_minutes: 60,
				worked_intervals: [
					{ start: '2026-08-04T00:16:00.000Z', end: '2026-08-04T04:30:00.000Z' },
					{ start: '2026-08-04T05:00:00.000Z', end: '2026-08-04T09:10:00.000Z' }
				]
			}
		]
	}).get(`${EMPLOYMENT}:2026-08-04`);
	assert.equal(day.workDayId, 'day-1');
	assert.equal(day.breakMinutes, 60);
	// 254 + 250 gross, less the 60-minute unpaid break.
	assert.equal(day.workedMinutes, 444);
	assert.equal(day.attendanceState, 'CLOSED');
});

test('an open punch reports no worked minutes at all', () => {
	const day = month({
		workDays: [
			{
				id: 'day-2',
				employment_id: EMPLOYMENT,
				work_date: '2026-08-20',
				break_minutes: 0,
				worked_intervals: [{ start: '2026-08-20T00:02:00.000Z', end: null }]
			}
		]
	}).get(`${EMPLOYMENT}:2026-08-20`);
	assert.equal(day.attendanceState, 'OPEN');
	assert.equal(day.workDayId, 'day-2');
	// A running total would read as a short day on the board, which is the one thing it must not do.
	assert.equal(day.workedMinutes, null);
});

test('Date-valued interval ends are levelled the same way string ones are', () => {
	const day = month({
		workDays: [
			{
				id: 'day-3',
				employment_id: EMPLOYMENT,
				work_date: '2026-08-05',
				break_minutes: 30,
				worked_intervals: [
					{
						start: new Date('2026-08-05T00:00:00.000Z'),
						end: new Date('2026-08-05T08:00:00.000Z')
					}
				]
			}
		]
	}).get(`${EMPLOYMENT}:2026-08-05`);
	assert.equal(day.workedMinutes, 450);
	assert.equal(day.clockedIn, true);
});

test('a missing break column reads as no break, not as a missing entry', () => {
	const day = month({
		workDays: [
			{
				id: 'day-4',
				employment_id: EMPLOYMENT,
				work_date: '2026-08-06',
				worked_intervals: [{ start: '2026-08-06T00:00:00.000Z', end: '2026-08-06T04:00:00.000Z' }]
			}
		]
	}).get(`${EMPLOYMENT}:2026-08-06`);
	assert.equal(day.breakMinutes, 0);
	assert.equal(day.workedMinutes, 240);
});

test('the ladder puts the stored claim above the window it sits in', () => {
	const open = { date: '2026-08-04', lock: { kind: 'NONE' } };
	const inDraft = { date: '2026-08-04', lock: { kind: 'IN_WINDOW', period: '2026-08' } };
	const paidWindow = { date: '2026-08-04', lock: { kind: 'SETTLED', period: '2026-07' } };

	assert.equal(lockRung(open, null), 'OPEN');
	assert.equal(lockRung(inDraft, null), 'IN_DRAFT_RUN');
	assert.equal(lockRung(paidWindow, null), 'PAID');
	// A draft run that already wrote payslips citing this record: the window says advisory, the
	// claim says consumed, and the claim is the one that is true.
	assert.equal(lockRung(inDraft, { period: '2026-08' }), 'CONSUMED');
	assert.equal(lockRung(paidWindow, { period: '2026-07' }), 'PAID');
});

test('only the two permanent rungs refuse a write', () => {
	assert.equal(lockRungFreezes('OPEN'), false);
	// A draft is rebuilt from the records, so editing a day inside one is ordinary work.
	assert.equal(lockRungFreezes('IN_DRAFT_RUN'), false);
	assert.equal(lockRungFreezes('CONSUMED'), true);
	assert.equal(lockRungFreezes('PAID'), true);
});

test('the hover sentence is a SourceLock, so it comes from sourceLockReason', () => {
	const inDraft = { date: '2026-08-04', lock: { kind: 'IN_WINDOW', period: '2026-08' } };
	const paidWindow = { date: '2026-08-04', lock: { kind: 'SETTLED', period: '2026-07' } };

	assert.equal(lockRungSourceLock(inDraft, null), null);
	assert.deepEqual(lockRungSourceLock(inDraft, { period: '2026-08' }), {
		kind: 'SETTLED',
		period: '2026-08'
	});
	// The unconsumed record inside a paid window: named as the day-level inference it is, so the
	// sentence is the arrears one rather than the "delete the run" one.
	assert.deepEqual(lockRungSourceLock(paidWindow, null), {
		kind: 'PAID_DAY',
		period: '2026-07',
		date: '2026-08-04'
	});
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The break clamp. This is the regression guard for a defect found in the seed bank: four rows
 * carried a 60-minute unpaid break against nineteen to forty-one minutes of recorded attendance,
 * which `assertWorkedIntervals` refuses with `unpaidBreak >= closedMinutes`. The day sheet must
 * reach the same verdict from the same numbers, before the round trip rather than after it.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** Instants that many minutes apart, so a case reads as the length it is testing. */
function span(startMinute, endMinute) {
	const base = Date.parse('2026-08-04T00:00:00.000Z');
	return {
		start: new Date(base + startMinute * 60_000).toISOString(),
		end: endMinute == null ? null : new Date(base + endMinute * 60_000).toISOString()
	};
}

test('a scheduled hour of break against a nineteen-minute day is clamped, not sent', () => {
	const assessment = assessAttendanceDraft([span(0, 19)], 60);
	assert.equal(assessment.closedMinutes, 19);
	// Strictly below, because the hook refuses greater-OR-EQUAL.
	assert.equal(assessment.maxBreakMinutes, 18);
	assert.equal(assessment.breakMinutes, 18);
	assert.equal(assessment.requestedBreakMinutes, 60);
	// The clamp must be visible. A silently corrected break hides that the punch is the broken half.
	assert.equal(assessment.breakClamped, true);
	assert.equal(assessment.problem, null);
	assert.equal(assessment.workedMinutes, 1);
});

test('a break that already fits is left exactly as the operator set it', () => {
	const assessment = assessAttendanceDraft([span(0, 254), span(284, 534)], 60);
	assert.equal(assessment.breakMinutes, 60);
	assert.equal(assessment.breakClamped, false);
	assert.equal(assessment.workedMinutes, 444);
	assert.equal(assessment.problem, null);
});

test('a break equal to the worked time is one minute too long', () => {
	// 480 >= 480 is the hook's refusal, so the ceiling on an eight-hour day is 479.
	const assessment = assessAttendanceDraft([span(0, 480)], 480);
	assert.equal(assessment.maxBreakMinutes, 479);
	assert.equal(assessment.breakClamped, true);
});

test('a sub-minute day admits a zero break and nothing longer', () => {
	// The hook refuses `unpaidBreak >= closedMinutes`, and 0 IS strictly below 0.5 — so a half-minute
	// day is saveable with no break at all, and every longer break is clamped down to that. This test
	// used to assert `null` and `BREAK_NOT_SHORTER_THAN_WORK` on the belief that a day under a minute
	// could carry no break "including zero", which reads the ceiling as a floor: `Math.floor(0.5)` is
	// 0, and zero fits. The refusal arm belongs to a day of exactly zero worked minutes, which cannot
	// be reached without an interval that already failed `ENDS_BEFORE_IT_STARTS`.
	const assessment = assessAttendanceDraft([span(0, 0.5)], 0);
	assert.equal(assessment.maxBreakMinutes, 0);
	assert.equal(assessment.breakMinutes, 0);
	assert.equal(assessment.breakClamped, false);
	assert.equal(assessment.problem, null);

	const clamped = assessAttendanceDraft([span(0, 0.5)], 30);
	assert.equal(clamped.breakMinutes, 0);
	assert.equal(clamped.breakClamped, true);
	assert.equal(clamped.problem, null);
});

test('an open punch defers the break question instead of clamping against a partial day', () => {
	const assessment = assessAttendanceDraft([span(0, null)], 60);
	assert.equal(assessment.hasOpenInterval, true);
	assert.equal(assessment.maxBreakMinutes, null);
	// Untouched: nobody knows how long the day is yet, so there is nothing to clamp it against.
	assert.equal(assessment.breakMinutes, 60);
	assert.equal(assessment.breakClamped, false);
	assert.equal(assessment.workedMinutes, null);
	assert.equal(assessment.problem, null);
});

test('the three interval faults are named in the order the hook refuses them', () => {
	assert.equal(assessAttendanceDraft([], 0).problem, 'NO_INTERVALS');
	assert.equal(assessAttendanceDraft([span(0, 240), span(120, 300)], 0).problem, 'OUT_OF_ORDER');
	assert.equal(assessAttendanceDraft([span(0, null), span(120, 300)], 0).problem, 'OPEN_NOT_LAST');
	assert.equal(assessAttendanceDraft([span(240, 120)], 0).problem, 'ENDS_BEFORE_IT_STARTS');
});

/* ── Clock times on a work date ───────────────────────────────────────────────────────────────── */

test('a punch is measured from the start of the work date in the business zone', () => {
	// Asia/Kuala_Lumpur is UTC+8, so 08:16 local is 00:16Z on the same calendar day.
	const minutes = minutesFromDayStart('2026-08-04T00:16:00.000Z', '2026-08-04', PAYROLL_TIME_ZONE);
	assert.equal(minutes, 496);
	assert.equal(dayMinutesToClock(minutes), '08:16');
	assert.equal(dayMinutesOffsetDays(minutes), 0);
	assert.equal(
		instantFromDayStart('2026-08-04', minutes, PAYROLL_TIME_ZONE),
		'2026-08-04T00:16:00.000Z'
	);
});

test('a night shift ending next morning stays one interval, past the 1440 mark', () => {
	// 02:00 the following morning, local: 1560 minutes into the work date.
	const minutes = clockToDayMinutes('02:00', 1);
	assert.equal(minutes, 1560);
	assert.equal(dayMinutesToClock(minutes), '02:00');
	assert.equal(dayMinutesOffsetDays(minutes), 1);
	const instant = instantFromDayStart('2026-08-04', minutes, PAYROLL_TIME_ZONE);
	assert.equal(minutesFromDayStart(instant, '2026-08-04', PAYROLL_TIME_ZONE), 1560);
});

test('a clock reading that is not a clock reading is refused rather than coerced', () => {
	assert.equal(clockToDayMinutes('', 0), null);
	assert.equal(clockToDayMinutes('25:00', 0), null);
	assert.equal(clockToDayMinutes('8:16', 0), null);
});

/* ── Beyond schedule, which is derived and read-only ──────────────────────────────────────────── */

test('beyond schedule is the difference between two numbers, never an input', () => {
	const planned = {
		shiftStart: '08:00',
		shiftEnd: '17:00',
		shiftBreakMinutes: 60,
		workedMinutes: 504
	};
	assert.equal(scheduledMinutes(planned), 480);
	assert.equal(beyondScheduleMinutes(planned), 24);
	// An unplanned day has nothing to be beyond, and an open one has no total to compare.
	assert.equal(
		beyondScheduleMinutes({ shiftStart: null, shiftEnd: null, workedMinutes: 504 }),
		null
	);
	assert.equal(beyondScheduleMinutes({ ...planned, workedMinutes: null }), null);
});

test('a shift crossing midnight is measured the way the publish check measures it', () => {
	assert.equal(
		scheduledMinutes({ shiftStart: '22:00', shiftEnd: '06:00', shiftBreakMinutes: 60 }),
		420
	);
});
