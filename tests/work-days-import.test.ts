// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A re-import of a month over stored days: each stored row is written at most once in the act (rule 21), a day the file
 * restates unchanged is not written, and every stored day the file changes or removes is reported by name. The long-form
 * Time entries reader names a bad clock once.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/data/collection/work_days/+collection.ts';
import { schedulingImportPayload } from '../src/data/collection/work_days/lib/import-workbook.ts';
import { WorkbookImportError } from '../src/lib/workbook-rows.ts';
import { actionCtx, workDayTables } from './helpers/work-day-db.ts';

const CODES = [
	{
		id: 'c-day',
		code: '7.5AM',
		variant: { kind: 'WORK', start_time: '08:00', end_time: '16:30', break_minutes: 60 },
		effective_range: { from: '2020-01-01', to: null }
	}
];
/** 08:00–17:00 in Asia/Singapore (UTC+8) is 00:00Z–09:00Z. */
const clock = (date, endHour = '09') => [
	{ start: `${date}T00:00:00.000Z`, end: `${date}T${endHour}:00:00.000Z` }
];
const stored = (id, work_date, over = {}) => ({
	id,
	employment_id: 'person',
	work_date,
	shift_definition_id: null,
	worked_intervals: clock(work_date),
	approval_id: null,
	payslip_id: null,
	...over
});
const DAYS = [
	// restated by the file exactly: no write
	stored('kept', '2026-01-20'),
	// edited in the app to 18:00 (10:00Z); the file still says 17:00: restated and reported
	stored('edited', '2026-01-21', { worked_intervals: clock('2026-01-21', '10') }),
	// the file leaves it out and it carries nothing else: removed only (it used to be updated and deleted)
	stored('dropped', '2026-01-22'),
	// the file leaves it out but it keeps its plan: its clock is cleared in place
	stored('planned', '2026-01-23', { shift_definition_id: 'c-day' })
];
const tables = () => {
	const world = workDayTables({ codes: CODES, days: DAYS });
	world.employments = [
		{
			id: 'person',
			company_id: 'co-1',
			employee_id: 'p',
			employee_number: 'PERSON',
			approval_id: null,
			effective_range: { from: '2026-01-01', to: null }
		}
	];
	return world;
};
const attendance = (dates) =>
	dates.map((work_date) => ({
		employee_number: 'PERSON',
		work_date,
		clock_in: '08:00',
		clock_out: '17:00'
	}));
const run = async (world, dates) => {
	const ctx = actionCtx(world);
	const output = await workDays.bodies.actions.import_month(
		{
			legal_entity: 'Test Sdn Bhd',
			month: '2026-01',
			timezone: 'Asia/Singapore',
			attendance: attendance(dates)
		},
		ctx
	);
	return { output, acts: ctx.acts };
};
const act = (acts, callable) => acts.find((entry) => entry.callable === callable)?.input;

test('a re-import writes each stored day once, skips the unchanged, and names what it overwrote', async () => {
	const { output, acts } = await run(tables(), ['2026-01-20', '2026-01-21', '2026-01-24']);
	assert.deepEqual(
		act(acts, 'work_days.create').map((row) => row.work_date),
		['2026-01-24']
	);
	assert.deepEqual(
		act(acts, 'work_days.update').map((row) => [row.target, row.set.worked_intervals]),
		[
			['edited', clock('2026-01-21')],
			['planned', null]
		]
	);
	assert.deepEqual(act(acts, 'work_days.delete'), { target: ['dropped'] });
	const written = [
		...act(acts, 'work_days.update').map((row) => row.target),
		...act(acts, 'work_days.delete').target
	];
	assert.equal(new Set(written).size, written.length, 'no row is written twice in one act');
	assert.deepEqual(output, {
		days: 3,
		created: 1,
		updated: 2,
		removed: 1,
		overwritten: ['PERSON on 2026-01-21', 'PERSON on 2026-01-22', 'PERSON on 2026-01-23']
	});
});

test('re-importing the month as stored writes nothing and overwrites nothing', async () => {
	const world = tables();
	world.work_days = [stored('kept', '2026-01-20'), stored('also', '2026-01-21')];
	const { output, acts } = await run(world, ['2026-01-20', '2026-01-21']);
	assert.deepEqual(acts, []);
	assert.deepEqual(output, { days: 2, created: 0, updated: 0, removed: 0, overwritten: [] });
});

test('a bad or missing clock_in on a long-form Time entries row is named once', () => {
	const problems = (clockIn) => {
		const grids = new Map([
			[
				'Settings',
				[
					['Setting', 'Value'],
					['legal_entity', 'Test Sdn Bhd'],
					['month', '2026-01'],
					['timezone', 'Asia/Singapore']
				]
			],
			[
				'Time entries',
				[
					['employee_number', 'work_date', 'clock_in', 'clock_out'],
					['PERSON', '2026-01-05', clockIn, '17:00']
				]
			]
		]);
		try {
			schedulingImportPayload(grids);
		} catch (error) {
			assert.ok(error instanceof WorkbookImportError);
			return error.problems;
		}
		assert.fail('the row was accepted');
	};
	assert.deepEqual(
		problems('25:00').map((line) => line.replace(/^.*?: /, '')),
		['clock_in is "25:00", expected a local time as HH:mm.']
	);
	assert.deepEqual(
		problems('').map((line) => line.replace(/^.*?: /, '')),
		['clock_in is empty, expected a local time as HH:mm.']
	);
});
