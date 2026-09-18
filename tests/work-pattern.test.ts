// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	PATTERN_WITH,
	patternAnchor,
	patternRosterCodeId,
	patternRosterCodeIds,
	patternDaysPerWeek,
	patternWorkDaysPerWeek,
	patternWorkload,
	termPattern,
	termPatternRow
} from '../src/lib/scheduling/work-pattern.ts';
import { workWindow } from '../src/lib/scheduling/roster-code.ts';

const DAY = '00000000-0000-4000-8000-000000000001';
const NIGHT = '00000000-0000-4000-8000-000000000002';
const REST = '00000000-0000-4000-8000-000000000003';
const OFF = '00000000-0000-4000-8000-000000000004';
const codes = new Map([
	[
		DAY,
		{
			code: 'DAY',
			variant: { kind: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
		}
	],
	[
		NIGHT,
		{
			code: 'NIGHT',
			variant: { kind: 'WORK', start_time: '20:00', end_time: '08:00', break_minutes: 60 }
		}
	],
	[REST, { code: 'REST', variant: { kind: 'REST' } }],
	[OFF, { code: 'OFF', variant: { kind: 'OFF' } }]
]);

const dayOf = (roster_code_id) => ({ roster_code_id });

test('one seven-day cycle normalizes a fixed five-day employment', () => {
	const pattern = { days: [DAY, DAY, DAY, DAY, DAY, OFF, REST].map(dayOf) };
	const anchor = '2026-08-03';
	assert.equal(patternRosterCodeId(pattern, '2026-08-08', anchor), OFF);
	assert.equal(patternRosterCodeId(pattern, '2026-08-09', anchor), REST);
	assert.equal(patternRosterCodeId(pattern, '2026-08-02', anchor), REST);
	assert.deepEqual(patternWorkload(pattern, codes), {
		work_days: 5,
		paid_minutes: 2400,
		reference_days: 7,
		average_weekly_paid_minutes: 2400
	});
});

test('an expectation projects no cycle and states its own amount', () => {
	const pattern = {
		expectation: {
			kind: 'GUARANTEED_SCHEDULE',
			days_per_week: 3,
			paid_minutes_per_week: 1440
		}
	};
	assert.equal(patternRosterCodeId(pattern, '2026-08-04', '2026-08-03'), null);
	assert.deepEqual(patternWorkload(pattern, codes), {
		work_days: 3,
		paid_minutes: 1440,
		reference_days: 7,
		average_weekly_paid_minutes: 1440
	});
});

test('crossing midnight and paid minutes derive from the WORK code', () => {
	assert.deepEqual(workWindow(codes.get(NIGHT)!.variant), {
		start_time: '20:00',
		end_time: '08:00',
		break_minutes: 60,
		crosses_midnight: true,
		elapsed_minutes: 720,
		paid_minutes: 660
	});
});

/* ── the pattern is read through the terms row ──────────────────────────────────────────────── */

const twoOnTwoOff = { days: [DAY, DAY, OFF, OFF].map(dayOf) };
const namedRow = {
	id: 'sp-1',
	code: 'DAY-2x2',
	pattern: twoOnTwoOff,
	effective_range: {
		start: '2026-08-03T00:00:00.000Z',
		end: null
	}
};

test('terms project through the named pattern row that rode the read', () => {
	const term = { shift_pattern_id: 'sp-1', term_shift_pattern: namedRow };
	assert.equal(termPatternRow(term)?.code, 'DAY-2x2');
	assert.equal(patternAnchor(termPatternRow(term)), '2026-08-03');
	assert.equal(
		patternRosterCodeId(termPattern(term), '2026-08-05', patternAnchor(termPatternRow(term))),
		OFF
	);
	assert.equal(
		patternRosterCodeId(termPattern(term), '2026-08-07', patternAnchor(termPatternRow(term))),
		DAY
	);
});

test('terms project through a company pattern map when the row did not ride the read', () => {
	const term = { shift_pattern_id: 'sp-1' };
	const patternById = new Map([['sp-1', namedRow]]);
	assert.equal(termPatternRow(term, patternById)?.code, 'DAY-2x2');
	assert.deepEqual(patternWorkload(termPattern(term, patternById), codes), {
		work_days: 2,
		paid_minutes: 960,
		reference_days: 4,
		average_weekly_paid_minutes: 1680
	});
});

test('terms naming no pattern are rostered as assigned: nothing projected, nothing guaranteed', () => {
	const term = { shift_pattern_id: null };
	assert.equal(termPatternRow(term), null);
	assert.equal(termPattern(term), null);
	assert.equal(patternRosterCodeId(termPattern(term), '2026-08-05', null), null);
	assert.equal(patternWorkload(termPattern(term), codes), null);
});

test('a pointer whose row was not loaded refuses rather than projecting nothing', () => {
	assert.throws(() => termPattern({ shift_pattern_id: 'sp-missing' }), /sp-missing/);
});

test('the roster codes a pattern names are listed once each; an expectation names none', () => {
	assert.deepEqual(patternRosterCodeIds(twoOnTwoOff), [DAY, OFF]);
	assert.deepEqual(
		patternRosterCodeIds({
			expectation: { kind: 'AS_ASSIGNED', days_per_week: 5, maximum_paid_minutes_per_week: null }
		}),
		[]
	);
});

test('a terms read carries the pattern row with its effective range, the cycle anchor', () => {
	// The board and the employee calendar once loaded the pattern without its range: no anchor,
	// so every day-cycle pattern projected nothing and the whole month read as unassigned.
	assert.equal(PATTERN_WITH.columns.effective_range, true);
	assert.equal(
		patternAnchor({ effective_range: { start: '2019-09-12T00:00:00.000Z', end: null } }),
		'2019-09-12'
	);
	assert.equal(patternAnchor({}), null);
});

test('the days a week live in the pattern: a cycle averages its weeks, a declaration states them', () => {
	const five = {
		id: 'p5',
		code: 'FIVE',
		pattern: { days: [DAY, DAY, DAY, DAY, DAY, OFF, REST].map(dayOf) }
	};
	const twoWeeks = {
		id: 'p56',
		code: 'FIVE-SIX',
		pattern: { days: [...five.pattern.days, ...[DAY, DAY, DAY, DAY, DAY, DAY, REST].map(dayOf)] }
	};
	assert.deepEqual(patternWorkDaysPerWeek(twoWeeks.pattern, codes), [5, 6]);
	assert.deepEqual(patternWorkDaysPerWeek(null, codes), []);
	assert.equal(patternDaysPerWeek(five.pattern, codes), 5);
	assert.equal(patternDaysPerWeek(twoWeeks.pattern, codes), 5.5, 'an alternate-Saturday fortnight');
	assert.equal(
		patternDaysPerWeek(
			{
				expectation: { kind: 'GUARANTEED_SCHEDULE', days_per_week: 6, paid_minutes_per_week: 2700 }
			},
			codes
		),
		6
	);
});
