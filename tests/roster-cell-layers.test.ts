// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The three layers of a person-day, resolved once for both surfaces.
 *
 * Every employment has a BASE (the day its named shift pattern projects), a `work_days` row is an
 * OVERRIDE of one date, and the row's actual side is the TIME ENTRIES. `resolveCellLayers` says
 * which of the three a cell carries, and the counts and the employee's punch rule are built on the
 * same facts. These are the contract the board, the calendar and the day sheet all draw from.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildRosterMonth,
	describeClockLayer,
	describePlanLayer,
	monthProgress,
	resolveCellLayers
} from '../src/lib/ui/roster/roster-month.ts';
import { employeeMissingPunchReportable } from '../src/lib/ui/roster/employee-reportability.ts';

const EMPLOYMENT = 'employment-1';
const ROSTERED_EMPLOYMENT = 'employment-2';
const DAY_ID = 'code-day';
const NIGHT_ID = 'code-night';
const REST_ID = 'code-rest';
const codes = new Map([
	[
		DAY_ID,
		{
			code: 'A',
			variant: { kind: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
		}
	],
	[
		NIGHT_ID,
		{
			code: 'N',
			variant: { kind: 'WORK', start_time: '20:00', end_time: '05:00', break_minutes: 60 }
		}
	],
	[REST_ID, { code: 'REST', variant: { kind: 'REST' } }]
]);

/** Two mornings, two off, anchored on a Monday: 03 Aug and 04 Aug work, 05 and 06 rest. */
const pattern = {
	id: 'sp-1',
	code: 'A-2x2',
	pattern: {
		type: 'PATTERNED',
		anchor_date: '2026-08-03',
		phases: [
			{
				duration: { kind: 'CONTINUOUS' },
				day_cycle: [DAY_ID, DAY_ID, REST_ID, REST_ID].map((roster_code_id) => ({ roster_code_id }))
			}
		]
	}
};

const term = (employmentId, shiftPatternId, row) => ({
	employment_id: employmentId,
	shift_pattern_id: shiftPatternId,
	term_shift_pattern: row,
	effective_range: { start: '2026-01-01', end: null }
});

function month(overrides = {}) {
	return buildRosterMonth({
		month: '2026-08',
		employments: [
			{ id: EMPLOYMENT, effective_range: { start: '2026-01-01', end: null } },
			{ id: ROSTERED_EMPLOYMENT, effective_range: { start: '2026-01-01', end: null } }
		],
		employmentTerms: [term(EMPLOYMENT, 'sp-1', pattern), term(ROSTERED_EMPLOYMENT, null, null)],
		workDays: [],
		leaveRequests: [],
		pendingLeaveRequests: [],
		holidays: [],
		rosterCodesById: codes,
		leaveCodeById: new Map(),
		cutoff: { start: '2026-08-01', end: '2026-08-31' },
		locks: new Map(),
		today: '2026-08-20',
		...overrides
	});
}

const row = (date, extra = {}) => ({
	id: `row-${date}`,
	employment_id: EMPLOYMENT,
	work_date: date,
	shift_definition_id: null,
	planned_origin: null,
	worked_intervals: null,
	break_minutes: 0,
	...extra
});

const t = (key, params = {}) =>
	`${key}${Object.keys(params).length === 0 ? '' : ` ${JSON.stringify(params)}`}`;

test('base only: a day with no row carries the pattern projection and nothing else', () => {
	const day = month().get(`${EMPLOYMENT}:2026-08-03`);
	assert.deepEqual(resolveCellLayers(day), {
		base: { code: 'A', kind: 'WORK', patternCode: 'A-2x2' },
		override: null,
		actual: { kind: 'NONE' },
		effective: 'BASE'
	});
	assert.equal(day.basePatternCode, 'A-2x2');
	assert.equal(day.status, 'PLANNED');
	assert.match(describePlanLayer(day, t), /roster\.layer_base_from \{"pattern":"A-2x2"\}/);
	assert.match(describeClockLayer(day, t), /no_attendance_in_pay_period/);
});

test('a rest day of the base is a base layer too, with the rest code', () => {
	const day = month().get(`${EMPLOYMENT}:2026-08-05`);
	const layers = resolveCellLayers(day);
	assert.deepEqual(layers.base, { code: 'REST', kind: 'REST', patternCode: 'A-2x2' });
	assert.equal(layers.override, null);
	assert.equal(layers.effective, 'BASE');
	assert.equal(day.status, 'REST');
});

test('override: a roster row replaces the base for its date and says where it came from', () => {
	const facts = month({
		workDays: [row('2026-08-05', { shift_definition_id: NIGHT_ID, planned_origin: 'IMPORT' })]
	});
	const day = facts.get(`${EMPLOYMENT}:2026-08-05`);
	const layers = resolveCellLayers(day);
	assert.deepEqual(layers.base, { code: 'REST', kind: 'REST', patternCode: 'A-2x2' });
	assert.deepEqual(layers.override, { code: 'N', kind: 'WORK', origin: 'IMPORT' });
	assert.equal(layers.effective, 'OVERRIDE');
	assert.equal(day.shiftCode, 'N');
	// Work rostered over a rest base is planned extra work, as before.
	assert.equal(day.plannedOT, true);
	assert.match(
		describePlanLayer(day, t),
		/roster\.layer_override_over_base \{"origin":"roster\.layer_override_imported","base":"REST"\}/
	);
});

test('override with punches: the clock layer carries the punch window in the payroll zone', () => {
	const facts = month({
		workDays: [
			row('2026-08-04', {
				shift_definition_id: DAY_ID,
				planned_origin: 'MANUAL',
				worked_intervals: [{ start: '2026-08-04T00:31:00.000Z', end: '2026-08-04T09:02:00.000Z' }],
				break_minutes: 60
			})
		]
	});
	const day = facts.get(`${EMPLOYMENT}:2026-08-04`);
	const layers = resolveCellLayers(day);
	assert.equal(layers.effective, 'OVERRIDE');
	assert.deepEqual(layers.actual, {
		kind: 'CLOCKED',
		first: '08:31',
		last: '17:02',
		workedMinutes: 451
	});
	assert.deepEqual(day.punchWindow, { first: '08:31', last: '17:02' });
	assert.equal(day.status, 'ATTENDED');
	assert.match(describeClockLayer(day, t), /roster\.layer_clocked_window/);
});

test('a running clock is the OPEN layer, with its first punch', () => {
	const facts = month({
		workDays: [
			row('2026-08-04', {
				worked_intervals: [{ start: '2026-08-04T00:31:00.000Z', end: null }]
			})
		]
	});
	const layers = resolveCellLayers(facts.get(`${EMPLOYMENT}:2026-08-04`));
	assert.deepEqual(layers.actual, { kind: 'OPEN', first: '08:31' });
	// Attendance alone is not a plan: the base stays in force.
	assert.equal(layers.effective, 'BASE');
});

test('an empty row on a work day is AWOL; on a rest day it is merely reviewed empty', () => {
	const facts = month({
		workDays: [
			row('2026-08-04', { worked_intervals: [] }),
			row('2026-08-05', { worked_intervals: [] })
		]
	});
	const awol = facts.get(`${EMPLOYMENT}:2026-08-04`);
	assert.equal(awol.status, 'ABSENT');
	assert.deepEqual(resolveCellLayers(awol).actual, { kind: 'AWOL' });
	assert.equal(describeClockLayer(awol, t), 'roster.layer_awol');
	const rest = facts.get(`${EMPLOYMENT}:2026-08-05`);
	assert.equal(rest.status, 'REST');
	assert.deepEqual(resolveCellLayers(rest).actual, { kind: 'EMPTY' });
});

test('a rostered employment has no base: every untouched day is unrostered', () => {
	const day = month().get(`${ROSTERED_EMPLOYMENT}:2026-08-04`);
	assert.deepEqual(resolveCellLayers(day), {
		base: null,
		override: null,
		actual: { kind: 'NONE' },
		effective: 'NONE'
	});
	assert.equal(day.status, 'UNROSTERED');
	assert.equal(day.scheduleKind, 'ROSTERED');
});

test('counts are honest: overrides are what is assigned, and a patterned person never needs shifts', () => {
	const untouched = monthProgress(month(), 'PUBLISHED');
	assert.equal(untouched.rostered, 0, 'a base day is not an assignment');
	assert.equal(untouched.personDays, 62);
	assert.equal(untouched.peopleNeedingAssignment, 1, 'only the rostered employment needs shifts');

	const oneRow = monthProgress(
		month({
			workDays: [
				row('2026-08-05', { shift_definition_id: NIGHT_ID }),
				{
					id: 'row-rostered',
					employment_id: ROSTERED_EMPLOYMENT,
					work_date: '2026-08-10',
					shift_definition_id: DAY_ID,
					worked_intervals: null,
					break_minutes: 0
				}
			]
		}),
		'PUBLISHED'
	);
	assert.equal(oneRow.rostered, 2);
	assert.equal(oneRow.peopleNeedingAssignment, 0, 'one roster row is enough to stop needing');
});

test('an employee punches only on a roster row: a base day is read-only', () => {
	const facts = month({ workDays: [row('2026-08-04', { shift_definition_id: DAY_ID })] });
	const none = new Set();
	const baseDay = facts.get(`${EMPLOYMENT}:2026-08-03`);
	assert.equal(baseDay.workDayId, null);
	assert.equal(employeeMissingPunchReportable(baseDay, '2026-08-20', none, none), false);
	const rowDay = facts.get(`${EMPLOYMENT}:2026-08-04`);
	assert.equal(rowDay.workDayId, 'row-2026-08-04');
	assert.equal(employeeMissingPunchReportable(rowDay, '2026-08-20', none, none), true);
	// The other refusals still hold on a row: a future day, and a day already punched.
	assert.equal(employeeMissingPunchReportable(rowDay, '2026-08-01', none, none), false);
	const punched = month({
		workDays: [
			row('2026-08-04', {
				worked_intervals: [{ start: '2026-08-04T00:31:00.000Z', end: '2026-08-04T09:02:00.000Z' }]
			})
		]
	}).get(`${EMPLOYMENT}:2026-08-04`);
	assert.equal(employeeMissingPunchReportable(punched, '2026-08-20', none, none), false);
});
