// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The `work_days` transform, one light case per guarantee: the attendance it accepts, the locks it holds (payroll,
 * leave, recorded attendance), month conformance to the pattern, and the statutory schedule gates (rest run, hour and
 * spread ceilings, breaks, overtime headroom, adjacent-day overlap). Ported from attendance-interval-refusals,
 * attendance-freezes-roster, lock and workday-import-limits.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import workDays from '../src/data/collection/work_days/+collection.ts';
import rosters from '../src/data/collection/rosters/+collection.ts';
import patterns from '../src/data/collection/shift_patterns/+collection.ts';
import {
	applicableLimits,
	rosterCodeFacts,
	splitPlannedOvertime
} from '../src/lib/scheduling/work-limits.ts';
import { validateOvertimeLimits } from '../src/lib/payroll/run/validate.ts';
import { derivedBreakMinutes } from '../src/lib/scheduling/rest-break.ts';
import { runTransform } from './helpers/ctx.ts';
import { VERSION, workDayTables, writeDay, writeDays } from './helpers/work-day-db.ts';

const WORK = 'shift-work';
const REST = 'shift-rest';
const basic = workDayTables({
	codes: [
		{
			id: WORK,
			code: 'D',
			variant: { kind: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 60 }
		},
		{ id: REST, code: 'R', variant: { kind: 'REST' } }
	]
});
const at = (time, date = '2026-07-01') => `${date}T${time}:00.000Z`;
const PUNCHED = [{ start: at('01:00', '2026-03-10'), end: at('09:00', '2026-03-10') }];
const stored = (over = {}) => ({
	id: 'day-1',
	employment_id: 'emp-1',
	work_date: '2026-03-10',
	shift_definition_id: WORK,
	worked_intervals: null,
	approval_id: null,
	payslip_id: null,
	...over
});
const clock = (worked_intervals, tables = basic) =>
	writeDay(
		workDays,
		{ employment_id: 'emp-1', work_date: '2026-07-01', worked_intervals },
		undefined,
		tables
	);

test('attendance: ordered, non-overlapping intervals, only the last open; [] is a reviewed empty day', async () => {
	await assert.rejects(
		clock([
			{ start: at('01:00'), end: at('09:00') },
			{ start: at('08:00'), end: at('12:00') }
		]),
		/in time order and cannot overlap/
	);
	await assert.rejects(
		clock([
			{ start: at('01:00'), end: null },
			{ start: at('09:00'), end: at('12:00') }
		]),
		/final worked interval/
	);
	await assert.rejects(
		clock([{ start: at('09:00'), end: at('09:00') }]),
		/must end after it starts/
	);
	// touching is not overlapping; a reviewed empty day and no attendance both land
	await clock([
		{ start: at('01:00'), end: at('09:00') },
		{ start: at('09:00'), end: null }
	]);
	assert.deepEqual((await clock([])).worked_intervals, []);
	await clock(null);
});

test('planned hours are half-hour steps, within the 24 a day has', async () => {
	const plan = (approved_overtime_hours, incentive_hours = 0) =>
		writeDay(
			workDays,
			{ employment_id: 'emp-1', work_date: '2026-07-01', approved_overtime_hours, incentive_hours },
			undefined,
			basic
		);
	await assert.rejects(plan(1.25), /half-hour steps/);
	await assert.rejects(plan(20, 5), /24 hours a day has/);
	await assert.rejects(plan(-1), /zero or a positive/);
});

/**
 * A lineage's person-day protections as its seed states them: the TH version in force on the day
 * written, its protection keys only (no bands or limits, so no headroom is asked).
 */
const TH_SEED = JSON.parse(
	readFileSync(
		new URL('../seed/jurisdiction/TH/jurisdiction_settings.json', import.meta.url),
		'utf8'
	)
);
const thaiTables = () => {
	const version = TH_SEED.find(
		(row) => row.effective_range.start <= '2026-07-01' && row.effective_range.end > '2026-07-01'
	);
	const { incentive_hours_allowed, overtime_consent, day_rules } = version.work_rules;
	const tables = workDayTables({
		versions: [
			{
				...VERSION,
				code: 'TH',
				jurisdiction_code: 'TH',
				work_rules: {
					limits: [],
					bands: [],
					breaks: [],
					incentive_hours_allowed,
					overtime_consent,
					day_rules
				},
				work_day_facts: version.work_day_facts
			}
		]
	});
	tables.companies[0].settings_code = 'TH';
	return tables;
};

test('Thailand work-day writes require a consent fact and cannot turn excess into incentive', async () => {
	const thai = thaiTables();
	const write = (extra) =>
		writeDay(
			workDays,
			{ employment_id: 'emp-1', work_date: '2026-07-01', ...extra },
			undefined,
			thai
		);
	await assert.rejects(write({ approved_overtime_hours: 1 }), /worker’s consent/);
	await assert.rejects(
		write({ approved_overtime_hours: 1, overtime_consented_at: at('00:00'), incentive_hours: 0.5 }),
		/above the legal limit cannot be saved as incentive/
	);
	await write({ approved_overtime_hours: 1, overtime_consented_at: at('00:00') });
});

test('Thailand work-day writes retain a referenced s.24–25 consent exception', async () => {
	const thai = thaiTables();
	const write = (facts, extra = {}) =>
		writeDay(
			workDays,
			{
				employment_id: 'emp-1',
				work_date: '2026-07-01',
				approved_overtime_hours: 1,
				facts,
				...extra
			},
			undefined,
			thai
		);
	await assert.rejects(
		write({ consent_exception: 'CONTINUOUS_DAMAGE_IF_STOPPED' }),
		/evidence for the Thai consent exception/
	);
	await assert.rejects(write({}, { emergency_cause: true }), /worker’s consent/);
	const saved = await write({
		consent_exception: 'CONTINUOUS_DAMAGE_IF_STOPPED',
		consent_exception_reference: 'incident-log-42'
	});
	assert.equal(saved.facts.consent_exception, 'CONTINUOUS_DAMAGE_IF_STOPPED');
	assert.equal(saved.facts.consent_exception_reference, 'incident-log-42');
	const emergency = await write({
		consent_exception: 'EMERGENCY',
		consent_exception_reference: 'emergency-report-7'
	});
	assert.equal(emergency.facts.consent_exception, 'EMERGENCY');
});

test('Thailand work-day writes retain the split-rest agreement and the minor-night permission as declared inputs', async () => {
	const thai = thaiTables();
	const write = (facts) =>
		writeDay(workDays, { employment_id: 'emp-1', work_date: '2026-07-01', facts }, undefined, thai);
	await assert.rejects(write({ split_break_agreed_at: 'yesterday' }), /UTC instant/);
	await assert.rejects(write({ consent_exception: 'HOLIDAY_CASINO' }), /one of/);
	const saved = await write({
		split_break_agreed_at: at('00:00'),
		minor_night_permission_granted_at: at('00:00')
	});
	assert.equal(saved.facts.split_break_agreed_at, at('00:00'));
	assert.equal(saved.facts.minor_night_permission_granted_at, at('00:00'));
});

test('a punched day freezes its plan unless the write restates the attendance', async () => {
	const write = (input, existing) => writeDay(workDays, input, existing, basic);
	await assert.rejects(
		write({ shift_definition_id: REST }, stored({ worked_intervals: PUNCHED })),
		/roster for 2026-03-10 is locked/
	);
	await assert.rejects(
		write({ shift_definition_id: REST }, stored({ worked_intervals: [] })),
		/is locked/
	);
	await write({ shift_definition_id: REST }, stored());
	assert.equal(
		(
			await write(
				{ shift_definition_id: REST, worked_intervals: PUNCHED },
				stored({ worked_intervals: PUNCHED })
			)
		).shift_definition_id,
		REST
	);
	// recording or correcting attendance is never a plan change
	await write({ worked_intervals: PUNCHED }, stored());
});

test('a day approved leave owns takes no attendance; a day moves to no other employment', async () => {
	const tables = workDayTables({
		leave: [
			{ employment_id: 'emp-1', leave_code: 'AL', from_date: '2026-07-01', to_date: '2026-07-02' }
		]
	});
	await assert.rejects(
		clock([{ start: at('01:00'), end: at('09:00') }], tables),
		/covered by approved leave 2026-07-01 → 2026-07-02/
	);
	await assert.rejects(
		writeDay(workDays, { employment_id: 'emp-2' }, stored(), basic),
		/cannot move to another employment/
	);
});

test('payroll locks: a paid window refuses new days, a captured day refuses any change', async () => {
	const tables = workDayTables({
		runs: [
			{
				id: 'run-07',
				period: '2026-07',
				attendance_from: '2026-06-21',
				attendance_to: '2026-07-20'
			}
		],
		payslips: [
			{ payroll_run_id: 'run-07', employment_id: 'emp-1', paid_at: '2026-07-31T00:00:00.000Z' }
		]
	});
	await assert.rejects(clock([], tables), /inside paid payroll 2026-07/);
	// the unpaid colleague's day is open; an unconsumed stored day stays editable (arrears)
	await writeDay(
		workDays,
		{ employment_id: 'emp-2', work_date: '2026-07-01', worked_intervals: [] },
		undefined,
		tables
	);
	await writeDay(workDays, { worked_intervals: [] }, stored({ work_date: '2026-07-01' }), tables);
	await assert.rejects(
		writeDay(workDays, { worked_intervals: [] }, stored({ payslip_id: 'slip-1' }), tables),
		/already taken this record into account/
	);
	// moving an open day into the paid window is a create onto that day
	await assert.rejects(
		writeDay(workDays, { work_date: '2026-07-02' }, stored({ work_date: '2026-08-02' }), tables),
		/inside paid payroll 2026-07/
	);
});

test('no governing jurisdiction refuses the write up front', async () => {
	await assert.rejects(clock([], workDayTables({ versions: [] })), /No governing jurisdiction/);
});

// ── the schedule gates, on a Nihon-shaped rule set ──
const limit = (key, period, measure, max_hours) => ({
	key,
	period,
	measure,
	max_hours,
	unit: 'WORKED_HOURS'
});
const weeklyRest = {
	key: 'weekly_rest',
	measure: 'CONSECUTIVE_WORK_DAYS',
	max_days: 6,
	discharged_by: 'REST'
};
const NIHON = {
	limits: [
		limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12),
		limit('normal_day', 'DAY', 'NORMAL_HOURS', 8),
		limit('spread_day', 'DAY', 'SPREAD_HOURS', 10),
		limit('weekly_normal', 'WEEK', 'NORMAL_HOURS', 45),
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104),
		weeklyRest
	],
	bands: [],
	breaks: [{ when: 'consecutive_hours > 5.0', owed_minutes: '30.0', counts_as_worked_time: null }]
};
const CODES = [
	{
		id: 'c-8',
		code: '8.0AM',
		variant: { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 }
	},
	{
		id: 'c-9',
		code: 'AM0830',
		variant: { kind: 'WORK', start_time: '08:30', end_time: '18:30', break_minutes: 60 }
	},
	{
		id: 'c-long',
		code: 'LONG',
		variant: { kind: 'WORK', start_time: '07:00', end_time: '18:00', break_minutes: 60 }
	},
	{
		id: 'c-short-break',
		code: 'SB',
		variant: { kind: 'WORK', start_time: '09:00', end_time: '15:15', break_minutes: 15 }
	},
	{
		id: 'c-13',
		code: 'D13',
		variant: { kind: 'WORK', start_time: '07:00', end_time: '21:00', break_minutes: 60 }
	},
	{
		id: 'c-night',
		code: 'PM2230',
		variant: { kind: 'WORK', start_time: '22:30', end_time: '08:30', break_minutes: 60 }
	},
	{
		id: 'c-early',
		code: '03',
		variant: { kind: 'WORK', start_time: '07:30', end_time: '16:30', break_minutes: 60 }
	},
	{ id: 'c-rest', code: 'REST', variant: { kind: 'REST' } }
];
const rostered = (rules, days = []) =>
	workDayTables({
		codes: CODES,
		days,
		rosters: [{ employment_id: 'emp-1', period: '2026-07' }],
		versions: [{ ...VERSION, work_rules: rules }]
	});
const july = (plan) =>
	Array.from({ length: 31 }, (_, index) => {
		const [code, overtime = 0] = plan(index + 1);
		return {
			employment_id: 'emp-1',
			work_date: `2026-07-${String(index + 1).padStart(2, '0')}`,
			shift_definition_id: code,
			approved_overtime_hours: overtime
		};
	});
const sixOnOneOff = (work) => (n) => (n % 7 === 0 ? ['c-rest'] : work);
const month = (plan, rules = NIHON) => writeDays(workDays, july(plan), rostered(rules));

test('the weekly rest rule refuses a seventh consecutive worked day', async () => {
	await assert.rejects(
		month((n) => (n <= 7 || n % 7 !== 0 ? ['c-8'] : ['c-rest'])),
		/2026-07-01 to 2026-07-13 would be 13 consecutive worked day\(s\).*allows 6/s
	);
	await month(sixOnOneOff(['c-8']));
});

test('a shift’s own hours, spread-over and granted break are schedule gates', async () => {
	await assert.rejects(
		month((n) => (n === 2 ? ['c-13'] : sixOnOneOff(['c-8'])(n))),
		/13\.00 worked hours in the day, above the 12-hour limit "daily_total"/
	);
	await assert.rejects(
		month((n) => (n === 3 ? ['c-long'] : sixOnOneOff(['c-8'])(n))),
		/11\.00 spread-over hours in the day, above the 10-hour limit "spread_day"/
	);
	await assert.rejects(
		month((n) => (n === 6 ? ['c-short-break'] : sixOnOneOff(['c-8'])(n))),
		/grants 15 minutes of break, but the rules require 30/
	);
});

test('approved overtime above the headroom is refused by name; the split keys the rest as incentive', async () => {
	const inputs = july((n) => (n === 2 ? ['c-9', 4] : sixOnOneOff(['c-8'])(n)));
	await assert.rejects(
		writeDays(workDays, inputs, rostered(NIHON)),
		/2026-07-02 would hold 4 h .* above the 3 h left/
	);
	const facts = new Map(CODES.map((code) => [code.id, rosterCodeFacts(code.variant)]));
	const split = splitPlannedOvertime({
		limits: applicableLimits(NIHON.limits, null),
		days: inputs.map((input) => ({
			date: input.work_date,
			...facts.get(input.shift_definition_id),
			total_overtime_hours: input.approved_overtime_hours
		}))
	});
	const keyed = inputs.map((input) => ({ ...input, ...split.get(input.work_date) }));
	const out = await writeDays(workDays, keyed, rostered(NIHON));
	assert.deepEqual(
		out
			.filter((row) => row.incentive_hours > 0)
			.map((row) => [row.work_date, row.approved_overtime_hours, row.incentive_hours]),
		[['2026-07-02', 3, 1]]
	);
	// and payroll states a month past the limit on its own
	const issues = validateOvertimeLimits({
		employeeNumber: 'E-1',
		configuration: {
			limits: NIHON.limits,
			work: { authority: 'EA s.60A' },
			jurisdiction: { id: 'v' }
		},
		hoursByMonth: new Map([['2026-07', 108]])
	});
	assert.match(issues[0].message, /108 regulated overtime hours in 2026-07, against a 104-hour/);
});

test('two new adjacent days whose windows overlap are refused in one batch', async () => {
	await assert.rejects(
		month((n) => (n === 9 ? ['c-night'] : n === 10 ? ['c-early'] : sixOnOneOff(['c-8'])(n))),
		/overlap/i
	);
});

// ── month conformance: without a roster of record the month must add up to the pattern ──
const weekly = {
	days: ['c-8', 'c-8', 'c-8', 'c-8', 'c-8', 'c-rest', 'c-rest'].map((roster_code_id) => ({
		roster_code_id
	}))
};
const patterned = (over = {}) =>
	workDayTables({
		codes: CODES,
		patterns: [
			{ id: 'pat-1', code: 'W', pattern: weekly, effective_range: { from: '2026-06-29', to: null } }
		],
		terms: [
			{
				employment_id: 'emp-1',
				shift_pattern_id: 'pat-1',
				effective_range: { from: '2020-01-01', to: null }
			}
		],
		...over
	});

test('an unrostered month refuses a single REST-into-WORK cell, and a whole-month plan is a roster', async () => {
	// Saturday 4 July is a pattern rest day: working it alone adds a WORK day the pattern does not have.
	await assert.rejects(
		writeDay(
			workDays,
			{ employment_id: 'emp-1', work_date: '2026-07-04', shift_definition_id: 'c-8' },
			undefined,
			patterned()
		),
		/Roster change for emp-1 in 2026-07 is refused/
	);
	// the same cell under a roster of record lands
	await writeDay(
		workDays,
		{ employment_id: 'emp-1', work_date: '2026-07-04', shift_definition_id: 'c-8' },
		undefined,
		patterned({ rosters: [{ employment_id: 'emp-1', period: '2026-07' }] })
	);
	// a batch stating every employed day of the month is that month's roster (the import writes the roster beside it)
	await writeDays(
		workDays,
		july((n) => (n === 4 ? ['c-8'] : n === 5 ? ['c-rest'] : sixOnOneOff(['c-8'])(n))).map(
			({ approved_overtime_hours: _, ...day }) => day
		),
		patterned()
	);
});

test('a roster is YYYY-MM; a shift pattern cycle is whole weeks', async () => {
	assert.deepEqual(await runTransform(rosters, [{ employment_id: 'e', period: '2026-01' }]), [
		{ employment_id: 'e', period: '2026-01' }
	]);
	await assert.rejects(
		runTransform(rosters, [{ employment_id: 'e', period: '2026-03-2' }]),
		/YYYY-MM/
	);
	await assert.rejects(
		runTransform(patterns, [
			{ pattern: { days: Array.from({ length: 10 }, () => ({ roster_code_id: 'c-8' })) } }
		]),
		/whole weeks; this one has 10 days/
	);
});

test('a pattern whose cycle breaches a daily ceiling never becomes a base', async () => {
	const tables = workDayTables({ codes: CODES, versions: [{ ...VERSION, work_rules: NIHON }] });
	const long = {
		days: ['c-13', 'c-8', 'c-8', 'c-8', 'c-8', 'c-rest', 'c-rest'].map((roster_code_id) => ({
			roster_code_id
		}))
	};
	await assert.rejects(
		runTransform(
			patterns,
			[
				{
					company_id: 'co-1',
					code: 'L',
					pattern: long,
					effective_range: { from: '2026-07-06', to: null }
				}
			],
			{ tables }
		),
		/pattern L.*above the 12-hour limit "daily_total"/s
	);
	await runTransform(
		patterns,
		[
			{
				company_id: 'co-1',
				code: 'W',
				pattern: weekly,
				effective_range: { from: '2026-07-06', to: null }
			}
		],
		{ tables }
	);
});

test('a seven-WORK shift pattern is refused by the weekly rest rule', async () => {
	const tables = workDayTables({ codes: CODES, versions: [{ ...VERSION, work_rules: NIHON }] });
	await assert.rejects(
		runTransform(
			patterns,
			[
				{
					company_id: 'co-1',
					code: 'ALL-WORK',
					pattern: { days: Array.from({ length: 7 }, () => ({ roster_code_id: 'c-8' })) },
					effective_range: { from: '2026-07-06', to: null }
				}
			],
			{ tables }
		),
		/pattern ALL-WORK.*consecutive worked day\(s\) with no rest day/s
	);
});

test('a time entry is a span: the provided break comes off it, and a recorded gap is not taken twice', () => {
	const one = [{ start: at('01:00'), end: at('09:00') }];
	const split = [
		{ start: at('01:00'), end: at('04:00') },
		{ start: at('05:00'), end: at('09:00') }
	];
	// The provided break comes off the span; a gap already shown accounts for it and is not taken again,
	// and a break longer than the recorded gap is still the break the shift provides.
	assert.equal(derivedBreakMinutes(one, 60), 60);
	assert.equal(derivedBreakMinutes(split, 60), 0);
	assert.equal(derivedBreakMinutes(split, 90), 30);
	assert.equal(derivedBreakMinutes(null, 60), 0);
	assert.equal(
		derivedBreakMinutes([{ start: at('01:00'), end: null }], 60),
		0,
		'an open interval is not a gap'
	);
});

test('a work day carries no holiday: the transform stamps nothing and reads no calendar for a clock write', async () => {
	// `jurisdiction_holidays` is empty: the holiday on a date is the calendar's to say when the day is read.
	const tables = workDayTables({ holidays: undefined });
	delete tables.jurisdiction_holidays;
	assert.deepEqual(
		await writeDay(
			workDays,
			{ work_date: '2026-02-05' },
			stored({ work_date: '2026-01-05', shift_definition_id: null }),
			tables
		),
		{ work_date: '2026-02-05' }
	);
	assert.deepEqual(
		await writeDay(
			workDays,
			{ worked_intervals: [] },
			stored({ shift_definition_id: null }),
			tables
		),
		{ worked_intervals: [] }
	);
});
