// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	attendanceChanged,
	buildPersonDayMutation,
	resolvePersonDayWriteId,
	daySheetAttendanceSaveAllowed,
	daySheetSaveIntent,
	daySheetSaveLabelKey
} from '../../src/lib/ui/roster/controller-attendance-state.ts';
import { formatDateISO } from '@norbital-ai/std/date';
import {
	assessAttendanceDraft,
	indexWorkDaysByPersonDay,
	personDayKey
} from '../../src/lib/ui/roster/roster-month.ts';

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
		readFileSync(fileURLToPath(new URL('../../src/i18n/messages.en.json', import.meta.url)), 'utf8')
	);
	assert.equal(messages['roster.save_assignment'], 'Save assignment');
	assert.equal(messages['roster.save_attendance'], 'Save attendance');
	assert.equal(messages['roster.save_changes'], 'Save changes');
	assert.equal(messages['roster.save_punch'], 'Save punch');
});

test('an empty reviewed day is saveable attendance, and is not a missing interval', () => {
	assert.equal(
		daySheetAttendanceSaveAllowed({ intervals: [], breakMinutes: 0 }, false, 'NO_INTERVALS'),
		true
	);
	assert.equal(
		daySheetAttendanceSaveAllowed({ intervals: null, breakMinutes: 0 }, false, 'NO_INTERVALS'),
		true
	);
	assert.equal(
		daySheetAttendanceSaveAllowed({ intervals: [interval], breakMinutes: 30 }, true, null),
		false
	);
	assert.deepEqual(
		buildPersonDayMutation({
			id: 'person-day-1',
			employmentId: 'employment-1',
			date: '2026-08-04',
			plan: null,
			attendance: { intervals: [], breakMinutes: 0 }
		}),
		{ id: 'person-day-1', worked_intervals: [], break_minutes: 0 }
	);
});

test('A1: Mark reviewed on a stored person-day updates that row, never inserts a second', () => {
	const employmentId = 'employment-taufik';
	const cellDate = '2026-02-01';
	const storedInstant = '2026-01-31T16:00:00.000Z';
	const storedId = 'taufik-feb-1';
	const loaded = [{ id: storedId, employment_id: employmentId, work_date: storedInstant }];

	assert.equal(formatDateISO(storedInstant), '2026-01-31');
	const utcKeyed = new Map(
		loaded.map((day) => [personDayKey(day.employment_id, formatDateISO(day.work_date)), day])
	);
	assert.equal(utcKeyed.get(personDayKey(employmentId, cellDate)), undefined);

	const indexed = indexWorkDaysByPersonDay(loaded);
	assert.equal(indexed.get(personDayKey(employmentId, cellDate))?.id, storedId);
	assert.equal(indexed.get(personDayKey(employmentId, formatDateISO(storedInstant))), undefined);

	const existing = indexWorkDaysByPersonDay(loaded).get(personDayKey(employmentId, cellDate));
	const mutation = buildPersonDayMutation({
		id: resolvePersonDayWriteId(existing?.id, storedId),
		employmentId,
		date: cellDate,
		plan: null,
		attendance: { intervals: [], breakMinutes: 0 }
	});
	assert.deepEqual(mutation, { id: storedId, worked_intervals: [], break_minutes: 0 });
	assert.equal('employment_id' in mutation, false);

	const created = buildPersonDayMutation({
		id: resolvePersonDayWriteId(undefined, null),
		employmentId,
		date: cellDate,
		plan: null,
		attendance: { intervals: [], breakMinutes: 0 }
	});
	assert.deepEqual(created, {
		employment_id: employmentId,
		work_date: cellDate,
		worked_intervals: [],
		break_minutes: 0
	});
	assert.equal('id' in created, false);
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

test('A4: approval-gated attendance keeps intervals null distinct from reviewed-empty []', () => {
	assert.deepEqual(
		buildPersonDayMutation({
			id: 'person-day-a4',
			employmentId: 'employment-1',
			date: '2026-08-04',
			plan: null,
			attendance: { intervals: null, breakMinutes: 0 }
		}),
		{ id: 'person-day-a4', worked_intervals: null, break_minutes: 0 }
	);
	assert.deepEqual(
		buildPersonDayMutation({
			id: 'person-day-a4',
			employmentId: 'employment-1',
			date: '2026-08-04',
			plan: null,
			attendance: { intervals: [], breakMinutes: 0 }
		}),
		{ id: 'person-day-a4', worked_intervals: [], break_minutes: 0 }
	);
	assert.doesNotThrow(() => assessAttendanceDraft([], 0));
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
