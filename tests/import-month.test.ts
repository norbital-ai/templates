// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The `work_days` action `import_month` against the contract history: one payload, one legal entity, one month. A
 * person-day resolves to the approved contract covering that day in the named entity, a roster names every employed
 * day of the month, and a sealed day may only be restated as it is. Ported from workday-import-contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/data/collection/work_days/+collection.ts';
import { actionCtx, workDayTables } from './helpers/work-day-db.ts';

const JANUARY = Array.from(
	{ length: 31 },
	(_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`
);
const CODES = [
	{
		id: 'c-day',
		code: '7.5AM',
		variant: { kind: 'WORK', start_time: '08:00', end_time: '16:30', break_minutes: 60 },
		effective_range: { from: '2020-01-01', to: null }
	},
	{
		id: 'c-rest',
		code: 'REST',
		variant: { kind: 'REST' },
		effective_range: { from: '2020-01-01', to: null }
	}
];
const contract = (id, from, to = null, over = {}) => ({
	id,
	company_id: 'co-1',
	employee_id: 'person',
	employee_number: 'PERSON',
	approval_id: null,
	effective_range: { from, to },
	...over
});
/** The person left on the 15th and was rehired on the 16th; another entity employs them all month. */
const world = (over = {}) => {
	const tables = workDayTables({ codes: CODES, ...over });
	tables.companies.push({
		...tables.companies[0],
		id: 'co-2',
		name: 'Other Entity',
		registration_number: 'OTHER'
	});
	tables.employments = [
		contract('departed', '2026-01-01', '2026-01-15'),
		contract('rehire', '2026-01-16'),
		contract('elsewhere', '2026-01-01', null, { company_id: 'co-2' })
	];
	return tables;
};
const roster = (working = []) =>
	JANUARY.map((work_date) => ({
		employee_number: 'PERSON',
		work_date,
		shift_code: working.includes(work_date) ? '7.5AM' : 'REST'
	}));
const attendance = (dates) =>
	dates.map((work_date) => ({
		employee_number: 'PERSON',
		work_date,
		clock_in: '08:00',
		clock_out: '17:00'
	}));
const run = async (tables, sheets, legal_entity = 'Test Sdn Bhd') => {
	const ctx = actionCtx(tables);
	const output = await workDays.bodies.actions.import_month(
		{ legal_entity, month: '2026-01', timezone: 'Asia/Singapore', ...sheets },
		ctx
	);
	return { output, acts: ctx.acts };
};
const act = (acts, callable) => acts.find((entry) => entry.callable === callable)?.input;

test('departure day and next-day rehire resolve to their own contracts; a stored day is restated in place', async () => {
	const tables = world({
		days: [
			{
				id: 'stored-15',
				employment_id: 'departed',
				work_date: '2026-01-15',
				shift_definition_id: null,
				worked_intervals: null,
				approval_id: null
			}
		]
	});
	const { acts } = await run(tables, { attendance: attendance(['2026-01-15', '2026-01-16']) });
	// the new day is created whole; the stored one is restated in one update batch
	assert.deepEqual(
		act(acts, 'work_days.create').map((row) => [
			row.employment_id,
			row.work_date,
			row.worked_intervals[0].start
		]),
		[['rehire', '2026-01-16', '2026-01-16T00:00:00.000Z']]
	);
	assert.deepEqual(
		act(acts, 'work_days.update').map((row) => [row.target, row.set.worked_intervals[0].start]),
		[['stored-15', '2026-01-15T00:00:00.000Z']]
	);
});

test('a date no single approved contract covers is refused by name', async () => {
	const gap = world();
	gap.employments[1].effective_range = { from: '2026-01-17', to: null };
	await assert.rejects(
		run(gap, { attendance: attendance(['2026-01-16']) }),
		/No approved employment contract covers PERSON on 2026-01-16/
	);
	const overlap = world();
	overlap.employments.push(contract('overlap', '2026-01-16'));
	await assert.rejects(
		run(overlap, { attendance: attendance(['2026-01-16']) }),
		/More than one employment contract.*overlapping/
	);
	// an unapproved rehire is not a contract yet
	const pending = world();
	pending.employments.push(
		contract('pending-rehire', '2026-01-16', null, { approval_id: 'pending' })
	);
	await run(pending, { attendance: attendance(['2026-01-16']) });
	await assert.rejects(
		run(world(), { attendance: attendance(['2026-01-16']) }, 'Nobody Sdn Bhd'),
		/No legal entity named "Nobody Sdn Bhd" is on file[\s\S]*Test Sdn Bhd/
	);
});

test('a roster may leave days blank (warned, no plan written), never PH, and becomes the roster of record of each contract it names', async () => {
	const blank = await run(world(), {
		roster: roster().filter((row) => row.work_date < '2026-01-30')
	});
	assert.equal(act(blank.acts, 'work_days.create').length, 29, 'a blank day writes no row');
	assert.match(
		blank.output.warnings.join('\n'),
		/no roster code[\s\S]*PERSON: 2026-01-30, 2026-01-31/
	);
	// a day approved full-day leave owns is blank by design and not warned; a half day it leaves free is
	const onLeave = (half_day_end = false) =>
		world({
			leave: [
				{
					id: 'annual',
					employment_id: 'rehire',
					from_date: '2026-01-30',
					to_date: '2026-01-31',
					half_day_start: false,
					half_day_end
				}
			]
		});
	const blanks = { roster: roster().filter((row) => row.work_date < '2026-01-30') };
	assert.deepEqual((await run(onLeave(), blanks)).output.warnings, []);
	assert.match(
		(await run(onLeave(true), blanks)).output.warnings.join('\n'),
		/no roster code[\s\S]*PERSON: 2026-01-31$/m
	);
	await assert.rejects(
		run(world(), {
			roster: roster().map((row) =>
				row.work_date === '2026-01-01' ? { ...row, shift_code: 'PH' } : row
			)
		}),
		/PH is not a roster code[\s\S]*PERSON on 2026-01-01/
	);
	const { acts } = await run(world(), { roster: roster(['2026-01-05']) });
	assert.equal(act(acts, 'work_days.create').length, 31);
	assert.deepEqual(
		act(acts, 'rosters.create')
			.map((row) => row.employment_id)
			.toSorted(),
		['departed', 'rehire']
	);
});

test('a sealed day may only be restated as it is; changed or omitted, the whole file is refused', async () => {
	const sealed = (shift) =>
		world({
			days: [
				{
					id: 'sealed',
					employment_id: 'rehire',
					work_date: '2026-01-20',
					shift_definition_id: shift,
					worked_intervals: [
						{ start: '2026-01-20T00:00:00.000Z', end: '2026-01-20T09:00:00.000Z' }
					],
					approval_id: null,
					payslip_id: 'slip-1'
				}
			]
		});
	const same = await run(sealed('c-day'), { roster: roster(['2026-01-20']) });
	assert.equal(
		(act(same.acts, 'work_days.update') ?? []).some((row) => row.target === 'sealed'),
		false,
		'the sealed day is untouched'
	);
	await assert.rejects(
		run(sealed('c-day'), { roster: roster() }),
		/already taken into account by a payslip[\s\S]*PERSON on 2026-01-20 \(the file changes it\)/
	);
	// the clock compares by instant: the same punches in the file's zone are the same day
	const clock = await run(sealed(null), { attendance: attendance(['2026-01-20']) });
	assert.equal(act(clock.acts, 'work_days.update'), undefined);
	await assert.rejects(
		run(sealed(null), { attendance: attendance(['2026-01-21']) }),
		/PERSON on 2026-01-20 \(the file leaves it out\)/
	);
});

test('an Overtime total is split at the statutory limits into approved and incentive hours', async () => {
	const rules = {
		limits: [
			{
				key: 'daily_ot',
				period: 'DAY',
				measure: 'OVERTIME_HOURS',
				max_hours: 4,
				unit: 'WORKED_HOURS'
			}
		],
		bands: []
	};
	const tables = world({
		versions: [{ ...workDayTables().jurisdiction_settings[0], work_rules: rules }]
	});
	const { acts } = await run(tables, {
		roster: roster(['2026-01-20']),
		overtime: [{ employee_number: 'PERSON', work_date: '2026-01-20', overtime_hours: 6 }]
	});
	const day = [
		...(act(acts, 'work_days.create') ?? []),
		...(act(acts, 'work_days.update') ?? []).map((row) => row.set)
	].find((row) => row.approved_overtime_hours > 0);
	assert.deepEqual([day.approved_overtime_hours, day.incentive_hours], [4, 2]);
});

test('a scheduling import writes the consent and the declared import inputs with their person-day', async () => {
	const tables = world({
		versions: [
			{
				...workDayTables().jurisdiction_settings[0],
				code: 'TH',
				jurisdiction_code: 'TH',
				work_rules: { limits: [], bands: [] },
				work_day_facts: [
					{ key: 'normal_hours_redistribution_agreed_at', type: 'instant', import: true }
				]
			}
		]
	});
	tables.companies[0].settings_code = 'TH';
	const { acts } = await run(tables, {
		overtime: [
			{
				employee_number: 'PERSON',
				work_date: '2026-01-20',
				overtime_hours: 1,
				overtime_consented_at: '2026-01-19T01:00:00.000Z',
				facts: { normal_hours_redistribution_agreed_at: '2026-01-18T01:00:00.000Z' }
			}
		]
	});
	const day = (act(acts, 'work_days.create') ?? [])[0];
	assert.equal(day.approved_overtime_hours, 1);
	assert.equal(day.overtime_consented_at, '2026-01-19T01:00:00.000Z');
	assert.deepEqual(day.facts, {
		normal_hours_redistribution_agreed_at: '2026-01-18T01:00:00.000Z'
	});
	await assert.rejects(
		run(tables, {
			overtime: [
				{
					employee_number: 'PERSON',
					work_date: '2026-01-20',
					overtime_hours: 1,
					facts: { split_break_agreed_at: '2026-01-18T01:00:00.000Z' }
				}
			]
		}),
		/columns these rules do not import/
	);
});

test('statutory limits are warnings: nine days running, a long shift, a short break and overtime past the cap all import', async () => {
	const rules = {
		limits: [
			{
				key: 'daily_total',
				period: 'DAY',
				measure: 'TOTAL_WORK_HOURS',
				max_hours: 12,
				unit: 'WORKED_HOURS'
			},
			{
				key: 'daily_ot',
				period: 'DAY',
				measure: 'OVERTIME_HOURS',
				max_hours: 4,
				unit: 'WORKED_HOURS'
			},
			{ key: 'weekly_rest', measure: 'CONSECUTIVE_WORK_DAYS', max_days: 6, discharged_by: 'REST' }
		],
		bands: [],
		breaks: [{ when: 'consecutive_hours > 5.0', owed_minutes: '30.0', counts_as_worked_time: null }]
	};
	const tables = world({
		codes: [
			...CODES,
			{
				id: 'c-13',
				code: 'D13',
				variant: { kind: 'WORK', start_time: '07:00', end_time: '21:00', break_minutes: 60 },
				effective_range: { from: '2020-01-01', to: null }
			},
			{
				id: 'c-short',
				code: 'SB',
				variant: { kind: 'WORK', start_time: '09:00', end_time: '15:15', break_minutes: 15 },
				effective_range: { from: '2020-01-01', to: null }
			}
		],
		versions: [{ ...workDayTables().jurisdiction_settings[0], work_rules: rules }]
	});
	// a shift change: 19th–27th worked straight through
	const nine = JANUARY.filter((date) => date >= '2026-01-19' && date <= '2026-01-27');
	const { output, acts } = await run(tables, {
		roster: roster(nine).map((row) =>
			row.work_date === '2026-01-20'
				? { ...row, shift_code: 'D13' }
				: row.work_date === '2026-01-21'
					? { ...row, shift_code: 'SB' }
					: row
		),
		overtime: [{ employee_number: 'PERSON', work_date: '2026-01-22', overtime_hours: 6 }]
	});
	assert.equal(act(acts, 'work_days.create').length, 31, 'nothing is refused');
	const said = output.warnings.join('\n');
	assert.match(
		said,
		/PERSON: 2026-01-19 to 2026-01-27 is 9 consecutive worked days with no rest day; the rules allow 6/
	);
	assert.match(
		said,
		/PERSON: the plan through 2026-01-20 projects 13\.00 worked hours in the day, above the 12-hour limit "daily_total"/
	);
	assert.match(said, /Shift SB grants 15 minutes of break, but the rules require 30/);
	assert.match(
		said,
		/PERSON: overtime above the statutory limits on 2026-01-22 \(2 h\) is recorded as incentive hours/
	);
	const ot = act(acts, 'work_days.create').find((row) => row.work_date === '2026-01-22');
	assert.deepEqual([ot.approved_overtime_hours, ot.incentive_hours], [4, 2]);
	// rules that keep no incentive hours record the whole total as approved overtime, still warned
	tables.jurisdiction_settings[0].work_rules = { ...rules, incentive_hours_allowed: false };
	const strict = await run(tables, {
		overtime: [{ employee_number: 'PERSON', work_date: '2026-01-22', overtime_hours: 6 }]
	});
	const kept = act(strict.acts, 'work_days.create')[0];
	assert.deepEqual([kept.approved_overtime_hours, kept.incentive_hours], [6, 0]);
	assert.match(strict.output.warnings.join('\n'), /is recorded as approved overtime/);
});

test('a Time entries day holds several intervals, the later ones running past midnight', async () => {
	const { acts } = await run(world(), {
		attendance: [
			{ employee_number: 'PERSON', work_date: '2026-01-20', clock_in: '08:00', clock_out: '12:00' },
			{ employee_number: 'PERSON', work_date: '2026-01-20', clock_in: '12:00', clock_out: '17:00' },
			{ employee_number: 'PERSON', work_date: '2026-01-21', clock_in: '22:00', clock_out: '02:00' },
			{ employee_number: 'PERSON', work_date: '2026-01-21', clock_in: '03:00', clock_out: '06:00' }
		]
	});
	const created = act(acts, 'work_days.create');
	assert.deepEqual(
		created.map((row) => [row.work_date, row.worked_intervals]),
		[
			[
				'2026-01-20',
				[
					{ start: '2026-01-20T00:00:00.000Z', end: '2026-01-20T04:00:00.000Z' },
					{ start: '2026-01-20T04:00:00.000Z', end: '2026-01-20T09:00:00.000Z' }
				]
			],
			[
				'2026-01-21',
				[
					{ start: '2026-01-21T14:00:00.000Z', end: '2026-01-21T18:00:00.000Z' },
					{ start: '2026-01-21T19:00:00.000Z', end: '2026-01-21T22:00:00.000Z' }
				]
			]
		]
	);
});
