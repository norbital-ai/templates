import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { Instant } from '@norbital-ai/std/date';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { WorkbookRowsError } from '../src/lib/payroll_engine/workbook_rows.ts';
import {
	planRosterUpload,
	rosterMonth,
	rosterSheets,
	type RosterKnown
} from '../src/lib/payroll_engine/roster_workbook.ts';
import { parseAdhocSheet, parseLeaveSheet } from '../src/lib/payroll_engine/entry_workbook.ts';

const entity = idOf('entity', '11111111-1111-4111-8111-111111111111');
const employee = idOf('employee_contract', '22222222-2222-4222-8222-222222222222');
const shift = idOf('shift_definition', '33333333-3333-4333-8333-333333333333');
const entry = idOf('roster_entry', '55555555-5555-4555-8555-555555555555');
const run = idOf('payroll_run', '66666666-6666-4666-8666-666666666666');
const settings = idOf('jurisdiction_settings', '77777777-7777-4777-8777-777777777777');
const leaveCatalog = idOf('leave_catalog', '88888888-8888-4888-8888-888888888888');

type Cell = string | number | boolean | null;
const grid = (rows: readonly (readonly Cell[])[]) => new Map([['Sheet1', rows]]);

const rosterKnown = (entries: RosterKnown['entries'] = []): RosterKnown => ({
	entity_name: 'Acme',
	zone: 'Asia/Singapore',
	employees: [
		{
			id: employee,
			number: '1001',
			entity_id: entity,
			from: '2026-01-01',
			to: null
		}
	],
	shifts: [{ id: shift, entity_id: entity, code: 'DAY', from: '2026-01-01', to: null }],
	entries
});

const span = (start: string, end: string) => ({ start: Instant(start), end: Instant(end) });

const stored = (
	over: Partial<RosterKnown['entries'][number]> & { readonly work_date: string }
): RosterKnown['entries'][number] => ({
	id: entry,
	employment_id: employee,
	shift_definition_id: shift,
	planned_overtime_intervals: null,
	actual_worked_intervals: null,
	consent: null,
	payroll_run_id: null,
	run_label: null,
	...over
});

const rosterSheet = (...rows: readonly (readonly Cell[])[]) =>
	grid([['employee_number', 'work_date', 'shift_code', 'clock_in', 'clock_out'], ...rows]);

const throwsRows = (build: () => unknown, pattern: RegExp) =>
	assert.throws(build, (error: unknown) => {
		assert.ok(error instanceof WorkbookRowsError);
		assert.match(error.message, pattern);
		return true;
	});

describe('roster workbook', () => {
	it('rejects a repeated person-day', () => {
		throwsRows(
			() =>
				planRosterUpload(
					rosterSheet(
						['1001', '2026-03-02', 'DAY', '08:00', '17:00'],
						['1001', '2026-03-02', 'DAY', '08:00', '17:00']
					),
					rosterKnown()
				),
			/repeats 1001 2026-03-02 from row 2/
		);
	});

	it('fails an unrecognised shift code', () => {
		throwsRows(
			() =>
				planRosterUpload(
					rosterSheet(['1001', '2026-03-02', 'NIGHT', '08:00', '17:00']),
					rosterKnown()
				),
			/"NIGHT" is not a shift code/
		);
	});

	it('leaves a day the file does not name as it is', () => {
		const plan = planRosterUpload(
			rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', '17:00']),
			rosterKnown([stored({ work_date: '2026-03-03' })])
		);
		assert.equal(plan.creates.length, 1);
		assert.equal(plan.updates.length, 0);
	});

	it('carries the day\u2019s consent columns onto the roster entry', () => {
		const plan = planRosterUpload(
			grid([
				[
					'employee_number',
					'work_date',
					'shift_code',
					'planned_ot_start',
					'planned_ot_end',
					'consent_night_work',
					'consent_overtime',
					'consent_reference'
				],
				['1001', '2026-03-02', 'DAY', '22:00', '23:00', 'yes', 'true', 'form-1']
			]),
			rosterKnown()
		);
		assert.deepEqual(plan.creates[0]?.consent, {
			night_work: true,
			overtime: true,
			reference: 'form-1'
		});
	});
	it('refuses a consent flag without its signed reference', () => {
		throwsRows(
			() =>
				planRosterUpload(
					grid([
						[
							'employee_number',
							'work_date',
							'shift_code',
							'consent_night_work',
							'consent_overtime',
							'consent_reference'
						],
						['1001', '2026-03-02', 'DAY', 'yes', '', '']
					]),
					rosterKnown()
				),
			/signed consent reference/
		);
	});

	it('rejects an overnight interval that overlaps the next day', () => {
		throwsRows(
			() =>
				planRosterUpload(
					rosterSheet(
						['1001', '2026-03-02', 'DAY', '22:00', '06:00'],
						['1001', '2026-03-03', 'DAY', '05:00', '14:00']
					),
					rosterKnown()
				),
			/overlaps the interval on 2026-03-02/
		);
	});

	it('refuses a change to a sealed day and names the run, and lets an unchanged one pass', () => {
		const sealed = stored({
			work_date: '2026-03-02',
			actual_worked_intervals: [span('2026-03-02T00:00:00.000Z', '2026-03-02T09:00:00.000Z')],
			payroll_run_id: run,
			run_label: 'RUN-2026-03'
		});
		throwsRows(
			() =>
				planRosterUpload(
					rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', '18:00']),
					rosterKnown([sealed])
				),
			/sealed by payroll run RUN-2026-03/
		);
		const plan = planRosterUpload(
			rosterSheet(
				['1001', '2026-03-02', 'DAY', '08:00', '17:00'],
				['1001', '2026-03-03', 'DAY', '08:00', '17:00']
			),
			rosterKnown([sealed])
		);
		assert.deepEqual(
			plan.creates.map((day) => String(day.work_date)),
			['2026-03-03']
		);
		assert.equal(plan.updates.length, 0);
	});

	it('normalises local clocks in the entity zone and rolls an overnight interval', () => {
		const days = planRosterUpload(
			rosterSheet(
				['1001', '2026-03-02', 'DAY', '08:00', '17:00'],
				['1001', '2026-03-03', 'DAY', '22:00', '06:00'],
				['1001', '2026-03-04', 'DAY', '2026-03-04T22:00:00+08:00', '2026-03-05T06:00:00+08:00']
			),
			rosterKnown()
		);
		assert.equal(
			rosterMonth(rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', '17:00'])),
			'2026-03'
		);
		const intervals = days.creates.map((day) => day.actual_worked_intervals?.[0]);
		assert.deepEqual(intervals[0], span('2026-03-02T00:00:00.000Z', '2026-03-02T09:00:00.000Z'));
		assert.deepEqual(intervals[1], span('2026-03-03T14:00:00.000Z', '2026-03-03T22:00:00.000Z'));
		assert.deepEqual(intervals[2], span('2026-03-04T14:00:00.000Z', '2026-03-04T22:00:00.000Z'));
	});

	it('a plan sheet and a work entries sheet each write only their own fields', () => {
		const planSheet = [
			['Employee number', 'Name', 'Date', 'Shift', 'Planned OT start', 'Planned OT end'],
			['1001', 'A', '2026-03-02', 'DAY', '17:00', '19:00'],
			['1001', 'A', '2026-03-03', 'DAY', null, null]
		];
		const workSheet = [
			['Employee number', 'Name', 'Date', 'Clock in', 'Clock out'],
			['1001', 'A', '2026-03-02', '08:00', '19:05'],
			['1001', 'A', '2026-03-03', null, null]
		];
		const both = planRosterUpload(
			new Map([
				['Plan', planSheet],
				['Work entries', workSheet]
			]),
			rosterKnown()
		);
		assert.deepEqual(both.creates[0], {
			employment_id: employee,
			work_date: '2026-03-02',
			shift_definition_id: shift,
			planned_overtime_intervals: [span('2026-03-02T09:00:00.000Z', '2026-03-02T11:00:00.000Z')],
			actual_worked_intervals: [span('2026-03-02T00:00:00.000Z', '2026-03-02T11:05:00.000Z')]
		});
		// the blank work row made no clock: the plan row alone wrote that day
		assert.equal(both.creates[1]?.actual_worked_intervals, undefined);

		const planned = stored({
			work_date: '2026-03-02',
			planned_overtime_intervals: [span('2026-03-02T09:00:00.000Z', '2026-03-02T11:00:00.000Z')]
		});
		const clocks = planRosterUpload(new Map([['Work entries', workSheet]]), rosterKnown([planned]));
		assert.deepEqual(clocks.updates[0]?.set, {
			actual_worked_intervals: [span('2026-03-02T00:00:00.000Z', '2026-03-02T11:05:00.000Z')]
		});
		// a first clock replaces nothing
		assert.deepEqual(clocks.overwritten, []);

		const worked = stored({
			work_date: '2026-03-02',
			actual_worked_intervals: [span('2026-03-02T00:00:00.000Z', '2026-03-02T09:00:00.000Z')]
		});
		const replan = planRosterUpload(new Map([['Plan', planSheet]]), rosterKnown([worked]));
		assert.equal(replan.updates[0]?.set.actual_worked_intervals, undefined);
		assert.equal(replan.updates[0]?.set.planned_overtime_intervals?.length, 1);
	});

	it('a bare overtime time falls on the side of a night shift it is nearer', () => {
		const known = {
			...rosterKnown(),
			shifts: [
				{
					id: shift,
					entity_id: entity,
					code: 'DAY',
					from: '2026-01-01',
					to: null,
					start_time: '20:30',
					end_time: '06:30',
					ends_next_day: true
				}
			]
		};
		const overtime = (start: string, end: string) =>
			planRosterUpload(
				grid([
					['employee_number', 'date', 'shift', 'planned_ot_start', 'planned_ot_end'],
					['1001', '2026-03-02', 'DAY', start, end]
				]),
				known
			).creates[0]?.planned_overtime_intervals?.[0];
		// the morning after the shift ends
		assert.deepEqual(
			overtime('06:30', '08:30'),
			span('2026-03-02T22:30:00.000Z', '2026-03-03T00:30:00.000Z')
		);
		// the evening before it starts
		assert.deepEqual(
			overtime('18:30', '20:30'),
			span('2026-03-02T10:30:00.000Z', '2026-03-02T12:30:00.000Z')
		);
		// a dated cell needs no working out
		assert.deepEqual(
			overtime('2026-03-03 06:30', '2026-03-03 08:30'),
			span('2026-03-02T22:30:00.000Z', '2026-03-03T00:30:00.000Z')
		);
	});

	it('reads Excel time cells, and refuses half a pair', () => {
		const plan = planRosterUpload(
			rosterSheet(['1001', '2026-03-02', 'DAY', 8 / 24, 17 / 24]),
			rosterKnown()
		);
		assert.deepEqual(plan.creates[0]?.actual_worked_intervals, [
			span('2026-03-02T00:00:00.000Z', '2026-03-02T09:00:00.000Z')
		]);
		throwsRows(
			() =>
				planRosterUpload(rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', null]), rosterKnown()),
			/clock in and clock out go together/
		);
	});

	it('a file with neither sheet says what it needs', () => {
		throwsRows(
			() => planRosterUpload(grid([['name'], ['x']]), rosterKnown()),
			/Plan sheet.*Work entries sheet/
		);
	});

	it('the month it writes out reads back as no change, an overnight clock and overtime included', () => {
		const known = rosterKnown([
			stored({
				work_date: '2026-03-02',
				planned_overtime_intervals: [span('2026-03-02T22:30:00.000Z', '2026-03-03T00:30:00.000Z')],
				actual_worked_intervals: [span('2026-03-02T12:21:37.000Z', '2026-03-03T01:11:00.000Z')]
			})
		]);
		const sheets = rosterSheets(
			[
				{
					number: '1001',
					name: 'A',
					date: '2026-03-02',
					shift: 'DAY',
					planned: span('2026-03-02T22:30:00.000Z', '2026-03-03T00:30:00.000Z'),
					worked: span('2026-03-02T12:21:37.000Z', '2026-03-03T01:11:00.000Z')
				}
			],
			'Asia/Singapore'
		);
		assert.deepEqual(sheets.get('Work entries')?.[1], [
			'1001',
			'A',
			'2026-03-02',
			'20:21',
			'2026-03-03 09:11'
		]);
		const plan = planRosterUpload(sheets, known);
		assert.deepEqual([plan.creates, plan.updates], [[], []]);
	});
});

describe('entry workbook', () => {
	it('rejects leave that overlaps a recorded request', () => {
		throwsRows(
			() =>
				parseLeaveSheet(
					grid([
						['employee_number', 'code', 'days'],
						['1001', 'ANNUAL', '2026-03-05 AM']
					]),
					{
						entity: {
							id: entity,
							code: 'ACME',
							name: 'Acme',
							settings_code: 'SG'
						},
						employees: [
							{
								id: employee,
								number: '1001',
								entity_id: entity,
								from: '2026-01-01',
								to: null
							}
						],
						versions: [{ id: settings, code: 'SG', from: '2026-01-01', to: null }],
						catalogs: [{ id: leaveCatalog, code: 'ANNUAL', settings_id: settings }],
						existing: [
							{
								employment_id: employee,
								catalog_id: leaveCatalog,
								days: [{ date: '2026-03-05', part: 'AM' }]
							}
						]
					}
				),
			/already has ANNUAL/
		);
	});

	it('expands a leave range into dated AM and PM slots', () => {
		const parsed = parseLeaveSheet(
			grid([
				['employee_number', 'code', 'from', 'to'],
				['1001', 'ANNUAL', '2026-03-05', '2026-03-06']
			]),
			{
				entity: { id: entity, code: 'ACME', name: 'Acme', settings_code: 'SG' },
				employees: [
					{
						id: employee,
						number: '1001',
						entity_id: entity,
						from: '2026-01-01',
						to: null
					}
				],
				versions: [{ id: settings, code: 'SG', from: '2026-01-01', to: null }],
				catalogs: [{ id: leaveCatalog, code: 'ANNUAL', settings_id: settings }],
				existing: []
			}
		);
		assert.deepEqual(parsed.rows[0]!.days, [
			{ date: '2026-03-05', part: 'AM' },
			{ date: '2026-03-05', part: 'PM' },
			{ date: '2026-03-06', part: 'AM' },
			{ date: '2026-03-06', part: 'PM' }
		]);
	});
});

describe('the one-workbook data request', () => {
	const adhocCatalog = idOf('adhoc_catalog', '99999999-9999-4999-8999-999999999999');
	const entityRow = { id: entity, name: 'Acme', code: 'ACME', settings_code: 'MY' };
	const known = {
		entity: entityRow,
		employees: [{ id: employee, number: '1001', entity_id: entity, from: '2026-01-01', to: null }],
		versions: [{ id: settings, code: 'MY', from: '2026-01-01', to: null }]
	};
	const workbook = new Map<string, readonly (readonly Cell[])[]>([
		['Read me', [['How to fill this in']]],
		['Entity', [['Company Name'], ['Acme']]],
		[
			'Leave',
			[
				['Employee Number', 'Leave Type', 'From', 'To'],
				['1001', 'ANNUAL_LEAVE', '2026-03-02', '2026-03-02']
			]
		],
		[
			'Claims',
			[
				['Employee Number', 'Claim Type', 'Incurred On', 'Amount', 'Description'],
				['1001', 'DENTAL', '2026-03-02', 10, 'wrong sheet']
			]
		],
		[
			'Ad Hoc',
			[
				['Employee Number', 'Ad Hoc Type', 'Incurred On', 'Amount', 'Description'],
				['1001', 'BPAYBS', '2026-03-02', 75, 'March']
			]
		]
	]);

	it('reads each family from its own sheet, by the catalogue code', () => {
		const leave = parseLeaveSheet(workbook, {
			...known,
			catalogs: [
				{ id: leaveCatalog, code: 'ANNUAL_LEAVE', name: 'Annual leave', settings_id: settings }
			],
			existing: []
		});
		assert.equal(leave.rows[0]?.catalog_id, leaveCatalog);
		const adhoc = parseAdhocSheet(workbook, {
			...known,
			catalogs: [
				{ id: adhocCatalog, code: 'BPAYBS', name: 'Back pay – basic', settings_id: settings }
			],
			existing: []
		});
		assert.deepEqual(
			adhoc.rows.map((row) => [row.catalog_id, row.quantity, row.description]),
			[[adhocCatalog, 75, 'March']]
		);
	});
});
