// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	attendanceChanged,
	buildPersonDayMutation,
	daySheetSaveIntent
} from './controller-attendance-state.ts';
import { assessAttendanceDraft } from './roster-month.ts';

const interval = {
	start: '2026-08-04T00:00:00.000Z',
	end: '2026-08-04T08:00:00.000Z'
};

test('unrecorded attendance and reviewed-no-work are different dirty states', () => {
	assert.equal(
		attendanceChanged({ intervals: null, breakMinutes: 0 }, { intervals: [], breakMinutes: 0 }),
		true
	);
	assert.equal(
		attendanceChanged({ intervals: [], breakMinutes: 0 }, { intervals: null, breakMinutes: 0 }),
		true
	);
});

test('attendance equality includes interval bounds and the actual unpaid break', () => {
	assert.equal(
		attendanceChanged(
			{ intervals: [interval], breakMinutes: 30 },
			{ intervals: [interval], breakMinutes: 30 }
		),
		false
	);
	assert.equal(
		attendanceChanged(
			{ intervals: [interval], breakMinutes: 30 },
			{ intervals: [{ ...interval, end: null }], breakMinutes: 30 }
		),
		true
	);
});

test('save intent tracks plan and attendance independently', () => {
	assert.equal(daySheetSaveIntent(true, false), 'assignment');
	assert.equal(daySheetSaveIntent(false, true), 'attendance');
	assert.equal(daySheetSaveIntent(true, true), 'changes');
	assert.equal(daySheetSaveIntent(false, false), 'none');
});

test('attendance-only create carries identity and actual fields but no plan', () => {
	assert.deepEqual(
		buildPersonDayMutation({
			id: null,
			employmentId: 'employment-1',
			date: '2026-08-04',
			plan: null,
			attendance: { intervals: [interval], breakMinutes: 30 }
		}),
		{
			employment_id: 'employment-1',
			work_date: '2026-08-04',
			worked_intervals: [interval],
			break_minutes: 30
		}
	);
});

test('attendance-only update preserves every planned field by omission', () => {
	assert.deepEqual(
		buildPersonDayMutation({
			id: 'person-day-1',
			employmentId: 'employment-1',
			date: '2026-08-04',
			plan: null,
			attendance: { intervals: [], breakMinutes: 45 }
		}),
		{ id: 'person-day-1', worked_intervals: [], break_minutes: 0 }
	);
});

test('explicit clear writes null while a combined change remains one mutation', () => {
	assert.deepEqual(
		buildPersonDayMutation({
			id: 'person-day-1',
			employmentId: 'employment-1',
			date: '2026-08-04',
			plan: { rosterCodeId: 'night', rosterId: 'roster-1', note: null },
			attendance: { intervals: null, breakMinutes: 60 }
		}),
		{
			id: 'person-day-1',
			shift_definition_id: 'night',
			roster_id: 'roster-1',
			planned_origin: 'MANUAL',
			planned_note: null,
			worked_intervals: null,
			break_minutes: 0
		}
	);
});

test('multiple, overnight and final-open intervals remain valid controller attendance shapes', () => {
	const multiple = assessAttendanceDraft(
		[
			{ start: '2026-08-04T00:00:00.000Z', end: '2026-08-04T04:00:00.000Z' },
			{ start: '2026-08-04T05:00:00.000Z', end: '2026-08-04T09:00:00.000Z' }
		],
		60
	);
	const overnight = assessAttendanceDraft(
		[{ start: '2026-08-04T14:00:00.000Z', end: '2026-08-05T02:00:00.000Z' }],
		60
	);
	const open = assessAttendanceDraft([{ start: '2026-08-04T08:00:00.000Z', end: null }], 0);

	assert.equal(multiple.problem, null);
	assert.equal(overnight.problem, null);
	assert.equal(open.problem, null);
	assert.equal(open.hasOpenInterval, true);
});

test('overlapping intervals are refused before submission', () => {
	const assessment = assessAttendanceDraft(
		[
			{ start: '2026-08-04T08:00:00.000Z', end: '2026-08-04T12:00:00.000Z' },
			{ start: '2026-08-04T11:30:00.000Z', end: '2026-08-04T13:00:00.000Z' }
		],
		0
	);
	assert.equal(assessment.problem, 'OUT_OF_ORDER');
});
