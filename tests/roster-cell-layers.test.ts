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
	resolveCellLayers,
	signedHalfHoursLabel,
	slotFill,
	slotState
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
		days: [DAY_ID, DAY_ID, REST_ID, REST_ID].map((roster_code_id) => ({ roster_code_id }))
	},
	effective_range: { start: '2026-08-03', end: null }
};

const term = (employmentId, shiftPatternId, row) => ({
	employment_id: employmentId,
	agreed_days_per_week: 5,
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
	worked_intervals: null,
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

test('override: a roster row replaces the base for its date', () => {
	const facts = month({ workDays: [row('2026-08-05', { shift_definition_id: NIGHT_ID })] });
	const day = facts.get(`${EMPLOYMENT}:2026-08-05`);
	const layers = resolveCellLayers(day);
	assert.deepEqual(layers.base, { code: 'REST', kind: 'REST', patternCode: 'A-2x2' });
	assert.deepEqual(layers.override, { code: 'N', kind: 'WORK' });
	assert.equal(layers.effective, 'OVERRIDE');
	assert.equal(day.shiftCode, 'N');
	// Work rostered over a rest base is planned extra work, as before.
	assert.equal(day.plannedOT, true);
	assert.match(
		describePlanLayer(day, t),
		/roster\.layer_override_over_base \{"origin":"roster\.layer_override","base":"REST"\}/
	);
});

test('override with punches: the clock layer carries the punch window in the payroll zone', () => {
	const facts = month({
		workDays: [
			row('2026-08-04', {
				shift_definition_id: DAY_ID,
				worked_intervals: [{ start: '2026-08-04T00:31:00.000Z', end: '2026-08-04T09:02:00.000Z' }]
			})
		]
	});
	const day = facts.get(`${EMPLOYMENT}:2026-08-04`);
	const layers = resolveCellLayers(day);
	assert.equal(layers.effective, 'OVERRIDE');
	// 511 gross, less the shift's granted hour: one interval takes the whole break off.
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

test('punch clocks read in the timezone the board is handed, not the payroll default', () => {
	// A Jakarta entity's 08:02 punch is 01:02Z; read through Kuala Lumpur it showed 09:02.
	const punched = row('2026-08-03', {
		worked_intervals: [{ start: '2026-08-03T01:02:00.000Z', end: '2026-08-03T10:05:00.000Z' }]
	});
	const key = `${EMPLOYMENT}:2026-08-03`;
	assert.equal(
		month({ workDays: [punched], timeZone: 'Asia/Jakarta' }).get(key)?.punchWindow?.first,
		'08:02'
	);
	assert.equal(month({ workDays: [punched] }).get(key)?.punchWindow?.first, '09:02');
});

test('the slot fill is the clock against the plan: signed to the half hour, all extra with no plan', () => {
	const punched = (date, code, start, end) =>
		row(date, {
			shift_definition_id: code,
			worked_intervals: [{ start, end }]
		});
	const facts = month({
		workDays: [
			// 08:31–17:20 on an eight-hour shift: 469 worked, −11 → rounds to the plan.
			punched('2026-08-03', DAY_ID, '2026-08-03T00:31:00.000Z', '2026-08-03T09:20:00.000Z'),
			// 08:00–18:35 on the same shift: 575 worked, +95 → +1.5h.
			punched('2026-08-04', DAY_ID, '2026-08-04T00:00:00.000Z', '2026-08-04T10:35:00.000Z'),
			// 08:00–15:00: 360 worked, −120 → −2h, a short day.
			punched('2026-08-10', DAY_ID, '2026-08-10T00:00:00.000Z', '2026-08-10T07:00:00.000Z'),
			// A rest day worked: nothing planned, every minute is extra.
			punched('2026-08-05', REST_ID, '2026-08-05T00:00:00.000Z', '2026-08-05T04:00:00.000Z')
		]
	});
	const fillOf = (date) => slotFill(facts.get(`${EMPLOYMENT}:${date}`));
	const label = (date) => signedHalfHoursLabel(fillOf(date).deltaMinutes);
	assert.equal(fillOf('2026-08-03').deltaMinutes, -11);
	assert.equal(fillOf('2026-08-03').short, false);
	assert.equal(label('2026-08-04'), '+1.5h');
	assert.equal(fillOf('2026-08-04').short, false);
	assert.equal(label('2026-08-10'), '−2h');
	assert.equal(fillOf('2026-08-10').short, true);
	assert.equal(label('2026-08-05'), '+4h');
	assert.equal(fillOf('2026-08-05').ratio, 1);
	// The states the fill sits on: rest stays rest under a clock; a base day is plain work.
	assert.equal(slotState(facts.get(`${EMPLOYMENT}:2026-08-05`)), 'REST');
	assert.equal(slotState(facts.get(`${EMPLOYMENT}:2026-08-03`)), 'WORK');
	assert.equal(slotState(facts.get(`${EMPLOYMENT}:2026-08-06`)), 'REST');
	assert.equal(slotState(facts.get(`${ROSTERED_EMPLOYMENT}:2026-08-06`)), 'UNROSTERED');
	assert.equal(slotFill(facts.get(`${EMPLOYMENT}:2026-08-06`)).kind, 'NONE');
});
