// The workbooks HR fills in: the roster's plan and work entries, each entry family's sheet and the holiday sheets, read
// into their models' rows or refused whole, naming the row and the reason.
import { DateTime } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { lawsOf } from '../../src/lib/law.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { WorkbookRowsError } from '../../src/lib/payroll_engine/workbook_rows.ts';
import {
	planRosterUpload,
	rosterMonth,
	rosterSheets,
	type RosterKnown
} from '../../src/lib/payroll_engine/roster_workbook.ts';
import {
	parseAdhocSheet,
	parseCaseSheet,
	parseClaimSheet,
	parseLeaveSheet,
	parseLoanSheet,
	parseRepaymentSheet
} from '../../src/lib/payroll_engine/entry_workbook.ts';
import {
	parseEntityHolidaySheets,
	skipHeldHolidays
} from '../../src/lib/ui/workbook/holiday_workbook.ts';

const entity = idOf('entity', '11111111-1111-4111-8111-111111111111');
const employee = idOf('employee_contract', '22222222-2222-4222-8222-222222222222');
const shift = idOf('shift_definition', '33333333-3333-4333-8333-333333333333');
/** A law of the fixture's own: the catalogue rows the sheets below name, in force from the start of 2026. */
const laws = lawsOf({
	jurisdiction: [
		{
			id: '77777777-7777-4777-8777-777777777777',
			code: 'MY',
			name: 'Fixture',
			currency: 'MYR',
			timezone: 'Asia/Kuala_Lumpur',
			tax_year_start_month: 1
		}
	],
	jurisdiction_change: [
		{
			id: '88888888-8888-4888-8888-888888888888',
			jurisdiction_code: 'MY',
			effective_from: '2026-01-01',
			law: {
				leave_catalog: {
					ANNUAL: { name: 'Annual' },
					ANNUAL_LEAVE: { name: 'Annual leave' }
				},
				adhoc_catalog: { BPAYBS: { name: 'Back pay – basic' } },
				claim_catalog: { MEDICAL: { name: 'Medical' } },
				loan_catalog: { STAFF_LOAN: { name: 'Staff loan' } },
				workplace_case_catalog: { ACCIDENT: { name: 'Accident' } }
			}
		}
	]
});

type Cell = string | number | boolean | null;
const grid = (rows: readonly (readonly Cell[])[]) => new Map([['Sheet1', rows]]);

const rosterKnown = (entries: RosterKnown['entries'] = []): RosterKnown => ({
	entity_name: 'Acme',
	zone: 'Asia/Kuala_Lumpur',
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

const span = (start: string, end: string) => ({
	start: DateTime.formatIso(DateTime.makeUnsafe(start)),
	end: DateTime.formatIso(DateTime.makeUnsafe(end))
});

const stored = (
	over: Partial<RosterKnown['entries'][number]> & { readonly work_date: string }
): RosterKnown['entries'][number] => ({
	employment_id: employee,
	shift_definition_id: shift,
	planned_overtime_intervals: null,
	overtime_as_time_off: false,
	actual_worked_intervals: null,
	consent: null,
	...over
});

const rosterSheet = (...rows: readonly (readonly Cell[])[]) =>
	grid([['employee_number', 'work_date', 'shift_code', 'clock_in', 'clock_out'], ...rows]);

const throwsRows = (build: () => unknown, pattern: RegExp) =>
	assert.throws(build, (error: unknown) => {
		assert.ok(error instanceof WorkbookRowsError);
		assert.match([error.message, ...error.detail].join('\n'), pattern);
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
			/The same person and day appear twice: 1001 on 2026-03-02 \(row 3\), first at row 2/
		);
	});

	it('fails an unrecognised shift code', () => {
		throwsRows(
			() =>
				planRosterUpload(
					rosterSheet(['1001', '2026-03-02', 'NIGHT', '08:00', '17:00']),
					rosterKnown()
				),
			/Not a shift code in effect that day: 1001 on 2026-03-02 \(row 2\): "NIGHT"/
		);
	});

	it('leaves a day the file does not name as it is', () => {
		const plan = planRosterUpload(
			rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', '17:00']),
			rosterKnown([stored({ work_date: '2026-03-03' })])
		);
		assert.deepEqual(
			plan.rows.map((day) => String(day.work_date)),
			['2026-03-02']
		);
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
		assert.deepEqual(plan.rows[0]?.consent, {
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
			/Clock times overlap the day before: 1001 on 2026-03-03 \(row 3\) overlaps 2026-03-02/
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
		const intervals = days.rows.map((day) => day.actual_worked_intervals?.[0]);
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
		assert.deepEqual(both.rows[0], {
			employment_id: employee,
			work_date: '2026-03-02',
			shift_definition_id: shift,
			planned_overtime_intervals: [span('2026-03-02T09:00:00.000Z', '2026-03-02T11:00:00.000Z')],
			actual_worked_intervals: [span('2026-03-02T00:00:00.000Z', '2026-03-02T11:05:00.000Z')]
		});
		// the blank work row made no clock: the plan row alone wrote that day
		assert.equal(both.rows[1]?.actual_worked_intervals, undefined);

		const planned = stored({
			work_date: '2026-03-02',
			planned_overtime_intervals: [span('2026-03-02T09:00:00.000Z', '2026-03-02T11:00:00.000Z')]
		});
		const clocks = planRosterUpload(new Map([['Work entries', workSheet]]), rosterKnown([planned]));
		// a stored day takes only the fields the file changes
		assert.deepEqual(clocks.rows, [
			{
				employment_id: employee,
				work_date: '2026-03-02',
				actual_worked_intervals: [span('2026-03-02T00:00:00.000Z', '2026-03-02T11:05:00.000Z')]
			}
		]);
		// a first clock replaces nothing
		assert.deepEqual(clocks.overwritten, []);

		const worked = stored({
			work_date: '2026-03-02',
			actual_worked_intervals: [span('2026-03-02T00:00:00.000Z', '2026-03-02T09:00:00.000Z')]
		});
		const replan = planRosterUpload(new Map([['Plan', planSheet]]), rosterKnown([worked]));
		assert.equal(replan.rows[0]?.actual_worked_intervals, undefined);
		assert.equal(replan.rows[0]?.planned_overtime_intervals?.length, 1);
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
			).rows[0]?.planned_overtime_intervals?.[0];
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
		assert.deepEqual(plan.rows[0]?.actual_worked_intervals, [
			span('2026-03-02T00:00:00.000Z', '2026-03-02T09:00:00.000Z')
		]);
		throwsRows(
			() =>
				planRosterUpload(rosterSheet(['1001', '2026-03-02', 'DAY', '08:00', null]), rosterKnown()),
			/Clock in with no clock out: 1001 on 2026-03-02 \(row 2\)/
		);
	});

	it('groups missing clock-outs and keeps the report short while counting every problem', () => {
		const rows = Array.from({ length: 7 }, (_, i) => [
			'1001',
			`2026-03-0${i + 1}`,
			'DAY',
			'08:00',
			null
		]);
		assert.throws(
			() => planRosterUpload(rosterSheet(...rows), rosterKnown()),
			(error: unknown) => {
				assert.ok(error instanceof WorkbookRowsError);
				assert.equal(error.message, '7 problems need fixing before this file can be imported.');
				assert.equal(error.detail.length, 1);
				assert.match(error.detail[0]!, /^Clock in with no clock out: 1001 on 2026-03-01 \(row 2\)/);
				assert.match(error.detail[0]!, /1001 on 2026-03-06 \(row 7\); and 1 more\.$/);
				return true;
			}
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
					time_off: false,
					worked: span('2026-03-02T12:21:37.000Z', '2026-03-03T01:11:00.000Z')
				}
			],
			'Asia/Kuala_Lumpur'
		);
		assert.deepEqual(sheets.get('Work entries')?.[1], [
			'1001',
			'A',
			'2026-03-02',
			'20:21',
			'2026-03-03 09:11'
		]);
		const plan = planRosterUpload(sheets, known);
		assert.deepEqual(plan.rows, []);
	});

	it("marks a day's planned overtime as time off; a blank leaves the mark, `no` takes it off", () => {
		const planSheet = (timeOff: string) =>
			grid([
				['employee_number', 'work_date', 'shift_code', 'ot_start', 'ot_end', 'ot_as_time_off'],
				['1001', '2026-03-02', 'DAY', '17:00', '19:00', timeOff]
			]);
		const marked = planRosterUpload(planSheet('yes'), rosterKnown());
		assert.equal(marked.rows[0]?.overtime_as_time_off, true);
		const held = rosterKnown([
			stored({
				work_date: '2026-03-02',
				planned_overtime_intervals: [span('2026-03-02T09:00:00.000Z', '2026-03-02T11:00:00.000Z')],
				overtime_as_time_off: true
			})
		]);
		assert.deepEqual(planRosterUpload(planSheet(''), held).rows, []);
		assert.equal(planRosterUpload(planSheet('no'), held).rows[0]?.overtime_as_time_off, false);
		const written = rosterSheets(
			[
				{
					number: '1001',
					name: 'A',
					date: '2026-03-02',
					shift: 'DAY',
					planned: span('2026-03-02T09:00:00.000Z', '2026-03-02T11:00:00.000Z'),
					time_off: true,
					worked: null
				}
			],
			'Asia/Kuala_Lumpur'
		);
		assert.equal(written.get('Plan')?.[1]?.[6], 'yes');
		assert.deepEqual(planRosterUpload(written, held).rows, []);
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
							settings_code: 'MY'
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
						laws,
						existing: [
							{
								employment_id: employee,
								catalog_code: 'ANNUAL',
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
				entity: { id: entity, code: 'ACME', name: 'Acme', settings_code: 'MY' },
				employees: [
					{
						id: employee,
						number: '1001',
						entity_id: entity,
						from: '2026-01-01',
						to: null
					}
				],
				laws,
				existing: []
			}
		);
		assert.deepEqual(parsed.rows[0]?.days, [
			{ date: '2026-03-05', part: 'AM' },
			{ date: '2026-03-05', part: 'PM' },
			{ date: '2026-03-06', part: 'AM' },
			{ date: '2026-03-06', part: 'PM' }
		]);
	});
});

describe('the one-workbook data request', () => {
	const entityRow = { id: entity, name: 'Acme', code: 'ACME', settings_code: 'MY' };
	const known = {
		entity: entityRow,
		employees: [{ id: employee, number: '1001', entity_id: entity, from: '2026-01-01', to: null }],
		laws
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
		const leave = parseLeaveSheet(workbook, { ...known, existing: [] });
		assert.equal(leave.rows[0]?.catalog_code, 'ANNUAL_LEAVE');
		const adhoc = parseAdhocSheet(workbook, { ...known, existing: [] });
		assert.deepEqual(
			adhoc.rows.map((row) => [row.catalog_code, row.quantity, row.description]),
			[['BPAYBS', 75, 'March']]
		);
	});
});

describe('the claim, loan, repayment and case sheets', () => {
	const loan = idOf('loan_catalog_entry', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
	const entityRow = { id: entity, name: 'Acme', code: 'ACME', settings_code: 'MY' };
	const known = {
		entity: entityRow,
		employees: [{ id: employee, number: '1001', entity_id: entity, from: '2026-01-01', to: null }],
		laws
	};
	const lent = {
		...known,
		loans: [{ id: loan, employment_id: employee, catalog_code: 'STAFF_LOAN' }]
	};
	const cases = { ...known, entities: [entityRow] };
	const CLAIM = ['employee_number', 'code', 'incurred_on', 'amount'];
	const LOAN = ['employee_number', 'code', 'principal', 'repayment_from', 'repayment_to'];
	const REPAYMENT = ['employee_number', 'loan_code', 'amount', 'paid_on'];
	const CASE = ['employee_number', 'kind', 'opened_on', 'severity', 'inputs'];
	const sheet = (name: string, ...rows: readonly (readonly Cell[])[]) => new Map([[name, rows]]);

	it('read each family from its own sheet into its model’s rows', () => {
		const workbook = new Map<string, readonly (readonly Cell[])[]>([
			['Claims', [CLAIM, ['1001', 'MEDICAL', '2026-03-02', 80]]],
			['Loans', [LOAN, ['1001', 'STAFF_LOAN', 1200, '2026-03-01', '2026-08-31']]],
			['Loan Repayments', [REPAYMENT, ['1001', 'staff loan', 200, '2026-03-25']]],
			['Workplace Cases', [CASE, ['1001', 'ACCIDENT', '2026-03-03', 'MINOR_INJURY', 'slipped']]]
		]);
		const own = { entity_id: entity, employment_id: employee };
		assert.deepEqual(parseClaimSheet(workbook, { ...known, existing: [] }).rows, [
			{ ...own, catalog_code: 'MEDICAL', quantity: 80, incurred_on: '2026-03-02' }
		]);
		assert.deepEqual(parseLoanSheet(workbook, { ...known, existing: [] }).rows, [
			{
				...own,
				catalog_code: 'STAFF_LOAN',
				quantity: 1200,
				repayment_from: '2026-03-01',
				repayment_to: '2026-08-31'
			}
		]);
		// a repayment finds the person's one loan of that catalogue, however the code is typed
		assert.deepEqual(parseRepaymentSheet(workbook, { ...lent, existing: [] }).rows, [
			{ ...own, loan_id: loan, amount: 200, paid_on: '2026-03-25' }
		]);
		assert.deepEqual(parseCaseSheet(workbook, { ...cases, existing: [] }).rows, [
			{
				...own,
				catalog_code: 'ACCIDENT',
				kind: 'ACCIDENT',
				severity: 'MINOR_INJURY',
				opened_on: '2026-03-03',
				inputs: { details: 'slipped' }
			}
		]);
	});

	it('refuse the whole sheet for one bad row, naming the row and the reason', () => {
		const good = ['1001', 'MEDICAL', '2026-03-02', 80];
		throwsRows(
			() =>
				parseClaimSheet(sheet('Claims', CLAIM, good, ['1001', 'MEDICAL', '2026-03-03', 0]), {
					...known,
					existing: []
				}),
			/Row 3: enter a claim amount above zero/
		);
		// what is already recorded is not planned twice
		throwsRows(
			() =>
				parseClaimSheet(sheet('Claims', CLAIM, good), {
					...known,
					existing: [
						{
							employment_id: employee,
							catalog_code: 'MEDICAL',
							quantity: 80,
							incurred_on: '2026-03-02',
							description: null
						}
					]
				}),
			/Row 2: 1001 already has this claim on 2026-03-02/
		);
		throwsRows(
			() =>
				parseLoanSheet(
					sheet('Loans', LOAN, ['1001', 'STAFF_LOAN', 1200, '2026-03-01', '2026-02-01']),
					{ ...known, existing: [] }
				),
			/Row 2: the last repayment date 2026-02-01 is before 2026-03-01/
		);
		throwsRows(
			() =>
				parseRepaymentSheet(
					sheet('Loan Repayments', REPAYMENT, ['1001', 'STAFF_LOAN', 200, '2026-03-25']),
					{ ...known, loans: [], existing: [] }
				),
			/Row 2: 1001 has no STAFF_LOAN loan/
		);
		throwsRows(
			() =>
				parseCaseSheet(sheet('Workplace Cases', CASE, ['1001', 'FLOOD', '2026-03-03', '', '']), {
					...cases,
					existing: []
				}),
			/Row 2: "FLOOD" is not a workplace case catalogue of the MY law in force on 2026-03-03/
		);
	});
});

describe('the holiday workbook', () => {
	const entities = [{ id: entity, name: 'Acme' }];
	const HEADER = ['Date', 'Name', 'Kind', 'Replaces'];
	it('reads a sheet per company into its days, and skips a day the company already holds or the file repeats', () => {
		const parsed = parseEntityHolidaySheets(
			[
				['Read me first', [['How to fill this in']]],
				[
					'acme',
					[
						HEADER,
						['2026-05-01', 'Labour Day', 'PUBLIC_HOLIDAY', ''],
						['2026-05-04', 'In lieu', 'SUBSTITUTE', '2026-05-02'],
						['2026-05-04', 'In lieu again', 'SUBSTITUTE', '2026-05-02'],
						['', '', '', '']
					]
				]
			],
			entities
		);
		assert.ok('rows' in parsed);
		assert.equal(parsed.rows.length, 3);
		const { insert, skipped } = skipHeldHolidays(parsed.rows, [
			{ entity_id: entity, date: '2026-05-01' }
		]);
		assert.equal(skipped, 2);
		assert.deepEqual(insert, [
			{
				entity_id: entity,
				date: '2026-05-04',
				name: 'In lieu',
				kind: 'SUBSTITUTE',
				replaces: '2026-05-02'
			}
		]);
	});
	it('refuses the file for a sheet that names no company, or a day of no known kind', () => {
		const refusal = (name: string, row: readonly string[]) => {
			const parsed = parseEntityHolidaySheets([[name, [HEADER, row]]], entities);
			return 'error' in parsed ? parsed.error : '';
		};
		const day = ['2026-05-01', 'Labour Day', 'PUBLIC_HOLIDAY', ''];
		assert.match(refusal('Other Co', day), /Sheet "Other Co" names no entity of this workspace/);
		assert.match(
			refusal('Acme', ['2026-05-01', 'Labour Day', 'BANK_HOLIDAY', '']),
			/Sheet "Acme" has an unknown holiday kind "BANK_HOLIDAY" \(2026-05-01\)/
		);
		assert.match(
			refusal('Acme', ['1 May', 'Labour Day', 'PUBLIC_HOLIDAY', '']),
			/not YYYY-MM-DD \(1 May\)/
		);
	});
});
