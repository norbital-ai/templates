import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { WorkbookRowsError } from '../src/lib/payroll_engine/workbook_rows.ts';
import {
	planRosterUpload,
	rosterMonth,
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

	it('treats missing days as off and replaces the stored month', () => {
		const plan = planRosterUpload(
			rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', '17:00']),
			rosterKnown([
				{
					id: entry,
					employment_id: employee,
					work_date: '2026-03-03',
					shift_definition_id: shift,
					actual_worked_intervals: null,
					payroll_run_id: null,
					run_label: null
				}
			])
		);
		assert.equal(plan.creates.length, 1);
		assert.equal(plan.updates.length, 0);
		assert.deepEqual(plan.deletes, [{ target: entry, employment_id: employee }]);
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

	it('refuses a roster sealed by a payroll run and names the run', () => {
		throwsRows(
			() =>
				planRosterUpload(
					rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', '17:00']),
					rosterKnown([
						{
							id: entry,
							employment_id: employee,
							work_date: '2026-03-01',
							shift_definition_id: shift,
							actual_worked_intervals: null,
							payroll_run_id: run,
							run_label: 'RUN-2026-03'
						}
					])
				),
			/sealed by payroll run RUN-2026-03/
		);
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
		assert.deepEqual(intervals[0], {
			start: '2026-03-02T00:00:00.000Z',
			end: '2026-03-02T09:00:00.000Z'
		});
		assert.deepEqual(intervals[1], {
			start: '2026-03-03T14:00:00.000Z',
			end: '2026-03-03T22:00:00.000Z'
		});
		assert.deepEqual(intervals[2], {
			start: '2026-03-04T14:00:00.000Z',
			end: '2026-03-04T22:00:00.000Z'
		});
	});

	it('replaces the month: creates new days, updates changed days and deletes the rest', () => {
		const plan = planRosterUpload(
			rosterSheet(['1001', '2026-03-03', 'DAY', '08:00', '17:00']),
			rosterKnown([
				{
					id: entry,
					employment_id: employee,
					work_date: '2026-03-02',
					shift_definition_id: shift,
					actual_worked_intervals: null,
					payroll_run_id: null,
					run_label: null
				}
			])
		);
		assert.equal(plan.creates.length, 1);
		assert.equal(plan.updates.length, 0);
		assert.deepEqual(plan.deletes, [{ target: entry, employment_id: employee }]);
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
								days: [{ date: '2026-03-05', part: 'AM' }],
								is_reversal: false
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
				['1001', 'Annual leave', '2026-03-02', '2026-03-02']
			]
		],
		[
			'Claims',
			[
				['Employee Number', 'Claim Type', 'Incurred On', 'Amount', 'Description'],
				['1001', 'Dental', '2026-03-02', 10, 'wrong sheet']
			]
		],
		[
			'Ad Hoc',
			[
				['Employee Number', 'Ad Hoc Type', 'Incurred On', 'Amount', 'Description'],
				['1001', 'Back pay – basic', '2026-03-02', 75, 'March']
			]
		]
	]);

	it('reads each family from its own sheet, by the name a person picks', () => {
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
