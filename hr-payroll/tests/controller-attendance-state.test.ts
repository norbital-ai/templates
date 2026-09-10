// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	attendanceChanged,
	daySheetSaveIntent,
	daySheetSaveLabelKey
} from '../src/lib/ui/roster/controller-attendance-state.ts';
import { assessAttendanceDraft } from '../src/lib/ui/roster/roster-month.ts';

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

test('footer labels name the pending write, not a generic Save', () => {
	assert.equal(daySheetSaveLabelKey('controller', 'assignment'), 'roster.save_assignment');
	assert.equal(daySheetSaveLabelKey('controller', 'attendance'), 'roster.save_attendance');
	assert.equal(daySheetSaveLabelKey('controller', 'changes'), 'roster.save_changes');
	assert.equal(daySheetSaveLabelKey('employee', 'attendance'), 'roster.save_punch');
	assert.equal(daySheetSaveLabelKey('employee', 'changes'), 'roster.save_punch');
	const messages = JSON.parse(
		readFileSync(fileURLToPath(new URL('../src/i18n/messages.en.json', import.meta.url)), 'utf8')
	);
	assert.equal(messages['roster.save_assignment'], 'Save assignment');
	assert.equal(messages['roster.save_attendance'], 'Save attendance');
	assert.equal(messages['roster.save_changes'], 'Save changes');
	assert.equal(messages['roster.save_punch'], 'Save punch');
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
