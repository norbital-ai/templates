import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Caller, type Kit } from '@norbital-ai/bolt-cli/test';
import type { ReadRequest, ReadRequestBase } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type { Worksheet } from 'exceljs';
import type { JsonObject } from '../../src/lib/contracts.ts';
import { idOf, type Reader } from '../../src/lib/reads.ts';
import { PayslipBreakdown } from '../../src/data/model/payroll_run/service/payslip_breakdown.ts';
import {
	overtimeReportForMonth,
	overtimeReportForRuns
} from '../../src/data/model/payroll_run/service/exports/overtime_report_download.ts';
import {
	evaluateEmployeeOvertime,
	overtimeWorkbookOf,
	type OvertimeSheet
} from '../../src/data/model/payroll_run/service/exports/overtime_report_export.ts';
import {
	ENTITY,
	EMPLOYMENT,
	PAY_GROUP,
	REST,
	WORK,
	lawAt,
	lawWith,
	pack,
	packTerms,
	query,
	seededLaws,
	storedQuery,
	uuid,
	workspace
} from '../kit.ts';

const callerReader =
	(t: Kit, caller: Caller): Reader =>
	<const R extends ReadRequestBase>(request: ReadRequest<R>) =>
		query(t, caller, request).pipe(Effect.catchTag('SchemaError', (error) => Effect.die(error)));

const baseTerms = (over: JsonObject = {}): JsonObject => ({
	rate: { amount: 2400, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	work_classification: 'NON_MANUAL',
	...over
});

const day = (date: string, over: JsonObject = {}): JsonObject => ({
	date,
	day_type: 'WORK',
	scheduled_hours: 8,
	holiday_kind: '',
	worked: true,
	worked_hours: 10,
	overtime_hours: 2,
	clocked_shift_hours: 8,
	time_off_hours: 0,
	intervals: [],
	overtime_intervals: [],
	...over
});

const utcSpan = (date: string, startHour: number, endHour: number) => ({
	start: Date.parse(`${date}T00:00:00.000Z`) + startHour * 3_600_000,
	end: Date.parse(`${date}T00:00:00.000Z`) + endHour * 3_600_000
});

const evalLaw = (
	code: string,
	days: readonly JsonObject[],
	options?: {
		readonly terms?: JsonObject;
		readonly employer?: JsonObject;
		readonly engagement?: string;
		readonly statutory?: JsonObject;
		readonly coverage?: { readonly from: string; readonly to: string };
	}
) => {
	const law = lawAt(code, '2026-06-30');
	const coverage = options?.coverage ?? { from: '2026-06-01', to: '2026-06-30' };
	return evaluateEmployeeOvertime({
		settings: law.settings,
		allowance: law.rows.allowance_catalog,
		overtime: law.rows.overtime_catalog,
		employee: { id: 'emp-1', name: 'Sample Worker' },
		employment: {
			id: 'stint-1',
			employee_id: 'emp-1',
			engagement: options?.engagement ?? 'FULL_TIME',
			effective_range: { from: '2025-01-01', to: null },
			terms: baseTerms(options?.terms),
			statutory_parameters: options?.statutory ?? {}
		},
		employer: {
			id: 'ent-1',
			name: 'Sample Co',
			payment_schedule: { non_working_weekdays: [0, 6] },
			...options?.employer
		},
		coverage,
		period: coverage.from.slice(0, 7),
		payDate: coverage.to,
		days,
		workEvents: [],
		holidayNames: new Map()
	});
};

const byCatalog = (lines: readonly { readonly code: string; readonly amount: number }[]) =>
	Object.fromEntries(lines.map((line) => [line.code, line.amount]));

const headerRow = (ws: Worksheet, row: number) =>
	Array.from({ length: ws.columnCount }, (_, index) =>
		String(ws.getRow(row).getCell(index + 1).value ?? '')
	);

describe('overtime report per catalogue item', () => {
	it('evaluates overtime_catalog conversion cleanly across every seeded jurisdiction', () => {
		const laws = seededLaws();
		assert.ok(laws.length >= 9);
		for (const code of laws) {
			const result = evalLaw(code, [day('2026-06-03', { overtime_hours: 2, worked_hours: 10 })], {
				terms: code === 'JP' ? { work_classification: 'ORDINARY' } : {}
			});
			assert.equal(result.overtimeHours, 2);
			assert.ok(result.lines.length > 0, `${code}: expected at least one overtime_catalog total`);
			assert.ok(
				result.lines.every((line) => Number.isFinite(line.amount) && line.amount > 0),
				`${code}: expected positive monetary amounts`
			);
		}
	});

	it('produces distinct monetary totals per MY overtime_catalog item and respects SG Part IV eligibility', () => {
		const my = evalLaw('MY', [
			day('2026-06-03', { day_type: 'WORK', overtime_hours: 3, worked_hours: 11 }),
			day('2026-06-07', {
				day_type: 'REST',
				scheduled_hours: 0,
				worked_hours: 10,
				overtime_hours: 10
			}),
			day('2026-06-15', {
				day_type: 'WORK',
				holiday_kind: 'PUBLIC_HOLIDAY',
				scheduled_hours: 8,
				worked_hours: 11,
				overtime_hours: 3
			})
		]);
		const myTotals = byCatalog(my.lines);
		assert.equal(my.overtimeHours, 16);
		assert.ok((myTotals.OVERTIME ?? 0) > 0);
		assert.ok((myTotals.REST_DAY_WORK ?? 0) > 0);
		assert.ok((myTotals.REST_DAY_OVERTIME ?? 0) > 0);
		assert.ok((myTotals.HOLIDAY_WORK ?? 0) > 0);
		assert.ok((myTotals.HOLIDAY_OVERTIME ?? 0) > 0);

		const sgCovered = evalLaw(
			'SG',
			[day('2026-06-03', { day_type: 'WORK', overtime_hours: 2.5, worked_hours: 10.5 })],
			{ terms: { rate: { amount: 2400, unit: 'MONTHLY' }, work_classification: 'NON_MANUAL' } }
		);
		assert.ok((byCatalog(sgCovered.lines).OVERTIME ?? 0) > 0);

		const sgExempt = evalLaw(
			'SG',
			[day('2026-06-03', { day_type: 'WORK', overtime_hours: 4, worked_hours: 12 })],
			{ terms: { rate: { amount: 5000, unit: 'MONTHLY' }, work_classification: 'NON_MANUAL' } }
		);
		assert.equal(sgExempt.lines.length, 0);
	});

	it('includes PH NIGHT_SHIFT_DIFFERENTIAL alongside OVERTIME and separates time-off banked hours', () => {
		// PH is UTC+8: 14:00Z..16:00Z is 22:00..24:00 local time
		const ph = evalLaw('PH', [
			day('2026-06-03', {
				day_type: 'WORK',
				overtime_hours: 2,
				worked_hours: 10,
				intervals: [utcSpan('2026-06-03', 6, 16)]
			})
		]);
		const phTotals = byCatalog(ph.lines);
		assert.ok((phTotals.OVERTIME ?? 0) > 0);
		assert.ok((phTotals.NIGHT_SHIFT_DIFFERENTIAL ?? 0) > 0);

		const banked = evalLaw('MY', [
			day('2026-06-03', {
				day_type: 'WORK',
				worked_hours: 8,
				overtime_hours: 0,
				time_off_hours: 3
			})
		]);
		assert.equal(banked.lines.length, 0);
		assert.equal(banked.bankedHours, 3);
	});
});

describe('overtime workbook layout', () => {
	it('writes OT HOURS, per-catalogue monetary columns, TOTAL OVERTIME PAY formulas, GRAND TOTAL and Daily details', async () => {
		const sheet: OvertimeSheet = {
			company: 'Example Holdings',
			currency: 'MYR',
			jurisdiction: 'MY',
			period: '2026-10',
			payGroup: 'Monthly',
			attendance: { from: '2026-09-21', to: '2026-10-20' },
			people: [
				{
					code: 'EMP-002',
					name: 'Second Worker',
					department: 'Ops',
					position: 'Tech',
					overtimeHours: 4,
					bankedHours: 1.5,
					lines: [{ code: 'OVERTIME', label: 'OVERTIME', amount: 120.5 }],
					days: [
						{
							date: '2026-10-02',
							dayType: 'WORK',
							holiday: '',
							workedHours: 12,
							overtimeHours: 4,
							bankedHours: 0
						},
						{
							date: '2026-10-05',
							dayType: 'WORK',
							holiday: '',
							workedHours: 8,
							overtimeHours: 0,
							bankedHours: 1.5
						}
					]
				},
				{
					code: 'EMP-001',
					name: 'First Worker',
					department: 'Ops',
					position: 'Lead',
					overtimeHours: 5,
					bankedHours: 0,
					lines: [
						{ code: 'OVERTIME', label: 'OVERTIME', amount: 90 },
						{ code: 'REST_DAY_WORK', label: 'REST DAY WORK', amount: 150 }
					],
					days: [
						{
							date: '2026-09-25',
							dayType: 'WORK',
							holiday: '',
							workedHours: 11,
							overtimeHours: 3,
							bankedHours: 0
						},
						{
							date: '2026-10-04',
							dayType: 'REST',
							holiday: '',
							workedHours: 2,
							overtimeHours: 2,
							bankedHours: 0
						}
					]
				}
			]
		};

		const wb = overtimeWorkbookOf([sheet]);
		const bytes = await wb.xlsx.writeBuffer();
		const reloaded = new ExcelJSBrowser.Workbook();
		await reloaded.xlsx.load(bytes);

		const summary = reloaded.getWorksheet('OCT 2026');
		assert.ok(summary);
		assert.deepEqual(headerRow(summary, 5), [
			'EMPLOYEE CODE',
			'NAME',
			'DEPARTMENT',
			'POSITION',
			'OT HOURS',
			'OVERTIME',
			'REST DAY WORK',
			'TOTAL OVERTIME PAY',
			'TIME-OFF BANKED (HRS)'
		]);
		assert.equal(summary.getRow(6).getCell(1).value, 'EMP-001');
		assert.equal(summary.getRow(6).getCell(5).value, 5);
		assert.equal(summary.getRow(6).getCell(6).value, 90);
		assert.equal(summary.getRow(6).getCell(7).value, 150);
		assert.deepEqual(summary.getRow(6).getCell(8).value, { formula: 'SUM(F6:G6)', result: 240 });

		assert.equal(summary.getRow(7).getCell(1).value, 'EMP-002');
		assert.equal(summary.getRow(7).getCell(5).value, 4);
		assert.equal(summary.getRow(7).getCell(6).value, 120.5);
		assert.deepEqual(summary.getRow(7).getCell(8).value, { formula: 'SUM(F7:G7)', result: 120.5 });
		assert.equal(summary.getRow(7).getCell(9).value, 1.5);

		assert.equal(summary.getRow(8).getCell(2).value, 'GRAND TOTAL');
		assert.deepEqual(summary.getRow(8).getCell(5).value, { formula: 'SUM(E6:E7)', result: 9 });
		assert.deepEqual(summary.getRow(8).getCell(6).value, { formula: 'SUM(F6:F7)', result: 210.5 });
		assert.deepEqual(summary.getRow(8).getCell(7).value, { formula: 'SUM(G6:G7)', result: 150 });
		assert.deepEqual(summary.getRow(8).getCell(8).value, { formula: 'SUM(H6:H7)', result: 360.5 });
		assert.deepEqual(summary.getRow(8).getCell(9).value, { formula: 'SUM(I6:I7)', result: 1.5 });

		const details = reloaded.getWorksheet('Daily details');
		assert.ok(details);
		// 1 header + 4 worked/banked day rows
		assert.equal(details.rowCount, 5);
	});
});

const baseMy = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		...packTerms(2400),
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5
	},
	{},
	[
		// before Oct cutoff (2026-09-20) -> must be excluded from 2026-10 report
		{ date: '2026-09-20', shift: WORK, hours: 12, overtime: 4 },
		// inside Oct cutoff (2026-09-21..2026-10-20) -> 2h workday OT
		{ date: '2026-09-21', shift: WORK, hours: 10, overtime: 2 },
		// rest day inside cutoff -> 8h rest day + 2h excess
		{ date: '2026-10-04', shift: REST, hours: 10, overtime: 10 },
		// public holiday inside cutoff -> 8h holiday + 3h excess
		{ date: '2026-10-12', shift: WORK, hours: 11, overtime: 3 },
		// after Oct cutoff (2026-10-21) -> must be excluded from 2026-10 report
		{ date: '2026-10-21', shift: WORK, hours: 13, overtime: 5 }
	],
	[{ date: '2026-10-12', kind: 'PUBLIC_HOLIDAY' }]
);

const [myGroup] = baseMy.pay_group ?? [];
assert.ok(myGroup);
const myCutoffSeed = lawWith(
	{
		...baseMy,
		pay_group: [
			{
				...myGroup,
				payment_schedule: {
					frequency: 'MONTHLY',
					business_day: 'PREVIOUS',
					non_working_weekdays: [0, 6],
					short_month: 'LAST_DAY',
					pay_cutoff_day: 21,
					pay_days: [28]
				}
			}
		],
		roster_entry: [
			...(baseMy.roster_entry ?? []),
			// time-off banked OT day inside cutoff (2026-10-15)
			{
				id: uuid(901),
				employment_id: EMPLOYMENT,
				work_date: '2026-10-15',
				shift_definition_id: WORK,
				planned_overtime_intervals: [
					{ start: '2026-10-15T08:00:00.000Z', end: '2026-10-15T10:30:00.000Z' }
				],
				actual_worked_intervals: [
					{ start: '2026-10-15T00:00:00.000Z', end: '2026-10-15T10:30:00.000Z' }
				],
				overtime_as_time_off: true
			}
		]
	},
	{
		leave_catalog: {
			TIME_OFF_IN_LIEU: {
				subtotal: 'PAID_BASIC',
				description: 'Synthetic time-off in lieu for overtime banked as leave.',
				lookup: {
					unit: 'HOUR',
					overtime_as_time_off: true,
					grant_days: 0,
					accrual_basis: 'CALENDAR_YEAR'
				}
			}
		}
	}
);

it.live(
	'exports month and run overtime reports matching payslip overtime_catalog lines to the cent under hr_controller policy',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hrRead = callerReader(t, yield* t.as(t.member(['hr_controller'])));

			// Export directly from Work Entries (before any payroll run exists)
			const monthSheets = yield* overtimeReportForMonth(hrRead, idOf('entity', ENTITY), '2026-10');
			assert.equal(monthSheets.length, 1);
			const [oct] = monthSheets;
			assert.ok(oct);
			assert.equal(oct.currency, 'MYR');
			assert.deepEqual(oct.attendance, { from: '2026-09-21', to: '2026-10-20' });
			assert.equal(oct.people.length, 1);
			const [worker] = oct.people;
			assert.ok(worker);
			// 2h workday + 10h rest day + 3h holiday = 15h paid OT; 2.5h banked; 2026-09-20 & 2026-10-21 excluded
			assert.equal(worker.overtimeHours, 15);
			assert.equal(worker.bankedHours, 2.5);

			// Create the payroll run and verify exact cent-for-cent parity with the saved payslip breakdown
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [
					{
						entity_id: ENTITY,
						pay_group_id: idOf('pay_group', PAY_GROUP),
						period: '2026-10',
						kind: 'ON_CYCLE'
					}
				]
			});
			const { payroll_run, payslip } = yield* storedQuery(t, {
				payroll_run: { limit: 1 },
				payslip: { fields: ['breakdown'], limit: 1 }
			});
			const [run] = payroll_run.rows;
			const [slip] = payslip.rows;
			assert.ok(run && slip);

			const breakdown = Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown);
			const payslipOvertime = Object.fromEntries(
				breakdown.lines
					.filter((line) => line.source === 'overtime_catalog')
					.map((line) => [line.code, line.direction === 'DEDUCT' ? -line.amount : line.amount])
			);
			assert.deepEqual(byCatalog(worker.lines), payslipOvertime);

			const runSheets = yield* overtimeReportForRuns(hrRead, [run.id]);
			assert.equal(runSheets.length, 1);
			assert.deepEqual(runSheets[0]?.attendance, { from: '2026-09-21', to: '2026-10-20' });
			assert.deepEqual(byCatalog(runSheets[0]?.people[0]?.lines ?? []), payslipOvertime);
		}).pipe(Effect.provide(workspace({ seed: myCutoffSeed, now: '2026-10-28T02:00:00.000Z' })))
);

const baseSemiMonthly = pack(
	'PH',
	'Asia/Manila',
	{
		...packTerms(26000),
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5
	},
	{},
	[
		// 1st half attendance (2026-09-16..2026-09-30) -> 3h OT
		{ date: '2026-09-22', shift: WORK, hours: 11, overtime: 3 },
		// 2nd half attendance (2026-10-01..2026-10-15) -> 2h OT
		{ date: '2026-10-08', shift: WORK, hours: 10, overtime: 2 }
	],
	[]
);
const [phGroup] = baseSemiMonthly.pay_group ?? [];
assert.ok(phGroup);
const semiMonthlySeed = {
	...baseSemiMonthly,
	pay_group: [
		{
			...phGroup,
			name: 'Semi-Monthly',
			payment_schedule: {
				frequency: 'SEMI_MONTHLY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				pay_cutoff_day: 16,
				pay_days: [15, 30]
			}
		}
	]
};

it.live('splits a semi-monthly pay group into two cutoff sheets for a month', () =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		const hrRead = callerReader(t, yield* t.as(t.member(['hr_controller'])));
		const sheets = yield* overtimeReportForMonth(hrRead, idOf('entity', ENTITY), '2026-10');
		assert.equal(sheets.length, 2);
		assert.equal(sheets[0]?.period, '2026-10-1');
		assert.deepEqual(sheets[0]?.attendance, { from: '2026-09-16', to: '2026-09-30' });
		assert.equal(sheets[0]?.people[0]?.overtimeHours, 3);
		assert.ok((byCatalog(sheets[0]?.people[0]?.lines ?? []).OVERTIME ?? 0) > 0);

		assert.equal(sheets[1]?.period, '2026-10-2');
		assert.deepEqual(sheets[1]?.attendance, { from: '2026-10-01', to: '2026-10-15' });
		assert.equal(sheets[1]?.people[0]?.overtimeHours, 2);
		assert.ok((byCatalog(sheets[1]?.people[0]?.lines ?? []).OVERTIME ?? 0) > 0);

		const wb = overtimeWorkbookOf(sheets);
		assert.ok(wb.getWorksheet('OCT 2026 1ST HALF'));
		assert.ok(wb.getWorksheet('OCT 2026 2ND HALF'));
	}).pipe(Effect.provide(workspace({ seed: semiMonthlySeed, now: '2026-10-30T02:00:00.000Z' })))
);
